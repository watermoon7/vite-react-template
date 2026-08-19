/**
 * The single Web Audio context the app uses for sound it makes itself: the microphone chain
 * (sensitivity and the input meter) and the voice room's cues.
 *
 * One context rather than one per module — a browser allows only a handful per page, and both
 * users of it want the same output device. The music player is not here: it plays a file
 * through an ordinary <audio> element and needs no graph.
 *
 * A context starts suspended until the page has had a gesture, so anything that leads to sound
 * calls `resumeAudio()` from the click that asked for it.
 */
import { subscribeVoiceAudio, voiceAudioSettings } from "./voiceAudio";

/**
 * Routing a context to a chosen device is Chrome-only and is not in the DOM types yet, so it
 * is reached through this shape rather than assumed. Elsewhere the context follows the system
 * default, which is what those browsers offer anyway.
 */
type SinkCapable = { setSinkId?: (sinkId: string) => Promise<void> };

let context: AudioContext | null = null;

/** Sends generated audio to the chosen output device, where the browser can do it. */
function applyAudioOutput(): void {
	if (!context) return;
	const sink = context as unknown as SinkCapable;
	if (!sink.setSinkId) return;
	// "" is the platform default, which is what a null preference means.
	sink.setSinkId(voiceAudioSettings().outputDeviceId ?? "").catch((err: unknown) => {
		console.warn("Could not route app sounds to the chosen output device", err);
	});
}

/** The shared context, created on first use. */
export function audioContext(): AudioContext {
	if (!context) {
		context = new AudioContext();
		applyAudioOutput();
	}
	return context;
}

/**
 * Resumes the shared context. Call it from the click that leads to audio: browsers start a
 * context suspended, and resuming without a gesture is refused.
 */
export function resumeAudio(): void {
	const ctx = audioContext();
	if (ctx.state === "running") return;
	ctx.resume().catch((err: unknown) => {
		// No gesture yet, or the tab is not allowed to play; the next click tries again.
		console.warn("Audio is not running yet", err);
	});
}

subscribeVoiceAudio(applyAudioOutput);
