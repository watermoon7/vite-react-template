/**
 * Interface scale: scales everything in the app the way the browser's Ctrl +/- does.
 * Stored per browser in localStorage (a display preference, not shared data) and
 * applied as a CSS custom property that drives `zoom` on the app root.
 */
import { CLIENT, DISPLAY } from "../../app.config";

const KEY = CLIENT.storageKeys.scale;
const STEPS = DISPLAY.scaleSteps;
const MIN = STEPS[0];
const MAX = STEPS[STEPS.length - 1];

const listeners = new Set<() => void>();
let current = DISPLAY.defaultScale;

/** The configured step closest to `value` (guards against hand-edited storage). */
function nearestStep(value: number): number {
	if (!Number.isFinite(value)) return DISPLAY.defaultScale;
	const clamped = Math.min(MAX, Math.max(MIN, value));
	let best = STEPS[0];
	for (const step of STEPS) {
		if (Math.abs(step - clamped) < Math.abs(best - clamped)) best = step;
	}
	return best;
}

/** Writes the scale to the document so CSS can use it. */
function applyToDocument(value: number): void {
	document.documentElement.style.setProperty("--app-scale", String(value));
}

function readStored(): number {
	try {
		const raw = localStorage.getItem(KEY);
		return raw === null ? DISPLAY.defaultScale : nearestStep(Number(raw));
	} catch {
		return DISPLAY.defaultScale;
	}
}

/**
 * Loads the saved scale, applies it, and keeps this tab in step with any other tab.
 * Call once before the app renders so the interface never flashes at the wrong size.
 */
export function initScale(): void {
	current = readStored();
	applyToDocument(current);
	// Browser zoom applies to every tab of a site; this preference behaves the same way.
	window.addEventListener("storage", (e: StorageEvent) => {
		if (e.key !== KEY) return;
		const next = readStored();
		if (next === current) return;
		current = next;
		applyToDocument(next);
		for (const listener of listeners) listener();
	});
}

export function getScale(): number {
	return current;
}

/** Sets the scale to the nearest configured step and persists it. */
export function setScale(value: number): void {
	const next = nearestStep(value);
	if (next === current) return;
	current = next;
	applyToDocument(next);
	try {
		localStorage.setItem(KEY, String(next));
	} catch {
		// Storage unavailable (private mode): the scale still applies for this session.
	}
	for (const listener of listeners) listener();
}

/** Moves one step up (+1) or down (-1) the scale ladder. */
export function stepScale(direction: 1 | -1): void {
	if (direction !== 1 && direction !== -1) throw new Error("direction must be 1 or -1");
	const index = STEPS.indexOf(current);
	const from = index === -1 ? STEPS.indexOf(nearestStep(current)) : index;
	setScale(STEPS[Math.min(STEPS.length - 1, Math.max(0, from + direction))]);
}

export function resetScale(): void {
	setScale(DISPLAY.defaultScale);
}

export function canIncrease(value: number): boolean {
	return value < MAX;
}

export function canDecrease(value: number): boolean {
	return value > MIN;
}

/** Subscribes to scale changes, including changes made in another tab. */
export function subscribeScale(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
