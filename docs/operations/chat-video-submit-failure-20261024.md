# Chat video submission failure — 2026-10-24

The 14:09 request for `grok-imagine-video-1.5`, 5 seconds and 16:9 reached
the gateway. It failed before receiving a remote task ID. The gateway request
`202610240609072288734058268d9d6hAhqDuNN` received three upstream 503 responses:
`No eligible Grok media accounts` (`grok_media_no_eligible_account`). The active
`new-grok` channel (232) points at `app.22codex.xyz`; the other channel offering
the same model (80) is disabled. The gateway exhausted its eligible channels,
returned HTTP 500 and logged the refund of the failed request's precharge.
No gateway configuration was changed and no paid generation was retried.

The chat tool had returned its local `queued` receipt before provider submission
finished. The assistant consequently claimed submission success while the card
later showed failure. Chat now briefly awaits the submission receipt (at most
15 seconds), reports the remote task ID only when present, and distinguishes
`not_submitted`, `unconfirmed` and `submitted`. Failed and uncertain results
explicitly forbid success claims and automatic resubmission. Shutdown releases
the wait without querying a stopped store.

The video driver previously discarded the gateway response body and always
suggested checking quota/configuration. It now preserves bounded, sanitized
JSON error messages and a public request ID. Raw error pages and credential
values are excluded from saved chat errors. Transport failures remain uncertain
and are never automatically retried.

Client regression fixtures cover the observed HTTP 500, immediate provider
rejection, a slow/uncertain submission, accepted remote receipts, shutdown,
credential redaction and non-JSON error pages. These fixes improve state and
diagnostics; successful generation still requires the upstream service to
restore an eligible Grok media account or the operator to configure a working
channel for that exact model.
