export type GroupRole = "owner" | "admin" | "member";
export type Epoch = number;

export interface GroupMember {
	pub: string;
	role: GroupRole;
	joinedAt: number;
	addedBy: string;
	status?: "active" | "invited";
}

export interface GroupRoster {
	v: 1;
	gid: string;
	epoch: Epoch;
	version: number;
	members: GroupMember[];
	updatedAt: number;
	updatedBy: string;
	sig: string;
}

export interface GroupMetaSnapshot {
	v: 1;
	gid: string;
	epoch: Epoch;
	version: number;
	name: string;
	avatar?: string;
	description?: string;
	createdAt: number;
	createdBy: string;
	updatedBy: string;
	sig: string;
}

export interface GroupCurrent {
	v: 1;
	gid: string;
	epoch: Epoch;
	rosterVersion: number;
	metaVersion: number;
	updatedAt: number;
	updatedBy: string;
	sig: string;
}

export interface GroupKeyEnvelope {
	v: 1;
	gid: string;
	epoch: Epoch;
	tag: string;
	from: string;
	wrapped: string;
	sig: string;
}

export interface GroupReplyReference {
	id: number;
	from: string;
	alias?: string;
	preview: string;
}

export interface GroupIndexEntry {
	v: 1;
	gid: string;
	epoch: Epoch;
	from: string;
	kind: "message" | "edit";
	editOf?: { id: number; from: string };
	contentHash: string;
	sig: string;
}

export interface GroupMessageMeta {
	v: 1;
	gid: string;
	epoch: Epoch;
	kind: "message" | "edit";
	editOf?: { id: number; from: string };
	replyTo?: GroupReplyReference;
}

export interface GroupMessageRaw {
	content: string;
	meta?: string;
}

export interface GroupMessageFormatted {
	content: string;
	author: {
		alias: string;
		displayName?: string;
		pub: string;
		avatar?: string;
	};
	timestamp: number;
	epoch: Epoch;
	replyTo?: GroupReplyReference;
	editedAt?: number;
}

export interface GroupBackup {
	v: 1;
	gid: string;
	name: string;
	avatar?: string;
	description?: string;
	currentEpoch: Epoch;
	keys: Record<string, string>;
	roster: GroupRoster;
	meta: GroupMetaSnapshot;
	lastRead?: number;
	updatedAt: number;
}

export interface GroupSendOptions {
	replyTo?: GroupMessageFormatted;
	editOf?: GroupMessageFormatted;
}

export interface GroupCallRecord {
	v: 1;
	gid: string;
	callId: string;
	epoch: Epoch;
	kind: "audio" | "video";
	startedBy: string;
	startedAt: number;
	active: boolean;
	sig: string;
}
