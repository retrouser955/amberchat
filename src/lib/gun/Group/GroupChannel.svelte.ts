import Gun, { type LEXQuery } from "gun";
import { createGun, ensureUserLogged, fetchProfile, getUser } from "../Gun.svelte";
import { displayNameOf } from "$lib/profile";
import {
	addMember as addGroupMember,
	groupStoreId,
	leaveGroup,
	loadGroupBackup,
	readCurrent,
	readKeyEnvelope,
	readMeta,
	readRoster,
	removeMember as removeGroupMember,
	rotateGroup as rotateGroupKey,
	saveGroupBackup,
	updateGroupMeta
} from "./Group";
import { keyHint, open, seal, sha256, signCanonical, splitHint, unwrapKeyFrom, verifyCanonical } from "./crypto";
import type {
	GroupBackup,
	GroupIndexEntry,
	GroupMessageFormatted,
	GroupMessageMeta,
	GroupMessageRaw,
	GroupMetaSnapshot,
	GroupReplyReference,
	GroupRoster,
	GroupSendOptions
} from "./types";

const { SEA } = Gun;

export class GroupChannel {
	gid: string;
	messages = $state<GroupMessageFormatted[]>([]);
	roster = $state<GroupRoster>();
	meta = $state<GroupMetaSnapshot>();
	currentEpoch = $state(0);
	removed = $state(false);
	lastMessage?: number;

	private backup: GroupBackup;
	private keys = new Map<number, string>();
	private currentMessagesCache = new Set<string>();
	private pendingMessageKeys = new Set<string>();
	private pendingEdits = new Map<string, { content: string; editedAt: number }>();
	private currentOff?: () => void;
	private messageOff?: () => void;
	private container?: HTMLDivElement;

	constructor(backup: GroupBackup) {
		this.gid = backup.gid;
		this.backup = backup;
		this.roster = backup.roster;
		this.meta = backup.meta;
		this.currentEpoch = backup.currentEpoch;

		for (const [epoch, key] of Object.entries(backup.keys)) {
			this.keys.set(Number(epoch), key);
		}
	}

	static async open(gid: string) {
		const backup = await loadGroupBackup(gid);
		if (!backup) throw new Error("You are not a member of this group.");
		return new GroupChannel(backup);
	}

	get selfPub() {
		const user = getUser();
		ensureUserLogged(user);
		return user._.sea.pub;
	}

	get isOwner() {
		return this.roster?.members.find((member) => member.pub === this.selfPub)?.role === "owner";
	}

	async refreshMembership() {
		const current = await readCurrent(this.gid);
		if (!current) return;

		if (current.epoch < this.currentEpoch) return;
		if (
			current.epoch === this.currentEpoch &&
			current.rosterVersion <= this.backup.roster.version &&
			current.metaVersion <= this.backup.meta.version
		) {
			return;
		}

		if (
			this.roster &&
			!this.roster.members.some(
				(member) => member.pub === current.updatedBy && member.role === "owner"
			)
		) {
			return;
		}

		const user = getUser();
		ensureUserLogged(user);

		if (current.epoch !== this.currentEpoch) {
			let envelope = await readKeyEnvelope(this.gid, current.epoch, user._.sea.pub);

			// The current pointer can arrive before the key envelope has synced.
			for (let attempt = 0; !envelope && attempt < 2; attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, 400));
				envelope = await readKeyEnvelope(this.gid, current.epoch, user._.sea.pub);
			}

			if (!envelope) {
				this.removed = true;
				this.currentEpoch = current.epoch;
				return;
			}

			if (envelope.from !== current.updatedBy) return;

			const sender = await fetchProfile(envelope.from);
			if (!sender?.epub) return;

			const key = await unwrapKeyFrom(sender.epub, user._.sea, envelope.wrapped);
			if (!key) {
				this.removed = true;
				return;
			}

