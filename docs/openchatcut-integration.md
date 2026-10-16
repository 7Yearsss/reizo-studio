# OpenChatCut editing workspace

Development integration of OpenChatCut v0.2.16, commit
`2e6f4a29b784200cfb32b859b16f2561592bc3e8`.

## Run

1. Install Reizo dependencies: `npm ci`.
2. Prepare the pinned editor: `npm run setup:video-editor -- --browser <headless-shell.exe> --render-bundle <v0.2.16-render-bundle> --cache-runtime` (Git and Node 24+ required).
3. Run Reizo: `npm start`. Open **打开面板 → 视频剪辑** in a conversation.
4. Click **送到剪辑** on an image/video/audio canvas node, in the asset shelf/library, or in a media preview under **我的作品**. Canvas/library actions use the current conversation; My Works opens the artifact's owning conversation and sends the version currently being previewed, including an older version. **工作台素材 → 加入剪辑** remains available inside the panel.
5. Place media on the timeline, or ask the Reizo Agent to import/edit it. Preview/apply/reject the Agent proposal in the editor, send **应用这一版** in chat, or enable **自动应用** for subsequent reviewed edits in this conversation.
6. Use **导出回素材库**. The default destination saves MP4/WebM/MP3/WAV into the current canvas and the global asset library's **剪辑成片** folder. Other formats use the existing download path. Explicitly choosing a local file/folder uses that destination instead.
7. For locally imported source material, select media-pool cards and click **保存选中素材到工作台**. New supported images/video/audio go to the canvas and **剪辑素材**; already accessible identical bytes reuse the original asset identity. This saves the selected available representation, which may be an editor compatibility proxy rather than the original master.

Setup can reuse a dedicated checkout: `npm run setup:video-editor -- --source <absolute-path>`.
It checks the exact revision and overlays the files in `integrations/openchatcut`.
Use `--skip-install` only after dependencies have already been installed. Do not point
it at an unrelated checkout: App.tsx and EditorWorkspaceView.tsx are integration overlays.
The runtime manifest is generated in `.cache/openchatcut-runtime.json`, never committed.
An existing compatible Chrome Headless Shell is supplied with `--browser <executable>`.
The checked runtime requires an explicit browser and prebuilt render bundle, avoiding
unpredictable first-use downloads/compilation. Setup skips the
upstream Electron binary because Reizo supplies the desktop window.
An existing **v0.2.16** desktop render bundle may be supplied using
`--render-bundle <resources/remotion-bundle>`. Each data root receives a private
copy without user uploads; the original installation is never relinked or modified.
This avoids compiling the rendering bundle on the first export/frame inspection.
The Windows preview defaults to software GL for reliable headless startup on this
machine; an explicit `CC_RENDER_GL` setting overrides it.

`--cache-runtime` copies Node, the complete browser directory and the immutable render
bundle into Reizo's `.cache/openchatcut-runtime`; it excludes upstream user uploads.
Windows uses bounded parallel copying. Subsequent overlay updates preserve these paths:
`npm run setup:video-editor -- --skip-install`. Do not reinstall working dependencies
merely to update the UI bridge. `npm run check:video-editor` checks the pinned source,
Node, FFmpeg executable, critical dependency versions against the upstream lockfile,
browser/bundle presence and integration overlays. The launcher fails early with a
specific missing-dependency message. Setup configuration is written atomically.

The source checkout and its `node_modules` are still required at the configured location.
On this development machine they use the existing dedicated checkout and dependency
junction; the standalone app's browser/render files are no longer needed at runtime.
This does **not** produce a self-contained installer or trim the upstream dependency tree.

## Boundaries

- Reizo owns the conversation, model configuration and Agent turn lifecycle.
- An isolated child process owns upstream editing, media storage, rendering and export.
  Its UI has no upstream chat, dashboard or model configuration. The media library tabs
  are limited to local media and captions. Other engine code is still present underneath.
- This first integration uses the upstream Vite runtime; it is a **development preview**,
  not a packaged production runtime. The normal Forge installer does not include the
  engine. Production needs a compiled runtime, platform binaries, dependency trimming,
  shutdown/export recovery validation and license review before distribution.
- Per-conversation project bindings live under `<Reizo data>/video-editor-bindings`.
  Editor state/media live under `<Reizo data>/video-editor`, separate from the user's
  standalone OpenChatCut profile. Closing a conversation does not delete its project.
