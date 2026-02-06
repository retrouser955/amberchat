import { createGun, ensureUserLogged, getUser } from "../Gun.svelte";
import Gun from "gun";

const SEA = Gun.SEA;

export function createInviteUrl(pub: string, cert: string) {
	const url = new URL("amber://request_friend")
	url.searchParams.set("cert", cert);
	url.searchParams.set("pub", pub)

	return url.toString();
}

export async function createInvite() {
	const user = getUser();
	ensureUserLogged(user);
	
	const cert = await user.get<{ fr: string }>("certs").get("fr").then();

	if(cert) return createInviteUrl(user._.sea.pub, await SEA.decrypt(cert, user._.sea));

	const newCert = await SEA.certify("*", { "*": "fr" }, user._.sea);
	const certEncoded = btoa(newCert);

	await user.get<{ fr: string }>("certs").get("fr").put(await SEA.encrypt(certEncoded, user._.sea)).then();

	return createInviteUrl(user._.sea.pub, certEncoded)
}

export async function addFriend(code: string) {
	const url = new URL(code);
	if(url.protocol !== "amber:") throw new Error("Invalid protocol");

	const cert = url.searchParams.get("cert");
	const pub = url.searchParams.get("pub");

	if(!pub || !cert) throw new Error("Cannot find certificate or public key");

	const certDecoded = atob(cert);

	const gun = createGun();
	const user = getUser();

	ensureUserLogged(user);

	const friendCert = await SEA.certify(pub, { "*": "friends" }, user._.sea);

	await gun.get(`~${pub}`).get("fr").get(user._.sea.pub).put(friendCert, undefined, {
		opt: {
			cert: certDecoded
		}
	}).then()
}

export async function acceptFriend(friendPub: string) {
	const user = getUser();
	ensureUserLogged(user);
	const gun = createGun();
	const cert = await user.get<Record<string, string>>("fr").get(friendPub).then();
	
	if(!cert) throw new Error("User not in requests");

	const friendsSince = Gun.state();

	await gun.get(`~${friendPub}`).get("friends").get(user._.sea.pub).put(friendsSince, undefined, {
		opt: {
			cert
		}
	}).then();
	await user.get<Record<string, number>>("friends").get(friendPub).put(friendsSince).then();

	// tombstone the request
	user.get<Record<string, string>>("fr").get(friendPub).put(null as unknown as string).then();
}