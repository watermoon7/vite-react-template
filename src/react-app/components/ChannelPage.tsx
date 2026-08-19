/** One text channel: the message log (grouped like Discord) plus a composer for text and images. */
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ChangeEvent,
	type ClipboardEvent,
	type KeyboardEvent,
	type RefObject,
} from "react";
import { CHANNELS } from "../../../app.config";
import type { Channel, Message, UserId } from "../../shared/types";
import { fileUrl } from "../api";
import { loadDraftImage, loadDraftText, saveDraftImage, saveDraftText } from "../drafts";
import { formatDateTime, formatMessageTime, userName } from "../format";
import { firstImageFile, prepareImage } from "../images";
import { splitLinks } from "../linkify";
import {
	completeMention,
	matchingUsers,
	mentionQueryAt,
	mentionsUser,
	splitMentions,
	type MentionCandidate,
} from "../mentions";
import { replaceRoute } from "../router";
import { deleteMessage, editMessage, postMessage, renameChannel } from "../store";
import { notifyTyping, stopTyping, useTypingUsers } from "../typing";
import { ConfirmButton } from "./Confirm";
import { PencilIcon, PlusIcon } from "./icons";
import { EditableTitle } from "./EditableTitle";

interface Props {
	channel: Channel;
	/** This channel's messages, oldest first. */
	messages: Message[];
	user: UserId;
	/** A message to jump to and highlight (a chat search result), or null. */
	jumpTo: string | null;
}

interface MessageGroup {
	author: UserId;
	startedAt: string;
	messages: Message[];
}

/** Consecutive messages by one author within CHANNELS.groupWindowMinutes share one header. */
function groupMessages(messages: Message[]): MessageGroup[] {
	const windowMs = CHANNELS.groupWindowMinutes * 60 * 1000;
	const groups: MessageGroup[] = [];
	for (const message of messages) {
		const last = groups[groups.length - 1];
		const previous = last?.messages[last.messages.length - 1];
		const continues =
			last && previous && last.author === message.author &&
			Date.parse(message.createdAt) - Date.parse(previous.createdAt) < windowMs;
		if (continues) last.messages.push(message);
		else groups.push({ author: message.author, startedAt: message.createdAt, messages: [message] });
	}
	return groups;
}

/**
 * Message text with newlines preserved, http(s) URLs turned into links and @mentions
 * highlighted. Links are split first, so a name inside a URL is left as part of the URL.
 */
function MessageText({ text, user }: { text: string; user: UserId }) {
	return (
		<div className="msg-text">
			{splitLinks(text).flatMap((run, i) =>
				run.href
					? [
							<a key={i} href={run.href} target="_blank" rel="noopener noreferrer">
								{run.text}
							</a>,
						]
					: splitMentions(run.text).map((piece, j) =>
							piece.user ? (
								<span key={`${i}-${j}`} className={"mention" + (piece.user === user ? " mention-me" : "")}>
									{piece.text}
								</span>
							) : (
								<span key={`${i}-${j}`}>{piece.text}</span>
							),
						),
			)}
		</div>
	);
}

/**
 * Grows a textarea with its content up to the CSS max-height, then lets it scroll. Scrolling
 * is only enabled once the content really is taller than that cap: measuring is integer-rounded
 * (and off by a pixel under the interface scale), so an "auto" overflow would show a scrollbar
 * for a box that fits. Returns the ref to put on the textarea.
 */
function useAutoGrow(text: string): RefObject<HTMLTextAreaElement | null> {
	const textarea = useRef<HTMLTextAreaElement>(null);
	useLayoutEffect(() => {
		const el = textarea.current;
		if (!el) return;
		el.style.height = "auto";
		// scrollHeight excludes the borders, but with box-sizing: border-box the height must
		// include them — otherwise the box is 2px short.
		const borders = el.offsetHeight - el.clientHeight;
		const needed = el.scrollHeight + borders;
		const cap = parseFloat(getComputedStyle(el).maxHeight);
		el.style.height = `${needed}px`;
		el.style.overflowY = Number.isFinite(cap) && needed > cap ? "auto" : "hidden";
	}, [text]);
	return textarea;
}

interface MentionPickerProps {
	candidates: MentionCandidate[];
	activeIndex: number;
	onPick: (user: UserId) => void;
}