			this.keys.set(current.epoch, key);
			this.backup.keys[String(current.epoch)] = key;
		}

		this.currentEpoch = current.epoch;
		const key = this.keys.get(current.epoch);
		if (!key) return;

		const roster = await readRoster(this.gid, current.epoch, key);
		const meta = await readMeta(this.gid, current.epoch, key);

		if (roster) {
			this.roster = roster;
			this.backup.roster = roster;
		}

		if (meta) {
			this.meta = meta;
			this.backup.meta = meta;
			this.backup.name = meta.name;
			this.backup.avatar = meta.avatar;
			this.backup.description = meta.description;
		}

		this.backup.currentEpoch = current.epoch;
		this.backup.updatedAt = Date.now();
		this.removed = false;

		try {
			await saveGroupBackup(this.backup);
		} catch (error) {
			console.error("[group] could not save backup", error);
		}
	}

	async listen() {
		const gun = createGun();
		await this.refreshMembership();

		const currentChain = gun.get(`groups/${this.gid}/current`);
		currentChain.on((value) => {
			if (value) {
				void this.refreshMembership().catch((error) => {
					console.error("[group] membership refresh failed", error);
				});
			}
		});
		this.currentOff = () => {
			try {
				currentChain.off();
			} catch {
				// no-op
			}
		};

		const match: LEXQuery & { "%": number } = {
			".": {
				"-": 1,
				"<": "\uffff"
			},
			"%": 100
		};

		const chain = gun.get(`chats/groups/${this.gid}`).get(match).map();
		chain.on(this.createGunCallback(false));
		this.messageOff = () => {
			try {
				chain.off();
			} catch {
				// no-op
			}
		};

		return () => {
			this.currentOff?.();
			this.messageOff?.();
		};
	}

	async send(content: string, options: GroupSendOptions = {}) {
		if (this.removed) throw new Error("You are no longer a member of this group.");

		const user = getUser();
		ensureUserLogged(user);

		const epoch = this.currentEpoch;
		const key = this.keys.get(epoch);
		if (!key) throw new Error("The current group key is missing.");

		const meta: GroupMessageMeta | undefined = options.editOf
			? {
					v: 1,
					gid: this.gid,
					epoch,
					kind: "edit",
					editOf: {
						id: options.editOf.timestamp,
						from: options.editOf.author.pub
					}
				}
			: options.replyTo
				? {
						v: 1,
						gid: this.gid,
						epoch,
						kind: "message",
						replyTo: {
							id: options.replyTo.timestamp,
							from: options.replyTo.author.pub,
							alias: displayNameOf(options.replyTo.author),
							preview: options.replyTo.content.slice(0, 140)
						}
					}
				: undefined;

		const encryptedContent = await SEA.encrypt(content, { epriv: key });
		if (!encryptedContent) throw new Error("Could not encrypt the message.");

		const encryptedMeta = meta ? await seal(meta, key) : undefined;
		const messageId = Gun.state();
		const contentHash = await sha256(encryptedContent);
		const kind = options.editOf ? "edit" : "message";
		const editOf = options.editOf
			? { id: options.editOf.timestamp, from: options.editOf.author.pub }
			: undefined;

		const canonical = `amber/group-message/v1:${this.gid}:${messageId}:${epoch}:${kind}:${
			editOf?.id ?? ""
		}:${editOf?.from ?? ""}:${contentHash}`;
		const sig = await signCanonical(canonical, user._.sea);

		const storeId = await groupStoreId(this.gid, user._.sea.pub);

		await user
			.get<Record<string, Record<string, { content: string; meta?: string }>>>("gmessages")
			.get(storeId)
			.get(String(messageId))
			.put({
				content: encryptedContent,
				...(encryptedMeta ? { meta: encryptedMeta } : {})
			})
			.then();

		const hint = await keyHint(key);
		const entry: GroupIndexEntry = {
			v: 1,
			gid: this.gid,
			epoch,
			from: user._.sea.pub,
			kind,
			editOf,
			contentHash,
			sig
		};
		const cipher = await seal(entry, key);

		await createGun()
			.get(`chats/groups/${this.gid}`)
			.get(`${messageId}#${contentHash}`)
			.put(`${hint}.${cipher}`)
			.then();
	}

	async loadHistory() {
		const key = this.keys.get(this.currentEpoch);
		if (!key) return [];

		return new Promise<GroupMessageFormatted[]>((resolve, reject) => {
			if (!this.lastMessage) {
				reject(new Error("Fetch normal messages first"));
				return;
			}

			const match: LEXQuery & { "%": number } = {
				".": {
					"-": 1,
					"<": String(this.lastMessage)
				},
				"%": 100
			};

			const messages: GroupMessageFormatted[] = [];
			const chain = createGun().get(`chats/groups/${this.gid}`).get(match).map();

			chain.once(this.createGunCallback(true, messages));

			setTimeout(() => {
				try {
					chain.off();

					for (const message of messages) {
						this.trackLastMessage(message.timestamp);

						if (
							!this.messages.some(
								(existing) =>
									existing.timestamp === message.timestamp &&
									existing.author.pub === message.author.pub
							)
						) {
							this.insertAtSortIndex(message);
						}
					}

					resolve(messages);
				} catch (error) {
					reject(error);
				}
			}, 300);
		});
	}

	setScrollContainer(container: HTMLDivElement) {
		this.container = container;
	}

	private createGunCallback(
		isLoadingOldMessage: boolean,
		messageArray?: GroupMessageFormatted[]
	) {
		const handle = async (data: string | undefined, indexKey: string, attempt = 0) => {
			if (typeof data !== "string") return;

			const split = splitHint(data);
			if (!split) return;

			let epochKey: string | undefined;
			for (const key of this.keys.values()) {
				if ((await keyHint(key)) === split.hint) {
					epochKey = key;
					break;
				}
			}

			if (!epochKey) {
				if (!isLoadingOldMessage) {
					void this.refreshMembership().catch(() => {
						// The next retry will pick up the key if it synced.
					});

					if (attempt < 4) {
						setTimeout(() => {
							void handle(data, indexKey, attempt + 1);
						}, 500);
					}
				}

				return;
			}

			const entry = await open<GroupIndexEntry>(split.payload, epochKey);
			if (!entry || entry.gid !== this.gid) return;

			const messageId = Number(indexKey.split("#")[0]);
			if (!Number.isInteger(messageId)) return;

			if (this.currentMessagesCache.has(indexKey) || this.pendingMessageKeys.has(indexKey)) {
				return;
			}

			const canonical = `amber/group-message/v1:${entry.gid}:${messageId}:${entry.epoch}:${
				entry.kind
			}:${entry.editOf?.id ?? ""}:${entry.editOf?.from ?? ""}:${entry.contentHash}`;

			if (!(await verifyCanonical(entry.sig, entry.from, canonical))) return;

			this.pendingMessageKeys.add(indexKey);

			try {
				const storeId = await groupStoreId(this.gid, entry.from);
				const raw = (await createGun()
					.get(`~${entry.from}`)
					.get("gmessages")
					.get(storeId)
					.get(String(messageId))
					.then()) as Partial<GroupMessageRaw> | undefined;

				if (!raw?.content) {
					if (!isLoadingOldMessage && attempt < 4) {
						setTimeout(() => {
							void handle(data, indexKey, attempt + 1);
						}, 750);
					}
					return;
				}

				const contentHash = await sha256(raw.content);
				if (contentHash !== entry.contentHash) return;

				const content = await SEA.decrypt(raw.content, { epriv: epochKey });
				if (typeof content !== "string") return;

				const meta = raw.meta
					? await open<GroupMessageMeta>(raw.meta, epochKey)
					: undefined;

				if (entry.kind === "edit" || meta?.editOf) {
					const target = entry.editOf ?? meta?.editOf;
					if (!target || target.from !== entry.from) return;

					this.currentMessagesCache.add(indexKey);
					this.trackLastMessage(messageId);

					const apply = () => {
						this.applyEdit(target, entry.from, content, messageId, messageArray);
					};

					if (isLoadingOldMessage) {
						void navigator.locks.request("GUNDB_GROUP_MESSAGE_ARRAY", apply);
					} else {
						void navigator.locks.request("GUNDB_GROUP_MESSAGE_POP", apply);
					}

					return;
				}

				const profile = await fetchProfile(entry.from);
				const message: GroupMessageFormatted = {
					content,
					author: {
						alias: profile?.alias ?? entry.from,
						displayName: profile?.displayName,
						avatar: profile?.avatar,
						pub: entry.from
					},
					timestamp: messageId,
					epoch: entry.epoch,
					replyTo: meta?.replyTo
				};

				this.applyPendingEdit(message);
				this.currentMessagesCache.add(indexKey);

				if (isLoadingOldMessage && messageArray) {
					const index = this.getSortIndex(message, messageArray);
					messageArray.splice(index, 0, message);
				} else {
					void navigator.locks.request("GUNDB_GROUP_MESSAGE_POP", () => {
						this.trackLastMessage(message.timestamp);
						this.insertAtSortIndex(message);
					});
				}
			} finally {
				this.pendingMessageKeys.delete(indexKey);
			}
		};

		return (data: string | undefined, key: string) => void handle(data, key);
	}

	private applyEdit(
		target: { id: number; from: string },
		from: string,
		content: string,
		editedAt: number,
		messageArray?: GroupMessageFormatted[]
	) {
		if (target.from !== from) return;

		const arrays = messageArray ? [this.messages, messageArray] : [this.messages];

		for (const messages of arrays) {
			const existing = messages.find(
				(message) => message.timestamp === target.id && message.author.pub === target.from
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

	private applyPendingEdit(message: GroupMessageFormatted) {
		const key = `${message.author.pub}:${message.timestamp}`;
		const pending = this.pendingEdits.get(key);

		if (!pending) return;

		if ((message.editedAt ?? 0) < pending.editedAt) {
			message.content = pending.content;
			message.editedAt = pending.editedAt;
		}

		this.pendingEdits.delete(key);
	}

	private trackLastMessage(timestamp: number) {
		if (!this.lastMessage || this.lastMessage > timestamp) {
			this.lastMessage = timestamp;
		}
	}

	private insertAtSortIndex(message: GroupMessageFormatted) {
		const index = this.getSortIndex(message, this.messages);
		this.messages.splice(index, 0, message);
	}

	private getSortIndex(message: GroupMessageFormatted, messages: GroupMessageFormatted[]) {
		let index = 0;
		let high = messages.length;

		while (index < high) {
			const mid = (index + high) >>> 1;
			const other = messages[mid];

			if (
				other.timestamp < message.timestamp ||
				(other.timestamp === message.timestamp && other.author.pub < message.author.pub)
			) {
				index = mid + 1;
			} else {
				high = mid;
			}
		}

		return index;
	}

	async addMember(pub: string) {
		const link = await addGroupMember(this.gid, pub);
		await this.refreshMembership();
		return link;
	}

	async removeMember(pub: string) {
		await removeGroupMember(this.gid, pub);
		await this.refreshMembership();
	}

	async rotate() {
		await rotateGroupKey(this.gid);
		await this.refreshMembership();
	}

	async updateMeta(patch: { name?: string; description?: string; avatar?: string }) {
		const backup = await updateGroupMeta(this.gid, patch);
		this.backup = backup;
		this.meta = backup.meta;
		this.roster = backup.roster;
		this.currentEpoch = backup.currentEpoch;

		for (const [epoch, key] of Object.entries(backup.keys)) {
			this.keys.set(Number(epoch), key);
		}
	}

	async leave() {
		await leaveGroup(this.gid);
		this.removed = true;
	}

	async setLastRead(timestamp: number) {
		this.backup.lastRead = timestamp;
		this.backup.updatedAt = Date.now();
		await saveGroupBackup(this.backup);
	}
}

export type { GroupReplyReference };
