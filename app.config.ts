/**
 * Application configuration shared by the Worker (server) and the React app (client).
 * Everything tunable lives here — nothing below should be hardcoded elsewhere.
 */

/**
 * Visual styles offered in Settings. "classic" is the original flat look; "glass" is a
 * translucent, blurred look over a soft colour backdrop. Both follow the light/dark theme.
 * The ids are stored in localStorage and keyed on by app.css, so only the labels are renamable.
 */
export const STYLES = [
	{ id: "classic", label: "Erect" },
	{ id: "glass", label: "Glassid" },
] as const;

type StyleId = (typeof STYLES)[number]["id"];

/**
 * Style of the sign-in page — shown before any user, and so their preference, is known.
 * Duplicated as the fallback in the pre-paint script in index.html — change both together.
 */
export const LOGIN_STYLE: StyleId = "glass";

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

/**
 * Orders offered by the board's Sort control. "manual" is the drag-and-drop order; the
 * others sort each column by that field (ties keep the manual order). Stored per browser.
 */
export const TASK_SORTS = [
	{ id: "manual", label: "Manual" },
	{ id: "priority", label: "Priority" },
	{ id: "due", label: "Due date" },
	{ id: "name", label: "Name" },
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
	channelNameMaxLength: 60,
	messageTextMaxLength: 4_000,
	restoreMaxItems: 5_000,
	playlistMaxSongs: 1_000,
};

/** Text channels: Discord-style message logs shared by both users. */
export const CHANNELS = {
	/** Image formats accepted by the server (checked by content, not by the declared type). */
	imageTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
	/**
	 * Largest image the server stores, in bytes. Images live in the Durable Object's SQLite,
	 * which caps a single row at 2 MB, so keep a margin below that.
	 */
	imageMaxBytes: 1_500_000,
	/** Longest edge, in pixels, an image is scaled down to when it has to be re-encoded before upload. */
	imageMaxDimension: 1600,
	/** JPEG quality (0-1) used when an image is re-encoded before upload. */
	imageJpegQuality: 0.85,
	/** Consecutive messages by the same author within this many minutes share one author/time header. */
	groupWindowMinutes: 5,
	/** The log keeps following new messages while scrolled within this many pixels of the bottom. */
	stickToBottomPx: 40,
};

/**
 * Passive voice room: one always-existing room both users can join and leave at will.
 * Membership is live socket state in the Durable Object; the media itself is a direct
 * 1:1 WebRTC connection, so nothing below sizes a server.
 */
export const VOICE = {
	/**
	 * Fallback ICE servers used when no Cloudflare Realtime TURN credentials are configured.
	 * STUN alone is enough for most home networks; a relay is only needed behind symmetric NAT.
	 */
	fallbackIceServers: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"],
	/** Lifetime, in seconds, of a minted TURN credential. */
	turnCredentialTtlSeconds: 12 * 60 * 60,
	/** Constraints for the microphone capture. */
	micConstraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
	/** Longest edge and frame rate requested when sharing a screen. */
	screenConstraints: { width: 1920, height: 1080, frameRate: 30 },
	/** How long a peer connection may sit in "disconnected" before ICE is restarted, in ms. */
	iceRestartAfterMs: 4_000,
};

/**
 * Shared music player: a playlist in the Durable Object, audio files in R2, and one
 * playback state (song, playing, position at a server timestamp) pushed to every client.
 */
export const MUSIC = {
	/** Audio formats accepted by the server (checked by content, not by the declared type). */
	audioTypes: ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/flac", "audio/wav"],
	/** File extensions offered by the file picker. */
	fileAccept: ".mp3,.m4a,.aac,.ogg,.oga,.opus,.flac,.wav,audio/*",
	/** Largest song accepted, in bytes. Songs live in R2, so this is a sanity cap, not a row limit. */
	maxBytes: 30 * 1024 * 1024,
	/** Longest song title kept. */
	titleMaxLength: 200,
	/** How often each client compares its player against the shared position, in ms. */
	syncIntervalMs: 1_000,
	/**
	 * Drift, in ms, that a client tolerates before it corrects its own player. Below roughly
	 * this the correction itself is more audible than the drift.
	 */
	driftToleranceMs: 200,
	/** Drift, in ms, beyond which the client hard-seeks instead of nudging the playback rate. */
	driftSeekMs: 1_500,
	/** Playback rate nudge used to absorb drift between the tolerance and the seek threshold. */
	driftRateNudge: 0.02,
	/**
	 * Quiet period after the last move of the seek bar before the seek is sent. Each seek is
	 * a shared-state change, and the reply to an earlier one would rewind the bar under the
	 * user's finger; one command per gesture avoids that as well as the traffic.
	 */
	seekCommitDebounceMs: 180,
	/** Seconds skipped by the back/forward buttons. */
	skipSeconds: 10,
	/** Pressing "previous" this far into a song restarts it instead of going back one. */
	previousRestartsAfterSeconds: 3,
};

/** Interface scale ("zoom"): scales the whole app, like the browser's Ctrl +/-. */
export const DISPLAY = {
	/** Selectable scale factors, ascending. Mirrors the browser's own zoom levels. */
	scaleSteps: [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2],
	defaultScale: 1,
};

/** Calendar view of tasks that have a due date. */
export const CALENDAR = {
	/** First day of the week in the month grid: 0 = Sunday, 1 = Monday. */
	weekStartsOn: 1,
};

/** Client-side behaviour. */
export const CLIENT = {
	/** Delay between the last keystroke and the save request. */
	saveDebounceMs: 500,
	/** WebSocket keep-alive ping interval. */
	wsPingIntervalMs: 30_000,
	/** Server-clock estimation over the WebSocket (keeps the two music players together). */
	clock: {
		/** Round trips sent back to back when the socket opens; the fastest one wins. */
		burstSamples: 4,
		/** Gap between the round trips of a burst, in ms. */
		burstSpacingMs: 120,
		/** How often a fresh burst is sent to track clock drift, in ms. */
		refreshIntervalMs: 60_000,
	},
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
		maxResults: 10,
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
		/** The board Sort control's choice (one of TASK_SORTS). */
		taskSort: "kanban:task-sort",
		/** Unsent chat drafts, as a JSON object keyed by channel id. */
		chatDrafts: "kanban:chat-drafts:v1",
		/** Player volume (0-1) in this browser; volume is per-listener, not shared. */
		musicVolume: "kanban:music-volume",
	},
};
