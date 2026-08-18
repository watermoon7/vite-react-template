/**
 * Theme preference: "light" and "dark" force a theme, "system" follows the operating
 * system. Stored per browser in localStorage (a display preference, not shared data).
 *
 * Only the forced themes need JavaScript: they set data-theme on <html>, which app.css
 * keys off. "system" removes the attribute and lets the prefers-color-scheme rule apply,
 * so an OS appearance change repaints with no listener and no re-render here.
 */
import { CLIENT, THEMES } from "../../app.config";

export type ThemePreference = (typeof THEMES)[number]["id"];

const KEY = CLIENT.storageKeys.theme;
const DEFAULT: ThemePreference = "system";

const listeners = new Set<() => void>();
let current: ThemePreference = DEFAULT;

/** Narrows an arbitrary stored string, which may have been hand-edited. */
function asPreference(raw: string | null): ThemePreference {
	if (raw === null) return DEFAULT;
	const match = THEMES.find((theme) => theme.id === raw);
	return match ? match.id : DEFAULT;
}

function readStored(): ThemePreference {
	try {
		return asPreference(localStorage.getItem(KEY));
	} catch {
		return DEFAULT; // storage unavailable (private mode)
	}
}

/** Writes the preference to the document so CSS can use it. */
function applyToDocument(value: ThemePreference): void {
	const root = document.documentElement;
	if (value === "system") root.removeAttribute("data-theme");
	else root.dataset.theme = value;
}

/**
 * Loads the saved theme, applies it, and keeps this tab in step with any other tab.
 * Call once before the app renders. The pre-paint script in index.html has normally
 * applied the same value already; this is the idempotent belt-and-braces.
 */
export function initTheme(): void {
	current = readStored();
	applyToDocument(current);
	window.addEventListener("storage", (e: StorageEvent) => {
		if (e.key !== KEY) return;
		const next = readStored();
		if (next === current) return;
		current = next;
		applyToDocument(next);
		for (const listener of listeners) listener();
	});
}

export function getTheme(): ThemePreference {
	return current;
}

export function setTheme(value: ThemePreference): void {
	if (!THEMES.some((theme) => theme.id === value)) throw new Error(`unknown theme: ${value}`);
	if (value === current) return;
	current = value;
	applyToDocument(value);
	try {
		localStorage.setItem(KEY, value);
	} catch {
		// Storage unavailable (private mode): the theme still applies for this session.
	}
	for (const listener of listeners) listener();
}

/** Subscribes to theme changes, including changes made in another tab. */
export function subscribeTheme(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
