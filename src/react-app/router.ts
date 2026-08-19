/**
 * Minimal hash router: #/b/<boardId>[/t/<taskId>], #/c/<channelId>, #/calendar[/t/<taskId>],
 * #/music, #/screen, #/settings.
 */
import { useSyncExternalStore } from "react";
import { CLIENT } from "../../app.config";

export type Route =
	| { kind: "home" }
	/** `taskId` is the task whose editor is open, so a task can be linked to directly. */
	| { kind: "board"; boardId: string; taskId?: string }
	| { kind: "channel"; channelId: string }
	/** Month calendar of due dates across every board; `taskId` is the task whose editor is open. */
	| { kind: "calendar"; taskId?: string }
	/** The shared playlist and player. */
	| { kind: "music" }
	/** The other user's screen share, filling the main pane. */
	| { kind: "screen" }
	| { kind: "settings" };

export function parseHash(hash: string): Route {
	const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
	if (parts[0] === "b" && parts[1]) {
		const boardId = decodeURIComponent(parts[1]);
		if (parts[2] === "t" && parts[3]) return { kind: "board", boardId, taskId: decodeURIComponent(parts[3]) };
		return { kind: "board", boardId };
	}
	if (parts[0] === "c" && parts[1]) return { kind: "channel", channelId: decodeURIComponent(parts[1]) };
	if (parts[0] === "calendar") {
		if (parts[1] === "t" && parts[2]) return { kind: "calendar", taskId: decodeURIComponent(parts[2]) };
		return { kind: "calendar" };
	}
	if (parts[0] === "music") return { kind: "music" };
	if (parts[0] === "screen") return { kind: "screen" };
	if (parts[0] === "settings") return { kind: "settings" };
	return { kind: "home" };
}

export function routeToHash(route: Route): string {
	switch (route.kind) {
		case "board": {
			const base = `#/b/${encodeURIComponent(route.boardId)}`;
			return route.taskId ? `${base}/t/${encodeURIComponent(route.taskId)}` : base;
		}
		case "channel":
			return `#/c/${encodeURIComponent(route.channelId)}`;
		case "calendar":
			return route.taskId ? `#/calendar/t/${encodeURIComponent(route.taskId)}` : "#/calendar";
		case "music":
			return "#/music";
		case "screen":
			return "#/screen";
		case "settings":
			return "#/settings";
		default:
			return "#/";
	}
}

export function navigate(route: Route): void {
	const hash = routeToHash(route);
	if (location.hash !== hash) location.hash = hash;
	if (route.kind !== "home") localStorage.setItem(CLIENT.storageKeys.lastRoute, hash);
}

/** The route the user was on last time (used when the URL has no route). */
export function lastRoute(): Route | null {
	const saved = localStorage.getItem(CLIENT.storageKeys.lastRoute);
	return saved ? parseHash(saved) : null;
}

const hashListeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
	hashListeners.add(onChange);
	window.addEventListener("hashchange", onChange);
	return () => {
		hashListeners.delete(onChange);
		window.removeEventListener("hashchange", onChange);
	};
}

/**
 * Changes the hash without adding a history entry, for changes that are not navigation
 * (opening and closing a task). Back should leave the board, not step back through every
 * task the user clicked. `history.replaceState` does not fire `hashchange`, so subscribers
 * are notified directly.
 */
export function replaceRoute(route: Route): void {
	const hash = routeToHash(route);
	if (location.hash === hash) return;
	history.replaceState(null, "", hash);
	if (route.kind !== "home") localStorage.setItem(CLIENT.storageKeys.lastRoute, hash);
	for (const listener of hashListeners) listener();
}

export function useHash(): string {
	return useSyncExternalStore(subscribe, () => location.hash);
}
