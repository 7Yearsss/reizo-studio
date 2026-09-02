# Canvas + Agent — design decisions & feasibility

Status: **C + P1 + P1.5 + P2-UX shipped to `main`** (2026-09-02). Target: an
infinite node canvas (React Flow) in the right-side panel where an agent and the
user co-edit a graph. §1–§5 are the original decision record from a grilling
session plus an Opus 5 feasibility review; **§6 is the live implementation status
and what is left** — read it first if you just want to know where things stand.

---

## 1. Product shape (the 17 decisions)

| # | Area | Decision |
|---|---|---|
| 1 | Positioning | Chat-first, canvas on-demand. Default experience is plain chat; the canvas only appears when the work calls for it. |
| 2 | Entry | The agent auto-opens the canvas panel when it produces media / builds a pipeline. The user can also open it manually. No "pick a mode" at session creation. |
| 3 | Surface | Right-side panel, Claude-Code-desktop style: a view switcher (Canvas alongside Artifacts / Files), ~50% width, draggable divider, header controls for pop-out-to-separate-window / maximize / close, chat side collapsible. |
| 4 | Data model | New entities `canvasNode` + `canvasEdge` (own tables + own renderer store), separate from artifacts. Artifacts unchanged. A node **may** reference an artifact id for its content payload. |
| 5 | Scope | Canvas is session-scoped (`sessionId`), persists with the session. "Promote to project-level / standalone document" deferred. |
| 6 | Library | React Flow (`@xyflow/react`), MIT. **Not** litegraph (canvas-drawn, imperative, fights React, and its executor lives in Python anyway). |
| 7 | v1 node types | **Only** "Image (generate)" and "Agent Task". Dropping a file on the canvas creates an image node holding it (that is the import path). Nodes have inline prompt / params + inline output display. "Export" is a per-node action. Video / audio / upscale / style-transfer deferred. |
| 8 | Execution timing | Manual run ("run graph" / "run from here"). Dirty tracking exists (stale badge) but does not auto-trigger. Paid generation runs get a spend confirmation. |
| 9 | Agent sees canvas | A compact summary auto-injected into the turn (selected nodes + a list of all nodes: id / type / title / run-state), plus `read_node(id)` and `read_canvas()` tools for detail. No full-graph dump. |
| 10 | Agent writes canvas | Fine-grained primitive tools — `add_node`, `connect`, `update_node`, `delete_node`, `run_node` — each streaming into chat as a tool card. Structure edits do **not** prompt for permission (treated like `todo_write`). `run_node` on a paid image node shows a spend confirm. |
| 11 | "Agent Task" node | Its `run()` kicks a **full sub-agent turn** with an isolated context (does not see main chat history), a restricted **read-only** toolset (web search + `read_node` + `read_canvas`; not file-write, not canvas-write). Output streams into the node live. |
| 12 | Node → agent | Right-click node quick actions (compose + send a message with the node + upstream as context) + drag a node onto the chat composer to make it a reference chip (reuse the existing `mentions` plumbing). No per-node side-threads. |
| 13 | State authority + undo | Server-authoritative + renderer subscribes, reusing Reizo's live-stream **pattern**. User drag = optimistic move + PATCH + revision broadcast reconcile. v1 undo = renderer-side undo stack replaying inverse ops through the same API. |
| 14 | Image provider | OpenAI-compatible images API (`POST {baseUrl}/images/generations`), reusing the already-configured OpenAI provider key; img2img / "reproduce" via `/images/edits`. fal / Replicate later. |
| 15 | Executor location | In the Hono server (main process), alongside the agent runtime. `POST /api/canvas/run` triggers topological execution; per-node run-state streams back via the live channel. Must survive window reload / close. Reads the authoritative graph from SQLite. |
| 16 | First slice (C) | Right-panel canvas + Image node + manual **single-node** run (real generation) + 2 agent tools (`add_node`, `run_node`) + selection auto-inject. No Agent Task node, no general DAG executor, no undo. Then P1 general topological executor + dirty badges + "run from here"; P2 Agent Task node; P3 undo/redo + drag-to-mention + right-click actions; P4 video / audio. |
| 17 | Go / no-go after C | Task-completion bar: 3 predefined tasks; agent+canvas must clearly beat plain chat on ≥2 (speed / output quality / "could iterate where I couldn't before"). |

