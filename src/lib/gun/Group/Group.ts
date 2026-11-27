import Gun from "gun";
import { env } from "$env/dynamic/public";
import {
	createGun,
	ensureUserLogged,
	fetchProfile,
	getUser,
	type GunProfile
} from "../Gun.svelte";
import { DMChannel } from "../Channel/DMChannel.svelte";
import {
	keyHint,
	open,
	randomSecret,
	seal,
	sha256,
	signCanonical,
	splitHint,
	unwrapKeyFrom,
	verifyCanonical,
	wrapKeyFor
} from "./crypto";
import type {
	GroupBackup,
	GroupCallRecord,
	GroupCurrent,
	GroupKeyEnvelope,
	GroupMetaSnapshot,
	GroupRoster
} from "./types";

const { SEA } = Gun;

export function inviteLink(gid: string, from: string, epoch: number, to?: string) {
	const url = new URL("amber://join_group");
	url.searchParams.set("gid", gid);
	url.searchParams.set("from", from);
	url.searchParams.set("epoch", String(epoch));

	// Include the intended member when this is a targeted DM invite. It lets
	// the joining client detect a stale/wrong account immediately.
	if (to) url.searchParams.set("to", to);

	return url.toString();
}

export async function groupRef(gid: string) {
	return sha256(`amber/group-ref/v1:${gid}`);
}

export async function groupStoreId(gid: string, pub: string) {
	return sha256(`amber/group-store/v1:${gid}:${pub}`);
}

export async function groupMemberTag(gid: string, pub: string) {
	return sha256(`amber/group-member/v1:${gid}:${pub}`);
}

export async function groupCallChannelId(gid: string, callId: string) {
	return sha256(`amber/group-call/v1:${gid}:${callId}`);
}

export async function groupCallToTag(gid: string, callId: string, pub: string) {
	return sha256(`amber/group-call-to/v1:${gid}:${callId}:${pub}`);
}

export async function groupCallMemberTag(gid: string, callId: string, pub: string) {
	return sha256(`amber/group-call-member/v1:${gid}:${callId}:${pub}`);
}

function parseJson<T>(value: unknown): T | undefined {
	if (typeof value !== "string") return;

	try {
		return JSON.parse(value) as T;
	} catch {
		return;
	}
}

