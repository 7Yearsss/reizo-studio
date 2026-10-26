# Reizo 工作台登录与模型 API 调用梳理

## 第一阶段实现进展（2026-10-23）

已在本地接通 Reizo 桌面会话 → 当前工作区 → 独立设备 auto Token → 文本 Chat Completions。
客户端新增 `reizo-account` 入口，不覆盖手动 Key；登录后动态取得可用文本模型，重启需重新验证，退出停止使用。
winlume 新增 `GET /api/desktop-auth/model-session`，复用现有工作区映射与 `api_keys` 元数据；设备模型凭据有效期十分钟，定期续期，退出时撤销。
本次未修改 new-api。图片、视频协议与统一能力目录仍按下方审计建议后续推进。

本地协议、权限、并发和模拟文本请求已验证；尚未部署网页服务或执行生产数据库/new-api 联调。部署配置与边界见 [account-login.md](./account-login.md)。

下方保留首次审计时的情况，不能当作以上改动后的实时实现状态。

日期：2026-10-23。

目标已确认：沿用 Reizo 账号，由服务端关联对应的 new-api 账户；客户端登录后取得可用的 auto API Key，调用文本、图片、视频模型，不要求用户再手动填写 Key。

结论：现有系统已有账号登录、工作区与 new-api 账户映射、auto 令牌签发、文本和部分图片协议适配；尚未打通“桌面登录 → 模型凭据 → 按权限发现模型 → 三类模型统一执行”。视频是协议层面的明确缺口，不能只把同一把 Key 填到现有驱动里。

## 1. 核查范围和证据边界

| 项目 | 本次检查基线 | 作用 |
| --- | --- | --- |
| `F:/selfProject/reizo-studio` | `240b659`，检查时工作区干净 | Electron 客户端、本地 Hono API、Agent、画布生成任务 |
| `F:/selfProject/new-api` | `b405fcd06`，本地 main 领先 origin/main 14 个提交 | 模型网关、令牌权限、分组路由、计费、多供应商协议转换 |
| `F:/selfProject/winlume` | HEAD `3a2079d`，存在本地暂存、未暂存及未跟踪改动 | reizo-ai.com 的账号系统、工作区、new-api 映射和虚拟 Key 代理 |

网页项目的桌面登录相关文件在本地存在未跟踪状态，因此不能只用 HEAD 表示其当前实现。本文依据实际工作区源码，不代表线上部署版本。没有读取、输出真实密钥，也没有发起付费模型调用。

## 2. 当前真实调用链

### 2.1 桌面登录仅建立身份

```text
Electron 主进程 AccountService
  → https://reizo-ai.com/api/desktop-auth/start
  → 系统浏览器 /desktop/connect，网页登录并确认
  → GET /api/desktop-auth/session 轮询
  → 返回 user + expiresAt
  → 本机 account-session.enc 安全保存桌面会话凭据
```

这不是 new-api 的 API Token。主进程没有在登录成功后获取模型 Key、配置 Reizo Provider，或向模型执行器提供账号凭据。

证据：

- `src/main/account/ipc.ts:10`：默认账号服务为 `https://reizo-ai.com`。
- `src/main/account/service.ts:57`：只调用 `/api/desktop-auth/*`。
- `src/main/account/service.ts:117`：登录保存的是桌面 token、origin、expiresAt、user。
- `F:/selfProject/winlume/src/app/api/desktop-auth/[action]/route.ts:66`：认证响应只有身份和过期时间。
- `docs/account-login.md` 明确说明：当前版本不包含云端计费、Provider 凭据及权限接通。

new-api 虽然另有 `/desktop/authorize` 和 `/api/desktop/oauth/token`，但目前服务于 `v2api-code-hub` 客户端，交换的是其用户访问凭据；它与 Reizo 的 `/api/desktop-auth/*` 不是同一套协议，不能直接互换。

### 2.2 网页端已经有工作区与 auto Key 的关联

```text
Reizo 用户
  → currentOrganizationId（当前工作区）
  → organization_memberships 校验成员身份
  → team_new_api_mapping（工作区对应 new-api 用户）
  → api_keys 中隐藏的 Studio Key 记录
  → 解密 new_api_key_ciphertext
  → new-api group=auto 的模型调用令牌
```

