# Reizo browser account login

The desktop account control uses the existing Reizo web identity system in the
`winlume` repository. Default website: `https://reizo-ai.com`.

## User flow

1. Click the account control at the bottom of the sidebar, choose **登录 Reizo**,
   then **使用浏览器登录**.
2. The desktop starts a ten-minute request and opens the system browser.
3. Use the website login (password, registration/recovery, or configured Google/GitHub
   providers), enter the confirmation code shown in the desktop, and explicitly approve.
4. The main process polls the request, securely stores the resulting account credential,
   focuses the desktop window, and displays the account name. The authorization
   dialog closes automatically and a single success toast confirms completion.
5. Restart restores the encrypted credential and revalidates it. Network failures show
   an offline identity; revocation, expiry, suspension or an authVersion change signs out.
6. **退出登录** revokes the desktop credential but does not sign out the browser. When
   offline, local logout succeeds but the UI reports unconfirmed server revocation.

The account now connects Chat Completions text models in the user's current Reizo
organization. Local projects remain in the device's existing workspace; changing
accounts does not isolate, upload, or synchronize them. Offline identity must not
be treated as authorization for cloud actions. Image/video protocol adaptation and
the account balance UI remain separate work.

## Account menu

The bottom-left account control opens an anchored menu instead of an account modal.
It contains account details/login, local usage, a light/dark/system appearance submenu,
settings, about/version and logout. Settings moved out of the top-level sidebar;
Ctrl+, (Cmd+, on macOS) opens settings even while the sidebar is collapsed. Usage and
about open their corresponding existing settings sections. Local usage is not a cloud
account balance or subscription quota.

Menus support keyboard navigation and Escape. Closing account details or completing
authorization restores focus to the account entry. Account mutations invalidate old
status reads so a late response cannot restore a locally signed-out identity.

Renderer regression tests cover menu navigation, settings shortcut, appearance saving,
authorization success/failed retry, dialog focus restoration, and stale logout reads.
The 6 renderer cases and 13 main-process account cases pass. TypeScript and targeted
lint pass (the sidebar retains its existing unused-code warnings). The user has
confirmed real browser login works. The running desktop picked up the new account
entry; full native menu visual acceptance was interrupted by concurrent user input.
No installer has been rebuilt for this UI change.

## Server contract and deployment dependency

Requires the matching winlume change and migration `0015_desktop_sessions`:

- `POST /api/desktop-auth/start`: requestId, secret token, display code, expiry, verificationUrl.
- `GET /api/desktop-auth/request?request=...`: public pending/expiry check only.
- `POST /api/desktop-auth/approve`: browser session, same-origin JSON and confirmation
  code; one conditional update claims the pending request.
- `GET /api/desktop-auth/session`: bearer credential; pending or current public identity.
- `GET /api/desktop-auth/model-session`: active desktop bearer; current workspace,
  device model key, public gateway `/v1` URL, lease expiry and compatible text models.
- `DELETE /api/desktop-auth/session`: expire the grant, revoke its device model keys,
  then remove the grant. Failed upstream revocation remains retryable.

Only hashes of desktop login secrets are stored on the server. The separate request ID goes in the browser URL;
the secret token is never exposed to the renderer, URL, model or application logs.
Active credentials expire after 30 days; there is no refresh token in this version.
Pending requests are polled every four seconds; active accounts every minute.
Other web API routes do not yet accept these credentials.

## Account model bridge (2026-10-23)

The web service validates the desktop grant, current account status/authVersion and
current organization membership before issuing a device-specific new-api Token.
It reuses the existing organization-to-new-api mapping and `auto` group routing;
the organization's shared hidden Studio key and management PAT stay on the server.
The device token is encrypted in the existing `api_keys` table and associated with
the desktop session through metadata. No additional migration is needed beyond the
existing desktop-session migration. The key uses workspace quota, not a separate
desktop balance, and is subject to the workspace's gateway permissions.

Model keys have a ten-minute upstream lease, bounded by the desktop session expiry.
An authenticated refresh renews the lease when fewer than two minutes remain. Active
clients refresh each minute. Explicitly disabled/revoked keys are never re-enabled;
automatically expired keys may renew. Workspace switches revoke the old workspace's
device key and mint a new one, including when switching back. Concurrent refresh and
logout requests serialize on the device session row. Queries and token repository
operations reuse the same database transaction connection.

