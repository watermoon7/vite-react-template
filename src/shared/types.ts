/** Types shared between the Worker and the React app. Derived from app.config.ts where possible. */
import { COLUMNS, PRIORITIES, USERS } from "../../app.config";

export type UserId = (typeof USERS)[number]["id"];
export type ColumnId = (typeof COLUMNS)[number]["id"];
export type Priority = (typeof PRIORITIES)[number]["id"];
export type Assignee = UserId | "both";

export interface Board {
	id: string;
	name: string;
	position: number;
	createdAt: string;
	updatedAt: string;
}

/** One subtask in a task's checklist. Ids are made by the client that adds the item. */
export interface ChecklistItem {
	id: string;
	text: string;
	done: boolean;
}

export interface Task {
	id: string;
	boardId: string;
	status: ColumnId;
	position: number;
	description: string;
	notes: string;
	priority: Priority | null;
	/** ISO date (YYYY-MM-DD) or null. */
	dueDate: string | null;
	assignee: Assignee;
	/** Subtasks, in display order. Empty for a task that has none. */
	checklist: ChecklistItem[];
	createdAt: string;
	updatedAt: string;
	updatedBy: UserId;
}

/** A text channel: a shared, chronological message log. */
export interface Channel {
	id: string;
	name: string;
	position: number;
	createdAt: string;
}

/** One post in a channel. `imageId` names an image served at /api/files/<imageId>. */
export interface Message {
	id: string;
	channelId: string;
	author: UserId;
	text: string;
	imageId: string | null;
	createdAt: string;
	/** When the author last edited the text, or null if they never did. */
	editedAt: string | null;
}

/** One song in the shared playlist. The audio itself lives in R2 under `id`. */
export interface Song {
	id: string;
	title: string;
	/** Stored MIME type, as sniffed from the file's own bytes. */
	mime: string;
	sizeBytes: number;
	/** Length in seconds as measured by the uploading browser, or null if it could not be read. */
	durationSeconds: number | null;
	addedBy: UserId;
	position: number;
	createdAt: string;
}

/**
 * The one shared playback state. `positionMs` is where the song was at `updatedAtMs`
 * (a server epoch timestamp), so a client that knows the server clock can work out where
 * the song should be right now without anything ticking over the wire.
 */
export interface Playback {
	songId: string | null;
	playing: boolean;
	positionMs: number;
	/** Server epoch milliseconds at which `positionMs` was true. */
	updatedAtMs: number;
	updatedBy: UserId | null;
}

/** Full application state; identical for both users. */
export interface AppState {
	/** Monotonic counter bumped on every mutation; clients ignore stale states. */
	version: number;
	boards: Board[];
	tasks: Task[];
	channels: Channel[];
	/** All messages of all channels, oldest first. */
	messages: Message[];
	/** The shared playlist, in play order. */
	songs: Song[];
	playback: Playback;
}

// ---------- Voice room ----------

/** One ICE server as handed to RTCPeerConnection. Mirrors the browser's RTCIceServer. */
export interface IceServer {
	urls: string | string[];
	username?: string;
	credential?: string;
}

/** One user currently sitting in the voice room. */
export interface VoiceMember {
	user: UserId;
	/** Server epoch milliseconds at which this user joined. */
	joinedAt: number;
	muted: boolean;
	/** True while this user is sharing a screen. */
	sharing: boolean;
}

/** Commands a client sends over the WebSocket. Everything else still goes through /api. */
export type ClientMessage =
	/** Clock round trip: `c` is the client's send time; the server echoes it with its own. */
	| { t: "time"; c: number }
	| { t: "voice-join" }
	| { t: "voice-leave" }
	| { t: "voice-mute"; muted: boolean }
	/** "I am / am no longer typing in this channel." Relayed to the other user, never stored. */
	| { t: "typing"; channelId: string; typing: boolean }
	| { t: "voice-screen"; sharing: boolean }
	/** WebRTC signalling (SDP or ICE) for the other user; the server only relays it. */
	| { t: "voice-signal"; to: UserId; data: unknown };

/** Messages the server pushes over the WebSocket. */
export type ServerMessage =
	| { type: "state"; state: AppState }
	| { type: "time"; c: number; s: number }
	| { type: "voice"; room: VoiceMember[] }
	| { type: "voice-signal"; from: UserId; data: unknown }
	/** The other user started or stopped typing in a channel. */
	| { type: "typing"; user: UserId; channelId: string; typing: boolean }
	/** This tab was removed from the room because the same user joined from another tab. */
	| { type: "voice-evicted" };

/** A change to the shared playback state, as sent by a client to POST /api/playback. */
export type PlaybackCommand =
	/** Start (or resume) playback. `songId` switches song; `positionMs` starts at a point. */
	| { action: "play"; songId?: string; positionMs?: number }
	| { action: "pause" }
	| { action: "seek"; positionMs: number }
	/** Move the position by `deltaMs` (negative goes back), keeping the playing/paused state. */
	| { action: "skip"; deltaMs: number }
	/**
	 * Go to the next song. `fromSongId` makes the command conditional on that song still
	 * being the current one, so both browsers can send it when a song ends without skipping two.
	 */
	| { action: "next"; fromSongId?: string }
	| { action: "previous" };

/** Fields of a task that clients may edit. */
export interface TaskPatch {
	description?: string;
	notes?: string;
	priority?: Priority | null;
	dueDate?: string | null;
	assignee?: Assignee;
	/** The whole checklist, replaced at once: subtasks are edited as one list, not row by row. */
	checklist?: ChecklistItem[];
}

/** Ordered task ids per column for one board, as sent by the client after a drag. */
export type ColumnOrder = Partial<Record<ColumnId, string[]>>;

/** Payload of a local backup snapshot and of a restore request. */
export interface BackupData {
	boards: Board[];
	tasks: Task[];
}

export interface RestoreResult {
	restoredBoards: number;
	restoredTasks: number;
}

export const USER_IDS: readonly UserId[] = USERS.map((u) => u.id);
export const COLUMN_IDS: readonly ColumnId[] = COLUMNS.map((c) => c.id);
/** The last column counts as done: its tasks are tinted green and are never overdue. */
export const DONE_COLUMN: ColumnId = COLUMNS[COLUMNS.length - 1].id;
export const PRIORITY_IDS: readonly Priority[] = PRIORITIES.map((p) => p.id);
export const ASSIGNEES: readonly Assignee[] = [...USER_IDS, "both"];

export function isUserId(value: unknown): value is UserId {
	return typeof value === "string" && (USER_IDS as readonly string[]).includes(value);
}
export function isColumnId(value: unknown): value is ColumnId {
	return typeof value === "string" && (COLUMN_IDS as readonly string[]).includes(value);
}
export function isPriority(value: unknown): value is Priority {
	return typeof value === "string" && (PRIORITY_IDS as readonly string[]).includes(value);
}
export function isAssignee(value: unknown): value is Assignee {
	return typeof value === "string" && (ASSIGNEES as readonly string[]).includes(value);
}

/** Playback state used before anyone has pressed play. */
export const IDLE_PLAYBACK: Playback = {
	songId: null,
	playing: false,
	positionMs: 0,
	updatedAtMs: 0,
	updatedBy: null,
};

/** The other user of the pair, from the point of view of `user`. */
export function otherUser(user: UserId): UserId | null {
	return USER_IDS.find((id) => id !== user) ?? null;
}

