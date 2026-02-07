import Gun, { type LEXQuery } from "gun";
import { createGun, ensureUserLogged, getUser } from "../Gun.svelte";
import { onMount } from "svelte";

const { SEA } = Gun;

export interface MessageFrozen {
	sig: string;
	from: string;
}

export interface MessageRaw {
	content: string; // encrypted
}

export interface MessageFormatted {
	content: string; // decrypted
	author: {
		alias: string;
		pub: string;
		avatar?: string;
	};
	timestamp: number;
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
	channelId!: string;
	peer: string;
	peerEnc?: string;
	messages = $state<MessageFormatted[]>([]);
	lastMessage?: number;
	currentMessagesCache: string[] = [];
	private container?: HTMLDivElement;

	constructor(peerPub: string) {
		this.peer = peerPub;
		onMount(() => {
			const user = this.getUser();
			this.channelId = [user._.sea.pub, peerPub].sort().join("[DMCHANNEL]");
		});
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

	loadHistory() {
		return new Promise((resolve, reject) => {
			if (!this.lastMessage) return reject("fetch normal first");
			const match: LEXQuery & { "%": number } = {
				".": {
					"-": 1,
					"<": this.lastMessage + "",
				},
				"%": 100,
			};

			const gun = createGun();

			const messages: MessageFormatted[] = []

			const off = gun
				.get("#chats/DMs/" + this.channelId)
				.get(match)
				.map()
				.once(this.createGunCallback(true, messages)).off;

			setTimeout(() => {
				try {
					off();
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
		return async (data: string | undefined, key: string) => {
			if (!data || typeof data !== "string") return;
			if (!this.peerEnc) return;
			if (this.currentMessagesCache.includes(key)) return;

			let jsonData: MessageFrozen | null = null;

			try {
				const jsonFormatted: Partial<MessageFrozen> = JSON.parse(data);

				if (!jsonFormatted.from || !jsonFormatted.sig) jsonData = null;
				else jsonData = jsonFormatted as MessageFrozen;
			} catch {
				jsonData = null;
			}

			if (!jsonData) return;

			// verify the signature
			const sig = await SEA.verify(jsonData.sig, jsonData.from);

			if (!sig || sig !== "SIGNED_MESSAGE") return;
			const messageId = parseInt(key.split("#")[0]);

			this.currentMessagesCache.push(key);

			const gun = createGun();

			const message = (await gun
				.get(`~${jsonData.from}`)
				.get("messages")
				.get(this.channelId)
				.get(messageId + "")
				.then()) as Partial<MessageRaw> | undefined;

			if (!message || !message.content) return;

			const msg = message as MessageRaw;

			const user = this.getUser();

			const secret = await SEA.secret(this.peerEnc, user._.sea);

			if (!secret) {
				console.log(
					"Erroring during decryption. Message " + key + " not rendered",
					SEA.err,
				);
				return;
			}

			const content = await SEA.decrypt<string | undefined>(msg.content, {
				epriv: secret,
			});

			if (!content) {
				console.log("Error during decryption", SEA.err);
				return;
			}

			const messageFormatted: MessageFormatted = {
				content,
				author: {
					alias: await gun.get(`~${jsonData.from}`).get("alias").then(),
					avatar: await gun.get(`~${jsonData.from}`).get("avatar").then(),
					pub: jsonData.from,
				},
				timestamp: messageId,
			};

			if (!isLoadingOldMessage) {
				navigator.locks.request("GUNDB_MESSAGE_POP", () => {
					if (
						!this.lastMessage ||
						this.lastMessage > messageFormatted.timestamp
					) {
						this.lastMessage = messageFormatted.timestamp;
					}
					this.insertAtSortIndex(messageFormatted);
				});
			} else {
				navigator.locks.request("GUNDB_MESSAGE_ARRAY", () => {
					if (
						!this.lastMessage ||
						this.lastMessage > messageFormatted.timestamp
					) {
						this.lastMessage = messageFormatted.timestamp;
					}
					const index = this.getSortIndex(messageFormatted, messageArray!);

					messageArray!.splice(index, 0, messageFormatted);
				})
			}
		};
	}

	listen() {
		const gun = createGun();
		const match: LEXQuery & { "%": number } = {
			".": {
				"-": 1,
				"<": "\uffff",
			},
			"%": 100, // fetch the last 100 messages
		};

		const off = gun
			.get("#chats/DMs/" + this.channelId)
			.get(match)
			.map()
			.once(this.createGunCallback(false)).off;

		return off;
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

	async send(content: string) {
		if (!this.peerEnc)
			throw new Error(
				"Could not fetch peer's public encryption key. Please fetch it first...",
			);
		const gun = createGun();
		const user = this.getUser();

		const secret = await SEA.secret(this.peerEnc, user._.sea);

		if (!secret) throw new Error("unable to derive secret");

		const encryptedContent = await SEA.encrypt(content, {
			epriv: secret,
		});

		const signature = await SEA.sign("SIGNED_MESSAGE", user._.sea);

		if (!signature) throw new Error("unable to derive signature");

		const messageId = Gun.state();

		await user
			.get<Record<string, Record<string, { content: string }>>>("messages")
			.get(this.channelId)
			.get(String(messageId))
			.put({ content: encryptedContent })
			.then();

		const putData = JSON.stringify({
			sig: signature,
			from: user._.sea.pub,
		});

		const hashData = await SEA.work(putData, null, null, { name: "SHA-256" });

		await gun
			.get("#chats/DMs/" + this.channelId)
			.get(String(messageId) + "#" + hashData)
			.put(putData)
			.then();
	}
}
