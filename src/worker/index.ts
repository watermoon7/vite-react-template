/**
 * HTTP entry point. Handles login/logout and session auth, validates request bodies,
 * and delegates all data operations to the KanbanStore Durable Object via RPC.
 */
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { AUTH } from "../../app.config";
import type { UserId } from "../shared/types";
import { createSessionToken, verifyPassword, verifySessionToken } from "./auth";
import { KanbanStore, NOT_FOUND } from "./store";
import {
	ValidationError,
	parseBackupData,
	parseBoardInput,
	parseColumnOrder,
	parseNotesInput,
	parseNotesScope,
	parseTaskCreate,
	parseTaskPatch,
} from "./validate";

export { KanbanStore };

type AppEnv = { Bindings: Env; Variables: { user: UserId } };
type Ctx = Context<AppEnv>;

const app = new Hono<AppEnv>();

/** The single store instance shared by both users. */
function store(env: Env): DurableObjectStub<KanbanStore> {
	return env.KANBAN.get(env.KANBAN.idFromName("main"));
}

function clientIp(c: Ctx): string {
	return c.req.header("CF-Connecting-IP") ?? "local";
}

function isHttps(c: Ctx): boolean {
	return new URL(c.req.url).protocol === "https:";
}

/** Reads a JSON body, rejecting non-JSON content types (also acts as a CSRF guard). */
async function jsonBody(c: Ctx): Promise<unknown> {
	const type = c.req.header("Content-Type") ?? "";
	if (!type.includes("application/json")) throw new ValidationError("expected application/json");
	try {
		return await c.req.json();
	} catch {
		throw new ValidationError("invalid JSON");
	}
}

app.onError((err, c) => {
	if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
	if (err.message === NOT_FOUND) return c.json({ error: "not found" }, 404);
	console.error(err);
	return c.json({ error: "internal error" }, 500);
});

// ---------- Auth ----------

/** Plain form POST so browsers offer to save the password; redirects back to the app. */
app.post("/api/login", async (c) => {
	if (!c.env.SESSION_SECRET) return c.text("Server misconfigured: SESSION_SECRET is not set", 500);
	const body = await c.req.parseBody();
	const username = typeof body.username === "string" ? body.username : "";
	const password = typeof body.password === "string" ? body.password : "";
	const ip = clientIp(c);
	const db = store(c.env);
	if (await db.isLoginLocked(ip)) return c.redirect("/?login=locked", 303);
	const user = await verifyPassword(c.env as unknown as Record<string, string | undefined>, username, password);
	await db.recordLoginAttempt(ip, user !== null);
	if (!user) return c.redirect("/?login=failed", 303);
	setCookie(c, AUTH.cookieName, await createSessionToken(user, c.env.SESSION_SECRET), {
		httpOnly: true,
		secure: isHttps(c),
		sameSite: "Lax",
		path: "/",
		maxAge: AUTH.sessionTtlDays * 24 * 60 * 60,
	});
	return c.redirect("/", 303);
});

app.post("/api/logout", (c) => {
	deleteCookie(c, AUTH.cookieName, { path: "/" });
	return c.body(null, 204);
});

/** Everything below requires a valid session cookie. */
app.use("/api/*", async (c, next) => {
	const user = await verifySessionToken(getCookie(c, AUTH.cookieName), c.env.SESSION_SECRET);
	if (!user) return c.json({ error: "unauthorized" }, 401);
	c.set("user", user);
	await next();
});

app.get("/api/me", (c) => c.json({ user: c.get("user") }));

// ---------- Real-time ----------

/** Cross-site handshakes carry no session cookie (SameSite=Lax), and the socket only pushes state. */
app.get("/api/ws", (c) => {
	if (c.req.header("Upgrade") !== "websocket") return c.text("expected websocket", 426);
	const headers = new Headers(c.req.raw.headers);
	headers.set("x-kanban-user", c.get("user"));
	return store(c.env).fetch(new Request(c.req.raw.url, { headers, method: "GET" }));
});

// ---------- Data ----------

app.get("/api/state", async (c) => c.json(await store(c.env).getState(c.get("user"))));

app.post("/api/boards", async (c) => {
	const { name } = parseBoardInput(await jsonBody(c));
	return c.json(await store(c.env).createBoard(c.get("user"), name), 201);
});

app.patch("/api/boards/:id", async (c) => {
	const { name } = parseBoardInput(await jsonBody(c));
	return c.json(await store(c.env).renameBoard(c.get("user"), c.req.param("id"), name));
});

app.delete("/api/boards/:id", async (c) =>
	c.json(await store(c.env).deleteBoard(c.get("user"), c.req.param("id"))),
);

app.post("/api/boards/:id/reorder", async (c) => {
	const columns = parseColumnOrder(await jsonBody(c));
	return c.json(await store(c.env).reorderTasks(c.get("user"), c.req.param("id"), columns));
});

app.post("/api/tasks", async (c) => {
	const { boardId } = parseTaskCreate(await jsonBody(c));
	return c.json(await store(c.env).createTask(c.get("user"), boardId), 201);
});

app.patch("/api/tasks/:id", async (c) => {
	const patch = parseTaskPatch(await jsonBody(c));
	return c.json(await store(c.env).updateTask(c.get("user"), c.req.param("id"), patch));
});

app.delete("/api/tasks/:id", async (c) =>
	c.json(await store(c.env).deleteTask(c.get("user"), c.req.param("id"))),
);

app.put("/api/notes/:scope", async (c) => {
	const scope = parseNotesScope(c.req.param("scope"));
	const { content } = parseNotesInput(await jsonBody(c));
	return c.json(await store(c.env).saveNotes(c.get("user"), scope, content));
});

app.post("/api/restore", async (c) => {
	const data = parseBackupData(await jsonBody(c));
	return c.json(await store(c.env).restore(c.get("user"), data));
});

export default app;
