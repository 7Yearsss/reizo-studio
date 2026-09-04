# Reizo「Agent ↔ 画布」交互深化 — 调研与实施计划

Status: **计划待实施**（2026-09-04）。分支基线 `feat/helios-borrowings-canvas`（`cef5bcc`）。
姊妹文档：`docs/canvas-ux-plan.md`（编排规范，§2 / §8 是本文件的直接上游）、
`docs/helios-borrowings-plan.md`（已实施）、`docs/studio-borrowings-plan.md`（竞品借鉴，
P1-2 / P2-2 在本文件里被显式判为「本轮不做」）、`docs/canvas-plan.md`（原始 17 条决策）。

本文件写给**实施方（其他 AI / 工程师）**。范围严格限定在 **Agent 与画布之间的交互面**：
Agent 怎么被看见、怎么被给上下文、怎么被接受或拒绝、怎么和对话互相指代。
**不包含**节点内部的媒体能力（放大 / 新模型 / 音频 / 时间线），那些在 `studio-borrowings-plan.md`。

每个工作项自带「现状 / 目标 / 改动文件 / 方案 / 数据结构 / 验收标准 / Review 检查点 / 风险」，
按 P0 → P2 排序，除注明依赖外互相独立、可分 PR。

---

## 0. 现状盘点（读源码确认，不要重复造）

### 0.1 上一轮已落地的画布形态

| 项 | 位置 | 状态 |
|---|---|---|
| `NodeActionBar` 统一悬浮动作条（`selected \|\| hovered`，`useHoverIntent` 140ms 宽限） | `canvas/NodeActionBar.tsx:9`（`NodeAction` 定义）`:70` | ✅ |
| `forkVariations` 2×2 变体宫格，一条撤销记录 | `state/canvasStore.ts:406` | ✅ |
| `CameraDial` 结构化运镜（`shared/cameraMotion.ts`） | `canvas/CameraDial.tsx` | ✅ |
| 参考图钉 `anchor` 节点 + `AssetShelf` + `planAnchors` 有序垫图 | `canvas/AnchorNode.tsx` / `AssetShelf.tsx` / `shared/referenceAnchors.ts` | ✅（诚实边界：非 IP-Adapter） |
| RW-1 底部浮动导航条 + 框选模式（V / M / Z） | `canvas/CanvasPanel.tsx:706-739`，`panOnDrag ↔ selectionOnDrag :544-545` | ✅ |
| RW-2 左侧竖创建条（删了顶部工具栏与 `<Controls>`） | `CanvasPanel.tsx:606-703` | ✅ |
| RW-3 `NodeHandle` 强类型句柄 + `ProgressiveRefHandles` 渐进 `ref_N` 槽 | `canvas/NodeHandle.tsx`，色板 `canvas/edges/edgeStyles.ts` | ✅ |
| RW-4 `CuttableEdge` 能量流动边 + 两段式剪线 | `canvas/edges/CuttableEdge.tsx`，`index.css:381`（`@keyframes edge-flow`） | ✅ |
| 分层波浪并发（`buildPipelineWaves`，`MAX_CONCURRENCY = 3`） | `canvas/graphExecutor.ts:20` `:78` | ✅ |

### 0.2 Agent ↔ 画布 现有的 7 条链路（含各自的硬边界）

| # | 链路 | 位置 | 现状 / 边界 |
|---|---|---|---|
| L1 | **Agent 看画布**：turn 开始注入「紧凑画布摘要」 | `agent/runtime.ts:199-218` | **turn 开始冻结**。中途新增/删除的节点在本 turn 内不可见，只能靠 `read_canvas` 全量重读 |
| L2 | 选中节点带进摘要 | `runtime.ts:206`（`getCanvasSelection`）+ `canvas/selection.ts` | 只是给节点行加 `(selected)` 后缀；**不带边、不带产物**，是纯文字 |
| L3 | `@[label](canvas:id)` 引用 chip → `mentions: ['canvas:<id>']` | `state/chatStore.ts:108` `addNodeRef`；`runtime.ts:118-134` `canvasRefBlock` | 逐节点一行，同样不带边 |
| L4 | **Agent 写画布**：11 个工具 | `agent/canvasTools.ts` `add_node:51` / `create_storyboard_pipeline:92` / `run_node:240` / `run_graph:259` / `group_nodes:286` / `read_canvas:322` / `read_node:336` / `update_node:346` / `connect_nodes:387` / `attach_reference:402` / `delete_node:443` | 结构编辑**不弹权限**（decision 10）；每次调用作为 tool card 流进对话 |
| L5 | **Agent → 节点**：`focusBySession` 平移 + 1.8s 高亮脉冲 | `chatStore.ts:615-629` → `canvasStore.ts:237 focusNode` → `CanvasPanel.tsx:117-125` | 一次性；**只对 `add_node` / `run_node` / `update_node` 触发**，`connect_nodes` / `group_nodes` / `attach_reference` / `create_storyboard_pipeline` / `delete_node` 全都没有落点提示；批量操作只 focus 最后一个 |
| L6 | **节点 → 对话**：三条路径三种措辞 | 右键「让 agent 处理」`CanvasPanel.tsx:367 askAgent`；底部「投送给 Agent 质检」`:749-761`；动作条「质检 Agent」→ `canvasStore.ts:511 addDownstreamAgent` | 前两条是**发消息**，第三条是**建下游 agent 节点**，语义完全不同却共用「质检」措辞 |
| L7 | `agent` 节点（headless 侧车） | `canvas/agentExecutor.ts:112 runAgentNode` | 隔离、只读工具（`read_canvas` / `read_node`）、`isStepCount(12)`、400ms 节流流进 `output.text`；`collectUpstreamImages:78` 已把上游图作为多模态 part 送入 —— 「画面监工」确实能跑 |

### 0.3 读代码发现的 3 个**未记录的缺陷 / 边界**（必须写进实施说明）

1. **Agent 的画布写入不进撤销栈。**
   渲染层撤销栈只在 `canvasStore.record()` 里增长（`state/canvasStore.ts:81`），而 `record()` 只被
   渲染层发起的公开 mutation 调用。Agent 的写走 `canvasTools` → `canvasStore(server)` →
   `CanvasChannel.broadcast` → 渲染层 `applyEvent`（`state/canvasStore.ts:125`），
   `applyEvent` 里**没有任何 `record()`**。
   ⇒ **Agent 一句话建了 13 个分镜节点，用户 `Ctrl+Z` 撤不掉任何一个。** 这是本计划 P0-2 的动机。

2. **选区上报有 300ms 去抖，"框选完立刻发消息"会丢选区。**
   `canvasStore.ts:1182 setSelection` 用 `setTimeout(..., 300)` 才 PUT `/:canvasId/selection`
   （`routes/canvas.ts:381`）。而底部浮条的「投送给 Agent 质检」是同步 `chatStore.sendMessage`。
   两者竞态时服务端 `getCanvasSelection` 拿到的是**上一次**的选区。

3. **`run_graph` 的波次结构在开始时冻结，但节点内容是新鲜的。**
   `graphExecutor.ts:74` 的 `byId` / `:78` 的 `waves` 来自开始时的 snapshot；
   但 `:123` 每个节点执行前 `getNode` 重读。
   ⇒ 运行期间 Agent 新增的节点**不会**进这一次 run（正确且可接受）；
   而 `runAgentNode` 里的 `upstreamNodes`（`agentExecutor.ts:165`）是执行时读的，**上游是新鲜的**。
   ⇒ 「agent 节点看到的是冻结上游」这个担心**经核对不成立**，实施方不要去改它。

### 0.4 竞品当下形态（2026-09 核对）

| 产品 | 当下形态 | 对 Reizo 的启示 |
|---|---|---|
| **Krea Node Agent**（2026-02 发布） | 一句话 → 读画布 → **先给计划再动手**（可换模型 / 删阶段 / 看 per-node 成本）→ 批准后节点**逐层出现、边随放随连** | 直接对应本文 P1-1（提案态）+ P1-2（逐层点亮）+ P2-1（成本门）。这是三项的最强外部佐证 |
| **FLORA / FAUNA**（2026-04） | Agent 住在节点画布里：读画布、加节点、选模型、连管线、跑生成、整理产出 | 和 Reizo `canvasTools` 能力集几乎重合 —— 说明 Reizo 缺的不是「能力」，是**交互面** |
| **Runway Agent 2.0**（2026-06） | 无限 ChatCanvas，三模式 **Talk（说意图）/ Tab（刷变体宫格）/ Tune（点位微调）**；Agent 能列出、打开、改、跑 workspace 里的 workflow | Reizo 已有 Tab（`forkVariations`）与 Tune（`NodeActionBar` + `CameraDial`），**Talk 与画布之间的耦合最弱** —— 正是本文的主攻方向 |
| **Figma 画布 Agent**（2026-05） | Agent 在画布上工作时可点开一个**锚定的聊天窗**，显示「正在做什么 / 已完成哪几步 / 结果」，支持继续追问；**所有改动可撤销** | 对应 P0-1（活动薄条）、P1-4（节点级线程）、P0-2（撤销） |
| **tldraw agent starter kit** | Agent 的上下文来自四处：用户消息、**用户当前选区**、用户当前视口、用户额外圈定的形状/区域 | 对应 P0-3（选区即结构化上下文）。Reizo 现在只有「消息 + 选区节点名」 |
| **ComfyUI-Copilot v2 / 知识中心化编排 Agent** | 多角色 Agent 分工产图、生成后**走图校验**（补类型转换节点） | 对应 P1-1 里「接受前先校验」的做法，Reizo 可用现成的 `canvasReadiness.ts` / `wouldCycle` |

**提炼的 5 条原则（本文所有工作项都要服从）**

