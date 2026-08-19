/** Left panel: task search, boards and channels (create/delete/switch), settings, connection status. */
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Board, Channel, Message, Task, UserId } from "../../shared/types";
import { userName } from "../format";
import { navigate, routeToHash, type Route } from "../router";
import { searchTasks } from "../search";
import { createBoard, createChannel, deleteBoard, deleteChannel } from "../store";

interface Props {
	route: Route;
	boards: Board[];
	tasks: Task[];
	channels: Channel[];
	messages: Message[];
	user: UserId;
	live: boolean;
}

interface NewItemInputProps {
	placeholder: string;
	/** Called with the trimmed, non-empty name. */
	onSubmit: (name: string) => void;
	/** Called on Escape or when the input is left empty. */
	onCancel: () => void;
}

/** Inline "new board / new channel" input: Enter or blur submits, Escape cancels. */
function NewItemInput({ placeholder, onSubmit, onCancel }: NewItemInputProps) {
	const [value, setValue] = useState("");
	// Enter and the resulting blur both call submit; the ref makes the second call a no-op.
	const pending = useRef("");

	function edit(next: string): void {
		pending.current = next;
		setValue(next);
	}

	function submit(): void {
		const name = pending.current.trim();
		pending.current = "";
		if (name) onSubmit(name);
		else onCancel();
	}

	function onKey(e: KeyboardEvent<HTMLInputElement>): void {
		if (e.key === "Enter") submit();
		if (e.key === "Escape") {
			pending.current = "";
			onCancel();
		}
	}

	return (
		<input
			className="nav-input"
			autoFocus
			placeholder={placeholder}
			value={value}
			onChange={(e) => edit(e.target.value)}
			onKeyDown={onKey}
			onBlur={submit}
		/>
	);
}

export function Sidebar({ route, boards, tasks, channels, messages, user, live }: Props) {
	const [query, setQuery] = useState("");
	const results = useMemo(() => searchTasks(query, boards, tasks), [query, boards, tasks]);
	const resultList = useRef<HTMLDivElement>(null);
	const [creatingBoard, setCreatingBoard] = useState(false);
	const [creatingChannel, setCreatingChannel] = useState(false);

	async function submitNewBoard(name: string): Promise<void> {
		setCreatingBoard(false);
		const id = await createBoard(name);
		if (id) navigate({ kind: "board", boardId: id });
	}

	async function submitNewChannel(name: string): Promise<void> {
		setCreatingChannel(false);
		const id = await createChannel(name);
		if (id) navigate({ kind: "channel", channelId: id });
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

	async function removeChannel(channel: Channel): Promise<void> {
		const count = messages.filter((m) => m.channelId === channel.id).length;
		const detail = count === 1 ? "1 message" : `${count} messages`;
		if (!confirm(`Delete #${channel.name} and its ${detail}?\n\nMessages and images in a channel are not backed up.`)) return;
		if (route.kind === "channel" && route.channelId === channel.id) navigate({ kind: "home" });
		await deleteChannel(channel.id);
	}

	const isBoard = (id: string) => route.kind === "board" && route.boardId === id;
	const isChannel = (id: string) => route.kind === "channel" && route.channelId === id;

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
					<section className="sidebar-section" aria-label="Boards">
						<div className="sidebar-heading">
							<span>Boards</span>
							<button className="icon-btn" title="New board" aria-label="New board" onClick={() => setCreatingBoard(true)}>
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
							{creatingBoard && (
								<li className="nav-item">
									<NewItemInput
										placeholder="Board name"
										onSubmit={(name) => void submitNewBoard(name)}
										onCancel={() => setCreatingBoard(false)}
									/>
								</li>
							)}
							{boards.length === 0 && !creatingBoard && <li className="nav-empty">No boards yet</li>}
						</ul>
					</section>

					<section className="sidebar-section" aria-label="Channels">
						<div className="sidebar-heading">
							<span>Channels</span>
							<button
								className="icon-btn"
								title="New channel"
								aria-label="New channel"
								onClick={() => setCreatingChannel(true)}
							>
								+
							</button>
						</div>
						<ul className="nav-list">
							{channels.map((c) => (
								<li key={c.id} className={"nav-item" + (isChannel(c.id) ? " active" : "")}>
									<a
										href={routeToHash({ kind: "channel", channelId: c.id })}
										className="nav-link nav-channel"
										title={`#${c.name}`}
									>
										<span className="nav-hash">#</span>
										{c.name}
									</a>
									<button
										className="nav-delete"
										title="Delete channel"
										aria-label={`Delete channel ${c.name}`}
										onClick={() => void removeChannel(c)}
									>
										×
									</button>
								</li>
							))}
							{creatingChannel && (
								<li className="nav-item">
									<NewItemInput
										placeholder="Channel name"
										onSubmit={(name) => void submitNewChannel(name)}
										onCancel={() => setCreatingChannel(false)}
									/>
								</li>
							)}
							{channels.length === 0 && !creatingChannel && <li className="nav-empty">No channels yet</li>}
						</ul>
					</section>
				</>
			)}

			<div className="sidebar-footer sidebar-section">
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
