import Gun, { type LEXQuery } from "gun";
import { createGun, ensureUserLogged, getUser } from "../Gun.svelte";

const { SEA } = Gun;

export interface MessageFrozen {
	sig: string;
	from: string;
}

export interface ReplyReference {
	id: number;
	from: string;
	alias?: string;
	preview: string;
}

export interface MessageMeta {
	v: 2;
	replyTo?: ReplyReference;
	editOf?: {
		id: number;
		from: string;
	};
}

export interface MessageRaw {
	content: string; // encrypted
	meta?: string; // encrypted MessageMeta
}

export interface MessageFormatted {
	content: string; // decrypted
	author: {
		alias: string;
		pub: string;
		avatar?: string;
	};
	timestamp: number;
	replyTo?: ReplyReference;
	editedAt?: number;
}

export interface SendMessageOptions {
	replyTo?: MessageFormatted;
	editOf?: MessageFormatted;
}

export type GunCallback = (data: string | undefined, key: string) => unknown;

/**
 * Let's structure the Message sytem as follows
 * We can store message IDs in the frozen space tied to the user.
 * Also, we will store these in a stringified JSON format
 *
 *
 * sig: string
 * from: string
 *
 * Where sig is the signature of the user ID to make sure we don't have false data signed by someone else
 * and from is pointing to the pub of the userspace where the message is stored so that message cannot be tampered with
 */
export class DMChannel {
	peer: string;
	peerEnc?: string;
	messages = $state<MessageFormatted[]>([]);
	lastMessage?: number;
	currentMessagesCache = new Set<string>();
	private pendingMessageKeys = new Set<string>();
	private pendingEdits = new Map<string, { content: string; editedAt: number }>();
	private channelIdCache?: string;
	private secretCache?: string;
	private container?: HTMLDivElement;

	constructor(peerPub: string) {
		this.peer = peerPub;
	}

	private async getSecret() {
		if (this.secretCache) return this.secretCache;
		if (!this.peerEnc) throw new Error("Peer encryption key not loaded");

		const user = this.getUser();
		const secret = await SEA.secret(this.peerEnc, user._.sea);

		if (!secret) throw new Error("Could not derive the message encryption key");

		this.secretCache = secret;
		return secret;
	}

	private async getChannelId() {
		if (this.channelIdCache) return this.channelIdCache;

		const secret = await this.getSecret();
		const channelId = await SEA.work(`amber/dm/v1:${secret}`, null, null, {
			name: "SHA-256"
		});

		if (!channelId) throw new Error("Could not derive the message channel ID");

		this.channelIdCache = channelId;
		return channelId;
	}

	private async decryptMeta(raw: string | undefined, secret: string) {
		if (!raw) return;

		try {
			const decrypted = await SEA.decrypt(raw, { epriv: secret });
			const parsed =
				typeof decrypted === "string" ? JSON.parse(decrypted) : decrypted;

			if (!parsed || typeof parsed !== "object") return;
			if ((parsed as Partial<MessageMeta>).v !== 2) return;

			return parsed as MessageMeta;
		} catch {
			return;
		}
	}

	private trackLastMessage(timestamp: number) {
		if (!this.lastMessage || this.lastMessage > timestamp) {
			this.lastMessage = timestamp;
		}
	}

	private applyEdit(
		target: { id: number; from: string },
		from: string,
		content: string,
		editedAt: number,
		messageArray?: MessageFormatted[],
	) {
		if (target.from !== from) return;

		const arrays = messageArray ? [this.messages, messageArray] : [this.messages];

		for (const messages of arrays) {
			const existing = messages.find(
				(message) =>
					message.timestamp === target.id && message.author.pub === target.from,
			);

			if (!existing) continue;

			if ((existing.editedAt ?? 0) < editedAt) {
				existing.content = content;
				existing.editedAt = editedAt;
			}

			return;
		}

		const key = `${target.from}:${target.id}`;
		const pending = this.pendingEdits.get(key);

		if (!pending || pending.editedAt < editedAt) {
			this.pendingEdits.set(key, { content, editedAt });
		}
	}

	private applyPendingEdit(message: MessageFormatted) {
		const key = `${message.author.pub}:${message.timestamp}`;
		const pending = this.pendingEdits.get(key);

		if (!pending) return;

		if ((message.editedAt ?? 0) < pending.editedAt) {
			message.content = pending.content;
			message.editedAt = pending.editedAt;
		}

		this.pendingEdits.delete(key);
	}

