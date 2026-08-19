/**
 * The microphone, from the device to the track that is sent to the other person.
 *
 * Capture does not go straight onto the peer connection: it runs through a small Web Audio
 * chain — source, gain (the sensitivity setting), analyser (the input meter) — and what leaves
 * the module is the chain's output. Two things follow from that, and both matter:
 *
 *  - the outgoing track never changes, so switching microphone mid-call swaps the source
 *    behind the chain and needs no renegotiation with the other browser;
 *  - the level can be shown and adjusted in Settings without the voice room being involved.
 *
 * The device is shared: the voice room holds it while you are in the room, Settings holds it
 * while the meter is on, and it is released only once nobody holds it.
 */
import { VOICE } from "../../app.config";
import { audioContext, resumeAudio } from "./audioContext";
import { refreshAudioDevices, subscribeVoiceAudio, voiceAudioSettings } from "./voiceAudio";

/** Who currently needs the microphone open. */
export type MicOwner = "voice" | "settings";

interface MicChain {
	gain: GainNode;
	analyser: AnalyserNode;
	destination: MediaStreamAudioDestinationNode;
	/** Scratch buffer for the meter, sized once to the analyser's window. */
	samples: Uint8Array<ArrayBuffer>;
}

const owners = new Set<MicOwner>();
const levelListeners = new Set<(level: number) => void>();

/** Built once and kept: its output track is what the peer connection carries. */
let chain: MicChain | null = null;
/** The raw capture, or null when the device is closed. Swapped when the input device changes. */
let capture: MediaStream | null = null;
let source: MediaStreamAudioSourceNode | null = null;
/** In-flight open, so two owners asking at once share one getUserMedia call. */
let opening: Promise<void> | null = null;
let meterTimer: number | undefined;

function buildChain(): MicChain {
	if (chain) return chain;
	const ctx = audioContext();
	const analyser = ctx.createAnalyser();
	analyser.fftSize = VOICE.micMeter.fftSize;
	const gain = ctx.createGain();
	gain.gain.value = voiceAudioSettings().micGain;
	const destination = ctx.createMediaStreamDestination();
	gain.connect(analyser);
	analyser.connect(destination);
	chain = { gain, analyser, destination, samples: new Uint8Array(analyser.fftSize) };
	return chain;
}

/** Points the chain at a freshly captured stream, dropping whatever it was listening to. */
function attachSource(stream: MediaStream): void {
	if (stream.getAudioTracks().length === 0) throw new Error("captured stream has no audio track");
	const built = buildChain();
	if (source) source.disconnect();
	source = audioContext().createMediaStreamSource(stream);
	source.connect(built.gain);
}

/** Stops the capture devices. The chain and its outgoing track are left in place. */
function closeCapture(): void {
	if (source) {
		source.disconnect();
		source = null;
	}
	if (!capture) return;
	for (const track of capture.getTracks()) track.stop();
	capture = null;
}

/**
 * Opens the preferred microphone. A device that has since been unplugged is not an error worth
 * failing on: the system default is tried instead, which is what the user would pick anyway.
 */
async function openCapture(): Promise<void> {
	const { inputDeviceId } = voiceAudioSettings();
	const constraints = (deviceId: string | null): MediaStreamConstraints => ({
		audio: deviceId === null ? VOICE.micConstraints : { ...VOICE.micConstraints, deviceId: { exact: deviceId } },
		video: false,
	});
	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getUserMedia(constraints(inputDeviceId));
	} catch (err) {
		const missing = err instanceof Error && (err.name === "OverconstrainedError" || err.name === "NotFoundError");
		if (!missing || inputDeviceId === null) throw err;
		console.warn("The chosen microphone is unavailable; using the system default", err);
		stream = await navigator.mediaDevices.getUserMedia(constraints(null));
	}
	closeCapture();
	capture = stream;
	attachSource(stream);
	// Labels are withheld until permission is granted, so the device lists are worth re-reading.
	void refreshAudioDevices();
}