1. **Agent 的每一次画布写入都要有落点、有名字、可回退。**（现在三样都缺，见 0.3.1）
2. **上下文是结构，不是散文。** 选区/引用要带边、带产物、带槽位，不是一行行文字描述。
3. **破坏性与付费动作两段式。** 和 RW-4 剪线、`confirmAll` 同一心智：先示意，再确认。
4. **不新增通道。** 一切走现有 `CanvasChannel`（NDJSON 订阅，`channel.ts:29 broadcast`）与
   chat 的 `ChatStreamEvent`；不引入轮询、不引入第二条 socket。
5. **默认路径不能变慢变吵。** 「一句话生成分镜」的爽感是产品核心，任何 review / 确认
   都必须是**可关闭的、默认不挡路的**（见 P1-1 的默认值结论）。

---

## 1. 缺口判定总表

| # | 缺口 | 严重度 | 工作项 |
|---|---|---|---|
| G1 | Agent 写入无落点、无历史、只有 1.8s 一次性脉冲，且 5 个工具连脉冲都没有 | 高 | **P0-1** |
| G2 | Agent 写入不进撤销栈（用户无法回退 Agent 的编排） | 高（正确性） | **P0-2** |
| G3 | 框选出来的选区只以「节点名字符串」进 prompt，边/产物/槽位全丢；且有去抖竞态 | 高 | **P0-3** |
| G4 | 画布摘要 turn 开始冻结，中途变更 Agent 看不见；`read_canvas` 只能全量重读 | 中高 | **P0-4** |
| G5 | Agent 的提议无法「接受 / 丢弃」，只能事后收拾 | 中高 | **P1-1** |
| G6 | `run_graph` / `create_storyboard_pipeline` 执行时画布上没有流水线感（只有 `done/total` 藏在 title 里） | 中 | **P1-2** |
| G7 | 对话 ↔ 画布只有单向 focus，tool card 点不动、节点 hover 不反查 | 中 | **P1-3** |
| G8 | agent 节点单次覆盖式输出，无法「再赛博一点」多轮迭代 | 中 | **P1-4** |
| G9 | Agent 发起的付费生成完全绕过 `confirmedSpend`（UI 路径有，Agent 路径没有） | 中（费用） | **P2-1** |
| G10 | 右面板画布/作品关系不清；节点→对话三种措辞 | 低 | **P2-2** |

---

## P0-1 · Agent 足迹层 `AgentTrail`（批次徽章 + 活动薄条 + 包围盒 fitView）

### 现状

- `chatStore.ts:615` 只对 `add_node` / `run_node` / `update_node` 三个工具调 `canvasStore.focusNode`；
  `connect_nodes` / `group_nodes` / `attach_reference` / `delete_node` / `create_storyboard_pipeline`
  **完全无提示**。
- `CanvasPanel.tsx:117-125` 的 focus effect 只 `setCenter` + 1.8s `highlightId` 脉冲，
  多节点批量只落到最后一个 id。
- 画布右上角空着（`canvas-ux-plan.md` §3.4 已规划为「Agent 活动」位）。

### 目标

1. **节点徽章**：被 Agent 写过的节点右上角出现一个 `✦` 小徽章，8s 淡出（区别于用户自己的操作）。
2. **活动薄条**：画布右上角一条最多 3 行的「Agent 活动」薄条，每行是一次工具调用的人话摘要
   （`+ 3 个分镜节点` / `连接 镜头1关键帧 → 镜头1运镜` / `运行 镜头2·关键帧`），
   点一行 → spotlight 该批次的全部节点；有更多时可展开到最近 20 条。
3. **包围盒 fitView**：一次工具调用产生多个节点时（`create_storyboard_pipeline` 返回
   `createdNodeIds`、`group_nodes` 返回 `memberIds`），结束后 `fitView` 到**这批节点的包围盒**，
   而不是 `setCenter` 到最后一个。

### 改动文件

- 新增 `src/shared/agentTrail.ts` + `src/shared/agentTrail.test.ts`（**纯逻辑，vitest**）
  - `trailEntryFromTool(part) : AgentTrailEntry | null` —— 从 `{name, args, result, error}` 解析出
    动词、涉及的 nodeIds、人话 label。这是全文多处复用的唯一解析点（P1-3 也用它）。
- 改 `src/renderer/state/canvasStore.ts`
  - `CanvasState` 增 `trailBySession: Record<string, AgentTrailEntry[]>`
  - `focusBySession` 升级为 `spotlightBySession: Record<string, { ids: string[]; at: number }>`
    （`focusNode(sessionId, id)` 保留为 `spotlight(sessionId, [id])` 的薄封装，避免改调用点）
  - 新增 `pushTrail(sessionId, entry)` / `spotlight(sessionId, ids)`
  - **`pushTrail` 不调用 `record()`** —— 足迹不是撤销单位（撤销在 P0-2）
- 改 `src/renderer/state/chatStore.ts:610-635`（`makeEventFolder` 的 `case 'tool'`）
  - 把写死的 `['add_node','run_node','update_node']` 判断换成 `trailEntryFromTool(part)`
  - 有 entry → `canvasStore.pushTrail(...)` + `canvasStore.spotlight(sessionId, entry.nodeIds)`
  - `add_node` / `create_storyboard_pipeline` 仍 `uiStore.setCanvasOpen(true)`
- 改 `src/renderer/components/canvas/CanvasPanel.tsx`
  - `:117-125` 的 effect 改为读 `spotlight`：`ids.length > 1` 走
    `rf.fitView({ nodes: ids.map(id => ({ id })), padding: 0.25, duration: 400, maxZoom: 1 })`；
    `=== 1` 保留 `setCenter`
  - `nodes` memo（`:158-173`）的 `data` 增 `agentMark: agentMarkedIds.has(node.id)`
  - 挂载新组件 `<AgentActivityStrip sessionId={sessionId} />`（`<Panel position="top-right">`）
- 新增 `src/renderer/components/canvas/AgentActivityStrip.tsx`
- 新增 `src/renderer/components/canvas/AgentMark.tsx`（`✦` 徽章，8s 自淡出）
- 改 `src/renderer/components/canvas/ImageNode.tsx`（`CanvasNodeData` 类型 + 徽章位）、
  `VideoNode.tsx` / `AgentNode.tsx` / `NoteNode.tsx` / `AnchorNode.tsx`（同一处 `<AgentMark />` 插入点，
  在现有状态徽章行左侧）
- 改 `src/renderer/index.css`
  - 新增 `.agent-mark { animation: agent-mark-fade 8s ... }`
  - 在 `:431` 的 `@media (prefers-reduced-motion: reduce)` 块里加
    `.agent-mark { animation: none; opacity: 1; }`（保留信息、去掉动效）

### 数据结构

```ts
// src/shared/agentTrail.ts
export type TrailVerb = 'add' | 'connect' | 'update' | 'run' | 'group' | 'attach' | 'delete' | 'orchestrate';

export interface AgentTrailEntry {
  /** = toolCallId，天然去重、天然是"一次工具调用"的批次 id */
  id: string;
  tool: string;
  verb: TrailVerb;
  /** 人话摘要，中文，≤ 24 字，例："+ 3 个分镜节点" */
  label: string;
  /** 这次调用触及的节点（用于 spotlight / fitView / 徽章 / 撤销粒度） */
  nodeIds: string[];
  at: number;
  status: 'running' | 'done' | 'error';
}

export function trailEntryFromTool(part: {
  id: string; name: string; args: Record<string, unknown>; result?: string; error?: string;
}): AgentTrailEntry | null;
```

`nodeIds` 的解析规则（写进 test）：

| tool | nodeIds 来源 |
|---|---|
| `add_node` | `result.id` |
| `create_storyboard_pipeline` | `result.createdNodeIds` + `result.noteId` |
| `connect_nodes` | `args.source`, `args.target` |
| `attach_reference` | `args.anchorId` + `args.targetIds` |
| `group_nodes` | `result.id` + `result.memberIds` |
| `run_node` / `update_node` / `delete_node` | `args.id` |
| `run_graph` | `args.nodeIds ?? [args.from]`；都没有则 `[]`（薄条显示「运行整图」，不 spotlight） |
| `read_canvas` / `read_node` | **返回 `null`** —— 读操作不留足迹（否则薄条被刷屏） |

### 验收标准

1. Agent 调 `create_storyboard_pipeline` 建 13 个节点后：画布一次 `fitView` 到这 13 个节点的包围盒，
   13 个节点右上角同时出现 `✦`，8s 后淡出。
2. 右上薄条出现「编排 13 个节点」一行；再调 `connect_nodes` / `run_node` 时依次追加，最多显示 3 行。
3. 点薄条任意一行 → 画布 spotlight 该行的节点集合（单个 `setCenter`，多个 `fitView`）。
4. `read_canvas` / `read_node` 不产生薄条行、不产生徽章。
5. 用户自己拖节点 / 自己点运行 **不**产生 `✦` 和薄条行（足迹只归属 Agent）。
6. `prefers-reduced-motion: reduce` 下 `✦` 无淡出动画、`fitView` 的 `duration` 传 0。

### Review 检查点

- [ ] 足迹**只从 chat 的 tool 事件派生**，没有新增 `CanvasChannel` 事件类型、没有轮询。
- [ ] `trailEntryFromTool` 在 `src/shared/` 且有 vitest；`result` 解析失败必须**静默返回 null**，
      不能抛错打断 `makeEventFolder`。
- [ ] `trailBySession` 有上限（建议 30 条，超出 `shift()`），不随长会话无限增长。
- [ ] `pushTrail` **没有**调用 `record()`。
- [ ] 徽章状态存在节点 `data` 里派生，**不**写进 `canvasStore` 的 `nodesBySession`
      （不污染服务端权威快照、不触发 `patchCanvasNode`）。
- [ ] 薄条用 `<Panel position="top-right">`，z-index 与 `canvas-ux-plan.md` §5 的层级表一致
      （节点 1 < 动作条 20 < popover 30 < 菜单 150）。
- [ ] 颜色只用 `--paper-raised` / `--ink-muted` / `--accent` token。

