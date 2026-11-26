import Gun from "gun";
import { env } from "$env/dynamic/public";
import { createGun, ensureUserLogged, getUser, type User } from "../gun/Gun.svelte";

const { SEA } = Gun;

export type CallKind = "audio" | "video";
export type CallStatus = "idle" | "outgoing" | "incoming" | "connecting" | "active";
export type CallDirection = "incoming" | "outgoing";
export type CallSignalType = "offer" | "answer" | "candidate" | "reject" | "hangup";

export interface CallPeer {
	pub: string;
	alias: string;
	avatar?: string;
	epub: string;
}

interface SignalRecord {
	v: 1;
	callId: string;
	type: CallSignalType;
	payload: string;
	ts: number;
}

interface SignalPayload {
	kind?: CallKind;
	sdp?: RTCSessionDescriptionInit;
	candidate?: RTCIceCandidateInit;
	reason?: string;
	sender?: string;
}

function createId() {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}

	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function mediaConstraints(kind: CallKind): MediaStreamConstraints {
	return kind === "video"
		? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } }
		: { audio: true, video: false };
}

function isSignalRecord(value: unknown): value is SignalRecord {
	if (!value || typeof value !== "object") return false;

	const record = value as Partial<SignalRecord>;

	return (
		record.v === 1 &&
		typeof record.callId === "string" &&
		typeof record.type === "string" &&
		typeof record.payload === "string" &&
		typeof record.ts === "number"
	);
}

export class CallManager {
	status = $state<CallStatus>("idle");
	direction = $state<CallDirection>("outgoing");
	kind = $state<CallKind>("audio");
	peer = $state<CallPeer>();
	friendPubs = $state<string[]>([]);
	localStream = $state<MediaStream>();
	remoteStream = $state<MediaStream>();
	muted = $state(false);
	cameraOff = $state(false);
	error = $state<string>();
	startedAt = $state<number>();

	private user?: User;
	private gun?: ReturnType<typeof createGun>;
	private userPub?: string;
	private callId?: string;
	private pc?: RTCPeerConnection;
	private pendingOffer?: RTCSessionDescriptionInit;
	private pendingCandidates: RTCIceCandidateInit[] = [];
	private localCandidates: RTCIceCandidateInit[] = [];
	private remoteDescriptionSet = false;
	private canSendCandidates = false;
	private cancelledCalls = new Map<string, number>();
	private seenSignals = new Set<string>();
	private offFriends?: () => void;
	private callChannelSubs = new Map<string, { off: () => void; channelId: string }>();
	private callChannelIds = new Map<string, string>();
	private peerCache = new Map<string, CallPeer>();
	private syncingChannels = false;
	private channelSyncPending = false;
	private outgoingTimer?: ReturnType<typeof setTimeout>;
	private incomingTimer?: ReturnType<typeof setTimeout>;

	isFriend(pub: string) {
		return this.friendPubs.includes(pub);
	}

	clearError() {
		this.error = undefined;
	}

	init() {
		let user: User;

		try {
			user = getUser();
			ensureUserLogged(user);
		} catch {
			return;
		}

		const pub = user._.sea.pub;
		if (this.userPub === pub && this.gun) return;

		this.destroy();

		this.user = user;
		this.userPub = pub;
		this.gun = createGun();

		const friendChain = user.get<Record<string, string>>("friends").map();
		friendChain.on((value, key) => {
			if (!value) {
				this.friendPubs = this.friendPubs.filter((friendPub) => friendPub !== key);
				void this.syncCallChannels();
				return;
			}

			if (!this.friendPubs.includes(key)) {
				this.friendPubs = [...this.friendPubs, key];
				void this.syncCallChannels();
			}
		});
		this.offFriends = () => friendChain.off();

		void this.syncCallChannels();
	}

	destroy() {
		this.offFriends?.();
		this.offFriends = undefined;

		for (const subscription of this.callChannelSubs.values()) {
			subscription.off();
		}
		this.callChannelSubs.clear();
		this.callChannelIds.clear();
		this.peerCache.clear();

		this.cleanup();
		this.friendPubs = [];
		this.error = undefined;
		this.user = undefined;
		this.gun = undefined;
		this.userPub = undefined;
		this.seenSignals.clear();
		this.cancelledCalls.clear();
	}

