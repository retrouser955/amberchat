import { gunData, getUser } from "./Gun.svelte";

let friendPubs = $state<string[]>([]);
let off: (() => void) | undefined;
let subscribedFor: string | undefined;

/** Subscribe to the signed-in user's friends graph. Safe to call repeatedly. */
export function initFriends() {
	let user;

	try {
		user = getUser();
	} catch {
		return;
	}

	if (!user.is) return;

	const pub = user.is.pub;
	if (subscribedFor === pub && off) return;

	destroyFriends();
	subscribedFor = pub;

	const chain = user.get<Record<string, number>>("friends").map();

	chain.on((value, key) => {
		if (!value) {
			friendPubs = friendPubs.filter((entry) => entry !== key);
			return;
		}

		if (!friendPubs.includes(key)) {
			friendPubs = [...friendPubs, key];
		}
	});

	off = () => {
		try {
			chain.off();
		} catch {
			// no-op
		}
	};
}

export function destroyFriends() {
	off?.();
	off = undefined;
	subscribedFor = undefined;
	friendPubs = [];
}

export function isFriend(pub?: string) {
	return !!pub && friendPubs.includes(pub);
}

export function isSelf(pub?: string) {
	return !!pub && gunData.user?.pub === pub;
}

/** Avatars are only shown for yourself and for friends. */
export function canSeeAvatar(pub?: string) {
	return isSelf(pub) || isFriend(pub);
}

export function friendPubsList() {
	return friendPubs;
}
