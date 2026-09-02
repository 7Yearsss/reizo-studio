# cindy → Reizo — integration backlog

Source: an Opus investigation of `E:\CodeCode\cindy` (2026-09-03), the
open-source client monorepo for Cindy (XD Inc., Apache-2.0). cindy is a
**harness multiplexer** — it drives external agent CLIs (Claude Code, Codex,
"Pi") behind one unified event stream. Reizo runs its own loop via `streamText`,
so most of cindy's bulk (the compat proxies, translators, Orca) is out of scope
per `artifact-plan.md` §0.3. What's left is a set of small, well-reasoned,
mostly-pure modules worth porting.

Effort **S** ≤2d · **M** 3–10d · **L** 2+wk. "Overlap" is against
`artifact-plan.md` / `canvas-plan.md`.

## The one principle

`docs/dev-rules/maker-core-and-agent-behavior.md` §2: **prefer code for
determinism over prompts.** Branching, validation, state machines, permission
control, retry/fallback — all in code; the prompt only carries what genuinely
needs language understanding. Every item below is an instance. §3.1 corollary:
**prompt-cache prefix byte-stability** — nothing volatile (timestamps,
counters) in the system-prompt prefix; tool set fixed across a session. Reizo's
`runtime.ts` builds `systemParts` per turn and its toolset is conditional on
`workspacePath` — worth an audit.

## Backlog

| id | Item | cindy source | Effort | Pri | Overlap |
|---|---|---|---|---|---|
| **R1** | Loop-guard L2/L3: fingerprint-diversity-collapse over *all* completed calls (catches loops where every call succeeds) | `packages/maker-core/src/agents/shared/loop-guard.ts` | S | **high** | extends shipped AP2 X12 |
| **R2** | Deterministic 3-tier permission triage (`auto-approve / prompt / prompt-each-time`), pure fn, credential-path gating on read+write | `agents/shared/auto-review.ts` + `auto-review-decision.ts` + `sensitive-credential-paths.ts` | M | **high** | upstream of `permissions.ts`; none |
| **R3** | PDF export via throwaway hidden `BrowserWindow` + `printToPDF` (use-once-destroy, explicit webPreferences, 30s timeout, concurrency 1) | `apps/desktop/src/main/doc-tools/htmlPdfRenderer.ts` | S | **high** | **unblocks deferred AP3 X3** |
| **R4** | Persistent cross-session memory: 1 md shard/fact, 4 curated types, FTS5, `MEMORY.md` snapshot into prompt at session start | `packages/maker-core/src/memory/` (esp. `system-prompt.md`) | M | **high** | none; complements `skills/` |
| **R5** | Content-addressed blob store (SHA-256 filename, host-computed) + refcount ledger + report-then-delete recycler | `apps/desktop/src/main/cindy-media/` | M | med | solves AP1 **T6**; do before AP6 |
| **R6** | Goal loop: `/goal X` self-continues turns, all stop conditions code-owned, verdict = trailing fenced JSON, never touches system prompt | `apps/desktop/src/main/goal-host/` | M | med | none; canvas synergy |
| **R7** | Per-turn change-set (CoW pre-images → unified diff, every bound a named const) + shadow-git savepoints under `refs/cindy/savepoints/` | `apps/desktop/src/main/turn-change-set/` + `git-snapshot/savepointRefs.ts` | M/L | med | complements artifact version rail |
| **R8** | Secret redaction before text reaches a model/log: 8 named provider patterns + 1 generic assignment regex, append-only rules | `apps/desktop/src/main/git-snapshot/secretRedactor.ts` | S | **high** | none |
| **R9** | UsageTracker: turn-cumulative vs last-API snapshot split, per-request price bands, live TPS fails-closed | `agents/shared/usage-tracker.ts` | M | med | none |
| **R10** | Panel/tab registry (open `PanelKind` namespace; unknown kind → hide + keep record) + `FRACTION_TOLERANCE` divider bugfix | `apps/desktop/src/renderer/panels/registry.ts` + `shared/layoutTree.ts` | S (registry) / L (tree) | med | canvas §6 "remember last tab"; take **S only** |
| **R11** | Image downscaling at the model-context boundary (sharp, ≤500KB skip, 5s→original fallback, content-hash cache) | `agents/shared/image-resizer.ts` | S | med | helps AP6 + canvas P4 |
| **R12** | Terminal output normalization (strip ANSI/OSC/DCS/CSI) + `applyPlainTextTerminalEnv` (`NO_COLOR`, `TERM=dumb`, `PSStyle…=PlainText`) | `agents/shared/terminal-output.ts` (66 lines, copy as-is) | S | med | none |
| **R13** | Error classifier split: `capacity` (vendor won't retry → host backs off) vs `overloaded` (SDK already retries → don't double) vs network | `agents/shared/overload-error.ts` etc. | S | med | extends shipped AP2 `mediaError` |
| **R14** | `/review`: read-only, memory-free reviewer session over the work product; source-tagged evidence only; never fixes; fail-closed staleness | `docs/product-rules/review-product-direction.md` + `apps/desktop/src/main/reviewer/` | L | med | consumes AP1 provenance + AP2 rails |
| **R15** | `/learn`: distill a session into a reviewable skill proposal; every budget a code const; drops oldest when over | `apps/desktop/src/main/learn-host/` | L | low-med | overlaps AP5 X10 rule-proposal |
| **R16** | Session share export/import (encrypted) with `mediaUrlRewrite` on both ends | `apps/desktop/src/main/session-share/` | M | low | none |
| **R17** | Small utils bundle: async-queue w/ `clear()`, palette scanner, frontmatter scanner w/ path-containment, tiered turn-start tips, managed-image refs | `agents/shared/{async-queue,palette-scanner,customization-scanner,turn-start-phrases,managed-image-reference}.ts` | S | low-med | none |
| **R18** | Voice input: push-to-talk → ASR → LLM refine; stall watchdog gates on voiced RMS not wall-clock; divergence guard rejects hallucinated rewrites | `packages/voice-input-core/` | M | low | none |

