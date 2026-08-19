/** Small display helpers (names, dates). */
import { USERS } from "../../app.config";
import type { Assignee, UserId } from "../shared/types";

/** Display name for a user id or "both". */
export function userName(id: Assignee): string {
	if (id === "both") return "Both";
	const user = USERS.find((u) => u.id === id);
	return user ? user.name : id;
}

/** Today's date as YYYY-MM-DD in the local timezone. */
export function todayIso(now = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/** "24 Aug", or "24 Aug 2027" when not in the current year. Input is YYYY-MM-DD. */
export function formatDueDate(iso: string, now = new Date()): string {
	const [y, m, d] = iso.split("-").map(Number);
	if (!y || !m || !d) return iso;
	const date = new Date(y, m - 1, d);
	const sameYear = y === now.getFullYear();
	return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** True when a YYYY-MM-DD due date is before today. */
export function isOverdue(iso: string, now = new Date()): boolean {
	return iso < todayIso(now);
}

/** Compact relative time: "just now", "5 min ago", "3 h ago", "2 d ago", else a short date. */
export function formatRelative(isoTimestamp: string, now = Date.now()): string {
	const then = Date.parse(isoTimestamp);
	if (Number.isNaN(then)) return "";
	const seconds = Math.max(0, Math.round((now - then) / 1000));
	if (seconds < 60) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	const days = Math.round(hours / 24);
	if (days < 14) return `${days} d ago`;
	return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Message timestamps: "14:05" today, "Yesterday 14:05", otherwise the full local date-time. */
export function formatMessageTime(isoTimestamp: string, now = new Date()): string {
	const t = Date.parse(isoTimestamp);
	if (Number.isNaN(t)) return isoTimestamp;
	const then = new Date(t);
	const time = then.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	if (t >= dayStart) return time;
	if (t >= dayStart - 24 * 60 * 60 * 1000) return `Yesterday ${time}`;
	return formatDateTime(isoTimestamp);
}

/** Full local date-time, e.g. "18 Aug 2026, 14:05". */
export function formatDateTime(isoTimestamp: string): string {
	const t = Date.parse(isoTimestamp);
	if (Number.isNaN(t)) return isoTimestamp;
	return new Date(t).toLocaleString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** Display name for the signed-in user. */
export function currentUserName(id: UserId | null): string {
	return id ? userName(id) : "";
}
