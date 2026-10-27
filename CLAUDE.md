# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Reizo Studio — a local-first, general-purpose **creation workbench** (Electron Forge + Vite +
React 19). One workspace for conversation, an Agent that does real work, an open node canvas,
installable skills, automation and a code workspace. Everything runs on the user's machine;
state is local JSON + a SQLite file under Electron `userData/data`.

What it covers today:

- **Agent chat** with OpenAI-compatible providers; workspace file tree / Git / terminal;
  tool approval; sub-agents; MCP servers and plugins; user hooks; memory.
- **Open canvas** — session-scoped node graph for image / video / audio generation, storyboard,
  presentation export, a reusable media asset library.
- **Office workspaces** peer to the canvas — Excel (UniverJS), Doc (rich text, DOCX), HTML,
  PPT (Presenton) — each with agent read / selection-reference / suggest-and-review editing and
  version history.
- **Video editor** (embedded OpenChatCut runtime) fed from canvas / library assets.
- **Skills** (bundled + user) with optional delivery contracts; **scheduled runs**; **computer use**
  (real mouse / keyboard / screen); local **voice input**; account wallet and usage ledger.

Product direction (see `docs/product-direction-research.md`): the platform stays generic;
e-commerce content batch production (cover image, listing, social pack skills) is the **priority
validation scenario**, not the product boundary. Keep platform layers free of SKU / channel fields;
vertical rules live in skills and delivery plans.

## Principles that decide trade-offs

- **Solve the real user pain.** State the user's intent in one sentence before building and check
  the design serves it. No cheap substitutions (mirror layers, auto-splitting) for features whose
  value *is* the behavior. If the real solution is bigger, say so and size it honestly.
- **Local-first, honestly.** Data is stored locally; generation and chat requests go to the
  providers the user configured. Never describe it as "nothing leaves your machine". Keys are
  pasted by the user, encrypted with Electron `safeStorage`, never committed, never logged
  (`shared/redactSecrets.ts`).
- **Agent actions on the user's machine need consent.** `permissions.ts` gates writes / shell /
  MCP tools by `permissionMode` (`ask` | `workspace` | `full`); `computer` is always gated on first
  use even in `full`. Don't add a tool that can write, run, or reach the network without going
  through this.
- **Media and documents are stateful.** Jobs are persisted and recoverable; versions are explicit
  (`expectedVersion` on edits); pinned references freeze at job acceptance. Don't introduce
  in-memory-only task identity.
- **Prefer shared pure logic.** Put rules in `src/shared/` with a co-located test before embedding
  them in a route or component.

## Commands

```bash
npm start            # electron-forge start — full app with Vite dev servers (main/preload/renderer)
npm run lint         # eslint --ext .ts,.tsx .
npm run typecheck    # tsc --noEmit
npm run test:unit    # vitest run — all src/**/*.test.ts(x)
npm run test:api     # headless Hono smoke test of src/main/server/** (no Electron, no Chromium)
npm run db:generate  # drizzle-kit generate — regenerate migration SQL after editing schema.ts
npm run make         # electron-forge make — packaged installers
npm run setup:video-editor / check:video-editor / build:video-editor   # pinned OpenChatCut runtime
npm run check:artifact-preview
```

Run one unit test: `npx vitest run src/main/server/agent/permissions.test.ts`
or watch a pattern: `npx vitest permissions`.

The API smoke test (`test:api`) is the fast feedback loop for anything under
`src/main/server/**` — it builds the Hono app with an in-memory SQLite db and a temp
`dataRoot`, so it needs no GUI. Use it in headless/CI sandboxes where Chromium can't launch.
For `npm start` in such a sandbox, set `REIZO_DEV_NO_SANDBOX=1` (never in a real build).

