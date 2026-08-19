/**
 * KanbanStore — a single SQLite-backed Durable Object holding all boards, tasks, channels,
 * messages and message images. Exposes typed RPC methods for the Worker and a WebSocket
 * endpoint that pushes the full state to every connected client after each mutation.
 */
import { DurableObject } from "cloudflare:workers";
import { AUTH, COLUMNS, DEFAULT_ASSIGNEE } from "../../app.config";
import {
	USER_IDS,
	type AppState,
	type BackupData,
	type Board,
	type Channel,
	type ColumnOrder,
	type Message,
	type RestoreResult,
	type Task,
	type TaskPatch,
	type UserId,
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
	due_date TEXT, assignee TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
	updated_by TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tasks_board_idx ON tasks (board_id);
CREATE TABLE IF NOT EXISTS channels (
	id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
	id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
	image_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages (channel_id);
CREATE TABLE IF NOT EXISTS files (
	id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_failures (
	ip TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL);
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
};

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
	};
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
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		updatedBy: r.updated_by,
	};
}

const FIRST_COLUMN = COLUMNS[0].id;

export class KanbanStore extends DurableObject<Env> {
	private readonly sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		ctx.blockConcurrencyWhile(async () => this.sql.exec(SCHEMA));
		// Answer keep-alive pings without waking the object.
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
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
		return new Response(null, { status: 101, webSocket: client });
	}

	override async webSocketMessage(): Promise<void> {
		// Clients only send "ping" (auto-answered) — nothing else to handle.
	}

	override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
		try {
			// 1005/1006 are reserved and cannot be sent back.
			ws.close(code === 1005 || code === 1006 ? 1000 : code, "closed");
		} catch {
			// already closed
		}
	}

	override async webSocketError(ws: WebSocket): Promise<void> {
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
		return {
			version: this.readVersion(),
			boards: boards.map(rowToBoard),
			tasks: tasks.map(rowToTask),
			channels: channels.map(rowToChannel),
			messages: messages.map(rowToMessage),
		};
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
				`INSERT INTO tasks (id, board_id, status, position, description, notes, priority, due_date, assignee, created_at, updated_at, updated_by)
				 VALUES (?, ?, ?, ?, '', '', NULL, NULL, ?, ?, ?, ?)`,
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
		};
		const sets: string[] = [];
		const values: SqlStorageValue[] = [];
		for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
			sets.push(`${columnFor[key]} = ?`);
			values.push(patch[key] ?? null);
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
					`INSERT OR IGNORE INTO tasks (id, board_id, status, position, description, notes, priority, due_date, assignee, created_at, updated_at, updated_by)
					 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM boards WHERE id = ?)`,
					t.id, t.boardId, t.status, t.position, t.description, t.notes, t.priority, t.dueDate, t.assignee,
					t.createdAt, t.updatedAt, t.updatedBy, t.boardId,
				);
			}
			// rowsWritten also counts index rows, so count table rows before/after instead.
			result.restoredBoards = count("boards") - boardsBefore;
			result.restoredTasks = count("tasks") - tasksBefore;
		});
		return { state, result };
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
