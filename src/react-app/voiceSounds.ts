/**
 * The voice room's cues: the short tones that tell you someone arrived, left, muted, or put
 * their screen up, without you having to be looking at the sidebar.
 *
 * They are synthesised rather than loaded, which keeps them out of the bundle and lets them be
 * exactly what a cue should be — a couple of sine tones with a soft envelope, over in a sixth
 * of a second, at a level that sits under speech rather than across it. Direction carries the
 * meaning: rising for arriving and unmuting, falling for leaving and muting, and cues about
 * the other person play quieter than cues about your own actions.
 */
import { VOICE } from "../../app.config";
import { audioContext, resumeAudio } from "./audioContext";
import { voiceAudioSettings } from "./voiceAudio";

export type VoiceCue =
	| "join"
	| "peer-join"
	| "peer-leave"
	| "mute"
	| "unmute"
	| "peer-mute"
	| "peer-unmute"
	| "screen-share";

/** Notes of a D major pentatonic, the interval sizes of which stay pleasant in any order. */
const A4 = 440;
const D5 = 587.33;
const E5 = 659.25;
const FS5 = 739.99;
const A5 = 880;

/** Gap between the tones of a cue, in seconds: short enough to hear as one gesture. */
const TONE_SPACING_SECONDS = 0.085;

interface CueSpec {
	/** Tone frequencies in Hz, played in order. */
	notes: number[];
	/** Level relative to VOICE.sounds.volume. */
	level: number;
}

const PEER = VOICE.sounds.peerLevelRatio;

const CUES: Record<VoiceCue, CueSpec> = {
	join: { notes: [D5, A5], level: 1 },
	"peer-join": { notes: [D5, A5], level: PEER },
	"peer-leave": { notes: [A5, D5], level: PEER },
	mute: { notes: [E5, A4], level: 1 },
	unmute: { notes: [A4, E5], level: 1 },
	"peer-mute": { notes: [E5, A4], level: PEER },
	"peer-unmute": { notes: [A4, E5], level: PEER },
	"screen-share": { notes: [D5, FS5, A5], level: 1 },
};

/** Level a tone fades to. Not zero: an exponential ramp cannot reach it, and a linear one clicks. */
const SILENCE = 0.0001;

/** Schedules one tone: a sine with a quick attack and an exponential decay, then gone. */
function scheduleTone(frequency: number, level: number, startAt: number): void {
	if (!(frequency > 0)) throw new Error(`tone frequency must be positive, got ${frequency}`);
	if (!(level > 0)) throw new Error(`tone level must be positive, got ${level}`);
	const ctx = audioContext();
	const oscillator = ctx.createOscillator();
	const envelope = ctx.createGain();
	const { toneSeconds, attackSeconds } = VOICE.sounds;
	oscillator.type = "sine";
	oscillator.frequency.setValueAtTime(frequency, startAt);
	envelope.gain.setValueAtTime(SILENCE, startAt);
	envelope.gain.linearRampToValueAtTime(level, startAt + attackSeconds);
	envelope.gain.exponentialRampToValueAtTime(SILENCE, startAt + toneSeconds);
	oscillator.connect(envelope);
	envelope.connect(ctx.destination);
	oscillator.start(startAt);
	oscillator.stop(startAt + toneSeconds);
	// Nodes are single-use; dropping the graph as soon as it has played keeps them from piling up.
	oscillator.onended = () => {
		oscillator.disconnect();
		envelope.disconnect();
	};
}

/**
 * Plays a cue, unless the user has turned the room's sounds off. Silent by design when the
 * browser has not had a gesture yet — every cue follows either a click of yours or a message
 * about someone else, and by then the context is running.
 */
export function playCue(cue: VoiceCue): void {
	const spec = CUES[cue];
	if (!spec) throw new Error(`unknown voice cue: ${String(cue)}`);
	if (!voiceAudioSettings().sounds) return;
	resumeAudio();
	const ctx = audioContext();
	const start = ctx.currentTime;
	spec.notes.forEach((note, index) => {
		scheduleTone(note, VOICE.sounds.volume * spec.level, start + index * TONE_SPACING_SECONDS);
	});
}