新用户初始化时，网页服务会创建工作区和 new-api 用户，通过 `createTeamToken(..., { allAvailableGroups: true })` 创建 Studio Token，再保存映射和加密后的上游 Key。

这里的计费归属是**当前工作区对应的 new-api 账户**，不是每个 Reizo 成员都有独立的上游账户。一个用户切换工作区，模型调用身份和额度来源也应随之切换。

证据：

- `F:/selfProject/winlume/src/lib/platform/provision.ts:72`：创建可路由到全部已授权分组的 Studio Token。
- 同文件 `:129`：保存加密 Key，标记为隐藏 Studio Key。
- `F:/selfProject/winlume/src/lib/agent/provider/studio-token.ts:9`：按当前工作区和成员资格解析 Key。
- `F:/selfProject/winlume/src/lib/platform/repositories/team-new-api-mapping.ts:38`：按工作区查 new-api 账户映射。

### 2.3 当前客户端模型调用读取本机配置

```text
聊天 / 画布 Agent / 图片生成
  → settings.providers[providerId].apiKey
  → ProviderResolver
  → 默认 Reizo Base URL: https://v2api.top/v1
  → new-api → 上游模型

视频生成
  → 独立的 Managed Provider 配置或旧驱动配置
  → mock / kling / fal
  → 对应供应商协议
```

账号状态与 Provider 配置互相独立。因此当前“已登录”不等于“能调用模型”；退出 Reizo 登录也不会清理另行保存的手动 Provider Key。

主要入口：`src/main/server/providerResolver.ts:19`、`:74`、`:92`。

## 3. 文本、图片、视频的适配现状

| 能力 | new-api 接口/能力 | 客户端现状 | 距离目标的缺口 |
| --- | --- | --- | --- |
| 文本聊天、Agent 工具调用 | `/v1/chat/completions`、`/v1/responses` 等 | Reizo 网关走 Chat Completions，已有流式输出、工具和推理内容处理 | 登录 Key 自动解析、动态模型目录；只支持其他原生协议的模型仍须适配或由网关转换 |
| 画布 Agent、提示词优化、文档重写 | 与文本共用模型凭据 | 多个入口已使用 `resolveSettingsModel`；记忆处理复用传入的 LanguageModel | 必须一起接入账号凭据，不能只改聊天输入框 |
| 标准同步生图/图片编辑 | `/v1/images/generations`、`/v1/images/edits` | 已通过 OpenAI Image SDK 接入；网关仅返回 URL 时可补下载为 base64 | 登录 Key、动态目录、按能力校验尺寸和参考图等参数 |
| Gemini 图片 | 网关兼容聊天生图时可走 `/v1/chat/completions` | 画布已有按 Gemini image 模型名识别的专门分支 | 不能由此推断任意 Gemini 原生接口、任意别名都可用；无画布的旧图片工具分支也需对齐 |
| 异步图片任务 | `async:true` + `Idempotency-Key`，`GET /v1/images/{task_id}` | 有本地图片任务管理，但未接入这套远端任务协议 | 属于可进一步增强的恢复/长任务能力；不阻碍已有同步生图 |
| 视频生成 | `POST /v1/videos`、`GET /v1/videos/{task_id}`、`GET /v1/videos/{task_id}/content` | 没有 new-api/OpenAI Video 驱动 | 需新增提交、查询、下载、参数转换与任务恢复适配 |
| Kling 专用协议 | `/kling/v1/videos/text2video`、`image2video` 及查询接口 | 有 Kling 官方协议驱动，默认请求供应商的 `/v1/videos/...` | 网关前缀、凭据来源须正确设置并联调；不能代表所有视频模型已适配 |
| FAL 视频 | FAL 自有队列协议 | 有 submit/status/result 驱动，鉴权使用 FAL Key 协议 | 不能用 new-api 的 Key 直接代替 FAL 官方 Key；应改走网关支持的协议或另做映射 |

补充：本地视频剪辑、时间线操作、导出、本地语音识别不等于调用视频生成模型，不能用“视频面板能打开”作为网关生成接口已接通的证据。

关键源码：

