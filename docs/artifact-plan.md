# Artifacts + Work-product — design decisions & roadmap

Status: **AP1–AP2 done, AP3–AP5 partial** (2026-09-03). Companion to `canvas-plan.md`. Where
`canvas-plan.md` went deep on the node graph, this plan goes deep on the
**work-product surface** — the 作品 panel and every artifact type it holds
(markdown, html, image, video, draw/annotation, files). Source: an Opus
investigation of `E:\CodeCode\open-design` (an agent app whose right-side file
workspace is its most developed surface) mapped onto our codebase.

§1 is the keystone (the artifact substrate everything else needs). §2 is the
full feature inventory as a backlog table. §3 is phasing. §4 is per-phase task
lists. §5 is the trap list (grounded in the code). §6 is the living status —
**read it first if you just want to know where things stand.**

---

## 0. Guiding calls

1. **The substrate comes first.** `artifactStore` today is create-only
   JSON-file rows with a 200 000-char content cap (`storage/artifactStore.ts:12`,
   `:104`). It cannot hold a PNG, cannot be updated, and has no history. Almost
   every feature below is blocked on fixing that. AP1 does nothing user-visible
   on its own — it is the enabling layer.
2. **Copy the small pure modules, not the big components.** open-design's
   `FileViewer.tsx` is ~20k lines. The good parts it carefully extracted —
   render-mode decision, iframe guards, comment model, tool-loop guard — are
   each < 400 lines. Take those; leave the god-component.
