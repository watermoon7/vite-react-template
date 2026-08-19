/**
 * The shared player's client half: one <audio> element driven by the playback state both
 * users share.
 *
 * Nothing streams positions over the wire. The shared state says only "song X was at
 * position P at server time T, playing"; each browser works out where the song should be
 * right now from its own estimate of the server clock (see clock.ts) and nudges its player
 * back onto it. Expect the two to sit within a tenth to a third of a second of each other.
 */
import { useSyncExternalStore } from "react";
import { CLIENT, MUSIC } from "../../app.config";
import type { Playback, Song } from "../shared/types";
import { songUrl } from "./api";
import { serverNow } from "./clock";
import { sendPlayback, storeState, subscribeStore } from "./store";

export interface MusicState {
	/**
	 * True when the browser refused to start audio without a click — the "join listening"
	 * case. Cleared as soon as playback actually starts.
	 */
	needsGesture: boolean;
	/** True while the current song is still loading enough to play. */
	loading: boolean;
	/**
	 * Where the volume slider sits in this browser (0-1). Per listener, not shared, and a
	 * position on the slider rather than an amplitude — see `gainFor`.
	 */
	volume: number;
	/** True while this browser is silenced, whatever the volume says. Per listener, not shared. */
	muted: boolean;
	error: string | null;
}

/** This browser's saved slider position, or full volume on a browser that has never set one. */
function readStoredVolume(): number {
	const stored = localStorage.getItem(CLIENT.storageKeys.musicVolume);
	if (stored === null) return 1;
	const raw = Number(stored);
	return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1;
}

/** Whether this browser left the player muted. Anything but a stored "true" counts as unmuted. */
function readStoredMuted(): boolean {
	return localStorage.getItem(CLIENT.storageKeys.musicMuted) === "true";
}

/**
 * The amplitude a slider position asks for. The element's `volume` is a linear amplitude
 * while loudness is heard as roughly its cube root, so wiring the slider straight to it
 * spends the top of the travel on differences nobody can hear and crams every usable level
 * into the bottom quarter. Curving the position first is what a physical volume knob's
 * audio taper does, and it spreads those levels over the whole slider.
 */
function gainFor(position: number): number {
	if (!Number.isFinite(position) || position < 0 || position > 1) throw new Error("volume must be between 0 and 1");
	return position ** MUSIC.volumeCurveExponent;
}

let state: MusicState = {
	needsGesture: false,
	loading: false,
	volume: readStoredVolume(),
	muted: readStoredMuted(),
	error: null,
};
const listeners = new Set<() => void>();

function setState(patch: Partial<MusicState>): void {
	state = { ...state, ...patch };
	for (const listener of listeners) listener();
}

/** React hook returning the local player's state. */
export function useMusic(): MusicState {
	return useSyncExternalStore((listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}, () => state);
}

/**
 * Where the current song should be right now, in ms, given the shared state and the server
 * clock. Clamped to the song's length when it is known.
 */
export function sharedPositionMs(playback: Playback, durationMs: number | null, now = serverNow()): number {
	if (!playback) throw new Error("playback is required");
	const elapsed = playback.playing ? Math.max(0, now - playback.updatedAtMs) : 0;
	const raw = playback.positionMs + elapsed;
	return Math.min(Math.max(raw, 0), durationMs ?? Number.MAX_SAFE_INTEGER);
}

/** A song's length in ms, or null when the uploading browser could not read it. */
export function songDurationMs(song: Song | null): number | null {
	if (!song || song.durationSeconds === null) return null;
	return song.durationSeconds * 1000;
}

// ---------- The player ----------

const audio = new Audio();
audio.preload = "auto";
audio.volume = gainFor(state.volume);
audio.muted = state.muted;
// In the document rather than detached, so the element behaves like any other media element
// for the autoplay policy, devtools and the browser's own media controls.
audio.hidden = true;
document.body.append(audio);

/** Song currently loaded into the element, so the src is only rewritten when it really changes. */
let loadedSongId: string | null = null;
/** Song whose end has already been reported, so the two browsers do not skip two songs. */
let advancedFrom: string | null = null;

/** Moves the slider: `volume` is a position on it, not an amplitude. */
export function setVolume(volume: number): void {
	const gain = gainFor(volume);
	audio.volume = gain;
	localStorage.setItem(CLIENT.storageKeys.musicVolume, String(volume));
	// Reaching for the slider is a request to hear something, so it lifts a mute rather than
	// leaving a control that visibly moves and audibly does nothing.
	if (state.muted && gain > 0) setMuted(false);
	setState({ volume });
}