/** The "@…" completion list, floating above the composer. */
function MentionPicker({ candidates, activeIndex, onPick }: MentionPickerProps) {
	return (
		<div className="mention-picker" role="listbox" aria-label="Mention a user">
			{candidates.map((candidate, index) => (
				<button
					key={candidate.id}
					type="button"
					role="option"
					aria-selected={index === activeIndex}
					className={"mention-option" + (index === activeIndex ? " active" : "")}
					// The composer must keep the caret: mousedown would blur it before a click landed.
					onMouseDown={(e) => {
						e.preventDefault();
						onPick(candidate.id);
					}}
				>
					<span className="mention">@{candidate.name}</span>
				</button>
			))}
		</div>
	);
}

interface EditorProps {
	message: Message;
	/** Called when the edit was saved, or abandoned. */
	onDone: () => void;
}

/** Replaces a message's text with an input while it is being edited. */
function MessageEditor({ message, onDone }: EditorProps) {
	const [text, setText] = useState(message.text);
	const [busy, setBusy] = useState(false);
	const textarea = useAutoGrow(text);

	// Open with the caret at the end, ready to carry on typing. `textarea` is a ref and never
	// changes, so this still runs once, on mount.
	useLayoutEffect(() => {
		const el = textarea.current;
		if (el) el.setSelectionRange(el.value.length, el.value.length);
	}, [textarea]);

	async function save(): Promise<void> {
		if (busy) return;
		const body = text.trim();
		// An edit down to nothing is a deletion, which has its own confirmed button.
		if (body.length === 0 || body === message.text) {
			onDone();
			return;
		}
		setBusy(true);
		const ok = await editMessage(message.id, body);
		setBusy(false);
		// On failure the store shows the error banner and the editor stays open with the text.
		if (ok) onDone();
	}

	function onKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			onDone();
			return;
		}
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			void save();
		}
	}

	return (
		<div className="msg-edit">
			<textarea
				ref={textarea}
				className="chat-input"
				rows={1}
				autoFocus
				aria-label="Edit message"
				value={text}
				disabled={busy}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={onKey}
			/>
			<div className="muted small chat-hint">
				Enter to save · Escape to{" "}
				<button className="link-btn" onClick={onDone}>
					cancel
				</button>
			</div>
		</div>
	);
}

interface ComposerProps {
	channel: Channel;
	/** Called after a message was accepted by the server. */
	onPosted: () => void;
}

