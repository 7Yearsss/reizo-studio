# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Reizo Studio — a local-first desktop agent (Electron Forge + Vite + React 19). Chat with
multi-provider LLMs, a workspace file tree / Git / terminal, installable skills, scheduled
runs, session artifacts (Excalidraw + UniverJS sheets + generated images), and a
node-graph canvas for media generation. Everything runs on the user's machine; state is
local JSON + a SQLite file under Electron `userData/data`.

## Commands

```bash
npm start            # electron-forge start — full app with Vite dev servers (main/preload/renderer)
npm run lint         # eslint --ext .ts,.tsx .
npm run typecheck    # tsc --noEmit
npm run test:unit    # vitest run — all src/**/*.test.ts(x)
npm run test:api     # headless Hono smoke test of src/main/server/** (no Electron, no Chromium)
npm run db:generate  # drizzle-kit generate — regenerate migration SQL after editing schema.ts
npm run make         # electron-forge make — packaged installers
```

Run one unit test: `npx vitest run src/main/server/agent/permissions.test.ts`
or watch a pattern: `npx vitest permissions`.

The API smoke test (`test:api`) is the fast feedback loop for anything under
`src/main/server/**` — it builds the Hono app with an in-memory SQLite db and a temp
`dataRoot`, so it needs no GUI. Use it in headless/CI sandboxes where Chromium can't launch.
For `npm start` in such a sandbox, set `REIZO_DEV_NO_SANDBOX=1` (never in a real build).

There is no test framework config beyond `vitest.config.mts`; tests live next to the code
they cover as `*.test.ts`.

## Architecture

Three Electron surfaces, each with its own Vite build (see `forge.config.ts`):

- **Main** (`src/main/`) — Node process. Owns the BrowserWindow, tray, global shortcut,
  IPC handlers, the SQLite handle, the scheduler host, and it boots the local HTTP server.
- **Preload** (`src/preload/preload.ts`) — the only IPC bridge. Exposes `window.reizo.*`
  (typed in `src/shared/window.d.ts`): window controls, workspace fs/git/shell, skill
  install, PDF export, and `getApiOrigin()`.
- **Renderer** (`src/renderer/`) — React 19 SPA. Talks to the main process for filesystem
  things via `window.reizo`, and to the local HTTP server for everything else.

### The local server is the backend

`src/main/server/` is an in-process **Hono** app served on loopback by `@hono/node-server`.
It binds a *fixed, predictable* port starting at `API_BASE_PORT` (47100) and walking
forward on `EADDRINUSE` — never OS-assigned, because the Origin allowlist and session
state are keyed off a stable origin. The renderer discovers the origin via
`window.reizo.getApiOrigin()`.

`originGuard` (`server/app.ts`) is a DNS-rebinding / cross-origin guard: it rejects any
request whose `Host` isn't `127.0.0.1:<port>` and whose `Origin` isn't the app's own
renderer (the Vite dev origin in dev, `null` for a packaged `file://` load), and it
hand-rolls the CORS/preflight handling — including mutating `c.res.headers` on the raw
streaming `Response` from the chat route, which Hono won't merge `c.header()` into.

Routes (`server/routes/`): `sessions`, `chat`, `settings`, `skills`, `schedules`,
`projects`, `artifacts`, `refs` (large-value blob store), `canvas`. `createApp()` in
`app.ts` wires stores → routers; `listen.ts` owns the port scan; the *test* app
(`test:api`) constructs `createApp()` directly with an in-memory db.

### Turn lifecycle (read `CONTEXT.md` first)

`CONTEXT.md` is the canonical glossary for the agent runtime — **Turn / Continuation /
Interruption / Completion / Resume / Retry / Terminal outcome**. Use those words exactly;
the code and DB columns are named after them.

- `server/agent/runtime.ts` — `runChatTurn()`: builds the system prompt (skills, mentions,
  workspace memory, project rules), constructs the OpenAI-compatible model
  (`agent/provider/openai.ts`), assembles tools, and starts the turn.
- `server/agent/session.ts` — `AgentSession`: one live turn per session, `turnGeneration`,
  abort + idle/stall watchdogs, a monotonic `liveRevision`, a 500-event ring buffer, and
  subscriber fan-out so a dropped client can `resume` from an event cursor instead of
  re-running work. Provider chunks are translated to `AgentEvent`s by
  `agent/translators/openai.ts`.
