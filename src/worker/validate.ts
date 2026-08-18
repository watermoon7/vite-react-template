/** Request body validation for the API. Every parser throws ValidationError on bad input. */
import { LIMITS } from "../../app.config";
import {
	isAssignee,
	isColumnId,
	isPriority,
	isUserId,
	type BackupData,
	type Board,
	type ColumnOrder,
	type NotesScope,
	type Task,
	type TaskPatch,
} from "../shared/types";

export class ValidationError extends Error {
	readonly status = 400;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ValidationError(`${what} must be an object`);
	}
	return value as Record<string, unknown>;
}

function asString(value: unknown, what: string, maxLength: number): string {
	if (typeof value !== "string") throw new ValidationError(`${what} must be a string`);
	if (value.length > maxLength) throw new ValidationError(`${what} is too long (max ${maxLength})`);
	return value;
}

function asId(value: unknown, what: string): string {
	const id = asString(value, what, 64);
	if (id.length === 0) throw new ValidationError(`${what} is required`);
	return id;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses {name} for creating/renaming a board. */
export function parseBoardInput(body: unknown): { name: string } {
	const rec = asRecord(body, "body");
	const name = asString(rec.name, "name", LIMITS.boardNameMaxLength).trim();
	if (name.length === 0) throw new ValidationError("name is required");
	return { name };
}

/** Parses {boardId} for creating a task. */
export function parseTaskCreate(body: unknown): { boardId: string } {
	const rec = asRecord(body, "body");
	return { boardId: asId(rec.boardId, "boardId") };
}

/** Parses an editable-field patch for a task; unknown keys are rejected. */
export function parseTaskPatch(body: unknown): TaskPatch {
	const rec = asRecord(body, "body");
	const patch: TaskPatch = {};
	for (const key of Object.keys(rec)) {
		const value = rec[key];
		switch (key) {
			case "description":
			case "notes":
				patch[key] = asString(value, key, LIMITS.taskTextMaxLength);
				break;
			case "priority":
				if (value !== null && !isPriority(value)) throw new ValidationError("invalid priority");
				patch.priority = value;
				break;
			case "dueDate":
				if (value !== null && (typeof value !== "string" || !ISO_DATE.test(value))) {
					throw new ValidationError("dueDate must be YYYY-MM-DD or null");
				}
				patch.dueDate = value;
				break;
			case "assignee":
				if (!isAssignee(value)) throw new ValidationError("invalid assignee");
				patch.assignee = value;
				break;
			default:
				throw new ValidationError(`unknown field: ${key}`);
		}
	}
	if (Object.keys(patch).length === 0) throw new ValidationError("empty patch");
	return patch;
}

/** Parses {columns: {columnId: [taskId...]}} for reordering a board. */
export function parseColumnOrder(body: unknown): ColumnOrder {
	const rec = asRecord(body, "body");
	const columns = asRecord(rec.columns, "columns");
	const order: ColumnOrder = {};
	for (const key of Object.keys(columns)) {
		if (!isColumnId(key)) throw new ValidationError(`unknown column: ${key}`);
		const ids = columns[key];
		if (!Array.isArray(ids)) throw new ValidationError(`column ${key} must be an array`);
		order[key] = ids.map((id) => asId(id, "task id"));
	}
	if (Object.keys(order).length === 0) throw new ValidationError("no columns given");
	return order;
}

/** Parses {content} for saving a notes page. */
export function parseNotesInput(body: unknown): { content: string } {
	const rec = asRecord(body, "body");
	return { content: asString(rec.content, "content", LIMITS.notesMaxLength) };
}

/** Validates a notes scope path parameter. */
export function parseNotesScope(value: string): NotesScope {
	if (value !== "shared" && value !== "personal") throw new ValidationError("invalid notes scope");
	return value;
}

function parseBoard(value: unknown): Board {
	const rec = asRecord(value, "board");
	return {
		id: asId(rec.id, "board.id"),
		name: asString(rec.name, "board.name", LIMITS.boardNameMaxLength),
		position: typeof rec.position === "number" ? rec.position : 0,
		createdAt: asString(rec.createdAt, "board.createdAt", 40),
		updatedAt: asString(rec.updatedAt, "board.updatedAt", 40),
	};
}

function parseTask(value: unknown): Task {
	const rec = asRecord(value, "task");
	if (!isColumnId(rec.status)) throw new ValidationError("task.status invalid");
	if (rec.priority !== null && !isPriority(rec.priority)) throw new ValidationError("task.priority invalid");
	if (!isAssignee(rec.assignee)) throw new ValidationError("task.assignee invalid");
	if (!isUserId(rec.updatedBy)) throw new ValidationError("task.updatedBy invalid");
	if (rec.dueDate !== null && (typeof rec.dueDate !== "string" || !ISO_DATE.test(rec.dueDate))) {
		throw new ValidationError("task.dueDate invalid");
	}
	return {
		id: asId(rec.id, "task.id"),
		boardId: asId(rec.boardId, "task.boardId"),
		status: rec.status,
		position: typeof rec.position === "number" ? rec.position : 0,
		description: asString(rec.description, "task.description", LIMITS.taskTextMaxLength),
		notes: asString(rec.notes, "task.notes", LIMITS.taskTextMaxLength),
		priority: rec.priority,
		dueDate: rec.dueDate,
		assignee: rec.assignee,
		createdAt: asString(rec.createdAt, "task.createdAt", 40),
		updatedAt: asString(rec.updatedAt, "task.updatedAt", 40),
		updatedBy: rec.updatedBy,
	};
}

/** Parses a backup payload {boards, tasks} for restore. */
export function parseBackupData(body: unknown): BackupData {
	const rec = asRecord(body, "body");
	if (!Array.isArray(rec.boards) || !Array.isArray(rec.tasks)) {
		throw new ValidationError("boards and tasks must be arrays");
	}
	if (rec.boards.length + rec.tasks.length > LIMITS.restoreMaxItems) {
		throw new ValidationError(`too many items (max ${LIMITS.restoreMaxItems})`);
	}
	return { boards: rec.boards.map(parseBoard), tasks: rec.tasks.map(parseTask) };
}

