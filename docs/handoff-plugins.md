# Handoff: 插件 / 扩展 (plugins, MCP, hooks, discover)

Branch `feat/harness-extensibility` (branched from `feat/doc-history-multiselect`'s HEAD `69653b4`). Read `CLAUDE.md` and `CONTEXT.md` first.

## What the user wants

A first-class extension story in Reizo Studio, usable by non-technical users from the UI:

- Users can add **MCP servers**, **hooks**, and **plugins ("扩展包")** without editing JSON.
- A browsable **catalog** ("发现") so users just click Add. We do NOT bundle plugins; we list public catalogs.
- Plugin folders follow the **Claude Code / Codex layout** so existing plugins work.
- Trust matters: nothing from a plugin runs until the user enables it, and enabling shows exactly what will run.

The user's latest request (not done): the catalog cards are all text and feel dull, so **add logos**.

## What is built and committed

| Commit | What |
|---|---|
| `bd1a74d` | Per-turn trace (`traces/<session>.jsonl`) + English-reasoning-leak detector |
| `da954bb` | User hooks, MCP servers (`@ai-sdk/mcp`), read-only `delegate_research` sub-agent |
| `5849e3c` | Extension packs: install from a local folder, enable/disable/uninstall, Plugins page section |
| `6437f96` | Fix: inline `<think>…</think>` leaking into replies (middleware + renderer strip) |
| `c8443a7` | Settings → 扩展（MCP / Hooks） UI: add/edit/disable/delete, MCP "test connection" |
| `3a1e3c9` | Discover catalogs: official MCP registry + Claude plugin marketplace, one-click add/install |

### File map

Backend (all under `src/main/server/`):
- `agent/hooks.ts` — `hooks.json` parser (flat + Claude nested format, tool-name mapping), runner (stdin JSON, exit 2 = block, process-tree kill on timeout), `wrapToolsWithHooks`.
- `agent/mcpTools.ts` — `mcp.json` parser, `connectMcpTools` (parallel connect, per-server failure isolation, `mcp__<server>__<tool>` names, approval gate, rug-pull baseline in `mcp-baseline.json`, `onlyServers` dry-run for the test button).
- `agent/subagentTools.ts` — `delegate_research` (read tools only, 24 steps, max 3 concurrent).
- `agent/turnTrace.ts`, `agent/reasoningLeak.ts`.
- `agent/permissions.ts` — `needsApproval`: `mcp__*` tools ask unless permission mode is `full`.
- `agent/runtime.ts` — wires all of the above into `runChatTurn`.
- `agent/provider/openai.ts` — `withThinkTagExtraction` wraps third-party gateway models.
- `plugins/pluginStore.ts` — inspect/install/list/enable/uninstall packs; `loadPluginContributions`; `syncPluginSkillsDirs` (mutates the shared skills-dir array; packs go first so bundled/user skills win).
- `plugins/extensionConfig.ts` — read/write `mcp.json` / `hooks.json` (keeps `.bak`), `testMcpEntry`.
- `plugins/catalog.ts` — MCP registry client, Claude marketplace parser, GitHub-zip download/extract, `installCatalogPlugin`.

Main/IPC: `src/main/pluginsIpc.ts` (all channels), registered in `src/main/index.ts`. Channels are in `src/shared/constants.ts`; bridge in `src/preload/preload.ts`; types in `src/shared/window.d.ts`, `src/shared/{plugins,extensionConfig,catalog}.ts`. The web stub `scripts/landing-experience/transport.ts` must list every new bridge method or `tsc` fails.

Renderer:
- `src/renderer/pages/settings/ExtensionsSection.tsx` (+ `extensionForm.ts`) — exports `McpForm`, reused by the catalog dialog.
- `src/renderer/components/skills/ExtensionPacksSection.tsx` — installed packs; exports `PACKS_CHANGED` event name.
- `src/renderer/components/skills/CatalogSection.tsx` — "发现" (扩展包 / MCP 服务 tabs).
- `src/renderer/pages/PluginsPage.tsx` renders ExtensionPacksSection, CatalogSection, then the existing skills + SkillHub sections.
- `src/renderer/components/chat/PermissionPrompt.tsx` — shows `MCP server / tool` in the approval card.

User data (all under `<userData>/data/`): `hooks.json`, `mcp.json`, `mcp-baseline.json`, `plugins/<id>/`, `plugins-state.json`, `traces/`.

## COMPLETED: logos for catalog cards (done & verified)

All parts of the catalog logo and visual enhancement have been built, verified in unit tests, and live-tested in the Electron window via CDP:

- `src/shared/catalog.ts`: `McpCatalogItem.icons: string[]`, `PluginCatalogItem.title` and `.icons`.
- `src/main/server/plugins/catalog.ts`: `githubAvatar(owner)`, `mcpIcons()` (registry `icons[].src` → GitHub owner avatar from `repository.url` → `<website origin>/favicon.ico`), plugin `icons: [githubAvatar(owner)]`, plugin `title` from `displayName`.
- `src/main/server/plugins/catalog.test.ts`: updated with icon/title assertions, priority ordering tests, and non-http filtering tests.
- `src/renderer/components/skills/tileColor.ts` (+ `.test.ts`): pure helper (`letterTile`, `letterTileStyle`) extracting initial uppercase letter and deterministic hue (0..359).
- `src/renderer/components/skills/CatalogIcon.tsx` (+ `.test.tsx`): tries candidate URLs in preference order (`icons[]`), handles `onError` gracefully, renders behind-the-scenes deterministic letter tile while loading to eliminate broken image glyphs. Supports `letterOnly`.
- Cards updated:
  - `CatalogSection.tsx`: `McpCard` (logo + title), `PluginCard` (logo + title), and Add MCP `DialogHeader`.
  - `ExtensionPacksSection.tsx`: `PackCard` (letter tile).
  - `ExtensionsSection.tsx`: MCP server card (letter tile).
- Verified via CDP: live window screenshot confirms remote logos render (Adobe, Salesforce, Anthropic, Airtable, etc.) and letter tiles tint correctly. Unit tests pass (43/43 in skills/plugins suite), eslint clean, typecheck clean.

## COMPLETED: MCP process reuse, Node.js detection & Rug-pull retrust (done & verified)

1. **MCP Session Process Reuse (`McpClientPool`)**:
   - MCP client connections are cached per-session (`sessionMcpPool`) across chat turns rather than re-spawning node/npx processes on every turn.
   - LRU cache eviction keeps at most 5 active sessions; sessions clean up on delete and app shutdown.
   - Configuration digest invalidation automatically restarts servers when configuration changes.
   - Self-healing evicts dead sessions upon unexpected transport exit so the next turn reconnects.
2. **Node.js Environment Detection**:
   - `checkNodeEnvironment()` IPC checks whether `node` / `npx` is available on the system PATH with a 10s TTL cache.
   - `CatalogSection.tsx`: Shows "缺少 Node.js" warning badges on npm-based MCP cards if Node is missing, or version tooltip when installed. Add dialog warns if Node.js is missing for npm servers.
   - `ExtensionsSection.tsx`: Shows "缺少 Node.js" warning badges on stdio cards using `node`/`npx` and warns inside `McpForm`.
3. **Rug-Pull Guard Visual Indication & One-Click Re-trust**:
   - Streamed warnings: when tools are withheld, runtime emits `notice` stream events (`warn` tone) and injects instructions notice; `chatStore` displays toast warnings.
   - Settings & Form: `McpForm` renders a "重新信任此服务" button if test results report withheld tools.
   - Card Action: Every MCP server card in Settings → Extensions has a `ShieldCheck` button to reset baseline for that server with one click.
   - IPC: `IPC.MCP_RESET_BASELINE` supports resetting single server or all baselines.
   - All unit tests and CDP E2E tests pass.

## COMPLETED: Quick Connect for Notion & Google Mail (done & verified)

Built a zero-friction "常用服务直连" (Quick Integrations) experience in Reizo Studio, addressing user feedback that manual stdio/npx JSON configuration is intimidating:

1. **Local-First Direct Connection (No Cloud Server Needed)**:
   - **Notion**: Direct remote HTTP MCP (`https://mcp.notion.com/mcp`) using Notion Internal Integration Token. Zero local `node`/`npx` processes spawned. Tests connectivity via `testMcpEntry` before writing to `mcp.json`.
   - **Google Mail (Gmail)**: Local dynamic PKCE OAuth 2.0 loopback server (`http://127.0.0.1:<port>/callback`). Automatically generates S256 code challenge, launches default system browser, intercepts redirect code, fetches refresh token from Google, retrieves verified user email from Google userinfo API, and writes to `mcp.json`. Zero relay proxy needed.
   - **Disconnect & Pool Invalidation**: Disconnecting cleanly purges config and drops active session pools.
2. **IPC & Bridge Wiring**:
   - `src/main/server/auth/quickIntegrations.ts`: Core service logic + unit tests in `src/main/server/auth/quickIntegrations.test.ts` (5/5 passing).
   - IPC channels: `INTEGRATIONS_STATUS`, `INTEGRATIONS_CONNECT_NOTION`, `INTEGRATIONS_CONNECT_GOOGLE`, `INTEGRATIONS_DISCONNECT`.
   - Exposed on `window.reizo` via `preload.ts` and stubbed for web tests in `scripts/landing-experience/transport.ts`.
3. **Frontend UI Integration (`QuickIntegrationsBlock.tsx`)**:
   - Rendered at the top of Settings → 扩展 (Extensions) above custom MCP servers.
   - Status badges (`未连接` / `已连接` + account email/workspace) and stateful action buttons (`一键连接 Notion`, `启动 Google 授权`, `重新配置`, `断开`).
   - `NotionConnectModal`: 30-second token guide, direct link to Notion integration center, token input, and "连接并测试" with loading spinner.
   - `GoogleConnectModal`: Google Cloud Credentials link, `credentials.json` one-click file import, manual Client ID/Secret fields, and "启动浏览器一键授权" with in-progress polling indicator.
4. **Automated Verification**:
   - Automated CDP E2E verification script (`scripts/verify-quick-integrations.mjs`) tested against the live running Electron app: verified status IPC, settings navigation, DOM elements, and modal openings.
   - UI screenshots captured and verified: `quick-integrations-overview.png`, `notion-modal-opened.png`, `google-modal-opened.png`.

## COMPLETED: Domestic Quick Integrations for Feishu, WeCom, DingTalk & Yuque (done & verified)

Extended the one-click quick integrations suite to fully support key Chinese domestic collaboration and knowledge services ("主攻国内的 国内的要集成全一点"):

1. **Zero-Dependency Built-in MCP Servers (`src/main/server/mcp-builtin/`)**:
   - Packaged standalone JSON-RPC 2.0 stdio servers running via Electron's built-in Node.js engine (`process.execPath` + `ELECTRON_RUN_AS_NODE: '1'`).
   - Requires zero npm install, zero external node dependencies, and works out-of-the-box on clean client machines:
     - `wecom-server.cjs`: Enterprise WeChat custom group bot webhook runner (`wecom_send_markdown`, `wecom_send_text`).
     - `dingtalk-server.cjs`: DingTalk custom group bot webhook runner with HMAC-SHA256 timestamp signature authentication (`dingtalk_send_markdown`, `dingtalk_send_text`).
     - `yuque-server.cjs`: Yuque cloud knowledge base client using personal access tokens (`yuque_get_user`, `yuque_list_repos`, `yuque_search_docs`, `yuque_get_doc`, `yuque_create_doc`).
     - `feishu-server.cjs`: Feishu/Lark open platform runner using App ID & App Secret with auto-refreshed tenant access tokens (`feishu_get_bot_info`, `feishu_send_message`, `feishu_get_bitable_records`).
2. **Backend Authentication & Connectivity Validation (`src/main/server/auth/quickIntegrations.ts`)**:
   - Added `connectFeishuIntegration`: fetches tenant token and queries bot name for live verification.
   - Added `connectWeComIntegration`: validates webhook structure, stores optional bot name, registers built-in MCP entry.
   - Added `connectDingTalkIntegration`: verifies Webhook URL and optional sign secret, registers built-in MCP entry.
   - Added `connectYuqueIntegration`: queries Yuque `/api/v2/user` to verify personal access token before registration.
   - Disconnect cleanup: gracefully disconnects domestic services, invalidates session pools, and cleans `mcp.json`.
   - Comprehensive unit test coverage: `src/main/server/auth/quickIntegrations.test.ts` (11/11 passing).
3. **Frontend UI Integration (`src/renderer/pages/settings/QuickIntegrationsBlock.tsx`)**:
   - Category filter tabs: `全部 (6)`, `国内办公 (4)`, `海外服务 (2)`.
   - Brand SVG icons for Feishu (cyan), WeCom (blue), DingTalk (sky), Yuque (emerald).
   - Interactive configuration dialogs:
     - `FeishuConnectModal`: App ID + App Secret input with guide to Feishu Open Platform.
     - `WeComConnectModal`: Webhook URL/key input with guide to creating WeCom bots.
     - `DingTalkConnectModal`: Webhook URL + optional HMAC sign secret input with guide.
     - `YuqueConnectModal`: Personal access token input with link to Yuque token settings.
4. **Live Verification**:
   - Vitest suite passing (11/11 tests).
   - E2E script `scripts/verify-quick-integrations.mjs` ran against the live Electron app, capturing:
     - `quick-integrations-all-services.png`
     - `quick-integrations-domestic-tab.png`
     - `feishu-modal-opened.png`
     - `wecom-modal-opened.png`
     - `dingtalk-modal-opened.png`
     - `yuque-modal-opened.png`

## COMPLETED: Official Multi-Color Brand Logos & Gitee / GitHub Integrations (done & verified)

Completed the multi-color brand logo integration and expanded the built-in quick integrations suite to 8 services (5 domestic, 3 global):

1. **Brand Vector Logos & Simple Icons Component (`src/renderer/components/ui/BrandIcon.tsx`)**:
   - Supports authentic official multi-color vector SVGs for domestic & global services (`feishu`, `wecom`, `dingtalk`, `yuque`, `gitee`, `notion`, `gmail`, `github`, `bilibili`).
   - `SimpleIcon` fallback component dynamically loads brand logos via `https://cdn.simpleicons.org/{slug}` with deterministic letter-tile fallback.
   - 100% offline reliability for built-in services, zero broken glyphs.
   - Comprehensive unit test coverage in `src/renderer/components/ui/BrandIcon.test.tsx` (5/5 passing).

2. **Gitee (码云) Integration (Domestic #1 Code Hosting)**:
   - Built-in zero-dependency MCP server `src/main/server/mcp-builtin/gitee-server.cjs` implementing `gitee_get_user`, `gitee_list_repos`, `gitee_get_file`, `gitee_search_issues`, `gitee_create_issue`.
   - Token validation against `https://gitee.com/api/v5/user` before saving to `mcp.json`.
   - `GiteeConnectModal` with 10-second token guidance and link to personal access tokens.

3. **GitHub Integration (Global Open Source & Code Hosting)**:
   - Built-in zero-dependency MCP server `src/main/server/mcp-builtin/github-server.cjs` implementing `github_get_user`, `github_list_repos`, `github_get_file`, `github_search_issues`, `github_create_issue`.
   - Token validation against `https://api.github.com/user` before saving to `mcp.json`.
   - `GitHubConnectModal` with 10-second token guidance and link to personal access tokens.

4. **Testing & Verification**:
   - `npm run typecheck`: clean 0 errors.
   - `npx eslint`: clean 0 errors.
   - Vitest unit tests: 20/20 tests passing across `quickIntegrations.test.ts` and `BrandIcon.test.tsx`.
   - E2E script `scripts/verify-quick-integrations.mjs` ran against the live Electron app, verifying all 8 cards, category tabs (`全部 (8)`, `国内办公 (5)`, `海外服务 (3)`), and opening modals (`gitee-modal-opened.png`, `github-modal-opened.png`).


## Remaining ideas / next steps

- Plugins that only define **sub-agents** (`agents/`) install as empty packs (a warning is shown). Claude `commands/` are loaded as skills; `$ARGUMENTS` placeholders are not substituted.
- Only GitHub-hosted plugins are supported; install from an arbitrary GitHub URL or custom marketplace sources is not built. The marketplace is hard-coded to `anthropics/claude-plugins-official` in `catalog.ts`.
- Hook events: only `PreToolUse` / `PostToolUse`. Claude hook scripts that read specific tool-input field names (e.g. `file_path`) may need adjusting (our write tool uses `path`).
- The per-turn step cap (`isStepCount(64)` in `runtime.ts`) is still hard-coded.
- `runtime.ts` has no unit test of its own.

## Gotchas learned the hard way

- **Restart the Electron app after any main-process change** (`src/main/**`, IPC channels). The renderer and preload hot-reload; the main process does not, so the UI calls IPC handlers that don't exist yet (`No handler registered for 'reizo:…'`). Stop the old `npm start` first; don't `taskkill electron.exe` blindly (other Electron apps, such as the Claude desktop app, share the name).
- **`<think>` blocks**: some gateways put reasoning inline in text and leave earlier ones unclosed; a line starting with `</think>` also makes Markdown swallow later `**bold**` as an HTML block. Already handled; don't remove `withThinkTagExtraction` or `stripThinkTags`.
- **Windows hook timeouts**: `shell: true` + `child.kill()` only kills the shell; use the tree kill in `hooks.ts` and don't wait for `close` after a timeout.
- **Editing files from scripts**: many repo files are CRLF. Python/sed edits that embed `\n` or `\u` escapes inside TS string literals have corrupted files twice. Prefer the editor tool; run `npx tsc --noEmit` right after.
- `tsc` always reports one unrelated error in `forge.config.ts` (`continueOnError`); ignore it.
- Full-suite `vitest` occasionally flakes one test under load (`canvasMaintenance`, one DOM test); rerun before suspecting your change.
- Don't add `eslint` irregular whitespace (full-width spaces) or control characters in source.

## How to verify

```bash
npm run typecheck        # only the forge.config.ts error is expected
npx eslint <changed files>
npx vitest run           # ~1230 tests; rerun once if a single test flakes
npm start                # restart after main-process changes, then click through the flows above
```

## Uncommitted files that are NOT part of this work

Leave these alone; they belong to a different feature (document suggestion cards): `src/main/server/agent/documentTools.ts`, `src/renderer/components/agents/{todo-list,tool-result}.tsx`, `src/renderer/components/chat/{AssistantMessage,MemoryEventRow,ToolCard,UserMessage,WorkGroupCard,ReviewProposalCard}.tsx`. (`ReviewProposalCard.tsx` got a small "compact rows when more than 3 changes" tweak from this session.) Also untracked screenshots and scratch files in the repo root (`amazon-*.png`, `product-*.png`, `_*.py`, `memory/`, `artifacts/`).
