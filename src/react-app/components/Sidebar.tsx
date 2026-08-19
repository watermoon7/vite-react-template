/**
 * Left panel: boards and chats (channels; create/rename/delete/switch) — each with its own
 * search — the voice room, calendar, music, settings and the connection status.
 */
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { APP_NAME } from "../../../app.config";
import {
	DONE_COLUMN,
	type Board,
	type Channel,
	type Message,
	type Playback,
	type Song,
	type Task,
	type UserId,
} from "../../shared/types";
import { CHAT_FILTER_HELP, searchMessages } from "../chatSearch";
import { formatMessageTime, userName } from "../format";
import { setMuted, useMusic } from "../music";
import { navigate, routeToHash, type Route } from "../router";
import { FILTER_HELP, searchTasks } from "../search";
import { createBoard, createChannel, deleteBoard, deleteChannel, renameBoard, renameChannel } from "../store";
import { useTypingChannels } from "../typing";
import { ConfirmButton } from "./Confirm";
import { PencilIcon, PlusIcon, SearchIcon, SpeakerIcon } from "./icons";
import { TaskMeta } from "./TaskCard";
import { VoiceRoom } from "./VoiceRoom";

interface Props {
	route: Route;
	boards: Board[];
	tasks: Task[];
	channels: Channel[];
	messages: Message[];
	songs: Song[];
	playback: Playback;
	user: UserId;
	live: boolean;
}

/** Which panel's search box is open, and what has been typed into it. */
type SearchState = { panel: "boards" | "chats"; query: string } | null;

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

interface SearchBoxProps {
	/** Names the box for assistive technology and fills its placeholder. */
	label: string;
	/** What the query syntax matches, as the box's tooltip. */
	help: string;
	query: string;
	onQuery: (query: string) => void;
	/** Closes the box: Escape on an empty query, or the × button. */
	onClose: () => void;
	/** Moves focus into the results (ArrowDown). */
	onEnterResults: () => void;
}

/**
 * The search input a panel's magnifier opens. Escape clears the query, and closes the box
 * once it is empty; ArrowDown steps into the results.
 */
function SearchBox({ label, help, query, onQuery, onClose, onEnterResults }: SearchBoxProps) {
	function onKey(e: KeyboardEvent<HTMLInputElement>): void {
		// Escape must still reach the board's own Escape handler (which closes the open task)
		// when there is nothing here left to close.
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			if (query) onQuery("");
			else onClose();
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			onEnterResults();
		}
	}

	return (
		<div className="sidebar-search" role="search">
			<input
				className="input search-input"
				type="search"
				aria-label={label}
				placeholder={label}
				title={help}
				spellCheck={false}
				autoComplete="off"
				autoFocus
				value={query}
				onChange={(e) => onQuery(e.target.value)}
				onKeyDown={onKey}
			/>
			<button className="icon-btn search-clear" aria-label={`Close ${label.toLowerCase()}`} onClick={onClose}>
				×
			</button>
		</div>
	);
}

/** "3 matches" / "Showing 10 of 42 matches" / "No matches", for a result list's header. */
function summarise(shown: number, total: number, noun: string): string {
	if (total === 0) return `No matching ${noun}`;
	if (shown < total) return `Showing ${shown} of ${total} matches`;
	return total === 1 ? "1 match" : `${total} matches`;
}