function Composer({ channel, onPosted }: ComposerProps) {
	// Text and image start from the channel's saved draft and are written back on every change,
	// so leaving the channel (or the page) and coming back finds them where they were left.
	const [text, setTextState] = useState(() => loadDraftText(channel.id));
	/** Pending image as a base64 data URL (also used as the preview). */
	const [image, setImageState] = useState<string | null>(() => loadDraftImage(channel.id));
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	/** The half-typed "@…" the caret sits in, with the users it could complete to. */
	const [mention, setMention] = useState<{ start: number; candidates: MentionCandidate[]; index: number } | null>(null);
	const textarea = useAutoGrow(text);
	const fileInput = useRef<HTMLInputElement>(null);

	function setText(value: string): void {
		setTextState(value);
		saveDraftText(channel.id, value);
	}

	function setImage(value: string | null): void {
		setImageState(value);
		saveDraftImage(channel.id, value);
	}

	/** Offers (or withdraws) completions for the "@…" the caret is currently in. */
	function refreshMention(value: string, caret: number): void {
		const query = mentionQueryAt(value, caret);
		const candidates = query ? matchingUsers(query.query) : [];
		setMention(query && candidates.length > 0 ? { start: query.start, candidates, index: 0 } : null);
	}

	// A restored draft opens with the caret at its end, ready to carry on typing. `textarea` is
	// a ref and never changes, so this still runs once, on mount.
	useLayoutEffect(() => {
		const el = textarea.current;
		if (el && el.value) el.setSelectionRange(el.value.length, el.value.length);
	}, [textarea]);

	// Leaving the channel (or the page) withdraws this tab's typing indicator at once.
	useEffect(() => () => stopTyping(channel.id), [channel.id]);

	async function attach(file: File | null): Promise<void> {
		if (!file) return;
		setError(null);
		try {
			setImage(await prepareImage(file));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function send(): Promise<void> {
		const body = text.trim();
		if (busy || (!body && !image)) return;
		setBusy(true);
		const ok = await postMessage(channel.id, body, image ?? undefined);
		setBusy(false);
		// On failure the store shows the error banner; the draft is kept so nothing is lost.
		if (!ok) return;
		setText("");
		setImage(null);
		setError(null);
		setMention(null);
		stopTyping(channel.id);
		onPosted();
		textarea.current?.focus();
	}

	/** Replaces the half-typed "@…" with a full mention and puts the caret after it. */
	function pickMention(user: UserId): void {
		const el = textarea.current;
		if (!el || !mention) return;
		const next = completeMention(text, mention.start, el.selectionStart, user);
		setText(next.text);
		setMention(null);
		// React has not rendered the new value into the DOM yet; place the caret once it has.
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(next.caret, next.caret);
		});
	}

	function onChange(e: ChangeEvent<HTMLTextAreaElement>): void {
		const value = e.target.value;
		setText(value);
		refreshMention(value, e.target.selectionStart);
		if (value.trim()) notifyTyping(channel.id);
		else stopTyping(channel.id);
	}

	function onKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
		// While the completion list is open it owns the arrows, Enter/Tab and Escape.
		if (mention) {
			const count = mention.candidates.length;
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				const step = e.key === "ArrowDown" ? 1 : count - 1;
				setMention({ ...mention, index: (mention.index + step) % count });
				return;
			}
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				pickMention(mention.candidates[mention.index].id);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				setMention(null);
				return;
			}
		}
		// Enter sends, Shift+Enter inserts a newline; ignore Enter that confirms an IME composition.
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			void send();
		}
	}

	function onPaste(e: ClipboardEvent<HTMLTextAreaElement>): void {
		const file = firstImageFile(e.clipboardData.files);
		if (!file) return;
		e.preventDefault();
		void attach(file);
	}

	function onPickFile(e: ChangeEvent<HTMLInputElement>): void {
		const file = firstImageFile(e.target.files);
		e.target.value = "";
		void attach(file);
	}

	const canSend = !busy && (text.trim().length > 0 || image !== null);

	return (
		<div className="chat-composer">
			{image && (
				<div className="chat-attachment">
					<img className="chat-attachment-preview" src={image} alt="Image to send" />
					<button className="icon-btn" title="Remove image" aria-label="Remove image" onClick={() => setImage(null)}>
						×
					</button>
				</div>
			)}
			<div className="chat-input-row">
				<input
					ref={fileInput}
					type="file"
					accept="image/*"
					hidden
					onChange={onPickFile}
				/>
				<button
					className="icon-btn chat-attach"
					title="Attach image"
					aria-label="Attach image"
					disabled={busy}
					onClick={() => fileInput.current?.click()}
				>
					<PlusIcon size={16} />
				</button>
				<div className="chat-input-wrap">
					{mention && (
						<MentionPicker candidates={mention.candidates} activeIndex={mention.index} onPick={pickMention} />
					)}
					<textarea
						ref={textarea}
						className="chat-input"
						rows={1}
						autoFocus
						placeholder="Message"
						value={text}
						disabled={busy}
						onChange={onChange}
						onKeyDown={onKey}
						onSelect={(e) => refreshMention(e.currentTarget.value, e.currentTarget.selectionStart)}
						onBlur={() => setMention(null)}
						onPaste={onPaste}
					/>
				</div>
				<button className="btn btn-primary" disabled={!canSend} onClick={() => void send()}>
					{busy ? "Sending…" : "Send"}
				</button>
			</div>
			{error && (
				<div className="form-error" role="alert">
					{error}
				</div>
			)}
			<div className="muted small chat-hint">
				Enter to send · Shift+Enter for a new line · paste an image to attach it · @ to mention
			</div>
		</div>
	);
}

/** "Theo is typing…". Keeps its line whether or not anyone is, so the log never jumps. */
function TypingLine({ channelId }: { channelId: string }) {
	const names = useTypingUsers(channelId).map(userName);
	return (
		<div className="chat-typing muted small" role="status" aria-live="polite">
			{names.length === 0 ? "" : `${names.join(" and ")} ${names.length === 1 ? "is" : "are"} typing…`}
		</div>
	);
}

