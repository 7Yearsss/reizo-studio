---
name: testing-reizo-studio
description: How to launch and drive the Reizo Studio Electron app for E2E testing in this sandbox, including the renderer-crash workaround and CDP fallback.
---

# Testing Reizo Studio (Electron) in this sandbox

## Launching

`REIZO_DEV_NO_SANDBOX=1 npm start` (per blueprint) can crash the renderer on this box:
it adds `--disable-dev-shm-usage`, moving Chromium shared memory to `/tmp`, where
creation fails with ESRCH → `[render-process-gone] exitCode 133` → black/unresponsive
window. Workaround — pass the flags directly (keeps shm in `/dev/shm`, which is a
healthy tmpfs here):

```bash
cd /home/ubuntu/repos/reizo-studio
npx electron-forge start -- --no-sandbox --disable-gpu --disable-software-rasterizer --remote-debugging-port=9222
```

Electron args go after the `--` separator (`npm start -- --flag` forwards to
electron-forge, not electron). The window may start behind Chrome or unmaximized:

```bash
WID=$(wmctrl -l | grep 'Reizo Studio' | awk '{print $1}')
wmctrl -i -a "$WID"; wmctrl -i -r "$WID" -b add,maximized_vert,maximized_horz
```

X11 typing (`type` tool) into the Electron window works for ASCII, but CJK text
(e.g. 中文) silently fails to land in the textarea — use ASCII test strings, or drive
the renderer via CDP `Input.insertText` (handles Unicode) on :9222. Note that after
a chip/palette pick the textarea cursor can land at position 0, so typed text may
prepend the seeded draft rather than append — harmless, still proves focus.

## CDP access

`/json/list` works over plain HTTP, but the WebSocket handshake rejects any Origin —
use `websocket-client` (pip) with `suppress_origin=True`, or relaunch with
`--remote-allow-origins=*`. A helper script lives at /tmp/cdp.py (ephemeral — recreate
if gone): connect to the page target whose URL contains `:46173`, then
`Runtime.evaluate`/`Page.captureScreenshot`/`Input.insertText`.

## Coordinate scaling gotcha

