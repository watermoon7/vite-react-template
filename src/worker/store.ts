/**
 * KanbanStore — a single SQLite-backed Durable Object holding all boards, tasks, channels,
 * messages, message images, the shared playlist and the shared playback state. Exposes typed
 * RPC methods for the Worker and a WebSocket endpoint that pushes the full state to every
 * connected client after each mutation.
 *
 * The socket also carries two things that are not persisted state: a clock round trip (so the
 * two music players can agree on where a song is) and the voice room — membership is simply
 * which live sockets say they are in it, plus a relay for the peers' WebRTC signalling.
 */
import { DurableObject } from "cloudflare:workers";
import { AUTH, COLUMNS, DEFAULT_ASSIGNEE, MUSIC } from "../../app.config";
import {
	IDLE_PLAYBACK,
	USER_IDS,
	type AppState,
	type BackupData,
	type Board,
	type Channel,
	type ChecklistItem,
	type ClientMessage,
	type ColumnOrder,
	type Message,
	type Playback,
	type PlaybackCommand,
	type RestoreResult,
	type ServerMessage,
	type Song,
	type Task,
	type TaskPatch,
	type UserId,
	type VoiceMember,
} from "../shared/types";

/** Thrown by mutations that reference a missing board/task/channel/message; the Worker maps it to 404. */
export const NOT_FOUND = "NOT_FOUND";
/** Thrown when a user tries to change something that is not theirs; the Worker maps it to 403. */
export const FORBIDDEN = "FORBIDDEN";