	async fetchUserEpub() {
		if (this.peerEnc) return;
		const gun = createGun();

		const user = await gun.get<{ epub?: string }>(`~${this.peer}`).then();
		if (!user || !user.epub) throw new Error("No users with that ID found");

		this.peerEnc = user.epub;
	}

	private getUser() {
		const user = getUser();
		ensureUserLogged(user);
		return user;
	}

	async loadHistory() {
		const channelId = await this.getChannelId();

		return new Promise<MessageFormatted[]>((resolve, reject) => {
			if (!this.lastMessage) return reject(new Error("Fetch normal messages first"));
			const match: LEXQuery & { "%": number } = {
				".": {
					"-": 1,
					"<": this.lastMessage + "",
				},
				"%": 100,
			};

			const gun = createGun();

			const messages: MessageFormatted[] = []

			const chain = gun
				.get("chats/DMs/" + channelId)
				.get(match)
				.map();

			chain.once(this.createGunCallback(true, messages));

			setTimeout(() => {
				try {
					chain.off();
					resolve(messages);
				} catch (err) {
					reject(err);
				}
			}, 300)
		});
	}

	private createGunCallback(isLoadingOldMessage: false): GunCallback;
	private createGunCallback(
		isLoadingOldMessage: true,
		messageArray: MessageFormatted[],
	): GunCallback;
	private createGunCallback(
		isLoadingOldMessage: boolean,
		messageArray?: MessageFormatted[],
	): GunCallback {
		const handle = async (
			data: string | undefined,
			key: string,
			attempt = 0,
		) => {
			if (!data || typeof data !== "string") return;
			if (!this.peerEnc) return;
			if (this.currentMessagesCache.has(key) || this.pendingMessageKeys.has(key)) return;

			this.pendingMessageKeys.add(key);

			try {
				const secret = await this.getSecret();
				const channelId = await this.getChannelId();
				let jsonData: MessageFrozen | null = null;

				try {
					const decrypted = await SEA.decrypt(data, { epriv: secret });
					const parsed =
						typeof decrypted === "string" ? JSON.parse(decrypted) : decrypted;

					if (parsed && typeof parsed === "object") {
						const jsonFormatted = parsed as Partial<MessageFrozen>;

						if (jsonFormatted.from && jsonFormatted.sig) {
							jsonData = jsonFormatted as MessageFrozen;
						}
					}
				} catch {
					jsonData = null;
				}

				if (!jsonData) return;

				// verify the signature
				const sig = await SEA.verify(jsonData.sig, jsonData.from);

				if (!sig || sig !== "SIGNED_MESSAGE") return;
				const messageId = Number(key.split("#")[0]);

				if (!Number.isInteger(messageId)) return;

				const gun = createGun();

				const message = (await gun
					.get(`~${jsonData.from}`)
					.get("messages")
					.get(channelId)
					.get(messageId + "")
					.then()) as Partial<MessageRaw> | undefined;

				// The message content may not have synced yet. Do not cache the
				// index key, and retry a few times before giving up.
				if (!message || !message.content) {
					if (!isLoadingOldMessage && attempt < 4) {
						setTimeout(() => {
							void handle(data, key, attempt + 1);
						}, 750);
					}
					return;
				}

				const msg = message as MessageRaw;

				const content = await SEA.decrypt<string | undefined>(msg.content, {
					epriv: secret,
				});

				if (!content) {
					console.log("Error during decryption", SEA.err);
					return;
				}

				const meta = await this.decryptMeta(msg.meta, secret);

				if (meta?.editOf) {
					const targetId = Number(meta.editOf.id);
					const targetFrom = meta.editOf.from;

					if (!Number.isInteger(targetId) || typeof targetFrom !== "string") return;
					if (targetFrom !== jsonData.from) return;

					this.currentMessagesCache.add(key);

					if (!isLoadingOldMessage) {
						navigator.locks.request("GUNDB_MESSAGE_POP", () => {
							this.trackLastMessage(messageId);
							this.applyEdit(
								{ id: targetId, from: targetFrom },
								jsonData.from,
								content,
								messageId,
							);
						});
					} else {
						navigator.locks.request("GUNDB_MESSAGE_ARRAY", () => {
							this.trackLastMessage(messageId);
							this.applyEdit(
								{ id: targetId, from: targetFrom },
								jsonData.from,
								content,
								messageId,
								messageArray,
							);
						});
					}

					return;
				}

				const replyTo =
					meta?.replyTo &&
					Number.isInteger(meta.replyTo.id) &&
					typeof meta.replyTo.from === "string" &&
					typeof meta.replyTo.preview === "string"
						? meta.replyTo
						: undefined;

				const messageFormatted: MessageFormatted = {
					content,
					author: {
						alias:
							(await gun.get(`~${jsonData.from}`).get("alias").then()) ??
							jsonData.from,
						avatar: await gun.get(`~${jsonData.from}`).get("avatar").then(),
						pub: jsonData.from,
					},
					timestamp: messageId,
					replyTo,
				};

				this.applyPendingEdit(messageFormatted);
				this.currentMessagesCache.add(key);

				if (!isLoadingOldMessage) {
					navigator.locks.request("GUNDB_MESSAGE_POP", () => {
						this.trackLastMessage(messageFormatted.timestamp);
						this.insertAtSortIndex(messageFormatted);
					});
				} else {
					navigator.locks.request("GUNDB_MESSAGE_ARRAY", () => {
						this.trackLastMessage(messageFormatted.timestamp);
						const index = this.getSortIndex(messageFormatted, messageArray!);

						messageArray!.splice(index, 0, messageFormatted);
					})
				}
			} finally {
				this.pendingMessageKeys.delete(key);
			}
		};

		return (data, key) => handle(data, key);
	}

