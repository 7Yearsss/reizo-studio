# Video editor acceptance

The four requested outcomes are one delivery goal. Do not treat the existing
development integration or a passing unit test as acceptance of the whole goal.
No video-generation API is part of this work.

## Latest acceptance status (2026-10-15, visual source selection and rough cut)

This summary supersedes the in-progress statements in the chronological evidence below.

| Outcome | Current evidence |
| --- | --- |
| Agent editing loop | Actual `gpt-6-astra` first-request composition passes after the asset-discovery fix. Three local revisions preserve all unrelated fields; review, apply, atomic undo/redo, rejection and a 28-second export pass. A development hot reload interrupted the third review; checkpoint recovery was verified with one continuation. |
| Draft confirmation | Standalone “应用这一版” now runs locally without a model request; measured about 0.35 seconds. Exact proposal application, one-step undo/redo and duplicate prevention pass. Earlier opt-in automatic title revision and preference persistence/isolation also pass. |
| Standard edit roundtrips | Real GPT-6 Astra title-only change uses exactly prepare → refine → review (three tool calls), including actual preview images. Complete document comparison confirms no unrelated changes. |
| Visual source selection | GPT-6 Astra compares both synthetic candidate videos through actual source contact sheets, chooses the simpler image for a quiet opening, and creates a separate six-second draft with visual reasons and timestamps. Exact project comparisons and undo/redo pass. One provider timeout requires automatic retry; this is sampled visual selection, not speech/motion analysis or real-footage quality acceptance. |
| Durable exports | Completion, cancellation, failure/retry, closed-panel delivery and process recovery pass with one saved output asset. |
| Long-video performance | Ten-minute source tested with cached 540p previews, measured seek/zoom, cache invalidation and original-source export. |
| Standalone installer | Final full make exits 0; its installed copy passes import/edit/preview/export/reopen and unattended full-process restart with all 14 development probes inaccessible. |

All four specified functional acceptance scenarios are now complete. The user
configured the Reizo provider with `gpt-6-astra`; real chat calls succeeded. The
initial acceptance needed a clarification about the editor media pool. The later
asset-discovery follow-up below fixes that guidance and passes one fresh first-turn
regression without clarification or direct substitution of model tool calls.
This is one successful synthetic-fixture regression, not a reliability rate across
models or creative-quality acceptance on production footage. The follow-up is in
development source; the previously accepted installer has not been rebuilt with it.

## 1. Agent editing loop

- Natural-language requests can produce an ordered, trimmed composition from exact
  existing media IDs, with an aspect ratio, title, timed captions and background music.
- Validate source ranges and total duration before editing. Do not invent transcripts
  or silently substitute another media version. Missing input is reported explicitly.
- Changes default to a manual-review draft, with conversational confirmation and optional
  host-controlled automatic application. Show a concrete change summary and rendered
  keyframes; allow refinement, application, rejection and one-step undo.
- Accept with a real 30-second vertical composition containing multiple source shots,
  a title, supplied captions and music; verify preview, apply, undo and rejection.
- Test the registered tool path as well as real MCP/editor behavior. Model-assisted
  natural-language acceptance is separate from deterministic tool execution.

## 2. Export tasks and recovery

- Durable, conversation-scoped tasks expose progress, cancellation, failure and retry.
- Switching conversation or closing the panel cannot silently lose the task or output.
- Restart during rendering/delivery yields a recoverable interrupted task or reconciles
  a completed output; never report saved before the host has committed it.
- Accept normal completion, cancel, forced failure/retry, panel close, conversation
  switch and process restart, with no duplicate output assets.

## 3. Long-video performance

- Use cached low-resolution previews and retain the immutable original for final export.
- Bound thumbnail/waveform work and keep timeline zoom/seek responsive.
- Accept with a representative long video; measure first preview, repeat load, seek and
  zoom behavior. Verify original-source export and cache reuse/invalidation.

## 4. Standalone Windows installer

- Compile and bundle the editor server/UI, Node, FFmpeg, render browser and bundle.
- Runtime must not depend on a development checkout, source node_modules or .cache.
- Include required upstream notices and corresponding integration source.
- Produce an actual Windows installer and verify an installed copy using isolated data
  with development paths unavailable: import, edit, preview, export and reopen.

## Evidence / current state

- Existing baseline: docs/openchatcut-integration.md records the 2026-10-14 development
  checks. Those do not prove the four outcomes above.
- 2026-10-15: acceptance requirements recorded; implementation and final acceptance
  remain in progress. Append measured evidence as each requirement is verified.

### 2026-10-15: composition implementation and tool-path acceptance

- Added `video_editor_compose`, source/length/caption validation, vertical typography,
  explicit caption provenance, independent draft sequence construction and actual
  rendered keyframes. The model must inspect frames before submitting manual review.
- Added a persistent latest draft preview and plan, conversation-scoped image routes
  and a chat preview card. Snapshots explicitly do not claim current applied status.
- Real registered-tool test: `.cache/video-editor-qa/composition-roundtrip.ts` with
  isolated data, two 12-second video fixtures and a 35-second audio fixture. Output is
  exactly 900 frames at 30 fps, 1080×1920, 3 shots + title + 3 caption clips + music.
  The browser verifies draft isolation, application, one-step undo, and rejection of
  a revised composition. Contact sheet: `composition-contact-0.jpg`; screenshots:
  `composition-review.png`, `composition-applied.png`; result: `composition-result.json`.
  Final run also deliberately forces one Begin revision-precondition rejection after
  Undo, then verifies reconciliation and successful creation/rejection of the next
  composition. The process exits 0 with all four real-editor assertions passing.
- Fixed Apply/status-read race without weakening mutation guards. Fresh Begin now
  synchronizes the browser revision; a precondition-rejected Begin can be retried once
  only after reconciliation proves no active draft exists. No edit/transport retry.
- Focused baseline plus new compiler/store/route tests: 31 passed. Additional preview
  renderer tests: 2 passed. Reizo and upstream frontend TypeScript passed; focused lint
  passed. Removed the unsupported Forge signing property that previously blocked tsc.
- Natural-language acceptance is still unverified: the running Reizo public settings
  show no configured chat-provider key. No paid model or video API has been called.
- Still required: export this complete composition and inspect the resulting video;
  verify natural-language planning with a configured chat model; implement/accept
  durable export management, long-video performance and a standalone Windows installer.

### Next implementation entry points

- Both UI and Agent exports use upstream `src/export/renderJobClient.ts`. A durable
  host-owned submission/monitor/delivery path can cover both; merely persisting the
  current activity ring cannot survive panel close. Upstream already has server job
  persistence and export-recovery leases, which should be reused where applicable.
- `desktop/embedded-server.ts` supplies a production HTTP server without a Vite runtime.
  Bundle that server and built UI/resources for the installer; current Reizo launch
  still uses the source checkout. Packaging acceptance has not started.