/** An image attached to a message, as stored and as served. */
export interface StoredFile {
	mime: string;
	bytes: ArrayBuffer;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT OR IGNORE INTO meta (key, value) VALUES ('version', 0);
CREATE TABLE IF NOT EXISTS boards (
	id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
	created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
	id TEXT PRIMARY KEY, board_id TEXT NOT NULL, status TEXT NOT NULL, position INTEGER NOT NULL,
	description TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', priority TEXT,
	due_date TEXT, assignee TEXT NOT NULL, checklist TEXT NOT NULL DEFAULT '[]',
	created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tasks_board_idx ON tasks (board_id);
CREATE TABLE IF NOT EXISTS channels (
	id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
	id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
	image_id TEXT, created_at TEXT NOT NULL, edited_at TEXT);
CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages (channel_id);
CREATE TABLE IF NOT EXISTS files (
	id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_failures (
	ip TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS songs (
	id TEXT PRIMARY KEY, title TEXT NOT NULL, r2_key TEXT NOT NULL, mime TEXT NOT NULL,
	size_bytes INTEGER NOT NULL, duration_seconds REAL, added_by TEXT NOT NULL,
	position INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS playback (
	id INTEGER PRIMARY KEY CHECK (id = 1), song_id TEXT, playing INTEGER NOT NULL,
	position_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, updated_by TEXT);
INSERT OR IGNORE INTO playback (id, song_id, playing, position_ms, updated_at_ms, updated_by)
	VALUES (1, NULL, 0, 0, 0, NULL);
`;

type BoardRow = { id: string; name: string; position: number; created_at: string; updated_at: string };
type TaskRow = {
	id: string;
	board_id: string;
	status: Task["status"];
	position: number;
	description: string;
	notes: string;
	priority: Task["priority"];
	due_date: string | null;
	assignee: Task["assignee"];
	/** The checklist as stored: a JSON array of {id, text, done}. */
	checklist: string;
	created_at: string;
	updated_at: string;
	updated_by: UserId;
};

type ChannelRow = { id: string; name: string; position: number; created_at: string };
type MessageRow = {
	id: string;
	channel_id: string;
	author: UserId;
	text: string;
	image_id: string | null;
	created_at: string;
	edited_at: string | null;
};

type SongRow = {
	id: string;
	title: string;
	r2_key: string;
	mime: string;
	size_bytes: number;
	duration_seconds: number | null;
	added_by: UserId;
	position: number;
	created_at: string;
};

type PlaybackRow = {
	song_id: string | null;
	playing: number;
	position_ms: number;
	updated_at_ms: number;
	updated_by: UserId | null;
};

function rowToSong(r: SongRow): Song {
	return {
		id: r.id,
		title: r.title,
		mime: r.mime,
		sizeBytes: r.size_bytes,
		durationSeconds: r.duration_seconds,
		addedBy: r.added_by,
		position: r.position,
		createdAt: r.created_at,
	};
}

function rowToPlayback(r: PlaybackRow): Playback {
	return {
		songId: r.song_id,
		playing: r.playing !== 0,
		positionMs: r.position_ms,
		updatedAtMs: r.updated_at_ms,
		updatedBy: r.updated_by,
	};
}

function rowToBoard(r: BoardRow): Board {
	return { id: r.id, name: r.name, position: r.position, createdAt: r.created_at, updatedAt: r.updated_at };
}

function rowToChannel(r: ChannelRow): Channel {
	return { id: r.id, name: r.name, position: r.position, createdAt: r.created_at };
}

function rowToMessage(r: MessageRow): Message {
	return {
		id: r.id,
		channelId: r.channel_id,
		author: r.author,
		text: r.text,
		imageId: r.image_id,
		createdAt: r.created_at,
		editedAt: r.edited_at,
	};
}

/**
 * Reads a stored checklist. Anything that is not the JSON array this build writes counts as
 * an empty list: a task with an unreadable checklist still has to open.
 */
function parseStoredChecklist(raw: string): ChecklistItem[] {
	if (!raw) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter(
		(item): item is ChecklistItem =>
			typeof item === "object" &&
			item !== null &&
			typeof (item as ChecklistItem).id === "string" &&
			typeof (item as ChecklistItem).text === "string" &&
			typeof (item as ChecklistItem).done === "boolean",
	);
}

function rowToTask(r: TaskRow): Task {
	return {
		id: r.id,
		boardId: r.board_id,
		status: r.status,
		position: r.position,
		description: r.description,
		notes: r.notes,
		priority: r.priority,
		dueDate: r.due_date,
		assignee: r.assignee,
		checklist: parseStoredChecklist(r.checklist),
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		updatedBy: r.updated_by,
	};
}

/**
 * Columns added to an existing database by a later build. SQLite has no
 * "ADD COLUMN IF NOT EXISTS", so each is added only when the table is missing it — which a
 * database created from SCHEMA above never is.
 */
const ADDED_COLUMNS: [table: string, column: string, definition: string][] = [
	["tasks", "checklist", "TEXT NOT NULL DEFAULT '[]'"],
	["messages", "edited_at", "TEXT"],
];

const FIRST_COLUMN = COLUMNS[0].id;

/**
 * What each accepted socket carries. `voice` is non-null exactly while that tab is in the
 * voice room, which makes the room self-cleaning: a closed socket takes its membership with it.
 */
interface SocketAttachment {
	user: UserId;
	voice: { joinedAt: number; muted: boolean; sharing: boolean } | null;
}

function readAttachment(ws: WebSocket): SocketAttachment | null {
	const value = ws.deserializeAttachment() as SocketAttachment | null;
	if (!value || typeof value !== "object" || !USER_IDS.includes(value.user)) return null;
	return value;
}

function writeAttachment(ws: WebSocket, attachment: SocketAttachment): void {
	ws.serializeAttachment(attachment);
}

/** Sends one server message, ignoring a socket that has already gone away. */
function send(ws: WebSocket, message: ServerMessage): void {
	try {
		ws.send(JSON.stringify(message));
	} catch {
		// Socket already gone; the runtime cleans it up.
	}
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}

/** A song as handed to the store once its bytes are safely in R2. */
export interface NewSong {
	id: string;
	r2Key: string;
	title: string;
	mime: string;
	sizeBytes: number;
	durationSeconds: number | null;
}

/** One entry of the playlist, as the playback rules need it. */
type PlaylistEntry = { id: string; durationMs: number | null };

/** Where the current song is right now, given a playback state and the server clock. */
function positionNow(playback: Playback, durationMs: number | null, now: number): number {
	const elapsed = playback.playing ? Math.max(0, now - playback.updatedAtMs) : 0;
	return clamp(playback.positionMs + elapsed, 0, durationMs ?? Number.MAX_SAFE_INTEGER);
}

function entryOf(playlist: PlaylistEntry[], songId: string | null): PlaylistEntry | undefined {
	return songId === null ? undefined : playlist.find((entry) => entry.id === songId);
}

/**
 * Playback after moving `steps` songs from `songId`. Falling off either end stops playback
 * at the start of the song we stopped on, which is what "the playlist finished" should feel like.
 */
function stepTo(playlist: PlaylistEntry[], songId: string | null, steps: number, playing: boolean, now: number, user: UserId): Playback {
	const index = playlist.findIndex((entry) => entry.id === songId);
	const target = index + steps;
	const inRange = target >= 0 && target < playlist.length;
	const landed = inRange ? playlist[target].id : (playlist[clamp(target, 0, playlist.length - 1)]?.id ?? null);
	return { songId: landed, playing: playing && inRange, positionMs: 0, updatedAtMs: now, updatedBy: user };
}

/**
 * The shared playback state after a client command. Pure so the rules are all in one place:
 * every branch returns a complete state stamped with the server clock, which is what the
 * clients extrapolate their own position from.
 */
function applyPlaybackCommand(
	current: Playback,
	playlist: PlaylistEntry[],
	command: PlaybackCommand,
	now: number,
	user: UserId,
): Playback {
	if (playlist.length === 0) return { ...IDLE_PLAYBACK, updatedAtMs: now };
	const entry = entryOf(playlist, current.songId);
	const durationMs = entry?.durationMs ?? null;
	const here = positionNow(current, durationMs, now);
	switch (command.action) {
		case "play": {
			const requested = command.songId ?? current.songId;
			const target = entryOf(playlist, requested) ?? playlist[0];
			const changingSong = target.id !== current.songId;
			// Resuming a song that already ran to its end starts it again rather than doing nothing.
			const atEnd = durationMs !== null && here >= durationMs - 250;
			const resumeAt = changingSong || atEnd ? 0 : here;
			const positionMs = clamp(command.positionMs ?? resumeAt, 0, target.durationMs ?? Number.MAX_SAFE_INTEGER);
			return { songId: target.id, playing: true, positionMs, updatedAtMs: now, updatedBy: user };
		}
		case "pause":
			return { ...current, playing: false, positionMs: here, updatedAtMs: now, updatedBy: user };
		case "seek":
			return {
				...current,
				positionMs: clamp(command.positionMs, 0, durationMs ?? Number.MAX_SAFE_INTEGER),
				updatedAtMs: now,
				updatedBy: user,
			};
		case "skip":
			return {
				...current,
				positionMs: clamp(here + command.deltaMs, 0, durationMs ?? Number.MAX_SAFE_INTEGER),
				updatedAtMs: now,
				updatedBy: user,
			};
		case "next":
			// Both browsers send this when a song ends; the second one is a no-op because the
			// song it was reacting to is no longer the current one.
			if (command.fromSongId !== undefined && command.fromSongId !== current.songId) return current;
			return stepTo(playlist, current.songId, 1, true, now, user);
		case "previous":
			// Part-way into a song, "previous" restarts it — as every other player does.
			if (here > MUSIC.previousRestartsAfterSeconds * 1000) {
				return { ...current, positionMs: 0, updatedAtMs: now, updatedBy: user };
			}
			return stepTo(playlist, current.songId, -1, current.playing, now, user);
		default:
			return current;
	}
}


export class KanbanStore extends DurableObject<Env> {
	private readonly sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		ctx.blockConcurrencyWhile(async () => {
			this.sql.exec(SCHEMA);
			this.addMissingColumns();
		});
		// Answer keep-alive pings without waking the object.
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
	}

	/** Brings a database created by an earlier build up to the current schema. */
	private addMissingColumns(): void {
		for (const [table, column, definition] of ADDED_COLUMNS) {
			const columns = this.sql.exec<{ name: string }>(`PRAGMA table_info(${table})`).toArray();
			if (columns.length === 0) throw new Error(`cannot migrate unknown table: ${table}`);
			if (columns.some((c) => c.name === column)) continue;
			this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
		}
	}

	// ---------- WebSocket (fetch is only used for the upgrade) ----------

	/** Accepts a WebSocket upgrade for the user named in the `x-kanban-user` header. */
	override async fetch(request: Request): Promise<Response> {
		const user = request.headers.get("x-kanban-user") as UserId | null;
		if (request.headers.get("Upgrade") !== "websocket" || !user || !USER_IDS.includes(user)) {
			return new Response("expected websocket", { status: 426 });
		}
		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];
		// Tag the socket with the user so broadcasts can be built per user.
		this.ctx.acceptWebSocket(server, [user]);
		// The attachment survives hibernation and is the only record of who is in the voice room.
		writeAttachment(server, { user, voice: null });
		// Frames sent now are queued until the client side of the pair is open.
		send(server, { type: "voice", room: this.voiceRoom() });
		return new Response(null, { status: 101, webSocket: client });
	}

	/** Handles the clock round trip and the voice-room commands; everything else goes through /api. */
	override async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
		if (typeof raw !== "string") return; // only JSON text frames are understood
		let message: ClientMessage;
		try {
			message = JSON.parse(raw) as ClientMessage;
		} catch {
			return; // malformed frame
		}
		if (typeof message !== "object" || message === null || typeof message.t !== "string") return;
		const attachment = readAttachment(ws);
		if (!attachment) return; // socket accepted before this build, or attachment lost
		switch (message.t) {
			case "time":
				// Echo the client's send time back beside ours so it can subtract the round trip.
				if (typeof message.c === "number") send(ws, { type: "time", c: message.c, s: Date.now() });
				return;
			case "voice-join":
				this.joinVoice(ws, attachment);
				return;
			case "voice-leave":
				this.leaveVoice(ws, attachment);
				return;
			case "voice-mute":
				if (typeof message.muted === "boolean") this.updateVoice(ws, attachment, { muted: message.muted });
				return;
			case "voice-screen":
				if (typeof message.sharing === "boolean") this.updateVoice(ws, attachment, { sharing: message.sharing });
				return;
			case "voice-signal":
				this.relaySignal(attachment, message.to, message.data);
				return;
			case "typing":
				if (typeof message.channelId === "string" && typeof message.typing === "boolean") {
					this.relayTyping(attachment.user, message.channelId, message.typing);
				}
				return;
			default:
				return; // unknown command from a newer client
		}
	}

	override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
		this.forgetVoice(ws);
		try {
			// 1005/1006 are reserved and cannot be sent back.
			ws.close(code === 1005 || code === 1006 ? 1000 : code, "closed");
		} catch {
			// already closed
		}
	}

	override async webSocketError(ws: WebSocket): Promise<void> {
		this.forgetVoice(ws);
		try {
			ws.close(1011, "error");
		} catch {
			// already closed
		}
	}

	/** Pushes the current state to every connected socket, built per user. */
	private broadcast(): void {
		for (const user of USER_IDS) {
			const sockets = this.ctx.getWebSockets(user);
			if (sockets.length === 0) continue;
			const payload = JSON.stringify({ type: "state", state: this.getState(user) });
			for (const ws of sockets) {
				try {
					ws.send(payload);
				} catch {
					// Socket already gone; the runtime cleans it up.
				}
			}
		}
	}

	// ---------- Voice room ----------

	/** Everyone currently in the room, oldest join first. Derived purely from the live sockets. */
	private voiceRoom(): VoiceMember[] {
		const members = new Map<UserId, VoiceMember>();
		for (const ws of this.ctx.getWebSockets()) {
			const attachment = readAttachment(ws);
			if (!attachment?.voice) continue;
			// One tab per user is the rule, but keep the newest if a stale socket lingers.
			const existing = members.get(attachment.user);
			if (existing && existing.joinedAt >= attachment.voice.joinedAt) continue;
			members.set(attachment.user, { user: attachment.user, ...attachment.voice });
		}
		return [...members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
	}

	/** Pushes the room to every socket — including sockets that are not in it, which draw the presence dots. */
	private broadcastVoice(): void {
		const room = this.voiceRoom();
		for (const ws of this.ctx.getWebSockets()) send(ws, { type: "voice", room });
	}

	/**
	 * Puts this socket in the room. Only one tab per user may be in it, so any other tab of
	 * the same user is removed first and told why.
	 */
	private joinVoice(ws: WebSocket, attachment: SocketAttachment): void {
		for (const other of this.ctx.getWebSockets(attachment.user)) {
			if (other === ws) continue;
			const otherAttachment = readAttachment(other);
			if (!otherAttachment?.voice) continue;
			writeAttachment(other, { ...otherAttachment, voice: null });
			send(other, { type: "voice-evicted" });
		}
		writeAttachment(ws, { ...attachment, voice: { joinedAt: Date.now(), muted: false, sharing: false } });
		this.broadcastVoice();
	}

	private leaveVoice(ws: WebSocket, attachment: SocketAttachment): void {
		if (!attachment.voice) return;
		writeAttachment(ws, { ...attachment, voice: null });
		this.broadcastVoice();
	}

	/** Applies a mute / screen-share change to a socket that is in the room. */
	private updateVoice(ws: WebSocket, attachment: SocketAttachment, patch: Partial<VoiceMember>): void {
		if (!attachment.voice) return;
		writeAttachment(ws, { ...attachment, voice: { ...attachment.voice, ...patch } });
		this.broadcastVoice();
	}

	/** Drops a closing socket out of the room so the other user sees it leave at once. */
	private forgetVoice(ws: WebSocket): void {
		const attachment = readAttachment(ws);
		if (!attachment?.voice) return;
		writeAttachment(ws, { ...attachment, voice: null });
		this.broadcastVoice();
	}

	/**
	 * Relays one WebRTC signalling payload (an SDP offer/answer or an ICE candidate) to the
	 * other user's socket in the room. The contents are opaque here: the media itself never
	 * touches this object.
	 */
	private relaySignal(from: SocketAttachment, to: unknown, data: unknown): void {
		if (!from.voice) return; // only peers actually in the room may signal
		if (typeof to !== "string" || !USER_IDS.includes(to as UserId) || to === from.user) return;
		for (const ws of this.ctx.getWebSockets(to as UserId)) {
			if (!readAttachment(ws)?.voice) continue;
			send(ws, { type: "voice-signal", from: from.user, data });
		}
	}

	/**
	 * Tells the other user that this one started or stopped typing in a channel. Nothing is
	 * stored: an indicator that outlives its socket is worse than one that is briefly missing,
	 * and the receiving client expires it on a timer anyway.
	 */
	private relayTyping(from: UserId, channelId: string, typing: boolean): void {
		if (channelId.length === 0 || channelId.length > 64) return;
		for (const ws of this.ctx.getWebSockets()) {
			const attachment = readAttachment(ws);
			if (!attachment || attachment.user === from) continue;
			send(ws, { type: "typing", user: from, channelId, typing });
		}
	}

	// ---------- Reads ----------

	private readVersion(): number {
		return this.sql.exec<{ value: number }>("SELECT value FROM meta WHERE key = 'version'").one().value;
	}

	/** Full state as seen by `user` (currently the same for everyone). */
	getState(user: UserId): AppState {
		if (!USER_IDS.includes(user)) throw new Error("unknown user");
		const boards = this.sql.exec<BoardRow>("SELECT * FROM boards ORDER BY position, created_at").toArray();
		const tasks = this.sql.exec<TaskRow>("SELECT * FROM tasks ORDER BY position, created_at").toArray();
		const channels = this.sql.exec<ChannelRow>("SELECT * FROM channels ORDER BY position, created_at").toArray();
		// rowid breaks ties between messages created in the same millisecond.
		const messages = this.sql.exec<MessageRow>("SELECT * FROM messages ORDER BY created_at, rowid").toArray();
		const songs = this.sql.exec<SongRow>("SELECT * FROM songs ORDER BY position, created_at").toArray();
		return {
			version: this.readVersion(),
			boards: boards.map(rowToBoard),
			tasks: tasks.map(rowToTask),
			channels: channels.map(rowToChannel),
			messages: messages.map(rowToMessage),
			songs: songs.map(rowToSong),
			playback: this.readPlayback(),
		};
	}

	/** The one shared playback row. */
	private readPlayback(): Playback {
		const rows = this.sql
			.exec<PlaybackRow>("SELECT song_id, playing, position_ms, updated_at_ms, updated_by FROM playback WHERE id = 1")
			.toArray();
		return rows.length === 0 ? { ...IDLE_PLAYBACK } : rowToPlayback(rows[0]);
	}

	/** An image attached to a message, or null if there is no such file. */
	getFile(id: string): StoredFile | null {
		if (!id) return null;
		const rows = this.sql.exec<{ mime: string; bytes: ArrayBuffer }>("SELECT mime, bytes FROM files WHERE id = ?", id).toArray();
		if (rows.length === 0) return null;
		return { mime: rows[0].mime, bytes: rows[0].bytes };
	}

	// ---------- Mutations ----------

	/** Runs `work` in a transaction, bumps the version, broadcasts, and returns the caller's state. */
	private commit(user: UserId, work: () => void): AppState {
		if (!USER_IDS.includes(user)) throw new Error("unknown user");
		this.ctx.storage.transactionSync(() => {
			work();
			this.sql.exec("UPDATE meta SET value = value + 1 WHERE key = 'version'");
		});
		this.broadcast();
		return this.getState(user);
	}

	private boardExists(id: string): boolean {
		return this.sql.exec("SELECT 1 FROM boards WHERE id = ?", id).toArray().length > 0;
	}

	createBoard(user: UserId, name: string): { state: AppState; boardId: string } {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		const state = this.commit(user, () => {
			const next = this.sql
				.exec<{ p: number }>("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM boards")
				.one().p;
			this.sql.exec("INSERT INTO boards (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", id, name, next, now, now);
		});
		return { state, boardId: id };
	}

	renameBoard(user: UserId, id: string, name: string): AppState {
		return this.commit(user, () => {
			if (!this.boardExists(id)) throw new Error(NOT_FOUND);
			this.sql.exec("UPDATE boards SET name = ?, updated_at = ? WHERE id = ?", name, new Date().toISOString(), id);
		});
	}

	/** Deletes a board and all of its tasks. */
	deleteBoard(user: UserId, id: string): AppState {
		return this.commit(user, () => {
			if (!this.boardExists(id)) throw new Error(NOT_FOUND);
			this.sql.exec("DELETE FROM tasks WHERE board_id = ?", id);
			this.sql.exec("DELETE FROM boards WHERE id = ?", id);
		});
	}

	/** Creates an empty task at the top of the first column. */
	createTask(user: UserId, boardId: string): { state: AppState; taskId: string } {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		const state = this.commit(user, () => {
			if (!this.boardExists(boardId)) throw new Error(NOT_FOUND);
			const top = this.sql
				.exec<{ p: number }>(
					"SELECT COALESCE(MIN(position), 1) - 1 AS p FROM tasks WHERE board_id = ? AND status = ?",
					boardId,
					FIRST_COLUMN,
				)
				.one().p;
			this.sql.exec(
				`INSERT INTO tasks (id, board_id, status, position, description, notes, priority, due_date, assignee, checklist, created_at, updated_at, updated_by)
				 VALUES (?, ?, ?, ?, '', '', NULL, NULL, ?, '[]', ?, ?, ?)`,
				id, boardId, FIRST_COLUMN, top, DEFAULT_ASSIGNEE, now, now, user,
			);
		});
		return { state, taskId: id };
	}

	/** Applies a validated patch of editable fields to a task. */
	updateTask(user: UserId, id: string, patch: TaskPatch): AppState {
		const columnFor: Record<keyof TaskPatch, string> = {
			description: "description",
			notes: "notes",
			priority: "priority",
			dueDate: "due_date",
			assignee: "assignee",
			checklist: "checklist",
		};
		const sets: string[] = [];
		const values: SqlStorageValue[] = [];
		for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
			sets.push(`${columnFor[key]} = ?`);
			// The checklist is a list; it is the one field whose column holds JSON.
			values.push(key === "checklist" ? JSON.stringify(patch.checklist ?? []) : (patch[key] ?? null));
		}
		if (sets.length === 0) throw new Error("empty patch");
		return this.commit(user, () => {
			const cursor = this.sql.exec(
				`UPDATE tasks SET ${sets.join(", ")}, updated_at = ?, updated_by = ? WHERE id = ?`,
				...values, new Date().toISOString(), user, id,
			);
			if (cursor.rowsWritten === 0) throw new Error(NOT_FOUND);
		});
	}

	deleteTask(user: UserId, id: string): AppState {
		return this.commit(user, () => {
			const cursor = this.sql.exec("DELETE FROM tasks WHERE id = ?", id);
			if (cursor.rowsWritten === 0) throw new Error(NOT_FOUND);
		});
	}

	/** Sets status + position for the listed tasks of a board (only rows that changed are touched). */
	reorderTasks(user: UserId, boardId: string, columns: ColumnOrder): AppState {
		return this.commit(user, () => {
			if (!this.boardExists(boardId)) throw new Error(NOT_FOUND);
			const now = new Date().toISOString();
			for (const [status, ids] of Object.entries(columns)) {
				ids.forEach((taskId, position) => {
					this.sql.exec(
						`UPDATE tasks SET status = ?, position = ?, updated_at = ?, updated_by = ?
						 WHERE id = ? AND board_id = ? AND (status IS NOT ? OR position IS NOT ?)`,
						status, position, now, user, taskId, boardId, status, position,
					);
				});
			}
		});
	}

	// ---------- Channels ----------

	private channelExists(id: string): boolean {
		return this.sql.exec("SELECT 1 FROM channels WHERE id = ?", id).toArray().length > 0;
	}

	createChannel(user: UserId, name: string): { state: AppState; channelId: string } {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		const state = this.commit(user, () => {
			const next = this.sql
				.exec<{ p: number }>("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM channels")
				.one().p;
			this.sql.exec("INSERT INTO channels (id, name, position, created_at) VALUES (?, ?, ?, ?)", id, name, next, now);
		});
		return { state, channelId: id };
	}

	renameChannel(user: UserId, id: string, name: string): AppState {
		return this.commit(user, () => {
			if (!this.channelExists(id)) throw new Error(NOT_FOUND);
			this.sql.exec("UPDATE channels SET name = ? WHERE id = ?", name, id);
		});
	}

	/** Deletes a channel with all of its messages and their images. */
	deleteChannel(user: UserId, id: string): AppState {
		return this.commit(user, () => {
			if (!this.channelExists(id)) throw new Error(NOT_FOUND);
			this.sql.exec("DELETE FROM files WHERE id IN (SELECT image_id FROM messages WHERE channel_id = ?)", id);
			this.sql.exec("DELETE FROM messages WHERE channel_id = ?", id);
			this.sql.exec("DELETE FROM channels WHERE id = ?", id);
		});
	}

	/** Appends a message (text and/or one image, already validated) to a channel. */
	postMessage(user: UserId, channelId: string, text: string, image: StoredFile | null): { state: AppState; messageId: string } {
		if (!text && !image) throw new Error("empty message");
		const id = crypto.randomUUID();
		const imageId = image ? crypto.randomUUID() : null;
		const now = new Date().toISOString();
		const state = this.commit(user, () => {
			if (!this.channelExists(channelId)) throw new Error(NOT_FOUND);
			if (image && imageId) {
				this.sql.exec(
					"INSERT INTO files (id, mime, bytes, created_at, created_by) VALUES (?, ?, ?, ?, ?)",
					imageId, image.mime, image.bytes, now, user,
				);
			}
			this.sql.exec(
				"INSERT INTO messages (id, channel_id, author, text, image_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
				id, channelId, user, text, imageId, now,
			);
		});
		return { state, messageId: id };
	}

	/**
	 * Replaces the text of one of the caller's own messages. The attached image, the author
	 * and the creation time are left alone, so an edit never changes where the message sits
	 * in the log.
	 */
	editMessage(user: UserId, id: string, text: string): AppState {
		if (text.length === 0) throw new Error("empty message");
		const now = new Date().toISOString();
		return this.commit(user, () => {
			const rows = this.sql
				.exec<{ author: UserId }>("SELECT author FROM messages WHERE id = ?", id)
				.toArray();
			if (rows.length === 0) throw new Error(NOT_FOUND);
			if (rows[0].author !== user) throw new Error(FORBIDDEN);
			this.sql.exec("UPDATE messages SET text = ?, edited_at = ? WHERE id = ?", text, now, id);
		});
	}

	/** Deletes one of the caller's own messages (and its image). */
	deleteMessage(user: UserId, id: string): AppState {
		return this.commit(user, () => {
			const rows = this.sql
				.exec<{ author: UserId; image_id: string | null }>("SELECT author, image_id FROM messages WHERE id = ?", id)
				.toArray();
			if (rows.length === 0) throw new Error(NOT_FOUND);
			if (rows[0].author !== user) throw new Error(FORBIDDEN);
			if (rows[0].image_id) this.sql.exec("DELETE FROM files WHERE id = ?", rows[0].image_id);
			this.sql.exec("DELETE FROM messages WHERE id = ?", id);
		});
	}

	/**
	 * Re-creates boards and tasks from a backup that no longer exist. Existing rows are
	 * never modified; tasks whose board is missing (even after restoring boards) are skipped.
	 */
	restore(user: UserId, data: BackupData): { state: AppState; result: RestoreResult } {
		const count = (table: "boards" | "tasks") =>
			this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
		const result: RestoreResult = { restoredBoards: 0, restoredTasks: 0 };
		const state = this.commit(user, () => {
			const boardsBefore = count("boards");
			const tasksBefore = count("tasks");
			for (const b of data.boards) {
				this.sql.exec(
					"INSERT OR IGNORE INTO boards (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
					b.id, b.name, b.position, b.createdAt, b.updatedAt,
				);
			}
			for (const t of data.tasks) {
				this.sql.exec(
					`INSERT OR IGNORE INTO tasks (id, board_id, status, position, description, notes, priority, due_date, assignee, checklist, created_at, updated_at, updated_by)
					 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM boards WHERE id = ?)`,
					t.id, t.boardId, t.status, t.position, t.description, t.notes, t.priority, t.dueDate, t.assignee,
					JSON.stringify(t.checklist), t.createdAt, t.updatedAt, t.updatedBy, t.boardId,
				);
			}
			// rowsWritten also counts index rows, so count table rows before/after instead.
			result.restoredBoards = count("boards") - boardsBefore;
			result.restoredTasks = count("tasks") - tasksBefore;
		});
		return { state, result };
	}

	// ---------- Music ----------

	/** Ids of the playlist in play order, with each song's length in ms (null when unknown). */
	private playlist(): { id: string; durationMs: number | null }[] {
		const rows = this.sql
			.exec<{ id: string; duration_seconds: number | null }>(
				"SELECT id, duration_seconds FROM songs ORDER BY position, created_at",
			)
			.toArray();
		return rows.map((r) => ({ id: r.id, durationMs: r.duration_seconds === null ? null : r.duration_seconds * 1000 }));
	}

	private writePlayback(next: Playback): void {
		this.sql.exec(
			"UPDATE playback SET song_id = ?, playing = ?, position_ms = ?, updated_at_ms = ?, updated_by = ? WHERE id = 1",
			next.songId, next.playing ? 1 : 0, Math.round(next.positionMs), Math.round(next.updatedAtMs), next.updatedBy,
		);
	}

	/**
	 * Records an uploaded song at the end of the playlist. The bytes are already in R2 under
	 * `r2Key`; this row is what makes the song visible to both users.
	 */
	addSong(user: UserId, song: NewSong): { state: AppState; songId: string } {
		if (!song.id || !song.r2Key) throw new Error("song id and key are required");
		if (song.sizeBytes <= 0) throw new Error("empty song");
		const now = new Date().toISOString();
		const state = this.commit(user, () => {
			const next = this.sql.exec<{ p: number }>("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM songs").one().p;
			this.sql.exec(
				`INSERT INTO songs (id, title, r2_key, mime, size_bytes, duration_seconds, added_by, position, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				song.id, song.title, song.r2Key, song.mime, song.sizeBytes, song.durationSeconds, user, next, now,
			);
		});
		return { state, songId: song.id };
	}

