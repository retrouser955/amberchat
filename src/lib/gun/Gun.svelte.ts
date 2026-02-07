import Gun, { type IGunInstance, type ISEAPair } from "gun";
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

export interface GunUserReactive {
	alias: string;
	pub: string;
	avatar?: string;
}

export let gunData = $state<{
	user?: GunUserReactive
}>({});

export function ensureBrowser() {
	if(!window) throw new Error("Function can only be used in the browser");
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

export function createGun() {
	ensureBrowser();

	if(gun) return gun;

	gun = Gun({
		peers: ['http://localhost:3000/gun']
	})
	user = gun.user().recall({ sessionStorage: true });

	gun.on("auth", async () => {
		ensureUserLogged(user);
		
		gunData.user = {
			alias: (await user.get<string>("alias").then())!,
			pub: user.is.pub,
			avatar: await user.get<string>("avatar").then()
		}
	})

	return gun;
}