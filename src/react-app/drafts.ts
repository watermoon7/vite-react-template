/**
 * Unsent chat drafts, per channel. The text lives in localStorage so switching channels or
 * reloading never loses what was typed; a pending image stays in memory only, because a
 * data URL can be megabytes — far too big to keep in storage next to the backups.
 */
import { CLIENT } from "../../app.config";

const KEY = CLIENT.storageKeys.chatDrafts;

/** Pending image (data URL) per channel id, for this page load only. */
const images = new Map<string, string>();

/** All saved draft texts by channel id; anything malformed in storage is ignored. */
function readAll(): Record<string, string> {
	try {
		const raw = localStorage.getItem(KEY);
		if (raw === null) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		const drafts: Record<string, string> = {};
		for (const [id, text] of Object.entries(parsed)) {
			if (typeof text === "string" && text) drafts[id] = text;
		}
		return drafts;
	} catch {
		return {};
	}
}

function writeAll(drafts: Record<string, string>): void {
	try {
		if (Object.keys(drafts).length === 0) localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, JSON.stringify(drafts));
	} catch {
		// Storage full or unavailable: the draft still lives in the composer for this page load.
	}
}

/** The saved draft text for a channel, or "" when there is none. */
export function loadDraftText(channelId: string): string {
	if (!channelId) throw new Error("channelId required");
	return readAll()[channelId] ?? "";
}

/** Saves the draft text for a channel; empty text removes the entry. */
export function saveDraftText(channelId: string, text: string): void {
	if (!channelId) throw new Error("channelId required");
	const drafts = readAll();
	if (text) drafts[channelId] = text;
	else delete drafts[channelId];
	writeAll(drafts);
}

/** The pending image (data URL) for a channel, or null. */
export function loadDraftImage(channelId: string): string | null {
	if (!channelId) throw new Error("channelId required");
	return images.get(channelId) ?? null;
}

/** Sets or clears (null) the pending image for a channel. */
export function saveDraftImage(channelId: string, image: string | null): void {
	if (!channelId) throw new Error("channelId required");
	if (image) images.set(channelId, image);
	else images.delete(channelId);
}

/** Drops the drafts of channels that no longer exist. */
export function pruneDrafts(liveChannelIds: readonly string[]): void {
	if (!Array.isArray(liveChannelIds)) throw new Error("liveChannelIds must be an array");
	const live = new Set(liveChannelIds);
	const drafts = readAll();
	const stale = Object.keys(drafts).filter((id) => !live.has(id));
	for (const id of stale) delete drafts[id];
	if (stale.length > 0) writeAll(drafts);
	for (const id of [...images.keys()]) {
		if (!live.has(id)) images.delete(id);
	}
}
