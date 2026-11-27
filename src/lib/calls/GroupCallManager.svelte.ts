import Gun from "gun";
import { env } from "$env/dynamic/public";
import {
	createGun,
	ensureUserLogged,
	fetchProfile,
	getUser,
	gunData,
	type User
} from "../gun/Gun.svelte";
import {
	clearGroupCall,
	groupCallChannelId,
	groupCallMemberTag,
	groupCallToTag,
	listGroupBackups,
	loadGroupBackup,
	readGroupCall,
	writeGroupCall
} from "../gun/Group/Group";
import {
	keyHint,
	open,
	seal,
	sha256,
	signCanonical,
	splitHint,
	verifyCanonical
} from "../gun/Group/crypto";
import type { GroupBackup, GroupCallRecord } from "../gun/Group/types";
import { displayNameOf } from "$lib/profile";

export type GroupCallKind = "audio" | "video";
export type GroupCallStatus = "idle" | "incoming" | "outgoing" | "connecting" | "active";
export type GroupCallDirection = "incoming" | "outgoing";

export interface GroupCallParticipant {
	pub: string;
	alias: string;
	displayName?: string;
	avatar?: string;
	stream?: MediaStream;
	hasVideo: boolean;
	connectionState?: RTCPeerConnectionState;
}

export interface IncomingGroupCall {
	gid: string;
	name: string;
	callId: string;
	kind: GroupCallKind;
	startedBy: string;
	startedByName: string;
	startedByAvatar?: string;
}

interface Presence {
	v: 1;
	gid: string;
	callId: string;
	pub: string;
	joinedAt: number;
	kind: GroupCallKind;
	sig: string;
}

interface SignalRecord {
	v: 1;
	gid: string;
	callId: string;
	from: string;
	to: string;
	type: "offer" | "answer" | "candidate" | "hangup";
	payload: string;
	ts: number;
	sig: string;
}

interface SignalPayload {
	sdp?: RTCSessionDescriptionInit;
	candidate?: RTCIceCandidateInit;
}

interface PeerState {
	pub: string;
	pc: RTCPeerConnection;
	stream: MediaStream;
	polite: boolean;
	makingOffer: boolean;
	ignoreOffer: boolean;
	allowNegotiation: boolean;
	remoteDescriptionSet: boolean;
	pendingCandidates: RTCIceCandidateInit[];
}

function createId() {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}

	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function presenceCanonical(presence: Presence) {
	return `amber/group-call-presence/v1:${presence.gid}:${presence.callId}:${presence.pub}:${presence.joinedAt}:${presence.kind}`;
}

function callCanonical(record: GroupCallRecord) {
	return `amber/group-call/v1:${record.gid}:${record.callId}:${record.epoch}:${record.kind}:${record.startedBy}:${record.startedAt}:${record.active}`;
}

function mediaConstraints(kind: GroupCallKind): MediaStreamConstraints {
	return kind === "video"
		? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } }
		: { audio: true, video: false };
}

export class GroupCallManager {
	status = $state<GroupCallStatus>("idle");
	direction = $state<GroupCallDirection>("outgoing");
	gid = $state<string>();
	groupName = $state("");
	callId = $state<string>();
	kind = $state<GroupCallKind>("audio");
	startedAt = $state<number>();
	muted = $state(false);
	cameraOn = $state(false);
	screenSharing = $state(false);
	error = $state<string>();
	participants = $state<Record<string, GroupCallParticipant>>({});
	localStream = $state<MediaStream>();
	incoming = $state<IncomingGroupCall>();

	hasVideo = $derived(
		Object.values(this.participants).some((participant) => participant.hasVideo)
	);

	private user?: User;
	private gun?: ReturnType<typeof createGun>;
	private userPub?: string;
	private backup?: GroupBackup;
	private callSecret?: string;
	private epoch?: number;
	private startedBy?: string;
	private selfJoinedAt = 0;
	private selfToTag?: string;
	private peers = new Map<string, PeerState>();
	private presence = new Map<string, Presence>();
	private tagToPub = new Map<string, string>();
	private seenSignals = new Set<string>();
	private callRecordOffs = new Map<string, () => void>();
	private channelOffs: (() => void)[] = [];
	private reloading = false;
	private reloadPending = false;
	private generation = 0;
	private screenStream?: MediaStream;
	private cameraTrack?: MediaStreamTrack;

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

