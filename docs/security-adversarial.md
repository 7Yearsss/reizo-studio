# 安全对抗清单

每一行 = 一种攻击方式 → 期望行为 → 对应测试。规矩：

1. 没有对应测试，不许写进表里（想记的风险放在文末「未覆盖」）。
2. 新增攻击面必须同时加一行。
3. `测试` 列写 `文件 :: 测试名`，`src/shared/securityChecklist.test.ts` 会校验文件与测试名真实存在。

| 攻击方式 | 期望行为 | 测试 |
| --- | --- | --- |
| 无人值守会话里模型请求需审批的操作（如提示注入建定时任务后自动执行） | 权限自动拒绝，回合不挂起 | `src/main/server/agent/permissions.test.ts :: auto-denies permissions in a headless session so the turn never suspends` |
| 写命令绕过审批 | 记录待审批提示，不放行 | `src/main/server/agent/permissions.test.ts :: records a pending prompt (never blocks) for a writing command` |
| 提示注入让 Agent 建立/删除定时任务（长期立足点），即使在 full 模式 | 仍弹确认卡；拒绝后不落盘；allow-session 不形成长期授权 | `src/main/server/agent/alwaysAsk.test.ts :: create_schedule in full mode records a pending card and writes nothing; approving then runs it` |
| 无人值守的只读自动化被诱导写文件/跑命令/调外部工具，即使全局是 full | 这些工具根本不提供（默认拒绝的白名单），全局 full 不抬高上限 | `src/main/server/agent/runCeiling.test.ts :: read-only keeps only listed read tools; everything else (including new tools and MCP) is withheld` |
| Agent 在 computer-use 中替用户点「发送」「支付」「删除」等不可撤回操作 | 每次单独弹确认，full 模式与会话授权都不豁免；未声明时按摘要措辞兜底识别 | `src/shared/computerConsequence.test.ts :: catches undeclared send / pay / delete wording in the summary, Chinese and English` |
| computer-use 驱动终端、IDE、密码管理器、系统工具或 Reizo 自身 | 动作前按最前窗口判断，直接拒绝 | `src/shared/computerAppPolicy.test.ts :: refuses terminals, IDEs, password managers and system tools` |
| computer-use 无限循环耗费 | 每回合最多 30 个动作步 / 5 分钟，主进程执行 | `src/shared/computerBudget.test.ts :: blocks step 31, not before; looking is free` |
| MCP 工具定义在首次信任后被篡改 | 工具被拦截，保留旧 pin | `src/main/server/agent/mcpTools.test.ts :: withholds a tool whose description changed after it was first trusted` |
| 第三方 MCP 工具在非 full 模式下直接执行 | 先询问再运行 | `src/main/server/agent/mcpTools.test.ts :: asks unless the user chose full access` |
| 用户钩子挂起拖死回合 | 超时放弃，回合继续 | `src/main/server/agent/hooks.test.ts :: gives up on a hook that hangs instead of stalling the turn` |
| 钩子 exit 2 | 阻断调用并以 stderr 为原因 | `src/main/server/agent/hooks.test.ts :: exit 2 blocks with stderr as the reason` |
| provider 返回指向回环/内网/元数据地址的下载 URL（SSRF） | 拒绝下载，不发请求 | `src/main/server/net/fetchRemoteAsset.test.ts :: refuses loopback literals without fetching` |
| 域名解析到内网地址 | 拒绝下载 | `src/main/server/net/fetchRemoteAsset.test.ts :: refuses hostnames that resolve to private addresses` |
| 重定向跳到内网/元数据地址 | 每一跳重新校验并拒绝 | `src/main/server/net/fetchRemoteAsset.test.ts :: revalidates redirect targets` |
| 超大响应耗尽内存/磁盘 | 超上限中止 | `src/main/server/net/fetchRemoteAsset.test.ts :: stops at the size cap` |
| 密钥进入日志/记录 | 常见密钥格式被脱敏 | `src/shared/redactSecrets.test.ts :: redacts an OpenAI key` |
| 私钥块进入日志/记录 | 整块脱敏 | `src/shared/redactSecrets.test.ts :: redacts a PEM private key block` |
| 同一步内并发写同一文件 | 有副作用的工具串行执行 | `src/main/server/agent/toolSerializer.test.ts :: runs mutating tools one at a time in issue order` |
| 模型陷入重复调用循环 | 判定卡住并中止 | `src/main/server/agent/toolLoopGuard.test.ts :: still halts identical calls with identical results` |
| 持久「始终允许」被用来绕过 computer / 定时任务确认 | 只有 `mcp__*` 工具可被永久允许；computer 与 always-ask 名单忽略该决定，新会话仍询问；存档里混入的这类名字加载时丢弃 | `src/main/server/agent/alwaysAllow.test.ts :: computer and the always-ask tools can never be made permanent` |
| 工作区被设成包含应用数据目录的文件夹（如用户主目录），Agent 的 write_file / edit_file 改写数据库、密钥、钩子 | 写入前按绝对路径拒绝，覆盖数据目录整棵树；仅限文件写入工具，run_command 不在此守卫内（见下方未覆盖） | `src/main/workspaceWrite.protected.test.ts :: a workspace that contains the data folder cannot write or edit inside it, but its other files still work` |
| 提示注入让 Agent 把恶意指令存成技能（长期立足点），或把密钥写进技能 | propose_skill 在 always-ask 名单里，每次都弹确认卡，full 模式也不豁免、allow-session 不形成授权；含密钥形态内容的草稿直接拒绝；只能更新用户自己的技能，内置技能不可改写；frontmatter 字段压成单行，草稿无法夹带 allowed-tools 等字段 | `src/main/server/agent/skillDraftTools.test.ts :: writes nothing until the user approves, even in full mode; approving then saves the skill` |
| 提示注入让 Agent 借浏览器 / 聊天软件 / 邮件客户端做不可撤回的操作（发消息、提交表单、删邮件） | 这三类应用在前台时，会话内第一个动作被拦下，弹出点名该应用的确认卡（computer_app，在 always-ask 名单里，无「本会话都允许」）；同意后同一会话同一应用不再重复问，换一个应用重新问；探测不到前台应用时照旧放行（不让检测失败废掉功能） | `src/main/server/agent/computerAppApproval.test.ts :: holds the first action on a browser, then lets that app through after approval, and still asks for another app` |
| 网页上的 `reizo://` 链接诱导安装恶意技能 / 夹带路径或额外参数 | 解析是默认拒绝的白名单：只认 `skill/install`，namespace / slug / version 限定字符集与长度，其余一律丢弃；链接只会弹确认卡并先展示技能全文，用户点「安装」前不写入任何内容，取消即什么都没发生 | `src/shared/deepLink.test.ts :: drops anything it does not recognise` |
| 被注入的指令让 Agent 用 curl / npm 等把数据发往任意域名（开启网络隔离时） | Agent 运行的命令被注入指向本机过滤代理的 HTTP(S)_PROXY，默认拒绝：只放行内置包管理源 / 代码托管与用户加入的主机；按解析后的 IP 判断，私网与回环默认拒绝；被拦返回 403 并记录主机。边界：只约束遵守代理变量的程序，不是系统级沙箱 | `src/main/egressProxy.test.ts :: forwards an allowed host and refuses everything else, naming the host` |
| 被监听的文件夹被用来越界读取工作区外的文件，或一次投放大量文件造成运行风暴 | 监听目录必须是工作区内的相对路径（拒绝绝对路径与 `..`，运行时再按当前工作区解析并校验包含关系）；无人值守运行沿用 runPermission 上限（新建默认只读，非法值拒绝）；事件先过滤半成品文件再合并为一次运行（最长等待上限，最多列出 200 个），自动化忙碌时文件保留重试而不是并发再起一次 | `src/main/folderTriggers.test.ts :: never watches outside the workspace and does nothing for a disabled automation` |
| 提示注入让 Agent 用浏览器工具访问本机服务（如 127.0.0.1:47100 的本地 API）或内网地址，或带着登录态访问网站 | browser_read 先按 browserUrlProblem 拒绝本机/内网/非 http(s)/带账号密码的地址（连审批卡都不弹）；页面发出的每个子请求同样过滤；窗口是隐藏的、沙箱化、内存分区（不带 cookie、用完清除），拒绝弹窗、下载与权限请求；在 ask 模式仍需用户批准；返回内容标记为不可信 | `src/shared/browserUrl.test.ts :: refuses this machine, private networks, other schemes and credentials`、`src/main/server/agent/webTools.test.ts :: never opens private or local addresses, and does not even ask the user about them` |

## 未覆盖（没有测试，不能标「已覆盖」）

- 记忆写入（memory_write）目前不强制每次确认——记忆有独立的提取/召回流程，是否纳入「永远要问」名单待评估。
- 提示注入经网页/文件内容诱导工具调用——需要跨层端到端用例。
- 子进程在主进程被强杀后的残留——见 #201。
- 应用数据目录对 run_command（shell）没有写保护：命令可以改任何用户有权限的文件，只能靠审批与「只读自动化」上限兜底。