There is no test framework config beyond `vitest.config.mts`; tests live next to the code
they cover as `*.test.ts`. Before calling a change done: `typecheck`, `lint`, `test:unit`, and
`test:api` when `src/main/server/**` changed. Say plainly what you could not verify (e.g. real
Electron GUI click-through in a headless environment).

## Where to look (read before touching)

| Area | Code | Read first |
| --- | --- | --- |
| Turn lifecycle, resume, retry | `server/agent/runtime.ts`, `session.ts`, `permissions.ts`, `continuePass.ts` | `CONTEXT.md` |
| Canvas, media jobs, assets | `server/canvas/`, `shared/canvas*.ts`, `renderer/components/canvas/` | `docs/canvas-plan.md`, `docs/architecture-improvement-plan.md`, `docs/canvas-storage-maintenance.md` |
| Artifacts (sheet / doc / HTML / PPT) | `server/storage/artifactStore.ts`, `agent/{document,presentation,sheet}*`, `routes/{artifacts,documents,presentations}.ts` | `docs/artifact-plan.md`, `docs/office-workspaces-implementation.md` |
| Video editor | `server/videoEditor/`, `agent/videoEditorTools.ts` | `docs/openchatcut-integration.md`, `docs/video-editor-acceptance.md` |
| Computer use | `src/main/computerUse/`, `agent/computerTools.ts`, `shared/computerUse.ts` | `docs/computer-use-integration.md` |
| Providers, models, usage, wallet | `shared/providers.ts`, `modelCatalog.ts`, `server/providerResolver.ts`, `routes/usage.ts`, `src/main/account/` | `docs/provider-model-usage.md`, `docs/account-wallet.md`, `docs/account-login.md` |
| Skills, plugins, MCP | `src/main/skills.ts`, `skillHub.ts`, `server/plugins/`, `server/mcp-builtin/`, `agent/mcpTools.ts` | `docs/handoff-plugins.md` |
| Memory & Harness evolution | `src/main/memoryJobs.ts`, `workspaceMemoryDir.ts`, `agent/harness*.ts`, `skillRefiner.ts`, `turnTrace.ts` | comments at the top of each file |
| Voice input | `server/voice/`, renderer `VoiceInputButton` + recognition worker | `docs/voice-input.md` |
| Security guards (permissions, MCP pinning, remote fetch, secrets) | — | `docs/security-adversarial.md` — every row bound to a test; add a row with any new attack surface |
| Incident notes | — | `docs/operations/` (dated postmortems for chat / video / model-catalog failures) |

`docs/*.md` are long-form design, planning and research notes; many describe batches of work.
Treat them as background, and confirm current behavior in code before relying on them.

## Architecture

Three Electron surfaces, each with its own Vite build (see `forge.config.ts`):

- **Main** (`src/main/`) — Node process. Owns the BrowserWindow, tray, global shortcut,
  IPC handlers (`workspaceIpc`, `skillsIpc`, `pluginsIpc`, `windowIpc`, account IPC), the SQLite
  handle, the scheduler host (incl. `folderTriggers.ts`: automations that run when files land in a workspace folder), memory jobs, the computer-use driver, and it boots the local HTTP
  server.
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

Routes (`server/routes/`): `sessions`, `chat`, `settings`, `skills`, `schedules`, `projects`,
`artifacts`, `documents`, `presentations`, `canvas`, `canvasMaintenance`, `videoEditor`,
`voice`, `computerUse`, `storage` (free disk space), `network` (proxy), `translations` (message translation), `diagnostics` (redacted support bundle), `updates` (three-state update check against a feed), `knowledge` (local document search), `toolApprovals` (persisted always-allow MCP tools), `memory`, `harness`, `usage`, `matting`, `workspacePreview`,
`refs` (large-value blob store), `publicProviders`, `adminProviders`. `createApp()` in
`app.ts` wires stores → routers; `listen.ts` owns the port scan; the *test* app
(`test:api`) constructs `createApp()` directly with an in-memory db. When you add a route,
update this list.

