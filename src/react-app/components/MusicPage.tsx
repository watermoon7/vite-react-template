/**
 * The shared music player: one playlist and one transport, the same for both users.
 *
 * Every control here writes to the shared playback state rather than to this browser's
 * player — pressing play sends "play" to the server, the server stamps it with its own clock,
 * and both browsers then steer their own <audio> onto that. See music.ts for the steering.
 */
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { MUSIC } from "../../../app.config";
import type { Playback, Song, UserId } from "../../shared/types";
import { audioFilesOf, readAudioDuration, titleFromFilename } from "../audioFile";
import { unzoomDragStyle } from "../dragScale";
import { formatBytes, formatDuration, userName } from "../format";
import { resumeListening, setVolume, sharedPositionMs, songDurationMs, useMusic } from "../music";
import { deleteSong, renameSong, reorderSongs, seekPlayback, sendPlayback, uploadSong } from "../store";
import { ConfirmButton } from "./Confirm";
import { GripIcon, PauseIcon, PlayIcon, PlusIcon, SkipIcon } from "./icons";

interface Props {
	songs: Song[];
	playback: Playback;
	user: UserId;
}

/** How often the transport redraws its position while a song plays. */
const TICK_MS = 250;

/** Re-renders on a timer so the seek bar and clock move between server pushes. */
function useTicker(active: boolean): void {
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!active) return;
		const timer = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
		return () => window.clearInterval(timer);
	}, [active]);
}

interface UploaderProps {
	onDone: () => void;
}

/** Adds songs to the playlist, from the file picker or from a drop anywhere on the page. */
function useUploader({ onDone }: UploaderProps) {
	const [progress, setProgress] = useState<{ title: string; fraction: number; index: number; total: number } | null>(null);
	const [error, setError] = useState<string | null>(null);
	// A drag over a child element fires dragleave on the parent; count entries instead.
	const dragDepth = useRef(0);
	const [dragging, setDragging] = useState(false);

	async function addFiles(files: File[]): Promise<void> {
		if (files.length === 0) return;
		setError(null);
		const tooBig = files.find((file) => file.size > MUSIC.maxBytes);
		if (tooBig) {
			setError(`“${tooBig.name}” is larger than ${formatBytes(MUSIC.maxBytes)}`);
			return;
		}
		for (const [index, file] of files.entries()) {
			const title = titleFromFilename(file.name);
			setProgress({ title, fraction: 0, index: index + 1, total: files.length });
			const duration = await readAudioDuration(file);
			const id = await uploadSong(file, title, duration, (fraction) =>
				setProgress({ title, fraction, index: index + 1, total: files.length }),
			);
			// The store has already reported the failure in the banner; stop rather than
			// pushing the rest of a batch at a server that just refused one.
			if (!id) break;
		}
		setProgress(null);
		onDone();
	}

	function onDragEnter(e: DragEvent): void {
		if (!e.dataTransfer.types.includes("Files")) return;
		dragDepth.current++;
		setDragging(true);
	}

	function onDragLeave(): void {
		dragDepth.current = Math.max(0, dragDepth.current - 1);
		if (dragDepth.current === 0) setDragging(false);
	}

	function onDrop(e: DragEvent): void {
		e.preventDefault();
		dragDepth.current = 0;
		setDragging(false);
		void addFiles(audioFilesOf(e.dataTransfer.files));
	}

	return { progress, error, dragging, addFiles, onDragEnter, onDragLeave, onDrop, clearError: () => setError(null) };
}

interface TransportProps {
	song: Song | null;
	playback: Playback;
	hasSongs: boolean;
}

