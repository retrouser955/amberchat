import { createGun, ensureUserLogged, getUser } from "../Gun.svelte";
import Gun from "gun";

const SEA = Gun.SEA;

function parseInvite(code: string) {
	let url: URL;

	try {
		url = new URL(code.trim());
	} catch {
		throw new Error("Invalid invite link");
	}

	if(url.protocol !== "amber:") throw new Error("Invalid protocol");

	const cert = url.searchParams.get("cert");
	const pub = url.searchParams.get("pub");

	if(!pub || !cert) throw new Error("Cannot find certificate or public key");

	let certDecoded: string;

	try {
		certDecoded = atob(cert);
	} catch {
		throw new Error("Invalid invite certificate");
	}

	if(!certDecoded) throw new Error("Invalid invite certificate");

	return { cert: certDecoded, pub };
}

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

	if(cert) {
		const decoded = await SEA.decrypt(cert, user._.sea);

		if(typeof decoded === "string" && decoded) {
			return createInviteUrl(user._.sea.pub, decoded);
		}
	}

	const newCert = await SEA.certify("*", { "*": "fr" }, user._.sea);

	if(!newCert || typeof newCert !== "string") {
		throw new Error("Could not create invite certificate");
	}

	const certEncoded = btoa(newCert);

	await user.get<{ fr: string }>("certs").get("fr").put(await SEA.encrypt(certEncoded, user._.sea)).then();

	return createInviteUrl(user._.sea.pub, certEncoded)
}

export async function addFriend(code: string) {
	const { cert, pub } = parseInvite(code);

	const gun = createGun();
	const user = getUser();

	ensureUserLogged(user);

	const friendCert = await SEA.certify(pub, { "*": "friends" }, user._.sea);

	if(!friendCert || typeof friendCert !== "string") {
		throw new Error("Could not create friend certificate");
	}

	await gun.get(`~${pub}`).get("fr").get(user._.sea.pub).put(friendCert, undefined, {
		opt: {
			cert
		}
	}).then()
}

export async function acceptFriend(friendPub: string) {
	if(!friendPub) throw new Error("Invalid friend public key");

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
	await user.get<Record<string, string>>("fr").get(friendPub).put(null as unknown as string).then();
}
