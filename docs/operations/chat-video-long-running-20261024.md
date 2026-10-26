# Long-running chat video recovery — 2026-10-24

## Evidence

A MiniMaxH3-720p video accepted at 14:27 was still processing at the old
10-minute client cutoff. The user's gateway screenshot reports successful
completion after 1,094 seconds. The runtime incorrectly persisted an
`interrupted` query outcome although the remote generation was still active.

The original local job is `33efr4_lhhpEzId6VQZJY`. It retains its terminal
history. A new query-only receipt `dtu0fzB64TSPzYeFgWxP0` retrieved the same
remote task successfully; the playable five-second video is now visible in
the original chat card, alongside download and canvas reuse actions.

## Changes

- Removed the fixed 10-minute interruption and five-query-error cutoff.
- Queries slow from 2.5 seconds to 10 seconds after one minute, and 30 seconds
  after ten minutes. Retryable transport errors back off to at most one query
  per minute; they do not submit another generation.
- Polling uses current credentials while preserving the saved provider,
  gateway context, model and remote task ID. Hiding a model from new generation
  choices does not by itself prevent querying an already accepted task.
- Chat cards show waiting time, provider-reported progress when supplied,
  queue/reconnection/download state and background tracking guidance.
- An interrupted remote task can be explicitly queried through
  `POST /api/canvas/:canvasId/jobs/:jobId/query`. This creates an idempotent,
  linked receipt without changing terminal history or creating a new paid
  submission/usage entry. Superseded, cancelled and handle-less jobs cannot
  use this recovery. GET of the original receipt includes the saved recovery
  separately so its chat card can restore the result after remount.

## Validation

Regression coverage reproduces the original cutoff by advancing the clock
twenty minutes, then checks later successful delivery with exactly one submit.
Coverage also includes query backoff/reconnection, rotated credentials,
hidden-model query recovery, immutable terminal history, HTTP idempotency and
canvas ownership, and chat progress/recovery rendering.

The native development app was restarted. Its new **继续查询** control retrieved
the original MiniMax video and visibly displayed the playable result in chat.
No new generation or production gateway configuration change was performed.

The upstream generation time itself is unchanged; this fixes waiting and
result recovery in the desktop workbench.
