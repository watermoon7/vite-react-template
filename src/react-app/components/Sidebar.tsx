/** Left panel: task search, board list (create/delete/switch), notes, settings, connection status. */
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Board, Task, UserId } from "../../shared/types";
import { userName } from "../format";
import { navigate, routeToHash, type Route } from "../router";
import { searchTasks } from "../search";
import { createBoard, deleteBoard } from "../store";

interface Props {
	route: Route;
	boards: Board[];
	tasks: Task[];
	user: UserId;
	live: boolean;
}

export function Sidebar({ route, boards, tasks, user, live }: Props) {
	const [query, setQuery] = useState("");
	const results = useMemo(() => searchTasks(query, boards, tasks), [query, boards, tasks]);
	const resultList = useRef<HTMLDivElement>(null);
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");
	// Enter and the resulting blur both call submit; the ref makes the second call a no-op.
	const pendingName = useRef("");

	function editNewName(value: string): void {
		pendingName.current = value;
		setNewName(value);
	}

	async function submitNewBoard(): Promise<void> {
		const name = pendingName.current.trim();
		pendingName.current = "";
		setCreating(false);
		setNewName("");
		if (!name) return;
		const id = await createBoard(name);
		if (id) navigate({ kind: "board", boardId: id });
	}

	function onNewBoardKey(e: KeyboardEvent<HTMLInputElement>): void {
		if (e.key === "Enter") void submitNewBoard();
		if (e.key === "Escape") {
			pendingName.current = "";
			setCreating(false);
			setNewName("");
		}
	}

	/** The rendered result links, in visual order. */
	function resultLinks(): HTMLAnchorElement[] {
		if (!resultList.current) return [];
		return Array.from(resultList.current.querySelectorAll<HTMLAnchorElement>("a.search-result"));
	}

	function onSearchKey(e: KeyboardEvent<HTMLInputElement>): void {
		// Escape clears the query, but only when there is one: with an empty box it must
		// still reach the board's own Escape handler, which closes the open task.
		if (e.key === "Escape" && query) {
			e.preventDefault();
			e.stopPropagation();
			setQuery("");
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			resultLinks()[0]?.focus();
		}
	}

	/** Arrow keys move between results; Escape returns to the input. */
	function onResultsKey(e: KeyboardEvent<HTMLDivElement>): void {
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Escape") return;
		e.preventDefault();
		const links = resultLinks();
		const index = links.indexOf(document.activeElement as HTMLAnchorElement);
		if (e.key === "Escape" || (e.key === "ArrowUp" && index === 0)) {
			e.stopPropagation();
			resultList.current?.closest(".sidebar")?.querySelector<HTMLInputElement>(".search-input")?.focus();
			return;
		}
		if (index === -1) return;
		const next = e.key === "ArrowDown" ? index + 1 : index - 1;
		links[Math.min(links.length - 1, Math.max(0, next))].focus();
	}

	async function removeBoard(board: Board): Promise<void> {
		const count = tasks.filter((t) => t.boardId === board.id).length;
		const detail = count === 1 ? "1 task" : `${count} tasks`;
		if (!confirm(`Delete "${board.name}" and its ${detail}?\n\nA local backup is kept under Settings.`)) return;
		if (route.kind === "board" && route.boardId === board.id) navigate({ kind: "home" });
		await deleteBoard(board.id);
	}

	const isBoard = (id: string) => route.kind === "board" && route.boardId === id;
	const isNotes = (scope: string) => route.kind === "notes" && route.scope === scope;

	return (
		<nav className="sidebar">
			<div className="sidebar-brand">Kanban</div>

			<div className="sidebar-search" role="search">
				<input
					className="input search-input"
					type="search"
					aria-label="Search tasks"
					placeholder="Search tasks"
					spellCheck={false}
					autoComplete="off"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={onSearchKey}
				/>
				{query && (
					<button className="icon-btn search-clear" aria-label="Clear search" onClick={() => setQuery("")}>
						×
					</button>
				)}
			</div>

			{results ? (
				<div ref={resultList} onKeyDown={onResultsKey}>
					<p className="search-summary muted small" role="status">
						{results.total === 0
							? "No matching tasks"
							: results.shown < results.total
								? `Showing ${results.shown} of ${results.total} matches`
								: results.total === 1
									? "1 match"
									: `${results.total} matches`}
					</p>
					{results.groups.map((group) => (
						<div key={group.board.id}>
							<div className="sidebar-heading">
								<span>{group.board.name}</span>
							</div>
							<ul className="nav-list" aria-label={group.board.name}>
								{group.hits.map((hit) => (
									<li key={hit.task.id} className="nav-item">
										<a
											className="nav-link search-result"
											href={routeToHash({
												kind: "board",
												boardId: group.board.id,
												taskId: hit.task.id,
											})}
										>
											{hit.task.description.trim() || "Untitled task"}
											{!hit.inDescription && (
												<span className="search-in-notes" title="Matched in notes">
													{" ≡"}
												</span>
											)}
										</a>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			) : (
				<>
					<div className="sidebar-heading">
						<span>Boards</span>
						<button className="icon-btn" title="New board" aria-label="New board" onClick={() => setCreating(true)}>
							+
						</button>
					</div>
					<ul className="nav-list">
						{boards.map((b) => (
							<li key={b.id} className={"nav-item" + (isBoard(b.id) ? " active" : "")}>
								<a href={routeToHash({ kind: "board", boardId: b.id })} className="nav-link" title={b.name}>
									{b.name}
								</a>
								<button
									className="nav-delete"
									title="Delete board"
									aria-label={`Delete board ${b.name}`}
									onClick={() => void removeBoard(b)}
								>
									×
								</button>
							</li>
						))}
						{creating && (
							<li className="nav-item">
								<input
									className="nav-input"
									autoFocus
									placeholder="Board name"
									value={newName}
									onChange={(e) => editNewName(e.target.value)}
									onKeyDown={onNewBoardKey}
									onBlur={() => void submitNewBoard()}
								/>
							</li>
						)}
						{boards.length === 0 && !creating && <li className="nav-empty">No boards yet</li>}
					</ul>
				</>
			)}

			<div className="sidebar-heading">
				<span>Notes</span>
			</div>
			<ul className="nav-list">
				<li className={"nav-item" + (isNotes("shared") ? " active" : "")}>
					<a href={routeToHash({ kind: "notes", scope: "shared" })} className="nav-link">
						Shared
					</a>
				</li>
				<li className={"nav-item" + (isNotes("personal") ? " active" : "")}>
					<a href={routeToHash({ kind: "notes", scope: "personal" })} className="nav-link">
						Personal
					</a>
				</li>
			</ul>

			<div className="sidebar-footer">
				<ul className="nav-list">
					<li className={"nav-item" + (route.kind === "settings" ? " active" : "")}>
						<a href={routeToHash({ kind: "settings" })} className="nav-link">
							Settings
						</a>
					</li>
				</ul>
				<div className="sidebar-status" title={live ? "Connected — changes sync instantly" : "Reconnecting…"}>
					<span className={"status-dot" + (live ? " on" : "")} />
					{userName(user)} · {live ? "Live" : "Reconnecting…"}
				</div>
			</div>
		</nav>
	);
}