export function Sidebar({ route, boards, tasks, channels, messages, songs, playback, user, live }: Props) {
	const music = useMusic();
	/** One search at a time: opening a panel's box closes the other's, query and all. */
	const [search, setSearch] = useState<SearchState>(null);
	const boardQuery = search?.panel === "boards" ? search.query : "";
	const chatQuery = search?.panel === "chats" ? search.query : "";
	const taskResults = useMemo(() => searchTasks(boardQuery, boards, tasks), [boardQuery, boards, tasks]);
	const chatResults = useMemo(
		() => searchMessages(chatQuery, channels, messages),
		[chatQuery, channels, messages],
	);
	const typingIn = useTypingChannels();
	const resultList = useRef<HTMLDivElement>(null);
	const [creatingBoard, setCreatingBoard] = useState(false);
	const [creatingChannel, setCreatingChannel] = useState(false);
	/** Board or channel whose name is being edited in place, if any. */
	const [renaming, setRenaming] = useState<{ kind: "board" | "channel"; id: string } | null>(null);
	const isRenaming = (kind: "board" | "channel", id: string) => renaming?.kind === kind && renaming.id === id;

	/** Opens a panel's search box, or closes it when it is the one already open. */
	function toggleSearch(panel: "boards" | "chats"): void {
		setSearch((current) => (current?.panel === panel ? null : { panel, query: "" }));
	}

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

	/** The rendered result links, in visual order. Both searches render the same link class. */
	function resultLinks(): HTMLAnchorElement[] {
		if (!resultList.current) return [];
		return Array.from(resultList.current.querySelectorAll<HTMLAnchorElement>("a.search-result"));
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

	/** A panel heading with its search toggle and its "new…" button. */
	function heading(title: string, panel: "boards" | "chats", onCreate: () => void, createLabel: string): ReactNode {
		return (
			<div className="sidebar-heading">
				<span>{title}</span>
				<span className="sidebar-heading-actions">
					<button
						className={"icon-btn" + (search?.panel === panel ? " active" : "")}
						title={`Search ${panel}`}
						aria-label={`Search ${panel}`}
						aria-pressed={search?.panel === panel}
						onClick={() => toggleSearch(panel)}
					>
						<SearchIcon />
					</button>
					<button className="icon-btn" title={createLabel} aria-label={createLabel} onClick={onCreate}>
						<PlusIcon />
					</button>
				</span>
			</div>
		);
	}

	/** "Theo is typing" for a chat row, or null when nobody is. */
	function typingLabel(channelId: string): string | null {
		const users = typingIn.get(channelId);
		if (!users || users.length === 0) return null;
		return `${users.map(userName).join(" and ")} ${users.length === 1 ? "is" : "are"} typing`;
	}

	const isBoard = (id: string) => route.kind === "board" && route.boardId === id;
	const isChannel = (id: string) => route.kind === "channel" && route.channelId === id;
	// Only shown while something is actually playing, so the row stays one line the rest of the time.
	const nowPlaying = playback.playing ? (songs.find((s) => s.id === playback.songId)?.title ?? null) : null;

	return (
		<nav className="sidebar">
			<div className="sidebar-brand">{APP_NAME}</div>

			<section className="sidebar-section" aria-label="Boards">
				{heading("Boards", "boards", () => setCreatingBoard(true), "New board")}
				{search?.panel === "boards" && (
					<SearchBox
						label="Search tasks"
						help={FILTER_HELP}
						query={search.query}
						onQuery={(query) => setSearch({ panel: "boards", query })}
						onClose={() => setSearch(null)}
						onEnterResults={() => resultLinks()[0]?.focus()}
					/>
				)}
				{taskResults ? (
					<div ref={resultList} onKeyDown={onResultsKey}>
						<p className="search-summary muted small" role="status">
							{summarise(taskResults.shown, taskResults.total, "tasks")}
						</p>
						{taskResults.groups.map((group) => (
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
				)}
			</section>

			<section className="sidebar-section" aria-label="Chats">
				{heading("Chats", "chats", () => setCreatingChannel(true), "New chat")}
				{search?.panel === "chats" && (
					<SearchBox
						label="Search messages"
						help={CHAT_FILTER_HELP}
						query={search.query}
						onQuery={(query) => setSearch({ panel: "chats", query })}
						onClose={() => setSearch(null)}
						onEnterResults={() => resultLinks()[0]?.focus()}
					/>
				)}
				{chatResults ? (
					<div ref={resultList} onKeyDown={onResultsKey}>
						<p className="search-summary muted small" role="status">
							{summarise(chatResults.shown, chatResults.total, "messages")}
						</p>
						{chatResults.groups.map((group) => (
							<div key={group.channel.id}>
								<div className="sidebar-heading">
									<span>{group.channel.name}</span>
								</div>
								<ul className="nav-list" aria-label={group.channel.name}>
									{group.hits.map((hit) => (
										<li key={hit.message.id} className="nav-item">
											<a
												className="nav-link search-result chat-result"
												href={routeToHash({
													kind: "channel",
													channelId: group.channel.id,
													messageId: hit.message.id,
												})}
											>
												<span className="chat-result-head">
													<span className="chat-result-author">{userName(hit.message.author)}</span>
													<span className="muted small">{formatMessageTime(hit.message.createdAt)}</span>
												</span>
												{hit.snippet && <span className="chat-result-text">{hit.snippet}</span>}
												{hit.hasImage && <span className="chat-result-tag">Image</span>}
											</a>
										</li>
									))}
								</ul>
							</div>
						))}
					</div>
				) : (
					<ul className="nav-list">
						{channels.map((c) => {
							const typing = typingLabel(c.id);
							return (
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
											{typing && (
												<span className="typing-dots" title={typing} aria-label={typing}>
													<i />
													<i />
													<i />
												</span>
											)}
										</a>
										{rowActions("channel", c, () => void removeChannel(c), messageCount(c))}
									</>
								)}
							</li>
							);
						})}
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
				)}
			</section>

			<VoiceRoom route={route} user={user} />

			<div className="sidebar-footer sidebar-section">
				<ul className="nav-list">
					<li className={"nav-item" + (route.kind === "calendar" ? " active" : "")}>
						<a href={routeToHash({ kind: "calendar" })} className="nav-link">
							Calendar
						</a>
					</li>
					<li className={"nav-item" + (route.kind === "music" ? " active" : "")}>
						<a href={routeToHash({ kind: "music" })} className="nav-link nav-music" title={nowPlaying ?? "Music"}>
							<span>Music</span>
							{nowPlaying && <span className="nav-subtitle muted small">{nowPlaying}</span>}
						</a>
						<button
							className={"icon-btn nav-mute" + (music.muted ? " on" : "")}
							title={music.muted ? "Unmute music" : "Mute music"}
							aria-label={music.muted ? "Unmute music" : "Mute music"}
							aria-pressed={music.muted}
							onClick={() => setMuted(!music.muted)}
						>
							<SpeakerIcon size={15} off={music.muted} />
						</button>
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
