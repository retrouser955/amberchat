import Gun, { type IGunInstance, type ISEAPair } from "gun";
import { env } from "$env/dynamic/public";
import 'gun/lib/radix';
import 'gun/lib/radisk';
import 'gun/lib/store';
import 'gun/lib/rindexed';
import 'gun/sea';

let gun: IGunInstance | undefined = undefined;
export type User = ReturnType<IGunInstance['user']>;
let user: User;

declare module "gun" {
	interface IGunUserInstance {
		_: {
			sea?: ISEAPair
		}
	}
	interface IGunChain<TNode> {
		then(): Promise<TNode|undefined>;
	}
}

export interface GunProfile {
	pub: string;
	alias?: string;
	displayName?: string;
	avatar?: string;
	bio?: string;
	epub?: string;
}

export interface GunUserReactive extends GunProfile {
	alias: string;
	pub: string;
}

export let gunData = $state<{
	user?: GunUserReactive;
	ready: boolean;
}>({
	ready: false
});

function getGunPeers() {
	const configured = env.PUBLIC_GUN_RELAY ?? "http://localhost:3000/gun";

	return configured
		.split(",")
		.map((peer) => peer.trim())
		.filter(Boolean);
}

export function ensureBrowser() {
	if (typeof window === "undefined") throw new Error("Function can only be used in the browser");
}

export function ensureUserLogged(user: User): asserts user is User & {
	_: {
		sea: ISEAPair
	}
	is: Exclude<User['is'], undefined>
} {
	if(!user.is || !user._.sea) throw new Error("User not logged");	
}

export function getUser() {
	if(!gun) createGun();
	return user;
}

/** Update the reactive signed-in profile without waiting for a Gun round trip. */
export function updateGunUser(patch: Partial<Omit<GunUserReactive, "pub">>) {
	if (!gunData.user) return;

	gunData.user = {
		...gunData.user,
		...patch
	};
}

/** Read a public profile node (`~<pub>`). Returns undefined if it has not synced. */
export async function fetchProfile(pub: string): Promise<GunProfile | undefined> {
	if (!pub) return;

	const instance = createGun();
	const data = await instance
		.get<Partial<GunProfile>>(`~${pub}`)
		.then();

	if (!data) return;

	return {
		pub,
		alias: data.alias ?? undefined,
		displayName: data.displayName ?? undefined,
		avatar: data.avatar ?? undefined,
		bio: data.bio ?? undefined,
		epub: data.epub ?? undefined
	};
}

export function createGun() {
	ensureBrowser();

	if(gun) return gun;

	gun = Gun({
		peers: getGunPeers()
	})
	user = gun.user();

	gun.on("auth", async () => {
		if (!user.is || !user._.sea) {
			gunData.ready = true;
			return;
		}

		gunData.user = {
			alias: user.is.pub,
			pub: user.is.pub
		};
		gunData.ready = true;

		const alias = await user.get<string>("alias").then();
		const displayName = await user.get<string>("displayName").then();
		const avatar = await user.get<string>("avatar").then();
		const bio = await user.get<string>("bio").then();

		gunData.user = {
			alias: alias ?? user.is.pub,
			pub: user.is.pub,
			displayName: displayName ?? undefined,
			avatar: avatar ?? undefined,
			bio: bio ?? undefined
		}
	})

	// Attach the auth listener before recalling, otherwise a synchronous
	// recall can emit "auth" before gunData is populated.
	user.recall({ sessionStorage: true });

	// Pair-based recall authenticates synchronously. If there is no session,
	// there will be no "auth" event, so mark the initial auth check complete.
	if (!user.is) {
		gunData.ready = true;
	}

	return gun;
}

export function logout() {
	if (!gun) return;

	user.leave();
	gunData.user = undefined;
	gunData.ready = true;

	try {
		sessionStorage.removeItem("recall");
		sessionStorage.removeItem("pair");
	} catch {
		// sessionStorage may be unavailable
	}
}