- The MCP token is generated per engine start and stays in the backend. The renderer
  only receives the loopback editor URL and project ID. Tools cannot select a different
  project, call generation services or change settings. Keep the editor panel open
  while the Agent works. Reopening rebinds the same project; upstream rejects stale drafts.
- `video_editor_tools` discovers the filtered schemas; `video_editor_call` invokes them.
  Editing follows begin → read/edit draft → inspect frames → review → applied/rejected.
  Review defaults to manual; the host also supports exact conversational confirmation
  and an explicit per-conversation auto-apply preference (see below). A pending proposal
  is not a completed edit. No mutation is retried
  automatically after ambiguous transport failures. Image evidence is returned to the model.
- `video_editor_compose` builds a complete sequence inside an existing fresh manual
  draft: ordered exact source windows, aspect/fit, title, timed caption text clips,
  and selected background audio with volume/fades. It rejects missing/offline sources,
  insufficient durations, duration mismatches, overlapping/out-of-range captions and
  text that would exceed the safe area. Static image holds are supported. Caption
  provenance is explicit; this tool does not perform or invent speech transcription.
  It returns actual rendered keyframes before review. The Agent must inspect these,
  refine when needed and explicitly call `review_edit_session`; compose never applies.
  Pending proposals can be discarded and rebuilt with a revised plan; applied
  sequences support the existing granular tools and one-step undo.
- The latest composition summary, exact plan and rendered keyframes are stored under
  `<Reizo data>/video-editor-previews/<conversation hash>` and shown in chat after
  reopening. They are clearly labeled historical draft snapshots, not current applied
  state. Image routes check conversation ownership and the current preview identity.
- Status reads wait behind an in-progress Apply transaction and retain the draft's
  original MCP binding. Beginning a fresh draft rebinds after the synchronization read.
  A single fresh Begin attempt is allowed only after the exact revision-precondition
  rejection and a fresh session list proves there is no active draft. Ambiguous
  failures and edit mutations are never retried automatically.
- `video_editor_context` reads a bounded live snapshot: selected media and clips, active
  timeline, playhead frame, pending review/confirmation and export state. Selection is
  unavailable after six seconds without a heartbeat; it must not silently fall back to
  a previously selected or newest asset. Agents should verify IDs with project/timeline
  tools before mutations. Context and the latest activity list are ephemeral, not durable
  chat messages or crash recovery. Chat shows this activity even after an Agent turn ends.
  Applied/rejected feedback comes from the upstream runtime's actual terminal transition,
  not an Apply-button click or fulfilled no-op Promise. Saved feedback comes only from
  the host's completed durable transaction. Export failures/cancellation are separate.
- `video_editor_media` lists/imports current-conversation immutable asset IDs. Versions
  explicitly reused from another canvas are included; unrelated assets require the
  existing canvas reuse action first. Import is separate from draft timeline editing.
  The browser uses the upstream media ingest pipeline; imported master hashes prevent
  duplicates even after renaming/reopening. Source bytes are checked against Reizo's
  registered hash before transfer. No arbitrary local path import is exposed.
- Host/frame messages validate the frame window, origin, project and per-mount nonce.
  Backend queues and acknowledgements are conversation scoped, bounded and expire after
  two minutes. An error or missing acknowledgement never counts as successful import.
- Export return stages a private durable file, then atomically registers its asset,
  node and provenance tags. Identical output bytes from the same editor project are
  reused across retries/restarts. Metadata records the OpenChatCut project ID; individual
  source clips/ranges are still tracked in the editor project, not a Reizo lineage graph.
  The bridge currently supports up to **256 MB per file**; existing canvas file-picker
  limits are unchanged. Keep the panel open until the save acknowledgement arrives.
  Local pool imports return only through the explicit selection-save action or an export;
  this is not an automatic bidirectional synchronization daemon. Supported source formats:
  PNG/JPEG/WebP/GIF, MP4/WebM/MOV (ftyp), MP3/WAV/M4A/OGG/FLAC. File signatures are checked;
  unsupported formats produce an error rather than a success receipt.
- Direct sends capture an immutable asset ID or a guarded legacy path/index before any
  navigation. Cross-canvas library material is explicitly reused into the target canvas.
  Artifact imports require the exact version, matching owning session and content digest.
- No video generation API is configured or called by this integration.

## Licensing