### 2026-10-15: durable export implementation and real closed-page delivery

- Added host-owned durable export recipes and task receipts, session-scoped HTTP routes,
  progress/cancel/retry controls in the chat card, and startup reconciliation independent
  of an editor iframe. Only a committed Reizo asset makes the host snapshot succeeded.
- Both upstream UI and Agent render clients now submit/poll/cancel through the authenticated
  host bridge. Embedded video exports use the server renderer; observer failures do not
  automatically cancel accepted host jobs. Engine HTTP requests use the required loopback
  Origin and Sec-Fetch-Site headers. No runtime token enters the iframe.
- Acceptance precedes engine submission. Lost submission replies reconcile the same UUID;
  retry uses a durable child identity and checks interrupted jobs before rerendering.
  Delivery reuses the transactional content-hash receipt, including recovery after the
  asset commit but before the task's saved receipt. Missing output files allow a new render.
- Tests cover acceptance deduplication and ownership, no premature success, cancellation
  during submission, failure/retry, restarted host monitoring, interrupted engine status,
  repeated delivery after commit, expired output, real HTTP request shape and UI controls.
- Real `.cache/video-editor-qa/durable-export-roundtrip.ts` rebuilds/applies the 30-second
  composition, calls the actual Agent `submit_render_job` with manual confirmation, then
  closes the browser page. Job `4c79f2f4-4bcd-4597-81bb-bd9fdd5feca5` completed and saved
  asset `KpWPiQ2-4_ipEYTB58mn4` (5,976,497 bytes) without the editor page. This uses an
  isolated host/bridge harness, not the full Reizo desktop conversation-switch UI.
- A separate real delivery recovery reused job `c0b42cd7-232d-43a1-875e-9280ad087e2d`
  after restarting the host/engine, without resubmitting its render. The initial save
  failure was a test-fixture missing session row (foreign-key rejection); the fixture
  was corrected before recovery and the subsequent normal run. Logs and result JSON
  are under `.cache/video-editor-qa/durable-export-*`.
- The recovered MP4 decodes all 900 frames plus stereo audio, at 720×1280 / 30 fps.
  Title/captions are readable. Visual inspection found upstream checkerboard background
  baked into letterboxed final video: `TimelineComposition.tsx` uses GRID for opaque
  rendering. Fix export background and rebuild/invalidate cached render bundles before
  final visual acceptance. This is a remaining defect, not an accepted styling choice.
- Still required for goal 2: full desktop UI export, conversation switch, real cancel,
  render-time process termination and retry, and final integrated task-card inspection.
  Long-video performance, standalone installer, and real model planning remain pending.
- API smoke testing exposed a Windows TEMP 8.3-alias assertion mismatch; its expected
  root now uses canonical realpath, matching the workspace resolver. API smoke passes.
- Final focused suite: 34 tests across eight files passed. Reizo and adapted upstream
  TypeScript checks passed; focused ESLint passed without warnings. Normal-run MP4 also
  decoded all 900 frames and audio successfully (`durable-export-normal-decode.log`).

### 2026-10-15: export background, process restart and desktop conversation switch

- Fixed the opaque composition background to black during server/browser rendering;
  live preview retains the checkerboard. Render bundles now have content fingerprints,
  marker validation and private versioned runtime copies, preventing reuse of old code.
- `export-restart-roundtrip.ts` terminates the isolated render engine process tree after
  rendering begins, restarts the host/engine, observes interrupted status, retries,
  cancels the real retry, then retries again. Final job
  `95c3744e-d023-4fb5-9f41-b1db84f3e52b` saved exactly one new output asset
  `VZoeQ0O8fbj2zsqs3M_Dd`. Cancellation produced no output asset.
- The resulting MP4 decodes 900 frames plus audio at 720×1280. Inspected
  `export-black-background.png`: black letterbox, readable title/captions, no checkerboard.
  Evidence: `.cache/video-editor-qa/export-restart-result.json` and associated logs.
- Actual desktop UI test `desktop-export-switch.mjs` submits from the export dialog,
  switches to another conversation, closes the panel, waits for the original task,
  verifies it is absent from the other conversation, and returns to the original.
  Job `7267164a-15b9-406f-9020-24cd970ad988` saved asset `gLADX44gjI5utLBGYLBzt`
  exactly once (2,295,388 bytes). Evidence: `desktop-export-result.json` and screenshot.
- These results supersede the earlier pending goal-2 checks above. The complete
  four-part delivery is still not accepted.

### 2026-10-15: long-video and packaging work in progress

- Embedded preview defaults to auto, while preserving explicit user preferences.
  Long/high-resolution sources use a cached aspect-preserving 960×540 H.264 proxy;
  preview transform version and source fingerprint invalidate previous derivatives.
- Synthetic 600-second 1920×1080 fixture: 173,184,719 bytes, repeated 12-second test
  pattern with audio. Measured cold import 12.99–13.47 s, subsequent proxy wait
  37.17–42.14 s, warm metadata/proxy request 103–108 ms. These are local fixture
  measurements, not claims about all videos or hardware.
- Long-video acceptance is NOT passed: the harness observes an empty Agent media pool
  after previously observing a persisted imported source. Investigating browser/project
  state before trusting timeline-seek, zoom, reopen and original-source export results.
- Added production server/UI resource build and relative packaged runtime manifests;
  installed launch never falls back to the development checkout. Manifest relocation,
  traversal rejection and missing-resource behavior have focused tests. Actual packaged
  runtime launch, corresponding source bundle, Windows installer and installed-copy
  acceptance remain pending.

### 2026-10-15: long-import failure isolated and compiled runtime started

- The apparent disappearing asset was a failed import, not a silent Agent mutation:
  post-upload compatibility normalization failed in QSV/CPU filter negotiation and
  removed its placeholder. The old harness also waited for three dots instead of the
  actual Unicode ellipsis in the busy label. It now waits for `.cc-media-status` to
  disappear and asserts no `.cc-media-error` before reading the persistent source.
- Embedded imports now keep the uploaded master unchanged; independent preview proxies
  supply browser compatibility. This avoids replacing a source while its preview is
  being generated. The isolated 10-minute source now survives panel/page reopening with
  the same asset ID. Final original hash/export verification remains part of the harness.
- Also fixed the upstream compatibility encoder fallback: decoder arguments are chosen
  for each encoder attempt, so falling back to libx264 does not retain QSV/CUDA input
  frames. `normalize-fallback.ts` genuinely observes a QSV failure, then HTTP 200 from
  software normalization of a two-second fixture (`normalize-fallback.log`).
- Audio padding exposed 12,021 waveform points despite the nominal 12,000-bin budget.
  Allocation now uses ceiling and a hard bounded tail accumulator; transform cache v2
  invalidates old peaks. The actual fixture yields 11,991 points; filmstrip is 2028×44.