---

## 2. Feasibility review (Opus 5, against the codebase)

### Overall verdict

Buildable, **~2.5–4 weeks for one engineer**, with one real architecture fight
and several plumbing surprises.

- **Good surprise:** `ai@7.0.79` exports `generateImage` as a *stable*
  (non-`experimental_`) symbol, and `@ai-sdk/openai@4.0.47` exposes
  `.image()` / `.imageModel()` → `ImageModelV4` that POSTs to
  `${baseURL}/images/generations`
  (`node_modules/@ai-sdk/openai/dist/index.js:2387`) **and** `/images/edits`
  (`:2307`). `GenerateImagePrompt` (`ai/dist/index.d.ts:7115`) already accepts
  `{ images, text, mask }`, so img2img needs no raw `fetch`. **Decision 14 is
  effectively free.**
- **Bad surprise 1:** Decision 13's "reuse the existing
  `liveRevision` / `LiveEnvelope` machinery" is a reuse of a *pattern*, not of
  code. `AgentSession` is welded to the turn lifecycle — `start()` wipes the
  ring buffer (`session.ts:191`), the fan-out closes every subscriber on the
  first `done` (`:637-640`), `liveRevision` is persisted only in the turn's
  `finally` (`:549`), and the module-global `sessions` Map (`:677`) is keyed by
  bare `sessionId`, so a canvas channel sharing that key would collide with
  chat. Budget **1–2 days** to fork ~120 lines into a `CanvasChannel`.
- **Bad surprise 2:** `artifactStore` is JSON-file-backed, not SQLite
  (`storage/artifactStore.ts:14-37`) and truncates content at 200 000 chars
  (`:12`). A 1024×1024 PNG as base64 is ~1.4 MB and would be silently cut in
  half. **Decision 4 / 7's "generated image → artifact row" does not work
  as-is.**

### Integration points

| # | Verdict | Seam | Note |
|---|---|---|---|
| A — reuse `LiveEnvelope` for a separate canvas channel | **YELLOW** | `agent/session.ts` `AgentSession.broadcast` / `streamResponse` / `resume` (`:156-178`, `:588-674`) | Machinery is sound but turn-coupled: ring reset on `start()`, subscribers closed on `done`, rev persisted only at turn end. Fork it as `CanvasChannel`; do not generalize `AgentSession`. |
| B — Agent Task node as a headless isolated sub-turn | **YELLOW** | `agent/runtime.ts` `runChatTurn` (`:42-305`); precedent `main/schedulerHost.ts:24-35` | Headless is proven by the scheduler, but the toolset is hardcoded (`runtime.ts:198-217`) and history / persistence assume a real `sessionStore` session. Needs a `runAgentPass()` extraction. |
| C — server-side image generation | **GREEN** | `agent/provider/openai.ts` `createOpenAiModel`; `runtime.ts:78-98` (key / baseUrl resolution) | `generateImage` + `openai.image()` both present; edits via `prompt.images`. Needs `settingsStore` reachable from the new route (it already reaches `createApp`, `app.ts:117`). |
| D — the right panel | **YELLOW** (pop-out ≈ RED) | `RightPanel.tsx` (whole file), `MainLayout.tsx:72-74`, `uiStore.ts`, `window.ts:15-83` | Adding a Canvas tab: trivial. Panel width is hard-coded `w-[280px]` (`RightPanel.tsx:28`); **no draggable divider exists anywhere in the renderer.** Pop-out needs a new non-singleton `BrowserWindow` factory; `window.ts` is a singleton and `react-router-dom` is a dependency but unused, so there is no route to hang a second window on. |
| E — add `@xyflow/react` to Vite renderer | **GREEN** | `vite.renderer.config.mts`, `index.css:1-4` | React 19 / Tailwind v4 / radix / motion all fine. Gotcha: React Flow ships a real CSS file — must be `@import`ed after the Tailwind import. |
| F — `artifactStore` mutability | **RED (as specified)** | `storage/artifactStore.ts:12,86-108`; `runtime.ts:205-215` | Create-only (no `update`), JSON-file, 200 KB char cap, `content: string`. Cannot hold a generated PNG. |
| G — new Hono resource (canvas) | **YELLOW** | `db/schema.ts`, `db/migrations.ts:13-58`, `db/client.ts:25-52`, `routes/schedules.ts`, `app.ts:115-142` | Migration runner is clean and append-only. Friction: **`DbHandle` never reaches `createApp`** — it is opened in `main/index.ts:59` and only a built `sessionStore` is passed through `listen.ts`. New plumbing required. |
| H — permission reuse for `run_node` spend confirm | **YELLOW** | `agent/permissions.ts:97-107,164-180`; `session.ts:307,547` | `requestPermission` is a plain function, but the *sink* is registered / cleared by the turn. A canvas-only confirm with no live chat turn has nowhere to emit and no waiter-resolution path. |
| I — concurrency (optimistic drag + agent write + executor) | **YELLOW** | `session.ts:112,147-154,549`; `chatStore.ts` event folder + `liveRevisionFence` | Envelope / ring resume genuinely covers reload-mid-run — *if* the canvas gets its own persisted revision counter. Drag + agent write + executor need last-writer-wins **per node field**, not a global lock. |