Upstream OpenChatCut is AGPL-3.0-or-later. `integrations/openchatcut` contains adaptations
of upstream interfaces/workspace code and is provided under that license. Preserve
upstream notices and corresponding source when distributing. Reizo's existing MIT
license does not relicense imported code. A separate process/iframe does not by itself
settle the license obligations of a distributed combined product. Remotion and other
dependencies have their own licenses. This trial does not approve commercial distribution.

## Verification

Focused tests: `npx vitest run src/main/server/videoEditor src/main/server/routes/videoEditor.test.ts src/main/server/routes/canvas.assets.test.ts src/renderer/lib/sendToVideoEditor.test.ts src/renderer/components/canvas/AssetShelf.test.tsx`.

Verified on Windows on 2026-10-14:

- Twenty-five focused tests pass: transport/SSE/image payloads, no automatic mutation retry,
  blocked generation/unopened projects, error propagation, per-conversation binding
  persistence/manual review and synchronization of an outdated browser revision;
  media transfer scope/hash checks, concurrent import and output deduplication,
  durable output provenance, failure acknowledgements and shutdown cleanup;
  HTTP route rejection of missing conversations, wrong projects and invalid media.
  Added coverage verifies selected older artifact versions, guarded legacy indexes,
  source image return/deduplication, context expiry/isolation, heartbeat ordering,
  rejection of frame-reported saved events, and the shelf's selected-version send action.
- Real Electron UI: open the panel from a new conversation, create an editor
  project, import local video and insert it into the timeline.
- Real Agent-tool transport: read the media pool, stage a 60-frame clip, submit
  manual review and apply it in the editor. Reopening restores the 2-second
  timeline and the uploaded media. An orphaned unchanged draft can be resumed.
- `view_timeline_frames` returns a real rendered image through MCP.
- Export dialog downloads a 1920×1080 H.264/AAC MP4; FFmpeg decodes all 60 video
  frames and its audio without error.
- New real Electron roundtrip: import a Reizo video version into the editor, repeat
  twice without duplicate pool entries, place on timeline, export a 3-second 1080p
  MP4 into the canvas/library, reload and reuse the same editor asset ID. FFmpeg
  fully decodes the returned MP4 without errors. No paid model/API call was used.
  A JPEG was also transferred twice, retaining its display name and editor asset ID.
- Runtime dependency checker passes all eight checks with project-local Node/browser/
  render resources; dependencies remain the pinned upstream versions.
- Real MCP background export: begin an empty manual draft, submit the render request,
  confirm it in the editor, wait for the confirmation to be persisted, then invoke the
  exact same arguments once. A 2-second 720p H.264 output is returned through the host
  acknowledgement and registered in the canvas/library; FFmpeg fully decodes it.
  Rendering completion and host
  persistence are separate steps; check the library before claiming delivery there.
- The adapted upstream frontend passes `tsc -p tsconfig.app.json --noEmit`.
- Real desktop UI also verifies pool selection plus timeline/clip/playhead telemetry,
  local PNG return and deduplication, My Works preview v1 send when v2 exists, direct
  canvas send, and expired selection after panel close. A separate real MCP/manual-review
  roundtrip verifies awaiting-review is not applied, actual application emits applied,
  undo restores the timeline, and rejection emits rejected without adding a clip.
- Focused ESLint has no errors (existing canvas-node files retain their warnings).

2026-10-15 additions:

- The composition compiler and preview store have five tests for exact source identity,
  trim/sequence timing, safe typography, caption validation, failure behavior and
  persistence/isolation. A route test checks persisted previews without a connected
  editor and denies other conversations' image access. Two renderer tests verify the
  persisted draft card and cleanup when image loading completes after unmount.
- Full Reizo TypeScript checking now passes; the unsupported Forge macOS signing
  option was removed. The adapted upstream frontend also passes TypeScript checking.
- Real registered-tool/MCP checks produce a 30-second 1080×1920 sequence: three trimmed
  shots from two video sources, one title, three supplied timed captions and one music
  clip with 20% volume and fades. Actual rendered contact sheets were inspected.
  Manual application, atomic undo and rejection of a revised-title composition were
  verified in the browser. These are tool-path tests, not an LLM natural-language test.
- The four-part delivery remains in progress; see `docs/video-editor-acceptance.md`.

The Agent tests invoked the same registered service directly; no paid model/API
call was made. Reizo's chat model still needs its normal configuration for
natural-language operation. Production packaging, broad editing-effect coverage,
and recovery from process termination during export remain separate validation.