export function ChannelPage({ channel, messages, user, jumpTo }: Props) {
	const log = useRef<HTMLDivElement>(null);
	// True while the user is (near) the bottom, so new messages keep the log scrolled down.
	const stickToBottom = useRef(true);
	/** The message being edited in place, if any. */
	const [editing, setEditing] = useState<string | null>(null);

	function scrollToBottom(): void {
		const el = log.current;
		if (el) el.scrollTop = el.scrollHeight;
	}

	function onScroll(): void {
		const el = log.current;
		if (!el) return;
		stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < CHANNELS.stickToBottomPx;
	}

	// Runs after every render (messages arrive via the store); a no-op unless following the bottom.
	useLayoutEffect(() => {
		if (stickToBottom.current) scrollToBottom();
	});

	/**
	 * A search result opens the channel at one message: bring it into view, and drop the
	 * message from the URL again once the highlight has had its moment. The highlight is drawn
	 * straight from the route, so letting the message go is also what ends it — and a reload
	 * after that lands at the bottom of the log as usual.
	 */
	useEffect(() => {
		if (!jumpTo) return;
		const target = log.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(jumpTo)}"]`);
		// A message deleted meanwhile has nothing to scroll to; the channel just opens as usual.
		if (target) {
			stickToBottom.current = false;
			target.scrollIntoView({ block: "center" });
		}
		const timer = window.setTimeout(
			() => replaceRoute({ kind: "channel", channelId: channel.id }),
			CHANNELS.jumpHighlightMs,
		);
		return () => window.clearTimeout(timer);
	}, [jumpTo, channel.id]);

	function onPosted(): void {
		stickToBottom.current = true;
		scrollToBottom();
	}

	/** Images load after layout; if we are following the bottom, follow it past the image too. */
	function onImageLoad(): void {
		if (stickToBottom.current) scrollToBottom();
	}

	const groups = groupMessages(messages);

	return (
		<div className="page chat">
			<header className="page-header">
				<EditableTitle
					key={channel.id + channel.name}
					value={channel.name}
					label="Channel name"
					onRename={(name) => void renameChannel(channel.id, name)}
				/>
				<span className="muted small">{messages.length === 1 ? "1 message" : `${messages.length} messages`}</span>
			</header>
			<div className="chat-log" ref={log} onScroll={onScroll}>
				{messages.length === 0 && (
					<div className="chat-empty muted">
						<p>This is the start of “{channel.name}”.</p>
					</div>
				)}
				{groups.map((group) => (
					<div key={group.messages[0].id} className="msg-group">
						<div className="msg-head">
							<span className="msg-author">{userName(group.author)}</span>
							<span className="msg-time muted small" title={formatDateTime(group.startedAt)}>
								{formatMessageTime(group.startedAt)}
							</span>
						</div>
						{group.messages.map((message) => (
							<div
								key={message.id}
								data-message-id={message.id}
								className={
									"msg" +
									(mentionsUser(message.text, user) ? " msg-mentioned" : "") +
									(message.id === jumpTo ? " msg-flash" : "")
								}
							>
								<div className="msg-body">
									{message.id === editing ? (
										<MessageEditor message={message} onDone={() => setEditing(null)} />
									) : (
										message.text && (
											<div className="msg-text-row">
												<MessageText text={message.text} user={user} />
												{message.editedAt && (
													<span className="msg-edited muted small" title={`Edited ${formatDateTime(message.editedAt)}`}>
														(edited)
													</span>
												)}
											</div>
										)
									)}
									{message.imageId && (
										<a className="msg-image-link" href={fileUrl(message.imageId)} target="_blank" rel="noopener noreferrer">
											<img
												className="msg-image"
												src={fileUrl(message.imageId)}
												alt={`Image posted by ${userName(message.author)}`}
												onLoad={onImageLoad}
											/>
										</a>
									)}
								</div>
								{message.author === user && message.id !== editing && (
									<>
										{message.text.length > 0 && (
											<button
												className="msg-action"
												title="Edit message"
												aria-label="Edit message"
												onClick={() => setEditing(message.id)}
											>
												<PencilIcon size={12} />
											</button>
										)}
										<ConfirmButton
											className="msg-action msg-delete"
											title="Delete message"
											aria-label="Delete message"
											message="Delete this message?"
											confirmLabel="Delete"
											danger
											placement="above-end"
											onConfirm={() => void deleteMessage(message.id)}
										>
											×
										</ConfirmButton>
									</>
								)}
							</div>
						))}
					</div>
				))}
			</div>
			<TypingLine channelId={channel.id} />
			<Composer channel={channel} onPosted={onPosted} />
		</div>
	);
}