- Preview uses `@remotion/media` canvas, not a visible `<video>` element. The harness now
  verifies actual proxy-file network requests and a visible 960×540 canvas separately
  from decoder timing. Five independent proxy seeks: 48.2, 24.9, 17.5, 31.7, 49.6 ms.
  Initial real timeline seeks took 76 and 56 ms; the third harness click was outside
  the viewport due to the full scrollable ruler width. Corrected to visible geometry;
  the complete seek/zoom/export/invalidation run is still pending.
- `packaged-runtime-smoke.ts` uses the production relative manifest, bundled Node and
  compiled server/UI, a private writable cwd, and no Vite server. It creates a project
  through MCP and serves compiled HTML: startup 76,407 ms including the first private
  render-resource copy. This does NOT yet prove an installed desktop copy works.
- Production staging now includes dependency license inventory and corresponding source
  ZIP with rebuild instructions. Windows large-directory publication failed with EPERM;
  the builder now leaves immutable version directories in place and publishes a small
  pointer for Forge to copy under `resources/video-editor`. Final build/installer pending.
- Focused suite: 37 tests across nine files pass. Reizo and upstream frontend TypeScript
  checks pass; focused ESLint passes. No configured chat-provider key was found via the
  running app's public settings. User was asked to configure a chat model for the separate
  natural-language acceptance; independent packaging/performance work continues.

### 2026-10-15: derivative reconnection fix and long-timeline interaction evidence

- Reproduced a real cancellation/reconnection defect in the derivative queue: a new
  consumer inherited an already-aborted running job. New acquisitions now replace
  aborted jobs; a separate in-flight barrier serializes same-source cache writers,
  including when an intermediate queued replacement is itself cancelled.
- `node integrations/openchatcut/derivative-reconnect.verify.mjs` failed before the
  patch and now passes for concurrency 1/2, shared replacement consumers and queued
  cancellation. The patch is version-checked and reapplied by setup-openchatcut.mjs.
- Reopened actual 600-second project: no failed-preview badge, actual player fetched
  the 960×540 proxy. Decoder seeks: 46.6, 25, 17.8, 20.3, 17 ms. Actual timeline seeks:
  81, 60, 111, 100, 90 ms; zoom interactions: 97, 83, 86, 82, 73 ms. Measurements were
  taken while a resource build ran concurrently; they are local fixture evidence.
- Original-source export and post-modification cache invalidation are still running;
  these interaction results alone do not accept the entire long-video requirement.
- A setup invocation accidentally ran npm ci against live upstream dependencies and
  failed on a locked sqlite-vec DLL. Restored the exact lockfile dependencies into a
  fresh dependency directory, switched only the node_modules junction, then reran
  setup with --skip-install successfully. No project media or application data removed.
- npm run make is now exercising the normal Forge path. Its terminal result and
  installed-copy acceptance are still required. Public Reizo settings continue to
  report no configured chat-provider keys; real model acceptance remains pending.

### 2026-10-15: long-video complete runs and installer build memory limit

- Warm/reopened project run exited 0: exported original-source window 300–302 s as
  1920×1080 H.264, job `57ed33eb-6f55-4524-9759-74d428f68df6`, saved host asset
  `2VRJHFFXHATHk8PW4eTPE` (1,301,936 bytes). Export decoded without FFmpeg errors;
  `long-export-frame.png` visually shows the expected pattern, no missing/black image.
- Uploaded master SHA-256 remained identical after export. Touching only this isolated
  fixture's mtime expired its old proxy URL (404); regeneration returned a new URL.
  Waveform: 11,991 peaks; filmstrip: 2028×44. No failed preview requests in this run.
  Evidence: `.cache/video-editor-qa/long-preview-warm-result.json` and `long-preview.png`.
- Fresh project `2fac8acb-5810-4418-97b7-070b32f1f0c7` also passed the entire harness:
  import 21,053 ms; additional proxy wait 46,376 ms; warm proxy request 104 ms;
  timeline seeks 118/99/102/534/93 ms; zoom 95/102/86/85/84 ms. The 127,233 ms first
  player request includes the harness's draft composition/keyframe/review work before
  Apply, so it is not a pure proxy-generation or ordinary first-preview latency.
  Export job `4375674f-8726-4716-b468-86a4bc16fb83` saved asset `xhqfGqhWepdjbSVNOCdjV`;
  same hash/invalidation checks passed and no failed preview requests were observed.
  Evidence: `long-preview-result.json` and `long-preview-cold.log` (exit 0).
- Latest focused suite: 37 tests in nine files passed. Host and upstream frontend
  TypeScript checks passed. The queue verifier separately covers the cancellation race.
- Normal Forge make reached host bundling but hit Node's default ~4 GiB heap limit.
  Forge Vite concurrency is now one. A serial build with an 8 GiB heap is running;
  do not count resource preparation or this in-progress build as installer acceptance.
- Verified the actual Electron binary honors an absolute --user-data-dir before app
  startup; isolated installed-copy testing can avoid the user's existing data profile.

### 2026-10-15: packaged desktop preflight exposed two release defects

- Serial 8 GiB build completed production compilation and Electron packaging, but
  Squirrel/NuGet failed on a path exceeding its 260-character Windows limit. The
  longest packaged relative path was 198 characters, in an AI SDK authoring tree.
  Make/package now use a heap-configuring launcher and checkout-local temporary
  directories. Runtime packaging omits declaration/source-map files and AI SDK src
  trees only where the package exposes compiled dist entries. Runtime JS, binaries,
  assets and license notices remain included. A fresh normal npm run make is running.
- Actual packaged desktop preflight used an isolated profile and compiled file-based
  host/editor UI: import, duplicate clip, undo, redo and proxy preview passed. Export
  failed on Remotion's 25-second browser startup timeout. The browser was spawned at
  02:25:10 and wrote DevToolsActivePort at 02:25:41, after the task had already failed.
  This is a failed preflight, NOT installed-copy acceptance.
- Remotion 4.0.509's compatibility patch now allows 90 seconds for Windows browser
  startup and terminates the spawned process tree if startup fails. The patch is
  version-checked, idempotent and included in setup/build and corresponding source.
  `browser-startup.verify.mjs` reproduces the leaked process before the patch and
  passes after it; the verifier uses the real runner and a non-ready child process.
- Electron's disabled nodeOptions fuse ignored the attempted permission guard, so
  that preflight does NOT prove development-directory isolation. No guard receipt
  was generated. The final installed test still needs an effective isolation method.
- The isolated preflight app and its leaked browser process tree were stopped after
  failure. The user's existing installation and data were not replaced. Installer
  testing is prepared under F:/selfProject/reizo-video-acceptance, with backups of
  the existing uninstall registration and desktop shortcut for restoration.

### 2026-10-15: packaging filesystem isolation and remaining acceptance