Durable export management (2026-10-15): `videoEditor/exportTasks.ts` owns accepted
recipes and task receipts under `video-editor-export-jobs`. The host monitors the
engine and commits results to the asset library even after the iframe closes.
The chat activity card polls these tasks independently of editor presence. Engine
restarts are reconciled by UUID; unsupported in-flight resumption becomes an explicit
interrupted task with retry. See the acceptance document for verified coverage and
remaining real-desktop checks, including the newly discovered export-background defect.

Subsequent checks fixed the export background and versioned render caches. Actual
render-process termination, cancel/retry and desktop conversation-switch/panel-close
delivery now pass; see the dated acceptance evidence. Long-video performance and
standalone packaging are still in progress. `build:video-editor` prepares compiled
UI/server plus runtime dependencies; this command alone is not installer acceptance.

Long-video acceptance now passes in both a reopened project and a fresh project:
10-minute 1080p source, 540p preview, bounded waveform/filmstrip, actual timeline
seek/zoom, original-source 1080p segment export, immutable master hash and versioned
cache invalidation. The derivative queue no longer shares already-cancelled work
with a reconnecting consumer. See the acceptance document for measurements and
fixture limitations; the full four-part goal still requires installed-copy and real
chat-model acceptance.

Windows production builds are memory-intensive. Forge now builds Vite targets one
at a time, keeps temporary staging under the system temp directory, and `make`/`package`
use a launcher that supplies an 8 GiB Node heap unless you set an explicit limit:

```powershell
npm run make
```

`REIZO_BUILD_TEMP` can override the staging directory. Use a short path on a volume
that supports directory renames: this machine's F: workspace allows file writes but
returns EPERM for nonempty directory renames; the C: system temp volume passed the
same probe. The launcher passes the selected path to TEMP, TMP and SQUIRREL_TEMP.
It also applies a version-checked Forge 7.11.2 compatibility patch: `.bin` cleanup
uses a relative glob with `cwd: buildPath`, so Windows separators cannot turn it
into a scan of the source checkout and all its build caches.
The make launcher also initializes Squirrel's 7-Zip files if dependency lifecycle
scripts were skipped, and supplies the x64 resource editor from pinned `rcedit`
5.0.2. The installer's bundled x86 resource editor cannot commit the ~865 MB
offline Setup executable on this machine; the x64 executable passed the same
large-file version-resource update. Both dependency versions are checked before
the compatibility preparation runs.

The default ~4 GiB heap exhausted memory during host bundling; the earlier explicit
8 GiB compilation passed. An actual isolated installation now passes import, editing,
preview, export and process restart with development paths inaccessible; see the
acceptance document for the exact build and assisted restart-opening detail.
Squirrel can still fail at its final resource write on this machine. The default
maker now retries only that recognized failure after temporary application staging
is removed, verifies the package checksum and resulting versions, and preserves
Forge's normal artifact lifecycle. Custom/signing options and other failures are
not recovered by this path. Final full-build validation of that change is pending.
For subsequent integration-overlay updates on a
running development installation, use `npm run setup:video-editor -- --skip-install`
to avoid reinstalling native dependencies while their DLLs are loaded.

### Local draft revisions (2026-10-15)

Current acceptance is tracked in `video-editor-acceptance.md`; the earlier
in-progress paragraphs above are chronological history.

`video_editor_refine` supports text/font-size changes, absolute audio/video volume,
and shortening a shot from its tail with linked timeline timing. It resolves exact
item IDs from the current draft and sends one atomic `edit_item` batch. Source
references and unspecified properties are preserved. It renders and stores fresh
keyframes with a change summary; revision previews do not reuse an outdated initial
composition plan. The Agent submits review after inspecting the images; the host applies
its conversation-specific confirmation policy.

For an awaiting review, discover/adopt the exact session, call `resume_edit_session`,
and read its current draft before revising. For an applied or rejected session,
begin a new manual session. Never discard and rebuild a pending composition just to
change one property. The overlay in `patch-draft-refinement.mjs` registers the resume
tool and restores the complete draft by replaying its captured actions against its
original base. This preserves all timelines, item IDs and the single-undo boundary.
It checks ownership, unchanged live revision and pending manual status, removes
the old Apply action before saving a drafting checkpoint, and restores the review
if checkpoint saving fails. Both setup and packaged-resource preparation install
this guarded overlay.