## Do NOT copy (traps)

- **T1** `auto-review.ts` as a 6021-line file — port the pure `reviewAction`
  shape + credential paths + `unavailable ≠ block`; skip the shell classifier
  until Reizo ships an unconstrained `bash` tool.
- **T2** the whole harness-multiplexing layer (compat proxies, translators,
  AutoCompactController, yield-continuation state machine) — exists only to
  drive external CLIs. `artifact-plan.md` §0.3 already ruled this class out.
- **T3** Orca as designed (65KB of runtime contract, downstream of T2). Reizo's
  canvas Agent Task node is a better multi-agent seed. Steal two ideas only:
  batch worker creation returns one code-generated report where
  `success+failure+skipped == request_count`; "tool visibility is not a
  permission boundary — the handler must reject."
- **T4** the full layout split tree — take the tab registry (R10-S) only.
- **T5** the ghost/plugin platform (~180 files, multi-quarter bet).
- **T6** two-level `list_tools`/`call_tool` dispatch — cindy built it and backed
  it out twice. Useful negative result.
- **T7** the docs-governance apparatus at Reizo's scale — take the
  trigger-indexed rule table pattern, not the CI gates.
- **T8** `bypassPermissions` as the default for new workers.
- **T9** telemetry / region branching — but read
  `log-upload-and-redaction.md`'s three invariants for the reasoning.
- **T10** `workflow-progress/reader.ts` reverse-engineers `claude`'s private
  on-disk format — cite as a model for defensive parsing, don't build it.

## Sequencing (folds into `artifact-plan.md` §6)

- **Now (S, independent):** R8, R3, R1, R12, R13, R17.
- **Before/with AP6:** R11, R5 (before AP6 writes media bytes; solves T6),
  R10-S (also closes canvas §6 "remember last-open tab").
- **Structural bets (M, equal value):** R2, R4.
- **After:** R9, R6, R7.
- **Later / evaluate:** R14, R15, R16, R18.

## Status — 2026-09-03

### Shipped (branch `feat/artifact-substrate`)

- **R8** — `src/shared/redactSecrets.ts` (+ 8 tests): 8 named provider token
  patterns + a generic `*SECRET/TOKEN/PASSWORD/API_KEY* = <value>` regex →
  `[REDACTED:<name>]`. Wired into `runtime.ts`: attachment bodies and the
  `MEMORY.md` block are redacted before entering model context.
- **R1** — `toolLoopGuard.ts` upgraded with diversity-collapse detection over
  *all* completed calls (not just errors): L1 (6× identical in a row → halt),
  L2 (last 12, ≤2 distinct → ABAB), L3 (last 16, ≤4 distinct → ABCD rotation).
  Catches loops where every call succeeds. +5 tests.
- **R12** — `src/shared/terminalOutput.ts` (+ 8 tests): `stripTerminalControlSequences`
  (OSC/DCS/CSI/bare-ESC/C0, CRLF→LF) + `plainTextTerminalEnv` (`NO_COLOR`,
  `TERM=dumb`, `PSStyle__OutputRendering=PlainText`). Wired into
  `workspaceShell.ts` — stdout/stderr cleaned, env applied.
- **R13** — `providerError.ts` gained `classifyProviderError` (+ 3 tests):
  splits `overloaded` (Anthropic 529, SDK already retried — don't double) from
  `capacity` (OpenAI "at capacity", vendor won't self-retry — host backs off),
  plus `auth`/`rate_limited`/`timeout`/`upstream`. `formatProviderError` gains
  529/overloaded copy.
- Gates: `tsc` clean · `vitest` 34 files / 212 tests · `test:api` pass.

- **R3** — PDF export. `src/main/pdfExport.ts` (throwaway hidden BrowserWindow,
  explicit webPreferences, no preload, all navigation denied, 30s timeout,
  concurrency-1 promise chain) + `IPC.EXPORT_PDF` handler + preload
  `exportPdf(html)` + `window.d.ts`. Renderer:
  `lib/artifactExport.ts` (`toHtmlDocument` — markdown→`renderToStaticMarkup`
  with print CSS, html passthrough; `downloadBase64`) + a 导出 PDF button in
  `ArtifactPreview` for markdown/text/html. **Closes the deferred half of
  AP3 X3.**
- Gates: `tsc` clean · `vitest` 34 files / 212 tests · `test:api` pass.

### Next

- R17 (small-utils bundle), then the structural bets R2 (permission triage) +
  R4 (persistent memory), then R9 / R6 / R7.