- The next build failed before resource copying: Electron Packager could not rename
  its extracted template directory on F:. A minimal fresh directory containing one
  copied Node executable reproduces EPERM on F:, while the same probe passes on C:.
  .NET Directory.Move also fails for the F: probe. This rules out application media,
  render tasks and the large resource tree as prerequisites for this failure.
- The Forge launcher now uses a short system-temp subdirectory, with the existing
  REIZO_BUILD_TEMP override; removed the checkout-local Packager temp override.
  Compilation passed again and packaging is running. A terminal make result is
  still required; this is not installer acceptance yet.
- The current resource manifest is build
  `771df95c903b80d9bf710e778837dd979da73957451e37f756d8f6de9dc73a8b`.
  Verified 401 dependency inventory entries and 4,179 corresponding-source archive
  entries, including upstream LICENSE, the renderer compatibility patch, build
  launcher and REBUILD.txt, with no .cache/node_modules/.env entries in that archive.
- An isolated ACL probe proves denied read access and successful permission restore.
  Prepared an installed-copy test that temporarily denies development inputs, checks
  actual EACCES/EPERM from the bundled Node, runs the editor roundtrip and full process
  restart, then restores ACLs in finally. This test has not run against an installation.
- Added full 30-second 1080x1920 composition export to the real tool/UI acceptance
  harness, before undo/rejection checks. The run is in progress. Public settings still
  report no configured chat-model key; real natural-language acceptance is pending.

- The system-temp build exposed another reproducible packaging issue in Forge
  7.11.2: fast-glob receives a Windows backslash pattern and derives base `.` instead
  of the packaged app directory. Its independent probe also remained running while
  scanning the large checkout. Stopped that diagnostic and the identified make
  process after confirming the cause. A version-checked launcher patch scopes the
  relative `.bin` glob via cwd/absolute; the real fixture match completes in 28 ms.
  A new normal make is running. TypeScript check passed (exit 0).
- The first new composition run timed out before keyframe rendering returned;
  it does not count as acceptance. Added per-tool timing to the QA harness. The
  rerun has rendered keyframes in 15,215 ms, applied the draft and started the full
  video export; terminal export and post-export edit assertions are still pending.

- The instrumented composition rerun exited 0. Full export job
  `53a6c109-3fd6-489e-b32e-f2db6c0ab82b` saved asset `kUNWCkHkb1tE0FFDPrqeo`:
  30 seconds, 1080x1920, H.264, 8,550,946 bytes. Full FFmpeg decode passed.
  Extracted frames at 2/15/25 s show the correct ordered shots and supplied Chinese
  captions, with the title present at 2 s. Audio has 2,885,632 decoded samples,
  mean -38.4 dB / max -35.2 dB for the deliberately quiet synthetic music fixture.
  One-step undo and a revised-title draft rejection both pass after export.
  Evidence: composition-export-result.json, composition-export-roundtrip-2.log,
  composition-export-{2,15,25}.png and composition-audio-check.log under QA cache.
  This closes the deterministic composition export gap; real model acceptance
  remains separate and unverified.

- The scoped-glob build completed Electron packaging. NuGet produced an
  885,915,630-byte nupkg, then Squirrel failed because vendor/7z.exe and 7z.dll
  had never been initialized in the current dependency installation. The shipped
  architecture-suffixed binaries were present. Ran the dependency's own
  script/select-7z-arch.js successfully and verified 7z.exe launches. Its `os.arch`
  coercion is valid on this Node runtime; this was not a broken publisher script.
- Resumed installer creation with `npm run make -- --skip-package` after confirming
  the packaged runtime's code/source fingerprint is still current. Build ID:
  `45ddf1b40754dfcfb27c8dc26ee75faeb7f4dd13232aefa9e158826147989c7f`.
  The complete packaged tree contains 13,266 files / 1,963,595,349 bytes; the
  longest planned isolated-install path is 232 characters. Installer result pending.
- A separate current packaged-desktop preflight passed with no page errors:
  import, duplicate clip, undo, redo, actual proxy playback, export, asset delivery,
  panel close/reopen. Export `fa9943dc-c864-4525-87f7-d61e7403c6b4` saved asset
  `DwUjiuL0e5Ew0bhOEx0Pk` (2,702,013 bytes). Evidence is
  F:/selfProject/reizo-video-acceptance/packaged-fixed-result.json. This proves the
  repaired browser/pruned runtime works in the packaged app, not installation or
  development-path isolation. The owned preflight process tree was stopped after
  completion. An initial combined launch/test/cleanup command was auto-review
  rejected without a detailed reason; separate, identity-checked steps succeeded.

- The resumed installer build completed compression but failed when Squirrel's
  bundled x86 rcedit tried to set version resources on the 864,807,936-byte Setup.exe.
  Small executable probes succeed on both F: and C:. The same large executable
  fails with that old editor on both volumes, so this is separate from the F:
  directory-rename issue. The official rcedit 5.0.2 tarball was integrity-verified;
  its x64 binary succeeds on the same large file. FileVersion/ProductVersion both
  read back as 0.1.0. Evidence: large-installer-resource-edit.json in QA cache.
- Pinned rcedit 5.0.2 as a dev dependency, retaining all preexisting lock entries
  and adding only its five-package closure (92 added lines). The make launcher now
  prepares the architecture-correct 7-Zip pair and replaces Squirrel's resource
  editor with the pinned x64 binary. Preparation is version-checked/idempotent;
  module resolution and the actual large-file metadata regression pass. No runtime
  application code changed in this repair. A new full make is required so the
  bundled corresponding source contains the final build fix.

- A fresh isolated `npm ci --dry-run --ignore-scripts --offline --no-audit --no-fund`
  validates the final lockfile (exit 0, 2,018-package plan, no node_modules created).
  The new full make's runtime build ID is
  `14af0ac436cf0aa3cd01e2ca1fa6f04280af8cde016c814a93d5f576a6e553f0`.
  Compared archived package.json/package-lock.json and both Forge launcher/patch
  scripts byte-for-byte with the working files: all match. Build is still running.
  Public development settings still have no configured chat-provider key; active
  development export count is zero at the latest pre-isolation check.

### 2026-10-15: exact source-frame check and installer retry

- Investigated an apparent one-second shift in the third shot. Extracting output
  frame 750 exactly, and enlarging its baked-in counter, shows source frame 150 /
  00:00:05.000 as requested. The small preview had made the digit ambiguous.
- `verify-composition-source-frames.mjs` compares exported picture regions with
  decoded originals: output frame 60 matches source A frame 90 (SSIM 0.978219),
  and output frame 750 matches reused source A frame 150 (0.977781). Deliberately
  comparing one second later drops similarity to 0.865382 / 0.849736. Source B
  selection also matches (0.997879), but B is static, so that sample cannot verify
  its trim time. Evidence: `composition-source-frame-result.json` and
  `composition-frame750-counter.png` in the QA cache. No runtime change was needed.