### 风险

- **归因不准**：如果未来出现「另一个窗口/另一个会话改同一画布」，通过 chat 事件派生的足迹会漏。
  当前 Reizo 是单机单窗口 + 画布会话级（`Canvas.sessionId`），可接受。
  若以后要跨窗口，再把足迹升级为 `CanvasEvent` 里的可选 `actor?: 'agent' | 'user'` 字段（向后兼容）。
- **薄条挡住 MiniMap / AssetShelf**：`AssetShelf` 已经在右上（`CanvasPanel.tsx:550`）。
  ⇒ **必须先确认摆位**：建议薄条压在 `AssetShelf` 之下（`top-right` 的第二行），或
  `AssetShelf` 折叠时才展开薄条。这是本项唯一的布局决策点，PR 里给截图。

---

## P0-2 · Agent 的画布写入进撤销栈（一次工具调用 = 一条撤销记录）

> 依赖 **P0-1**（复用 `AgentTrailEntry` 的批次概念与 `nodeIds`）。

### 现状

见 §0.3.1：`applyEvent`（`state/canvasStore.ts:125`）只更新 state，不 `record()`。
Agent 编排出来的整条流水线**用户无法 `Ctrl+Z`**，只能一个个右键删。
底部导航条的撤销按钮（`CanvasPanel.tsx:732`）此时是灰的 —— 用户会认为「撤销坏了」。

### 目标

Agent 每完成一次**结构写入型**工具调用（`add_node` / `connect_nodes` / `group_nodes` /
`attach_reference` / `create_storyboard_pipeline` / `delete_node`），
渲染层记一条**撤销记录**，粒度 = 一次工具调用（13 个分镜节点 = 一次 `Ctrl+Z` 全撤）。
`run_node` / `run_graph` / `update_node` **不记**（运行不可撤销；`update_node` 的
params 变更走已有 `updateNodeParams` 语义即可，见风险）。

### 改动文件

- 改 `src/renderer/state/canvasStore.ts`
  - 新增 `recordAgentBatch(sessionId, entry: AgentTrailEntry)`：
    - 从当前 state 快照出这批 `nodeIds` 的节点与**所有触及它们的边**
    - `undo`：逐个 `_deleteNode` / `_deleteEdge`（复用现成的私有 mutation）
    - `redo`：逐个 `_addNode` / `_addEdge` 重建（id 会变 —— 见风险，重建后刷新闭包里的 id 表）
    - 调 `record(sessionId, entry)`（已有，`:81`，`HISTORY_CAP = 60`）
  - `delete_node` 的批次方向相反：`undo` 重建、`redo` 删除
- 改 `src/renderer/state/chatStore.ts:610-635`
  - `trailEntryFromTool` 返回且 `status === 'done'` 且 `verb ∈ {add, connect, group, attach, orchestrate, delete}`
    时，调 `canvasStore.recordAgentBatch(...)`
  - **时序**：必须等 `CanvasChannel` 的 `node_added` / `edge_added` 事件已经落进 state 才能快照。
    工具 result 与 channel 事件是两条流。**方案**：`recordAgentBatch` 内部对
    `entry.nodeIds` 做一次「都已在 state 里？」检查，缺则 `setTimeout(…, 120)` 重试一次，
    仍缺则**只记已到的那些**（不阻塞、不丢用户感知）。这一段必须写注释说明为什么。

### 数据结构

不新增持久化结构。撤销条目仍是现有的：

```ts
interface HistoryEntry { undo: () => Promise<void>; redo: () => Promise<void>; }
```

### 验收标准

1. Agent 一句话建 13 个分镜（`create_storyboard_pipeline`）→ 底部导航条撤销按钮**变亮** →
   点一次 `Ctrl+Z`：13 个节点 + 它们之间的边全部消失；再 `Ctrl+Shift+Z` 全部回来。
2. Agent 调 `connect_nodes` 连一条边 → `Ctrl+Z` 只撤这条边，节点还在。
3. Agent 调 `run_node` → 撤销栈**不增长**（运行不可撤销）。
4. 用户在 Agent 写入之后自己拖了一个节点 → `Ctrl+Z` 先撤自己的拖动，再撤 Agent 的批次（栈序正确）。
5. 撤销 Agent 批次后再让 Agent `read_canvas` → 返回的节点里没有被撤掉的那些（证明确实走了服务端删除）。

### Review 检查点

- [ ] 一次工具调用 = **一条**记录（不是 13 条）。
- [ ] `undo` / `redo` 全部走现有 `_addNode` / `_deleteNode` / `_addEdge` / `_deleteEdge`，
      **不绕过去直接 `setNodes`**（否则服务端与渲染层不一致）。
- [ ] 批次快照必须包含「触及这些节点的边」，否则撤销后留下悬空边。
- [ ] `HISTORY_CAP = 60` 不变；Agent 的大批次不能把用户自己的历史挤爆 —— 若一个 turn 产生 > 10 条
      批次记录，考虑合并为一条（可留 TODO，但要在 PR 描述里说明取舍）。
- [ ] 事件时序的重试逻辑有注释，且**最多重试一次**，不做轮询。

### 风险

- **redo 后 id 变化**：`_addNode` 重建拿到的是**新 id**，闭包里必须刷新
  （`canvasStore.ts:406 forkVariations` / `:900 duplicateSelectedNodes` 已有同款写法，照抄）。
  同时 P0-1 的 `AgentTrailEntry.nodeIds` 会指向旧 id → 撤销后薄条那行点击应变为**无效态**（灰掉），不要报错。
- **`update_node` 不记**：Agent 改了 prompt 后用户撤不掉。这是有意取舍（内容变更由 dirty 徽章 +
  用户自己重编辑覆盖）。若产品要求可撤，作为独立小 PR 加，`undo` 恢复旧 `params` 即可。
- 若后续做 P1-1 提案态，批次概念可直接复用 `AgentTrailEntry.id` 作为 `batchId`。

---

## P0-3 · 选区即结构化上下文（框选 → 问 Agent）

### 现状

- RW-1 刚加了框选（`CanvasPanel.tsx:544-545`），但框选的产物只有两个消费者：
  - 底部浮条「投送给 Agent 质检」把选区**拼成一段散文**（`CanvasPanel.tsx:749-761`），
    丢掉了边、产物、句柄、dirty 状态；
  - `setSelection` 上报服务端（300ms 去抖，`canvasStore.ts:1182`），
    只让摘要里的节点行加 `(selected)` 后缀（`runtime.ts:206-216`）。
- 且存在 §0.3.2 的**去抖竞态**：框完立刻点「投送」，服务端拿到的是旧选区。
- 底部浮条现在有 7 个按钮（投送 / 串联审片 / 引用 / 派生 / 网格 / 成组 / 克隆），
  `canvas-ux-plan.md` §3.3 已判定「动作太多」。

### 目标

1. 框选 N 个节点后，底部浮条收敛为
   **`已选 N 个 │ 问 Agent ▾   引用   变体×4 │ 排版▾ │ ⋯`**（落地 UX-4 + UX-7）。
2. `问 Agent ▾` 展开 4 个预设话术 + 自定义：
   `质检这几个画面` / `帮我重排这段流水线` / `按这个风格补 2 个分镜` / `写一段串场旁白` / `自定义…`。
3. 选区以**结构化子图**进入 prompt：节点行 + **内部边行** + 产物计数 + dirty 状态，
   而不是散文描述。
4. 给 Agent 一个可选的 `read_canvas({ scope: 'selection' })`，让它在 turn 中途还能按选区聚焦重读。

### 改动文件

- 新增 `src/shared/canvasSubgraph.ts` + `.test.ts`（**纯逻辑，vitest**）
  - `describeSubgraph(nodes, edges, ids, opts?) : string` —— 生成给模型看的紧凑文本块
  - `subgraphBrief(nodes, edges, ids) : SubgraphBrief` —— 结构化对象（服务端 / 工具返回用）
- 改 `src/renderer/state/canvasStore.ts`
  - 新增 `flushSelection(sessionId): Promise<void>` —— 清掉 `selectionTimers` 里的定时器并**立即** PUT，
    修复 §0.3.2 竞态
- 改 `src/renderer/components/canvas/CanvasPanel.tsx:741-849`
  - 浮条重排为上面的 4 段；「投送给 Agent 质检」→ `问 Agent ▾`（复用现成的
    `ToolbarDropdown`，`:1112`）
  - 每个预设：`await canvasStore.flushSelection(sessionId)` →
    `chatStore.sendMessage(sessionId, presetText, selectedNodeIds.map(id => 'canvas:' + id))`
    —— **走已有的 mention 通路（L3），不再拼散文**
  - `串联审片` / `网格对齐` / `成组` / `批量克隆` 收进 `排版▾` 与 `⋯`
- 改 `src/main/server/agent/runtime.ts:118-134`（`canvasRefBlock`）
  - 当 `canvasRefIds.length > 1` 时改用 `describeSubgraph(...)`，输出带边的子图块；
    `=== 1` 时保持现有单行格式（不回归）
- 改 `src/main/server/agent/canvasTools.ts:322`（`read_canvas`）
  - `inputSchema` 由 `z.object({})` 改为
    `z.object({ scope: z.enum(['all','selection']).optional(), ids: z.array(z.string()).optional() })`
    —— **只增可选参数，符合约定**；`scope:'selection'` 走 `getCanvasSelection(canvas.id)`

### 数据结构

```ts
// src/shared/canvasSubgraph.ts
export interface SubgraphBrief {
  nodes: Array<{
    id: string; type: string; title: string | null;
    runState: string; dirty: boolean;
    prompt?: string;      // 截断 120 字
    assetCount: number;
    text?: string;        // agent 节点答案，截断 200 字
  }>;
  /** 只含两端都在选区内的边；带句柄，这样"首帧/尾帧/ref_2"的语义不丢 */
  edges: Array<{ source: string; target: string; sourceHandle: string | null; targetHandle: string | null }>;
  /** 有一端在选区外的边，只给计数，避免把整图拖进来 */
  danglingIn: number;
  danglingOut: number;
  truncated: boolean;     // 超过 MAX_NODES 时为 true
}

export const SUBGRAPH_MAX_NODES = 30;
```

