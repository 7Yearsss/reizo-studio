# Account media catalog sync — 2026-10-23

The desktop now consumes a token-scoped `catalog` with separate text, image and
video entries from Reizo's desktop model-session endpoint. The legacy `models`
array remains text-only for existing clients. Catalogs contain public IDs,
protocols and confirmed capabilities; API keys remain in the main process.
Catalog changes invalidate the renderer's catalog version, including changes to
media models without any text changes.

The workbench picker and canvas model controls read this catalog for the Reizo
account. Invalid saved media defaults resolve to the first available model at
read time. Manually configured providers retain their existing routing.

Video uses new-api's `POST /v1/videos`, task polling and authenticated
`GET /v1/videos/:id/content`. Requests preserve gateway model IDs. Downloads stay
on the configured gateway, redirects are rejected, and uncertain submissions
are never automatically retried. Recovery validates the original gateway.
Unknown capabilities use upstream duration/ratio defaults and do not advertise
reference images, tail frames or camera controls. Verified JSON profiles may
enable bounded parameters and at most two reference images.

Channel endpoint flags can advertise video on ordinary chat models. Discovery
uses both model identity and endpoint flags, routes Gemini/Nano Banana images
through chat completions, and omits unsupported native-only, music and Midjourney
routes rather than presenting them as text or video models.

Validation: client unit/component coverage includes catalog parsing, account
leases, private settings, permission checks, gateway transport, picker routing
and canvas controls. Production web tests: 22 passed, followed by a production
build. Local client API and menu checks confirmed 41 text, 9 image and 27 video
models for the signed-in account. No paid image/video generation was submitted.

Web deployment: build `zbZYWWYkCS7xLX2kYjKHX`, service `reizo` on port 3001.
Rollback: `/opt/reizo-before-media-model-20261023`. Environment and runtime data
were retained, migrations reported 16 already recorded, and public health checks
passed. The prior GitHub username-conflict fix remains included.

The local development client was rebuilt and restarted with its existing profile
and verified against the deployed catalog. This does not create a downloadable
installer.