- The full build reached Squirrel release extraction, then failed with
  `WriteEntryTo or OpenEntryStream can only be called once`. This masks the initial
  extraction error; low C: space is a possibility, not a confirmed cause. The
  resulting input nupkg passes a complete 7-Zip integrity test (13,729 files,
  1,945,074,751 uncompressed bytes). A large diagnostic copy was moved to the
  external QA backup directory to recover space. A normal `make -- --skip-package`
  retry is in progress using the unchanged, fingerprint-verified packaged tree.

### 2026-10-15: installed-copy isolation acceptance and build finalization

- Squirrel extraction passed on retry, but its final resource write still failed,
  despite verifying the pinned x64 editor's hash. After the failed make process
  cleaned its temporary application copy, the exact resource command succeeded on
  the same Setup.exe. Both version fields read back as 0.1.0. This establishes a
  recoverable finalization failure, not its underlying OS cause.
- That finalized installer installed successfully into the isolated
  `C:/Users/PC-20251213/AppData/Local/ReizoQA/reizo_studio` directory. The original
  application's executable hash is unchanged. Its uninstall registration and
  desktop shortcut again point to the original `0.1.0-main2` installation.
- Installed build `14af0ac436cf0aa3cd01e2ca1fa6f04280af8cde016c814a93d5f576a6e553f0`
  passes import, duplicate, undo/redo, real proxy preview, export, panel reopen and
  full process restart with development inputs inaccessible. Four development roots
  were denied access; all 14 known-existing probes, including runtime dependencies
  and MSIX aliases, returned EPERM/EACCES before and after the test. The running
  executable, Node and renderer resources came from the installed directory.
- Export `aeabfe70-afcd-4db1-b11e-b5bc0ba29048` saved exactly one asset
  `mRs69L2CYUVme41OIJMy7`, 2,702,013 bytes. Bundled FFmpeg fully decodes the MP4;
  FFprobe reports 1920x1080, 132 frames / 4.4 seconds. An inspected frame shows the
  expected test pattern. Restart retains project
  `6c9e26ca-aede-49be-9023-54cd20e7fb3d`, two clips, the same task and one saved asset.
- The first restart harness did not expand the panel through its menu action.
  An explicit UI click on the saved-task card's Open editor button reopened it,
  after which the pending assertions passed. This was assisted UI acceptance.
  A supplementary fresh restart using that entry point passed unattended and
  verified an actual 206 proxy response, visible video and timeline thumbnails.
  The supplementary preview run occurred during permission restoration, so it is
  not represented as another fully isolated run.
- Restored every development root's exact original security descriptor and verified
  all 14 inputs readable. The first string comparison caught a root DACL
  auto-inheritance flag added by Set-Acl; all access entries were already restored.
  Restored that root's original control flag without recursively changing child
  permissions again, then verified all four descriptors exactly. The development
  app was restarted. Evidence: `development-restored.json` and the preserved first
  mismatch report in the external QA directory.
- Installed resources include Node, FFmpeg, browser, compiled UI/server/render bundle,
  401 dependency inventory entries and 4,180 corresponding-source archive entries.
  All installation, UI, restart, process-path and resource evidence is under
  `F:/selfProject/reizo-video-acceptance`; see `installed-acceptance-notes.json` for
  precise scope and limitations.
- Added a default Squirrel maker recovery limited to this exact final resource-write
  failure. It runs only after base-maker staging cleanup, verifies RELEASES size and
  SHA-1, retries with pinned x64 rcedit, reads both versions back and returns normal
  Forge artifacts/hooks. Other errors, custom/signing configurations and corrupt
  archives are not converted to success. Two guard tests and focused lint pass;
  the real 865 MB finalization replay passes. The resource editor rewrites bytes,
  so do not infer binary identity from equal version strings.
- At that stage, a fresh full make including the final build fix was still required.
  The following final-build acceptance closes that packaging gap. Real chat-model
  natural-language acceptance remains separate.

### 2026-10-15: final installer and unattended isolated acceptance

- Full `npm run make` exits 0 with `SQUIRREL_TEMP` explicitly set to
  `F:/selfProject/reizo-video-acceptance/squirrel-build-temp`. The guarded resource
  recovery actually executes and Forge completes its postMake hook. TypeScript,
  focused lint and the two resource-recovery guard tests pass.
- Final artifact: `out/make/squirrel.windows/x64/Reizo Studio-0.1.0 Setup.exe`,
  864,853,504 bytes, SHA-256
  `a17050a431334f9d1739e3c6e1a29366c1744aaf629b955f1199d40406cfaf7d`.
  Runtime build ID:
  `113709705234ac2661764b605f8036efd78fe0a03022fcc12808be3e93789836`.
  The corresponding-source archive contains the final maker, Forge configuration
  and guard tests, verified against their working files.
- Final installer exits 0 into the separate `ReizoFinalQA/reizo_studio` installation.
  Original user executable hash remains unchanged; registration and shortcuts are
  restored to the original installation.
- The final installed copy passes actual UI import, duplicate, undo/redo, real 206
  proxy playback, export, panel close/reopen and unattended full-process restart.
  Four development roots are inaccessible throughout: all 14 known-existing file
  probes return access-denied errors before and after the operation tests. Runtime
  hashes are checked against evidence saved before isolating development paths.
- Project `1244a251-4e54-444c-8b9e-c4936f5c93d2` retains two clips after restart.
  Export task `0a09b9db-bad3-4f78-b350-25c0f59289f1` saves exactly one asset,
  `yL8RXv5datmtrQI0g_wIz`. Bundled FFmpeg fully decodes the output; an inspected
  extracted frame shows the expected source pattern. No renderer page errors were
  captured. This is a synthetic-fixture functionality test, not creative-quality
  acceptance with a model or representative production footage.
- The isolation wrapper exits 0. All four original security descriptors match
  exactly, all 14 files are readable again, and the development launcher restarts.
  Evidence under `F:/selfProject/reizo-video-acceptance/final/` includes
  `final-acceptance-result.json`, `installed-editor-result.json`,
  `installed-restart-result.json`, `development-isolation-result.json`,
  `development-restored.json`, `isolated-acceptance.log` and screenshots.

### 2026-10-15: actual gpt-6-astra chat acceptance

- Public settings confirmed provider `reizo`, model `gpt-6-astra`, `hasKey: true`.
  Sent the prepared natural-language request through the actual Reizo chat UI in
  isolated conversation `QPGgRZQ6yTrPQUVC1CW3B`, project
  `d062a568-cd7e-4126-972b-0a885d952650`. Three fixture files were imported through
  the editor file picker. No image/video generation API was used.
- First turn (22.4 seconds) incorrectly reported missing files after checking only
  `video_editor_media` and the tool catalog. The complete catalog did include
  `read_project`; it was not a catalog truncation problem. Persisted project data
  verified all three files present with full source identities. Clarifying that the
  files were imported into the editor media pool made the model begin a manual edit
  session, read the project, compose, render frames and submit review (183 seconds).
  This is an assisted natural-language acceptance, not a first-prompt success.
