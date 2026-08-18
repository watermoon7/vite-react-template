/**
 * Session cookies (HMAC-signed, stateless) and password verification.
 * Passwords live in Worker secrets named by app.config USERS[].passwordSecret.
 */
import { AUTH, USERS } from "../../app.config";
import { isUserId, type UserId } from "../shared/types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encodes bytes as unpadded base64url. */
function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let binary = "";
	for (const b of view) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decodes unpadded base64url to bytes; returns null on malformed input. */
function fromBase64Url(text: string): Uint8Array | null {
	if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
	const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
	try {
		const binary = atob(padded);
		return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
	} catch {
		return null;
	}
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	if (!secret) throw new Error("SESSION_SECRET is not configured");
	return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
		"verify",
	]);
}

/** Creates a signed session token for `user`, valid for AUTH.sessionTtlDays. */
export async function createSessionToken(user: UserId, secret: string, now = Date.now()): Promise<string> {
	if (!isUserId(user)) throw new Error("unknown user");
	const expiresAt = now + AUTH.sessionTtlDays * 24 * 60 * 60 * 1000;
	const body = toBase64Url(encoder.encode(JSON.stringify({ u: user, exp: expiresAt })));
	const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
	return `${body}.${toBase64Url(signature)}`;
}

/** Verifies a session token; returns the user id or null if missing, tampered, or expired. */
export async function verifySessionToken(
	token: string | undefined,
	secret: string,
	now = Date.now(),
): Promise<UserId | null> {
	if (!token || !secret) return null;
	const dot = token.indexOf(".");
	if (dot <= 0) return null;
	const body = token.slice(0, dot);
	const signature = fromBase64Url(token.slice(dot + 1));
	const bodyBytes = fromBase64Url(body);
	if (!signature || !bodyBytes) return null;
	const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), signature, encoder.encode(body));
	if (!valid) return null;
	try {
		const payload = JSON.parse(decoder.decode(bodyBytes)) as { u?: unknown; exp?: unknown };
		if (typeof payload.exp !== "number" || payload.exp <= now) return null;
		return isUserId(payload.u) ? payload.u : null;
	} catch {
		return null;
	}
}

/** Constant-time string comparison (compares SHA-256 digests so lengths never leak). */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
	const [da, db] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(a)),
		crypto.subtle.digest("SHA-256", encoder.encode(b)),
	]);
	const va = new Uint8Array(da);
	const vb = new Uint8Array(db);
	let diff = 0;
	for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
	return diff === 0;
}

/**
 * Checks a username/password pair against the configured users and secrets.
 * Returns the matched user id, or null. Always performs a comparison so timing
 * does not reveal whether the username exists.
 */
export async function verifyPassword(
	secrets: Record<string, string | undefined>,
	username: string,
	password: string,
): Promise<UserId | null> {
	const needle = username.trim().toLowerCase();
	const user = USERS.find((u) => u.id === needle || u.name.toLowerCase() === needle);
	const expected = user ? secrets[user.passwordSecret] : undefined;
	const matches = await constantTimeEqual(password, expected ?? "");
	if (!user || !expected || password.length === 0) return null;
	return matches ? user.id : null;
}
