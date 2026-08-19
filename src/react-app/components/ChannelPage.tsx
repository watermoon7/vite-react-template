/** One text channel: the message log (grouped like Discord) plus a composer for text and images. */
import {
	useLayoutEffect,
	useRef,
	useState,
	type ChangeEvent,
	type ClipboardEvent,
	type KeyboardEvent,
} from "react";
import { CHANNELS } from "../../../app.config";
import type { Channel, Message, UserId } from "../../shared/types";
import { fileUrl } from "../api";
import { loadDraftImage, loadDraftText, saveDraftImage, saveDraftText } from "../drafts";
import { formatDateTime, formatMessageTime, userName } from "../format";
import { firstImageFile, prepareImage } from "../images";
import { splitLinks } from "../linkify";
import { deleteMessage, postMessage, renameChannel } from "../store";
import { ConfirmButton } from "./Confirm";
import { PlusIcon } from "./icons";
import { EditableTitle } from "./EditableTitle";

interface Props {
	channel: Channel;
	/** This channel's messages, oldest first. */
	messages: Message[];
	user: UserId;
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

/** Message text with newlines preserved and http(s) URLs turned into links. */
function MessageText({ text }: { text: string }) {
	return (
		<div className="msg-text">
			{splitLinks(text).map((run, i) =>
				run.href ? (
					<a key={i} href={run.href} target="_blank" rel="noopener noreferrer">
						{run.text}
					</a>
				) : (
					<span key={i}>{run.text}</span>
				),
			)}
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
	const textarea = useRef<HTMLTextAreaElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);

	function setText(value: string): void {
		setTextState(value);
		saveDraftText(channel.id, value);
	}

	function setImage(value: string | null): void {
		setImageState(value);
		saveDraftImage(channel.id, value);
	}

	// A restored draft opens with the caret at its end, ready to carry on typing.
	useLayoutEffect(() => {
		const el = textarea.current;
		if (el && el.value) el.setSelectionRange(el.value.length, el.value.length);
	}, []);

	// Grow with the content up to the CSS max-height, then scroll. Scrolling is only enabled
	// once the content really is taller than that cap: measuring is integer-rounded (and off by
	// a pixel under the interface scale), so an "auto" overflow would show a scrollbar for a
	// box that fits.
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
		onPosted();
		textarea.current?.focus();
	}

	function onKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
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
				<textarea
					ref={textarea}
					className="chat-input"
					rows={1}
					autoFocus
					placeholder="Message"
					value={text}
					disabled={busy}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={onKey}
					onPaste={onPaste}
				/>
				<button className="btn btn-primary" disabled={!canSend} onClick={() => void send()}>
					{busy ? "Sending…" : "Send"}
				</button>
			</div>
			{error && (
				<div className="form-error" role="alert">
					{error}
				</div>
			)}
			<div className="muted small chat-hint">Enter to send · Shift+Enter for a new line · paste an image to attach it</div>
		</div>
	);
}

export function ChannelPage({ channel, messages, user }: Props) {
	const log = useRef<HTMLDivElement>(null);
	// True while the user is (near) the bottom, so new messages keep the log scrolled down.
	const stickToBottom = useRef(true);

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
							<div key={message.id} className="msg">
								<div className="msg-body">
									{message.text && <MessageText text={message.text} />}
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
								{message.author === user && (
									<ConfirmButton
										className="msg-delete"
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
								)}
							</div>
						))}
					</div>
				))}
			</div>
			<Composer channel={channel} onPosted={onPosted} />
		</div>
	);
}
