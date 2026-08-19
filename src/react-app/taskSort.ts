/**
 * Board sort order: how tasks are ordered within each column. "manual" is the
 * drag-and-drop order; the others sort by one field, keeping the manual order for ties.
 * Stored per browser in localStorage (a view preference, not shared data).
 */
import { CLIENT, PRIORITIES, TASK_SORTS } from "../../app.config";
import type { Task } from "../shared/types";

export type TaskSort = (typeof TASK_SORTS)[number]["id"];

const KEY = CLIENT.storageKeys.taskSort;
const DEFAULT: TaskSort = TASK_SORTS[0].id;

const listeners = new Set<() => void>();
let current: TaskSort | null = null; // read lazily on first use

/** Narrows an arbitrary stored string, which may have been hand-edited. */
function asSort(raw: string | null): TaskSort {
	const match = TASK_SORTS.find((sort) => sort.id === raw);
	return match ? match.id : DEFAULT;
}

export function getTaskSort(): TaskSort {
	if (current === null) {
		try {
			current = asSort(localStorage.getItem(KEY));
		} catch {
			current = DEFAULT; // storage unavailable (private mode)
		}
	}
	return current;
}

export function setTaskSort(value: TaskSort): void {
	if (!TASK_SORTS.some((sort) => sort.id === value)) throw new Error(`unknown sort: ${value}`);
	if (value === getTaskSort()) return;
	current = value;
	try {
		localStorage.setItem(KEY, value);
	} catch {
		// Storage unavailable (private mode): the choice still applies for this session.
	}
	for (const listener of listeners) listener();
}

export function subscribeTaskSort(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The manual (drag-and-drop) order: position, then creation time as a stable tie-break. */
function byManual(a: Task, b: Task): number {
	return a.position - b.position || a.createdAt.localeCompare(b.createdAt);
}

/** Higher priority first; tasks without one last. */
function byPriority(a: Task, b: Task): number {
	const rank = (t: Task) => (t.priority ? PRIORITIES.findIndex((p) => p.id === t.priority) : -1);
	return rank(b) - rank(a);
}

/** Earliest due date first; tasks without one last. ISO dates compare as strings. */
function byDue(a: Task, b: Task): number {
	if (a.dueDate === b.dueDate) return 0;
	if (a.dueDate === null) return 1;
	if (b.dueDate === null) return -1;
	return a.dueDate < b.dueDate ? -1 : 1;
}

/** Alphabetical by description; untitled tasks last. */
function byName(a: Task, b: Task): number {
	const an = a.description.trim();
	const bn = b.description.trim();
	if (!an && !bn) return 0;
	if (!an) return 1;
	if (!bn) return -1;
	return an.localeCompare(bn, undefined, { sensitivity: "base" });
}

const FIELD_ORDER: Record<Exclude<TaskSort, "manual">, (a: Task, b: Task) => number> = {
	priority: byPriority,
	due: byDue,
	name: byName,
};

/** Comparator for `sort`; every non-manual order falls back to the manual order for ties. */
export function compareTasks(sort: TaskSort): (a: Task, b: Task) => number {
	if (sort === "manual") return byManual;
	const byField = FIELD_ORDER[sort];
	if (!byField) throw new Error(`unknown sort: ${sort}`);
	return (a, b) => byField(a, b) || byManual(a, b);
}
