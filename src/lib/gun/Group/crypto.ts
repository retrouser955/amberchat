import Gun, { type ISEAPair } from "gun";

const { SEA } = Gun;

export function toBase64Url(value: string) {
	return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomSecret(bytes = 32) {
	const data = crypto.getRandomValues(new Uint8Array(bytes));
	let binary = "";

	for (const byte of data) {
		binary += String.fromCharCode(byte);
	}

	return toBase64Url(btoa(binary));
}

export async function sha256(value: string) {
	const hash = await SEA.work(value, null, null, { name: "SHA-256" });

	if (!hash) throw new Error("Could not hash value");

	return toBase64Url(hash);
}

export async function seal(value: unknown, key: string) {
	const encrypted = await SEA.encrypt(JSON.stringify(value), { epriv: key });
	if (!encrypted) throw new Error("Could not encrypt data");
	return encrypted;
}

export async function open<T>(cipher: string | undefined, key: string): Promise<T | undefined> {
	if (!cipher) return;

	const plain = await SEA.decrypt(cipher, { epriv: key });
	if (!plain) return;

	if (typeof plain === "string") {
		try {
			return JSON.parse(plain) as T;
		} catch {
			return;
		}
	}

	return plain as T;
}

export async function wrapKeyFor(
	recipientEpub: string,
	senderPair: ISEAPair,
	key: string
) {
	const shared = await SEA.secret(recipientEpub, senderPair);
	if (!shared) throw new Error("Could not derive a shared secret");

	const wrapped = await SEA.encrypt(key, shared);
	if (!wrapped) throw new Error("Could not wrap the group key");

	return wrapped;
}

export async function unwrapKeyFrom(
	senderEpub: string,
	recipientPair: ISEAPair,
	wrapped: string
) {
	const shared = await SEA.secret(senderEpub, recipientPair);
	if (!shared) return;

	const key = await SEA.decrypt(wrapped, { epriv: shared });
	return typeof key === "string" ? key : undefined;
}

export async function signCanonical(canonical: string, pair: ISEAPair) {
	const signature = await SEA.sign(canonical, pair);
	if (!signature) throw new Error("Could not sign data");
	return signature;
}

export async function verifyCanonical(signature: string, pub: string, canonical: string) {
	try {
		const verified = await SEA.verify(signature, pub);
		return verified === canonical;
	} catch {
		return false;
	}
}

export async function keyHint(key: string) {
	return (await sha256(`amber/group-hint/v1:${key}`)).slice(0, 12);
}

export function splitHint(raw: string) {
	const index = raw.indexOf(".");
	if (index < 0) return;

	return {
		hint: raw.slice(0, index),
		payload: raw.slice(index + 1)
	};
}
