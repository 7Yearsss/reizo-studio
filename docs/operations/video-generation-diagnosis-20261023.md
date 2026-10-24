# Account video submission diagnosis — 2026-10-23

The reported Ferrari animation used `grok-imagine-video`. Both saved attempts
failed locally with an unconfirmed reference-image capability error and had no
remote task ID. They were not queued video tasks at the upstream provider.

Root causes:

- new-api model discovery expands the token's Auto groups; canvas capability
  discovery previously looked up a literal `auto` group. Verified video profiles
  from the actual eligible groups were omitted. The gateway patch uses the same
  group resolution as model discovery, preserves token model restrictions and
  requires all eligible channels to agree on a profile.
- `run_node(wait:false)` returned local admission before validation/submission
  settled, with neither the selected model nor an upstream receipt. Video tool
  results now briefly await submission and explicitly distinguish no submission,
  an unconfirmed network attempt, and an accepted remote task. Canvas reads also
  expose the saved model/provider/task status.
- Validation ran inside the submit call after the durable network-attempt marker.
  It now runs before that marker, so rejected local inputs are failed jobs rather
  than uncertain remote submissions. Provider/model identity is saved separately.

The separate canvas point estimate was presentation-only. It is removed from
generation buttons, image editing, animation and graph confirmations, together
with the local point formula. Existing model calls continue using the logged-in
account's workspace key and new-api balance/settlement path. Execution loop
budgets and usage records are not monetary canvas credits and remain in place.

Regression coverage includes the original wired-and-mentioned reference image,
deduplication, exact account model and receipt, no POST on local validation error,
authenticated polling/download and committed canvas output. Client checks passed
35 tests and TypeScript. Gateway controller/model/service checks passed; the Auto
capability regression fails against the original implementation.

The local client has been rebuilt and restarted. UI checks confirmed a plain
Generate button, visible model selection and the saved error. No paid video job
was automatically retried and existing failed job history was retained.

Gateway rollout completed on 2026-10-23 after the user confirmed access to
`40.160.141.231`. The running binary and local source shared baseline commit
`b405fcd06e70f47603ae9a967050acb02b640f61`. Only the reviewed capability-controller
change was compiled; the existing frontend bundles were retained. The deployed
version is `v0.0.0-b405fcd06-canvas-auto-fix`.

- Release and SHA-256 manifest:
  `/opt/new-api-native/releases/20261023-canvas-auto-fix/`.
- Rollback binary:
  `/opt/new-api-native/releases/backups/new-api.20261023-before-canvas-auto-fix`.
- Health, homepage, version, binary hash and unauthenticated capability rejection
  checks passed. `new-api-native` is active with zero automatic restarts.
- The actual desktop token now receives 80 capability entries instead of 3;
  the verified read completed in 323 ms. Grok and MiniMax video profiles are known.
- Client refresh retained 41 text, 9 image and 27 video models, and confirmed
  `grok-imagine-video` reference support and a 1–15 second duration range.

The saved failed job remains historical evidence. The next user-triggered run
uses the refreshed capability profile and creates a new upstream task. No paid
production generation was automatically retried during this rollout.