	async startCall(pub: string, kind: CallKind) {
		this.error = undefined;

		if (!this.user || !this.gun || !this.userPub) {
			this.error = "You need to be signed in to make calls.";
			return;
		}

		if (this.status !== "idle") {
			this.error = "You are already in a call.";
			return;
		}

		if (typeof RTCPeerConnection === "undefined" || !navigator.mediaDevices?.getUserMedia) {
			this.error = "Calling is not supported in this browser.";
			return;
		}

		if (!(await this.verifyFriend(pub))) {
			this.error = "You can only call friends.";
			return;
		}

		try {
			const peer = await this.getPeer(pub);

			await this.ensureCallChannel(peer);

			this.peer = peer;
			this.kind = kind;
			this.direction = "outgoing";
			this.callId = createId();
			this.resetCallState();
			this.status = "outgoing";

			this.outgoingTimer = setTimeout(() => {
				if (this.status === "outgoing") {
					this.error = "No answer.";
					void this.endCall();
				}
			}, 45_000);

			const pc = this.createPeerConnection();
			const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints(kind));

			if (this.status !== "outgoing" || !this.callId) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}

			this.localStream = stream;

			for (const track of stream.getTracks()) {
				pc.addTrack(track, stream);
			}

			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			await this.sendSignal("offer", { kind, sdp: pc.localDescription ?? undefined });

