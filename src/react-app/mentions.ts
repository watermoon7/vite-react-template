/**
 * @mentions in chat messages. A mention is "@" followed by a user's id or display name
 * (case-insensitively), so both "@will" and "@Will" name the same person. The set of users
 * is fixed and tiny, so matching is a single generated regex rather than an index — and the
 * same regex is what the composer's autocomplete completes towards.
 */
import { USERS } from "../../app.config";
import type { UserId } from "../shared/types";

/** One run of message text: plain, or a mention of `user`. */
export interface MentionRun {
	text: string;
	/** Present when the run is a mention. */
	user?: UserId;
}

/** A user as the mention autocomplete offers them. */
export interface MentionCandidate {
	id: UserId;
	name: string;
}

/** Where the caret is sitting inside a half-typed "@…", for the autocomplete. */
export interface MentionQuery {
	/** Index of the "@" in the text. */
	start: number;
	/** What has been typed after the "@", lowercased; "" right after the "@" itself. */
	query: string;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every spelling that names a user, longest first so "@theodore" cannot match a shorter alias. */
const TOKENS: readonly { token: string; user: UserId }[] = USERS.flatMap((u) => [
	{ token: u.name, user: u.id as UserId },
	{ token: u.id as UserId, user: u.id as UserId },
])
	.filter((entry, index, all) => all.findIndex((e) => e.token.toLowerCase() === entry.token.toLowerCase()) === index)
	.sort((a, b) => b.token.length - a.token.length);

/** Longest spelling we would ever complete; bounds the look-back for a half-typed mention. */
const LONGEST_TOKEN = TOKENS.reduce((longest, t) => Math.max(longest, t.token.length), 0);

/**
 * "@" + any spelling of a user, not followed by another word character — so "@willow" is
 * not a mention of "will". A leading (?<![\w@]) keeps "e@will.com" and "@@will" out.
 */
const MENTION_PATTERN = new RegExp(`(?<![\\w@])@(${TOKENS.map((t) => escapeRegExp(t.token)).join("|")})(?!\\w)`, "gi");

function userOfToken(token: string): UserId | null {
	const lower = token.toLowerCase();
	return TOKENS.find((t) => t.token.toLowerCase() === lower)?.user ?? null;
}

/** The display name a mention is written with, i.e. what the composer inserts. */
export function mentionText(user: UserId): string {
	const found = USERS.find((u) => u.id === user);
	return `@${found ? found.name : user}`;
}

/**
 * Splits plain text into ordinary runs and mention runs, in order. Concatenating the runs'
 * `text` reproduces the input, so this composes with the link splitter.
 */
export function splitMentions(text: string): MentionRun[] {
	if (typeof text !== "string") throw new Error("text must be a string");
	if (!text) return [];
	const runs: MentionRun[] = [];
	let cursor = 0;
	for (const match of text.matchAll(MENTION_PATTERN)) {
		const user = userOfToken(match[1]);
		if (!user) continue;
		if (match.index > cursor) runs.push({ text: text.slice(cursor, match.index) });
		runs.push({ text: match[0], user });
		cursor = match.index + match[0].length;
	}
	if (cursor < text.length) runs.push({ text: text.slice(cursor) });
	return runs;
}

/** True when `text` mentions `user`. Used to tint the messages addressed to the reader. */
export function mentionsUser(text: string, user: UserId): boolean {
	if (!user) throw new Error("user is required");
	if (!text) return false;
	// matchAll consumes the shared regex's lastIndex; a fresh iteration each call resets it.
	for (const match of text.matchAll(MENTION_PATTERN)) {
		if (userOfToken(match[1]) === user) return true;
	}
	return false;
}

/**
 * The "@…" the caret is currently inside, or null. The "@" must open a word (start of the
 * text or after whitespace) and nothing between it and the caret may be whitespace, so a
 * mention that has already been typed past no longer offers completions.
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
	if (typeof text !== "string") throw new Error("text must be a string");
	if (!Number.isInteger(caret) || caret < 0 || caret > text.length) return null;
	// Bounded by the longest name we would ever complete; a long word cannot be a mention.
	const floor = Math.max(0, caret - (LONGEST_TOKEN + 1));
	for (let i = caret - 1; i >= floor; i--) {
		const ch = text[i];
		if (/\s/.test(ch)) return null;
		if (ch !== "@") continue;
		const before = i === 0 ? "" : text[i - 1];
		if (before !== "" && !/\s/.test(before)) return null;
		return { start: i, query: text.slice(i + 1, caret).toLowerCase() };
	}
	return null;
}

/** Users whose id or name starts with `query` (all of them when it is empty). */
export function matchingUsers(query: string): MentionCandidate[] {
	const lower = query.toLowerCase();
	return USERS.filter((u) => u.id.toLowerCase().startsWith(lower) || u.name.toLowerCase().startsWith(lower)).map(
		(u) => ({ id: u.id as UserId, name: u.name }),
	);
}

/**
 * The text and caret position after completing the mention that starts at `start` and runs
 * to `caret` with `user`. A trailing space is added so the next word is not glued to it.
 */
export function completeMention(
	text: string,
	start: number,
	caret: number,
	user: UserId,
): { text: string; caret: number } {
	if (start < 0 || caret < start || caret > text.length) throw new Error("invalid mention range");
	const inserted = `${mentionText(user)} `;
	return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length };
}