Normal logout revokes upstream access. If the device is offline, local access stops
immediately but a previously copied upstream key can remain usable until its lease
expires (at most ten minutes from issuance/renewal). Reizo account suspension or
membership changes stop refresh authorization; new-api independently enforces its
own current quota and permissions. This is not instantaneous global revocation of
already issued upstream secrets. In-progress model requests are not cancelled by
logout in this phase.

The main process stores the lease inside encrypted `account-session.enc`; it is
never returned through account IPC or public settings, and never written into
`settings.json`. Restart must revalidate before using cached model credentials.
The separate `reizo-account` provider resolves at read time; existing manual keys
and provider choices are preserved. If the selected provider has no manual key,
a valid account lease becomes the effective text provider. The settings UI offers
model selection without key editing for this provider. A selected account provider
fails closed after logout rather than falling back to another provider's key.

The bootstrap catalog is fetched using the actual device token and only includes
models advertising the `openai` Chat Completions endpoint type. Native-only,
Responses-only, image and video models are excluded from this phase's text list.

Deployment requires winlume's matching model-session route, its existing PostgreSQL
configuration, organization/new-api mapping and encryption configuration, and
`REIZO_GATEWAY_BACKEND=new-api` (the adapter default). `NEW_API_URL` is required for
token management. Set `NEW_API_PUBLIC_URL` to the client-reachable HTTPS root origin
of the same new-api deployment if the internal address differs; otherwise it defaults
to `NEW_API_URL`. The bridge adds `/v1` itself. Loopback HTTP is development-only.
The desktop requires a rebuild/restart to load the new main-process wiring.

Local verification uses the sibling winlume checkout and `REIZO_DESKTOP_SOURCE` as
described below. Route/service tests exercise device creation/reuse, renewal,
membership rejection, workspace switching, revocation failure/retry, concurrency,
and the real desktop protocol. A desktop test composes settings resolution with
the real AI SDK transport and a mocked Chat Completions reply, without any manual
key or paid model call. These checks do not replace production PostgreSQL/new-api
acceptance. Neither website deployment nor installer creation is part of this change.

Current checks: 33 targeted desktop tests and 52 targeted web tests pass with the
cross-repository acceptance enabled. Both projects pass TypeScript; targeted lint
has no errors, with desktop non-null assertion warnings. The older verification
section below records the original login-only release.

Local `account-session.enc` uses Electron safeStorage and refuses plaintext fallback,
including Linux `basic_text`. Unavailable encryption causes a visible login failure.
IPC permits only the application's top-level renderer. Credential requests use the
configured origin, reject redirects, and have a 15-second timeout.

For local development set `REIZO_ACCOUNT_ORIGIN=http://127.0.0.1:<web-port>` before
launching the desktop and set winlume's `NEXTAUTH_URL` to that exact origin. HTTP is
allowed only on loopback in unpackaged development. Production overrides must be
HTTPS origins without paths, queries or embedded credentials. Before website deployment,
login displays a not-enabled/unavailable message rather than simulating success.

## Verification (2026-10-15)

- Desktop account service/encrypted storage: 13 tests pass, including revocation
  while the old credential file cannot be removed.
- Web helpers, routes and existing password/identifier/account regression: 32 tests
  pass with the optional cross-repository acceptance test enabled.
- The contract test imports the real desktop service and calls real web handlers with
  an in-memory database adapter: start → pending → approve → authenticated → restart
  → logout → old credential rejected. It is not production database/OAuth acceptance.
- Production migration/deployment and installer creation have not been performed.
- Both projects' TypeScript checks and the new authentication files' targeted lint
  pass. The showcase transport has three pre-existing lint errors (reproduced against
  HEAD); winlume has an unrelated existing trailing blank line in catalog/plaza tests.
- The development app starts and the account entry is visible. Native interaction
  was stopped when the user resumed input/minimized the window, so modal/confirmation
  code visual acceptance is not claimed.
- Local web preview launch was rejected by automatic approval; no reason was supplied.
  Browser visual acceptance of the new web page is therefore pending.

To run the web contract test, set `REIZO_DESKTOP_SOURCE` to this checkout's absolute
path, then run `src/app/api/desktop-auth/[action]/route.test.ts` in winlume.