给模型看的文本块示例（`describeSubgraph` 的输出，写进 test 的 snapshot）：

```
用户选中了画布上的 4 个节点（一个子图）：
- n_a1 [image, done, 1 产物] 镜头1·关键帧 prompt: "雨夜霓虹街道，主角背影…"
- n_b2 [video, done, 1 产物] 镜头1·运镜 prompt: "缓慢推进…"
- n_c3 [image, idle, 待更新] 镜头2·关键帧 prompt: "……"
- n_d4 [anchor] 女主·红色风衣 (role=character, strength=mid)
子图内部连线：
- n_a1 --start_frame--> n_b2
- n_d4 --ref_1--> n_c3
另有 1 条入边、2 条出边指向选区之外的节点。
```

### 验收标准

1. 框选 3 个节点 + 它们之间 2 条边 → `问 Agent ▾ → 帮我重排这段流水线` →
   服务端 systemParts 里出现上面格式的子图块（**含边与句柄**），不再是散文串。
2. 框完选区**立刻**点预设（< 300ms）→ 服务端 `getCanvasSelection` 拿到的是新选区（竞态已修）。
3. Agent 调 `read_canvas({ scope: 'selection' })` 只返回选中的节点与内部边；
   不传参数时行为与今天**完全一致**（向后兼容）。
4. 选中 40 个节点 → 子图块截断到 30 个 + 一行「另有 10 个节点未列出」，prompt 不爆。
5. 底部浮条按钮数从 7 降到 4 段；`串联审片` 不再让浮条宽度跳变。

### Review 检查点

- [ ] 走**已有** mention 通路（`sendMessage` 的 `mentions: ['canvas:<id>']`），没有新增 API 字段。
- [ ] `read_canvas` 的 schema 变更**只增可选参数**，旧调用零改动。
- [ ] `describeSubgraph` 在 `src/shared/`，有 vitest，含「空选区 / 单节点 / 超限截断 / 悬空边」四个用例。
- [ ] `flushSelection` 清掉 `selectionTimers` 的定时器后才 PUT，不会 double-PUT。
- [ ] 预设话术是**数据表**（`const ASK_PRESETS: { id; label; text }[]`），不是散落的字符串字面量
      —— 右键菜单（`CanvasPanel.tsx:869`）与动作条要复用同一份（UX-7 的动词收敛）。
- [ ] 「问 Agent」= 发消息；「+ 质检 Agent」（`addDownstreamAgent`）= 建节点。
      两者措辞必须分开，不能都叫「质检」（见 §0.2 L6）。

### 风险

- **prompt 膨胀**：30 节点 × 每行 ~80 字 ≈ 2.4k 字符，可接受；但如果同时有大段 agent 答案文本
  会翻倍 ⇒ `text` 截断到 200 字，且只对 `runState === 'done'` 的 agent 节点带。
- **预设话术过度承诺**：「帮我重排这段流水线」需要 Agent 会用 `update_node` 改坐标 ——
  当前 `update_node` **不接受 x/y**（`canvasTools.ts:346`）。
  ⇒ 要么给 `update_node` 加可选 `x` / `y`（只增可选参数，OK），要么把这条预设改成
  「帮我检查这段流水线的连线」。**PR 里必须二选一给结论**，不能留一句跑不通的预设。

---

## P0-4 · turn 内画布可见性（增量注入 + 聚焦重读）

### 现状

`runtime.ts:199-218` 的注释自己写着「Frozen at turn start」。
一个长 turn 里 Agent 可能连续调十几次工具，其间画布已经大变，但注入的摘要还是最初那份；
唯一的补救是 `read_canvas`，而它**没有参数、返回全图**（`canvasTools.ts:322`），
节点多时既慢又占 token，Agent 因此倾向于不调，然后基于陈旧信息决策。

同时用户也可能在 turn 进行中手动删/加节点，Agent 完全感知不到。

### 目标

1. `prepareStep` 每步做一次**极短的增量注入**（仅当画布 `liveRevision` 相对上一步有变化时）：
   `[画布已变化] 新增 n_x, n_y；删除 n_z；当前 14 个节点。需要细节请调 read_canvas。`
   —— **≤ 200 字符，且只在变化时注入**。
2. `read_canvas` 加可选 `scope` / `ids`（与 P0-3 同一处改动，两项共用一个 schema 变更）。
3. 在文档与代码注释里**明确 `runAgentNode` 的上游是新鲜的**（§0.3.3），阻止实施方误改。

### 改动文件

- 改 `src/main/server/agent/runtime.ts`
  - `runChatTurn` 里在 `buildStream` 之前建一个闭包 `canvasDelta`：
    ```ts
    let lastSeenRev = canvas?.liveRevision ?? 0;
    let lastNodeIds = new Set(snapshot?.nodes.map(n => n.id) ?? []);
    let injections = 0;
    const canvasDeltaLine = (): string | null => { /* 见下 */ };
    ```
  - `buildStream` 的 `prepareStep`（`:305`）里：
    ```ts
    prepareStep: ({ messages: stepMessages }) => {
      const delta = canvasDeltaLine();
      const msgs = compactModelMessages(stepMessages as ModelMessage[]);
      return { messages: delta ? [...msgs, { role: 'user', content: delta } as ModelMessage] : msgs };
    }
    ```
  - **`ai` v7 签名核对**：若该版本的 `prepareStep` 支持返回 `system`，优先用 `system` 覆盖而非追加
    user message（更干净）。实施时以 `node_modules/ai` 的 d.ts 为准，
    **在 PR 描述里写明选了哪条路及理由**。
- 改 `src/shared/canvasStream.ts`：不动。
- 改 `src/main/server/agent/canvasTools.ts:322`：与 P0-3 同一处（若两项分 PR，后合并者改）。
- 改 `src/main/server/canvas/agentExecutor.ts:63`（`upstreamContext`）
  - 只加注释：说明 `upstreamNodes` 是执行时读取，上游产物是新鲜的（§0.3.3）。

### 数据结构

```ts
// runtime.ts 内部，不导出
interface CanvasDeltaState { lastRev: number; lastIds: Set<string>; injections: number; }
const MAX_DELTA_INJECTIONS = 6;   // 一个 turn 最多注入 6 次，防止刷屏
const DELTA_MAX_CHARS = 200;
```

规则：
- `liveRevision` 未变 → 返回 `null`（**不注入**，保护 provider 的 prompt 缓存）
- 变化但只是 `run_state` / `node_output` → 也返回 `null`（运行状态 Agent 自己知道）
- 只在**节点集合发生增删**时注入
- `injections >= MAX_DELTA_INJECTIONS` 后停止注入（改为一句「画布仍在变化，需要时请调 read_canvas」）

### 验收标准

1. Agent 在一个 turn 内 `add_node` ×3 后再 `read_canvas` —— 返回里有那 3 个（本来就有，回归保护）。
2. **用户在 turn 进行中手动删掉一个节点** → Agent 下一步的 messages 末尾出现
   `[画布已变化] 删除 n_z；当前 N 个节点`，且 Agent 不再对该节点调 `run_node`。
3. 画布未变的连续 5 步 → **零注入**（用日志或单测断言 `canvasDeltaLine()` 返回 null）。
4. 一个 turn 内画布变了 10 次 → 最多注入 6 条，之后是那句兜底提示。
5. `read_canvas()` 无参调用行为与改动前逐字节一致。

### Review 检查点

- [ ] 注入放在 **messages 末尾**，不改 `instructions` 头部 —— 否则每步都会击穿 provider 的
      prompt 前缀缓存，成本显著上升。
- [ ] 只在**节点增删**时注入，`run_state` / `node_output` 的 rev 变化不触发。
- [ ] 有 `MAX_DELTA_INJECTIONS` 上限。
- [ ] `compactModelMessages`（`agent/modelHistory.ts`）不会把这条注入误当成需要保留的用户轮次
      而在历史里越积越多 —— 若会，给它加一个可丢弃标记。**这一条要实测**。
- [ ] `agentExecutor.ts` 只加注释，**没有**改逻辑。

### 风险

- **`ai` v7 的 `prepareStep` 返回类型**是最大不确定项。若不支持覆盖 system 且追加 user message
  会污染历史 ⇒ 退路：把增量注入降级为「只在 `read_canvas` 的返回里带一个 `changedSinceTurnStart`
  字段」，即**不主动推、只在 Agent 来读时告诉它变了多少**。这条退路成本极低，PR 里可以直接选它。
- 增量注入让每步 prompt 略有不同，可能影响某些 provider 的缓存命中率 —— 用「仅变化时注入」缓解。

---

## P1-1 · Agent 提议 = 可接受 / 可丢弃的 diff（提案态 `proposal`）

> 依赖 **P0-1**（批次 id）与 **P0-2**（撤销闭环）。这是本计划最大的一项。

### 现状

- decision 10：Agent 的结构编辑不弹权限，直接落库并广播。
- 用户对 Agent 的编排只有两种反应：接受（什么都不做）或事后一个个删（P0-2 之前连 `Ctrl+Z` 都没有）。
- 竞品已经走到「先给计划再动手」：Krea Node Agent 在动手前展示计划、允许换模型/删阶段、
  并给出 per-node 成本；Figma Agent 给一个锚定聊天窗展示步骤且全程可撤销。

### 目标

Agent 的一批结构写入可以落成**提案批次**：画布上以**幽灵态**出现
（虚线描边 + 60% 不透明 + 批次色徽章），批次上方浮出 `接受 (N)` / `丢弃`。
接受 → 转正 + 记一条撤销记录；丢弃 → 整批删除。
**默认关闭**（保持今天的 auto-apply 手感），在设置里可切到 review 模式。