/** Silences this browser's player. Local only: the other listener hears no change. */
export function setMuted(muted: boolean): void {
	if (typeof muted !== "boolean") throw new Error("muted must be a boolean");
	audio.muted = muted;
	localStorage.setItem(CLIENT.storageKeys.musicMuted, String(muted));
	setState({ muted });
}

/** Starts audio from a click, which is the one thing browsers accept as permission to play. */
export function resumeListening(): void {
	audio.play().then(
		() => {
			setState({ needsGesture: false, error: null });
			sync();
		},
		(err: unknown) => setState({ error: err instanceof Error ? err.message : String(err) }),
	);
}

/** Asks the server to move on from `songId`, at most once per song. */
function reportSongFinished(songId: string): void {
	if (advancedFrom === songId) return;
	advancedFrom = songId;
	void sendPlayback({ action: "next", fromSongId: songId });
}

function startPlayback(): void {
	audio.play().then(
		() => setState({ needsGesture: false }),
		(err: unknown) => {
			// Autoplay was refused: show "join listening" rather than an error nobody can act on.
			if (err instanceof Error && err.name === "NotAllowedError") setState({ needsGesture: true });
			else setState({ error: err instanceof Error ? err.message : String(err) });
		},
	);
}

/** Moves the element onto `targetMs`, ignoring the request until the metadata is in. */
function seekTo(targetMs: number): void {
	if (audio.readyState < HTMLMediaElement.HAVE_METADATA) return;
	audio.currentTime = targetMs / 1000;
}

/**
 * Corrects drift between this player and the shared position: a nudge to the playback rate
 * for small gaps (inaudible), a hard seek for large ones (a stall, or a tab that was asleep).
 */
function correctDrift(targetMs: number): void {
	if (audio.readyState < HTMLMediaElement.HAVE_METADATA) return;
	const driftMs = audio.currentTime * 1000 - targetMs;
	const size = Math.abs(driftMs);
	if (size > MUSIC.driftSeekMs) {
		audio.currentTime = targetMs / 1000;
		audio.playbackRate = 1;
		return;
	}
	if (size > MUSIC.driftToleranceMs) {
		// Behind the shared position: speed up slightly. Ahead: slow down.
		audio.playbackRate = driftMs < 0 ? 1 + MUSIC.driftRateNudge : 1 - MUSIC.driftRateNudge;
		return;
	}
	audio.playbackRate = 1;
}

/** Brings this browser's player in line with the shared playback state. */
function sync(): void {
	const data = storeState().data;
	if (!data) return;
	const { playback, songs } = data;
	const song = songs.find((s) => s.id === playback.songId) ?? null;
	if (!song) {
		if (!audio.paused) audio.pause();
		loadedSongId = null;
		if (audio.src) audio.removeAttribute("src");
		return;
	}
	if (loadedSongId !== song.id) {
		loadedSongId = song.id;
		advancedFrom = null;
		audio.src = songUrl(song.id);
		audio.load();
		setState({ loading: true });
	}
	const durationMs = songDurationMs(song);
	const targetMs = sharedPositionMs(playback, durationMs, serverNow());
	if (!playback.playing) {
		if (!audio.paused) audio.pause();
		audio.playbackRate = 1;
		seekTo(targetMs);
		return;
	}
	// The shared position ran past the end while this tab could not play (muted autoplay, a
	// sleeping tab): move the playlist on ourselves rather than waiting for an "ended" that
	// will never come.
	if (durationMs !== null && sharedPositionMs(playback, null, serverNow()) > durationMs) {
		reportSongFinished(song.id);
		return;
	}
	if (audio.paused && !state.needsGesture) startPlayback();
	correctDrift(targetMs);
}

audio.addEventListener("ended", () => {
	if (loadedSongId) reportSongFinished(loadedSongId);
});
audio.addEventListener("loadedmetadata", () => {
	setState({ loading: false });
	sync();
});
audio.addEventListener("waiting", () => setState({ loading: true }));
audio.addEventListener("playing", () => setState({ loading: false, needsGesture: false }));
audio.addEventListener("error", () => {
	setState({ loading: false, error: "This song could not be played" });
});

// React to every pushed state at once, and check for drift on a slow tick in between.
subscribeStore(sync);
window.setInterval(sync, MUSIC.syncIntervalMs);