- Before Apply, the persisted live project remained its original empty timeline.
  The model's full shot plan exactly matches source A 1–11 seconds, source B 2–12,
  source A 0–10, in that order. Title/caption strings and timing, contain fit, muted
  source audio, music source offset, volume and fades match the request. The model
  also called `view_timeline_frames` and accurately stated that the draft was not
  applied. Applied through the review UI, then checked the actual persisted timeline:
  1080x1920, 30 fps, 900 frames, 3 video clips, 4 text clips and one audio clip.
- Actual UI export task `c363d4ad-c992-4e5b-90e1-86ef9fd0b19b` saved one asset,
  `3AtU1oXyBc4ZxSgBkLTRi`, 8,550,946 bytes. Full FFmpeg decode passes. The video
  stream is 30.000 seconds / 900 frames; AAC/container duration is 30.058667 seconds.
  Export frame 60 matches source A frame 90 (SSIM 0.978219), and frame 750 matches
  source A frame 150 (0.977781); deliberate one-second offsets score 0.865382 and
  0.849736. Static source B matches 0.997879 but cannot prove its temporal offset.
  Inspected rendered title/caption frames. Built-in static-scene QA flags the
  deliberately static B fixture; those warnings do not represent production-footage
  quality acceptance.
- A second real request, "只把标题改为‘故事，从这里开始’，其他保持不变，先给我确认草稿",
  finishes in 71.9 seconds. The model initially attempts a read without a new edit
  session, receives an error, then opens a manual session and recovers. The saved
  proposal contains exactly one `update_item_props` operation. Its resulting items
  equal the applied timeline except for the title text; all other item properties,
  dimensions, fps and tracks match. A new actual rendered preview shows the revised
  title. No composition rebuild or incidental changes were needed.
- Clicking Reject preserves the entire applied project exactly. One Undo restores
  the entire original project exactly. Redo then restores the accepted composition
  for user inspection; the title revision remains rejected and the single saved
  export remains available in the workbench's 剪辑成片 folder.
- Evidence: `F:/selfProject/reizo-video-acceptance/model/acceptance-result.json`,
  `session-transcript.json`, `project-verification.json`, `export-verification.json`,
  `refinement-verification.json`, persisted before/after projects and preview images.
  The external QA driver performs UI actions and reads project snapshots; it does
  not author the composition/refinement by invoking editor tools itself. No product
  source code was changed in this run, and no package rebuild was necessary.

### 2026-10-15: first-request editor asset discovery

- Clarified the Agent tool descriptions: workbench canvas assets, editor media-pool
  assets and the current selection are different scopes. `video_editor_media` list
  now returns `scope: workbench`, the existing `assets` array, and an explicit
  `editorMediaPool.status: not_inspected` with the next discovery step. An empty
  workbench list no longer implies missing editor assets. Listing does not silently
  open the editor, start a draft or import files; exact existing identities remain
  unchanged. Follow-up reads are also documented to require an active edit session.
- Added two regression tests covering an empty workbench and preservation of an
  exact existing asset version. They failed before the fix and pass after it. The
  focused tool/composition suite passes 7 tests; TypeScript and focused ESLint pass.
- Restarted the development app and sent the identical original request through
  its real chat UI with provider `reizo`, model `gpt-6-astra`. Fresh conversation:
  `tjipxWL_wGcBzq3N62zo0`; project: `a77a062d-7136-4e30-88db-f44943e3b9c5`.
  The three fixtures were imported only through the editor file picker. There was
  exactly one user request, no clarification and no workbench-to-editor reimport.
- The model discovered the tool schemas, opened a manual session, read the editor
  asset pool and source frames, composed, viewed actual rendered timeline frames,
  reread the draft, and submitted review. It completed in about 140 seconds with
  17 tool calls and no tool error results. No image/video generation API was used.
- Checked both the composition plan and the persisted proposal, not only the
  assistant's reply: 1080x1920 at 30 fps, 900 frames, eight items; exact A/B/A source
  ranges, immutable source IDs/hashes/revisions, title and caption text/timing,
  muted source audio, music offset/volume/fades all match. Inspected the rendered
  contact sheet. The original live timeline still has zero items and the proposal
  remains `awaiting_review` for inspection. This follow-up does not repeat export,
  application or installer acceptance already recorded above.
- Evidence: `F:/selfProject/reizo-video-acceptance/asset-discovery/` contains
  `acceptance-result.json`, `project-verification.json`, `session-transcript.json`,
  `chat-request-initial.json`, persisted draft/proposal/context and preview images.
  Product changes are limited to Agent tool guidance/list metadata and their tests;
  the prior accepted installer does not contain this follow-up.

### 2026-10-15: consecutive local revisions and linked timing

- Added `video_editor_refine` for text/font-size changes, absolute volume and tail
  shortening with linked timing. It reads exact current item IDs, compiles one
  atomic `edit_item` batch, preserves source identity and unspecified fields, and
  saves fresh rendered keyframes plus the change summary. Revision previews omit
  the initial composition plan so outdated durations are not presented as current.
- Added the connected-editor lifecycle tool `resume_edit_session`. It reopens the
  exact pending manual review by replaying captured actions against its original
  base, retaining IDs, all timelines, earlier changes and the single-undo boundary.
  Ownership, current live revision and pending-review status are checked. The old
  Apply action is removed before saving a drafting checkpoint; a save failure
  restores the pending review. Setup and packaged-resource preparation both apply
  the guarded integration overlay.
- Automatic shortening closes the removed tail interval across later items,
  clamps overlapping text, reports text removed entirely, and trims continuous
  full-length background music at the new end. Locked tracks, crossing partial
  audio, overlapping source shots, transitions, native caption tracks, affected
  keyframes/transcripts and retimed sources are rejected for explicit editing.
  This is not general-purpose synchronization of every advanced editor feature.
- Seventeen focused host tests pass, including seven new refinement tests;
  TypeScript and focused ESLint pass. The adapted upstream's existing external
  edit-session checks pass. A new verification reopens three serialized reviews,
  restores drafting checkpoints, checks exact IDs and replay, and rejects stale,
  terminal and non-manual sessions.
- Real provider `reizo` / `gpt-6-astra` acceptance reuses conversation
  `tjipxWL_wGcBzq3N62zo0`, project `a77a062d-7136-4e30-88db-f44943e3b9c5`.
  Its earlier composition had already been applied before this test began, so that
  exact live project was saved as the new baseline. Three requested changes:
  title font size 192 → 153.6; second shot 10 → 8 seconds with subsequent shot and
  third caption advanced by 60 frames, total length 900 → 840 frames and music
  trimmed to match; music volume 0.2 → 0.1. The model uses one fresh manual session
  (`36bcc9e7-2f7d-40db-bcee-340b4ac70c60`), then resumes it for later revisions.