	renameSong(user: UserId, id: string, title: string): AppState {
		return this.commit(user, () => {
			const cursor = this.sql.exec("UPDATE songs SET title = ? WHERE id = ?", title, id);
			if (cursor.rowsWritten === 0) throw new Error(NOT_FOUND);
		});
	}

	/**
	 * Removes a song from the playlist and returns its R2 key so the Worker can delete the
	 * object. Deleting whatever is playing moves playback on to the next song.
	 */
	deleteSong(user: UserId, id: string): { state: AppState; r2Key: string } {
		const rows = this.sql.exec<{ r2_key: string }>("SELECT r2_key FROM songs WHERE id = ?", id).toArray();
		if (rows.length === 0) throw new Error(NOT_FOUND);
		const state = this.commit(user, () => {
			const before = this.playlist();
			const playback = this.readPlayback();
			this.sql.exec("DELETE FROM songs WHERE id = ?", id);
			if (playback.songId !== id) return;
			// Removing entry i shifts what followed it into slot i, so that is the song to carry on with.
			const successor = this.playlist()[before.findIndex((entry) => entry.id === id)] ?? null;
			this.writePlayback({
				songId: successor?.id ?? null,
				playing: playback.playing && successor !== null,
				positionMs: 0,
				updatedAtMs: Date.now(),
				updatedBy: user,
			});
		});
		return { state, r2Key: rows[0].r2_key };
	}

