/**
 * Per-browser audio preferences for the voice room: which microphone and speakers to use,
 * how hard the microphone is driven, how loud the other person is, and whether the room's
 * cues play.
 *
 * These are settings of a listener and their hardware, not of the shared room, so they live
 * in localStorage next to the theme and the scale rather than on the server — the other
 * person's browser has its own.
 *
 * This module only stores the preferences and lists the devices. Applying them belongs to the
 * modules that own the hardware: `microphone.ts` for capture, `voice.ts` for the peer's audio
 * element, `audioContext.ts` for generated sound.
 */
import { useSyncExternalStore } from "react";
import { CLIENT, VOICE } from "../../app.config";

export interface VoiceAudioSettings {
	/** Microphone to capture from; null follows the system default. */
	inputDeviceId: string | null;
	/** Device to play the room through; null follows the system default. */
	outputDeviceId: string | null;
	/** Gain applied to the captured microphone (bounded by VOICE.micGain). */
	micGain: number;
	/** Slider position, 0-1, for the other person's voice. The taper is applied where it is used. */
	peerVolume: number;
	/** Whether the join / leave / mute / share cues play. */
	sounds: boolean;
}

/** One selectable audio device, as the browser reports it. */
export interface AudioDevice {
	deviceId: string;
	/** Empty until the user has granted microphone permission — browsers withhold labels. */
	label: string;
}

export interface AudioDevices {
	inputs: AudioDevice[];
	outputs: AudioDevice[];
}

const KEY = CLIENT.storageKeys.voiceAudio;

const DEFAULTS: VoiceAudioSettings = {
	inputDeviceId: null,
	outputDeviceId: null,
	micGain: VOICE.micGain.default,
	peerVolume: VOICE.peerVolume.default,
	sounds: VOICE.sounds.enabledByDefault,
};

const listeners = new Set<() => void>();

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) throw new Error(`expected a finite number, got ${String(value)}`);
	if (min > max) throw new Error("min must not exceed max");
	return Math.min(max, Math.max(min, value));
}

/** A device id from storage, or null: anything else (a hand-edited value) falls back to the default. */
function readDeviceId(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

/** Loads the saved preferences, ignoring anything malformed field by field. */
function readStored(): VoiceAudioSettings {
	try {
		const raw = localStorage.getItem(KEY);
		if (raw === null) return DEFAULTS;
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return DEFAULTS;
		const source = parsed as Partial<Record<keyof VoiceAudioSettings, unknown>>;
		return {
			inputDeviceId: readDeviceId(source.inputDeviceId),
			outputDeviceId: readDeviceId(source.outputDeviceId),
			micGain: readNumber(source.micGain, DEFAULTS.micGain, VOICE.micGain.min, VOICE.micGain.max),
			peerVolume: readNumber(source.peerVolume, DEFAULTS.peerVolume, 0, 1),
			sounds: typeof source.sounds === "boolean" ? source.sounds : DEFAULTS.sounds,
		};
	} catch {
		// Unreadable storage (private mode, or a corrupt value): start from the defaults.
		return DEFAULTS;
	}
}

let current: VoiceAudioSettings = readStored();

/** The current preferences. The object is stable between changes, so it is safe as a store snapshot. */
export function voiceAudioSettings(): VoiceAudioSettings {
	return current;
}

/** Subscribes to preference changes. Returns the unsubscribe function. */
export function subscribeVoiceAudio(listener: () => void): () => void {
	if (typeof listener !== "function") throw new Error("listener must be a function");
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** React hook returning the current preferences. */
export function useVoiceAudio(): VoiceAudioSettings {
	return useSyncExternalStore(subscribeVoiceAudio, voiceAudioSettings);
}

/**
 * Changes one or more preferences and persists the result. Levels are clamped to the ranges in
 * app.config, so a caller cannot store one the hardware would refuse.
 */
export function setVoiceAudio(patch: Partial<VoiceAudioSettings>): void {
	if (typeof patch !== "object" || patch === null) throw new Error("patch must be an object");
	const next: VoiceAudioSettings = {
		...current,
		...patch,
		micGain: patch.micGain === undefined ? current.micGain : clamp(patch.micGain, VOICE.micGain.min, VOICE.micGain.max),
		peerVolume: patch.peerVolume === undefined ? current.peerVolume : clamp(patch.peerVolume, 0, 1),
	};
	const unchanged = (Object.keys(next) as (keyof VoiceAudioSettings)[]).every((key) => next[key] === current[key]);
	if (unchanged) return;
	current = next;
	try {
		localStorage.setItem(KEY, JSON.stringify(next));
	} catch {
		// Storage unavailable: the preference still applies for this session.
	}
	for (const listener of listeners) listener();
}

/**
 * The amplitude a slider position maps to. Loudness is heard roughly as the cube root of
 * amplitude, so a slider wired straight to a linear volume crams every usable level into its
 * bottom quarter; the exponent spreads them over the whole travel.
 */
export function peerVolumeAmplitude(position: number): number {
	return clamp(position, 0, 1) ** VOICE.peerVolume.curveExponent;
}

// ---------- Device list ----------

const NO_DEVICES: AudioDevices = { inputs: [], outputs: [] };
const deviceListeners = new Set<() => void>();
let devices: AudioDevices = NO_DEVICES;

function toDevice(info: MediaDeviceInfo): AudioDevice {
	return { deviceId: info.deviceId, label: info.label };
}

/** True when two lists name the same devices, so the snapshot can stay identical. */
function sameDevices(a: AudioDevices, b: AudioDevices): boolean {
	const key = (list: AudioDevice[]): string => list.map((d) => `${d.deviceId} ${d.label}`).join("|");
	return key(a.inputs) === key(b.inputs) && key(a.outputs) === key(b.outputs);
}

/**
 * Re-reads the connected audio devices. Called on `devicechange`, and again once microphone
 * permission is granted, which is when the browser starts revealing device labels.
 */
export async function refreshAudioDevices(): Promise<void> {
	if (!navigator.mediaDevices?.enumerateDevices) return;
	let infos: MediaDeviceInfo[];
	try {
		infos = await navigator.mediaDevices.enumerateDevices();
	} catch (err) {
		console.warn("Could not list audio devices", err);
		return;
	}
	// "default" and "communications" are Chrome's aliases for the system's own choice, which
	// this app already offers as its null option; listing them is two names for one device.
	const listed = (kind: MediaDeviceKind): AudioDevice[] =>
		infos.filter((i) => i.kind === kind && i.deviceId !== "default" && i.deviceId !== "communications").map(toDevice);
	const next: AudioDevices = { inputs: listed("audioinput"), outputs: listed("audiooutput") };
	if (sameDevices(devices, next)) return;
	devices = next;
	for (const listener of deviceListeners) listener();
}

function onDeviceChange(): void {
	void refreshAudioDevices();
}

/** React hook returning the connected audio devices; refreshes itself as they come and go. */
export function useAudioDevices(): AudioDevices {
	return useSyncExternalStore((listener) => {
		deviceListeners.add(listener);
		if (deviceListeners.size === 1) {
			navigator.mediaDevices?.addEventListener("devicechange", onDeviceChange);
			void refreshAudioDevices();
		}
		return () => {
			deviceListeners.delete(listener);
			if (deviceListeners.size === 0) navigator.mediaDevices?.removeEventListener("devicechange", onDeviceChange);
		};
	}, () => devices);
}