### 方案（两条路线，给结论）

- **路线 A（服务端 staging，推荐）**
  节点/边多带一个 `proposalBatchId`；服务端照常落库并广播，但带上提案标记。
  渲染层据此渲染幽灵态。接受 = 清掉标记；丢弃 = 删除。
  ✅ 与「服务端权威 + 广播」架构一致；✅ 刷新/重启后提案仍在；✅ 复用现有全部通路。
- **路线 B（渲染层延迟落库）—— 否决**
  Agent 的写入直接进服务端，渲染层根本拦不住；要拦就得让 `canvasTools` 写进一个内存暂存区，
  等于新建第二套图状态。**违反服务端权威原则，明确否决，不要尝试。**

### 改动文件

- 改 `src/shared/canvas.ts`
  - `CanvasNode` 增可选 `proposalBatchId?: string | null`
  - `CanvasEdge` 增可选 `proposalBatchId?: string | null`
  - 新增 `export interface ProposalBatch { id: string; label: string; nodeIds: string[]; edgeIds: string[]; createdAt: string; }`
- 改 `src/shared/canvasStream.ts:8-17`
  - `CanvasEvent` 增
    `| { type: 'proposal'; batchId: string; state: 'open' | 'accepted' | 'discarded'; nodeIds: string[]; edgeIds: string[] }`
    （**只增成员，向后兼容**；旧客户端 `applyEvent` 的 switch 走不到就忽略）
- 改 `src/main/server/storage/canvasStore.ts`
  - `addNode` / `addEdge` 接受可选 `proposalBatchId`（DB 加一列，写 migration）
  - 新增 `acceptProposal(canvasId, batchId)` / `discardProposal(canvasId, batchId)`
- 改 `src/main/server/routes/canvas.ts`
  - `POST /:canvasId/proposal/:batchId/accept`、`POST /:canvasId/proposal/:batchId/discard`
- 改 `src/main/server/agent/canvasTools.ts`
  - `createCanvasTools` 的 options 增 `proposalMode: boolean`（由 `settingsStore` 读，
    在 `runtime.ts:283-286` 创建处传入）
  - `proposalMode` 为真时，`add_node` / `connect_nodes` / `group_nodes` / `attach_reference` /
    `create_storyboard_pipeline` 写入时带上本 turn 的 `batchId`（一个 turn 一个批次），
    并在工具返回里加 `proposal: true`，让 Agent 知道「还没生效，别急着 run」
  - `run_node` / `run_graph` **拒绝运行 pending 节点**，返回
    `{ error: '该节点还在待确认的提案里，请先让用户接受' }`
- 改 `src/main/server/canvas/graphExecutor.ts:60-72`
  - `inScope` 里剔除 `proposalBatchId != null` 的节点（提案节点不参与任何 run）
- 改 `src/main/server/canvas/exportWorkflow.ts`
  - 导出 `.reizo.zip` 时跳过 pending 节点/边（否则导出一个半成品工程）
- 改 `src/renderer/state/canvasStore.ts`
  - `applyEvent` 处理 `proposal` 事件；新增 `proposalsBySession`
  - `acceptProposal` / `discardProposal`，接受时 `record()` 一条撤销（undo = 重新变回 pending 或删除）
- 新增 `src/renderer/components/canvas/ProposalBar.tsx`
  —— 批次浮条（`<Panel position="top-center">`，显示 `Agent 提议：13 个节点 · 接受 / 丢弃`）
- 改各节点组件：`proposalBatchId` 时加 `.node-proposal` class（虚线 + 60% 透明）
- 改 `src/renderer/index.css`：`.node-proposal` 样式 + reduced-motion 块
- 改 `src/shared/settings.ts` + 设置页：`canvasProposalMode: boolean`（**默认 false**）

### 数据结构

```ts
// src/shared/canvas.ts
export interface CanvasNode {
  // …既有字段…
  /** 非空 = 该节点属于一个待用户确认的 Agent 提案批次，不可运行、不导出。 */
  proposalBatchId?: string | null;
}
```

### 验收标准

1. 设置里开启 review 模式后：Agent 建 13 个分镜 → 13 个节点以虚线幽灵态出现，
   顶部浮条显示「Agent 提议：13 个节点 · 接受 / 丢弃」。
2. 点「接受」→ 幽灵态消失、节点转正；`Ctrl+Z` 能把整批变回 pending（或整批撤销，二选一，PR 里定）。
3. 点「丢弃」→ 13 个节点与其间的边一起消失，撤销栈**不**增长（丢弃即回到原点）。
4. 提案未接受时：`run_graph` 跳过它们；节点上的「运行」按钮禁用并 tooltip 说明原因；
   `Agent` 调 `run_node` 收到明确 error。
5. 提案未接受时导出 `.reizo.zip` → 包里没有这些节点。
6. **设置关闭（默认）时，全流程与今天逐字节一致**（回归保护，必须有测试）。
7. 应用重启后未决提案仍在（证明走了服务端存储，不是内存态）。

### Review 检查点

- [ ] `CanvasEvent` / `CanvasNode` 的字段都是**可选新增**，旧 `.reizo.zip` 与旧 DB 行零改动可读。
- [ ] DB migration 幂等，且旧行的 `proposalBatchId` 为 NULL。
- [ ] 提案节点在 **5 处**都被正确排除：`graphExecutor` 的 `inScope`、`canvasTools.run_node`、
      `canvasTools.run_graph`、`exportWorkflow`、节点内运行按钮。
- [ ] 一个 turn 一个 `batchId`（不是一个工具一个），否则 13 个分镜会变成 27 个浮条。
- [ ] 默认 `canvasProposalMode = false`；开关在设置页有一句话解释代价（「Agent 编排需要你点确认」）。
- [ ] 幽灵态用设计 token（`--line` 虚线 + `opacity`），不硬编码 hex。

### 风险

- **这是本计划里唯一需要 DB migration 的项**，也是唯一跨越 shared / server / routes / renderer
  四层的项。建议**单独一个 PR**，且在 P0-1 / P0-2 合并之后再开。
- **手感风险**：强制 review 会毁掉「一句话生成分镜」的爽感 ⇒ 默认关闭是硬约束，不可协商。
- **半接受**：用户可能只想要 13 个里的 8 个。**v1 不做逐节点接受**（整批接受 / 整批丢弃），
  用户想删个别的就接受后自己删。逐节点接受留给 v2，写进「本轮不做」。

---

## P1-2 · Agent 编排的实时可视（波次流水线点亮）

### 现状

- `graphExecutor.ts` 已经广播 `graph_run { running, done, total }`（`:92` `:118` `:165` `:180`）。
- 渲染层唯一的消费是左竖条停止按钮的 `title`（`CanvasPanel.tsx:638`）和一条完成通知
  （`canvasStore.ts:165-177`）。
- 节点运行中有 `canvas-node-running` 脉冲 + 入边 `edge-flow-running` 加速（RW-4 已做）。
- 缺的是**波次感**：用户看不到「一共 4 波、现在第 2 波、这 3 个在跑、那 5 个在排队」。

### 目标

1. 画布底部导航条**上方**一条细进度条：波次刻度 + 当前波高亮 + `3/13`。
2. 排队中的节点显示第三态「排队中」（浅色描边 + 徽章），与 idle 区分开。
3. `create_storyboard_pipeline` + 立即 `run_graph` 时，视觉上就是一条流水线从左到右点亮。

### 方案（重要：不要动 `NodeRunState`）

`NodeRunState`（`shared/canvas.ts:14`）是**持久化枚举**，加 `'queued'` 要同步 DB + 5 处。
**不要加。** 排队态由渲染层派生：

- 波次结构：渲染层直接用**已在 shared 的** `buildPipelineWaves`
  （`src/shared/canvasGraph.ts`，`canvas/graph.ts` 只是 re-export，已有 `graph.test.ts` 覆盖）
  对自己的 `storeNodes` / `storeEdges` 算一次 —— **服务端零改动**即可得到波次划分。
- 「哪些正在跑」：`runState === 'running'` 已有。
- 「哪些在排队」= 在 scope 内 && 波次序号 > 当前波 && `runState !== 'done'`。
- 唯一需要服务端补的是**当前波序号**：`graph_run` 事件加两个可选字段
  `waveIndex?: number; waveTotal?: number`（只增可选字段，向后兼容）。

### 改动文件

- 改 `src/shared/canvasStream.ts:16`
  - `{ type: 'graph_run'; running: boolean; done: number; total: number; waveIndex?: number; waveTotal?: number }`
- 改 `src/main/server/canvas/graphExecutor.ts:168-177`
  - 进入每个 wave 前广播一次带 `waveIndex` / `waveTotal` 的 `graph_run`
- 改 `src/renderer/state/canvasStore.ts`
  - `GraphRun` 接口加 `waveIndex?` / `waveTotal?`；`applyEvent` 的 `case 'graph_run'` 透传
- 新增 `src/renderer/components/canvas/PipelineProgress.tsx`
  - `<Panel position="bottom-center" className="pb-14">`（压在导航条之上、选中浮条之下）
  - 只在 `graphRun?.running` 时渲染
- 改 `src/renderer/components/canvas/CanvasPanel.tsx`
  - 挂载 `<PipelineProgress>`；`nodes` memo 的 `data` 增 `queued: boolean`
- 改各节点组件的状态徽章：`queued` 时显示「排队中」（灰）
- 改 `src/renderer/index.css`：`.node-queued` 弱化样式 + reduced-motion 块

### 验收标准

1. `run_graph` 一个 4 波、13 节点的图：进度条出现，显示 4 个刻度，当前波高亮，右侧 `n/13`。
2. 第 2 波运行时，第 3、4 波的节点显示「排队中」徽章且描边弱化；第 1 波显示「完成」。
3. 上游失败导致下游被跳过时，那些节点从「排队中」变「失败」（`Upstream node failed`，
   `graphExecutor.ts:104-119` 已有），进度条继续推进不卡住。
