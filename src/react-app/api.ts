/** Thin typed wrappers around the /api endpoints. */
import type {
	AppState,
	BackupData,
	ColumnOrder,
	NotesScope,
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
	saveNotes: (scope: NotesScope, content: string) => request<AppState>("PUT", `/api/notes/${scope}`, { content }),
	restore: (data: BackupData) => request<{ state: AppState; result: RestoreResult }>("POST", "/api/restore", data),
};
