/**
 * Month-grid helpers for the calendar view: pure functions over dates and the already-loaded
 * tasks. The component only renders what these return, so the date arithmetic lives here.
 */
import { COLUMNS, PRIORITIES } from "../../app.config";
import type { Priority, Task } from "../shared/types";
import { formatIsoDate, todayIso } from "./format";

/** A month, identified the way `Date` does: year plus zero-based month index. */
export interface MonthCursor {
	year: number;
	/** 0 = January … 11 = December. */
	month: number;
}

/** One cell of the month grid. */
export interface CalendarDay {
	/** YYYY-MM-DD; the key into the tasks-by-date map. */
	iso: string;
	/** Day of the month, for display. */
	day: number;
	/** False for the leading/trailing days that pad the grid out to whole weeks. */
	inMonth: boolean;
	isToday: boolean;
}

const DAYS_PER_WEEK = 7;

/** The last column counts as done (matches the card's overdue rule). */
const DONE_COLUMN = COLUMNS[COLUMNS.length - 1].id;

const PRIORITY_RANK = new Map<Priority, number>(PRIORITIES.map((p, i) => [p.id, i]));

function assertMonth(cursor: MonthCursor): void {
	if (!Number.isInteger(cursor.year)) throw new Error("year must be an integer");
	if (!Number.isInteger(cursor.month) || cursor.month < 0 || cursor.month > 11) throw new Error("month must be 0–11");
}

function assertWeekStart(weekStartsOn: number): void {
	if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn >= DAYS_PER_WEEK) {
		throw new Error("weekStartsOn must be 0–6");
	}
}

/** The month containing `now`. */
export function currentMonth(now = new Date()): MonthCursor {
	return { year: now.getFullYear(), month: now.getMonth() };
}

/** The month `delta` months away (negative for earlier). `Date` handles the year rollover. */
export function shiftMonth(cursor: MonthCursor, delta: number): MonthCursor {
	assertMonth(cursor);
	if (!Number.isInteger(delta)) throw new Error("delta must be an integer");
	const date = new Date(cursor.year, cursor.month + delta, 1);
	return { year: date.getFullYear(), month: date.getMonth() };
}

/** "August 2026", in the user's locale. */
export function formatMonth(cursor: MonthCursor): string {
	assertMonth(cursor);
	return new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** Short weekday names ("Mon", …) starting from `weekStartsOn`, in the user's locale. */
export function weekdayLabels(weekStartsOn: number): string[] {
	assertWeekStart(weekStartsOn);
	// 4 January 1970 was a Sunday, so the 4th + n falls on weekday n.
	return Array.from({ length: DAYS_PER_WEEK }, (_, i) =>
		new Date(1970, 0, 4 + ((weekStartsOn + i) % DAYS_PER_WEEK)).toLocaleDateString(undefined, { weekday: "short" }),
	);
}

/**
 * The cells of a month grid: whole weeks from the one containing the 1st to the one containing
 * the last day, so the length is always a multiple of 7 (28–42 cells).
 */
export function monthGrid(cursor: MonthCursor, weekStartsOn: number, today = todayIso()): CalendarDay[] {
	assertMonth(cursor);
	assertWeekStart(weekStartsOn);
	const firstWeekday = new Date(cursor.year, cursor.month, 1).getDay();
	const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
	const leading = (firstWeekday - weekStartsOn + DAYS_PER_WEEK) % DAYS_PER_WEEK;
	const cellCount = Math.ceil((leading + daysInMonth) / DAYS_PER_WEEK) * DAYS_PER_WEEK;
	const days: CalendarDay[] = [];
	for (let i = 0; i < cellCount; i++) {
		const date = new Date(cursor.year, cursor.month, 1 - leading + i);
		const iso = formatIsoDate(date);
		days.push({ iso, day: date.getDate(), inMonth: date.getMonth() === cursor.month, isToday: iso === today });
	}
	return days;
}

export function isDone(task: Task): boolean {
	return task.status === DONE_COLUMN;
}

function priorityRank(priority: Priority | null): number {
	return priority === null ? -1 : (PRIORITY_RANK.get(priority) ?? -1);
}

/** Open tasks before done ones, higher priority first, then alphabetically. */
function compareWithinDay(a: Task, b: Task): number {
	return (
		Number(isDone(a)) - Number(isDone(b)) ||
		priorityRank(b.priority) - priorityRank(a.priority) ||
		a.description.localeCompare(b.description)
	);
}

/** Every task that has a due date, keyed by that date (YYYY-MM-DD), each day's list sorted. */
export function tasksByDueDate(tasks: Task[]): Map<string, Task[]> {
	if (!Array.isArray(tasks)) throw new Error("tasks must be an array");
	const byDate = new Map<string, Task[]>();
	for (const task of tasks) {
		if (task.dueDate === null) continue;
		const list = byDate.get(task.dueDate);
		if (list) list.push(task);
		else byDate.set(task.dueDate, [task]);
	}
	for (const list of byDate.values()) list.sort(compareWithinDay);
	return byDate;
}
