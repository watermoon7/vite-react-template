# Kanban

A two-person kanban board: boards with **Not started / In progress / Completed** columns, drag-and-drop tasks, search across every board, a calendar of due dates, Discord-style text channels (text, links and images), live sync between users, local backups, a light/dark theme and a choice of two visual styles (“Erect”, the flat one, or “Glassid”, the glass one).

Stack: React + Vite (client), Hono on Cloudflare Workers (API), a SQLite-backed Durable Object (storage + WebSocket push). No external database to provision.

## Configuration

Everything tunable is in [`app.config.ts`](app.config.ts): users (including each user's default style), columns, priorities, themes, styles, session length, login lockout, autosave delay, backup interval/retention, search limits, channel/image limits, calendar week start, and the interface scale steps.

Secrets (never committed):

| Name             | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `SESSION_SECRET` | Signs the session cookie. Any long random string.    |
| `PASSWORD_WILL`  | Will's password (name comes from `USERS` in config). |
| `PASSWORD_THEO`  | Theo's password.                                     |

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # then edit the values
npm run dev                       # http://localhost:5173
```

`.dev.vars` currently contains dev-only credentials (`will` / `will-dev`, `theo` / `theo-dev`).
Sign in with the username `will` or `theo` (case-insensitive; the display name works too).

## Deploy to Cloudflare

```bash
npx wrangler login
npx wrangler secret put SESSION_SECRET   # e.g. openssl rand -base64 48
npx wrangler secret put PASSWORD_WILL
npx wrangler secret put PASSWORD_THEO
npm run deploy
```

The Durable Object and its SQLite storage are created automatically on first deploy (see `migrations` in [`wrangler.json`](wrangler.json)). Local dev state lives in `.wrangler/state` and is separate from production.

## How it works

- **Auth** — `POST /api/login` is a plain HTML form submission (so browsers offer to save the password). On success the server sets an HttpOnly, SameSite=Lax cookie holding an HMAC-signed `{user, expiry}` token; every `/api/*` route and the WebSocket require it. Failed logins are counted per IP; after `AUTH.loginMaxFailures` within `AUTH.loginLockoutMinutes` the IP is locked out for the rest of the window.
- **Data** — one Durable Object (`KanbanStore`, [`src/worker/store.ts`](src/worker/store.ts)) holds boards, tasks, channels and messages in SQLite and exposes typed RPC methods. Every mutation bumps a version counter and pushes each user the full state over WebSocket, so both users always see the same thing. The client applies optimistic updates for drag-and-drop and reconciles with the server's version.
- **Boards** — the left panel lists boards; either user can add, rename (the ✎ that appears on hover, or click the title on the board itself) or delete one. Deleting anything — a board, channel, task or message — asks for confirmation in a small popover beside the button rather than a browser dialog. The board header's **Sort** control orders each column by priority, due date or name (ties keep the manual order); *Manual* is the drag-and-drop order. Dragging still works while sorted — a card dropped in a column takes the position the sort gives it. The choice is saved per browser.
- **Channels** — the left panel lists text channels next to the boards; either user can add, rename (✎ on hover, or click the title) or delete one. A channel is a chronological log shared by both users: text (Enter sends, Shift+Enter for a newline; `http(s)://` URLs become links), and images, attached with the **+** button or by pasting. Images are stored as blobs in the same Durable Object and served from `/api/files/<id>` behind the session cookie, so nothing extra needs provisioning. The server accepts PNG, JPEG, GIF and WebP up to `CHANNELS.imageMaxBytes` (checked by content, not by the declared type); anything larger — or in another format the browser can decode — is scaled down to `CHANNELS.imageMaxDimension` and re-encoded as JPEG in the browser first, so small GIFs keep animating. You can delete your own messages; channels and messages are not part of the local backups.
- **Interface scale** — Settings → Display steps the whole app through the scale levels in `DISPLAY.scaleSteps` (80%–200%), the same effect as the browser's own Ctrl +/−. It is applied as CSS `zoom` on the app root and saved in `localStorage`, so it is a per-browser display preference: it does not change what the other person sees, but it does apply to every tab of the app in that browser. The browser's native Ctrl +/− still works and compounds with it. Drag-and-drop needs two corrections under that zoom, because `@hello-pangea/dnd` measures in viewport pixels but writes CSS lengths: [`dragScale.ts`](src/react-app/dragScale.ts) divides the lifted card's inline styles by the scale, and each column list cancels the zoom on itself (re-applying it to its cards) so the list's scroll metrics — which dnd mixes with those measurements to size the drop zone — are in viewport pixels too.
- **Search** — the sidebar search box filters every task on every board by description and notes (all terms must match). `field:value` tokens filter on a field instead: `priority:high` (or `low`, `medium`, `none`), `due:2026-08-20` / `due:2026-08` / `due:2026` (a date prefix), `due:overdue`, `due:today`, `due:none`, `who:will` (a user's tasks, including those assigned to both) / `who:both`, and `status:completed` (a column id or label, e.g. `status:in_progress`). Values can be abbreviated to a prefix (`priority:h`); a token with an unknown field or value is searched as text. Results are grouped by board; opening one jumps straight to that task, because the open task lives in the URL (`#/b/<boardId>/t/<taskId>`) and so can be linked to and reloaded.
- **Calendar** — the sidebar's Calendar view is a month grid of every task that has a due date, across all boards, straight from the already-loaded state (so it stays in sync as tasks change). Clicking a task opens the same editor panel as on a board, with a link back to the task on its board; the open task lives in the URL (`#/calendar/t/<taskId>`) like it does on boards. The first day of the week is `CALENDAR.weekStartsOn` in [`app.config.ts`](app.config.ts).
- **Theme** — Settings offers Light / System / Dark. *System* is pure CSS (`prefers-color-scheme`), so it repaints when the OS appearance changes; the forced options set `data-theme` on `<html>` and are applied by a small script in `index.html` before first paint so the page never flashes the wrong colours. Stored per browser.
- **Style** — Settings also offers *Erect* (the original flat look; id `classic`) or *Glassid* (translucent, blurred panes over a colour backdrop, set in Inter; id `glass`). The labels live in `STYLES`; the ids are what is stored and what the CSS keys off, so renaming a label never touches saved preferences. Both follow the theme above. Each user starts on the default configured for them in `USERS` and can pick the other; the choice is remembered per user in that browser's `localStorage` (`kanban:style-choices`), and the last applied style is kept under `kanban:style` so the pre-paint script can apply it before the session is known. The sign-in page itself always uses `LOGIN_STYLE` (Glassid), whoever signed out last. The style sets `data-style` on `<html>`, and [`app.css`](src/react-app/app.css) keys off it — see the "Glass style" sections there, including why nothing that contains a draggable card may use `backdrop-filter`.
- **Backups** — the client keeps snapshots of all boards and tasks in `localStorage`: one every `CLIENT.backupIntervalMinutes`, one *before* anything is deleted (the pre-deletion state), and on demand. Settings lets you download any snapshot as JSON, import a JSON file, or **Restore**, which re-creates boards/tasks that no longer exist and never overwrites existing ones. Because snapshots are per-browser, each user's browser is an independent backup — and for the same reason Settings warns when the newest snapshot in this browser has gone stale (Safari discards site storage after roughly a week with no visit).

## Scripts

| Command             | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Vite dev server with the Worker running locally |
| `npm run build`     | Type-check and build client + worker            |
| `npm run lint`      | ESLint                                          |
| `npm run check`     | Build and dry-run deploy                        |
| `npm run deploy`    | Build and deploy to Cloudflare                  |
| `npm run cf-typegen`| Regenerate `worker-configuration.d.ts` after changing `wrangler.json` |

## Browser support

Desktop Chrome/Edge 107+, Firefox 126+ and Safari 16+ — the floor is pinned in [`vite.config.ts`](vite.config.ts). Firefox is held at 126 because the interface-scale setting uses the `zoom` property, which landed there in 126. There is no autoprefixer: the handful of `-webkit-` declarations needed at this floor are written out in [`app.css`](src/react-app/app.css), so dev and production render identically.