/** Play/pause, skip, the seek bar and the volume — all of it shared except the volume. */
function Transport({ song, playback, hasSongs }: TransportProps) {
	const music = useMusic();
	useTicker(playback.playing);
	const durationMs = songDurationMs(song);
	const positionMs = song ? sharedPositionMs(playback, durationMs) : 0;
	const seekMax = durationMs ?? 0;
	/**
	 * Where the thumb has been dragged to, while it is being dragged. The bar is otherwise
	 * drawn from shared state, and a control whose value is decided elsewhere cannot be
	 * dragged: every move would be undone by the next state to arrive.
	 */
	const [scrubMs, setScrubMs] = useState<number | null>(null);
	const commitTimer = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(commitTimer.current), []);

	/**
	 * Sends the seek and hands the bar back to the shared state, unless the thumb has moved
	 * on again in the meantime.
	 */
	function commitScrub(target: number): void {
		window.clearTimeout(commitTimer.current);
		void seekPlayback(target).finally(() =>
			setScrubMs((current) => (current === target ? null : current)),
		);
	}

	/** Moves the thumb now and sends the seek once it has come to rest. */
	function scrubTo(target: number): void {
		setScrubMs(target);
		window.clearTimeout(commitTimer.current);
		commitTimer.current = window.setTimeout(() => commitScrub(target), MUSIC.seekCommitDebounceMs);
	}

	return (
		<div className="music-player">
			<div className="music-now">
				<div className="music-now-title">{song ? song.title : "Nothing playing"}</div>
				{song && (
					<div className="muted small">
						Added by {userName(song.addedBy)}
						{playback.updatedBy ? ` · last change by ${userName(playback.updatedBy)}` : ""}
					</div>
				)}
			</div>

			<div className="music-transport">
				<button
					className="icon-btn"
					title="Previous"
					aria-label="Previous song"
					disabled={!hasSongs}
					onClick={() => void sendPlayback({ action: "previous" })}
				>
					<SkipIcon size={16} back />
				</button>
				<button
					className="icon-btn"
					title={`Back ${MUSIC.skipSeconds} seconds`}
					aria-label={`Back ${MUSIC.skipSeconds} seconds`}
					disabled={!song}
					onClick={() => void sendPlayback({ action: "skip", deltaMs: -MUSIC.skipSeconds * 1000 })}
				>
					−{MUSIC.skipSeconds}
				</button>
				<button
					className="btn btn-primary music-play"
					disabled={!hasSongs}
					aria-label={playback.playing ? "Pause" : "Play"}
					onClick={() => void sendPlayback(playback.playing ? { action: "pause" } : { action: "play" })}
				>
					{playback.playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
				</button>
				<button
					className="icon-btn"
					title={`Forward ${MUSIC.skipSeconds} seconds`}
					aria-label={`Forward ${MUSIC.skipSeconds} seconds`}
					disabled={!song}
					onClick={() => void sendPlayback({ action: "skip", deltaMs: MUSIC.skipSeconds * 1000 })}
				>
					+{MUSIC.skipSeconds}
				</button>
				<button
					className="icon-btn"
					title="Next"
					aria-label="Next song"
					disabled={!hasSongs}
					onClick={() => void sendPlayback({ action: "next" })}
				>
					<SkipIcon size={16} />
				</button>
			</div>

			<div className="music-seek">
				<span className="music-time muted small">{formatDuration(scrubMs ?? positionMs)}</span>
				<input
					className="music-range"
					type="range"
					min={0}
					max={seekMax}
					step={1000}
					value={scrubMs ?? Math.min(positionMs, seekMax)}
					disabled={durationMs === null}
					aria-label="Position in the song"
					onChange={(e: ChangeEvent<HTMLInputElement>) => scrubTo(Number(e.target.value))}
					onPointerUp={() => scrubMs !== null && commitScrub(scrubMs)}
					onBlur={() => scrubMs !== null && commitScrub(scrubMs)}
				/>
				<span className="music-time muted small">{durationMs === null ? "–:––" : formatDuration(durationMs)}</span>
			</div>

			<div className="music-volume">
				<label className="muted small" htmlFor="music-volume">
					Volume
				</label>
				<input
					id="music-volume"
					className="music-range"
					type="range"
					min={0}
					max={1}
					step={0.01}
					value={music.volume}
					onChange={(e) => setVolume(Number(e.target.value))}
				/>
			</div>

			{music.needsGesture && (
				<button className="btn btn-primary music-join" onClick={resumeListening}>
					Join listening
				</button>
			)}
			{music.error && <div className="form-error">{music.error}</div>}
		</div>
	);
}

interface RowProps {
	song: Song;
	index: number;
	current: boolean;
	playing: boolean;
	renaming: boolean;
	onStartRename: () => void;
	onFinishRename: (title: string | null) => void;
}