### Three sharpest risks

**R1 — "reuse the `LiveEnvelope` machinery" is not reuse, and the key collides.**
`session.ts:677` `const sessions = new Map<string, AgentSession>()` is keyed by
`sessionId`; `getAgentSession(sessionId)` returns the *same* object chat uses.
`start()` does `this.ring = []` (`:191`) and resets `this.epoch` (`:190`) every
turn. `streamResponse`'s subscriber unsubscribes + closes on
`envelope.event.type === 'done'` (`:637-640`). `rt.setLiveRevision` only runs in
the turn's `finally` (`:549`). Client-side, `api.ts readEnvelopeStream` **throws
`ChatStreamIncompleteError` if the body ends without a `done`** (`api.ts:63`),
and `ChatStreamEvent` is a closed union (`shared/stream.ts:46-55`) with no
canvas variants.
*Mitigation:* write `src/main/server/canvas/channel.ts` — a new class with its
own `Map<canvasId, CanvasChannel>`, a `CanvasEvent` union in
`src/shared/canvasStream.ts`, its own envelope type
(`v:1, canvasId, rev, epoch, event`), a ring buffer that is **never cleared**
(only capped), a `rev` persisted **on every write** into a
`canvases.live_revision` column, and a long-lived NDJSON
`GET /api/canvas/:id/stream?after=N` that never emits `done`. Copy
`streamResponse`'s replay+subscribe logic verbatim; do not import it. Add a
`readCanvasStream` in `renderer/api.ts` that tolerates EOF without `done` and
auto-reconnects with `after=lastRev`.

**R2 — the artifact store cannot hold an image.**
`artifactStore.ts:12` `MAX_CONTENT_CHARS = 200_000`, `:104`
`content: input.content.slice(0, MAX_CONTENT_CHARS)`, one JSON file per
artifact, no `update`. `runtime.ts:205-215` only ever calls `create` with text
file contents. `ArtifactPreview.tsx:81` renders `<img src={content}>` — expects
a data URL, which for any real generated image blows the cap.
*Mitigation:* **do not route generated images through `artifactStore` in slice
C.** Write PNG bytes to `<dataRoot>/canvas/<canvasId>/<nodeId>-<n>.png`, store
the relative path on the `canvas_nodes` row, and serve it via a new
`GET /api/canvas/assets/:canvasId/:file` (the origin guard in `app.ts:64-113`
already covers it; the renderer fetches from `http://127.0.0.1:<port>` so
`<img src>` works). Defer "node references an artifact id" (decision 4) until
`artifactStore` grows a blob path — or reverse the arrow: a "save to artifacts"
action that copies the file.

