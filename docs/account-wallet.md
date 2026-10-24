# Desktop wallet and recharge

The signed-in account menu contains **钱包与充值**. The panel reads the current
Reizo workspace, available credits, payment methods, amount presets and recent
orders from the website. Custom amounts follow the server's integer minimum and
maximum. The user chooses an amount and payment method, then explicitly clicks
**去付款** to create an order and open the client's isolated cashier window.

Recharge belongs to the displayed Reizo workspace. It does not fund manually
configured third-party API keys. The local usage ledger is a separate view.
An unavailable balance is displayed as `—`, never as a zero balance.

## Payment behavior

- Only an authenticated online desktop grant can read the wallet or create orders.
  Workspace membership is revalidated on the website; owners and admins can pay.
- The order request pins the workspace the user reviewed. A changed current
  workspace is rejected instead of silently charging another workspace.
- Repeated clicks and uncertain retries reuse the request UUID. The server derives
  a unique order reference scoped to the device session, user and workspace.
  The existing `epay_orders.trade_no` unique index prevents duplicate inserts.
- **继续付款** reads the same pending order and opens its cashier. It never creates
  another order. Successfully settled orders allow another intentional recharge.
- Opening or closing the cashier does not mean payment succeeded. The panel
  polls the server while pending/crediting, backs off, and refreshes on window focus.
  The existing signed Epay notification remains the source of payment confirmation
  and quota crediting. Closing the panel stops its polling; reopening reads orders.
- The main process retains the desktop bearer. IPC exposes public wallet/order data
  only. A signed, order-specific cashier ticket expires within ten minutes; opening
  it revalidates the grant, account and workspace role. The main process permits
  only the configured website's exact cashier route, reads its signed purchase JSON
  and verifies order, amount, method and callbacks before opening the native window.
- The isolated native window submits the existing signed form directly to the
  merchant HTTPS gateway using `loadURL` POST data. It does not load the browser
  intermediate form. Its in-memory session has no desktop preload, Node integration,
  account cookies or desktop bearer. File/local-network navigation, downloads and
  permission requests are denied; HTTPS payment redirects stay in the cashier.
  Logout and account replacement close it; closing it refreshes the main wallet.

## Website integration

Matching source is in the sibling `winlume` checkout. These static routes take
precedence over its existing `/api/desktop-auth/[action]` handler:

| Route | Authorization | Behavior |
| --- | --- | --- |
| `GET /api/desktop-auth/wallet` | Desktop bearer | Current workspace, balance, config and recent orders |
| `GET /api/desktop-auth/wallet?organizationId=…&order=…` | Desktop bearer | Same-workspace order status and temporary cashier link |
| `POST /api/desktop-auth/wallet` | Desktop bearer | Explicit `{organizationId, amount, paymentMethod, requestId}` order creation |
| `GET /api/desktop-auth/cashier?ticket=…` | Signed short-lived ticket | Revalidate and render the existing signed Epay POST form; `Accept: application/json` returns its signed URL/fields to Electron main |

The adapter reuses `createConsoleTopupOrder`, the existing Epay configuration,
payment signatures, notification route and quota-crediting logic. Merchant secrets
remain on the website. No new schema migration or payment environment variables
are introduced; the previously deployed desktop-session migration is required.

The website patch is limited to `desktop-wallet.ts`, its two route handlers,
`console/topup.ts`, `console/server.ts`, `console/types.ts`, and desktop authorization
copy. Preserve unrelated changes in the sibling checkout. Deploy these changes
against the website's current source baseline before shipping the desktop client.
Do not publish the sibling checkout's unrelated dirty work as part of this feature.

## Verification and rollout

Native cashier update (2026-10-24): the website now serves purchase JSON for
Electron main under the same short-lived ticket and authorization checks. Production
build `abpSsCwgcDezcV5-YR4TD` was activated at 18:12:20 Asia/Shanghai; rollback is
`/opt/reizo-before-wallet-native-20261024`, with evidence in
`/opt/reizo-wallet-native-fix-20261024` and runtime `wallet-native-release.json`.
The retained source remains `/opt/reizo-wallet-build-20261024`. All 52 desktop
account/cashier tests passed, both projects pass TypeScript and targeted lint, and
51 regression tests plus the full build passed on the production build host.
Preview/live checks passed and migrations again applied zero changes.

The native development client was restarted. **继续付款** on the user's existing
CNY 10 pending order displayed the merchant cashier and a loaded Alipay QR code
inside the client window, with the correct order amount. No additional Reizo order
was created and no payment was made. The cashier remains open for the user; actual
payment-to-balance acceptance has not been performed by the agent.

The older browser intermediate page was reproduced as staying on **继续付款**.
Its browser-specific cause was not confirmed. The native flow bypasses that page
entirely using the validated signed POST; the old HTML branch remains compatible
for existing browser links. No broad CSP relaxation or disabled TLS verification
was introduced.

Local checks (2026-10-24): 37 desktop account/wallet tests and 28 web
wallet/order/payment tests pass; both projects pass TypeScript. New wallet source
passes targeted lint. Existing lint errors in the two browser/demo fallback files
predate their added wallet stubs. No real payment or billable order was created.

The web routes were deployed to `https://reizo-ai.com` on 2026-10-24 at
17:59:10 Asia/Shanghai, build `p7P6NNOy9CNsyKABFSZpX`. The native development
client was restarted and its existing signed-in account successfully loaded its
real workspace balance, presets, integer range and Alipay/WeChat methods. No real
recharge order was created and no payment was made. The desktop installer has not
been rebuilt.

Restart/rebuild Electron for the new main/preload IPC when distributing this change.
Verify read-only wallet/config/order retrieval with the existing account first.
Final payment acceptance requires an explicitly authorized real payment and checking
the matching successful order and updated workspace balance. Browser return alone
is insufficient. Rollback the website patch and desktop release together if needed;
existing Epay orders and payment notifications must be retained.

Production rollback: `/opt/reizo-before-wallet-20261024`; retained source:
`/opt/reizo-wallet-build-20261024`. Build/preview/deployment evidence and the nine-file
source manifest are in `/opt/reizo-wallet-fix-20261024` and runtime
`/opt/reizo/wallet-release.json`. The source began with the current production media
and OAuth fixes, and only the reviewed recharge files changed. Production-host
regressions passed 50 tests, production build and TypeScript passed, preview verified
10 existing routes and 21 static assets, and migration checks applied zero migrations
with all 16 already recorded. Existing environment bytes and runtime data were retained.