- The turn can span multiple provider passes in one product turn: `permissions.ts` (a
  tool needs user approval → the turn suspends *between* passes with all provider timers
  cleared, human think-time is never in a step budget) and `continuePass.ts` (an outer
  agent loop so "I'll keep checking" isn't treated as a finished answer).
- Supporting: `budgetTracker.ts`, `toolLoopGuard.ts`, `microCompact.ts` /
  `modelHistory.ts` (history compaction), `messagePersister.ts`, `providerError.ts`.
- Tools: `workspaceTools.ts`, `canvasTools.ts`, `artifactTools.ts`, `imageTools.ts`.

### Persistence

- **SQLite** (`server/db/`) via `drizzle-orm` over a hand-rolled `sqlite-proxy` driver on
  Node's built-in `node:sqlite` (`db/client.ts`). `node:sqlite` is `external` in the main
  Vite build and never bundled. Migrations are **not** run by drizzle — `db:generate` only
  emits SQL into `db/migrations/`, and a small runner in `db/client.ts` applies them at
  startup. Edit `db/schema.ts`, then `npm run db:generate`, then check the runner.
  Schema: `sessions`, `messages`, `canvases`/`canvas_nodes`/`canvas_edges`,
  `artifacts`/`artifact_versions`. Legacy JSON sessions are imported once on boot
  (`importLegacySessions.ts`).
- **JSON files** under `<userData>/data/` for settings, projects, schedules, thoughts, and
  large-value blobs (`server/storage/*Store.ts`). Provider API keys are encrypted with
  Electron `safeStorage`.
- Stores are dependency-injected into `createApp()`; the smoke test swaps in temp/in-memory
  versions.

### Renderer state

No Redux/Zustand. Each store is a plain module in `src/renderer/state/` exposing
`subscribe` / `getSnapshot` + mutation functions (e.g. `chatStore.ts`), with a thin
`useXStore.ts` hook wrapping `useSyncExternalStore`. `src/renderer/api.ts` is the typed
client for the local server, including the NDJSON `LiveEnvelope` stream reader for chat.

**No router.** `react-router-dom` is a dependency but navigation is manual:
`MainLayout.tsx` keeps every open tab mounted (`display:none` when inactive, so drafts /
scroll / in-flight streams survive tab switches) and switches the main stage on
`uiStore.mode` (`chat` / `projects` / `settings` / `automation` / `skills` / `artifacts`).
Tabs are Chrome-style in the custom title bar (`tabStore.ts`) and restore on restart.

### Canvas

Session-scoped node graph for image/video/audio generation. Wire types live in
`src/shared/canvas*.ts`; server execution in `server/canvas/` (`graph.ts`,
`graphExecutor.ts`, `agentExecutor.ts`, `imageExecutor.ts`, `videoExecutor.ts`,
`videoDrivers/`, import/export workflows). Renderer uses `@xyflow/react` with node
components under `src/renderer/components/canvas/`. Node/edge mutations bump the canvas
`live_revision` in the same statement so a reconnecting client resumes from the gap.

### Shared code

`src/shared/` is imported by all three surfaces — DTOs, the `IPC` channel-name enum and
`API_BASE_PORT` (`constants.ts`), provider presets (`providers.ts`), stream/event
encodings, and a large set of pure helpers that each have a co-located `*.test.ts`. Prefer
adding logic here (with a unit test) over embedding it in a route or component.

## Conventions

- Path alias `@/*` → `src/*` (tsconfig, all vite configs, vitest).
- Renderer imports use the `@/renderer/...` aliases from `components.json`; shadcn is
  "new-york" style, `src/renderer/components/ui/`, Tailwind v4 (CSS-first, no config file —
  `src/renderer/index.css`), Lucide icons, `motion` for animation.
- Renderer dev server is pinned to `127.0.0.1:46173` (not 5173) — see the comment in
  `vite.renderer.config.mts` for the Windows/Hyper-V port reasoning; don't change it
  casually.
- Providers are OpenAI-compatible only (`@ai-sdk/openai` + `ai`). Add one to
  `PROVIDER_PRESETS` in `src/shared/providers.ts`. The default provider is "Reizo
  (Winlume)", same backend as the web Studio; keys are pasted by the user, never committed.
- Skills are Markdown files with `name`/`description` frontmatter, loaded from
  `./skills` (bundled) and `<userData>/data/skills` (user-installed) — `src/main/skills.ts`.
- `.claude/`, `.agents/`, and `skills-lock.json` are git-ignored per-developer skill
  tooling; `.agents/skills/` (beui, diffs, shadcn, frontend-design) are references for
  building UI, not part of the app.
- `docs/*.md` are long-form design/planning docs for canvas, artifacts, and vendored
  "borrowings" — background, not current-state specs.