**R3 — permission / spend-confirm has no delivery channel outside a live chat
turn.** `session.ts:307` `setPermissionSink(sessionId, emit)` and `:547`
`clearPermissionSink(sessionId)` in the `finally`; `permissions.ts:128-148`
`emitNextInteraction` does `const sink = sinks.get(sessionId); if (!sink)
return;` — the interaction is recorded and then silently invisible.
`waitForInteractions` (`:247`) would hang forever with only the turn's
`AbortSignal` as an escape hatch, and a canvas run has no turn. Also
`clearPermissionSink` **deletes the whole `pending` list for the session**
(`:104`), so a chat turn ending mid-canvas-confirm would drop the canvas's
pending item.
*Mitigation:* for slice C, do **not** reuse `permissions.ts`. Make the spend
confirm renderer-local and pre-flight: the run button opens a confirm dialog,
and `POST /api/canvas/nodes/:id/run` accepts `{ confirmedSpend: true }`; the
server rejects a paid run without it. Revisit when the Agent Task node lands,
and at that point generalize `sinks` from `Map<sessionId, sink>` to
`Map<scopeId, sink>` where `scopeId` is `chat:<id>` or `canvas:<id>`, and make
`clearPermissionSink` scope-selective.

---

## 3. Revised task list — slice C

### Backend

1. `src/shared/canvas.ts` — `CanvasNode` / `CanvasEdge` / `NodeRunState` DTOs.
   `src/shared/canvasStream.ts` — `CanvasEvent` union
   (`node_added | node_updated | node_deleted | edge_added | edge_deleted | run_state | node_output`)
   + `CanvasEnvelope`.
2. `db/schema.ts` + `db/migrations.ts` — append `0002_canvas`:
   `canvases(id, session_id, live_revision, created_at, updated_at)`,
   `canvas_nodes(id, canvas_id, type, x, y, w, h, title, params_json, params_hash, run_state, output_json, updated_at)`,
   `canvas_edges(id, canvas_id, source_id, source_handle, target_id, target_handle)`;
   index on `canvas_id`; `canvases.session_id REFERENCES sessions(id) ON DELETE CASCADE`.
   Mirror into `db/migrations/0002_canvas.sql` (the file comment at
   `migrations.ts:1-7` requires it). Include `params_hash` now even though C
   does not use dirty tracking (schema-seed convention, `db/schema.ts:8-13`).
3. **Plumb `DbHandle` into the server.** `main/index.ts:59` →
   `startLocalServer({ db: dbHandle })` → `listen.ts` `startLocalServer`
   options → `app.ts` `CreateAppOptions`. Today only a constructed
   `sessionStore` crosses that boundary.
4. `server/storage/canvasStore.ts` — drizzle CRUD, each mutation returning the
   new `rev` (bump `canvases.live_revision` in the same statement). Shape after
   `scheduleStore.ts`; `raw.prepare` style after `sqliteSessionStore.ts`.
5. `server/canvas/channel.ts` — the forked `CanvasChannel` (R1). Own `Map`, own
   ring (never cleared), no `done`, heartbeat every 15 s (copy `armHeartbeat`,
   `session.ts:278-286`).
6. `server/canvas/imageExecutor.ts` — resolve `settings.providers[providerId]`
   exactly as `runtime.ts:78-98`;
   `createOpenAI({ apiKey, baseURL, fetch: loggedFetch }).image(modelId)` then
   `generateImage({ model, prompt, size })`. **Refactor `provider/openai.ts` to
   also export a `createOpenAiProvider()`** — today it only returns a language
   model. Write PNG to disk (R2), update the node row, broadcast `run_state` +
   `node_output`.
7. `server/routes/canvas.ts` — `GET /:sessionId`, `POST /:canvasId/nodes`,
   `PATCH /nodes/:id`, `DELETE /nodes/:id`, `POST /:canvasId/edges`,
   `POST /nodes/:id/run` (accepts `{ confirmedSpend }`),
   `GET /:canvasId/stream?after=N`, `GET /assets/:canvasId/:file`. Mount in
   `app.ts` next to `/api/artifacts` (`app.ts:133`).
