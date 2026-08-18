/**
 * Task search across every board. The client already holds all boards and tasks, so this
 * is a plain filter over what is in memory — no request, no index, no server involvement.
 */
import { CLIENT } from "../../app.config";
import type { Board, Task } from "../shared/types";

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

/**
 * Tasks matching `query`, grouped by board. Returns null when the query is too short to
 * search, which is the caller's signal to show the normal navigation instead.
 */
export function searchTasks(query: string, boards: Board[], tasks: Task[]): SearchResults | null {
	if (!Array.isArray(boards) || !Array.isArray(tasks)) throw new Error("boards and tasks must be arrays");
	const trimmed = query.trim().toLowerCase();
	if (trimmed.length < CLIENT.search.minQueryLength) return null;

	const terms = trimmed.split(/\s+/).filter(Boolean);
	if (terms.length === 0) return null;

	const byBoard = new Map<string, SearchHit[]>();
	let total = 0;
	for (const task of tasks) {
		const description = task.description.toLowerCase();
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