Tail shortening maps the removed interval across later items, clamps crossing text,
reports text fully removed by the cut, and shortens full-length continuous background
music at the new end. Existing fades are retained unless longer than half the new
clip. The helper rejects locked tracks, overlapping source shots at the cut, partial
audio crossing it, transitions, native caption tracks, affected keyframe animation,
transcripts and retimed sources. Such projects require explicit lower-level editing;
the helper must not claim arbitrary complex edits are automatically synchronized.

Focused host coverage: `src/main/server/videoEditor/refinement.test.ts`. The overlay
also installs `src/agent/reizoResumeDraft.verify.ts` in the pinned upstream source;
run it with that checkout's `node node_modules/tsx/dist/cli.mjs` to check three
persisted revisions, checkpoint restoration, replay and stale/terminal guards.

## Conversational confirmation and automatic application (2026-10-15)

The video panel defaults to manual review. A user may send a standalone **应用这一版**
(or **确认应用当前草稿**) to apply the currently reviewed proposal through
the host's local command path, before model settings are read. No provider request
is made. The command reads the exact edit-session ID and proposal ID and applies
that proposal through the existing guarded lifecycle. `video_editor_apply` is now
only the recorded activity name, not a model-callable tool. Attached content,
historical messages, negation, questions and generic “可以” are not local commands.
Regeneration explains that it did not repeat application. Changed, rejected, stale
and already-applied proposals are rejected; ambiguous failures are reported without
retrying. The normal persisted Turn/Completion/Interruption/Resume stream is retained.
Handled application errors persist a failed tool and explanation, rather than
triggering the renderer's provider retry. A completed local turn means the command
was answered, not necessarily that application succeeded; inspect its tool result.

The **自动应用** checkbox is a durable preference for only the current conversation.
Enabling it does not apply an existing review. Subsequent `review_edit_session` calls
require actual frame images after the latest draft mutation, then apply the exact
returned proposal. Disabling is checked again before application is dispatched.
The complete proposal is applied through the existing saved-version/atomic undo path.

The upstream session remains `approvalMode: manual` in both host modes. Upstream
`auto` also bypasses real-project tool confirmations; Reizo deliberately does not use
that path. Export confirmations remain separate and generation APIs remain excluded.
The private `apply_reviewed_edit_session` lifecycle tool is not in the generic
`video_editor_call` allowlist, and the model cannot change the host preference.

Implementation: `src/main/server/agent/videoApplyTurn.ts`,
`src/main/server/videoEditor/approval.ts`, `VideoEditorService`, `videoEditorTools.ts`,
the approval GET/PUT routes, and `VideoEditorPanel.tsx`.
The guarded `patch-draft-approval.mjs` overlay adds exact proposal identity and the
apply lifecycle to the pinned upstream; setup and packaged-runtime builds both run it.
Preferences live under `<dataRoot>/video-editor/approval/<sha256(sessionId)>.json`.

Validation: 43 focused host tests, TypeScript and focused ESLint pass after the
local-command follow-up. The prior upstream exact-proposal/edit-session verifiers
also passed; this follow-up does not change the overlay. Real-model development
acceptance, including undo/redo, is recorded in `docs/video-editor-acceptance.md`.
The installer was not rebuilt.

## Standard editing workflow with fewer roundtrips (2026-10-15)

For an explicit editing request, `video_editor_prepare` creates or adopts a manual
draft, resumes its pending review when necessary, and returns the exact draft ID,
current UI context, approval mode, complete timeline/editor media pool and workbench
asset versions. Resumption retains previous pending edits. Use read-only
`video_editor_context` for status questions; prepare changes draft lifecycle state.
The upstream full overview uses `read_project` with no `view` argument.

The standard model path is `video_editor_prepare` → `video_editor_refine` or
`video_editor_compose` → `video_editor_review`. Inspect the actual images returned
by refine/compose before review. These are top-level host tools with typed schemas;
standard edits do not need tool discovery, repeated project reads or duplicate
frame rendering. Advanced operations still use the existing discovery/call path.
Refresh after external changes or errors; do not retry relative mutations blindly.
An empty workbench asset list does not mean the editor media pool is empty.

The real GPT-6 Astra title-only regression used exactly those three tools, preserved
every other project field and left the live document unchanged until confirmation.
Local confirmation finished in about 0.35 seconds with zero provider requests.
Model generation still depends on provider latency; this is one fixture measurement,
not a general latency guarantee.

## Visual source selection and rough cuts (2026-10-15)

For requests that delegate source choice to the Agent, the path is prepare →
`video_editor_inspect_sources` → `video_editor_rough_cut` → review. Exact prescribed
shot plans still use compose; existing local revisions still use refine.

