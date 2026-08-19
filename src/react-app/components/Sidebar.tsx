/** Left panel: task search, boards and chats (channels; create/rename/delete/switch), calendar, settings, connection status. */
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { DONE_COLUMN, type Board, type Channel, type Message, type Task, type UserId } from "../../shared/types";
import { userName } from "../format";
import { navigate, routeToHash, type Route } from "../router";
import { FILTER_HELP, searchTasks } from "../search";
import { createBoard, createChannel, deleteBoard, deleteChannel, renameBoard, renameChannel } from "../store";
import { ConfirmButton } from "./Confirm";
import { PencilIcon, PlusIcon } from "./icons";
import { TaskMeta } from "./TaskCard";

interface Props {
	route: Route;
	boards: Board[];
	tasks: Task[];
	channels: Channel[];
	messages: Message[];
	user: UserId;
	live: boolean;
}

interface NameInputProps {
	placeholder: string;
	/** Current name when renaming; omitted when creating. */
	initialValue?: string;
	/** Called with the trimmed, non-empty name — and, when renaming, only if it changed. */
	onSubmit: (name: string) => void;
	/** Called on Escape, or when the input is left empty or unchanged. */
	onCancel: () => void;
}

/** Inline name input for creating or renaming a board / channel: Enter or blur submits, Escape cancels. */
function NameInput({ placeholder, initialValue = "", onSubmit, onCancel }: NameInputProps) {
	const [value, setValue] = useState(initialValue);
	// Enter and the resulting blur both call submit; the ref makes the second call a no-op.
	const pending = useRef(initialValue);

	function edit(next: string): void {
		pending.current = next;
		setValue(next);
	}

	function submit(): void {
		const name = pending.current.trim();
		pending.current = "";
		if (name && name !== initialValue) onSubmit(name);
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
	/** Board or channel whose name is being edited in place, if any. */
	const [renaming, setRenaming] = useState<{ kind: "board" | "channel"; id: string } | null>(null);
	const isRenaming = (kind: "board" | "channel", id: string) => renaming?.kind === kind && renaming.id === id;

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
		if (route.kind === "board" && route.boardId === board.id) navigate({ kind: "home" });
		await deleteBoard(board.id);
	}

	async function removeChannel(channel: Channel): Promise<void> {
		if (route.kind === "channel" && route.channelId === channel.id) navigate({ kind: "home" });
		await deleteChannel(channel.id);
	}

	function taskCount(board: Board): string {
		const count = tasks.filter((t) => t.boardId === board.id).length;
		return count === 1 ? "1 task" : `${count} tasks`;
	}

	function messageCount(channel: Channel): string {
		const count = messages.filter((m) => m.channelId === channel.id).length;
		return count === 1 ? "1 message" : `${count} messages`;
	}

	/** Hover actions of a board / channel row: rename (in place) and delete (with confirmation). */
	function rowActions(kind: "board" | "channel", item: Board | Channel, onDelete: () => void, detail: string): ReactNode {
		const noun = kind === "board" ? "board" : "chat";
		return (
			<>
				<button
					className="nav-action"
					title={`Rename ${noun}`}
					aria-label={`Rename ${noun} ${item.name}`}
					onClick={() => setRenaming({ kind, id: item.id })}
				>
					<PencilIcon />
				</button>
				<ConfirmButton
					className="nav-action nav-delete"
					title={`Delete ${noun}`}
					aria-label={`Delete ${noun} ${item.name}`}
					message={`Delete “${item.name}” and its ${detail}?`}
					detail={kind === "board" ? "A local backup is kept under Settings." : "Messages and images in a chat are not backed up."}
					confirmLabel="Delete"
					danger
					onConfirm={onDelete}
				>
					×
				</ConfirmButton>
			</>
		);
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
					title={FILTER_HELP}
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
											className={
												"nav-link search-result" +
												(hit.task.priority ? ` search-prio-${hit.task.priority}` : "") +
												(hit.task.status === DONE_COLUMN ? " search-done" : "")
											}
											href={routeToHash({
												kind: "board",
												boardId: group.board.id,
												taskId: hit.task.id,
											})}
										>
											<span className={"search-title" + (hit.task.description.trim() ? "" : " placeholder")}>
												{hit.task.description.trim() || "Untitled task"}
											</span>
											<TaskMeta task={hit.task} />
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
								<PlusIcon />
							</button>
						</div>
						<ul className="nav-list">
							{boards.map((b) => (
								<li key={b.id} className={"nav-item" + (isBoard(b.id) ? " active" : "")}>
									{isRenaming("board", b.id) ? (
										<NameInput
											placeholder="Board name"
											initialValue={b.name}
											onSubmit={(name) => {
												setRenaming(null);
												void renameBoard(b.id, name);
											}}
											onCancel={() => setRenaming(null)}
										/>
									) : (
										<>
											<a href={routeToHash({ kind: "board", boardId: b.id })} className="nav-link" title={b.name}>
												{b.name}
											</a>
											{rowActions("board", b, () => void removeBoard(b), taskCount(b))}
										</>
									)}
								</li>
							))}
							{creatingBoard && (
								<li className="nav-item">
									<NameInput
										placeholder="Board name"
										onSubmit={(name) => void submitNewBoard(name)}
										onCancel={() => setCreatingBoard(false)}
									/>
								</li>
							)}
							{boards.length === 0 && !creatingBoard && <li className="nav-empty">No boards yet</li>}
						</ul>
					</section>

					<section className="sidebar-section" aria-label="Chats">
						<div className="sidebar-heading">
							<span>Chats</span>
							<button
								className="icon-btn"
								title="New chat"
								aria-label="New chat"
								onClick={() => setCreatingChannel(true)}
							>
								<PlusIcon />
							</button>
						</div>
						<ul className="nav-list">
							{channels.map((c) => (
								<li key={c.id} className={"nav-item" + (isChannel(c.id) ? " active" : "")}>
									{isRenaming("channel", c.id) ? (
										<NameInput
											placeholder="Chat name"
											initialValue={c.name}
											onSubmit={(name) => {
												setRenaming(null);
												void renameChannel(c.id, name);
											}}
											onCancel={() => setRenaming(null)}
										/>
									) : (
										<>
											<a href={routeToHash({ kind: "channel", channelId: c.id })} className="nav-link" title={c.name}>
												{c.name}
											</a>
											{rowActions("channel", c, () => void removeChannel(c), messageCount(c))}
										</>
									)}
								</li>
							))}
							{creatingChannel && (
								<li className="nav-item">
									<NameInput
										placeholder="Chat name"
										onSubmit={(name) => void submitNewChannel(name)}
										onCancel={() => setCreatingChannel(false)}
									/>
								</li>
							)}
							{channels.length === 0 && !creatingChannel && <li className="nav-empty">No chats yet</li>}
						</ul>
					</section>
				</>
			)}

			<div className="sidebar-footer sidebar-section">
				<ul className="nav-list">
					<li className={"nav-item" + (route.kind === "calendar" ? " active" : "")}>
						<a href={routeToHash({ kind: "calendar" })} className="nav-link">
							Calendar
						</a>
					</li>
					<li className={"nav-item" + (route.kind === "settings" ? " active" : "")}>
						<a href={routeToHash({ kind: "settings" })} className="nav-link">
							Settings
						</a>
					</li>
				</ul>
			</div>

			<div className="sidebar-status" title={live ? "Connected — changes sync instantly" : "Reconnecting…"}>
				<span className={"status-dot" + (live ? " on" : "")} />
				{userName(user)} · {live ? "Live" : "Reconnecting…"}
			</div>
		</nav>
	);
}