8. `agent/canvasTools.ts` — `add_node` + `run_node`,
   `tool({ description, inputSchema: z.object(...), execute })` exactly like
   `todo_write` (`workspaceTools.ts:320-336`), **no `approve()` call**
   (decision 10 matches the code). Merge into `runtime.ts`'s `tools` object —
   note the current toolset is conditional on `workspacePath`
   (`runtime.ts:198`); canvas tools must be available **without** a workspace.
9. `runtime.ts` — inject the compact canvas summary into `systemParts`
   (`:165-172`) when the session has a canvas with nodes. Guard length. (See
   trap D9 below — this freezes at turn start.)

### Renderer

10. `npm i @xyflow/react`; `@import '@xyflow/react/dist/style.css';` at the top
    of `index.css` (after the Tailwind import).
11. `state/canvasStore.ts` — same hand-rolled `setState` / `listeners` /
    `getSnapshot` shape as `chatStore.ts`; consumes the canvas stream via a new
    `api.readCanvasStream`, applies envelopes by `rev`, reconciles optimistic
    drags per field.
12. `components/canvas/CanvasPanel.tsx` + `ImageNode.tsx` (inline prompt
    textarea, size select, Run button, `<img>` output, run-state badge).
13. `RightPanel.tsx` — add `'canvas'` to `PanelTab`; **replace `w-[280px]` with
    a resizable width** (new `useUiStore` `rightPanelWidth` + a
    `pointerdown` / `pointermove` divider). Net-new UI, not a tweak.
14. `uiStore.ts` — add `canvasOpen` + `rightPanelWidth` (localStorage-persisted
    like `artifactsOpen`, `uiStore.ts:31,68-74`); `ChatPage.tsx:158` gets a
    sibling toggle.
15. Auto-open (decision 2): in `chatStore` event folder `case 'tool'`
    (`chatStore.ts:587`), when `event.name === 'add_node'`, call
    `uiStore.setCanvasOpen(true)`.

### Decisions to change for slice C

- **D4 / D7** — drop the artifact linkage for C (R2). Generated image = file on
  disk + node row.
- **D13** — "reusing Reizo's existing machinery" → *reimplementing the same
  pattern in a parallel channel.* Budget 1–2 days for `CanvasChannel`.
- **D3** — draggable divider, ~50% width, maximize, pop-out are all new
  construction. **Cut pop-out from C** (needs a second `BrowserWindow` factory,
  a `?window=canvas` load URL, and a renderer branch in `App.tsx`).
- **D10** — spend confirmation on `run_node`: renderer-local pre-flight, not
  `permissions.ts` (R3).

---

## 4. Latent traps

- **D15 "must survive window reload / close" — the scheduler proves the
  opposite half.** `schedulerHost.ts:15` constructs
  `createFileSessionStore(dataRoot)` while the app runs on SQLite
  (`main/index.ts:63`). Scheduled turns write to a *different* store than the UI
  reads. Do not copy that pattern for the canvas executor; use the injected
  `canvasStore`. (Pre-existing bug — separate ticket.)
- **D11 "isolated context, restricted read-only toolset"** — `runChatTurn`
  persists a user `ChatMessage` before dispatching (`runtime.ts:131`), renames
  the session from the prompt (`:149-152`), and builds `history` from
  `session.messages` (`:178-191`). A sub-agent turn *will* pollute the chat
  transcript unless the seam is extracted. Smallest seam: a
  `runAgentPass({ model, instructions, messages, tools, onEvent, signal })` that
  wraps `streamText` + the `onAwaitingInteraction` / `onContinuePass` loop, with
  `startAgentTurn` / `messagePersister` lifted out — then `runChatTurn` becomes
  one caller and the Agent Task node a second caller with
  `tools = { web_search, read_node, read_canvas }` and an event sink pointed at
  the canvas channel. Real 3–5 day refactor; keeping it in P2 (decision 16) is
  correct.
