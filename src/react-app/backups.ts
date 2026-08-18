/**
 * Local backups: snapshots of boards + tasks kept in this browser's localStorage.
 * Taken periodically, right before any deletion (the previous state is saved), and on demand.
 */
import { CLIENT } from "../../app.config";
import type { AppState, BackupData } from "../shared/types";

export type SnapshotReason = "periodic" | "before-delete" | "manual";

export interface Snapshot extends BackupData {
	id: string;
	/** ISO timestamp. */
	at: string;
	reason: SnapshotReason;
}

const KEY = CLIENT.storageKeys.backups;

let cache: Snapshot[] | null = null;
const listeners = new Set<() => void>();

function notify(): void {
	for (const listener of listeners) listener();
}

/** Subscribe to snapshot list changes (this tab's writes and other tabs via the storage event). */
export function subscribeSnapshots(listener: () => void): () => void {
	listeners.add(listener);
	const onStorage = (e: StorageEvent) => {
		if (e.key === KEY) {
			cache = null;
			listener();
		}
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}

function readAll(): Snapshot[] {
	if (cache) return cache;
	try {
		const raw = localStorage.getItem(KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		cache = Array.isArray(parsed) ? (parsed as Snapshot[]) : [];
	} catch {
		cache = [];
	}
	return cache;
}

/** Persists snapshots (newest first), evicting the oldest until it fits the cap and the storage quota. */
function writeAll(snapshots: Snapshot[]): void {
	let list = snapshots.slice(0, CLIENT.backupMaxSnapshots);
	for (let attempt = 0; attempt < CLIENT.backupMaxSnapshots && list.length > 0; attempt++) {
		try {
			localStorage.setItem(KEY, JSON.stringify(list));
			break;
		} catch {
			list = list.slice(0, -1); // quota exceeded: drop the oldest and retry
		}
	}
	cache = list;
	notify();
}

/**
 * Identifier for a local snapshot. `crypto.randomUUID` exists only in secure contexts,
 * so it is missing when the dev server is opened over plain http on a LAN address.
 * Snapshot ids are local keys with no security role, so a weaker fallback is fine.
 */
function snapshotId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
	return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function fingerprint(data: BackupData): string {
	return JSON.stringify({ boards: data.boards, tasks: data.tasks });
}

/** All snapshots, newest first. Reference-stable until the list changes. */
export function listSnapshots(): Snapshot[] {
	return readAll();
}

/**
 * Stores a snapshot unless it is empty or identical to the newest one. Returns the
 * stored snapshot, or null when skipped.
 */
export function takeSnapshot(data: BackupData, reason: SnapshotReason, now = new Date()): Snapshot | null {
	if (!Array.isArray(data.boards) || !Array.isArray(data.tasks)) throw new Error("invalid backup data");
	if (data.boards.length === 0 && data.tasks.length === 0) return null; // nothing worth keeping
	const existing = readAll();
	if (existing.length > 0 && fingerprint(existing[0]) === fingerprint(data)) return null;
	const snapshot: Snapshot = {
		id: snapshotId(),
		at: now.toISOString(),
		reason,
		boards: data.boards,
		tasks: data.tasks,
	};
	writeAll([snapshot, ...existing]);
	return snapshot;
}

/**
 * True when there is no snapshot in this browser, or the newest is older than the
 * configured warning threshold. Snapshots are per-browser and Safari discards them
 * after a spell with no visit, so Settings surfaces this rather than failing quietly.
 */
export function isBackupStale(snapshots: Snapshot[], now = Date.now()): boolean {
	if (!Array.isArray(snapshots)) throw new Error("snapshots must be an array");
	const newest = snapshots[0];
	if (!newest) return true;
	const age = now - Date.parse(newest.at);
	return Number.isNaN(age) || age > CLIENT.backupStaleWarningDays * 24 * 60 * 60 * 1000;
}

export function deleteSnapshot(id: string): void {
	writeAll(readAll().filter((s) => s.id !== id));
}

/**
 * Called on every state transition. Saves the *previous* state when something was
 * deleted, and a periodic snapshot when the last one is older than the configured interval.
 */
export function recordStateTransition(prev: AppState | null, next: AppState, now = new Date()): void {
	if (prev && (prev.boards.length > next.boards.length || prev.tasks.length > next.tasks.length)) {
		takeSnapshot(prev, "before-delete", now);
	}
	const newest = readAll()[0];
	const intervalMs = CLIENT.backupIntervalMinutes * 60 * 1000;
	if (!newest || now.getTime() - Date.parse(newest.at) > intervalMs) {
		takeSnapshot(next, "periodic", now);
	}
}

/** Triggers a browser download of `data` as a JSON file. */
export function downloadJson(data: BackupData, filenameStem: string): void {
	const blob = new Blob([JSON.stringify({ boards: data.boards, tasks: data.tasks }, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${filenameStem}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

/** Parses a previously downloaded backup file. Throws on malformed input. */
export function parseBackupFile(text: string): BackupData {
	const parsed: unknown = JSON.parse(text);
	if (typeof parsed !== "object" || parsed === null) throw new Error("not a backup file");
	const rec = parsed as { boards?: unknown; tasks?: unknown };
	if (!Array.isArray(rec.boards) || !Array.isArray(rec.tasks)) throw new Error("backup file needs boards and tasks");
	return { boards: rec.boards, tasks: rec.tasks };
}
