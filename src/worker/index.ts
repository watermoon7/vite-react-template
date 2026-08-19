/**
 * HTTP entry point. Handles login/logout and session auth, validates request bodies,
 * and delegates all data operations to the KanbanStore Durable Object via RPC.
 */
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { AUTH, MUSIC, VOICE } from "../../app.config";
import type { IceServer, UserId } from "../shared/types";
import { createSessionToken, verifyPassword, verifySessionToken } from "./auth";
import { FORBIDDEN, KanbanStore, NOT_FOUND } from "./store";
import {
	ValidationError,
	parseBackupData,
	parseBoardInput,
	parseChannelInput,
	parseColumnOrder,
	parseMessageEdit,
	parseMessageInput,
	parsePlaybackCommand,
	parseSongOrder,
	parseSongTitle,
	parseSongUpload,
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
	if (err.message === FORBIDDEN) return c.json({ error: "forbidden" }, 403);
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

// ---------- Channels ----------

app.post("/api/channels", async (c) => {
	const { name } = parseChannelInput(await jsonBody(c));
	return c.json(await store(c.env).createChannel(c.get("user"), name), 201);
});

app.patch("/api/channels/:id", async (c) => {
	const { name } = parseChannelInput(await jsonBody(c));
	return c.json(await store(c.env).renameChannel(c.get("user"), c.req.param("id"), name));
});

app.delete("/api/channels/:id", async (c) =>
	c.json(await store(c.env).deleteChannel(c.get("user"), c.req.param("id"))),
);

app.post("/api/channels/:id/messages", async (c) => {
	const { text, image } = parseMessageInput(await jsonBody(c));
	return c.json(await store(c.env).postMessage(c.get("user"), c.req.param("id"), text, image), 201);
});

app.patch("/api/messages/:id", async (c) => {
	const { text } = parseMessageEdit(await jsonBody(c));
	return c.json(await store(c.env).editMessage(c.get("user"), c.req.param("id"), text));
});

app.delete("/api/messages/:id", async (c) =>
	c.json(await store(c.env).deleteMessage(c.get("user"), c.req.param("id"))),
);

/** Serves a message image. Ids are random and content never changes, so it may be cached for good. */
app.get("/api/files/:id", async (c) => {
	const file = await store(c.env).getFile(c.req.param("id"));
	if (!file) return c.json({ error: "not found" }, 404);
	return new Response(file.bytes, {
		headers: {
			"Content-Type": file.mime,
			"Content-Length": String(file.bytes.byteLength),
			"Content-Disposition": "inline",
			"Cache-Control": "private, max-age=31536000, immutable",
			"X-Content-Type-Options": "nosniff",
		},
	});
});

// ---------- Voice room ----------

/**
 * ICE servers for the voice call. Cloudflare Realtime TURN credentials are minted here when
 * TURN_KEY_ID / TURN_API_TOKEN are configured; without them the call falls back to STUN alone,
 * which is enough unless one of the two networks blocks direct connections. The relay only ever
 * carries DTLS-SRTP packets, so it cannot listen in either way.
 */
app.get("/api/turn", async (c) => {
	const fallback: { iceServers: IceServer[] } = { iceServers: [{ urls: [...VOICE.fallbackIceServers] }] };
	const secrets = c.env as unknown as Record<string, string | undefined>;
	const keyId = secrets.TURN_KEY_ID;
	const token = secrets.TURN_API_TOKEN;
	if (!keyId || !token) return c.json(fallback);
	try {
		const res = await fetch(
			`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
			{
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ ttl: VOICE.turnCredentialTtlSeconds }),
			},
		);
		if (!res.ok) throw new Error(`TURN credentials request failed: ${res.status}`);
		const payload = (await res.json()) as { iceServers?: IceServer | IceServer[] };
		if (!payload.iceServers) throw new Error("TURN response contained no iceServers");
		const servers = Array.isArray(payload.iceServers) ? payload.iceServers : [payload.iceServers];
		return c.json({ iceServers: servers });
	} catch (err) {
		// A missing relay only costs the fallback path, so log it and let the call try STUN.
		console.error(err);
		return c.json(fallback);
	}
});

// ---------- Music ----------

/** R2 key for a song. Ids are random, so the key never collides and never changes. */
function songKey(id: string): string {
	return `songs/${id}`;
}

/**
 * Uploads a song: the raw file as the body, its title and measured duration as query
 * parameters. The bytes go to R2 first so a failed playlist write cannot leave a song
 * that plays nothing; a failed row leaves an orphan object, which is cleaned up here.
 */
app.post("/api/music", async (c) => {
	const declared = Number(c.req.header("Content-Length") ?? Number.NaN);
	if (Number.isFinite(declared) && declared > MUSIC.maxBytes) {
		throw new ValidationError(`the file is too large (max ${Math.round(MUSIC.maxBytes / (1024 * 1024))} MB)`);
	}
	const song = parseSongUpload(
		await c.req.arrayBuffer(),
		c.req.query("title"),
		c.req.query("duration") ?? undefined,
	);
	const id = crypto.randomUUID();
	const key = songKey(id);
	await c.env.MUSIC.put(key, song.bytes, { httpMetadata: { contentType: song.mime } });
	try {
		const result = await store(c.env).addSong(c.get("user"), {
			id,
			r2Key: key,
			title: song.title,
			mime: song.mime,
			sizeBytes: song.bytes.byteLength,
			durationSeconds: song.durationSeconds,
		});
		return c.json(result, 201);
	} catch (err) {
		await c.env.MUSIC.delete(key);
		throw err;
	}
});

app.patch("/api/music/:id", async (c) => {
	const { title } = parseSongTitle(await jsonBody(c));
	return c.json(await store(c.env).renameSong(c.get("user"), c.req.param("id"), title));
});

app.delete("/api/music/:id", async (c) => {
	const { state, r2Key } = await store(c.env).deleteSong(c.get("user"), c.req.param("id"));
	await c.env.MUSIC.delete(r2Key);
	return c.json(state);
});

app.post("/api/music/reorder", async (c) => {
	const ids = parseSongOrder(await jsonBody(c));
	return c.json(await store(c.env).reorderSongs(c.get("user"), ids));
});

/** Byte offset and length an R2 range resolves to for an object of `size` bytes. */
function resolveRange(range: R2Range, size: number): { offset: number; length: number } {
	if ("suffix" in range) {
		const length = Math.min(range.suffix, size);
		return { offset: size - length, length };
	}
	const offset = range.offset ?? 0;
	const length = range.length ?? size - offset;
	return { offset, length: Math.min(length, size - offset) };
}

/**
 * Streams a song from R2. Range requests are answered with 206 so the browser can seek;
 * `<audio>` will not expose a seek bar without it. Ids are random and the bytes never
 * change, so the response may be cached for good.
 */
app.get("/api/music/:id/file", async (c) => {
	const song = await store(c.env).getSong(c.req.param("id"));
	if (!song) return c.json({ error: "not found" }, 404);
	const wantsRange = c.req.header("Range") !== undefined;
	const object = await c.env.MUSIC.get(song.r2Key, wantsRange ? { range: c.req.raw.headers } : undefined);
	if (!object) return c.json({ error: "not found" }, 404);
	if (!("body" in object) || object.body === null) return c.json({ error: "not found" }, 404);
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("Content-Type", song.mime);
	headers.set("ETag", object.httpEtag);
	headers.set("Accept-Ranges", "bytes");
	headers.set("Cache-Control", "private, max-age=31536000, immutable");
	headers.set("X-Content-Type-Options", "nosniff");
	if (!object.range) {
		headers.set("Content-Length", String(object.size));
		return new Response(object.body, { headers });
	}
	const { offset, length } = resolveRange(object.range, object.size);
	headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
	headers.set("Content-Length", String(length));
	return new Response(object.body, { status: 206, headers });
});

/** Applies a play/pause/seek/next/previous to the playback state both users share. */
app.post("/api/playback", async (c) => {
	const command = parsePlaybackCommand(await jsonBody(c));
	return c.json(await store(c.env).playbackCommand(c.get("user"), command));
});

app.post("/api/restore", async (c) => {
	const data = parseBackupData(await jsonBody(c));
	return c.json(await store(c.env).restore(c.get("user"), data));
});

export default app;