function sleep(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function readKeyEnvelopeReady(gid: string, epoch: number, memberPub: string) {
	for (let attempt = 0; attempt < 12; attempt += 1) {
		const envelope = await readKeyEnvelope(gid, epoch, memberPub);
		if (envelope) return envelope;
		if (attempt < 11) await sleep(400);
	}
}

async function readRosterReady(gid: string, epoch: number, key: string) {
	for (let attempt = 0; attempt < 12; attempt += 1) {
		const roster = await readRoster(gid, epoch, key);
		if (roster) return roster;
		if (attempt < 11) await sleep(400);
	}
}

async function readMetaReady(gid: string, epoch: number, key: string) {
	for (let attempt = 0; attempt < 12; attempt += 1) {
		const meta = await readMeta(gid, epoch, key);
		if (meta) return meta;
		if (attempt < 11) await sleep(400);
	}
}

function rosterPayload(roster: GroupRoster) {
	return JSON.stringify({
		v: roster.v,
		gid: roster.gid,
		epoch: roster.epoch,
		version: roster.version,
		members: roster.members,
		updatedAt: roster.updatedAt,
		updatedBy: roster.updatedBy
	});
}

function metaPayload(meta: GroupMetaSnapshot) {
	return JSON.stringify({
		v: meta.v,
		gid: meta.gid,
		epoch: meta.epoch,
		version: meta.version,
		name: meta.name,
		avatar: meta.avatar ?? "",
		description: meta.description ?? "",
		createdAt: meta.createdAt,
		createdBy: meta.createdBy,
		updatedBy: meta.updatedBy
	});
}

function currentCanonical(current: GroupCurrent) {
	return `amber/group-current/v1:${current.gid}:${current.epoch}:${current.rosterVersion}:${current.metaVersion}:${current.updatedAt}`;
}

function callCanonical(record: GroupCallRecord) {
	return `amber/group-call/v1:${record.gid}:${record.callId}:${record.epoch}:${record.kind}:${record.startedBy}:${record.startedAt}:${record.active}`;
}

async function assertFriend(pub: string) {
	const user = getUser();
	ensureUserLogged(user);

	const gun = createGun();
	const value = await gun.get(`~${user._.sea.pub}`).get("friends").get(pub).then();

	if (!value) throw new Error("You can only add friends to a group.");
}

async function assertFriendReady(pub: string) {
	let lastError: unknown;

	for (let attempt = 0; attempt < 8; attempt += 1) {
		try {
			await assertFriend(pub);
			return;
		} catch (error) {
			lastError = error;
			if (attempt < 7) await sleep(400);
		}
	}

	throw lastError;
}

async function memberEpub(pub: string, selfPub: string, selfEpub: string) {
	if (pub === selfPub) return selfEpub;

	const profile = await fetchProfileReady(pub);
	return profile?.epub;
}

export async function fetchProfileReady(pub: string) {
	let profile = await fetchProfile(pub);

	for (let attempt = 0; !profile?.epub && attempt < 8; attempt += 1) {
		await sleep(400);
		profile = await fetchProfile(pub);
	}

	return profile;
}

async function writeMeta(
	gid: string,
	epoch: number,
	key: string,
	meta: GroupMetaSnapshot
): Promise<GroupMetaSnapshot> {
	const user = getUser();
	ensureUserLogged(user);

	const next: GroupMetaSnapshot = {
		...meta,
		v: 1,
		gid,
		epoch,
		version: meta.version || Gun.state(),
		sig: ""
	};

	const payload = metaPayload(next);
	const canonical = `amber/group-meta/v1:${gid}:${epoch}:${next.version}:${await sha256(payload)}`;
	const sig = await signCanonical(canonical, user._.sea);
	const stored: GroupMetaSnapshot = { ...next, sig };

	await createGun()
		.get(`groups/${gid}/meta/${epoch}`)
		.put(await seal(stored, key))
		.then();

	return stored;
}

async function writeRoster(
	gid: string,
	epoch: number,
	key: string,
	roster: GroupRoster
): Promise<GroupRoster> {
	const user = getUser();
	ensureUserLogged(user);

	const next: GroupRoster = {
		...roster,
		v: 1,
		gid,
		epoch,
		version: roster.version || Gun.state(),
		sig: ""
	};

	const payload = rosterPayload(next);
	const canonical = `amber/group-roster/v1:${gid}:${epoch}:${next.version}:${await sha256(payload)}`;
	const sig = await signCanonical(canonical, user._.sea);
	const stored: GroupRoster = { ...next, sig };

	await createGun()
		.get(`groups/${gid}/roster/${epoch}`)
		.put(await seal(stored, key))
		.then();

	return stored;
}

async function writeCurrent(
	gid: string,
	epoch: number,
	rosterVersion: number,
	metaVersion: number
): Promise<GroupCurrent> {
	const user = getUser();
	ensureUserLogged(user);

	const current: GroupCurrent = {
		v: 1,
		gid,
		epoch,
		rosterVersion,
		metaVersion,
		updatedAt: Gun.state(),
		updatedBy: user._.sea.pub,
		sig: ""
	};

	current.sig = await signCanonical(currentCanonical(current), user._.sea);

	await createGun()
		.get(`groups/${gid}/current`)
		.put(JSON.stringify(current))
		.then();

	return current;
}

async function writeKeyEnvelope(
	gid: string,
	epoch: number,
	memberPub: string,
	epub: string,
	epochKey: string
) {
	const user = getUser();
	ensureUserLogged(user);

	const tag = await groupMemberTag(gid, memberPub);
	const wrapped = await wrapKeyFor(epub, user._.sea, epochKey);
	const canonical = `amber/group-key/v1:${gid}:${epoch}:${tag}:${await sha256(wrapped)}`;
	const sig = await signCanonical(canonical, user._.sea);

	const envelope: GroupKeyEnvelope = {
		v: 1,
		gid,
		epoch,
		tag,
		from: user._.sea.pub,
		wrapped,
		sig
	};

	await createGun()
		.get(`groups/${gid}/keys/${epoch}/${tag}`)
		.put(JSON.stringify(envelope))
		.then();
}

export async function readKeyEnvelope(gid: string, epoch: number, memberPub: string) {
	const tag = await groupMemberTag(gid, memberPub);
	const raw = await createGun().get(`groups/${gid}/keys/${epoch}/${tag}`).then();
	const envelope = parseJson<GroupKeyEnvelope>(raw);

	if (!envelope) return;
	if (envelope.gid !== gid || envelope.epoch !== epoch || envelope.tag !== tag) return;

	const canonical = `amber/group-key/v1:${gid}:${epoch}:${tag}:${await sha256(
		envelope.wrapped
	)}`;

	if (!(await verifyCanonical(envelope.sig, envelope.from, canonical))) return;

	return envelope;
}

export async function readCurrent(gid: string): Promise<GroupCurrent | undefined> {
	const raw = await createGun().get(`groups/${gid}/current`).then();
	const current = parseJson<GroupCurrent>(raw);

	if (!current) return;
	if (current.gid !== gid) return;
	if (!(await verifyCanonical(current.sig, current.updatedBy, currentCanonical(current)))) {
		return;
	}

	return current;
}

export async function readRoster(
	gid: string,
	epoch: number,
	key: string
): Promise<GroupRoster | undefined> {
	const raw = await createGun().get(`groups/${gid}/roster/${epoch}`).then();
	if (typeof raw !== "string") return;

	const roster = await open<GroupRoster>(raw, key);
	if (!roster || roster.gid !== gid || roster.epoch !== epoch) return;

	const owner = roster.members.find((member) => member.role === "owner")?.pub;
	if (!owner || owner !== roster.updatedBy) return;

	const payload = rosterPayload(roster);
	const canonical = `amber/group-roster/v1:${gid}:${epoch}:${roster.version}:${await sha256(
		payload
	)}`;

	if (!(await verifyCanonical(roster.sig, roster.updatedBy, canonical))) return;

	return roster;
}

export async function readMeta(
	gid: string,
	epoch: number,
	key: string
): Promise<GroupMetaSnapshot | undefined> {
	const raw = await createGun().get(`groups/${gid}/meta/${epoch}`).then();
	if (typeof raw !== "string") return;

	const meta = await open<GroupMetaSnapshot>(raw, key);
	if (!meta || meta.gid !== gid || meta.epoch !== epoch) return;
	if (meta.updatedBy !== meta.createdBy) return;

	const payload = metaPayload(meta);
	const canonical = `amber/group-meta/v1:${gid}:${epoch}:${meta.version}:${await sha256(
		payload
	)}`;

	if (!(await verifyCanonical(meta.sig, meta.updatedBy, canonical))) return;

	return meta;
}

export async function readGroupCall(
	backup: GroupBackup
): Promise<GroupCallRecord | undefined> {
	const raw = await createGun().get(`groups/${backup.gid}/call`).then();
	if (typeof raw !== "string") return;

	const split = splitHint(raw);
	if (!split) return;

	for (const [epoch, key] of Object.entries(backup.keys)) {
		if ((await keyHint(key)) !== split.hint) continue;

		const record = await open<GroupCallRecord>(split.payload, key);
		if (!record || record.gid !== backup.gid) return;
		if (record.epoch !== Number(epoch)) return;
		if (!(await verifyCanonical(record.sig, record.startedBy, callCanonical(record)))) {
			return;
		}

		return record;
	}
}

export async function writeGroupCall(backup: GroupBackup, record: GroupCallRecord) {
	const user = getUser();
	ensureUserLogged(user);

	const key = backup.keys[record.epoch];
	if (!key) throw new Error("Group key for this call is missing.");

	const next: GroupCallRecord = { ...record, sig: "" };
	next.sig = await signCanonical(callCanonical(next), user._.sea);

	const hint = await keyHint(key);
	const cipher = await seal(next, key);

	await createGun()
		.get(`groups/${backup.gid}/call`)
		.put(`${hint}.${cipher}`)
		.then();

	return next;
}

export async function clearGroupCall(gid: string) {
	await createGun().get(`groups/${gid}/call`).put(null).then();
}

export async function saveGroupBackup(backup: GroupBackup) {
	const user = getUser();
	ensureUserLogged(user);

	const ref = await groupRef(backup.gid);
	const cipher = await SEA.encrypt(JSON.stringify(backup), user._.sea);

	await user
		.get<Record<string, string>>("groups")
		.get(ref)
		.put(cipher)
		.then();
}

async function decryptBackup(cipher: unknown): Promise<GroupBackup | undefined> {
	if (typeof cipher !== "string") return;

	const user = getUser();
	ensureUserLogged(user);

	const plain = await SEA.decrypt(cipher, user._.sea);
	if (!plain) return;

	if (typeof plain === "string") {
		return parseJson<GroupBackup>(plain);
	}

	return plain as GroupBackup;
}

export async function loadGroupBackup(gid: string): Promise<GroupBackup | undefined> {
	const user = getUser();
	ensureUserLogged(user);

	const ref = await groupRef(gid);
	const cipher = await user.get<Record<string, string>>("groups").get(ref).then();
	return decryptBackup(cipher);
}

export function watchGroupBackups(callback: (backups: GroupBackup[]) => void) {
	const user = getUser();
	ensureUserLogged(user);

	const backups = new Map<string, GroupBackup>();
	const chain = user.get<Record<string, string>>("groups").map();

	const emit = () => {
		callback(
			[...backups.values()].sort((a, b) =>
				a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
			)
		);
	};

	chain.on(async (value, key) => {
		if (!value) {
			backups.delete(key);
			emit();
			return;
		}

		try {
			const backup = await decryptBackup(value);
			if (backup) {
				backups.set(key, backup);
				emit();
			}
		} catch {
			// Ignore values that cannot be decrypted.
		}
	});

	return () => {
		try {
			chain.off();
		} catch {
			// no-op
		}
	};
}

export async function listGroupBackups(): Promise<GroupBackup[]> {
	return new Promise((resolve) => {
		let latest: GroupBackup[] = [];
		const off = watchGroupBackups((backups) => {
			latest = backups;
		});

		setTimeout(() => {
			off();
			resolve(latest);
		}, 800);
	});
}

async function notifyInvite(backup: GroupBackup, memberPub: string, epoch: number) {
	const user = getUser();
	ensureUserLogged(user);

	try {
		const channel = new DMChannel(memberPub);
		await channel.fetchUserEpub();
		await channel.send(inviteLink(backup.gid, user._.sea.pub, epoch, memberPub));
	} catch {
		// The graph invite still works even if the DM notification fails.
	}
}

export async function createGroup(name: string, memberPubs: string[]): Promise<GroupBackup> {
	const user = getUser();
	ensureUserLogged(user);

	const self = user._.sea.pub;
	const selfEpub = user._.sea.epub;
	const createdAt = Date.now();
	const gid = await sha256(`amber/group/v1:${randomSecret()}`);
	const epoch = 1;
	const epochKey = randomSecret();

	const profiles = new Map<string, GunProfile>();
	const memberList: GroupRoster["members"] = [
		{
			pub: self,
			role: "owner",
			joinedAt: createdAt,
			addedBy: self
		}
	];

	for (const pub of [...new Set(memberPubs)].filter((entry) => entry !== self)) {
		await assertFriendReady(pub);

		const profile = await fetchProfileReady(pub);
		if (!profile?.epub) {
			throw new Error("One of the selected friends has not published an encryption key yet.");
		}

		profiles.set(pub, profile);
		memberList.push({
			pub,
			role: "member",
			joinedAt: createdAt,
			addedBy: self
		});
	}

	const meta: GroupMetaSnapshot = {
		v: 1,
		gid,
		epoch,
		version: Gun.state(),
		name: name.trim() || "New group",
		createdAt,
		createdBy: self,
		updatedBy: self,
		sig: ""
	};

	const roster: GroupRoster = {
		v: 1,
		gid,
		epoch,
		version: Gun.state(),
		members: memberList,
		updatedAt: createdAt,
		updatedBy: self,
		sig: ""
	};

	const storedMeta = await writeMeta(gid, epoch, epochKey, meta);
	const storedRoster = await writeRoster(gid, epoch, epochKey, roster);

	for (const member of memberList) {
		const epub = member.pub === self ? selfEpub : profiles.get(member.pub)?.epub;
		if (!epub) continue;
		await writeKeyEnvelope(gid, epoch, member.pub, epub, epochKey);
	}

	await writeCurrent(gid, epoch, storedRoster.version, storedMeta.version);

	const backup: GroupBackup = {
		v: 1,
		gid,
		name: storedMeta.name,
		avatar: storedMeta.avatar,
		description: storedMeta.description,
		currentEpoch: epoch,
		keys: { [epoch]: epochKey },
		roster: storedRoster,
		meta: storedMeta,
		updatedAt: createdAt
	};

	await saveGroupBackup(backup);

	await Promise.allSettled(
		memberList
			.filter((member) => member.pub !== self)
			.map((member) => notifyInvite(backup, member.pub, epoch))
	);

	return backup;
}

export async function addMember(gid: string, pub: string): Promise<string> {
	const user = getUser();
	ensureUserLogged(user);

	const backup = await loadGroupBackup(gid);
	if (!backup) throw new Error("You are not a member of this group.");
	if (backup.roster.members.find((member) => member.pub === user._.sea.pub)?.role !== "owner") {
		throw new Error("Only the owner can add members.");
	}
	if (backup.roster.members.some((member) => member.pub === pub)) {
		return inviteLink(gid, user._.sea.pub, backup.currentEpoch);
	}

	await assertFriendReady(pub);

	const profile = await fetchProfileReady(pub);
	if (!profile?.epub) {
		throw new Error("That friend has not published an encryption key yet.");
	}

	const epoch = backup.currentEpoch;
	const key = backup.keys[epoch];
	if (!key) throw new Error("The current group key is missing.");

	await writeKeyEnvelope(gid, epoch, pub, profile.epub, key);

	const roster: GroupRoster = {
		...backup.roster,
		version: Gun.state(),
		members: [
			...backup.roster.members,
			{
				pub,
				role: "member",
				joinedAt: Date.now(),
				addedBy: user._.sea.pub
			}
		],
		updatedAt: Date.now(),
		updatedBy: user._.sea.pub,
		sig: ""
	};

	const storedRoster = await writeRoster(gid, epoch, key, roster);
	const current = await readCurrent(gid);
	const metaVersion =
		current && current.updatedBy === user._.sea.pub
			? current.metaVersion
			: backup.meta.version;
	await writeCurrent(gid, epoch, storedRoster.version, metaVersion);

	backup.roster = storedRoster;
	backup.updatedAt = Date.now();
	await saveGroupBackup(backup);

	const link = inviteLink(gid, user._.sea.pub, epoch, pub);
	await notifyInvite(backup, pub, epoch);

	return link;
}

async function rotateTo(backup: GroupBackup, members: GroupRoster["members"]) {
	const user = getUser();
	ensureUserLogged(user);

	const self = user._.sea.pub;
	const newEpoch = backup.currentEpoch + 1;
	const newKey = randomSecret();
	const updatedAt = Date.now();

	const roster: GroupRoster = {
		...backup.roster,
		epoch: newEpoch,
		version: Gun.state(),
		members,
		updatedAt,
		updatedBy: self,
		sig: ""
	};

	const meta: GroupMetaSnapshot = {
		...backup.meta,
		epoch: newEpoch,
		version: Gun.state(),
		updatedBy: self,
		sig: ""
	};

	const storedMeta = await writeMeta(backup.gid, newEpoch, newKey, meta);
	const storedRoster = await writeRoster(backup.gid, newEpoch, newKey, roster);

	for (const member of members) {
		const epub = await memberEpub(member.pub, self, user._.sea.epub);
		if (!epub) {
			throw new Error("Could not fetch a member's encryption key. Try again.");
		}
		await writeKeyEnvelope(backup.gid, newEpoch, member.pub, epub, newKey);
	}

	await writeCurrent(backup.gid, newEpoch, storedRoster.version, storedMeta.version);

	backup.keys[newEpoch] = newKey;
	backup.currentEpoch = newEpoch;
	backup.roster = storedRoster;
	backup.meta = storedMeta;
	backup.name = storedMeta.name;
	backup.avatar = storedMeta.avatar;
	backup.description = storedMeta.description;
	backup.updatedAt = updatedAt;

	await saveGroupBackup(backup);
}

export async function removeMember(gid: string, pub: string): Promise<GroupBackup> {
	const user = getUser();
	ensureUserLogged(user);

	const backup = await loadGroupBackup(gid);
	if (!backup) throw new Error("You are not a member of this group.");
	if (backup.roster.members.find((member) => member.pub === user._.sea.pub)?.role !== "owner") {
		throw new Error("Only the owner can remove members.");
	}
	if (pub === user._.sea.pub) throw new Error("Use Leave group to remove yourself.");

	const members = backup.roster.members.filter((member) => member.pub !== pub);

	await rotateTo(backup, members);
	return backup;
}

export async function rotateGroup(gid: string): Promise<GroupBackup> {
	const user = getUser();
	ensureUserLogged(user);

	const backup = await loadGroupBackup(gid);
	if (!backup) throw new Error("You are not a member of this group.");
	if (backup.roster.members.find((member) => member.pub === user._.sea.pub)?.role !== "owner") {
		throw new Error("Only the owner can rotate the group key.");
	}

	await rotateTo(backup, backup.roster.members);
	return backup;
}

export async function updateGroupMeta(
	gid: string,
	patch: { name?: string; description?: string; avatar?: string }
): Promise<GroupBackup> {
	const user = getUser();
	ensureUserLogged(user);

	const backup = await loadGroupBackup(gid);
	if (!backup) throw new Error("You are not a member of this group.");
	if (backup.roster.members.find((member) => member.pub === user._.sea.pub)?.role !== "owner") {
		throw new Error("Only the owner can edit the group.");
	}

	const epoch = backup.currentEpoch;
	const key = backup.keys[epoch];
	if (!key) throw new Error("The current group key is missing.");

	const meta: GroupMetaSnapshot = {
		...backup.meta,
		epoch,
		version: Gun.state(),
		name: patch.name?.trim() || backup.meta.name,
		description: patch.description?.trim() ?? backup.meta.description,
		avatar: patch.avatar ?? backup.meta.avatar,
		updatedBy: user._.sea.pub,
		sig: ""
	};

	const storedMeta = await writeMeta(gid, epoch, key, meta);
	const current = await readCurrent(gid);
	const rosterVersion =
		current && current.updatedBy === user._.sea.pub
			? current.rosterVersion
			: backup.roster.version;
	await writeCurrent(gid, epoch, rosterVersion, storedMeta.version);

	backup.meta = storedMeta;
	backup.name = storedMeta.name;
	backup.avatar = storedMeta.avatar;
	backup.description = storedMeta.description;
	backup.updatedAt = Date.now();
	await saveGroupBackup(backup);

	return backup;
}

export async function leaveGroup(gid: string) {
	const user = getUser();
	ensureUserLogged(user);

	const ref = await groupRef(gid);
	await user
		.get<Record<string, string>>("groups")
		.get(ref)
		.put(null as unknown as string)
		.then();
}

export async function joinGroup(invite: string): Promise<GroupBackup> {
	const user = getUser();
	ensureUserLogged(user);

	const url = new URL(invite.trim());
	if (url.protocol !== "amber:" || url.host !== "join_group") {
		throw new Error("Invalid group invite link.");
	}

	const gid = url.searchParams.get("gid");
	const from = url.searchParams.get("from");
	const to = url.searchParams.get("to");
	const epochRaw = url.searchParams.get("epoch");
	const epochParam = Number(epochRaw);

	if (!gid || !from || !epochRaw || !Number.isInteger(epochParam)) {
		throw new Error("The group invite is incomplete.");
	}

	if (to && to !== user._.sea.pub) {
		throw new Error(
			"This invite was created for a different account. Ask the owner to invite this account."
		);
	}

	try {
		await assertFriendReady(from);
	} catch {
		throw new Error("You must be friends with the group owner before joining.");
	}

	const fromProfile = await fetchProfileReady(from);
	if (!fromProfile?.epub) throw new Error("The inviter's encryption key is unavailable.");

	const envelope = await readKeyEnvelopeReady(gid, epochParam, user._.sea.pub);
	if (!envelope) {
		console.warn("[group] invite key envelope missing", {
			gid,
			epoch: epochParam,
			from,
			member: user._.sea.pub,
			relay: env.PUBLIC_GUN_RELAY ?? "http://localhost:3000/gun"
		});
		throw new Error(
			"The group invite has not reached this device yet. Check that both users use the same relay, wait a moment, then try again."
		);
	}
	if (envelope.from !== from) {
		throw new Error("The invite link does not match the group owner.");
	}

	const key = await unwrapKeyFrom(fromProfile.epub, user._.sea, envelope.wrapped);
	if (!key) throw new Error("Could not unlock the group key.");

	let epoch = epochParam;
	let epochKey = key;
	let [roster, meta] = await Promise.all([
		readRosterReady(gid, epoch, epochKey),
		readMetaReady(gid, epoch, epochKey)
	]);

	if (!roster || !meta) {
		console.warn("[group] roster/meta missing after invite", {
			gid,
			epoch,
			from,
			member: user._.sea.pub,
			roster: !!roster,
			meta: !!meta,
			relay: env.PUBLIC_GUN_RELAY ?? "http://localhost:3000/gun"
		});
		throw new Error(
			"The group data has not synced yet. Check that both users use the same relay, wait a moment, then try again."
		);
	}

	if (!roster.members.some((member) => member.pub === user._.sea.pub)) {
		throw new Error("You are not a member of this group.");
	}

	const current = await readCurrent(gid);
	const trustedCurrent =
		current &&
		roster.members.some(
			(member) => member.pub === current.updatedBy && member.role === "owner"
		)
			? current
			: undefined;

	if (trustedCurrent && trustedCurrent.epoch !== epoch) {
		const currentEpoch = trustedCurrent.epoch;
		const nextEnvelope = await readKeyEnvelopeReady(gid, currentEpoch, user._.sea.pub);
		if (!nextEnvelope) {
			throw new Error(
				"The current group key has not synced yet. Check that both users use the same relay, wait a moment, then try again."
			);
		}
		if (nextEnvelope.from !== trustedCurrent.updatedBy) {
			throw new Error("The current group key has an invalid owner signature.");
		}

		const nextFrom = await fetchProfileReady(nextEnvelope.from);
		if (!nextFrom?.epub) throw new Error("The group owner's encryption key is unavailable.");

		const nextKey = await unwrapKeyFrom(nextFrom.epub, user._.sea, nextEnvelope.wrapped);
		if (!nextKey) throw new Error("Could not unlock the current group key.");

		const [nextRoster, nextMeta] = await Promise.all([
			readRosterReady(gid, currentEpoch, nextKey),
			readMetaReady(gid, currentEpoch, nextKey)
		]);

		if (!nextRoster || !nextMeta) {
			throw new Error(
				"The current group data has not synced yet. Check that both users use the same relay, wait a moment, then try again."
			);
		}

		if (!nextRoster.members.some((member) => member.pub === user._.sea.pub)) {
			throw new Error("You are no longer a member of this group.");
		}

		epoch = currentEpoch;
		epochKey = nextKey;
		roster = nextRoster;
		meta = nextMeta;
	}

	const backup: GroupBackup = {
		v: 1,
		gid,
		name: meta.name,
		avatar: meta.avatar,
		description: meta.description,
		currentEpoch: epoch,
		keys: {
			[epochParam]: key,
			...(epoch !== epochParam ? { [epoch]: epochKey } : {})
		},
		roster,
		meta,
		updatedAt: Date.now()
	};

	await saveGroupBackup(backup);
	return backup;
}