Inspection accepts up to four exact video/image asset IDs per call, with optional
source ranges and 2–8 samples (default six). It reads the current draft's media pool,
validates all requested sources/ranges, then returns actual labeled source contact
sheets through multimodal tool output. No source imports or timeline edits occur.
The Agent compares requested candidates, uses narrower ranges when needed, and
chooses opening/detail/context/ending shots for the user's theme. Audio is excluded
from this visual inspection; static images produce one observation at source frame 0.

Each successful source inspection persists its returned images, actual frame
coordinates, project/draft IDs, source identity/timebase fingerprint and evidence ID
under `<dataRoot>/video-editor-inspections/<conversation hash>`. Rough cut requires
one evidence citation and a visual reason per planned shot. Before any timeline
mutation it checks conversation ownership, project/draft identity, exact source ID,
source URL/type/duration/fps, cited returned frames and source bounds. Video endpoints
must lie within one second of cited samples; gaps must not exceed two seconds.
Sparse coverage requires targeted inspection, not an automatic assumption about
unseen content. The fingerprint checks observable media identity, not a new byte
digest of remote or externally overwritten source files.

Rough cut uses the existing composition validator and creates a separate editable
sequence, leaving prior sequences intact. Its saved preview includes source windows,
observed timestamps and selection reasons explicitly labeled as AI judgments.
Actual composite frames are rendered before review. Source inspection does not
count as composite preview or authorize application. Existing manual/opt-in auto
approval and undo behavior still apply.

This is sampled visual selection, not full audiovisual analysis: it performs no
speech recognition, audio understanding, exhaustive scene detection or motion-quality
verification. The host verifies evidence provenance and coordinates; semantic
selection reasons remain the vision model's judgments. Representative real-footage
quality evaluation remains distinct from synthetic functional acceptance.

## Local speech and timed subtitles (2026-10-15)

The editor header's **语音字幕** popover installs the pinned Whisper Base pack
(367,773,512 bytes, about 351 MiB), with progress and verified local availability.
Recognition uses the existing on-device worker, not AssemblyAI or a paid video API.
The Agent still uses the configured chat model for planning and text corrections.
The initial supported languages are Chinese and English. Keep the editor open
while recognition runs; long recordings and real production footage need separate
quality/performance evaluation.

`video_editor_speech` starts, polls or cancels one exact draft clip's local job.
Only one local inference runs at a time. Results are stored under the project-owned
`reizo-speech:<projectId>:<sha256>` key, bound to asset ID, source revision, language
and model. Reloaded unfinished work is interrupted and requires explicit retry.
Completion never modifies a draft; `video_editor_subtitles(generate)` explicitly
attaches completed nonempty results and anchors native captions to the selected
clip. Existing text edits/stale transcripts or unrelated captions are rejected;
existing usable transcripts and matching captions are preserved.

`video_editor_subtitles(read/correct)` exposes original phrases and stable caption
word references. Correction changes display text/page breaks only, preserving the
source recognition and timing. Generate/correct render real composite frames and
save a reviewable preview. Manual/opt-in auto approval and ordinary Undo still
apply. Speech recognition is fallible: the Chinese fixture produced traditional
characters and confused 导入/导出 with 倒入/倒出, so readable output is not proof of
human-verified accuracy. Original transcript search does not search display edits.

The speech overlay also fixes an upstream replay defect: transcript generation and
word IDs are now created once in `setItemTranscript` commands and serialized in the
action. Reducer replay preserves those IDs, so caption word overrides survive
review restoration, application and reload. A fresh transcription still receives
new IDs. Legacy actions without the added generation field retain upstream behavior.
The regression `reizoSpeechIdentity.verify.ts` reproduces the previous failure and
checks stable replay, preserved display edits and isolation of a new transcription.

This phase does not implement translation, speaker diarization, automatic semantic
content deletion or video-generation APIs. The Agent can read/search attached real
transcripts through `read_transcript` / `find_transcript`.

## Idle shutdown (2026-10-16)

The engine process stops after 15 minutes without use (`REIZO_VIDEO_EDITOR_IDLE_MS`, `0` disables).
It is kept alive while any host call is in flight, any export task is non-terminal, or the
engine reports a connected editor panel (the panel holds the open draft). If connection
status cannot be read, the engine stays running. The next use relaunches it with a new
loopback origin; cached workspace URLs are dropped. Coverage: `videoEditor/idleShutdown.test.ts`.