3. **Don't port what only exists to work around a constraint we don't have.**
   open-design drives an external CLI, which forces its `<artifact>` tag
   protocol, plain-stream normalisation, role-marker guards, execution-profile
   split. We run the model in-process with structured tool calls. Skip that
   whole layer (it's M1/M2 "Later" for a reason).
4. **No image editor exists to copy.** open-design's image viewer is download +
   open-in-new-tab. Crop / compare-slider / inpaint would be our original work —
   budget it as such, not as a port. Same for a video scrubber.
5. **Ship honesty rails early.** The tool-loop guard, preview iframe guards, and
   honest media-failure copy are small, isolated, and prevent the worst
   first-impression bugs. AP2, right after the substrate.

---

## 1. The keystone — artifact substrate (AP1)

### 1.1 What's wrong today

| Fact | Location | Consequence |
|---|---|---|
| One JSON file per artifact | `storage/artifactStore.ts:14-37` | No transactional multi-row ops; listing = read every file |
| `MAX_CONTENT_CHARS = 200_000`, `content` sliced on write | `:12`, `:104` | A 1024² PNG as base64 (~1.4 MB) is silently cut in half |
| No `update` — create + remove only | `:86-112` | Every "regenerate" is a new row or a lost result; no history |
| `content: string` only | `shared/artifact.ts:15-17` | Binary must be a data URL; no on-disk blob path |
| `ArtifactKind` = 6 flat strings | `shared/artifact.ts:1` | No renderer selection, no `status`, no provenance |
| `ArtifactPreview.tsx` = 88-line if/else | `workspace/ArtifactPreview.tsx:66-84` | markdown → `iframe sandbox=""` → `img` → `pre`; Copy + Download only |
| Created only from attachments + `onFileWritten` | `agent/runtime.ts:162-174`, `:257-267` | No "generated image → artifact" path at all |

Note the one thing that changed since `canvas-plan.md` was written: **`DbHandle`
now reaches `createApp`** (`app.ts:36`, `:127` — the canvas feature plumbed it).
A SQLite-backed artifact store is therefore feasible now.

### 1.2 Target shape

**`src/shared/artifact.ts`** — extend, keep back-compat:

```ts
export type ArtifactKind =
  | 'markdown' | 'html' | 'text' | 'json' | 'image' | 'binary'  // existing
  | 'svg' | 'diagram' | 'code' | 'video' | 'audio' | 'sketch';  // new

export type ArtifactRenderer =
  | 'markdown' | 'html' | 'image' | 'video' | 'audio' | 'code'
  | 'svg' | 'diagram' | 'sketch' | 'raw';

export type ArtifactStatus = 'streaming' | 'complete' | 'error';

export interface Artifact {
  id: string;
  sessionId: string;
  projectId?: string | null;
  name: string;
  kind: ArtifactKind;
  renderer: ArtifactRenderer;      // NEW — which preview component
  status: ArtifactStatus;          // NEW — streaming | complete | error
  mimeType: string;
  source: ArtifactSource;          // 'attachment' | 'generated' | 'manual'
  version: number;                 // NEW — current version number (1-based)
  versionCount: number;            // NEW — how many versions exist
  byteSize: number;                // NEW — real size (blob or utf8)
  origin?: ArtifactOrigin;         // NEW — who/what produced the current version
  metadata?: Record<string, unknown>; // NEW — kind-specific (deck slide count…)
  createdAt: string;
  updatedAt: string;               // NEW
}

export interface ArtifactOrigin {
  surface: 'chat' | 'canvas' | 'manual_edit' | 'attachment' | 'schedule';
  prompt?: string;                 // the text that caused this version
  turnId?: string;
  canvasNodeId?: string;
  model?: string;
}

export interface ArtifactVersion {
  n: number;
  label: string;                   // 'AI edit' | 'Manual edit' | 'Restored from v3'
  origin: ArtifactOrigin;
  byteSize: number;
  contentDigest: string;           // sha-256, for "on-screen still matches" checks
  createdAt: string;
}
```

**Storage** — new SQLite tables, migration `0003_artifacts`:

```
artifacts(
  id text pk, session_id text not null references sessions(id) on delete cascade,
  project_id text, name text not null, kind text not null, renderer text not null,
  status text not null default 'complete', mime_type text not null,
  source text not null, current_version integer not null default 1,
  byte_size integer not null default 0, origin_json text, metadata_json text,
  created_at integer not null, updated_at integer not null
)
artifact_versions(
  rowid integer pk autoincrement, artifact_id text not null references artifacts(id) on delete cascade,
  n integer not null, label text not null, origin_json text not null,
  byte_size integer not null, content_digest text not null,
  storage text not null,          -- 'inline' | 'blob'
  content text,                   -- when storage='inline' (text artifacts, no cap for md/html; keep a sane 2 MB guard)
  blob_path text,                 -- when storage='blob', relative to <dataRoot>/artifacts/blobs/
  created_at integer not null,
  unique(artifact_id, n)
)
index artifact_versions_artifact_idx on artifact_versions(artifact_id, n)
```

Blob files live at `<dataRoot>/artifacts/blobs/<artifactId>/v<n><ext>` and are
served by a new `GET /api/artifacts/:id/raw?v=<n>` (origin guard in
`app.ts:64-113` already covers `127.0.0.1:<port>`, same as the canvas asset
route). Text stays inline in the row.

**`server/storage/artifactStore.ts`** — rewrite against drizzle, same exported
surface plus:

- `create(input)` → version 1 (inline or blob by size/kind)
- `addVersion(id, input)` → append version n+1, bump `current_version`,
  `updated_at`; **never destructive**
- `restoreVersion(id, n)` → `addVersion` copying v`n`'s content, label
  `Restored from v${n}`
- `get(id, v?)` → metadata + resolved content (or a `rawUrl` for blobs)
- `listVersions(id)` → `ArtifactVersion[]`
- keep `listAll` / `listBySession` / `remove` / `removeBySession`
- keep a **legacy JSON reader**: on first run, import any existing
  `<dataRoot>/artifacts/*.json` into the tables, then rename the dir to
  `artifacts.legacy/`. One-shot, logged.

**Client renderer registry** — `src/renderer/components/workspace/renderers/`:

```ts
interface ArtifactRendererDef {
  id: ArtifactRenderer;
  canRender(a: Artifact): boolean;
  supportsStreaming: boolean;
  Component: React.FC<{ artifact: Artifact; version: number }>;
}
const REGISTRY: ArtifactRendererDef[] = [
  imageRenderer, videoRenderer, audioRenderer, sketchRenderer,
  svgRenderer, diagramRenderer, htmlRenderer, markdownRenderer, codeRenderer,
  rawRenderer, // always-true fallback
];
export function pickRenderer(a: Artifact) {
  return REGISTRY.find((r) => r.id === a.renderer && r.canRender(a))
      ?? REGISTRY.find((r) => r.canRender(a))
      ?? rawRenderer;
}
```

`ArtifactPreview.tsx` becomes a thin host: toolbar (name, version rail button,
share/export button, close) + `<Renderer artifact version />`. The current
if/else chain moves into `markdownRenderer` / `htmlRenderer` / `imageRenderer` /
`rawRenderer` unchanged in behaviour.

**Version rail** — `ArtifactVersionRail.tsx`: a drawer listing
`v1..vN`, each row `label · relative time · prompt (truncated, copy button)`,
click = preview that version in place, "切换到此版本" = `restoreVersion`.
Mirrors the image node's existing multi-image dot navigation
(`canvas-plan.md` §6 "P2-UX").

### 1.3 Wiring the producers

- `runtime.ts:257-267` `onFileWritten` → if the same `name` already has an
  artifact this session, call `addVersion` with `origin.prompt = userText`,
  `origin.turnId`; else `create`. (This alone gives markdown/doc/code artifacts
  a history for free.)
- `canvas/imageExecutor.ts` — on a successful generation, `create` or
  `addVersion` an `image` artifact (blob storage) with
  `origin = { surface: 'canvas', canvasNodeId, prompt, model }`. The
  node keeps its own `output_json` pointer; the artifact is the durable,
  versioned copy. Resolves `canvas-plan.md` §6 "single output, overwritten on
  rerun".
- `canvas/agentExecutor.ts` — same, for the agent node's text answer
  (`markdown` artifact).
- New `POST /api/sessions/:id/artifacts` accepts `source: 'manual'` for
  "New document" / "New sketch" (B3, C2).

### 1.4 AP1 acceptance

- `tsc` clean, `vitest` green, `test:api` green.
- Existing JSON artifacts migrated on first launch; 作品 panel still lists them.
- A generated canvas image appears as an `image` artifact with a working
  `<img>` preview at full resolution (no 200 KB truncation).
- Re-running an image node adds v2; the version rail switches between them.
- No user-visible regression in the 作品 panel beyond the new version button.

---

## 2. Feature inventory (backlog)

Effort: **S** ≤ 2 days · **M** 3–10 days · **L** 2+ weeks (one engineer).
Priority: **P0** foundational / **P1** high user value / **P2** nice / **P3** later.
"od ref" = where it lives in `E:\CodeCode\open-design`.

### Cross-cutting

| id | Feature | od ref | Effort | Pri | Phase |
|---|---|---|---|---|---|
| X1 | **Version rail + prompt provenance** on every artifact | `project-file-versions.ts`, `run-html-version-snapshots.ts` | M | **P0** | AP1 |
| X2 | Renderer registry (`kind`/`renderer`/`status`, `canRender`, `supportsStreaming`) | `artifacts/renderer-registry.ts`, `artifacts/types.ts` | M | **P0** | AP1 |
| X3 | Unified **Share / Export / Send-to** menu (start: PDF + standalone HTML + PNG + ZIP) | `pdf-export.ts`, `deck-export.ts`, `artifacts/standalone-html.ts` | M | P1 | AP3 |
| X4 | **Hand off** — open artifact in detected editor / copy framework-targeted prompt | `HandoffButton.tsx` | S | P1 | AP5 |
| X5 | **Next-step action strip** after a turn (pre-written prompts) | `NextStepActions.tsx`, `runtime/design-toolbox.ts` | M | P1 | AP5 |
| X6 | **Design toolbox** — searchable catalogue of follow-up prompts | `runtime/design-toolbox.ts`, `en.ts:2488-2560` | M | P2 | AP5 |
| X7 | **Context chip strip** — show skill / project / attachment / mention shaping the turn | `ContextChipStrip.tsx` | S | P1 | AP5 |
| X8 | **`<question-form>`** — agent asks with real controls, answers post back | `artifacts/question-form.ts`, `QuestionForm.tsx`, `prompts/discovery.ts` | M | P1 | AP4 |
| X9 | **`direction-cards`** — pick a visual direction by looking (palette + type samples) | `prompts/directions.ts` | M | P1 | AP4 |
| X10 | **`<od-card>` verify scorecard** + "memory applied" chip + rule proposal | `contracts/src/artifacts/od-card.ts` | M | P2 | AP5 |
| X11 | GenUI answer reuse (hash the form schema, don't re-ask) | `genui/registry.ts` | S | P2 | AP5 |
| X12 | **Tool-loop guard** (N consecutive errors / same signature K times → warn/halt) | `tool-loop-guard.ts` | S | **P0** | AP2 |
| X13 | Deliverable + **stub guard** on run completion (rerun shrinks output → flag) | `run-deliverable-validation.ts`, `artifacts/stub-guard.ts` | S | P1 | AP2 |

### Markdown / document

| id | Feature | od ref | Effort | Pri | Phase |
|---|---|---|---|---|---|
| MD1 | **Split-view markdown editor + autosave**, paste/drop image → upload at cursor | `FileViewer.tsx:19177` | M | P1 | AP3 |
| MD2 | Streaming + error **status banner** on a partial doc (keep last good content) | `renderer-registry.ts` `supportsStreaming`/`renderPartial`, `en.ts:2972-2975` | S | P1 | AP3 |
| MD3 | **New document** from a scenario-seeded brief template (content, not code) | `en.ts:2811-2829` | S | P2 | AP5 |
| MD4 | **Plan-document → artifact loop** (Generate artifact / Improve doc / Align) | `NextStepActions.tsx` `'plan'` | M | P2 | AP5 |
| MD5 | **Deck mode**: slide nav, thumbnail rail, speaker notes, Present, PPTX/PDF export | `DeckThumbnailRail.tsx`, `deck-export.ts` | L | P3 | Later |
| MD6 | Responsive **viewport** (Desktop/Tablet/Mobile) + zoom for html/doc previews | `en.ts:3141-3150` | S | P2 | AP3 |
| MD7 | **Preview / Code toggle** + "reload from disk" + copy | `en.ts:2988-2995` | S | P1 | AP3 |

### Draw / annotation

| id | Feature | od ref | Effort | Pri | Phase |
|---|---|---|---|---|---|
| DR1 | **Draw-to-annotate overlay** over any artifact → screenshot + structured bounds → chat (Draft / Queue / Send triad) | `PreviewDrawOverlay.tsx` | M | P1 | AP4 |
| DR2 | **Excalidraw** as a first-class `sketch` artifact (scene JSON + PNG export) | `SketchEditor.tsx`, `sketch-model.ts` | M | P2 | Later |
| DR3 | **Comment pins with batching queue** (pin → note → select many → send as one msg) | `comments.ts`, `FileViewer.tsx` `comment-side-*` | M | P2 | AP4 |
| DR4 | **Screenshot-a-region → chat** (cheapest slice of DR1; ship alone if DR1 slips) | `runtime/exports.ts` `requestPreviewSnapshot` | S | P1 | AP4 |

### Image

| id | Feature | od ref | Effort | Pri | Phase |
|---|---|---|---|---|---|
| IM1 | Pre-generation **option strip**: model picker (searchable, "recommended") / aspect / count | `NewProjectPanel.tsx`, `media/models.ts` | M | P1 | AP6 |
| IM2 | **Media task queue** with progress + honest localised failure copy (`retryable`, `subject`) | `media/task-store.ts` | M | P1 | AP2/AP6 |
| IM3 | Image **regenerate history** via the version rail (= X1 applied to images) | — | M | P1 | AP1 |
| IM4 | **Drag / drop / paste** anything into the 作品 panel as context | `DesignFilesPanel.tsx` | S | P1 | AP3 |
| IM5 | **Multi-select bulk actions** (download N as ZIP / delete N / clear) | `en.ts:2799-2803` | S | P2 | AP3 |
| IM6 | **Reference board** — curated image sources (embedded browser) | `DesignBrowserPanel.tsx` | L | P3 | Later |
| IM7 | img2img before/after **compare view** (our own work — no od port) | — | M | P3 | Later |

### Video / audio

| id | Feature | od ref | Effort | Pri | Phase |
|---|---|---|---|---|---|
| VA1 | Video **option strip**: model / aspect / length; i2v "reference image required" hint | `media-adapters/{video,capabilities,seed}.ts`, `media/models.ts` | M | P2 | AP6 |
| VA2 | Audio **option strip**: type (music/speech/sfx) / duration / voice (degrades to default) | `media/models.ts` `AUDIO_MODELS_BY_KIND` | S | P2 | AP6 |
| VA3 | **Long-job progress + cancel + `interrupted` state** (persisted task row) | `media/task-store.ts` | M | P2 | AP6 |
| VA4 | **HyperFrames** — HTML-authored motion as an artifact kind, host-captured to MP4 | `media/hyperframes-runtime.ts` | L | P3 | Later |

### Explicitly skipped (do not port)

- `<artifact>` streaming tag parser + fence-aware skip ranges (`parser.ts`,
  `markdown-context.ts`) — only needed for a file-tool-less provider. Our model
  writes through workspace tools. Revisit only if BYOK-without-tools ships.
- Content-pack prompt layering with design systems / craft rules
  (`prompts/system.ts`) — real value but a large content effort; our
  `skills/` + `skills-lock.json` already covers distribution. Later.
- CLI-spawning runtime registry, role-marker guard, execution-profile split —
  workarounds for an external-CLI architecture we don't have.
- Image editor / video scrubber — no open-design code to port; original work.

---

## 3. Phasing

| Phase | Theme | Contents | Rough size |
|---|---|---|---|
| **AP1** | Substrate (keystone) | X1, X2, IM3 — SQLite artifact store + blobs + versions + renderer registry + version rail | 1–1.5 wk |
| **AP2** | Honesty rails | X12 tool-loop guard, X13 deliverable/stub guard, preview iframe guards (focus/redirect/storage), IM2 failure-copy classifier (no queue yet) | 3–5 d |
| **AP3** | Editing & preview UX | MD1 split editor + autosave, MD2 streaming status, MD6 viewport+zoom, MD7 preview/code+reload, X3 share/export menu (PDF+HTML+PNG+ZIP), IM4 drop zone, IM5 bulk ZIP | 1.5–2 wk |
| **AP4** | Conversation gets visual | X8 question-form, X9 direction-cards, DR4 screenshot→chat, DR1 draw-to-annotate, DR3 comment pins + batching | 2 wk |
| **AP5** | Actionability & intelligence | X5 next-step strip, X4 hand-off, X7 context chips, X6 design toolbox, X10 od-card scorecards, X11 genui cache, MD3 templates, MD4 plan→artifact loop | 2 wk |
| **AP6** | Media | IM1 image option strip, VA1/VA2 video+audio strips, VA3/IM2 task queue + progress + interrupted | 2 wk (overlaps canvas P4) |
| **Later** | High ceiling / high cost | MD5 deck mode, DR2 Excalidraw, IM6 reference board, IM7 compare view, VA4 HyperFrames, M1/M2 skipped-above | — |

Order rationale: AP1 unblocks everything. AP2 is cheap and stops the worst
bugs. AP3/AP4 are the visible product jump. AP5 is polish + perceived
intelligence. AP6 rides on the canvas P4 provider work.

---

## 4. Per-phase task lists

### AP1 — substrate

**Backend**

1. `shared/artifact.ts` — extend types (§1.2), keep `inferArtifactKind` /
   `mimeForKind`, add `inferRenderer(kind, mime, name)` and
   `defaultStatus = 'complete'`. Back-compat: old callers that pass no
   `renderer`/`status`/`version` still type-check via defaults in the store.
2. `db/schema.ts` + `db/migrations.ts` — append `0003_artifacts`
   (`artifacts`, `artifact_versions` per §1.2). Mirror to
   `db/migrations/0003_artifacts.sql`. `session_id` CASCADE.
3. `server/storage/artifactStore.ts` — rewrite against drizzle (shape after
   `canvasStore.ts` / `sqliteSessionStore.ts`). New methods: `addVersion`,
   `restoreVersion`, `listVersions`, `get(id, v?)`. Blob writer under
   `<dataRoot>/artifacts/blobs/`. **Legacy import**: one-shot read of
   `<dataRoot>/artifacts/*.json` → tables → rename dir. Log counts.
4. `server/storage/artifactStore.ts` needs the `DbHandle` — thread
   `options.db` through `createApp` to `createArtifactStore(db, dataRoot)`
   (`app.ts:124`). Keep a `dataRoot`-only fallback that throws a clear
   "artifacts need SQLite" for the JSON-only test app, **or** give the test app
   an in-memory db (preferred — `canvasStore` already assumes `db`).
5. `routes/artifacts.ts` — add `GET /:id/raw?v=`, `GET /:id/versions`,
   `POST /:id/versions` (manual edit — AP3 uses it), `POST /:id/restore/:n`.
   `GET /:id` grows an optional `?v=`. `POST /api/sessions/:id/artifacts`
   accepts `source: 'manual'` + `kind`.
6. `runtime.ts:257-267` — `onFileWritten` becomes create-or-addVersion by
   `(sessionId, name)`, passing `origin { surface:'chat', prompt:userText, turnId }`.
   Thread `turnId` in (it's on the session turn state).
7. `canvas/imageExecutor.ts` + `canvas/agentExecutor.ts` — write a versioned
   artifact on success (`origin.surface:'canvas'`, `canvasNodeId`, `prompt`,
   `model`). Image = blob; agent = inline markdown. Node `output_json` keeps a
   `{ artifactId }` pointer.
8. `db/migrations.ts` legacy note + `test:api` smoke for the new routes.

**Renderer**

9. `state/artifactStore.ts` (renderer) — `contentById` keyed by `${id}@${v}`;
   add `loadVersions(id)`, `restoreVersion(id, n)`, `versionsById`.
   `api.ts` — `getArtifactVersions`, `restoreArtifactVersion`,
   `artifactRawUrl(id, v)` (returns `http://127.0.0.1:<port>/api/artifacts/...`).
10. `components/workspace/renderers/` — `imageRenderer`, `htmlRenderer`,
    `markdownRenderer`, `codeRenderer`, `rawRenderer` (move the current
    `ArtifactPreview` if/else in verbatim), `index.ts` with `pickRenderer`.
    `svg`/`diagram`/`video`/`audio`/`sketch` renderers can be stubs that fall
    through to `rawRenderer` until their phase.
11. `ArtifactPreview.tsx` — reduce to host: toolbar + `pickRenderer` +
    `ArtifactVersionRail` toggle. Keep Copy/Download (Download now hits
    `artifactRawUrl` for blobs).
12. `ArtifactVersionRail.tsx` — the drawer (§1.2). Wire "切换到此版本".
13. `ArtifactPanel.tsx` — list row shows `v{n}` badge when `versionCount > 1`;
    `source` label gains `'manual' → '手动'`.
14. Tests: `artifactStore` (renderer) version keying; `pickRenderer` table;
    a `streamingMarkdown`-style test is not needed yet (MD2).

### AP2 — honesty rails

1. `server/agent/toolLoopGuard.ts` — pure fn `inspectToolStream(events)` →
   `{ tier: 'ok' | 'warn' | 'halt', reason }`. Triggers: (a) `N=4` consecutive
   errored `tool` events, reset on any success; (b) same `(name + stableArgHash)`
   errored `K=3` times, reset only on a **successful mutating** call. Unit-test
   heavily (fits `continuePass.test.ts` style).
2. `shared/stream.ts` — add `{ type: 'tool_loop'; tier: 'warn' | 'halt'; reason: string }`
   to `ChatStreamEvent` (closed union — this is the documented extension path;
   canvas added `CanvasEvent` the same way).
3. `runtime.ts` — feed each `tool` event through the guard in the
   `onContinuePass` / step boundary; `warn` → `emit({type:'tool_loop',...})`;
   `halt` → abort the turn (reuse `abortChatTurn` path) with a final
   `done { outcome:'error', error:'stopped: tool loop' }`.
4. `canvas/agentExecutor.ts` + `canvas/graphExecutor.ts` — run the same guard
   over the node's tool stream; `halt` fails the node with the reason. (Today
   `agentExecutor` only bounds `stopWhen: isStepCount(12)`; `graphExecutor` has
   nothing.)
5. `components/chat/ToolCard.tsx` / `WorkGroupCard.tsx` — render a `tool_loop`
   `warn` as an inline amber banner ("这一轮可能卡住了 · reason"). `halt` shows
   in the turn's error state.
6. **Preview iframe guards** — `renderers/htmlGuards.ts`: a `<script>` string
   injected into `srcDoc` HTML previews providing (a) focus guard
   (`window.focus` / `HTMLElement.focus` no-op'd against host steal),
   (b) redirect-loop guard (block `<meta http-equiv=refresh>` and rate-limit
   `location.reload` / `location.assign` to self), (c) storage shim
   (`try/catch` no-op `localStorage` / `sessionStorage` / `history` on opaque
   origin). `htmlRenderer` inlines it ahead of the artifact body. Detection
   regexes ported from `file-viewer-render-mode.ts` (`needsFocusGuard` etc.).
7. `server/canvas/mediaError.ts` — `classifyMediaError(err)` →
   `{ code, subject: 'prompt' | 'input_image' | 'unknown', retryable?: boolean, message: string }`
   with localised `message`. `imageExecutor.ts` routes provider errors through
   it; the node error + artifact `status:'error'` carry the clean message.
   Comment verbatim from od: *"undefined retryable means the producer did not
   say; only an explicit false licenses telling a user retrying is pointless."*
8. Tests: `toolLoopGuard.test.ts`, `mediaError.test.ts`, an `htmlGuards`
   smoke (regex detection).

### AP3 — editing & preview UX

1. `renderers/markdownRenderer` — add `mode: 'preview' | 'split' | 'editor'`
   toggle; `<textarea>` bound to a local draft; debounced (800 ms) `POST
   /:id/versions` with `origin.surface:'manual_edit'`, label `Manual edit`;
   status pill `保存中… → 已保存 → 自动保存 · HH:MM`. Paste/drop image → `POST
   /api/sessions/:id/artifacts` (blob) → insert `![](artifact:<id>)` at caret;
   `markdownRenderer` resolves `artifact:` URLs to `artifactRawUrl`.
2. `renderers/*` — honour `artifact.status`: `streaming` → thin top progress
   bar + "正在生成…（部分内容）"; `error` → amber "生成中断，显示最后内容".
   `runtime.ts` / executors set `status:'streaming'` on first chunk,
   `'complete'` / `'error'` at end.
3. `renderers/PreviewFrame.tsx` (shared by html/svg/diagram) — Desktop /
   Tablet (820×1180) / Mobile (390×844) segmented control + zoom in/out/reset;
   scales the iframe via CSS transform.
4. `ArtifactPreview.tsx` toolbar — Preview / Code toggle (Code = `codeRenderer`
   on the raw text), "从磁盘重载" for workspace-file-backed artifacts
   (re-fetch), copy-with-feedback.
5. `components/workspace/ArtifactShareMenu.tsx` — one button, tabs
   Download / Export / Send-to. Backend `routes/artifacts.ts`:
   - `GET /:id/export/html` — standalone HTML (inline local `artifact:` assets
     as data URIs). Port `standalone-html.ts` inliner.
   - `GET /:id/export/pdf` — markdown/html → PDF. Evaluate `electron`
     `webContents.printToPDF` in a hidden `BrowserWindow` (main-process, no new
     dep) vs. a lib. Prefer `printToPDF`.
   - `GET /:id/export/png` — for `image`/`svg`, passthrough / rasterise.
   - `POST /api/sessions/:id/artifacts/zip` — selected ids → zip stream
     (`archiver` or Node `zlib` + a tiny zip writer; prefer a 1-file zip
     writer to avoid a dep).
6. `ArtifactPanel.tsx` — a drop target over the list ("拖文件到这里 · 图片、
   文档、参考"), "上传文件" button, "粘贴为文本文件"; multi-select checkboxes →
   "下载 N 个 (ZIP) / 删除 N / 清除".

### AP4 — conversation gets visual

1. `shared/questionForm.ts` — `QuestionForm` schema (fields: `text`,
   `textarea`, `radio`, `checkbox`, `select`, `direction-cards`; ~8 to start,
   not od's 17). Partial-JSON parser (`parsePartialQuestionForm`) so it renders
   while streaming. Accept `<question-form>` and `<ask-question>` fences.
2. `runtime.ts` translator — detect a `question-form` fenced block in assistant
   text → emit `{ type: 'ask_form', id, form }` (new `ChatStreamEvent`), pause
   like the existing `ask` path (`onAwaitingInteraction` +
   `waitForInteractions`). Reuse `permissions.ts` sink — this is the exact
   plumbing `AskUserPrompt` uses, richer payload.
3. `components/chat/QuestionFormCard.tsx` — renders controls; on submit posts a
   synthetic user message (`JSON.stringify(answers)` + a human-readable echo).
   `direction-cards` → `components/chat/DirectionCard.tsx`: palette swatch row,
   "Aa" sample in the proposed font stack, mood line, refs line.
4. `prompts/discovery.ts` (new) — a system-prompt layer telling the agent when
   to emit `<question-form>` (ambiguous brief, visual direction) instead of
   prose. Gated so it only loads for creative/generation sessions.
5. `X11` genui cache — `server/agent/formCache.ts`: `schemaDigest(form)` →
   stored answer per session; translator short-circuits a re-ask.
6. `DR4` `components/workspace/PreviewSnapshot.ts` — `html2canvas`-free
   approach: for `image` artifacts, crop via `<canvas>`; for html previews, ask
   the iframe (postMessage) or use `webContents.capturePage` on the region.
   Result → composer attachment.
7. `DR1` `components/workspace/DrawOverlay.tsx` — absolute overlay over the
   renderer; tools box / pen (`#ff3b30`, 4px) / text (fraction-sized); undo /
   redo / attach-image / exit; three submit buttons **草稿 / 排队 / 发送**.
   Bakes marks into a screenshot + emits `{ bounds, marks, note, targetHint }`.
   Composer gains a "queued marks" tray.
8. `DR3` `shared/annotation.ts` + `components/workspace/CommentPins.tsx` —
   click element / drag area → pin + note; side dock "已附加 / 已保存"; select
   many → "全部添加" / "添加并发送" as one message. Store pins on the artifact
   `metadata` (or a `artifact_annotations` table if it grows).

### AP5 — actionability & intelligence

1. `shared/nextStep.ts` + `components/chat/NextStepStrip.tsx` — after a
   `done{outcome:'completed'}`, show 3–5 cards from a static catalogue
   (`改进作品`, `生成作品`, `对齐文档与作品`, `分享`, `下载`), each firing a
   pre-written prompt (bodies in a `nextStepPrompts.ts`, translated). Context
   picks the variant (has-artifact, has-markdown-plan, canvas-open).
2. `MD4` — the `'plan'` variant of NextStepStrip: `Generate artifact` /
   `Improve document` / `Align document and artifact` prompt bodies.
3. `components/chat/DesignToolbox.tsx` — a composer button → searchable list of
   ~20 actions (title + desc + long prompt), badged (`Assets`, `Motion`,
   `Taste`, `Charts`, `Logo`, `Plan`, `Polish`). Pure content in
   `designToolbox.ts`.
4. `components/chat/ContextChipStrip.tsx` — above the composer: removable chips
   for active skill / project / attachments / `canvas:` mentions / workspace.
   Generalises the existing `mentions` chips. Click = detail; X = drop for the
   next turn.
5. `X4` `components/workspace/HandoffMenu.tsx` — detect editors on PATH
   (`code`, `cursor`, `subl`, `idea`) via a main-process check; "在 X 中打开"
   writes the artifact to a temp file and shells out; "复制给 CLI" with a
   framework picker copies a templated prompt.
6. `X10` `shared/odCard.ts` + `components/chat/OdCard.tsx` — kinds
   `verify-scorecard` (rubric rows pass/fail/fixed), `memory-applied`
   (chips), `rule-proposal` (Keep/Edit/Discard → writes to `MEMORY.md`).
   Agent emits `<od-card>` fences; translator → `{ type:'od_card', card }`.
7. `MD3` — "新建文档" in `ArtifactPanel`: scenario-seeded markdown templates
   (`docTemplates.ts`), `source:'manual'`.

### AP6 — media

1. `shared/mediaModels.ts` — model catalogue with per-model capability flags
   (`sizes`, `supportsI2v`, `maxSeconds`, `paid`). Port the *shape* of
   `media/models.ts` / `media-adapters/capabilities.ts`, not the list.
2. `IM1` — image node + a new `image` artifact "regenerate" panel gets a
   model / aspect / count strip (canvas-plan §6 backlog "per-node generation
   params"). `imageExecutor` honours `n` (batch → N versions).
3. `VA1` / `VA2` — `video` / `audio` node types (canvas P4) + artifact
   renderers (`<video controls>` / `<audio controls>` — bare is fine, per
   guiding call 4). Option strips from the catalogue.
4. `VA3` `server/media/taskStore.ts` — SQLite `media_tasks(id, session_id,
   kind, status, progress_json, error_json, created_at, updated_at)` with
   `queued|running|done|failed|interrupted`, waiters, a TTL sweep that skips
   tasks owned by a live run. On app start, mark orphaned `running` →
   `interrupted`. `imageExecutor` / video / audio all route through it.
5. Node/artifact bodies show a progress line + cancel; `interrupted` renders
   distinctly from `failed`.

---

## 5. Traps (grounded in the code)

- **T1 — the test app has no `db`.** `app.ts:127`
  `canvasStore = options.db ? … : undefined`. `test:api` currently constructs
  the app without a `DbHandle`. AP1 makes artifacts require SQLite, so either
  give the test app an in-memory `better-sqlite3` handle (clean, matches how
  `canvasStore` already assumes `db`) or the artifact routes 500 in tests.
  **Decision: in-memory db for the test app.**
- **T2 — `ChatStreamEvent` is a closed union** (`shared/stream.ts:46-55`) and
  `api.ts readEnvelopeStream` throws `ChatStreamIncompleteError` on EOF without
  `done`. New event types (`tool_loop`, `ask_form`, `od_card`) must be added to
  the union *and* handled in the renderer's event folder
  (`chatStore.ts` `case`) or they're dead. Follow how `todos` / `ask` are
  folded.
- **T3 — permission sink is turn-coupled** (`session.ts:307` set / `:547`
  clear in `finally`; `permissions.ts` `emitNextInteraction` early-returns with
  no sink). `question-form` runs *inside* a live chat turn so it's fine — it
  reuses the same sink the `ask` tool uses. Do **not** try to raise a
  `question-form` from a canvas node (no turn, no sink) — canvas nodes get
  their direction picker inline in the node, not via this path.
- **T4 — `MainLayout` keep-alive tabs** (`MainLayout.tsx:42-61` mounts every
  tab, `display:none` for inactive). An `<iframe>` preview in a hidden tab
  measures zero and any `ResizeObserver`-driven zoom math divides by zero.
  Gate `PreviewFrame` render on tab-active or guard the divisor.
- **T5 — `onFileWritten` fires per write, not per turn** (`runtime.ts:257`).
  A turn that edits the same file 3× would create v1/v2/v3 all tagged with the
  same `userText`. Acceptable (matches od's `run-html-version-snapshots`), but
  the version rail labels should say "AI edit" not the prompt when consecutive
  versions in one turn share a prompt — dedupe display-side.
- **T6 — blob cleanup on `remove` / `removeBySession`.** The JSON store just
  `rm`s a file. The SQLite store must also delete
  `<dataRoot>/artifacts/blobs/<id>/`. `removeBySession` (called manually from
  the sessions router, not by CASCADE — `canvas-plan.md` §4 D5 notes the same)
  must sweep blobs for every removed id.
- **T7 — legacy JSON import must be idempotent and safe.** If the rename to
  `artifacts.legacy/` fails mid-import (Windows file locks), a second run must
  not double-import. Guard with a marker row / `artifacts.migrated` file.
- **T8 — `artifactStore` is passed positionally in ~6 call sites**
  (`app.ts:134-155`, `runtime.ts`, `chat.ts` router, `sessions.ts` router).
  Changing the constructor signature (`createArtifactStore(db, dataRoot)`)
  touches all of them — do it in one commit.
- **T9 — PDF export in an Electron main process.** `webContents.printToPDF`
  needs a `BrowserWindow` loaded with the HTML. A hidden `BrowserWindow`
  per-export is heavy but dependency-free. Pool one, or accept the cost
  (exports are rare). Do not add `puppeteer`.
- **T10 — `direction-cards` fonts.** Rendering "Aa" in a proposed font stack
  only works if the font is installed or web-loaded. Ship with system-stack
  fallbacks and a small curated set of Google Fonts loaded on demand; never
  block the card on a font fetch.
- **T11 — streaming `status` needs a writer.** Nothing sets
  `artifact.status='streaming'` today. AP3 MD2 depends on the executors /
  `onFileWritten` flipping it; if that wiring slips, renderers just always see
  `'complete'` — degrade gracefully, don't assert.

---

## 6. Implementation status — 2026-09-03

### Shipped (branch `feat/artifact-substrate`)

**AP1 — artifact substrate.**
- `shared/artifact.ts` — `ArtifactKind` grew `svg/diagram/code/video/audio/sketch`;
  new `ArtifactRenderer`, `ArtifactStatus`, `ArtifactOrigin`, `ArtifactVersion`;
  `Artifact` gained `renderer/status/version/versionCount/byteSize/origin/metadata/updatedAt`.
  `source` gained `'manual'`. Helpers: `inferRenderer`, `isBlobKind`, `extForBlob`.
- `db/migrations.ts` + `db/schema.ts` + `db/migrations/0003_artifacts.sql` —
  `artifacts` + `artifact_versions` (append-only, `origin_json` per version,
  `storage: inline|blob`). No FK on `session_id` (test app keeps sessions
  outside SQLite; cleanup stays manual via `removeBySession`).
- `server/storage/artifactStore.ts` — full rewrite against `node:sqlite` raw
  prepares (canvasStore pattern). Blobs at `<dataRoot>/artifacts/blobs/<id>/v<n><ext>`.
  New: `addVersion`, `restoreVersion`, `listVersions`, `get(id, v?)`,
  `getMeta`, `blobFilePath`, `createOrAddVersion`, `setStatus`. `data:` URLs
  auto-decode to blobs. **One-shot legacy JSON import** on construction
  (`<dataRoot>/artifacts/*.json` → tables → dir renamed + marker file).
  `artifactStore.test.ts` — 7 cases (versions, blob, restore, legacy import
  idempotency, per-session `createOrAddVersion`, blob cleanup).
- `app.ts` — `db = options.db ?? openDb(':memory:')`; artifact + canvas stores
  now always available (test app included). `createArtifactStore(db, dataRoot)`.
- `routes/artifacts.ts` — `GET /:id?v=`, `GET /:id/versions`, `GET /:id/raw?v=`
  (blob bytes / inline fallback), `POST /:id/versions` (manual edit),
  `POST /:id/restore/:n`. `POST /api/sessions/:id/artifacts` accepts
  `kind` + `source:'manual'`.
- `agent/runtime.ts` — `onFileWritten` → `createOrAddVersion` tagged with the
  turn's prompt, so a rewritten file builds a version history.
- `routes/canvas.ts` `save-asset` → `createOrAddVersion` keyed by a stable
  per-node name with `origin { surface:'canvas', canvasNodeId, prompt, model }`
  (IM3 — regenerate history lands in the version rail).
- Renderer: `components/workspace/renderers/` (`pickRenderer` registry:
  image/video/audio/svg/html/markdown/code/raw), `ArtifactVersionRail.tsx`
  (version list · prompt · 切换到此版本), `ArtifactPreview.tsx` reduced to a
  host (toolbar + renderer + rail; `status` badges; blob download via raw URL).
  `state/artifactStore.ts` — content keyed `${id}@${v}`, `loadArtifactVersions`,
  `invalidateArtifact`. `api.ts` — `getArtifactVersions`, `addArtifactVersion`,
  `restoreArtifactVersion`, `artifactRawUrl`.
- Gates: `tsc` clean · `vitest` 27 files / 166 tests · `test:api` pass.

**AP2 — honesty rails.**
- `server/agent/toolLoopGuard.ts` (+ test, 8 cases) — `inspectToolStream` pure
  fn + `createToolLoopGuard` stateful wrapper. Triggers: 3/6 consecutive tool
  errors (reset by any success); same signature failing 3/5× (reset only by a
  successful *mutating* call). Emits a verdict only when the tier rises.
- `shared/stream.ts` — new `{ type: 'tool_loop'; tier: 'warn'|'halt'; reason }`
  event.
- `agent/runtime.ts` — wraps `emit` in `onReady`: completed tool calls feed the
  guard; `warn` → `tool_loop` event; `halt` → also `abortChatTurn` (settles as
  `interrupted`; the event carries the reason).
- Renderer — `chatStore` folds `tool_loop` into `loopNoticeBySession` (cleared
  on new turn); `Composer` renders an amber `role="status"` banner.
- `renderers/htmlGuards.ts` (+ test) — `withHtmlPreviewGuard` / injectable
  script neutralising focus-steal, redirect-loop, and opaque-origin storage
  throws. Wired into `HtmlRenderer` as a comment for now — activates with the
  AP3 "run HTML" mode (current default stays `sandbox=""`, scripts off).
- `server/canvas/mediaError.ts` (+ test, 7 cases) — `classifyMediaError` →
  `{ code, subject, retryable?, message, raw }`. Tri-state `retryable`
  (`undefined` ≠ `false`). Wired into `imageExecutor` catch: the node shows one
  localised sentence, the raw goes to the log.
- Gates: `tsc` clean · `vitest` 31 files / 185 tests · `test:api` pass.

**AP3 — editing & preview UX (partial).**
- `renderers/MarkdownRenderer.tsx` — MD1: 预览 / 分屏 / 编辑 mode toggle, a
  `<textarea>` draft, 900 ms debounced autosave via `POST /:id/versions`
  (`保存中… → 已保存 · HH:MM`). Only active when the artifact is a text kind on
  its latest version.
- `ArtifactPreview.tsx` — MD7: 源码/渲染 toggle (swaps in the `code` renderer);
  passes `onCommitDraft` (→ `addArtifactVersion` + reload) to editable text
  renderers; blob download goes through the raw URL.
- `ArtifactPanel.tsx` — IM4: drag-drop / 上传 button reads files (text inline,
  binary as data URL → blob) into `createSessionArtifact`. IM5: 多选 mode with
  下载 / 删除 / 清除 bar. Empty-state copy updated to "拖文件到这里".
- `renderers/types.ts` — `ArtifactRenderProps.onCommitDraft`.
- Gates: `tsc` clean · `vitest` 31 files / 185 tests · `test:api` pass.
**AP3 — editing & preview UX (cont.).**
- `renderers/PreviewFrame.tsx` — MD6: 桌面/平板(820)/手机(390) segmented control
  + zoom, wraps `HtmlRenderer`'s iframe.
- **Left in AP3**: X3 share/export menu (PDF needs an Electron `printToPDF` IPC
  handler — deferred as a small follow-up; standalone-HTML + ZIP unbuilt),
  MD2 streaming-status wiring (renderer-ready; no producer streams into an
  artifact incrementally yet).

**AP4 — conversation gets visual (partial).**
- X8/X9 via the existing `ask_user` seam (no new fenced-block protocol):
  `AskQuestion` gained `kind:'direction'` + `directions: DirectionCard[]`;
  `ask_user` tool schema + system-prompt nudge; `DirectionCard.tsx` (palette
  swatches, "Aa" in the proposed font, mood, refs); `AskUserPrompt.tsx`
  branches to a bespoke direction layout, else the existing `ApprovalCard`.
  Reuses the whole `registerPendingAsk` / `waitForInteractions` / `answerAsk`
  round-trip untouched.
- **Left in AP4**: DR1 draw-to-annotate, DR3 comment pins, DR4 screenshot→chat.

**AP5 — actionability (partial).**
- X5 next-step strip: `shared/nextStep.ts` (`pickNextStepActions` + catalogue,
  4 tests), `NextStepStrip.tsx` rendered in `Composer` after a
  `completed` turn; cards fire a pre-written prompt via `onSend`. Context
  (has-artifact / text / image) filters the catalogue.
- **Left in AP5**: X4 hand-off, X7 context chips, X6 toolbox, X10 od-card,
  MD3 templates, MD4 plan→artifact loop.

- X7 context chips: `@`-path mentions now render as removable chips in the
  Composer (skill / attachments / node refs already did).
- MD3 templates: `shared/docTemplates.ts` (空白 / 图片需求 / 视频分镜 / 方案 /
  落地页) + a 新建文档 menu in `ArtifactPanel` → creates a `source:'manual'`
  markdown artifact and opens it in the split editor.

- Gates: `tsc` clean · `vitest` 32 files / 189 tests · `test:api` pass.

### In progress

- **AP4 tail** (draw-to-annotate, comment pins), **AP5 tail** (hand-off,
  toolbox, od-card, plan→artifact loop), **AP6** (media option strips + task
  queue — rides on canvas P4 provider work). **cindy investigation** running.

### Deviations

- AP1 §1.2 proposed a `session_id` FK on `artifacts`; dropped it (test app runs
  the JSON session store, so a FK would 500 there). Cleanup was already manual.
- Image auto-artifact-on-generation (§1.3) folded into the existing explicit
  "save to artifacts" node action rather than writing an artifact on every
  run — keeps the 作品 panel from filling with every iteration; the version
  rail still delivers history when the user saves a re-run.