- 文本：`src/main/server/agent/provider/openai.ts:240`。
- 图片 URL 兼容：同文件 `:87`。
- Gemini 画布生图：`src/main/server/canvas/imageExecutor.ts:34`、`:116`。
- 视频驱动注册：`src/main/server/canvas/videoDrivers/index.ts:9`，只有 `mock/fal/kling`。
- 视频解析：`src/main/server/providerResolver.ts:92`。
- new-api 视频路由：`F:/selfProject/new-api/router/video-router.go:24`、`:37`、`:45`、`:48`。

## 4. “一把 auto Key 调用全部模型”实际依赖什么

### 4.1 auto 是分组路由，不是无限权限

应使用 new-api `Token` 表中的 API Token，`group=auto`。不能拿桌面登录 secret、网页 JWT 或管理 PAT 直接替代。

auto 可用范围受用户/工作区授权分组、订阅权限、Token AutoGroups、模型限制、配额、渠道可用性、计费配置约束。`unlimited_quota=true` 代表不单独限制 Token 配额，不代表用户账户不扣费或拥有无限余额。

网页端 `allPermittedRouting` 已有“继承 auto 范围或显式选择授权分组”的处理及分组数量检查，可以复用其业务语义。新加入授权分组时是否自动生效，还取决于令牌使用继承路由还是显式 AutoGroups 快照。

证据：`F:/selfProject/winlume/src/lib/newapi/team-client.ts:128`、`:158`；`F:/selfProject/new-api/service/group.go:201`、`controller/model.go:206`。

### 4.2 当前模型菜单不是用户真实可调用目录

- 文本菜单读取 Provider preset，`settingsStore.ts:146` 返回 `models: preset.models`。
- 图片和视频菜单读取 `src/shared/canvas.ts` 中的静态数组。
- 本地已有 `GET /api/settings/providers/:id/models`，会请求上游 `/models`，但当前菜单没有使用它。
- 该本地接口还把响应简化成 `{id,name}`，丢弃了 new-api `/v1/models` 提供的 `supported_endpoint_types` 等元数据。
- 因此“菜单里有这个模型”不能证明用户有权限、网关有渠道、当前参数和协议可用；新增模型也不会自动出现在这些菜单里。

建议以用户实际 API Key 请求 `/v1/models`，保留端点能力，并补齐图像/视频 generation profile；由目录决定分类、驱动和参数控件。

### 4.3 网关的能力目录对 auto Key 也需要核对和补齐

new-api 已有 `GET /v1/canvas/capabilities` 和 GenerationProfile，可以描述请求路径、JSON/multipart、必填字段、时长、分辨率、参考图数量等。

但当前 `controller/canvas_capabilities.go:28` 直接用 TokenGroup 查询 `GetGroupEnabledModels(group)`；没有像 `/v1/models` 那样展开 auto 的实际路由分组，也未在此处理函数内与 Token 模型限制显式求交。

所以不能直接把这份结果当成 auto Key 的完整授权目录。需复用真实请求的分组/模型授权语义，并确保同一模型在所有可能选中渠道上的 profile 兼容；无法证明一致时应明确标记未知能力。

### 4.4 下载视频也是带鉴权的调用

`GET /v1/videos/{id}/content` 在网关受鉴权和任务归属校验保护。客户端当前通用视频下载只执行 `fetch(videoUrl, {signal})`，不携带 Bearer（`videoJobRuntime.ts:227`）。

新增驱动需在可信网关 origin 下载内容时附带账号模型凭据，或由驱动直接返回 `videoBuffer`。不能把 Key 无条件转发给任意上游/CDN URL或跨域重定向。

## 5. 建议接通方案

### 5.1 目标链路

```text
Reizo 浏览器登录并批准桌面设备
  → winlume 验证桌面会话仍有效
  → 查用户当前工作区与成员资格
  → 查对应 new-api 用户
  → 签发/复用该桌面设备专用的 group=auto API Token
  → 返回模型 API Base URL、凭据、工作区、到期时间
  → Electron 主进程安全持有凭据
  → 用同一账号凭据发现模型、调用文本/图片/视频
  → new-api 执行授权、路由和计费
```

建议按设备签发 Token，复用现有工作区映射和 `allPermittedRouting`，而不是把工作区共享的隐藏 Studio Key 直接发到每台客户端。这样可独立撤销设备，也不影响网页 Studio 或其他设备。

