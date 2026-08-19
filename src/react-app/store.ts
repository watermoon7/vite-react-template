/**
 * Client state: session, live data (boards/tasks/channels/messages) and connection status.
 * A tiny external store consumed via useSyncExternalStore; mutations call the API,
 * apply the returned state, and the WebSocket keeps both users in sync.
 */
import { useSyncExternalStore } from "react";
import { CLIENT } from "../../app.config";
import type { AppState, BackupData, ColumnOrder, RestoreResult, Task, TaskPatch, UserId } from "../shared/types";
import { api, ApiError } from "./api";
import { recordStateTransition } from "./backups";
import { pruneDrafts } from "./drafts";
import { showLoginStyle } from "./style";

export type AuthStatus = "unknown" | "authenticated" | "unauthenticated";

export interface StoreState {
	auth: AuthStatus;
	user: UserId | null;
	data: AppState | null;
	/** True while the WebSocket is open. */
	live: boolean;
	/** Last error message to surface to the user, or null. */
	error: string | null;
}

let state: StoreState = { auth: "unknown", user: null, data: null, live: false, error: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<StoreState>): void {
	state = { ...state, ...patch };
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** React hook returning the whole store state (reference-stable between updates). */
export function useStore(): StoreState {
	return useSyncExternalStore(subscribe, () => state);
}

/**
 * Applies a server state if it is newer than what we have (or `force`), and feeds
 * the transition to the local backup recorder.
 */
function applyState(next: AppState, force = false): void {
	if (typeof next.version !== "number") throw new Error("state without version");
	const prev = state.data;
	if (!force && prev && next.version <= prev.version) return;
	recordStateTransition(prev, next);
	// A deleted channel (by either user) takes its unsent draft with it.
	if (!prev || prev.channels.length !== next.channels.length) pruneDrafts(next.channels.map((c) => c.id));
	setState({ data: next });
}

/** Reports an error to the UI and resyncs from the server (also handles session expiry). */
async function handleError(err: unknown): Promise<void> {
	if (err instanceof ApiError && err.status === 401) {
		setState({ auth: "unauthenticated", user: null, data: null });
		return;
	}
	const message = err instanceof Error ? err.message : String(err);
	setState({ error: message });
	try {
		applyState(await api.getState(), true);
	} catch {
		// Offline; the WebSocket reconnect will resync.
	}
}

export function dismissError(): void {
	setState({ error: null });
}

// ---------- WebSocket ----------

let socket: WebSocket | null = null;
let reconnectDelay = CLIENT.wsReconnectMinMs;
let reconnectTimer: number | undefined;
let pingTimer: number | undefined;

/** Fetches the authoritative state (used after (re)connecting or regaining focus). */
async function resync(): Promise<void> {
	try {
		applyState(await api.getState(), true);
	} catch (err) {
		if (err instanceof ApiError && err.status === 401) setState({ auth: "unauthenticated", user: null, data: null });
	}
}

function connectSocket(): void {
	if (state.auth !== "authenticated") return;
	if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
	const protocol = location.protocol === "https:" ? "wss" : "ws";
	const ws = new WebSocket(`${protocol}://${location.host}/api/ws`);
	socket = ws;
	ws.onopen = () => {
		reconnectDelay = CLIENT.wsReconnectMinMs;
		setState({ live: true });
		void resync();
		pingTimer = window.setInterval(() => ws.send("ping"), CLIENT.wsPingIntervalMs);
	};
	ws.onmessage = (event) => {
		try {
			const message = JSON.parse(String(event.data)) as { type?: string; state?: AppState };
			if (message.type === "state" && message.state) applyState(message.state);
		} catch {
			// ignore malformed frames
		}
	};
	ws.onerror = () => ws.close();
	ws.onclose = () => {
		window.clearInterval(pingTimer);
		if (socket === ws) socket = null;
		setState({ live: false });
		if (state.auth !== "authenticated") return;
		window.clearTimeout(reconnectTimer);
		reconnectTimer = window.setTimeout(connectSocket, reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, CLIENT.wsReconnectMaxMs);
	};
}

function onVisibilityOrOnline(): void {
	if (document.visibilityState !== "visible" || state.auth !== "authenticated") return;
	if (!socket) {
		window.clearTimeout(reconnectTimer);
		reconnectDelay = CLIENT.wsReconnectMinMs;
		connectSocket();
	} else {
		void resync();
	}
}

let bootstrapped = false;

/** Checks the session, loads state and opens the live connection. Safe to call more than once. */
export async function bootstrap(): Promise<void> {
	if (bootstrapped) return;
	bootstrapped = true;
	try {
		const { user } = await api.me();
		setState({ auth: "authenticated", user });
	} catch {
		setState({ auth: "unauthenticated", user: null });
		return;
	}
	await resync();
	connectSocket();
	document.addEventListener("visibilitychange", onVisibilityOrOnline);
	window.addEventListener("online", onVisibilityOrOnline);
}

export async function logout(): Promise<void> {
	try {
		await api.logout();
	} finally {
		socket?.close();
		setState({ auth: "unauthenticated", user: null, data: null, live: false });
		// Remember the sign-in page's style now, so the reload below paints it before React runs.
		showLoginStyle();
		location.replace("/");
	}
}

// ---------- Mutations ----------

/** Runs an API mutation and applies the resulting state; errors are surfaced and trigger a resync. */
async function mutate<T>(run: () => Promise<T>, pick: (result: T) => AppState): Promise<T | null> {
	try {
		const result = await run();
		applyState(pick(result));
		return result;
	} catch (err) {
		await handleError(err);
		return null;
	}
}

export async function createBoard(name: string): Promise<string | null> {
	const result = await mutate(() => api.createBoard(name), (r) => r.state);
	return result?.boardId ?? null;
}

export async function renameBoard(id: string, name: string): Promise<boolean> {
	return (await mutate(() => api.renameBoard(id, name), (s) => s)) !== null;
}

export async function deleteBoard(id: string): Promise<boolean> {
	return (await mutate(() => api.deleteBoard(id), (s) => s)) !== null;
}

export async function createTask(boardId: string): Promise<string | null> {
	const result = await mutate(() => api.createTask(boardId), (r) => r.state);
	return result?.taskId ?? null;
}

export async function updateTask(id: string, patch: TaskPatch): Promise<boolean> {
	return (await mutate(() => api.updateTask(id, patch), (s) => s)) !== null;
}

export async function deleteTask(id: string): Promise<boolean> {
	return (await mutate(() => api.deleteTask(id), (s) => s)) !== null;
}

/**
 * Moves/reorders tasks. Applied optimistically (drag-and-drop must not snap back),
 * then confirmed by the server's state.
 */
export async function reorderTasks(boardId: string, columns: ColumnOrder): Promise<boolean> {
	const data = state.data;
	if (!data) return false;
	const placement = new Map<string, { status: Task["status"]; position: number }>();
	for (const [status, ids] of Object.entries(columns) as [Task["status"], string[]][]) {
		ids.forEach((id, position) => placement.set(id, { status, position }));
	}
	const tasks = data.tasks.map((t) => {
		const p = placement.get(t.id);
		return p && t.boardId === boardId ? { ...t, status: p.status, position: p.position } : t;
	});
	setState({ data: { ...data, tasks } });
	return (await mutate(() => api.reorderTasks(boardId, columns), (s) => s)) !== null;
}

export async function createChannel(name: string): Promise<string | null> {
	const result = await mutate(() => api.createChannel(name), (r) => r.state);
	return result?.channelId ?? null;
}

export async function renameChannel(id: string, name: string): Promise<boolean> {
	return (await mutate(() => api.renameChannel(id, name), (s) => s)) !== null;
}

export async function deleteChannel(id: string): Promise<boolean> {
	return (await mutate(() => api.deleteChannel(id), (s) => s)) !== null;
}

/** Posts a message; `image` is a base64 data URL or undefined. */
export async function postMessage(channelId: string, text: string, image?: string): Promise<boolean> {
	return (await mutate(() => api.postMessage(channelId, text, image), (r) => r.state)) !== null;
}

export async function deleteMessage(id: string): Promise<boolean> {
	return (await mutate(() => api.deleteMessage(id), (s) => s)) !== null;
}

export async function restoreBackup(data: BackupData): Promise<RestoreResult | null> {
	const result = await mutate(() => api.restore(data), (r) => r.state);
	return result?.result ?? null;
}
