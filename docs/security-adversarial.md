# 安全对抗清单

每一行 = 一种攻击方式 → 期望行为 → 对应测试。规矩：

1. 没有对应测试，不许写进表里（想记的风险放在文末「未覆盖」）。
2. 新增攻击面必须同时加一行。
3. `测试` 列写 `文件 :: 测试名`，`src/shared/securityChecklist.test.ts` 会校验文件与测试名真实存在。

| 攻击方式 | 期望行为 | 测试 |
| --- | --- | --- |
| 无人值守会话里模型请求需审批的操作（如提示注入建定时任务后自动执行） | 权限自动拒绝，回合不挂起 | `src/main/server/agent/permissions.test.ts :: auto-denies permissions in a headless session so the turn never suspends` |
| 写命令绕过审批 | 记录待审批提示，不放行 | `src/main/server/agent/permissions.test.ts :: records a pending prompt (never blocks) for a writing command` |
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

## 未覆盖（没有测试，不能标「已覆盖」）

- computer-use 越权操作（应用清单、动作后果分类、悬浮停止）——见 #183。
- 提示注入经网页/文件内容诱导工具调用——需要跨层端到端用例。
- 子进程在主进程被强杀后的残留——见 #201。