4. 停止运行（左竖条 `Square`）→ 进度条消失，排队态清空。
5. `graph_run` 事件不带 `waveIndex` 的旧数据（或服务端未升级）→ 进度条降级为
   单段 `done/total` 条，不报错。
6. `prefers-reduced-motion` 下进度条无动画过渡。

### Review 检查点

- [ ] **没有**给 `NodeRunState` 加成员、**没有**动 DB。
- [ ] 波次由渲染层用 `shared/canvasGraph.ts:buildPipelineWaves` 算，与服务端同一份纯函数
      （不是两套实现）。
- [ ] `graph_run` 只增**可选**字段。
- [ ] 进度条的 z-index / 位置不与底部导航条（`pb-3`）和选中浮条（`pb-16`）打架 —— 三者一起截图。
- [ ] 大图（100 节点）时 `buildPipelineWaves` 在 memo 里，依赖数组正确，不每帧重算。

### 风险

- `run_graph` 带 `nodeIds` 白名单时（跑一个组），渲染层要用同样的 `inScope` 规则算波次，
  否则刻度数对不上。⇒ 渲染层的 `graphRun` 里需要知道 scope。
  **建议**：`graph_run` 再加一个可选 `scopeIds?: string[]`，服务端在 `running: true` 的首条事件里带上。
  这是本项唯一的额外字段，PR 里明确。

---

## P1-3 · 对话 ↔ 画布 双向指代

> 依赖 **P0-1**（复用 `shared/agentTrail.ts` 的 tool → nodeIds 解析）。

### 现状

- 单向：Agent 调工具 → `focusNode` 平移（`chatStore.ts:628`）。
- 画布类工具在对话里就是普通 `ToolCard`（`components/chat/ToolCard.tsx`），
  标题走 `toolDisplay.ts:toolLabel`（「画布加节点」），**点不动**，内容是一坨 JSON。
- 反向完全没有：hover 一个节点，不知道对话里哪句话提到过它。

### 目标

1. **对话 → 画布**：画布类工具卡片改为可点的**节点 chip 卡**
   （`＋ 图片节点「镜头1·关键帧」` / `连接 镜头1·关键帧 → 镜头1·运镜`），
   点击 → `canvasStore.spotlight(sessionId, nodeIds)`；hover → 画布上对应节点轻高亮。
2. **画布 → 对话**：hover 画布节点 → 对话里引用过它的 tool card / 用户消息（含 `@[..](canvas:id)`）
   加一层浅色描边。

### 改动文件

- 新增 `src/renderer/state/crossHighlightStore.ts`（**极轻**：`{ nodeIds: string[]; source: 'chat' | 'canvas' }`）
  - 独立 store 而非塞进 `canvasStore`：hover 是高频事件，塞进 `canvasStore` 会让
    整个 `nodesBySession` 订阅者重渲染（`canvas-ux-plan.md` §5 已有此约定）
- 新增 `src/renderer/components/chat/CanvasToolCard.tsx`
  - 用 `trailEntryFromTool` 得到 `{ verb, label, nodeIds }`，渲染成一行 chip + 可展开原始 JSON
  - `onMouseEnter` → `crossHighlight.set(nodeIds, 'chat')`；`onClick` → `canvasStore.spotlight(...)`
- 改 `src/renderer/components/chat/ToolCard.tsx`
  - 顶部分流：`isCanvasTool(part.name)` → 渲染 `<CanvasToolCard>`，否则维持现状
  - `isCanvasTool` 放 `shared/agentTrail.ts`（与解析同源）
- 改 `src/renderer/components/canvas/CanvasPanel.tsx`
  - `nodes` memo 的 `data` 增 `crossHighlighted: boolean`
  - 节点根 `onMouseEnter/Leave`（复用各节点已有的 `useHoverIntent`）→ `crossHighlight.set([node.id], 'canvas')`
- 改 `src/renderer/components/chat/MessageList.tsx` / `AssistantMessage.tsx`
  - 消息容器读 `crossHighlight`，`source === 'canvas'` 且该消息引用了这些 id 时加浅描边
- 改 `src/renderer/index.css`：`.cross-highlight` 样式 + reduced-motion 块

### 数据结构

```ts
// src/renderer/state/crossHighlightStore.ts
export interface CrossHighlight { nodeIds: string[]; source: 'chat' | 'canvas'; at: number }
```

### 验收标准

1. Agent 调 `add_node` → 对话里出现一行 `＋ 图片节点「镜头1·关键帧」`（不是原始 JSON 首屏）；
   点它 → 画布 spotlight 该节点。
2. hover 该 tool card → 画布上对应节点出现浅高亮；移开消失。
3. hover 画布上某个节点 → 对话里创建它的那张卡片出现浅描边。
4. 展开 tool card 仍能看到原始 JSON（不丢调试能力）。
5. 非画布工具（`read_file` / `run_command`）卡片外观零变化（回归保护）。
6. 100 个节点的画布上快速划过 20 个节点 → 无明显掉帧（证明 hover 没触发全画布重渲染）。

### Review 检查点

- [ ] `isCanvasTool` / `trailEntryFromTool` 只有**一份**实现（`src/shared/agentTrail.ts`）。
- [ ] hover 状态**不进** `canvasStore`，用独立轻 store。
- [ ] `crossHighlight` 有自动过期或 mouseleave 清理，不会留残影。
- [ ] `toolDisplay.ts:toolLabel` 里的画布工具中文名与 chip 上的动词**一致**
      （`add_node` 不能一处叫「画布加节点」一处叫「新增」）。

### 风险

- `ToolCard` 被 `WorkGroupCard.tsx` 等多处复用，分流点要选对，且已有
  `ToolCard.test.tsx` / `WorkGroupCard.test.tsx`，改动后必须跑通。

---

## P1-4 · 节点级 Agent 线程（在节点上多轮迭代）

### 现状

`agent` 节点是**单次 pass**：`runAgentNode`（`agentExecutor.ts:112`）把
`params.instruction` 当唯一 user message，答案写进 `output.text`（覆盖式）。
想「再赛博一点」只能改 instruction 重跑，上一轮的判断就没了。
节点 UI（`AgentNode.tsx:128-138`）也只有一个 instruction textarea。

### 目标

`agent` 节点挂一个**轻量多轮线程**：节点底部一行「追问…」输入框，回车追加一轮，
历史存在节点 params 里、显示在答案区上方（可折叠）。
对应 Figma Agent 的「锚定聊天窗，可继续riff」。

### 明确的能力边界（写进 PR 描述）

- 这是 **`agent` 节点**（只读侧车）的能力，**不给 image / video 节点**。
- image 节点的「再赛博一点」正确路径是**变体派生 + prompt 追加**（`forkVariations` 已有），
  不是在图片节点上塞对话 —— 否则会和「一个节点一个产物」的模型冲突，也会让变体宫格失去意义。
  **实施方不要顺手给 ImageNode 加对话框。**

### 改动文件

- 改 `src/shared/canvas.ts`
  - `CanvasAgentParams` 增 `thread?: Array<{ role: 'user' | 'assistant'; text: string; at: string }>`
- 改 `src/main/server/canvas/agentExecutor.ts:185-202`
  - `messages` 由 `[单条 user]` 改为：第一条 user（instruction + `upstreamContext` + 上游图片 parts）
    + `thread` 里的历轮
  - **上游图片只挂在第一条 user message 上**（避免每轮重传 bytes，`collectUpstreamImages:78` 不动）
  - 完成后把新一轮 assistant 文本 append 进 `params.thread`，并广播 `node_updated`
- 改 `src/renderer/components/canvas/AgentNode.tsx`
  - 答案区上方加可折叠的历史列表；底部加一行「追问…」输入框
  - 追问 = `updateNodeParams`（append user 轮）→ `runNode`
    —— `updateNodeParams`（`canvasStore.ts:668`）**已经 `record()`**，撤销闭环天然成立
- 改 `src/shared/canvas.ts`：`defaultNodeBox('agent')` 从 `{320,220}` 调到 `{320,300}`（留出线程区）

### 数据结构

```ts
export interface CanvasAgentParams {
  instruction: string;
  /** 追问历史。第一轮 = instruction，不重复存进 thread。最多保留最近 6 轮。 */
  thread?: Array<{ role: 'user' | 'assistant'; text: string; at: string }>;
}
export const AGENT_THREAD_MAX_TURNS = 6;
```

### 验收标准

1. agent 节点跑完一轮 → 底部出现「追问…」；输入「更批判一点」回车 →
   节点重新进入「思考中」，新答案流式写入，历史区出现上一轮的问与答。
2. 追问 3 轮后 `Ctrl+Z` → 撤回最后一次追问（`updateNodeParams` 的 record 生效）。
3. thread 超过 6 轮 → 最早的轮次被丢弃（保留首轮 instruction），params 不无限膨胀。
4. 上游是图片节点时：第一轮带图片 parts，第 2/3 轮**不重传** bytes（用日志或断言验证）。
5. `.reizo.zip` 导出 / 导入后 thread 完整保留（走 `params`，`exportWorkflow` 无需改）。
6. image / video 节点**没有**追问框（回归保护）。

### Review 检查点

- [ ] `thread` 是 `params` 里的可选字段，旧节点 `undefined` 时行为与今天一致。
- [ ] `MAX_STEPS = 12`（`agentExecutor.ts:15`）不变；多轮不等于放开工具循环上限。
- [ ] 截断逻辑（保留首轮 + 最近 5 轮）抽成 `src/shared/` 的纯函数并配 vitest。
- [ ] 追问输入框带 `nodrag` + `stopPropagation`（`canvas-ux-plan.md` §5）。
- [ ] `runAgentNode` 里 `paramsHash: inputHash(node, upstream)`（`:231`）在多轮后仍正确
      —— thread 变化应当让节点 dirty 失效逻辑仍成立。