不需要让客户端持有 new-api 管理员 Key、团队 PAT 或账号密码。

### 5.2 服务端接口（以下为建议，当前不存在）

在 winlume 增加桌面模型凭据/bootstrap 接口，例如 `GET /api/desktop-auth/model-session`。当前 `[action]/route.ts` 的 action 白名单尚无此接口。

该接口复用桌面会话验证，但必须额外校验：用户状态、authVersion、会话有效期、当前工作区成员资格及对应模型权限。建议返回：

```text
userId / organizationId / newApiUserId
provider.baseUrl
credential.apiKey / tokenId / expiresAt
catalogVersion（如有）
```

原始 Key 只返回给经过认证的 Electron 主进程，并加密持久化。Renderer 只读取公开模型目录、账号状态和 Key 是否可用。

网页也已有虚拟 Key → `/api/v1/*` → new-api 的代理（`winlume/src/app/api/v1/[...path]/proxy.ts:17`），但它当前识别虚拟 API Key，不识别桌面会话。它可作为另一种部署路径，不能与直连 `v2api.top` 的原始 API Key 混用 Base URL。

### 5.3 客户端改动

1. 提供账号模型凭据解析服务，覆盖首次登录、启动重验、过期、退出及切换工作区。
2. `resolveSettingsModel` 和 `resolveVideoExecution` 在账号模式下统一解析同一凭据；保留手动 Provider 模式的明确边界，避免覆盖用户原有 Key。
3. 所有调用入口一起接入：聊天、子 Agent/画布 Agent、重写/提示词优化、图片、视频以及复用模型的后台任务。
4. 模型菜单使用用户实际目录和能力，处理 Key 不可用、权限变化、列表刷新、模型下架与默认模型失效。
5. 新增网关视频驱动，支持统一 `/v1/videos` 的请求与响应转换、状态轮询、认证下载、本地结果落盘，并复用既有任务台账/恢复机制。
6. 按 profile 限制时长、比例、分辨率、参考图和编码；不要把 Kling 的 5/10 秒规则直接用于所有模型。
7. 退出/禁用/切换工作区时清除对应账号模型凭据；旧任务绑定原工作区，不能悄悄改用新账号继续轮询或重复提交。设备 Key 撤销失败应如实反映。

### 5.4 实施顺序与验收

| 阶段 | 交付 | 最小验收 |
| --- | --- | --- |
| 第一阶段：账号到文本 | winlume 模型凭据接口 + 客户端账号凭据解析 | 全新客户端不填 Key，登录后能用同工作区额度完成聊天；退出后账号模式调用被阻止 |
| 第二阶段：目录与图片 | 授权模型目录、能力信息、标准图片/编辑/Gemini 分流 | 当前用户只见可用模型；标准生图、参考图编辑、Gemini 生图分别用真实授权模型验证 |
| 第三阶段：网关视频 | `/v1/videos` 驱动及认证下载 | 文生视频、图生视频完成“提交→轮询→下载→作品/画布展示”；重启可恢复已提交任务 |
| 发布前联合验收 | 权限变化、订阅、配额、工作区和设备生命周期 | 两个不同权限账户对比目录；低余额/停用 Key 明确报错；切换工作区不串账；查询/恢复不重复计费 |

每类应先选一个线上已授权模型建立最小闭环，再按实际模型 inventory 和 profile 扩大覆盖。接口形式兼容不能代替逐类端到端验收。

## 6. 本次验证与未验证项

客户端现有测试：4 个文件、30 个用例通过：

```powershell
npx vitest run src/main/account/service.test.ts src/main/server/providerResolver.test.ts src/main/server/agent/provider/openai.image.test.ts src/main/server/canvas/videoDrivers.test.ts --pool=threads --maxWorkers=1
```

这些测试验证已有登录服务、Provider 解析、图片响应兼容和现有视频驱动行为；不证明尚未实现的账号模型桥接或 new-api 全量模型端到端可用。

未验证：线上部署版本、真实账号的工作区/Token 配置、实际可见模型列表、余额/订阅状态、当前渠道可用性、付费生成、跨设备撤销及安装包中的联合行为。

首次审计只增加梳理文档；之后的业务改动见本文开头的第一阶段实现进展。