	/** Sets the playlist order from a complete list of song ids; unknown ids are ignored. */
	reorderSongs(user: UserId, ids: string[]): AppState {
		return this.commit(user, () => {
			ids.forEach((id, position) => {
				this.sql.exec("UPDATE songs SET position = ? WHERE id = ? AND position IS NOT ?", position, id, position);
			});
		});
	}

	/** Where a song's bytes live, for the Worker's range-serving route. */
	getSong(id: string): { r2Key: string; mime: string; title: string } | null {
		if (!id) return null;
		const rows = this.sql
			.exec<{ r2_key: string; mime: string; title: string }>("SELECT r2_key, mime, title FROM songs WHERE id = ?", id)
			.toArray();
		if (rows.length === 0) return null;
		return { r2Key: rows[0].r2_key, mime: rows[0].mime, title: rows[0].title };
	}

	/** Applies a play/pause/seek/skip/next/previous command to the one shared playback state. */
	playbackCommand(user: UserId, command: PlaybackCommand): AppState {
		return this.commit(user, () => {
			this.writePlayback(applyPlaybackCommand(this.readPlayback(), this.playlist(), command, Date.now(), user));
		});
	}

	// ---------- Login rate limiting ----------

	/** True if `ip` has exceeded AUTH.loginMaxFailures within the current lockout window. */
	isLoginLocked(ip: string, now = Date.now()): boolean {
		if (!ip) return false;
		const windowMs = AUTH.loginLockoutMinutes * 60 * 1000;
		const rows = this.sql
			.exec<{ count: number; window_start: number }>("SELECT count, window_start FROM login_failures WHERE ip = ?", ip)
			.toArray();
		if (rows.length === 0) return false;
		if (now - rows[0].window_start > windowMs) return false;
		return rows[0].count >= AUTH.loginMaxFailures;
	}

	/** Records the outcome of a login attempt; success clears the counter, failure increments it. */
	recordLoginAttempt(ip: string, ok: boolean, now = Date.now()): void {
		if (!ip) return;
		const windowMs = AUTH.loginLockoutMinutes * 60 * 1000;
		this.sql.exec("DELETE FROM login_failures WHERE window_start < ?", now - windowMs);
		if (ok) {
			this.sql.exec("DELETE FROM login_failures WHERE ip = ?", ip);
			return;
		}
		this.sql.exec(
			`INSERT INTO login_failures (ip, count, window_start) VALUES (?, 1, ?)
			 ON CONFLICT(ip) DO UPDATE SET count = count + 1`,
			ip, now,
		);
	}
}
