/** Thin typed wrappers around the /api endpoints. */
import type {
	AppState,
	BackupData,
	ColumnOrder,
	IceServer,
	PlaybackCommand,
	RestoreResult,
	TaskPatch,
	UserId,
} from "../shared/types";

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** Performs a same-origin JSON request; throws ApiError on non-2xx (status 401 = session expired). */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	if (!path.startsWith("/api/")) throw new Error(`bad api path: ${path}`);
	const init: RequestInit = { method, credentials: "same-origin" };
	if (body !== undefined) {
		init.headers = { "Content-Type": "application/json" };
		init.body = JSON.stringify(body);
	}
	const res = await fetch(path, init);
	if (!res.ok) {
		let message = res.statusText;
		try {
			const payload = (await res.json()) as { error?: string };
			if (payload.error) message = payload.error;
		} catch {
			// non-JSON error body
		}
		throw new ApiError(res.status, message);
	}
	if (res.status === 204) return undefined as T;
	return (await res.json()) as T;
}

export const api = {
	me: () => request<{ user: UserId }>("GET", "/api/me"),
	logout: () => request<void>("POST", "/api/logout"),
	getState: () => request<AppState>("GET", "/api/state"),
	createBoard: (name: string) => request<{ state: AppState; boardId: string }>("POST", "/api/boards", { name }),
	renameBoard: (id: string, name: string) => request<AppState>("PATCH", `/api/boards/${id}`, { name }),
	deleteBoard: (id: string) => request<AppState>("DELETE", `/api/boards/${id}`),
	reorderTasks: (boardId: string, columns: ColumnOrder) =>
		request<AppState>("POST", `/api/boards/${boardId}/reorder`, { columns }),
	createTask: (boardId: string) => request<{ state: AppState; taskId: string }>("POST", "/api/tasks", { boardId }),
	updateTask: (id: string, patch: TaskPatch) => request<AppState>("PATCH", `/api/tasks/${id}`, patch),
	deleteTask: (id: string) => request<AppState>("DELETE", `/api/tasks/${id}`),
	createChannel: (name: string) => request<{ state: AppState; channelId: string }>("POST", "/api/channels", { name }),
	renameChannel: (id: string, name: string) => request<AppState>("PATCH", `/api/channels/${id}`, { name }),
	deleteChannel: (id: string) => request<AppState>("DELETE", `/api/channels/${id}`),
	/** `image` is a base64 data URL of an accepted image type, or undefined for a text-only message. */
	postMessage: (channelId: string, text: string, image?: string) =>
		request<{ state: AppState; messageId: string }>("POST", `/api/channels/${channelId}/messages`, { text, image }),
	editMessage: (id: string, text: string) => request<AppState>("PATCH", `/api/messages/${id}`, { text }),
	deleteMessage: (id: string) => request<AppState>("DELETE", `/api/messages/${id}`),
	restore: (data: BackupData) => request<{ state: AppState; result: RestoreResult }>("POST", "/api/restore", data),
	/** ICE servers for the voice call: a TURN relay when one is configured, STUN otherwise. */
	iceServers: () => request<{ iceServers: IceServer[] }>("GET", "/api/turn"),
	uploadSong,
	renameSong: (id: string, title: string) => request<AppState>("PATCH", `/api/music/${id}`, { title }),
	deleteSong: (id: string) => request<AppState>("DELETE", `/api/music/${id}`),
	reorderSongs: (ids: string[]) => request<AppState>("POST", "/api/music/reorder", { ids }),
	playback: (command: PlaybackCommand) => request<AppState>("POST", "/api/playback", command),
};

/**
 * Uploads a song with its bytes as the request body. XMLHttpRequest rather than fetch:
 * upload progress is the whole point of the progress bar and fetch cannot report it.
 */
function uploadSong(
	file: File,
	title: string,
	durationSeconds: number | null,
	onProgress: (fraction: number) => void,
): Promise<{ state: AppState; songId: string }> {
	if (!(file instanceof File)) throw new Error("file must be a File");
	if (typeof onProgress !== "function") throw new Error("onProgress must be a function");
	const query = new URLSearchParams({ title });
	if (durationSeconds !== null && Number.isFinite(durationSeconds)) query.set("duration", String(durationSeconds));
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", `/api/music?${query.toString()}`);
		xhr.withCredentials = true;
		xhr.responseType = "json";
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
		};
		xhr.onload = () => {
			const payload = xhr.response as { state?: AppState; songId?: string; error?: string } | null;
			if (xhr.status >= 200 && xhr.status < 300 && payload?.state && payload.songId) {
				resolve({ state: payload.state, songId: payload.songId });
				return;
			}
			reject(new ApiError(xhr.status, payload?.error ?? xhr.statusText ?? "upload failed"));
		};
		xhr.onerror = () => reject(new ApiError(0, "upload failed"));
		xhr.onabort = () => reject(new ApiError(0, "upload cancelled"));
		xhr.send(file);
	});
}

/** URL an <img> can load a message image from (same-origin, so the session cookie is sent). */
export function fileUrl(imageId: string): string {
	return `/api/files/${encodeURIComponent(imageId)}`;
}

/** URL an <audio> can stream a song from. Answers range requests, so seeking works. */
export function songUrl(songId: string): string {
	return `/api/music/${encodeURIComponent(songId)}/file`;
}