/** One playlist row: a grip, the title (click to play, ✎ to rename) and a delete button. */
function SongRow({ song, index, current, playing, renaming, onStartRename, onFinishRename }: RowProps) {
	const durationMs = songDurationMs(song);
	return (
		<Draggable draggableId={song.id} index={index}>
			{(provided, snapshot) => (
				<li
					ref={provided.innerRef}
					{...provided.draggableProps}
					style={unzoomDragStyle(provided.draggableProps.style)}
					className={"song" + (current ? " current" : "") + (snapshot.isDragging ? " dragging" : "")}
				>
					<span className="song-grip" {...provided.dragHandleProps} aria-label={`Reorder ${song.title}`}>
						<GripIcon size={14} />
					</span>
					{renaming ? (
						<input
							className="nav-input song-rename"
							autoFocus
							defaultValue={song.title}
							aria-label="Song title"
							onKeyDown={(e) => {
								if (e.key === "Enter") onFinishRename(e.currentTarget.value);
								if (e.key === "Escape") onFinishRename(null);
							}}
							onBlur={(e) => onFinishRename(e.currentTarget.value)}
						/>
					) : (
						<>
							<button
								className="song-title"
								title={current && playing ? `Pause ${song.title}` : `Play ${song.title}`}
								onClick={() =>
									void sendPlayback(current && playing ? { action: "pause" } : { action: "play", songId: song.id })
								}
							>
								{current && playing ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
								<span className="song-name">{song.title}</span>
							</button>
							<span className="song-meta muted small">
								{userName(song.addedBy)} · {formatBytes(song.sizeBytes)}
								{durationMs === null ? "" : ` · ${formatDuration(durationMs)}`}
							</span>
							<button className="nav-action" title="Rename song" aria-label={`Rename ${song.title}`} onClick={onStartRename}>
								✎
							</button>
							<ConfirmButton
								className="nav-action nav-delete"
								title="Delete song"
								aria-label={`Delete ${song.title}`}
								message={`Delete “${song.title}”?`}
								detail="The file is removed for both of you."
								confirmLabel="Delete"
								danger
								placement="below-end"
								onConfirm={() => void deleteSong(song.id)}
							>
								×
							</ConfirmButton>
						</>
					)}
				</li>
			)}
		</Draggable>
	);
}

export function MusicPage({ songs, playback, user }: Props) {
	if (!user) throw new Error("MusicPage needs the signed-in user");
	const fileInput = useRef<HTMLInputElement>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const uploader = useUploader({ onDone: () => setRenamingId(null) });
	const current = songs.find((s) => s.id === playback.songId) ?? null;

	function onPickFiles(e: ChangeEvent<HTMLInputElement>): void {
		const files = audioFilesOf(e.target.files);
		e.target.value = "";
		void uploader.addFiles(files);
	}

	function onDragEnd({ source, destination }: DropResult): void {
		if (!destination || destination.index === source.index) return;
		const ids = songs.map((s) => s.id);
		const [moved] = ids.splice(source.index, 1);
		ids.splice(destination.index, 0, moved);
		void reorderSongs(ids);
	}

	function finishRename(song: Song, title: string | null): void {
		setRenamingId(null);
		const trimmed = title?.trim() ?? "";
		if (trimmed.length > 0 && trimmed !== song.title) void renameSong(song.id, trimmed);
	}

	return (
		<div
			className={"page music" + (uploader.dragging ? " dropping" : "")}
			onDragEnter={uploader.onDragEnter}
			onDragLeave={uploader.onDragLeave}
			onDragOver={(e) => e.preventDefault()}
			onDrop={uploader.onDrop}
		>
			<header className="page-header">
				<h1 className="page-title">Music</h1>
				<span className="muted small">{songs.length === 1 ? "1 song" : `${songs.length} songs`}</span>
				<div className="spacer" />
				<input ref={fileInput} type="file" accept={MUSIC.fileAccept} multiple hidden onChange={onPickFiles} />
				<button className="btn" disabled={uploader.progress !== null} onClick={() => fileInput.current?.click()}>
					<PlusIcon /> Add songs
				</button>
			</header>

			<Transport song={current} playback={playback} hasSongs={songs.length > 0} />

			{uploader.progress && (
				<div className="music-upload" role="status">
					<div className="music-upload-label small">
						Uploading “{uploader.progress.title}”
						{uploader.progress.total > 1 ? ` (${uploader.progress.index} of ${uploader.progress.total})` : ""}
					</div>
					<div className="progress">
						<div className="progress-bar" style={{ width: `${Math.round(uploader.progress.fraction * 100)}%` }} />
					</div>
				</div>
			)}
			{uploader.error && (
				<div className="form-error music-error" role="alert">
					<span>{uploader.error}</span>
					<button className="icon-btn" aria-label="Dismiss" onClick={uploader.clearError}>
						×
					</button>
				</div>
			)}

			<DragDropContext onDragEnd={onDragEnd}>
				<Droppable droppableId="playlist">
					{(provided) => (
						<ul className="playlist" ref={provided.innerRef} {...provided.droppableProps}>
							{songs.map((song, index) => (
								<SongRow
									key={song.id}
									song={song}
									index={index}
									current={song.id === playback.songId}
									playing={playback.playing}
									renaming={renamingId === song.id}
									onStartRename={() => setRenamingId(song.id)}
									onFinishRename={(title) => finishRename(song, title)}
								/>
							))}
							{provided.placeholder}
							{songs.length === 0 && (
								<li className="nav-empty">
									No songs yet — drop audio files here, or use “Add songs”. Up to {formatBytes(MUSIC.maxBytes)} each.
								</li>
							)}
						</ul>
					)}
				</Droppable>
			</DragDropContext>
		</div>
	);
}