		void this.reload().catch((error) => {
			console.error("[group-call] subscription reload failed", error);
		});
	}

	async reload() {
		if (!this.gun) return;
		if (this.reloading) {
			this.reloadPending = true;
			return;
		}

		this.reloading = true;
		const generation = this.generation;

		try {
			for (const off of this.callRecordOffs.values()) off();
			this.callRecordOffs.clear();

			const backups = await listGroupBackups();
			if (!this.gun || generation !== this.generation) return;

			for (const backup of backups) {
				const chain = this.gun.get(`groups/${backup.gid}/call`);

				chain.on((value) => {
					void this.handleCallRecord(backup.gid, value).catch((error) => {
						console.error("[group-call] call record failed", error);
					});
				});

				this.callRecordOffs.set(backup.gid, () => {
					try {
						chain.off();
					} catch {
						// no-op
					}
				});
			}
		} finally {
			this.reloading = false;

			if (this.reloadPending) {
				this.reloadPending = false;
				void this.reload().catch((error) => {
					console.error("[group-call] subscription reload failed", error);
				});
			}
		}
	}

	destroy() {
		this.generation += 1;

		for (const off of this.callRecordOffs.values()) off();
		this.callRecordOffs.clear();

		this.cleanup();

		this.user = undefined;
		this.gun = undefined;
		this.userPub = undefined;
		this.incoming = undefined;
		this.error = undefined;
		this.status = "idle";
	}

	async startCall(gid: string, kind: GroupCallKind) {
		this.error = undefined;

		if (!this.user || !this.gun || !this.userPub) {
			this.error = "You need to be signed in to start a group call.";
			return;
		}

		if (this.status !== "idle") {
			this.error = "You are already in a call.";
			return;
		}

		try {
			const backup = await loadGroupBackup(gid);
			if (!backup) throw new Error("You are not a member of this group.");
			if (!this.user || !this.gun || !this.userPub) {
				throw new Error("You need to be signed in to start a group call.");
			}

			const epoch = backup.currentEpoch;
			const key = backup.keys[epoch];
			if (!key) throw new Error("The current group key is missing.");

			const callId = createId();
			const callSecret = await sha256(`amber/group-call/v1:${gid}:${key}:${callId}`);

			this.resetCallState();
			this.backup = backup;
			this.gid = gid;
			this.groupName = backup.name;
			this.callId = callId;
			this.kind = kind;
			this.direction = "outgoing";
			this.epoch = epoch;
			this.callSecret = callSecret;
			this.startedBy = this.userPub;
			this.selfJoinedAt = Gun.state();
			this.localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints(kind));
			this.cameraOn = kind === "video";
			this.addSelfParticipant();

			const record = await writeGroupCall(backup, {
				v: 1,
				gid,
				callId,
				epoch,
				kind,
				startedBy: this.userPub,
				startedAt: Date.now(),
				active: true,
				sig: ""
			});

			this.startedAt = record.startedAt;
			await this.writePresence();
			await this.subscribeChannel();

			this.status = "active";
			this.incoming = undefined;
			this.syncParticipants();
		} catch (error) {
			this.fail(error);
		}
	}

	async joinCall(gid: string) {
		this.error = undefined;

		if (!this.user || !this.gun || !this.userPub) {
			this.error = "You need to be signed in to join a group call.";
			return;
		}

		if (this.status !== "idle" && this.gid !== gid) {
			this.error = "You are already in a call.";
			return;
		}

		try {
			const backup = await loadGroupBackup(gid);
			if (!backup) throw new Error("You are not a member of this group.");
			if (!this.user || !this.gun || !this.userPub) {
				throw new Error("You need to be signed in to join a group call.");
			}

			const record = await readGroupCall(backup);
			if (!record?.active) throw new Error("This group call is no longer active.");
			if (record.epoch !== backup.currentEpoch) {
				throw new Error("This call was started before the group key rotated.");
			}
			if (!backup.roster.members.some((member) => member.pub === record.startedBy)) {
				throw new Error("The caller is no longer a member of this group.");
			}

			const key = backup.keys[record.epoch];
			if (!key) throw new Error("The group key for this call is missing.");

			const callSecret = await sha256(
				`amber/group-call/v1:${gid}:${key}:${record.callId}`
			);

			this.resetCallState();
			this.backup = backup;
			this.gid = gid;
			this.groupName = backup.name;
			this.callId = record.callId;
			this.kind = record.kind;
			this.direction = record.startedBy === this.userPub ? "outgoing" : "incoming";
			this.epoch = record.epoch;
			this.callSecret = callSecret;
			this.startedBy = record.startedBy;
			this.startedAt = record.startedAt;
			this.selfJoinedAt = Gun.state();
			this.localStream = await navigator.mediaDevices.getUserMedia(
				mediaConstraints(record.kind)
			);
			this.cameraOn = record.kind === "video";
			this.addSelfParticipant();

			await this.writePresence();
			await this.subscribeChannel();

			this.status = "connecting";
			this.incoming = undefined;
			this.syncParticipants();
		} catch (error) {
			this.fail(error);
		}
	}

	async accept() {
		if (!this.incoming) return;
		await this.joinCall(this.incoming.gid);
	}

	decline() {
		this.incoming = undefined;
	}

	async leaveCall() {
		if (this.status === "idle") return;

		const gid = this.gid;
		const hadRemote = [...this.presence.keys()].some((pub) => pub !== this.userPub);

		for (const peer of this.peers.values()) {
			try {
				await this.sendSignal(peer.pub, "hangup", {});
			} catch {
				// best effort
			}
		}

		await this.removePresence();

		if (!hadRemote && gid) {
			try {
				await clearGroupCall(gid);
			} catch {
				// best effort
			}
		}

		this.cleanup();
		this.status = "idle";
	}

	toggleMute() {
		this.muted = !this.muted;

		for (const track of this.localStream?.getAudioTracks() ?? []) {
			track.enabled = !this.muted;
		}
	}

	async toggleVideo() {
		if (this.screenSharing) {
			await this.stopScreenShare();
			return;
		}

		const videoTracks = this.localStream?.getVideoTracks() ?? [];

		if (videoTracks.length > 0) {
			for (const track of videoTracks) track.stop();

			if (this.localStream) {
				for (const track of videoTracks) this.localStream.removeTrack(track);
			}

			for (const peer of this.peers.values()) {
				for (const sender of peer.pc.getSenders()) {
					if (sender.track?.kind === "video") peer.pc.removeTrack(sender);
				}
			}

			this.cameraOn = false;
			this.cameraTrack = undefined;
			this.updateSelfParticipant();
			return;
		}

		try {
			const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
			const track = media.getVideoTracks()[0];
			if (!track) return;

			this.cameraTrack = track;
			this.localStream?.addTrack(track);
			this.cameraOn = true;

			for (const peer of this.peers.values()) {
				peer.pc.addTrack(track, this.localStream ?? media);
			}

			this.updateSelfParticipant();
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		}
	}

	async startScreenShare() {
		if (this.screenSharing) return;

		try {
			const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
			const track = display.getVideoTracks()[0];
			if (!track) return;

			this.screenStream = display;
			this.screenSharing = true;

			track.onended = () => {
				void this.stopScreenShare();
			};

			for (const peer of this.peers.values()) {
				const sender = peer.pc.getSenders().find((entry) => entry.track?.kind === "video");

				if (sender) {
					await sender.replaceTrack(track);
				} else {
					peer.pc.addTrack(track, display);
				}
			}

			this.updateSelfParticipant();
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		}
	}

	async stopScreenShare() {
		if (!this.screenSharing) return;

		for (const track of this.screenStream?.getTracks() ?? []) track.stop();
		this.screenStream = undefined;
		this.screenSharing = false;

		for (const peer of this.peers.values()) {
			const sender = peer.pc.getSenders().find((entry) => entry.track?.kind === "video");

			if (!sender) continue;

			if (this.cameraTrack) {
				await sender.replaceTrack(this.cameraTrack);
			} else {
				peer.pc.removeTrack(sender);
			}
		}

		this.updateSelfParticipant();
	}

	private async handleCallRecord(gid: string, value: unknown) {
		if (this.status !== "idle") {
			if (this.incoming?.gid === gid) this.incoming = undefined;
			return;
		}

		if (typeof value !== "string") {
			if (this.incoming?.gid === gid) this.incoming = undefined;
			return;
		}

		const backup = await loadGroupBackup(gid);
		if (!backup) return;

		const split = splitHint(value);
		if (!split) return;

		for (const [epoch, key] of Object.entries(backup.keys)) {
			if ((await keyHint(key)) !== split.hint) continue;

			const record = await open<GroupCallRecord>(split.payload, key);
			if (!record || record.gid !== gid || record.epoch !== Number(epoch)) return;
			if (record.epoch !== backup.currentEpoch) return;
			if (!backup.roster.members.some((member) => member.pub === record.startedBy)) {
				return;
			}
			if (!(await verifyCanonical(record.sig, record.startedBy, callCanonical(record)))) {
				return;
			}

			if (!record.active || record.startedBy === this.userPub) {
				if (this.incoming?.gid === gid) this.incoming = undefined;
				return;
			}

			const starter = await fetchProfile(record.startedBy);

			this.incoming = {
				gid,
				name: backup.name,
				callId: record.callId,
				kind: record.kind,
				startedBy: record.startedBy,
				startedByName: displayNameOf(starter),
				startedByAvatar: starter?.avatar
			};
			return;
		}
	}

	private async writePresence() {
		const pair = this.user?._.sea;
		if (!this.gun || !pair || !this.callSecret || !this.gid || !this.callId) return;

		const tag = await groupCallMemberTag(this.gid, this.callId, pair.pub);
		const presence: Presence = {
			v: 1,
			gid: this.gid,
			callId: this.callId,
			pub: pair.pub,
			joinedAt: this.selfJoinedAt,
			kind: this.kind,
			sig: ""
		};

		presence.sig = await signCanonical(presenceCanonical(presence), pair);

		const channelId = await groupCallChannelId(this.gid, this.callId);
		const cipher = await seal(presence, this.callSecret);

		await this.gun
			.get(`calls/groups/${channelId}/participants/${tag}`)
			.put(cipher)
			.then();

		this.presence.set(presence.pub, presence);
		this.tagToPub.set(tag, presence.pub);
	}

	private async removePresence() {
		if (!this.gun || !this.gid || !this.callId || !this.userPub) return;

		const tag = await groupCallMemberTag(this.gid, this.callId, this.userPub);
		const channelId = await groupCallChannelId(this.gid, this.callId);

		try {
			await this.gun.get(`calls/groups/${channelId}/participants/${tag}`).put(null).then();
		} catch {
			// best effort
		}

		this.presence.delete(this.userPub);
	}

	private async subscribeChannel() {
		if (!this.gun || !this.gid || !this.callId || !this.callSecret || !this.userPub) return;

		for (const off of this.channelOffs) off();
		this.channelOffs = [];

		const channelId = await groupCallChannelId(this.gid, this.callId);
		const selfTag = await groupCallToTag(this.gid, this.callId, this.userPub);
		this.selfToTag = selfTag;

		const presenceChain = this.gun
			.get(`calls/groups/${channelId}/participants`)
			.map();

		presenceChain.on((value, key) => {
			void this.handlePresence(value, key).catch((error) => {
				console.error("[group-call] presence failed", error);
			});
		});

		this.channelOffs.push(() => {
			try {
				presenceChain.off();
			} catch {
				// no-op
			}
		});

		const signalChain = this.gun
			.get(`calls/groups/${channelId}/signals/${selfTag}`)
			.map();

		signalChain.on((value, key) => {
			void this.handleSignalRecord(value, key).catch((error) => {
				console.error("[group-call] signal failed", error);
			});
		});

		this.channelOffs.push(() => {
			try {
				signalChain.off();
			} catch {
				// no-op
			}
		});
	}

	private async isMember(pub: string) {
		if (this.backup?.roster.members.some((member) => member.pub === pub)) return true;
		if (!this.gid) return false;

		const fresh = await loadGroupBackup(this.gid);
		if (fresh) this.backup = fresh;

		return !!this.backup?.roster.members.some((member) => member.pub === pub);
	}

	private async handlePresence(value: unknown, key: string) {
		if (!this.callSecret) return;

		if (typeof value !== "string") {
			const pub = this.tagToPub.get(key);
			if (pub && pub !== this.userPub) this.removePeer(pub);
			return;
		}

		const presence = await open<Presence>(value, this.callSecret);
		if (!presence || presence.gid !== this.gid || presence.callId !== this.callId) {
			return;
		}

		if (!(await verifyCanonical(presence.sig, presence.pub, presenceCanonical(presence)))) {
			return;
		}

		if (!(await this.isMember(presence.pub))) {
			return;
		}

		this.tagToPub.set(key, presence.pub);
		this.presence.set(presence.pub, presence);

		if (presence.pub === this.userPub) return;

		const profile = await fetchProfile(presence.pub);
		this.updateParticipant(presence.pub, {
			alias: profile?.alias ?? presence.pub,
			displayName: profile?.displayName,
			avatar: profile?.avatar
		});

		this.syncParticipants();
	}

	private async handleSignalRecord(value: unknown, key: string) {
		if (!this.callSecret || !this.userPub || !this.gid || !this.callId) return;
		if (typeof value !== "string") return;
		if (this.seenSignals.has(key)) return;

		let record: SignalRecord;

		try {
			record = JSON.parse(value) as SignalRecord;
		} catch {
			return;
		}

		if (record.to !== this.userPub || record.callId !== this.callId || record.gid !== this.gid) {
			return;
		}

		if (!(await this.isMember(record.from))) {
			return;
		}

		this.seenSignals.add(key);

		try {
			const plain = await open<SignalPayload>(record.payload, this.callSecret);
			if (!plain) return;

			const canonical = `amber/group-call-signal/v1:${record.gid}:${record.callId}:${
				record.from
			}:${record.to}:${record.type}:${await sha256(record.payload)}`;

			if (!(await verifyCanonical(record.sig, record.from, canonical))) return;

			await this.handleSignal(record, plain);
		} finally {
			await this.deleteSignal(key);
		}
	}

	private async handleSignal(record: SignalRecord, payload: SignalPayload) {
		if (record.type === "hangup") {
			this.removePeer(record.from);
			return;
		}

		const peer = this.peers.get(record.from) ?? this.createPeer(record.from, false);

		if (record.type === "offer") {
			if (!payload.sdp) return;

			const collision = peer.makingOffer || peer.pc.signalingState !== "stable";
			peer.ignoreOffer = !peer.polite && collision;

			if (peer.ignoreOffer) return;

			if (collision) {
				await peer.pc.setLocalDescription({ type: "rollback" });
			}

			await peer.pc.setRemoteDescription(payload.sdp);
			peer.remoteDescriptionSet = true;
			await this.flushCandidates(peer);

			const answer = await peer.pc.createAnswer();
			await peer.pc.setLocalDescription(answer);
			await this.sendSignal(record.from, "answer", {
				sdp: peer.pc.localDescription ?? undefined
			});
			peer.allowNegotiation = true;
			return;
		}

		if (record.type === "answer") {
			if (!payload.sdp) return;

			await peer.pc.setRemoteDescription(payload.sdp);
			peer.remoteDescriptionSet = true;
			await this.flushCandidates(peer);
			peer.allowNegotiation = true;
			return;
		}

		if (record.type === "candidate") {
			if (!payload.candidate) return;

			if (peer.remoteDescriptionSet) {
				try {
					await peer.pc.addIceCandidate(payload.candidate);
				} catch {
					// ignore stale candidates
				}
			} else {
				peer.pendingCandidates.push(payload.candidate);
			}
		}
	}

	private createPeer(pub: string, initiator: boolean) {
		if (!this.userPub) throw new Error("Not signed in.");

		const existing = this.peers.get(pub);
		if (existing) return existing;

		const pc = new RTCPeerConnection({ iceServers: this.getIceServers() });
		const stream = new MediaStream();

		const peer: PeerState = {
			pub,
			pc,
			stream,
			polite: this.userPub > pub,
			makingOffer: false,
			ignoreOffer: false,
			allowNegotiation: initiator,
			remoteDescriptionSet: false,
			pendingCandidates: []
		};

		for (const track of this.localStream?.getAudioTracks() ?? []) {
			pc.addTrack(track, this.localStream!);
		}

		const screenStream = this.screenStream;
		const screenTrack = this.screenSharing ? screenStream?.getVideoTracks()[0] : undefined;

		if (screenTrack && screenStream) {
			pc.addTrack(screenTrack, screenStream);
		} else {
			for (const track of this.localStream?.getVideoTracks() ?? []) {
				pc.addTrack(track, this.localStream!);
			}
		}

		pc.ontrack = (event) => {
			stream.addTrack(event.track);
			this.updateParticipant(pub, {
				stream,
				hasVideo: stream.getVideoTracks().length > 0
			});

			event.track.onended = () => {
				this.updateParticipant(pub, {
					hasVideo: stream.getVideoTracks().some((track) => track.readyState === "live")
				});
			};
		};

		pc.onicecandidate = (event) => {
			if (!event.candidate) return;
			void this.sendSignal(pub, "candidate", { candidate: event.candidate.toJSON() });
		};

		pc.onconnectionstatechange = () => {
			this.updateParticipant(pub, { connectionState: pc.connectionState });

			if (pc.connectionState === "connected") {
				this.status = "active";
				if (!this.startedAt) this.startedAt = Date.now();
			} else if (pc.connectionState === "failed") {
				this.removePeer(pub);
			}
		};

		pc.onnegotiationneeded = async () => {
			if (!peer.allowNegotiation || peer.makingOffer) return;

			peer.makingOffer = true;

			try {
				await pc.setLocalDescription();
				await this.sendSignal(pub, "offer", { sdp: pc.localDescription ?? undefined });
			} catch (error) {
				console.error("[group-call] renegotiation failed", error);
			} finally {
				peer.makingOffer = false;
			}
		};

		this.peers.set(pub, peer);
		this.updateParticipant(pub, {});
		return peer;
	}

	private syncParticipants() {
		if (!this.userPub) return;

		for (const presence of this.presence.values()) {
			if (presence.pub === this.userPub) continue;
			if (this.peers.has(presence.pub)) continue;

			const shouldInitiate =
				this.selfJoinedAt > presence.joinedAt ||
				(Math.abs(this.selfJoinedAt - presence.joinedAt) <= 1000 &&
					this.userPub < presence.pub);

			if (shouldInitiate) {
				this.createPeer(presence.pub, true);
			}
		}
	}

	private async flushCandidates(peer: PeerState) {
		const candidates = peer.pendingCandidates;
		peer.pendingCandidates = [];

		for (const candidate of candidates) {
			try {
				await peer.pc.addIceCandidate(candidate);
			} catch {
				// ignore stale candidates
			}
		}
	}

	private async sendSignal(to: string, type: SignalRecord["type"], payload: SignalPayload) {
		const pair = this.user?._.sea;

		if (
			!this.gun ||
			!pair ||
			!this.userPub ||
			!this.gid ||
			!this.callId ||
			!this.callSecret
		) {
			return;
		}

		const cipher = await seal(payload, this.callSecret);
		const ts = Date.now();
		const canonical = `amber/group-call-signal/v1:${this.gid}:${this.callId}:${
			this.userPub
		}:${to}:${type}:${await sha256(cipher)}`;
		const sig = await signCanonical(canonical, pair);

		const record: SignalRecord = {
			v: 1,
			gid: this.gid,
			callId: this.callId,
			from: this.userPub,
			to,
			type,
			payload: cipher,
			ts,
			sig
		};

		const channelId = await groupCallChannelId(this.gid, this.callId);
		const toTag = await groupCallToTag(this.gid, this.callId, to);
		const fromTag = await groupCallToTag(this.gid, this.callId, this.userPub);

		await this.gun
			.get(`calls/groups/${channelId}/signals/${toTag}`)
			.get(`${fromTag}#${Gun.state()}`)
			.put(JSON.stringify(record))
			.then();
	}

	private async deleteSignal(key: string) {
		if (!this.gun || !this.gid || !this.callId || !this.selfToTag) return;

		const channelId = await groupCallChannelId(this.gid, this.callId);

		try {
			await this.gun
				.get(`calls/groups/${channelId}/signals/${this.selfToTag}`)
				.get(key)
				.put(null)
				.then();
		} catch {
			// best effort
		}
	}

	private addSelfParticipant() {
		if (!this.userPub) return;

		this.participants = {
			...this.participants,
			[this.userPub]: {
				pub: this.userPub,
				alias: gunData.user?.alias ?? this.userPub,
				displayName: gunData.user?.displayName,
				avatar: gunData.user?.avatar,
				stream: this.localStream,
				hasVideo: (this.localStream?.getVideoTracks().length ?? 0) > 0,
				connectionState: "connected"
			}
		};
	}

	private updateSelfParticipant() {
		if (!this.userPub) return;

		this.participants = {
			...this.participants,
			[this.userPub]: {
				pub: this.userPub,
				alias: gunData.user?.alias ?? this.userPub,
				displayName: gunData.user?.displayName,
				avatar: gunData.user?.avatar,
				stream: this.screenStream ?? this.localStream,
				hasVideo: (this.localStream?.getVideoTracks().length ?? 0) > 0 || this.screenSharing,
				connectionState: "connected"
			}
		};
	}

	private updateParticipant(pub: string, patch: Partial<GroupCallParticipant>) {
		const existing = this.participants[pub] ?? {
			pub,
			alias: pub,
			hasVideo: false
		};

		this.participants = {
			...this.participants,
			[pub]: {
				...existing,
				...patch
			}
		};
	}

	private removePeer(pub: string) {
		const peer = this.peers.get(pub);
		if (peer) {
			peer.pc.onicecandidate = null;
			peer.pc.ontrack = null;
			peer.pc.onconnectionstatechange = null;
			peer.pc.onnegotiationneeded = null;
			peer.pc.close();
			this.peers.delete(pub);
		}

		const participants = { ...this.participants };
		delete participants[pub];
		this.participants = participants;
	}

	private getIceServers(): RTCIceServer[] {
		const servers: RTCIceServer[] = [
			{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
		];

		if (env.PUBLIC_TURN_URL) {
			servers.push({
				urls: env.PUBLIC_TURN_URL.split(",")
					.map((url) => url.trim())
					.filter(Boolean),
				username: env.PUBLIC_TURN_USERNAME,
				credential: env.PUBLIC_TURN_CREDENTIAL
			});
		}

		return servers;
	}

	private resetCallState() {
		this.participants = {};
		this.peers.clear();
		this.presence.clear();
		this.tagToPub.clear();
		this.seenSignals.clear();
		this.channelOffs = [];
		this.screenStream = undefined;
		this.cameraTrack = undefined;
		this.cameraOn = false;
		this.muted = false;
		this.screenSharing = false;
		this.startedAt = undefined;
		this.selfToTag = undefined;
		this.error = undefined;
	}

	private cleanup() {
		for (const off of this.channelOffs) off();
		this.channelOffs = [];

		for (const peer of this.peers.values()) {
			peer.pc.onicecandidate = null;
			peer.pc.ontrack = null;
			peer.pc.onconnectionstatechange = null;
			peer.pc.onnegotiationneeded = null;
			peer.pc.close();
		}

		for (const track of this.localStream?.getTracks() ?? []) track.stop();
		for (const track of this.screenStream?.getTracks() ?? []) track.stop();

		this.localStream = undefined;
		this.screenStream = undefined;
		this.cameraTrack = undefined;
		this.backup = undefined;
		this.callSecret = undefined;
		this.epoch = undefined;
		this.gid = undefined;
		this.callId = undefined;
		this.groupName = "";
		this.startedBy = undefined;
		this.startedAt = undefined;
		this.selfJoinedAt = 0;
		this.selfToTag = undefined;
		this.peers.clear();
		this.presence.clear();
		this.tagToPub.clear();
		this.seenSignals.clear();
		this.participants = {};
		this.muted = false;
		this.cameraOn = false;
		this.screenSharing = false;
	}

	private fail(error: unknown) {
		this.error = error instanceof Error ? error.message : String(error);
		this.cleanup();
		this.status = "idle";
	}
}

export const groupCallManager = new GroupCallManager();