- Complete persisted proposal comparisons pass after every round: eight item IDs,
  source IDs/hashes/revisions/windows and every unrequested property are unchanged.
  The shortened source window is the intended exception. The live project remains
  exactly equal to the baseline before Apply, and new rendered previews were
  inspected. Actual UI Apply matches replay of the complete proposal; one Undo
  restores the entire baseline exactly, and Redo restores the refined result.
- Acceptance interruption is preserved in the evidence: the first turn attempted
  an already-applied historical session and recovered by beginning a new one. A
  documentation edit triggered Vite page reload during round three, so its review
  call encountered a disconnected editor. The persisted drafting checkpoint already
  contained all three changes with the original live project untouched. One
  continuation reacquired the same session, reread/rendered/reviewed without
  repeating mutations; its initial unowned-session attempt was also rejected.
  This is a verified recovery, not an uninterrupted three-turn success claim.
- Export task `ac5cb3c7-407f-4da4-b86c-686d0d71943c` saved exactly one workbench
  asset, `hlRbO5tebfhnkS8Qw4mW2` (8,433,849 bytes). FFprobe reports 1080x1920,
  30 fps, 840 video frames / 28.000 seconds; full FFmpeg decode passes. A steady
  one-second audio sample relative to the matching source window has amplitude
  ratio 0.10296, consistent with the requested 10% level after AAC encoding.
- A subsequent real request changes only the title text in a fresh review.
  Its item list equals the applied result except that one text property. Actual
  UI Reject leaves the complete applied project unchanged. The refined 28-second
  version and its export remain available; the test title revision stays rejected.
- Evidence: `F:/selfProject/reizo-video-acceptance/refinement/acceptance-result.json`,
  per-round exact comparisons, checkpoint recovery verification, apply/undo/redo
  and rejection verification, export verification, full transcript, saved projects,
  proposals and actual preview images. External QA drives the real chat/review UI
  and reads snapshots; it does not substitute direct editor mutations for the model.
  This remains synthetic-fixture functionality acceptance. The installer was not
  rebuilt with these development-source changes.

## Conversational confirmation and automatic application — 2026-10-15

Evidence root: `F:/selfProject/reizo-video-acceptance/approval`.
Conversation: `wRe2T7QjozISfH3h5Xght` (剪辑确认与自动应用验收).
Project: `02ff6eb3-de16-4d50-9676-63d4c5adc64c`.
Provider/model: configured Reizo / `gpt-6-astra`.

- A fresh request produced a 5-second 16:9 composition from the first five seconds
  of `composition-a.mp4`, with the title “确认测试”, no music, actual frame previews
  and a pending review. The live timeline remained empty. The model initially tried
  calling the host compose tool through the generic editor wrapper; the allowlist
  rejected it and the model recovered with the proper top-level tool.
- Enabling automatic application while that review was already pending did not
  change the live document or apply it. The test then returned to manual mode.
- The first conversational confirmation suffered a provider timeout followed by
  HTTP 502 retries. The app regenerated the turn; it did not inherit the one-shot
  confirmation, and its attempted apply was denied. A fresh “应用这一版” succeeded
  through exactly one `video_editor_apply` call. No manual Apply click substituted
  for that model call. The whole saved document equals replay of the captured review
  operations against the original document.
- The user-facing checkbox enabled automatic application. A full renderer reload
  preserved the preference. A real follow-up asked to change only the title to
  “自动应用成功”. The model began a new draft, used `video_editor_refine`, inspected
  frame images, and called `review_edit_session`, which returned applied status.
- The saved document equals the prior document with only the title text changed.
  One UI Undo restores the complete prior document; Redo restores the complete
  revised document. Other conversations retain manual mode. The test conversation
  was returned to manual mode on completion.
- The first checkbox QA attempt used Playwright `check()`, which assumed immediate
  controlled-state updates and failed while the preference save was in flight.
  The QA driver was corrected to click and wait for the persisted setting and
  enabled/checked UI state. This was a harness timing issue, not a product retry.

Machine evidence: `acceptance-result.json`, `manual-proposal.json`,
`baseline-project.json`, `confirmed-project.json`, `auto-project.json`,
`session-transcript.json`, the captured chat requests, development logs and `final.png`.
The success applies to these synthetic fixtures; it is not a model reliability estimate.

Host validation: seven focused suites / 32 tests passed (approval/service, agent tools,
routes, composition/refinement and chat preview). TypeScript passed. Focused lint has
no new warnings; the API file retains its pre-existing unrelated `any` warning.
Upstream `reizoDraftApproval.verify.ts` and `external-edit-session.verify.ts` passed,
covering exact identity, replaced/rejected/stale proposals, duplicate application,
one commit boundary and existing real-tool confirmation behavior. No installer rebuild.

## Local confirmation and fewer editing roundtrips — 2026-10-15

Evidence root: `F:/selfProject/reizo-video-acceptance/fast-edit`.
Conversation: `mzAE8E-StAIDu_N1cqg1p` (剪辑快捷流程验收).
Project: `222c5689-a8f9-4d0f-a87c-c4e91bfba91d`.
Provider/model for editing: configured Reizo / `gpt-6-astra`.

- An isolated project clones the prior owned synthetic fixture, retaining its three
  editor media assets and two active timeline items. Setup changes its title to
  “快捷流程原版”; all subsequent editing is driven by the actual chat UI/model.
  The existing user result and earlier acceptance projects are unchanged.
- Request: change only that title to “少等一步” and provide a review. Exactly three
  successful tools execute: `video_editor_prepare`, `video_editor_refine`,
  `video_editor_review`. No tool discovery or extra frame rendering is requested.
  Prepare includes the full editor media pool even with zero workbench assets.
  Actual returned preview images were inspected. The persisted pending proposal
  replays to exactly the baseline with only one title text property changed; the
  complete live project stays equal to the baseline until confirmation.
- The editing turn takes 153.1 seconds including provider latency. There are four
  HTTP model requests (one before each of the three tools and one final response).
  This demonstrates reduced tool roundtrips, not a provider speed guarantee; the
  prior comparable automatic title edit used seven tools.
- Sending “应用这一版” through the real chat UI records one local
  `video_editor_apply` activity and persists the success response. Saved assistant
  duration is 322 ms; complete terminal lifecycle log is 355 ms. No provider HTTP
  request occurs during confirmation. The saved project equals the full captured
  proposal replay and its status is applied. One UI Undo restores the entire
  baseline; one Redo restores the entire expected result.
- A second command deliberately supplies nonexistent provider/model IDs through the
  normal chat API. It is handled locally, reports no pending review as a failed tool,
  persists that explanation and leaves the project unchanged. No provider request
  is sent. This does not change the user's configured model settings.