			// Do not let ICE candidates overtake the offer on the wire.
			this.canSendCandidates = true;
			await this.flushLocalCandidates();
		} catch (error) {
			this.fail(error);
		}
	}

	async accept() {
		if (this.status !== "incoming" || !this.pendingOffer) return;

		const offer = this.pendingOffer;

		this.error = undefined;
		this.clearTimers();
		this.status = "connecting";

		try {
			if (!navigator.mediaDevices?.getUserMedia) {
				throw new Error("Camera and microphone access is not available.");
			}

			const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints(this.kind));

			if (this.status !== "connecting" || !this.callId) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}

			this.localStream = stream;
			this.canSendCandidates = false;
			this.localCandidates = [];

			const pc = this.createPeerConnection();
			for (const track of stream.getTracks()) {
				pc.addTrack(track, stream);
			}

			await pc.setRemoteDescription(offer);
			this.pendingOffer = undefined;
			this.remoteDescriptionSet = true;
			await this.flushCandidates();

			const answer = await pc.createAnswer();
			await pc.setLocalDescription(answer);
			await this.sendSignal("answer", { sdp: pc.localDescription ?? undefined });

			this.canSendCandidates = true;
			await this.flushLocalCandidates();
		} catch (error) {
			try {
				await this.sendSignal("reject", { reason: "failed" });
			} catch {
				// best effort
			}

			this.fail(error);
		}
	}

	async reject() {
		if (this.status !== "incoming") return;

		try {
			await this.sendSignal("reject", { reason: "declined" });
		} catch {
			// best effort
		}

		this.cleanup();
	}

	async endCall() {
		const peer = this.peer;
		const callId = this.callId;
		const shouldNotify = this.status !== "idle" && !!peer && !!callId;

		this.clearTimers();

		if (shouldNotify) {
			try {
				await this.sendSignalTo(peer, callId, "hangup", {});
			} catch {
				// best effort
			}
		}

		this.cleanup();
	}

	toggleMute() {
		this.muted = !this.muted;
		for (const track of this.localStream?.getAudioTracks() ?? []) {
			track.enabled = !this.muted;
		}
	}

	toggleCamera() {
		this.cameraOff = !this.cameraOff;
		for (const track of this.localStream?.getVideoTracks() ?? []) {
			track.enabled = !this.cameraOff;
		}
	}

	private async verifyFriend(pub: string) {
		if (!this.gun || !this.userPub) return false;

		const value = await this.gun.get(`~${this.userPub}`).get("friends").get(pub).then();

		return !!value;
	}

	private async getPeer(pub: string): Promise<CallPeer> {
		const cached = this.peerCache.get(pub);
		if (cached) return cached;

		if (!this.gun) throw new Error("Not connected to Gun.");

		const data = await this.gun
			.get<{ alias?: string; avatar?: string; epub?: string }>(`~${pub}`)
			.then();

		if (!data?.epub) {
			throw new Error("Could not find this user's encryption key.");
		}

		const peer = {
			pub,
			alias: data.alias ?? pub,
			avatar: data.avatar,
			epub: data.epub
		};

		this.peerCache.set(pub, peer);
		return peer;
	}

	private async getCallChannelId(peer: CallPeer) {
		const cached = this.callChannelIds.get(peer.pub);
		if (cached) return cached;

		if (!this.user?._.sea) throw new Error("Not signed in.");

		const secret = await SEA.secret(peer.epub, this.user._.sea);
		if (!secret) throw new Error("Could not derive the call channel key.");

		const channelId = await SEA.work(`amber/call/v1:${secret}`, null, null, {
			name: "SHA-256"
		});

		if (!channelId) throw new Error("Could not derive the call channel ID.");

		this.callChannelIds.set(peer.pub, channelId);
		return channelId;
	}

	private async ensureCallChannel(peer: CallPeer) {
		const existing = this.callChannelSubs.get(peer.pub);
		if (existing) return existing;

		if (!this.gun) throw new Error("Not connected to Gun.");

		const channelId = await this.getCallChannelId(peer);

		const current = this.callChannelSubs.get(peer.pub);
		if (current) return current;
		if (!this.gun) throw new Error("Not connected to Gun.");

		const chain = this.gun.get(`calls/${channelId}`).map();

		chain.on((value, key) => {
			void this.handleSignal(value, key, peer, channelId);
		});

		const subscription = {
			off: () => chain.off(),
			channelId
		};
		this.callChannelSubs.set(peer.pub, subscription);
		return subscription;
	}

	private async syncCallChannels() {
		if (!this.gun || !this.user?._.sea) return;

		if (this.syncingChannels) {
			this.channelSyncPending = true;
			return;
		}

		this.syncingChannels = true;

		try {
			const friends = new Set(this.friendPubs);

			for (const [pub, subscription] of this.callChannelSubs) {
				if (!friends.has(pub)) {
					subscription.off();
					this.callChannelSubs.delete(pub);
					this.callChannelIds.delete(pub);
					this.peerCache.delete(pub);
				}
			}

			for (const pub of friends) {
				if (this.callChannelSubs.has(pub)) continue;
				if (!this.friendPubs.includes(pub)) continue;

				try {
					const peer = await this.getPeer(pub);

					if (!this.friendPubs.includes(pub)) continue;
					if (this.callChannelSubs.has(pub)) continue;

					await this.ensureCallChannel(peer);
				} catch (error) {
					console.error("Could not subscribe to call channel", pub, error);
				}
			}
		} finally {
			this.syncingChannels = false;

			if (this.channelSyncPending) {
				this.channelSyncPending = false;
				void this.syncCallChannels();
			}
		}
	}

	private getIceServers(): RTCIceServer[] {
		const servers: RTCIceServer[] = [
			{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
		];

		if (env.PUBLIC_TURN_URL) {
			servers.push({
				urls: env.PUBLIC_TURN_URL.split(",").map((url) => url.trim()).filter(Boolean),
				username: env.PUBLIC_TURN_USERNAME,
				credential: env.PUBLIC_TURN_CREDENTIAL
			});
		}

		return servers;
	}

	private createPeerConnection() {
		const pc = new RTCPeerConnection({ iceServers: this.getIceServers() });
		this.pc = pc;

		pc.ontrack = (event) => {
			this.remoteStream = event.streams[0] ?? new MediaStream([event.track]);
		};

		pc.onicecandidate = (event) => {
			if (!event.candidate) return;

			const candidate = event.candidate.toJSON();

			if (!this.canSendCandidates) {
				this.localCandidates.push(candidate);
				return;
			}

			void this.sendSignal("candidate", { candidate });
		};

		pc.onconnectionstatechange = () => {
			if (pc.connectionState === "connected") {
				this.clearTimers();
				this.startedAt = Date.now();
				this.status = "active";
			} else if (pc.connectionState === "failed") {
				this.fail(new Error("The call connection failed."));
			}
		};

		return pc;
	}

	private async flushCandidates() {
		if (!this.pc) return;

		const candidates = this.pendingCandidates;
		this.pendingCandidates = [];

		for (const candidate of candidates) {
			try {
				await this.pc.addIceCandidate(candidate);
			} catch {
				// a failed candidate should not break the call
			}
		}
	}

	private async flushLocalCandidates() {
		const candidates = this.localCandidates;
		this.localCandidates = [];

		for (const candidate of candidates) {
			try {
				await this.sendSignal("candidate", { candidate });
			} catch {
				// a failed candidate should not break the call
			}
		}
	}

	private async sendSignal(type: CallSignalType, payload: SignalPayload) {
		if (!this.peer || !this.callId) return;

		await this.sendSignalTo(this.peer, this.callId, type, payload);
	}

	private async sendSignalTo(
		peer: CallPeer,
		callId: string,
		type: CallSignalType,
		payload: SignalPayload
	) {
		if (!this.user?._.sea || !this.gun || !this.userPub) return;

		const secret = await SEA.secret(peer.epub, this.user._.sea);
		if (!secret) throw new Error("Could not derive the call encryption key.");

		const encrypted = await SEA.encrypt(
			JSON.stringify({ ...payload, sender: this.userPub }),
			{ epriv: secret }
		);
		if (!encrypted) throw new Error("Could not encrypt the call signal.");

		const channelId = await this.getCallChannelId(peer);
		const record: SignalRecord = {
			v: 1,
			callId,
			type,
			payload: encrypted,
			ts: Date.now()
		};

		await this.gun
			.get(`calls/${channelId}`)
			.get(`${callId}:${createId()}`)
			.put(JSON.stringify(record))
			.then();
	}

	private async decryptSignal(record: SignalRecord, peerEpub: string) {
		if (!this.user?._.sea) return;

		const secret = await SEA.secret(peerEpub, this.user._.sea);
		if (!secret) return;

		const decrypted = await SEA.decrypt(record.payload, { epriv: secret });

		if (typeof decrypted === "string") {
			try {
				return JSON.parse(decrypted) as SignalPayload;
			} catch {
				return;
			}
		}

		if (decrypted && typeof decrypted === "object") {
			return decrypted as SignalPayload;
		}

		return;
	}

	private async handleSignal(
		value: unknown,
		key: string,
		peer: CallPeer,
		channelId: string
	) {
		if (typeof value !== "string") return;
		if (this.seenSignals.has(key)) return;

		let record: SignalRecord;

		try {
			const parsed: unknown = JSON.parse(value);
			if (!isSignalRecord(parsed)) return;
			record = parsed;
		} catch {
			return;
		}

		this.seenSignals.add(key);

		let deleteRecord = true;

		try {
			const payload = await this.decryptSignal(record, peer.epub);

			if (!payload) {
				return;
			}

			// Both peers subscribe to the same shared channel. Ignore our own
			// writes and leave them for the other participant to consume.
			if (payload.sender === this.userPub) {
				deleteRecord = false;
				return;
			}

			if (record.type === "offer") {
				if (this.cancelledCalls.has(record.callId)) {
					this.cancelledCalls.delete(record.callId);
					return;
				}

				if (Date.now() - record.ts > 2 * 60 * 1000) {
					return;
				}

				await this.handleOffer(record, peer, payload);
				return;
			}

			if (
				(record.type === "hangup" || record.type === "reject") &&
				record.callId !== this.callId
			) {
				// The caller may cancel before the offer arrives at the callee.
				this.rememberCancelled(record.callId);
				return;
			}

			if (
				!this.callId ||
				record.callId !== this.callId ||
				!this.peer ||
				this.peer.pub !== peer.pub
			) {
				return;
			}

			if (record.type === "answer") {
				if (!this.pc || this.direction !== "outgoing" || !payload.sdp) return;

				await this.pc.setRemoteDescription(payload.sdp);
				this.remoteDescriptionSet = true;
				await this.flushCandidates();
				this.status = "connecting";
			} else if (record.type === "candidate") {
				if (!payload.candidate) return;

				if (this.remoteDescriptionSet && this.pc) {
					try {
						await this.pc.addIceCandidate(payload.candidate);
					} catch {
						// ignore stale candidates
					}
				} else {
					this.pendingCandidates.push(payload.candidate);
				}
			} else if (record.type === "reject") {
				this.error = "Call declined.";
				this.cleanup();
			} else if (record.type === "hangup") {
				this.cleanup();
			}
		} catch (error) {
			console.error("[call] signal failed", error);
		} finally {
			if (deleteRecord) {
				void this.deleteSignal(channelId, key);
			}
		}
	}

	private async handleOffer(record: SignalRecord, peer: CallPeer, payload: SignalPayload) {
		if (!(await this.verifyFriend(peer.pub))) {
			return;
		}

		if (!payload.sdp) return;

		if (this.status !== "idle") {
			if (record.callId !== this.callId) {
				try {
					await this.sendSignalTo(peer, record.callId, "reject", { reason: "busy" });
				} catch {
					// best effort
				}
			}
			return;
		}

		this.error = undefined;
		this.peer = peer;
		this.callId = record.callId;
		this.kind = payload.kind === "video" ? "video" : "audio";
		this.direction = "incoming";
		this.pendingOffer = payload.sdp;
		this.pendingCandidates = [];
		this.remoteDescriptionSet = false;
		this.status = "incoming";

		this.clearTimers();
		this.incomingTimer = setTimeout(() => {
			if (this.status === "incoming" && this.callId === record.callId) {
				void this.reject();
			}
		}, 45_000);
	}

	private async deleteSignal(channelId: string, key: string) {
		if (!this.gun) return;

		try {
			await this.gun.get(`calls/${channelId}`).get(key).put(null).then();
		} catch {
			// best effort
		}
	}

	private rememberCancelled(callId: string) {
		const now = Date.now();
		this.cancelledCalls.set(callId, now);

		for (const [id, timestamp] of this.cancelledCalls) {
			if (now - timestamp > 2 * 60 * 1000) {
				this.cancelledCalls.delete(id);
			}
		}
	}

	private resetCallState() {
		this.pendingOffer = undefined;
		this.pendingCandidates = [];
		this.localCandidates = [];
		this.remoteDescriptionSet = false;
		this.canSendCandidates = false;
		this.remoteStream = undefined;
		this.startedAt = undefined;
		this.muted = false;
		this.cameraOff = false;
	}

	private cleanup() {
		this.clearTimers();

		if (this.pc) {
			this.pc.onicecandidate = null;
			this.pc.ontrack = null;
			this.pc.onconnectionstatechange = null;
			this.pc.close();
			this.pc = undefined;
		}

		for (const track of this.localStream?.getTracks() ?? []) {
			track.stop();
		}

		this.localStream = undefined;
		this.remoteStream = undefined;
		this.pendingOffer = undefined;
		this.pendingCandidates = [];
		this.localCandidates = [];
		this.remoteDescriptionSet = false;
		this.canSendCandidates = false;
		this.callId = undefined;
		this.peer = undefined;
		this.status = "idle";
		this.startedAt = undefined;
		this.muted = false;
		this.cameraOff = false;
	}

	private clearTimers() {
		if (this.outgoingTimer) {
			clearTimeout(this.outgoingTimer);
			this.outgoingTimer = undefined;
		}

		if (this.incomingTimer) {
			clearTimeout(this.incomingTimer);
			this.incomingTimer = undefined;
		}
	}

	private fail(error: unknown) {
		this.error = error instanceof Error ? error.message : String(error);
		this.cleanup();
	}
}

export const callManager = new CallManager();