### Turn lifecycle (read `CONTEXT.md` first)

`CONTEXT.md` is the canonical glossary for the agent runtime — **Turn / Continuation /
Interruption / Completion / Resume / Retry / Terminal outcome**. Use those words exactly;
the code and DB columns are named after them.

- `server/agent/runtime.ts` — `runChatTurn()`: builds the system prompt (skills, mentions,
  workspace memory, project rules, document / presentation / sheet reference context),
  constructs the OpenAI-compatible model (`agent/provider/openai.ts`), assembles tools, and
  starts the turn.
- `server/agent/session.ts` — `AgentSession`: one live turn per session, `turnGeneration`,
  abort + idle/stall watchdogs, a monotonic `liveRevision`, a 500-event ring buffer, and
  subscriber fan-out so a dropped client can `resume` from an event cursor instead of
  re-running work. Provider chunks are translated to `AgentEvent`s by
  `agent/translators/openai.ts`.
- The turn can span multiple provider passes in one product turn: `permissions.ts` (a
  tool needs user approval → the turn suspends *between* passes with all provider timers
  cleared, human think-time is never in a step budget) and `continuePass.ts` (an outer
  agent loop so "I'll keep checking" isn't treated as a finished answer).
- Supporting: `budgetTracker.ts` (a count of executions, **not** money), `toolLoopGuard.ts`,
  `microCompact.ts` / `modelHistory.ts` (history compaction), `messagePersister.ts`,
  `providerError.ts`, `steerInbox.ts` (mid-turn user steering), `jobWatch.ts`, `readBudget.ts`.

### Tools

Assembled per turn in `runtime.ts` (each gated by what the session has: stores, `dataRoot`, settings):

| File | Tools for |
| --- | --- |
| `workspaceTools.ts`, `fileTools.ts` | read / write / edit files, grep, `run_command` |
| `canvasTools.ts`, `imageTools.ts`, `videoTools.ts` | canvas structure, image / video / audio generation |
| `artifactTools.ts` (incl. `read_sheet` / `generate_sheet`), `documentTools.ts`, `presentationTools.ts` | artifact CRUD and reviewed edits |
| `videoEditorTools.ts`, `videoSpeechTools.ts` | the embedded video editor |
| `computerTools.ts` | real-desktop control (setting `computerUse`, default off) |
| `scheduleTools.ts`, `subagentTools.ts`, `mcpTools.ts`, `deliveryTools.ts` | schedules, read-only sub-agents (`sub_agents/` roles), MCP / plugin servers, skill delivery contracts |

User hooks (`agent/hooks.ts`) read `<dataRoot>/hooks.json` only — never from a workspace file —
and run `PreToolUse` / `PostToolUse` commands. Wrap new tools with the hook runner like the rest.

### Memory and Harness evolution

`memoryJobs.ts` extracts workspace memories after a turn and recalls them before one (best-effort,
never user-visible on failure). `harnessEvolution.ts` / `harnessProposer.ts` read per-turn traces
(`<dataRoot>/traces/*.jsonl`, written by `turnTrace.ts`), propose recurring-failure lessons, and
append a *user-confirmed* lesson to the hot-reloaded `harness/systemprompt.md`. Proposals are
recomputed server-side so a client can only pick an id, never inject prompt text. `skillRefiner.ts`
maintains a skill's `EXPERIENCE.md`.

### Persistence

- **SQLite** (`server/db/`) via `drizzle-orm` over a hand-rolled `sqlite-proxy` driver on
  Node's built-in `node:sqlite` (`db/client.ts`). `node:sqlite` is `external` in the main
  Vite build and never bundled. Migrations are **not** run by drizzle — `db:generate` only
  emits SQL into `db/migrations/`, and a small runner (`db/migrations.ts`) applies them at
  startup. Edit `db/schema.ts`, then `npm run db:generate`, then check the runner. Never edit a
  migration that has shipped.
  Schema: `sessions`, `messages`, `canvases` / `canvas_nodes` / `canvas_edges`,
  `canvas_commits` / `canvas_command_receipts`, `canvas_jobs`, `canvas_assets`,
  `artifacts` / `artifact_versions` / `artifact_reviews`, `delivery_plans` / `delivery_exports`,
  `usage_pricing` / `usage_executions` / `usage_reports` / `usage_bills`. Legacy JSON sessions are
  imported once on boot (`importLegacySessions.ts`).
- **JSON files** under `<userData>/data/` for settings, projects, schedules, thoughts, and
  large-value blobs (`server/storage/*Store.ts`); write them with the atomic helper
  (`storage/atomicFile.ts`). Provider API keys are encrypted with Electron `safeStorage`.
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
Layout: navigation far left, conversation in the main area, canvas / office workspaces / tools in
the resizable right panel — keep that layout unless the user asks for a redesign.

### Canvas

Session-scoped node graph for image/video/audio generation. Wire types live in
`src/shared/canvas*.ts`; server execution in `server/canvas/` (`application.ts` is the single
entry for node / edge commands — HTTP routes and agent tools share its validation,
transaction and broadcast; `graph.ts`, `graphExecutor.ts`, `agentExecutor.ts`, `nodeJobs.ts`,
`generationScheduler.ts`, `imageExecutor.ts`, `videoExecutor.ts`, `audioExecutor.ts`,
`videoDrivers/`, `audioDrivers/`, `recoverJobs.ts`, import/export workflows). Renderer uses
`@xyflow/react` with node components under `src/renderer/components/canvas/`.
Node/edge mutations bump the canvas `live_revision` in the same statement and append a
`canvas_commit`, so a reconnecting client replays the gap (recent 1000 revisions) or refetches
the authoritative snapshot. Job identity is validated before a result may write back; cancelling
or re-running revokes the old job's write eligibility. Assets have stable ids, content checks
and provenance, independent of the source canvas / node / job lifetime.

### Shared code

`src/shared/` is imported by all three surfaces — DTOs, the `IPC` channel-name enum and
`API_BASE_PORT` (`constants.ts`), provider presets (`providers.ts`), stream/event
encodings, and a large set of pure helpers that each have a co-located `*.test.ts`. Prefer
adding logic here (with a unit test) over embedding it in a route or component.

## Conventions

- UI copy stays minimal — no explanatory text; let components and motion explain. See `AGENTS.md`.
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
  A `prompt` frontmatter field prefills the composer when the skill is picked, and a
  `## 提问` body section declares inputs the agent must collect via `ask_user`
  question cards before executing (see `skills/cover-image/`). Files under
  `<skill>/assets/` are served at `/api/skills/:id/assets/:file` and can be
  referenced from direction cards as `skill-asset:<id>/<file>` (`imageUrl`). A skill body is
  capped at 500 lines; an optional `contract` makes the skill produce a delivery plan
  (`deliveryTools.ts`); `EXPERIENCE.md` is written by the Harness refiner, not by hand.
- Usage numbers: keep recorded bills, price-based estimates and unpriced calls distinct; a missing
  price or usage report is not a zero charge; never add different currencies (`CONTEXT.md`).
- Plugins (`server/plugins/`) can bring skills and MCP servers; MCP tools from third parties ask
  for approval unless the user chose `full`.
- `.claude/`, `.agents/`, and `skills-lock.json` are git-ignored per-developer skill
  tooling; `.agents/skills/` (beui, diffs, shadcn, frontend-design) are references for
  building UI, not part of the app.

## Keeping this file current

Update this file in the same change when you add or rename a route, an agent tool file, a
database table, a top-level `src/main` module, or a doc that people should read first. Prefer
pointing to a directory over listing every file, and put long explanations in `docs/` with a link
here. If something here no longer matches the code, fix the file rather than working around it.
