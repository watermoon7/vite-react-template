/**
 * Application configuration shared by the Worker (server) and the React app (client).
 * Everything tunable lives here — nothing below should be hardcoded elsewhere.
 */

/**
 * Visual styles offered in Settings. "classic" is the original flat look; "glass" is a
 * translucent, blurred look over a soft colour backdrop. Both follow the light/dark theme.
 */
export const STYLES = [
	{ id: "classic", label: "Classic" },
	{ id: "glass", label: "Glass" },
] as const;

type StyleId = (typeof STYLES)[number]["id"];

/**
 * The two users. `passwordSecret` names the Worker secret / .dev.vars key holding that
 * user's password. `defaultStyle` applies until the user picks a style in Settings.
 */
export const USERS = [
	{ id: "will", name: "Will", passwordSecret: "PASSWORD_WILL", defaultStyle: "classic" },
	{ id: "theo", name: "Theo", passwordSecret: "PASSWORD_THEO", defaultStyle: "glass" },
] as const satisfies readonly { id: string; name: string; passwordSecret: string; defaultStyle: StyleId }[];

/** Board columns, in display order. The first column receives newly created tasks. */
export const COLUMNS = [
	{ id: "not_started", label: "Not started" },
	{ id: "in_progress", label: "In progress" },
	{ id: "completed", label: "Completed" },
] as const;

/** Task priorities, in ascending order. */
export const PRIORITIES = [
	{ id: "low", label: "Low" },
	{ id: "medium", label: "Medium" },
	{ id: "high", label: "High" },
] as const;

/** Theme choices offered in Settings. "system" follows the operating system. */
export const THEMES = [
	{ id: "light", label: "Light" },
	{ id: "system", label: "System" },
	{ id: "dark", label: "Dark" },
] as const;

/** Assignee used for a task when none is chosen. */
export const DEFAULT_ASSIGNEE = "both";

/** Authentication / session settings (server). */
export const AUTH = {
	cookieName: "kanban_session",
	sessionTtlDays: 30,
	/** Failed login attempts allowed per IP within the lockout window. */
	loginMaxFailures: 10,
	/** How long an IP is locked out after too many failures. */
	loginLockoutMinutes: 15,
};

/** Input limits enforced by the server. */
export const LIMITS = {
	boardNameMaxLength: 120,
	taskTextMaxLength: 20_000,
	notesMaxLength: 200_000,
	restoreMaxItems: 5_000,
};

/** Interface scale ("zoom"): scales the whole app, like the browser's Ctrl +/-. */
export const DISPLAY = {
	/** Selectable scale factors, ascending. Mirrors the browser's own zoom levels. */
	scaleSteps: [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2],
	defaultScale: 1,
};

/** Client-side behaviour. */
export const CLIENT = {
	/** Delay between the last keystroke and the save request. */
	saveDebounceMs: 500,
	/** WebSocket keep-alive ping interval. */
	wsPingIntervalMs: 30_000,
	/** WebSocket reconnect backoff bounds. */
	wsReconnectMinMs: 1_000,
	wsReconnectMaxMs: 30_000,
	/** How often a periodic local backup snapshot is taken (if data changed). */
	backupIntervalMinutes: 30,
	/** Maximum number of snapshots kept in localStorage. */
	backupMaxSnapshots: 40,
	/** Settings warns when the newest local snapshot is older than this. */
	backupStaleWarningDays: 7,
	/** Sidebar task search. Runs entirely in the client over the already-loaded tasks. */
	search: {
		/** Shortest trimmed query that triggers a search. */
		minQueryLength: 1,
		/** Most results listed at once; anything beyond this is reported as a count. */
		maxResults: 50,
	},
	/** localStorage keys. */
	storageKeys: {
		backups: "kanban:backups:v1",
		lastRoute: "kanban:lastRoute",
		scale: "kanban:scale",
		/** Duplicated in the pre-paint script in index.html — change both together. */
		theme: "kanban:theme",
		/** Style last applied in this browser; read by the pre-paint script in index.html — change both together. */
		style: "kanban:style",
		/** Each user's chosen style in this browser, as a JSON object keyed by user id. */
		styleChoices: "kanban:style-choices",
	},
};