The Electron window's CSS viewport can be LARGER than the 1024×768 screenshot/click
space (observed 1600×1156 at dpr=1). Screenshot coordinates ≈ DOM ×
(1024/innerWidth, 768/innerHeight). Small buttons near panel edges (e.g. ask-card
提交/确定 at the card's right edge) are easy to miss by eyeballing — when a click
"succeeded" but nothing changed, get exact positions via CDP:

```python
c.eval('''[...document.querySelectorAll('[data-message-id="pending-interaction"] button')]
  .map(b => ({t: b.textContent.trim(), ...b.getBoundingClientRect().toJSON()}))''')
```

then click at `x * 1024/1600, y * 768/1156`. Single-choice ask cards auto-advance on
option click (no submit needed); multi-page cards need an explicit 提交 click.
Canvas fit-all shortcut is `F` (click canvas first to focus).

## Window paints blank / CDP screenshot is solid color

After vite HMR page-reloads (e.g. a `git pull` lands mid-run), the X11 window can go
fully blank while the renderer stays alive (CDP `Runtime.evaluate` still works).
Window manager tricks (minimize/maximize/resize) do NOT fix it — the compositor
surface is dead. Fix: CDP `Page.reload` — the fresh navigation allocates a new
surface and the window repaints. Verify by checking `Page.captureScreenshot`
returns >1 color; a single-color PNG means still dead.

## A presented ask card missing from the DOM

A server `ask` event can be "presented" but never render (page shows "正在等待模型返回"
with no card) — seen when vite reloaded the renderer mid-turn, which can drop the
pending interaction. Check `/api/sessions/<SID>/stream/resume` for an unanswered ask
id and POST `/api/sessions/<SID>/ask` directly to unblock.

## Settings appear stale → reload the renderer

`settingsStore.loadSettings()` runs only at App mount. If settings were patched via
`PATCH /api/settings` (or by another agent) after the page loaded, the UI keeps
showing old state (e.g. "还没有 API Key", wrong model chip) until you CDP
`Page.reload`. The stale banner is cosmetic — the main process already has the key.

## Draining a flooded ask_user queue

`interactionBySession` is a single slot fed one-at-a-time by the server's pending
queue — a model that emits parallel/duplicate `ask_user` calls produces a long
series of look-alike cards (dedup only folds byte-identical payloads). To drain
without endless clicking, replay the event buffer and answer each pending id
directly (idempotent — `{"ok":false}` = already answered/not pending):

```bash
curl -sN "http://127.0.0.1:47100/api/sessions/<SID>/stream/resume?after=-1" | grep '"ask"'
POST /api/sessions/<SID>/ask  {"id": "<toolCallId>", "answers": {"<qid>": "<answer>"}}
```

For `kind:"direction"` asks the answer value is the picked direction card `id`
(e.g. `neon`), not the title. `/api/canvas/<sessionId>` lists canvas nodes with
runState/assets — handy to verify drafts/final landed without pixel-peeping.

## Paths

- userData: `~/.config/Reizo Studio/` (dev: productName, not package name)
- Real SQLite: `~/.config/Reizo Studio/data/reizo.db` (the top-level `reizo.db` is empty/unused)
- User skills: `~/.config/Reizo Studio/data/skills/<id>/` + `.skillhub.json` marker for hub installs
- Renderer dev server: http://127.0.0.1:46173 ; local API: 127.0.0.1:47100

## Drag-resize handles

Sidebar/right-panel resize handles are a 12px strip, but the ~6px that overhangs the
panel edge is clipped — the effective grab zone is only ~6px at the inner edge.
X11 coordinate drags often miss; use CDP `Input.dispatchMouseEvent` with real px
(real display is 1600×1156 vs 1024×768 screenshot space — multiply x by 1.5625):
mousePressed on the handle, several mouseMoved with buttons=1, mouseReleased.
For perf assertions, inject `localStorage.setItem` + `requestAnimationFrame`
counters via Runtime.evaluate before the drag, then read them after.

## Long-conversation fixture

No API for seeding single messages (POST /messages runs a full agent turn needing a
key). Insert rows directly into `~/.config/Reizo Studio/data/reizo.db` via
`node:sqlite` while the app is stopped — messages cols: id, session_id, role
('user'/'assistant'), content (plain text), created_at (unix ms); sessions also need
live_revision + list_message_count. ~120 messages ≈390 chars each makes a tall list.

## Feature map (relevant pages)

- Sidebar "技能" (Sparkles icon, 2nd item) → uiStore.mode 'skills' → PluginsPage ("插件" title):
  "我的技能" + "SkillHub 技能市场" (search, sort chips, install cards)
- 使用 on a user skill → creates session "/<skillId>" and sends a message with skillId
- No API key configured by default → chat turns fail with 400 "No API key configured";
  session/tab creation is still verifiable, provider reply is not.

## Devin Secrets Needed

None for launch/UI testing. A provider API key would be needed to verify an actual
model reply end-to-end.
- Multi-question ask cards paginate ("Question N of 3"): option clicks auto-advance radio
  questions; multi-select uses checkboxes then the orange → button (aria-label "Submit
  response" / "Previous question"). Final page shows 提交.
- The direction card's question may be asked twice by the model (answered → presented
  again) — answer it a second time; this is a known model-side pattern, not a renderer bug.
- A vite "page reload" mid-turn (any commit touching index.ts while app runs) drops the
  rendered pending card even though the server presented the ask — Page.reload restores it
  via ask persistence.
- Direction-card clicks: clicking the style IMAGE opens a preview lightbox only
  (stopPropagation — does NOT select). Click the card's title/label area to pick it;
  until a direction is picked, 确定 stays disabled with no hint why (complete requires
  picks[q.id]).
- Ask cards AUTO-RESOLVE: when every question has a model-recommended answer, the card
  self-submits after AUTO_RESOLVE_SECONDS (pointer-down anywhere on it snoozes). To
  answer manually, interact immediately — and match question text loosely when polling
  (model phrases questions itself, e.g. '请选择投放平台' not '哪个平台').
- Canvas multi-select: Ctrl+click adds nodes (React Flow default multiSelectionKeyCode);
  Shift+click does NOT. Drag-select boxes only work in 'select' mode (selectionOnDrag).
- Draft-tier nodes: verify via GET /api/canvas/<sid> params.draft — 精渲 paths are
  updateNodeParams(draft:false) + runNode (UI button, MultiSelectToolbar batch, or agent
  update_node tool). Draft model comes from settings.mediaModels.draft or
  DEFAULT_DRAFT_IMAGE_MODEL=gemini-3.1-flash-image.
- Process cleanup: never `pkill -f '<pattern that appears in your own command line>'`
  (e.g. 'electron-forge start') — it kills your own shell. Kill by PID from pgrep/ss.
- composer "+" → 从画布引用 enters node-pick mode: click a canvas node to insert its
  canvas:<id> reference chip into the draft (the ecommerce-listing skill consumes it).
- Verify skill turns via persisted messages parts (tool names in order) +
  GET /api/canvas/<sid> node params (size/refs/word-count of prompts) — don't trust
  screenshots alone.

## Provider key & model fixtures (director-mode / image-gen E2E)

- Configure the provider via `PUT /api/settings` (not PATCH):
  `{"provider":{"id":"reizo","apiKey":"$REIZO_API_KEY"},"activeProviderId":"reizo"}` —
  the REIZO_API_KEY secret covers both chat and image-gen paths. Then CDP `Page.reload`.
- `GET /api/settings/providers/<id>/models` lists the models the token actually serves —
  the default gpt-5.4 may not exist on the token; pick a served one (e.g. gpt-5.6-sol)
  and a served image model (e.g. gpt-image-2.5, not flux-schnell if that group is off).
- Canvas budget + loop-guard `runSigs` are per-turn: identical-params repeats only count
  within one turn, and *failed* generations still consume the execution budget.
- `create_storyboard_pipeline(asProposal)` lays ghosts without executing; its budget
  gate only fires via `autoRunFirstScene` (weight 1 — needs count≥4 already to trip).
- The renderer canvas stream tails from the snapshot's liveRevision — a `proposal_created`
  broadcast emitted while no client is attached is never replayed to the review bar.
- Pressing Enter while a composer action button (e.g. the 🎬 director toggle) still has
  focus re-activates the button — click the textarea before Enter-to-send.
- Fixtures: `POST /api/sessions` creates a session; `GET /api/canvas/<sessionId>` dumps
  node runState/assets — use it to verify generations landed instead of pixel-peeping.

## Canvas image-node testing

- One `.node-edit-toolbar` exists per mounted image node — pick the one with
  computed `opacity: '1'` (the hovered/selected node's). Toolbar buttons follow
  the node, so DOM `.click()` on the visible toolbar is more reliable than
  screen coordinates; the same handlers still run.
- Canvas viewport persists in `localStorage["reizo:canvas-viewport:<sessionId>"]`
  — a stale viewport can render ZERO nodes after reload
  (`onlyRenderVisibleElements` culls everything off-screen). Clear the key or
  use 适应全景/F; `0` `.react-flow__node` elements ≠ missing data — check
  `/api/canvas` fetches and the canvas stream instead.
- Canvas assets live on disk at `<userData>/data/canvas/<canvasId>/<file>` —
  verify derived pixels directly with PIL (diff vs expected transform, check
  alpha channel for matting) instead of eyeballing screenshots.
- Local matting: `/api/matting/model` downloads u2netp.onnx from GitHub
  release-assets and caches to `<userData>/data/models/`; wasm binaries come
  from `/api/matting/ort/*` (served out of node_modules). First run pays the
  ~4.7MB download once; watch devtools network to confirm the local path ran
  instead of the AI fallback (seconds, not a model job).