- **D9 "compact summary auto-injected"** — `compactModelMessages` runs on every
  step via `prepareStep` (`runtime.ts:232-234`), but `instructions` is passed
  once and untouched. Injecting the summary into `instructions` freezes it at
  turn start; a node the agent adds mid-turn will not appear until the next
  turn. Either accept that (and lean on `read_canvas()`), or inject via
  `prepareStep`.
- **D8 "dirty tracking / stale badge"** — needs a `params_hash` column; add it
  in `0002_canvas` even though C does not use it.
- **D13 optimistic drag + revision counter** — put `live_revision` on the
  `canvases` row and bump it inside the same `UPDATE`, so a reload reads
  `after = live_revision` from `GET /:sessionId` and the stream replays only the
  gap. Do **not** copy `AgentSession`'s in-memory-then-persist-at-end scheme
  (`session.ts:112` + `:549`): a canvas has no "end", so a crash would lose the
  cursor. Reconcile drags **per field** (x / y last-writer-wins by `rev`), not
  per node, or the executor's `run_state` write will stomp a concurrent drag.
- **D5 session-scoped** — `sessions` rows cascade-delete `messages`
  (`schema.ts:46`) but `artifactStore.removeBySession` is called manually from
  the sessions router. Give `canvases` a real
  `REFERENCES sessions(id) ON DELETE CASCADE`; `PRAGMA foreign_keys = ON` is
  already set (`client.ts:60`).
- **D6 React Flow + the keep-alive tab host** — `MainLayout.tsx:42-61` mounts
  *every* tab simultaneously and hides inactive ones with `display:none`. A
  hidden React Flow instance measures zero width and renders collapsed on
  re-show until a `fitView` / resize. Add a `ResizeObserver`-driven `fitView`
  or gate the `<ReactFlow>` mount on tab-active.
- **D17 go / no-go bar** — the panel is currently 280 px with no divider;
  judging "canvas beats plain chat" in a 280 px column biases the result. Land
  task 13 before running the bar.

---

## 5. Phasing

- **C** — walking skeleton (this doc, §3). Proves agent + canvas co-editing end
  to end.
- **P1** — general topological executor + dirty badges + "run from here". The
  executor core is textbook (topo sort, cycle detection at connect time, dirty
  propagation, per-field LWW); ~1–2 weeks. Node `run()` = API call, so no
  VRAM / model management.
- **P2** — Agent Task node. Requires the `runAgentPass()` extraction (trap D11)
  and generalizing the permission `sinks` scope (R3). 3–5 days for the refactor
  + the node.
- **P3** — undo / redo polish, drag-to-mention, right-click node actions.
- **P4** — video / audio nodes (same async-job → media-URL pattern, new
  provider contracts + longer-job UX + player widgets).

---

## 6. Implementation status — 2026-09-02

### Shipped to `main`

| PR | Phase | What landed |
|---|---|---|
| #9 | — | pierre `@pierre/diffs` file-diff rendering in tool-approval + completed write cards (adjacent feature, not canvas). |
| #11 | **C** | React Flow right-panel canvas, `image` node with real generation, `add_node` / `run_node` agent tools, session-scoped `canvases`/`canvas_nodes`/`canvas_edges` tables + `0002_canvas` migration, forked `CanvasChannel` (own ring, no `done`, 15s heartbeat), `DbHandle` plumbed to `createApp`, on-disk PNG assets served at `GET /api/canvas/assets/:canvasId/:file`, renderer-local pre-flight spend confirm. R1/R2/R3 mitigations all implemented as designed. |
| #13 | **P1 + P1.5** | Topological executor (`topoOrder` Kahn, cycle detection at connect time, `descendants` scoping for "run from here"), dirty tracking (`inputHash` vs stored `paramsHash`, `broadcastDownstreamDirty`), `run_graph` + `graph_run` progress events + stop; **P1.5 UX**: right-click context menus (node + pane), drag-drop image import (`POST /:canvasId/import`), `NodeResizer` with resize-end commit, animated edges on running targets, lightbox / download / "save to artifacts" (`POST /:canvasId/nodes/:id/save-asset`), agent `read_canvas` / `read_node` / `update_node` / `connect_nodes` / `delete_node` tools, selection → agent turn summary (`selectionByCanvas`), focus-canvas-on-agent-touch, no `window.confirm` popups (explicit click = consent; batch run = 2-click inline confirm). |
| #14 | **P2-UX** (pulled forward from old P3) | Renderer-side undo/redo (`HistoryEntry` closures, `HISTORY_CAP=60`, mutable-id capture), drag node → composer reference chip + `canvas:<id>` mentions, bidirectional node↔chat highlight, auto-layout ("整理" → `layoutGraph`), connection validation (`isValidConnection` = `wouldCycle` + dup check), inline double-click rename, multi-image dot navigation, right-panel maximize / resizable divider / close. |

