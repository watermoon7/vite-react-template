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
	createdAt: string;
	updatedAt: string;
	updatedBy: UserId;
}

/** Full application state as seen by one user (personal notes are per user). */
export interface AppState {
	/** Monotonic counter bumped on every mutation; clients ignore stale states. */
	version: number;
	boards: Board[];
	tasks: Task[];
	notes: { shared: string; personal: string };
}

export type NotesScope = "shared" | "personal";

/** Fields of a task that clients may edit. */
export interface TaskPatch {
	description?: string;
	notes?: string;
	priority?: Priority | null;
	dueDate?: string | null;
	assignee?: Assignee;
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
