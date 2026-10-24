# Image request used a text-only gateway group — 2026-10-24

## Evidence

At 16:14:12 the automatic chat image request for `gpt-image-2` received HTTP 503.
The gateway request ID is `202610240814127286055628268d9d6XYNouo3R`.
Both the local provider error and a targeted read of the gateway journal report
no available channel for that model in `gpt-不降智分组` (the distributor).
This failed during channel selection, before upstream image generation.

The desktop had an active manual `reizo` text provider and a separate, signed-in
`reizo-account` media catalog containing `gpt-image-2`. Automatic video routing
already used the account media credentials independently, but image routing and
the image pickers still followed the active text provider. A read-only channel
query confirmed enabled image channels in image groups, not in the selected
text-only group. No gateway configuration was changed or generation resubmitted.

## Fix

- Automatic images use account media credentials when the account advertises the
  selected model, or when no image model has been selected. Prefer `gpt-image-2`
  only if advertised, otherwise use an advertised catalog default.
- Explicit provider identity and models exclusive to manually configured
  providers are retained. No failed request is automatically retried or migrated.
- Chat and canvas image model pickers use the same real account media catalog
  independently of the text model.
- A distributor no-channel error is distinct from a generic transient server
  error. The public message explains the account group/model configuration and
  includes a validated request ID when supplied.

Regression coverage exercises the original manual-text/account-image settings,
actual chat image execution and persisted provider identity, catalog-only
defaults, explicit manual providers, picker contents and the captured gateway
error. Network generation is mocked in tests; no paid verification was initiated.