Merge base tips: `13fab01` (#10 doc) ◂ `8967721` (#14) ◂ `9987deb` (#13) ◂ `134a8bf` (#11) ◂ `33336d4` (#9). `main` verified green: `tsc` clean, `vitest` 26 files / 155 tests, `test:api` smoke pass.

### Deviations from the original plan

- **Old P3 was pulled forward** and shipped as "P2-UX" (#14) *before* the Agent
  Task node. The number "P2" now ambiguously refers to both — this doc keeps
  "P2 = Agent Task node" as the canonical meaning; the UX work is "P2-UX".
- **Pop-out to a separate `BrowserWindow` is cut permanently** (user: "不用弹出
  独立窗口吧 这样感觉有点怪怪的"). D3's pop-out control is gone from the plan,
  not merely deferred. Maximize + resizable divider + close cover the need.
- **`window.confirm` popups removed** (user: "没必要的提示弹窗可以砍了"). Per-node
  Run and "run from here" are silent; only the batch "运行整图" keeps a 2-click
  inline confirm as the spend gate.
- **`dirty` / `paramsHash` / `inputHash`** shipped in P1 as designed — the
  schema seed from C paid off.

### Not done

**P2 — Agent Task node (the biggest remaining planned piece).**
`AgentNode.tsx` is a placeholder (instruction textarea + "P2" note);
`graphExecutor.ts` skips `agent` nodes; `POST /:canvasId/nodes/:id/run` returns
501 for them. Blockers, both called out in §2/§4:
- Extract `runAgentPass({ model, instructions, messages, tools, onEvent, signal })`
  out of `runChatTurn` (`agent/runtime.ts`) so a sub-agent turn does **not**
  persist a `ChatMessage`, rename the session, or read `session.messages` as
  history (trap D11). ~3–5 day refactor.
- Generalize `permissions.ts` `sinks` from `Map<sessionId, sink>` to
  `Map<scopeId, sink>` (`chat:<id>` / `canvas:<id>`) and make
  `clearPermissionSink` scope-selective (R3), so an Agent Task run has a
  delivery channel for any interaction it raises.
- Point the sub-agent's event sink at the `CanvasChannel`; restricted read-only
  toolset (`web_search` + `read_node` + `read_canvas`).

**P4 — video / audio nodes.** Nothing started. Needs provider contracts (video:
Kling / Runway / Veo; audio: ElevenLabs / Suno), long-job progress UX, and
player widgets in the node body.

**Un-phased backlog (raised during the UX passes, no phase assigned):**

- Copy / paste nodes (Ctrl+C / Ctrl+V).
- Double-click canvas / drop-a-wire-on-empty → node search palette (the ComfyUI
  signature interaction).
- Node bypass / mute; collapse; group / frame nodes.
- Per-node generation params: model picker, seed, negative prompt, `n` (batch).
- img2img before/after compare view; regenerate history / variations (a rerun
  currently overwrites the single output).
- Non-image providers (fal / Replicate) — currently OpenAI images only.
- Promote a canvas to project-level / standalone document (D5 growth path,
  explicitly deferred).
- Keyboard shortcuts beyond undo/redo (e.g. `R` = run selected).
- Canvas loading skeleton + a persistent "stream disconnected" banner;
  dark-mode alignment of React Flow's own CSS variables; right panel
  remembering its last-open tab.
