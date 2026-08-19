/** Reading what the browser knows about an audio file before it is uploaded. */
import { MUSIC } from "../../app.config";

/** Filename without its extension, used as the default song title. */
export function titleFromFilename(name: string): string {
	const stem = name.replace(/\.[^.]+$/, "").trim();
	return stem.length > 0 ? stem.slice(0, MUSIC.titleMaxLength) : "Untitled";
}

/** Longest a duration probe may take before the file is accepted without one, in ms. */
const DURATION_TIMEOUT_MS = 10_000;

/**
 * Reads a file's length by letting the browser decode its metadata. Resolves to null rather
 * than rejecting when the browser cannot read it: a song without a known length still plays,
 * it just cannot show a total or auto-advance on the server's reckoning alone.
 */
export function readAudioDuration(file: File): Promise<number | null> {
	if (!(file instanceof File)) throw new Error("file must be a File");
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const probe = new Audio();
		let settled = false;
		const finish = (duration: number | null) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			URL.revokeObjectURL(url);
			probe.removeAttribute("src");
			resolve(duration);
		};
		const timer = window.setTimeout(() => finish(null), DURATION_TIMEOUT_MS);
		probe.preload = "metadata";
		probe.onloadedmetadata = () => finish(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : null);
		probe.onerror = () => finish(null);
		probe.src = url;
	});
}

/** The audio files of a drop or a file picker, in the order they were given. */
export function audioFilesOf(list: FileList | null): File[] {
	if (!list) return [];
	const files: File[] = [];
	for (const file of Array.from(list)) {
		// Some browsers report no type for .flac and .opus, so an empty type is let through
		// and the server decides from the bytes.
		if (file.type === "" || file.type.startsWith("audio/")) files.push(file);
	}
	return files;
}
