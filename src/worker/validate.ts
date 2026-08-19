/** Request body validation for the API. Every parser throws ValidationError on bad input. */
import { CHANNELS, LIMITS } from "../../app.config";
import {
	isAssignee,
	isColumnId,
	isPriority,
	isUserId,
	type BackupData,
	type Board,
	type ColumnOrder,
	type Task,
	type TaskPatch,
} from "../shared/types";
import type { StoredFile } from "./store";

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

/** Parses {name} for creating a channel. */
export function parseChannelInput(body: unknown): { name: string } {
	const rec = asRecord(body, "body");
	const name = asString(rec.name, "name", LIMITS.channelNameMaxLength).trim();
	if (name.length === 0) throw new ValidationError("name is required");
	return { name };
}

/** Byte signatures of the accepted image formats. WebP is "RIFF????WEBP", checked separately. */
const IMAGE_SIGNATURES: [mime: string, magic: number[]][] = [
	["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
	["image/jpeg", [0xff, 0xd8, 0xff]],
	["image/gif", [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]], // GIF87a
	["image/gif", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]], // GIF89a
];

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
	if (bytes.length < offset + magic.length) return false;
	return magic.every((b, i) => bytes[offset + i] === b);
}

/** Detects the image type from the bytes themselves; the client's declared type is not trusted. */
export function sniffImageType(bytes: Uint8Array): string | null {
	for (const [mime, magic] of IMAGE_SIGNATURES) {
		if (startsWith(bytes, magic)) return mime;
	}
	const riff = [0x52, 0x49, 0x46, 0x46];
	const webp = [0x57, 0x45, 0x42, 0x50];
	if (startsWith(bytes, riff) && startsWith(bytes, webp, 8)) return "image/webp";
	return null;
}

const DATA_URL_PREFIX = /^data:[a-z]+\/[a-z0-9.+-]+;base64,/i;

/** Decodes a base64 data URL into an accepted image, enforcing type (by content) and size. */
function parseImageDataUrl(value: unknown): StoredFile {
	if (typeof value !== "string") throw new ValidationError("image must be a data URL string");
	// Base64 inflates by 4/3; reject early rather than decode something that cannot pass.
	if (value.length > Math.ceil(CHANNELS.imageMaxBytes * 1.4) + 64) {
		throw new ValidationError(`image is too large (max ${CHANNELS.imageMaxBytes} bytes)`);
	}
	const prefix = DATA_URL_PREFIX.exec(value);
	if (!prefix) throw new ValidationError("image must be a base64 data URL");
	let binary: string;
	try {
		binary = atob(value.slice(prefix[0].length));
	} catch {
		throw new ValidationError("image is not valid base64");
	}
	if (binary.length > CHANNELS.imageMaxBytes) {
		throw new ValidationError(`image is too large (max ${CHANNELS.imageMaxBytes} bytes)`);
	}
	const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
	const mime = sniffImageType(bytes);
	if (!mime || !CHANNELS.imageTypes.includes(mime)) {
		throw new ValidationError(`unsupported image type (allowed: ${CHANNELS.imageTypes.join(", ")})`);
	}
	return { mime, bytes: bytes.buffer };
}

/** Parses {text?, image?} for posting a message; at least one of the two is required. */
export function parseMessageInput(body: unknown): { text: string; image: StoredFile | null } {
	const rec = asRecord(body, "body");
	const text = rec.text === undefined ? "" : asString(rec.text, "text", LIMITS.messageTextMaxLength).trim();
	const image = rec.image === undefined || rec.image === null ? null : parseImageDataUrl(rec.image);
	if (text.length === 0 && image === null) throw new ValidationError("message needs text or an image");
	return { text, image };
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

