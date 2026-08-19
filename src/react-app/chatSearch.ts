/**
 * Message search across every chat. Like the task search, the client already holds every
 * message, so this is a plain filter over what is in memory — no request, no index, and a
 * result on the keystroke.
 *
 * A query is whitespace-separated tokens, all of which must match. A plain token matches
 * anywhere in the message text. A `field:value` token narrows instead (see CHAT_FILTER_HELP):
 * `from:` picks an author, `type:` picks message / file / link. A token with an unknown
 * field or value is treated as plain text, so "http:" still searches for "http:".
 */
import { CLIENT, USERS } from "../../app.config";
import type { Channel, Message, UserId } from "../shared/types";
import { splitLinks } from "./linkify";

export interface ChatHit {
	message: Message;
	/** The part of the message to show in the result list, already trimmed to length. */
	snippet: string;
	/** True when the message carries an image rather than (or as well as) text. */
	hasImage: boolean;
}

export interface ChatSearchGroup {
	channel: Channel;
	/** Matching messages, newest first. */
	hits: ChatHit[];
}

export interface ChatSearchResults {
	/** Channels with at least one listed hit, most recently active first. */
	groups: ChatSearchGroup[];
	/** Hits listed, after the cap. */
	shown: number;
	/** Hits found, before the cap. */
	total: number;
}

/** The message kinds `type:` accepts. */
const TYPES = ["message", "file", "link"] as const;

/** Human-readable summary of what a chat query matches, for the search box tooltip. */
export const CHAT_FILTER_HELP =
	`Matches the message text. All words must match. To narrow: from:${USERS[0].id} (author), ` +
	`type:file (has an image), type:link (contains a link), type:message (plain text only).`;

type Predicate = (message: Message) => boolean;

/** True when the message text contains at least one http(s) link. */
function hasLink(message: Message): boolean {
	return message.text.length > 0 && splitLinks(message.text).some((run) => run.href !== undefined);
}

/**
 * Turns one `field:value` token into a message predicate, or null when the field or value
 * is not recognised (the caller then treats the token as ordinary text).
 */
function parseFilter(field: string, value: string): Predicate | null {
	if (!value) return null;
	switch (field) {
		case "from": {
			const users = USERS.filter((u) => u.id.startsWith(value) || u.name.toLowerCase().startsWith(value));
			if (users.length === 0) return null;
			const accepted = new Set<UserId>(users.map((u) => u.id as UserId));
			return (m) => accepted.has(m.author);
		}
		case "type": {
			const kind = TYPES.find((t) => t.startsWith(value));
			if (!kind) return null;
			if (kind === "file") return (m) => m.imageId !== null;
			if (kind === "link") return hasLink;
			return (m) => m.imageId === null && !hasLink(m);
		}
		default:
			return null;
	}
}

/** Splits a lowercased query into text terms and field predicates. */
function parseQuery(query: string): { terms: string[]; predicates: Predicate[] } {
	const terms: string[] = [];
	const predicates: Predicate[] = [];
	for (const token of query.split(/\s+/).filter(Boolean)) {
		const colon = token.indexOf(":");
		const predicate = colon > 0 ? parseFilter(token.slice(0, colon), token.slice(colon + 1)) : null;
		if (predicate) predicates.push(predicate);
		else terms.push(token);
	}
	return { terms, predicates };
}

/**
 * A window of the message text around the first matching term, ellipsised at either end
 * when it was cut. Without terms (a filters-only query) the window starts at the beginning.
 */
function snippetOf(text: string, terms: string[]): string {
	const width = CLIENT.chatSearch.snippetLength;
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= width) return collapsed;
	const lower = collapsed.toLowerCase();
	const found = terms.length === 0 ? -1 : terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? -1;
	// Centre the window on the match, then pull it back inside the text at either end.
	const wanted = found < 0 ? 0 : Math.max(0, found - Math.floor(width / 3));
	const start = Math.min(wanted, collapsed.length - width);
	const end = start + width;
	return `${start > 0 ? "…" : ""}${collapsed.slice(start, end).trim()}${end < collapsed.length ? "…" : ""}`;
}

/** Every term must appear in the haystack for the message to match. */
function matches(haystack: string, terms: string[]): boolean {
	for (const term of terms) {
		if (!haystack.includes(term)) return false;
	}
	return true;
}

/**
 * Messages matching `query`, newest first and grouped by channel. Returns null when the
 * query is too short to search, which is the caller's signal to show the chat list instead.
 */
export function searchMessages(query: string, channels: Channel[], messages: Message[]): ChatSearchResults | null {
	if (!Array.isArray(channels) || !Array.isArray(messages)) throw new Error("channels and messages must be arrays");
	const trimmed = query.trim().toLowerCase();
	if (trimmed.length < CLIENT.chatSearch.minQueryLength) return null;

	const { terms, predicates } = parseQuery(trimmed);
	if (terms.length === 0 && predicates.length === 0) return null;

	const byId = new Map(channels.map((c) => [c.id, c]));
	const found: Message[] = [];
	for (const message of messages) {
		if (!byId.has(message.channelId)) continue; // a message of a channel that is being deleted
		if (!matches(message.text.toLowerCase(), terms)) continue;
		if (!predicates.every((accepts) => accepts(message))) continue;
		found.push(message);
	}

	// Newest first, then capped: in a chat the recent matches are the ones being looked for.
	found.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	const listed = found.slice(0, CLIENT.chatSearch.maxResults);

	// Grouped in the order the hits already have, so the most recently active chat leads.
	const groups: ChatSearchGroup[] = [];
	const groupOf = new Map<string, ChatSearchGroup>();
	for (const message of listed) {
		const channel = byId.get(message.channelId);
		if (!channel) continue;
		const hit: ChatHit = {
			message,
			snippet: snippetOf(message.text, terms),
			hasImage: message.imageId !== null,
		};
		const existing = groupOf.get(channel.id);
		if (existing) {
			existing.hits.push(hit);
			continue;
		}
		const group: ChatSearchGroup = { channel, hits: [hit] };
		groupOf.set(channel.id, group);
		groups.push(group);
	}
	return { groups, shown: listed.length, total: found.length };
}