### 风险

- params 体积：6 轮 × 每轮 ~1k 字符 ≈ 6KB/节点。可接受，但 `nodeBrief`（`canvasTools.ts:15`）
  **不要**把 thread 塞进 `read_canvas` 的返回（会撑爆主 Agent 的 context）——
  只返回最后一轮的 `text`。这一条必须做。

---

## P2-1 · 成本 / 权限门：Agent 发起的付费生成

### 现状

**UI 路径有门，Agent 路径没有：**

| 发起方 | 路径 | 是否有确认 |
|---|---|---|
| 用户点节点「运行」 | `canvasStore.runNode` → `POST /:canvasId/nodes/:id/run` | `confirmedSpend: true` 必填（`routes/canvas.ts:161`） |
| 用户点左竖条「运行整图」 | `canvasStore.runGraph` → `POST /:canvasId/run` | `confirmedSpend` + UI 二段确认（`CanvasPanel.tsx:344-354`） |
| **Agent 调 `run_node`** | `canvasTools.ts:244` **直接 `void runImageNode(...)`** | ❌ **完全绕过 HTTP 与 `confirmedSpend`** |
| **Agent 调 `run_graph`** | `canvasTools.ts:269` 直接 `void runGraph(...)` | ❌ 无 |
| **`create_storyboard_pipeline` 的 `autoRunFirstScene`** | `canvasTools.ts:226` | ❌ 无 |

即：用户点一个图要二次确认，Agent 一句话跑 13 个图不需要任何确认。

### 目标

设置项 `canvasSpendGate: 'agent-free' | 'confirm-batch' | 'confirm-all'`，**默认 `confirm-batch`**：

- Agent 跑**单个**付费节点 → 直接跑（保留手感）
- Agent 一次要跑 **≥ N 个付费节点**（`run_graph`、或 `create_storyboard_pipeline` 的 auto-run）→
  **画布上浮出确认条**：`Agent 想运行 6 个付费节点（约 6 次图像生成）· 运行 / 取消`

### 方案（两条路线，给结论）

- **路线 1（画布内确认条，推荐为 v1）**
  工具立即返回 `{ status: 'awaiting_user', pendingRunId, count }`，Agent 得知「已请示，等用户」；
  渲染层收到一个新的 `CanvasEvent` 浮出确认条；用户点「运行」→ `POST /:canvasId/pending-run/:id/confirm`
  → 服务端真正 `runGraph`。
  ✅ 轻；✅ 主题一致（确认发生在**画布上**，和「Agent 在画布上的存在感」是同一件事）；
  ✅ 不动 chat 的 permission 状态机。
- **路线 2（复用 chat permission 通路，v2）**
  `canvasTools` 拿到 `emit`（`runtime.ts:264` 给 workspaceTools 的写法），发 `{type:'permission'}`；
  但 `runtime.ts:338-373` 的 `onAwaitingInteraction` 只把批准后的调用分发给 `toolset.executeApproved`
  —— 要让它也能分发 canvas 工具，得改 `permissions.ts` 与 runtime 的恢复逻辑。
  ❗ 这是本项 80% 的成本所在。**v1 不做。**

### 改动文件（路线 1）

- 改 `src/shared/settings.ts` + 设置页：`canvasSpendGate`（默认 `'confirm-batch'`）、`spendGateThreshold`（默认 3）
- 改 `src/shared/canvasStream.ts`
  - 增 `| { type: 'pending_run'; id: string; nodeIds: string[]; paidCount: number; reason: string }`
  - 增 `| { type: 'pending_run_resolved'; id: string; ok: boolean }`
- 新增 `src/main/server/canvas/pendingRun.ts` —— 内存 Map（同 `selection.ts` 的形态），
  `createPendingRun` / `confirmPendingRun` / `cancelPendingRun`，带 5 分钟过期
- 改 `src/main/server/agent/canvasTools.ts:240` `:259` `:225`
  - 跑之前算 `paidCount`（`image` / `video` 类型且在 scope 内的数量），
    超阈值则 `createPendingRun` + 广播 + 返回 `{ status: 'awaiting_user' }`
- 改 `src/main/server/routes/canvas.ts`：`POST /:canvasId/pending-run/:id/(confirm|cancel)`
- 新增 `src/renderer/components/canvas/PendingRunBar.tsx`（`<Panel position="top-center">`，
  与 P1-1 的 `ProposalBar` 同一位置，二者互斥显示）
- 改 `src/renderer/state/canvasStore.ts`：`applyEvent` 处理两个新事件 + `confirmPendingRun` / `cancelPendingRun`

### 验收标准

1. 默认设置下，Agent 调 `run_graph` 跑 6 个图片节点 → 画布顶部浮出
   「Agent 想运行 6 个付费节点 · 运行 / 取消」，**没有任何生成发生**。
2. 点「运行」→ 流水线开始，P1-2 的进度条出现；对话里那次工具调用的结果显示为「已确认并运行」。
3. 点「取消」→ 不运行，Agent 收到明确结果，能改口（比如改成只跑 1 个）。
4. Agent 跑**单个**节点 → 直接跑（无确认），手感不变。
5. 设为 `agent-free` → 行为与今天完全一致（回归保护）。
6. 确认条 5 分钟未响应 → 自动过期并广播 resolved(ok:false)，不会永久悬挂。

### Review 检查点

- [ ] `paidCount` 的口径写清：只数 `image` / `video`，`agent` 节点是 LLM 调用（也花钱但便宜）
      —— **PR 里给结论**是否计入。
- [ ] pending run 状态是内存态（同 `selection.ts`），重启后失效并有兜底，不会卡住画布。
- [ ] 没有改 chat 的 permission 状态机（路线 2 的成本被显式推迟）。
- [ ] `CanvasEvent` 只增成员。
- [ ] 确认条与 P1-1 的 `ProposalBar` 位置冲突已处理（同 `top-center`，需要排队或合并成一个「Agent 请示区」）。

### 风险

- **Agent 侧的等待语义**：工具返回 `awaiting_user` 后，Agent 很可能会立刻说「我已经开始生成了」。
  ⇒ 工具的 `description` 与返回文案要写得很明确：`"运行尚未开始，正在等待用户在画布上确认"`。
  这是 prompt 层面的事，但会直接影响体验，PR 必须实测一次真实对话。

---

## P2-2 · 右面板结构收敛 + 节点→对话动词统一（UX-7 / UX-8）

### 现状

- `RightPanel.tsx:35-42`：Tab `画布 / 作品`（会话级）+ `文件 / Git / 终端`（工作区级）平级并列；
  「作品」其实是画布产物的归档，关系没被表达。
- `:45-47` `preferCanvas` 只切 Tab，无落点提示（P0-1 已补一半）。
- 节点→对话三种措辞（§0.2 L6）。
- 用户已明确**否决独立窗口 / pop-out**。

### 目标

1. `LABELS.artifacts` 「作品」→「作品库」；`visible` 顺序保证 `canvas` 恒在 `artifacts` 左侧；
   作品库顶部加一行说明「本会话画布产出的已存档资产」。
2. 窗口控制（最大化 / 关闭）从 Tab 行右端移到分隔条顶端的小竖条，与 Tab 分层。
3. P0-1 的「Agent 活动」薄条**归位决策**：留在画布右上（推荐，和画布同一空间）
   还是提到右面板 Tab 行下方（全局可见）—— PR 里给结论并截图对比。
4. 节点→对话统一为**两个动词**：`问 Agent`（发消息）/ `引用`（进输入框）；
   `+ 质检 Agent`（建下游节点）改名为 **`+ 监工节点`**，与前两者语义彻底分开。

### 改动文件

- `src/renderer/components/workspace/RightPanel.tsx:12-47` `:86-123`
- `src/renderer/components/canvas/CanvasPanel.tsx:367 askAgent` / `:380 refToComposer` /
  `:864-874`（右键菜单）/ `:741-849`（底部浮条，与 P0-3 同一处）
- `src/renderer/components/canvas/ImageNode.tsx` / `VideoNode.tsx` / `AgentNode.tsx`
  的 `NodeActionBar` 动作表（措辞统一，顺序按 `canvas-ux-plan.md` §4.1 的定义表）
- 新增 `src/shared/nodeActions.ts`（可选）：把动作定义表抽成数据，右键菜单 / 动作条 / 底部浮条
  三处共用一份 —— 这正是 `canvas-ux-plan.md` §1 原则 1 的要求

### 验收标准

1. 右面板 Tab 显示「画布 / 作品库 / 文件 / Git / 终端」，`画布` 恒在 `作品库` 左侧。
2. 「让 agent 处理」「投送给 Agent 质检」两处措辞消失，统一为「问 Agent」。
3. 动作条上的「质检 Agent」改名为「+ 监工节点」，tooltip 说明「在下游建一个只读点评节点」。
4. 三处入口（右键 / 动作条 / 底部浮条）的动作 id、图标、顺序来自同一份表。
5. 没有新增任何独立窗口 / pop-out。

### Review 检查点

- [ ] 动作定义表若抽到 `src/shared/`，必须是**纯数据 + 纯函数**（不含 React 元素），
      icon 在渲染层按 id 映射。
- [ ] 措辞改动同步到 `toolDisplay.ts:toolLabel`（对话里的工具名）与 P1-3 的 chip。
- [ ] `RightPanel` 的 Tab 状态与 `uiStore.setCanvasOpen` 的联动不回归。

### 风险

- 低。纯前端、纯措辞与布局，可随时回退。

---

## 2. 本轮不做（明确排除）