	async listen() {
		const gun = createGun();
		const channelId = await this.getChannelId();
		const match: LEXQuery & { "%": number } = {
			".": {
				"-": 1,
				"<": "\uffff",
			},
			"%": 100, // fetch the last 100 messages
		};

		const chain = gun
			.get("chats/DMs/" + channelId)
			.get(match)
			.map();

		// Use .on (not .once) so newly sent messages arrive without a reload.
		chain.on(this.createGunCallback(false));

		return () => chain.off();
	}

	private insertAtSortIndex(message: MessageFormatted) {
		const index = this.getSortIndex(message, this.messages);

		this.messages.splice(index, 0, message);
	}

	private getSortIndex(
		message: MessageFormatted,
		messages: MessageFormatted[],
	) {
		let index = 0;
		let high = messages.length;

		while (index < high) {
			let mid = (index + high) >>> 1;
			if (messages[mid].timestamp < message.timestamp) index = mid + 1;
			else high = mid;
		}

		return index;
	}

	setScrollContainer(container: HTMLDivElement) {
		this.container = container;
	}

	async send(content: string, options: SendMessageOptions = {}) {
		if (!this.peerEnc)
			throw new Error(
				"Could not fetch peer's public encryption key. Please fetch it first...",
			);
		const gun = createGun();
		const user = this.getUser();
		const secret = await this.getSecret();
		const channelId = await this.getChannelId();

		const encryptedContent = await SEA.encrypt(content, {
			epriv: secret,
		});

		const meta: MessageMeta | undefined = options.editOf
			? {
					v: 2,
					editOf: {
						id: options.editOf.timestamp,
						from: options.editOf.author.pub,
					},
				}
			: options.replyTo
				? {
						v: 2,
						replyTo: {
							id: options.replyTo.timestamp,
							from: options.replyTo.author.pub,
							alias: options.replyTo.author.alias,
							preview: options.replyTo.content.slice(0, 140),
						},
					}
				: undefined;

		const encryptedMeta = meta
			? await SEA.encrypt(JSON.stringify(meta), { epriv: secret })
			: undefined;

		const signature = await SEA.sign("SIGNED_MESSAGE", user._.sea);

		if (!signature) throw new Error("unable to derive signature");

		const messageId = Gun.state();

		await user
			.get<Record<string, Record<string, { content: string; meta?: string }>>>("messages")
			.get(channelId)
			.get(String(messageId))
			.put({
				content: encryptedContent,
				...(encryptedMeta ? { meta: encryptedMeta } : {}),
			})
			.then();

		const indexData = JSON.stringify({
			sig: signature,
			from: user._.sea.pub,
		});
		const encryptedIndex = await SEA.encrypt(indexData, { epriv: secret });
		const hashData = await SEA.work(encryptedIndex, null, null, { name: "SHA-256" });

		await gun
			.get("chats/DMs/" + channelId)
			.get(String(messageId) + "#" + hashData)
			.put(encryptedIndex)
			.then();
	}
}
