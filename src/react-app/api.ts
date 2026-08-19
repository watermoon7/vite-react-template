/** Thin typed wrappers around the /api endpoints. */
import type { AppState, BackupData, ColumnOrder, RestoreResult, TaskPatch, UserId } from "../shared/types";

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
	deleteMessage: (id: string) => request<AppState>("DELETE", `/api/messages/${id}`),
	restore: (data: BackupData) => request<{ state: AppState; result: RestoreResult }>("POST", "/api/restore", data),
};

/** URL an <img> can load a message image from (same-origin, so the session cookie is sent). */
export function fileUrl(imageId: string): string {
	return `/api/files/${encodeURIComponent(imageId)}`;
}
