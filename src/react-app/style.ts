/**
 * Visual style: "classic" (the original flat look) or "glass" (translucent panels over a
 * colour backdrop). Each user starts on the default configured for them in USERS and can
 * pick another in Settings; the choice is remembered per user in this browser's
 * localStorage (a display preference, not shared data).
 *
 * The style is applied as data-style on <html>, which app.css keys off. The last applied
 * value is also stored on its own so the pre-paint script in index.html — which runs before
 * the session, and so the user, is known — can apply it without a flash.
 */
import { CLIENT, STYLES, USERS } from "../../app.config";
import { isUserId, type UserId } from "../shared/types";

export type StylePreference = (typeof STYLES)[number]["id"];

type StyleChoices = Partial<Record<UserId, StylePreference>>;

const APPLIED_KEY = CLIENT.storageKeys.style;
const CHOICES_KEY = CLIENT.storageKeys.styleChoices;
/** Shown before any user is known (first visit, login page): the first configured style. */
const FALLBACK: StylePreference = STYLES[0].id;

const listeners = new Set<() => void>();
let current: StylePreference = FALLBACK;
let boundUser: UserId | null = null;

/** Narrows an arbitrary value, which may come from hand-edited storage. */
function isStyle(raw: unknown): raw is StylePreference {
	return typeof raw === "string" && STYLES.some((style) => style.id === raw);
}

function defaultFor(user: UserId): StylePreference {
	const entry = USERS.find((u) => u.id === user);
	if (!entry) throw new Error(`unknown user: ${user}`);
	return entry.defaultStyle;
}

/** Every user's stored choice in this browser. Tolerates missing, corrupt or hand-edited storage. */
function readChoices(): StyleChoices {
	try {
		const raw = localStorage.getItem(CHOICES_KEY);
		if (raw === null) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		const choices: StyleChoices = {};
		for (const [user, style] of Object.entries(parsed)) {
			if (isUserId(user) && isStyle(style)) choices[user] = style;
		}
		return choices;
	} catch {
		return {}; // storage unavailable (private mode) or not JSON
	}
}

/** The style `user` should see: their choice in this browser, else their configured default. */
function resolveFor(user: UserId): StylePreference {
	return readChoices()[user] ?? defaultFor(user);
}

function readApplied(): StylePreference {
	try {
		const raw = localStorage.getItem(APPLIED_KEY);
		return isStyle(raw) ? raw : FALLBACK;
	} catch {
		return FALLBACK;
	}
}

/** Writes the style to the document so CSS can use it, and remembers it for the pre-paint script. */
function applyToDocument(value: StylePreference): void {
	document.documentElement.dataset.style = value;
	try {
		localStorage.setItem(APPLIED_KEY, value);
	} catch {
		// Storage unavailable (private mode): the style still applies for this session.
	}
}

function update(next: StylePreference): void {
	if (next === current) return;
	current = next;
	applyToDocument(next);
	for (const listener of listeners) listener();
}

/**
 * Applies the last style used in this browser and keeps this tab in step with choices made
 * in other tabs. Call once before the app renders; the pre-paint script in index.html has
 * normally applied the same value already — this is the idempotent belt-and-braces.
 */
export function initStyle(): void {
	current = readApplied();
	applyToDocument(current);
	window.addEventListener("storage", (e: StorageEvent) => {
		if (e.key !== CHOICES_KEY || boundUser === null) return;
		update(resolveFor(boundUser));
	});
}

/**
 * Switches to the signed-in user's style (their choice in this browser, else their default).
 * Call as soon as the session is known and again if the user changes.
 */
export function bindStyleUser(user: UserId): void {
	if (!isUserId(user)) throw new Error(`unknown user: ${String(user)}`);
	boundUser = user;
	update(resolveFor(user));
}

export function getStyle(): StylePreference {
	return current;
}

/** Chooses a style for the signed-in user and remembers it for them in this browser. */
export function setStyle(value: StylePreference): void {
	if (!isStyle(value)) throw new Error(`unknown style: ${String(value)}`);
	if (boundUser === null) throw new Error("setStyle before bindStyleUser");
	try {
		localStorage.setItem(CHOICES_KEY, JSON.stringify({ ...readChoices(), [boundUser]: value }));
	} catch {
		// Storage unavailable (private mode): the style still applies for this session.
	}
	update(value);
}

/** Subscribes to style changes, including changes made in another tab. */
export function subscribeStyle(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
