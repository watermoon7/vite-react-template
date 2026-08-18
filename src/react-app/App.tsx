/** Application shell: session gate, hash routing, sidebar + main pane. */
import { useEffect, useMemo } from "react";
import { CLIENT } from "../../app.config";
import type { AppState } from "../shared/types";
import { BoardView } from "./components/BoardView";
import { Login } from "./components/Login";
import { NotesPage } from "./components/NotesPage";
import { SettingsPage } from "./components/SettingsPage";
import { Sidebar } from "./components/Sidebar";
import { lastRoute, parseHash, routeToHash, useHash, type Route } from "./router";
import { bootstrap, dismissError, useStore } from "./store";

/** Turns the URL route into one that points at something that exists. */
function resolveRoute(requested: Route, data: AppState): Route {
	const exists = (id: string) => data.boards.some((b) => b.id === id);
	if (requested.kind === "board" && exists(requested.boardId)) {
		if (requested.taskId && !data.tasks.some((t) => t.id === requested.taskId)) {
			return { kind: "board", boardId: requested.boardId };
		}
		return requested;
	}
	if (requested.kind === "notes" || requested.kind === "settings") return requested;
	const remembered = lastRoute();
	if (remembered && remembered.kind === "board" && exists(remembered.boardId)) return remembered;
	if (remembered && (remembered.kind === "notes" || remembered.kind === "settings")) return remembered;
	return data.boards.length > 0 ? { kind: "board", boardId: data.boards[0].id } : { kind: "home" };
}

export default function App() {
	const store = useStore();
	const hash = useHash();

	useEffect(() => {
		void bootstrap();
	}, []);

	const data = store.data;
	const route = useMemo(() => (data ? resolveRoute(parseHash(hash), data) : null), [hash, data]);

	useEffect(() => {
		if (route && route.kind !== "home") localStorage.setItem(CLIENT.storageKeys.lastRoute, routeToHash(route));
	}, [route]);

	if (store.auth === "unauthenticated") return <Login />;
	if (store.auth === "unknown" || !data || !route || !store.user) {
		return <div className="screen-center muted">Loading…</div>;
	}

	const board = route.kind === "board" ? data.boards.find((b) => b.id === route.boardId) : undefined;

	return (
		<div className="app">
			<Sidebar route={route} boards={data.boards} tasks={data.tasks} user={store.user} live={store.live} />
			<main className="main">
				{store.error && (
					<div className="banner" role="alert">
						<span>Something went wrong: {store.error}</span>
						<button className="icon-btn" aria-label="Dismiss" onClick={dismissError}>
							×
						</button>
					</div>
				)}
				{board && (
					<BoardView
						key={board.id}
						board={board}
						tasks={data.tasks.filter((t) => t.boardId === board.id)}
						selectedId={route.kind === "board" ? (route.taskId ?? null) : null}
					/>
				)}
				{route.kind === "notes" && (
					<NotesPage key={route.scope} scope={route.scope} content={data.notes[route.scope]} />
				)}
				{route.kind === "settings" && <SettingsPage user={store.user} data={data} />}
				{route.kind === "home" && (
					<div className="screen-center muted">
						<div className="empty">
							<p>No boards yet.</p>
							<p className="small">Use “+” next to Boards in the left panel to create one.</p>
						</div>
					</div>
				)}
			</main>
		</div>
	);
}
