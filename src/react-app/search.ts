/**
 * Task search across every board. The client already holds all boards and tasks, so this
 * is a plain filter over what is in memory — no request, no index, no server involvement.
 *
 * A query is whitespace-separated tokens. `field:value` tokens filter on a task field
 * (see FILTER_HELP); every other token is a text term that must appear in the description
 * or notes. Tokens with an unknown field or value are treated as text, so "re:" still
 * searches for "re:".
 */
import { CLIENT, COLUMNS, PRIORITIES, USERS } from "../../app.config";
import type { Assignee, Board, Task } from "../shared/types";
import { todayIso } from "./format";

export interface SearchHit {
	task: Task;
	/** The description matched, rather than only the notes. Ranked above notes-only hits. */
	inDescription: boolean;
}

export interface SearchGroup {
	board: Board;
	hits: SearchHit[];
}

export interface SearchResults {
	/** Boards with at least one hit, in the order the sidebar already lists them. */
	groups: SearchGroup[];
	/** Hits listed, after the cap. */
	shown: number;
	/** Hits found, before the cap. */
	total: number;
}

/** Every whitespace-separated term must appear somewhere for a task to match. */
function matches(haystack: string, terms: string[]): boolean {
	for (const term of terms) {
		if (!haystack.includes(term)) return false;
	}
	return true;
}

type Predicate = (task: Task) => boolean;

/** The last column counts as done; a completed task is not overdue (as on the card). */
const DONE_COLUMN = COLUMNS[COLUMNS.length - 1].id;
const DATE_PREFIX = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/** Human-readable summary of the filter syntax, for the search box tooltip. */
export const FILTER_HELP =
	`Filters: priority:${PRIORITIES[PRIORITIES.length - 1].id} (or none) · ` +
	`due:2026-08-20, due:2026-08, due:overdue, due:today, due:none · ` +
	`who:${USERS[0].id} (or both) · status:${COLUMNS[COLUMNS.length - 1].id}. ` +
	`Anything else is matched against the description and notes.`;

/** `value` (lowercased) is a prefix of the normalised label: "in_progress" or "in-progress" for "In progress". */
function labelStartsWith(label: string, value: string): boolean {
	return label.toLowerCase().replace(/\s+/g, "_").startsWith(value.replace(/-/g, "_"));
}

/**
 * Turns one `field:value` token into a task predicate, or null when the field or value
 * is not recognised (the caller then treats the token as ordinary text).
 */
function parseFilter(field: string, value: string, today: string): Predicate | null {
	if (!value) return null;
	switch (field) {
		case "priority": {
			const ids = PRIORITIES.filter((p) => labelStartsWith(p.label, value)).map((p) => p.id);
			const none = "none".startsWith(value);
			if (ids.length === 0 && !none) return null;
			return (t) => (t.priority === null ? none : ids.includes(t.priority));
		}
		case "due":
			if (value === "none") return (t) => t.dueDate === null;
			if (value === "today") return (t) => t.dueDate === today;
			if (value === "overdue") return (t) => t.dueDate !== null && t.dueDate < today && t.status !== DONE_COLUMN;
			if (DATE_PREFIX.test(value)) return (t) => t.dueDate !== null && t.dueDate.startsWith(value);
			return null;
		case "who": {
			// A task assigned to both is each user's task too, so who:<user> includes "both".
			const users = USERS.filter((u) => u.id.startsWith(value) || u.name.toLowerCase().startsWith(value));
			const both = "both".startsWith(value);
			if (users.length === 0 && !both) return null;
			const accepted = new Set<Assignee>(users.map((u) => u.id));
			return (t) => (t.assignee === "both" ? both || users.length > 0 : accepted.has(t.assignee));
		}
		case "status": {
			const ids = COLUMNS.filter((c) => c.id.startsWith(value) || labelStartsWith(c.label, value)).map((c) => c.id);
			if (ids.length === 0) return null;
			return (t) => ids.includes(t.status);
		}
		default:
			return null;
	}
}

/** Splits a lowercased query into text terms and field predicates. */
function parseQuery(query: string, today: string): { terms: string[]; predicates: Predicate[] } {
	const terms: string[] = [];
	const predicates: Predicate[] = [];
	for (const token of query.split(/\s+/).filter(Boolean)) {
		const colon = token.indexOf(":");
		const predicate = colon > 0 ? parseFilter(token.slice(0, colon), token.slice(colon + 1), today) : null;
		if (predicate) predicates.push(predicate);
		else terms.push(token);
	}
	return { terms, predicates };
}

/**
 * Tasks matching `query`, grouped by board. Returns null when the query is too short to
 * search, which is the caller's signal to show the normal navigation instead.
 */
export function searchTasks(query: string, boards: Board[], tasks: Task[]): SearchResults | null {
	if (!Array.isArray(boards) || !Array.isArray(tasks)) throw new Error("boards and tasks must be arrays");
	const trimmed = query.trim().toLowerCase();
	if (trimmed.length < CLIENT.search.minQueryLength) return null;

	const { terms, predicates } = parseQuery(trimmed, todayIso());
	if (terms.length === 0 && predicates.length === 0) return null;

	const byBoard = new Map<string, SearchHit[]>();
	let total = 0;
	for (const task of tasks) {
		if (!predicates.every((accepts) => accepts(task))) continue;
		const description = task.description.toLowerCase();
		// With only filters there is no text to rank by; every hit counts as a description hit.
		const inDescription = matches(description, terms);
		if (!inDescription && !matches(`${description}\n${task.notes.toLowerCase()}`, terms)) continue;
		total++;
		const existing = byBoard.get(task.boardId);
		if (existing) existing.push({ task, inDescription });
		else byBoard.set(task.boardId, [{ task, inDescription }]);
	}

	// A description hit is what the user is most likely looking for; notes are supporting detail.
	for (const hits of byBoard.values()) {
		hits.sort(
			(a, b) =>
				Number(b.inDescription) - Number(a.inDescription) ||
				a.task.position - b.task.position ||
				a.task.createdAt.localeCompare(b.task.createdAt),
		);
	}

	const groups: SearchGroup[] = [];
	let shown = 0;
	for (const board of boards) {
		const hits = byBoard.get(board.id);
		if (!hits || shown >= CLIENT.search.maxResults) continue;
		const room = CLIENT.search.maxResults - shown;
		groups.push({ board, hits: hits.slice(0, room) });
		shown += Math.min(room, hits.length);
	}
	return { groups, shown, total };
}