- Focused tests cover bypassing model settings, persisted/resumable local turns,
  regeneration and duplicate prevention, missing/ambiguous results, concurrent
  confirmation, stopping before application, exact pending-review resumption and
  stale lifecycle rejection. Seven suites / 43 tests, TypeScript, focused ESLint
  and `git diff --check` pass.

Evidence includes `acceptance-result.json`, `model-verification.json`,
`baseline-project.json`, `expected-project.json`, `review-proposal.json`, captured
chat requests/transcript, development logs and `final.png`. This is synthetic-fixture
functionality acceptance. Development source and running app are updated; the
previous installer was not rebuilt.

## Visual source selection and rough-cut acceptance — 2026-10-15

Evidence root: `F:/selfProject/reizo-video-acceptance/source-selection`.
Conversation: `1CerUyVpYqx86gdCb3H-r` (素材选段粗剪验收).
Project: `bd3fa710-03b5-4996-baaa-892c2bb17b4d`.
Provider/model: configured Reizo / `gpt-6-astra`.

- The independent fixture clones the earlier owned test project: two twelve-second
  candidate videos (busy test pattern vs solid teal), one audio asset and the existing
  two-item sequence. The natural-language request asks the Agent to compare current
  candidates, select a visually simple six-second landscape opening, mute it, add
  “安静开场”, omit music/other captions and provide a review with its reasons.
  It does not name the preferred file or prescribe source timestamps.
- The first attempt completes prepare, then encounters a provider response timeout
  and terminates interrupted after 120 seconds. Automatic retry reuses the exact
  prepared draft from history. It completes inspect_sources → rough_cut → review
  in 229.2 seconds. This is recovered acceptance, not an uninterrupted or speed claim.
- Both candidate videos return actual source contact sheets through the registered
  multimodal tool path. The Agent chooses `composition-b.mp4`, source 0–6 seconds,
  citing observed source times 0.73, 2.23, 3.73 and 5.23 seconds. Its saved summary
  explains the comparison and labels the reasons as AI judgments. The actual
  composed preview shows the teal background and requested title.
- Full proposal replay confirms all original assets and timelines remain exactly
  unchanged, with one new active sequence: one 180-frame video at 30 fps, volume 0,
  one specified title, no audio item and no other text. The live document remains
  exactly equal to the baseline while awaiting review.
- A real chat “应用这一版” applies that exact proposal. The saved document equals
  the replayed expected document. One UI Undo restores the entire baseline; Redo
  restores the entire expected result. Repeated confirmation does not apply again.
- Eight focused suites / 38 tests pass, including seven source-inspection tests and
  one registered multimodal-tool test. Coverage includes full-batch validation,
  exact selected IDs, missing/wrong image coordinates, cancellation, conversation
  isolation, persistence, source relinking/fps changes, draft/project mismatch,
  fabricated timestamps, sparse coverage, static image holds, pre-mutation rejection
  and persistent rationale alongside actual composite previews. TypeScript,
  focused ESLint and diff whitespace checks pass.

The QA driver was adjusted to count prepare in the persisted interrupted attempt,
and the remaining tools in its successful retry; it retains both attempt outcomes.
Evidence includes `acceptance-result.json`, `model-verification.json`, full transcript,
baseline/expected projects, pending proposal, captured chat requests, screenshots
and development logs. The source observations and images also persist in the
conversation-scoped inspection directory under the app's data root.

This fixture verifies tool integration and an elementary visual selection. It does
not establish editing quality on production footage, speech comprehension, exhaustive
scene coverage or motion quality. No video-generation API or new transcription
service is used. Development app is updated; installer has not been rebuilt.

## Local speech subtitles acceptance (2026-10-15)

Evidence: `F:/selfProject/reizo-video-acceptance/speech`.
Conversation `zYE2Gy0HLU1VNBUzgdqUs` (本地语音字幕验收), project
`6ea98bf0-4c97-4729-b74b-f7f621d00459`; configured Reizo / GPT-6 Astra.

- A Windows Huihui synthetic Chinese voice was muxed into a solid-colour video and
  imported normally. The timeline is 410 frames at 30 fps (13.67 s). Actual local
  Whisper Base recognition produced six timestamped phrases and three caption pages.
  No transcript fixture was injected. The model pack was downloaded and verified.
- Real model turns exercised prepare → speech start/status → subtitles generate →
  review, then prepare/read/correct/review. Recognition preserved the source text
  (including machine mistakes and traditional characters); display overrides fixed
  导入/导出 and converted to simplified Chinese. No video/ASR API was used.
- Acceptance exposed nondeterministic transcript IDs generated during reducer replay.
  `reizoSpeechIdentity.verify.ts` failed before the command-time identity fix and
  passed afterward. Caption stable-reference, restored-draft and proposal regression
  scripts also passed. Final real-model acceptance was rerun on a fresh draft using
  the completed cached recognition after rejecting the owned earlier QA proposal.
- Pending preview leaves the live document unchanged. Recorded actions replay with
  the same transcript generation/word IDs as the reviewed result. Native caption
  resolution against the replayed document shows the corrected display strings.
  Clip identity/source, volume, source in-point, position and duration are unchanged.
- Actual chat “应用这一版” applies the reviewed result. One UI Undo restores the full
  baseline; Redo restores the corrected result. Refresh retains the applied project.
  QA compares JSON-canonical project documents, since absent optional properties
  and runtime `undefined` properties are equivalent in persisted JSON.
- First MP4 export failed at frame fetching with a message suggesting low disk space.
  Its failed task was retained. A single explicit retry of the same saved recipe
  succeeded and returned one asset to 剪辑成片. This is recovered export acceptance,
  not an uninterrupted-export claim. The successful file fully decodes and has video
  plus audio, 410 frames at 30 fps. Extracted frames visibly contain corrected text.
  Pixel checks show no caption before speech and visible text on each spoken page.
  Native caption policy holds the prior page through gaps; it does not hide each
  phrase immediately at its ASR end timestamp.
- 17 focused host suites / 78 tests passed, including 11 new speech/subtitle tests.
  Host and upstream app TypeScript checks, focused ESLint and diff whitespace checks
  passed. Guarded overlay installation was run twice to verify idempotence. Development
  and packaged editor resources were rebuilt; an installer was not produced.

Environment note: C: initially had no free space. Task-owned build/model caches were
retained on F:. Cross-volume movement of old render caches followed a Windows uploads
junction and temporarily displaced media. All 62 affected files were copied back,
SHA-256 checked against retained backups, and current/prior sample asset digests were
checked against original project source revisions. HTTP reads returned 200. Evidence
is in media-recovery.json, media-http-verification.json and source-revision-verification.json.
Do not recursively relocate a render bundle containing an uploads junction without
separating the link from actual media. The retained F: backups are intentionally kept.

The fixture tests local recognition and the editing/export lifecycle, not recognition
quality or speed for long, noisy, multi-speaker production recordings. Automatic
semantic content deletion, translation and speaker diarization remain out of scope.