| 项 | 排除理由 |
|---|---|
| **Agent 光标幽灵 / presence 头像** | Reizo 是单机单用户、画布是会话级；协作 presence 是装饰而非信息。P0-1 的足迹层已经覆盖了「Agent 刚动了什么」这个真需求 |
| **独立窗口 / pop-out 画布** | 用户已明确否决 |
| **给 `agent` 节点写画布的权限** | 隔离只读是它的产品定义（`agentExecutor.ts` 的注释即契约）。要写画布就该用主对话的 `canvasTools`，两套写路径会让撤销、提案、成本门全部翻倍 |
| **逐节点接受 / 拒绝提案** | P1-1 v1 只做整批。逐节点接受要引入 per-node 状态机与部分依赖（接受了 video 却拒了它的 start_frame 图），复杂度不成比例 |
| **`studio` P1-2 确定性 `llm` 分镜编剧节点** | 需要同步 5 处（`CanvasNodeType` / `defaultNodeBox` / `routes NODE_TYPES` / `CanvasPanel NODE_TYPES` / `RUNNABLE` / `add_node` enum），而 `create_storyboard_pipeline` 已覆盖 80% 场景。**需产品决策**（见下） |
| **`studio` P2-2 结构化 verdict + 自动重跑** | 「Agent 判定不合格 → 自动重跑」在没有 P1-1 提案态与 P2-1 成本门之前是**危险的**（会静默烧钱循环）。必须排在这两项之后 |
| **多画布 / 跨会话画布** | 与本主题正交 |
| **实时协同 / 语音** | 与本主题正交 |
| **把足迹升级为 `CanvasEvent.actor` 字段** | P0-1 用 chat 事件派生足够；等真出现第二个写入方再做（已在 P0-1 风险里留了升级路径） |

## 3. 需产品决策（PR 前必须有答案）

1. **提案态默认开还是默认关？**
   建议：**默认关**（`canvasProposalMode = false`），设置里可开。理由见 P1-1 风险。
2. **Agent 付费运行的阈值 N？**
   建议：**3**。低于 3 直接跑，≥ 3 走画布确认条。`agent` 节点是否计入 paidCount 一并定。
3. **Agent 写入的撤销粒度：一次工具调用一条，还是一个 turn 一条？**
   建议：**一次工具调用一条**（与 `AgentTrailEntry.id` 对齐）；若一个 turn 产生 > 10 条则合并。
4. **「问 Agent」到底是发消息还是建节点？**
   建议：**发消息**；建节点改名为「+ 监工节点」。两者语义必须分开（§0.2 L6）。
5. **「Agent 活动」薄条放画布右上还是右面板顶部？**
   与 `AssetShelf` 抢位（`CanvasPanel.tsx:550`）。建议画布右上、压在 AssetShelf 之下，PR 附截图。
6. **`llm` 分镜编剧节点这一轮做不做？**
   建议：**不做**。理由：`create_storyboard_pipeline` 已产出 note + keyframe + video + 连线；
   `llm` 节点的增量价值主要是「大纲 → 严格 schema JSON → 一键展开」，
   在 P1-1 提案态落地后，这个价值会自然被「提案 = 可预览可改的分镜草案」吸收。

---

## 4. 落地顺序与依赖

```
P0-1 Agent 足迹层 ──┬──> P0-2 写入进撤销栈（复用批次 id / nodeIds）
  (纯前端 + shared) │
                    └──> P1-3 双向指代（复用 agentTrail 解析）
                                   │
P0-3 选区结构化上下文 ──────────────┤ (独立；含 flushSelection 竞态修复)
  (shared + runtime + 1 处 schema) │
                                   │
P0-4 turn 内可见性 ────────────────┤ (纯服务端；与 P0-3 共用 read_canvas schema 变更)
                                   │
P1-2 编排实时可视 ─────────────────┤ (几乎纯前端，可与任何项并行)
                                   │
P1-4 节点级 Agent 线程 ────────────┤ (独立，只碰 agent 节点)
                                   │
P0-1 + P0-2 ──> P1-1 提案态 ───────┼──> P2-1 成本门（复用 ProposalBar 的浮条位）
       (唯一需要 DB migration)     │
                                   └──> P2-2 面板 + 动词收敛（最后收尾）
```

**关键路径**：`P0-1 → P0-2 → P1-1 → P2-1`。其余四项可并行插队。

### PR 拆分建议（7 个）

| PR | 内容 | 规模 | 触及层 |
|---|---|---|---|
| **PR-1** | P0-1 足迹层（`shared/agentTrail.ts` + 薄条 + 徽章 + 包围盒 fitView） | 中 | shared / renderer |
| **PR-2** | P0-2 Agent 写入进撤销栈 | 小 | renderer |
| **PR-3** | P0-3 选区结构化上下文 + 底部浮条收敛 + `flushSelection` 竞态修复 + `read_canvas` schema | 中 | shared / server / renderer |
| **PR-4** | P0-4 turn 内增量注入（含 `ai` v7 `prepareStep` 签名结论；退路方案可接受） | 小 | server |
| **PR-5** | P1-2 波次流水线可视 + P1-4 节点级线程（两项都小且互不相干，可合可分） | 中 | shared / server / renderer |
| **PR-6** | P1-1 提案态（**唯一带 DB migration**，单独开、单独 review） | 大 | 四层全覆盖 |
| **PR-7** | P2-1 成本门 + P1-3 双向指代 + P2-2 面板/动词收尾 | 中 | 全层 |

建议 PR-1 / PR-2 先行合并——它们修的是**正确性问题**（Agent 的动作看不见、撤不掉），
且为后面所有项提供了「批次」这个共同抽象。

---

## 5. 统一约定（所有工作项）

- **服务端权威**：图状态永远由 SQLite + `canvasStore(server)` 决定，
  变更经 `CanvasChannel.broadcast`（`canvas/channel.ts:29`）广播，渲染层订阅 NDJSON。
  **不新增轮询、不新增第二条 socket。**
- **撤销闭环**：结构改动经 `canvasStore.record()`（`state/canvasStore.ts:81`，`HISTORY_CAP = 60`），
  **一次用户手势 / 一次 Agent 工具调用 = 一条记录**。
- **纯逻辑进 `src/shared/` 并配 vitest**：本计划新增
  `agentTrail.ts` / `canvasSubgraph.ts`（+ 各自 `.test.ts`），
  复用已有 `canvasGraph.ts` / `canvasReadiness.ts` / `referenceAnchors.ts`。
- **Agent 工具 schema 只做三件事**：加新工具、加可选参数、给 enum 加成员。
  本计划涉及：`read_canvas` 加 `scope`/`ids`；`update_node` 可能加 `x`/`y`（P0-3 待定）；
  `add_node` 等在 proposal 模式下的返回里加 `proposal: true`。**不删字段、不改必填性。**
- **`CanvasEvent` 只增成员 / 只增可选字段**（`shared/canvasStream.ts:8`），
  旧客户端走不到新 case 时必须静默忽略而非抛错。
- **新增 node 类型要同步 5 处**：`shared/canvas.ts` 的 `CanvasNodeType` + `defaultNodeBox`；
  `routes/canvas.ts:19 NODE_TYPES`；`CanvasPanel.tsx:67 NODE_TYPES`；
  `graphExecutor.ts:13 RUNNABLE`；`canvasTools.ts:55 add_node` enum + `nodeBrief`。
  —— **本计划刻意不新增任何 node 类型**（`llm` 节点已排除）。
- **颜色 / 间距只用设计 token**（`--paper*` / `--ink*` / `--line` / `--accent` / `--accent-ink`，
  `src/renderer/index.css`）；边与句柄的语义色只在 `edges/edgeStyles.ts` 定义一份。
- **所有新增动画进 `prefers-reduced-motion` 降级块**（`index.css:431`）：
  本计划涉及 `.agent-mark`、`.node-proposal`、`.node-queued`、`.cross-highlight`、
  以及 `fitView` 的 `duration`（reduced-motion 时传 0）。
- **z-index 层级沿用**：节点 1 < 动作条 20 < popover 30 < 右键菜单 150 < 拖线菜单 160 < 快捷键卡 170。
  新增浮条（`AgentActivityStrip` / `ProposalBar` / `PendingRunBar` / `PipelineProgress`）
  用 React Flow `<Panel>`，不自己造定位层。
- **hover / 高亮态不进 `canvasStore`**，用节点本地 state 或独立轻 store，
  避免污染撤销栈与全画布重渲染。

---

## 参考来源（2026-09 核对）

- [Krea — The Node Agent](https://www.krea.ai/blog/ai-workflow-agent)（先给计划 / per-node 成本 / 逐层点亮）
- [Krea — Announcing the Krea Node Agent](https://www.krea.ai/index/ai-workflow-agent)
- [FLORA Docs — FAUNA](https://docs.flora.ai/editor/fauna)（Agent 住在节点画布里）
- [Vercel — How FLORA shipped a creative agent](https://vercel.com/blog/how-flora-shipped-a-creative-agent-on-vercels-ai-stack)
- [Runway — Creating with Runway Agent](https://help.runwayml.com/hc/en-us/articles/51601639579667-Creating-with-Runway-Agent)
- [Runway — Changelog](https://runway.com/changelog)（Agent 2.0 / ChatCanvas / Talk·Tab·Tune）
- [Figma — Work with the Figma agent in design files](https://help.figma.com/hc/en-us/articles/37998629035799-Work-with-the-Figma-agent-in-design-files)（锚定聊天窗 / 步骤可见 / 全程可撤销）
- [Figma — Agents, Meet the Figma Canvas](https://www.figma.com/blog/the-figma-canvas-is-now-open-to-agents/)
- [tldraw — Agent starter kit](https://tldraw.dev/starter-kits/agent)（上下文 = 消息 + 选区 + 视口 + 圈定区域）
- [tldraw — AI integrations](https://tldraw.dev/docs/ai)
- [ComfyUI-Copilot v2 "Agent Nest"](https://www.solosoft.dev/post/comfyui-copilot-ai-assistant-2026/)（多角色编排 + 生成后走图校验）
- [Knowledge-Centric Agents for Workflow Generation in ComfyUI](https://arxiv.org/pdf/2607.15845)

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
