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

This version establishes account identity only. Local projects remain in the device's
existing workspace; changing accounts does not isolate, upload, or synchronize them.
Cloud billing, balances, provider credentials and entitlement enforcement are separate
work. Offline identity must not be treated as authorization for cloud actions.

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
- `DELETE /api/desktop-auth/session`: bearer credential; revoke pending/active grant.

Only hashes are stored on the server. The separate request ID goes in the browser URL;
the secret token is never exposed to the renderer, URL, model or application logs.
Active credentials expire after 30 days; there is no refresh token in this version.
Pending requests are polled every four seconds; active accounts every minute.
Other web API routes do not yet accept these credentials.

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