/**
 * Opens the microphone for `owner` (or joins the one already open) and returns the stream to
 * send. The same stream object is returned to every owner and for the lifetime of the page.
 */
export async function acquireMicrophone(owner: MicOwner): Promise<MediaStream> {
	if (owner !== "voice" && owner !== "settings") throw new Error(`unknown microphone owner: ${String(owner)}`);
	owners.add(owner);
	resumeAudio();
	if (!capture) {
		const pending = opening ?? openCapture();
		opening = pending;
		try {
			await pending;
		} catch (err) {
			owners.delete(owner);
			throw err;
		} finally {
			if (opening === pending) opening = null;
		}
	}
	startMeter();
	return buildChain().destination.stream;
}

/** Releases `owner`'s hold; the device is closed once nobody holds it. */
export function releaseMicrophone(owner: MicOwner): void {
	if (!owners.delete(owner)) return;
	if (owners.size > 0) return;
	closeCapture();
	stopMeter();
	publishLevel(0);
}

/** True while the device is open, whoever asked for it. */
export function microphoneIsOpen(): boolean {
	return capture !== null;
}

/**
 * Mutes or unmutes what is sent. The track stays in place — muting is the track going silent,
 * not the connection changing — and the input meter keeps moving, so a muted user can still
 * see that their microphone works.
 */
export function setMicrophoneMuted(muted: boolean): void {
	if (typeof muted !== "boolean") throw new Error("muted must be a boolean");
	if (!chain) return;
	for (const track of chain.destination.stream.getAudioTracks()) track.enabled = !muted;
}

// ---------- Input meter ----------

/**
 * The current input level, 0-1, as the meter should draw it: the RMS of the analyser window
 * (which is post-gain, so the sensitivity slider visibly moves it) shaped by a display curve,
 * because a raw speech RMS sits in the bottom tenth of a linear meter.
 */
function measureLevel(): number {
	if (!chain || !capture) return 0;
	chain.analyser.getByteTimeDomainData(chain.samples);
	let sum = 0;
	for (const sample of chain.samples) {
		const centred = (sample - 128) / 128;
		sum += centred * centred;
	}
	const rms = Math.sqrt(sum / chain.samples.length);
	return Math.min(1, rms ** VOICE.micMeter.displayExponent);
}

function publishLevel(level: number): void {
	for (const listener of levelListeners) listener(level);
}

function startMeter(): void {
	if (meterTimer !== undefined || levelListeners.size === 0 || !capture) return;
	meterTimer = window.setInterval(() => publishLevel(measureLevel()), VOICE.micMeter.updateIntervalMs);
}

function stopMeter(): void {
	window.clearInterval(meterTimer);
	meterTimer = undefined;
}

/**
 * Subscribes to the input level. Nothing is measured unless somebody is watching and the
 * device is open. Returns the unsubscribe function.
 */
export function subscribeMicLevel(listener: (level: number) => void): () => void {
	if (typeof listener !== "function") throw new Error("listener must be a function");
	levelListeners.add(listener);
	startMeter();
	return () => {
		levelListeners.delete(listener);
		if (levelListeners.size === 0) stopMeter();
	};
}

// ---------- Preferences ----------

let appliedDeviceId = voiceAudioSettings().inputDeviceId;

/** Follows the settings: sensitivity is a value change, a new device is a new capture. */
subscribeVoiceAudio(() => {
	const settings = voiceAudioSettings();
	if (chain) chain.gain.gain.value = settings.micGain;
	if (settings.inputDeviceId === appliedDeviceId) return;
	appliedDeviceId = settings.inputDeviceId;
	if (!capture || opening) return;
	const pending = openCapture().catch((err: unknown) => {
		console.error(err);
	});
	opening = pending;
	void pending.finally(() => {
		if (opening === pending) opening = null;
	});
});
