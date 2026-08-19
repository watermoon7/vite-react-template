/**
 * "X is typing…" — who is typing in which channel, in both directions.
 *
 * Nothing here is persisted or acknowledged: a typing frame is a hint that is only true for
 * the next few seconds. Outgoing frames are rate-limited to one per CHANNELS.typingPingIntervalMs
 * and withdrawn after CHANNELS.typingIdleMs of silence; incoming ones expire on their own
 * after CHANNELS.typingExpiryMs, so a closed tab or a dropped socket cannot leave an
 * indicator stuck on the screen.
 */
import { useSyncExternalStore } from "react";
import { CHANNELS } from "../../app.config";
import type { UserId } from "../shared/types";
import { sendSocket, subscribeSocket } from "./socket";

/** Who is typing in each channel, by channel id. Rebuilt on every change so it can be a snapshot. */
type TypingSnapshot = ReadonlyMap<string, readonly UserId[]>;

const EMPTY_USERS: readonly UserId[] = [];
const EMPTY_SNAPSHOT: TypingSnapshot = new Map();

/** Expiry time (epoch ms) per typing user, per channel. The map is the source of truth. */
const expiries = new Map<string, Map<UserId, number>>();
let snapshot: TypingSnapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();
/** Runs only while somebody is typing, so an idle app has no timer at all. */
let sweepTimer: number | undefined;

function publish(): void {
	const next = new Map<string, readonly UserId[]>();
	for (const [channelId, users] of expiries) {
		if (users.size > 0) next.set(channelId, [...users.keys()]);
	}
	snapshot = next.size === 0 ? EMPTY_SNAPSHOT : next;
	for (const listener of listeners) listener();
}

/** Drops everyone whose indicator has expired. Returns true when something was removed. */
function sweep(): boolean {
	const now = Date.now();
	let changed = false;
	for (const [channelId, users] of expiries) {
		for (const [user, expiresAt] of users) {
			if (expiresAt > now) continue;
			users.delete(user);
			changed = true;
		}
		if (users.size === 0) expiries.delete(channelId);
	}
	return changed;
}

function stopSweeping(): void {
	window.clearInterval(sweepTimer);
	sweepTimer = undefined;
}

function startSweeping(): void {
	if (sweepTimer !== undefined) return;
	sweepTimer = window.setInterval(() => {
		if (sweep()) publish();
		if (expiries.size === 0) stopSweeping();
	}, CHANNELS.typingSweepMs);
}

/** Records (or withdraws) a remote user's typing state in a channel. */
function setRemoteTyping(user: UserId, channelId: string, typing: boolean): void {
	const users = expiries.get(channelId);
	if (!typing) {
		if (!users?.delete(user)) return;
		if (users.size === 0) expiries.delete(channelId);
		publish();
		return;
	}
	const expiresAt = Date.now() + CHANNELS.typingExpiryMs;
	if (users) {
		const known = users.has(user);
		users.set(user, expiresAt);
		if (!known) publish();
	} else {
		expiries.set(channelId, new Map([[user, expiresAt]]));
		publish();
	}
	startSweeping();
}

function clearRemoteTyping(): void {
	if (expiries.size === 0) return;
	expiries.clear();
	stopSweeping();
	publish();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The other users currently typing in `channelId` (reference-stable between changes). */
export function useTypingUsers(channelId: string): readonly UserId[] {
	const users = useSyncExternalStore(subscribe, () => snapshot).get(channelId);
	return users ?? EMPTY_USERS;
}

/** Every channel somebody is typing in, for the sidebar's per-chat indicator. */
export function useTypingChannels(): TypingSnapshot {
	return useSyncExternalStore(subscribe, () => snapshot);
}

// ---------- Outgoing ----------

/** The channel this tab last claimed to be typing in, so it can withdraw the claim. */
let sendingFor: string | null = null;
let lastSentAt = 0;
let idleTimer: number | undefined;

function sendTyping(channelId: string, typing: boolean): void {
	sendSocket({ t: "typing", channelId, typing });
	if (typing) lastSentAt = Date.now();
}

/** Withdraws this tab's indicator in `channelId` (a no-op if it never claimed one). */
export function stopTyping(channelId: string): void {
	if (!channelId) throw new Error("channelId required");
	window.clearTimeout(idleTimer);
	idleTimer = undefined;
	if (sendingFor !== channelId) return;
	sendingFor = null;
	lastSentAt = 0;
	sendTyping(channelId, false);
}

/**
 * Called on every keystroke in a channel's composer. Sends at most one frame per ping
 * interval and schedules the withdrawal, so holding a key down costs nothing extra.
 */
export function notifyTyping(channelId: string): void {
	if (!channelId) throw new Error("channelId required");
	// Switching channels mid-sentence must not leave the indicator on in the old one.
	if (sendingFor !== null && sendingFor !== channelId) stopTyping(sendingFor);
	const now = Date.now();
	if (sendingFor !== channelId || now - lastSentAt >= CHANNELS.typingPingIntervalMs) {
		sendingFor = channelId;
		sendTyping(channelId, true);
	}
	window.clearTimeout(idleTimer);
	idleTimer = window.setTimeout(() => stopTyping(channelId), CHANNELS.typingIdleMs);
}

subscribeSocket((event) => {
	// A dropped socket takes every claim with it, in both directions: the peers' indicators
	// can no longer be refreshed, and the server has forgotten ours, so the next keystroke resends.
	if (event.kind !== "message") {
		clearRemoteTyping();
		sendingFor = null;
		lastSentAt = 0;
		window.clearTimeout(idleTimer);
		idleTimer = undefined;
		return;
	}
	const message = event.message;
	if (message.type !== "typing") return;
	if (typeof message.channelId !== "string" || typeof message.typing !== "boolean") return;
	setRemoteTyping(message.user, message.channelId, message.typing);
});
