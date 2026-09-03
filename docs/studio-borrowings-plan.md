# 竞品交互借鉴集成计划 — Reizo 画布（Studio Borrowings）

Status: **计划待实施**（2026-09-03）。姊妹文档：`docs/helios-borrowings-plan.md`（HeliosGen 借鉴，已实施）、
`docs/canvas-plan.md`（画布原始设计决策）。

本文件写给**实施方（其他 AI / 工程师）**：每个工作项自带「现状 / 目标 / 改动文件 / 方案 /
数据结构 / 验收标准 / Review 检查点 / 风险」。按 P0 → P2 顺序做，工作项之间除注明的依赖外
互相独立，可分 PR。

借鉴对象与其当下的交互形态（2026-09 核对）：

| 竞品 | 借鉴的交互 | 关键术语 |
|---|---|---|
| Krea / Midjourney | 卡片浮动动作条：Variations / Animate / Upscale / Inpaint | Seed（变体）、Upscale、Realtime Board |
| Runway Gen-3/4 · 可灵 Kling | 首尾帧 + 可视化运镜 | Keyframes（first / last frame）、Camera Control（pan / tilt / roll / zoom，方向 + 强度 −10..10） |
| Leonardo AI · InvokeAI | 资产一致性图钉 | Character Reference / Style Reference / Content Reference，强度 Low / Mid / High / Max，最多 6 张 |
| Dify / Coze | LLM 确定性单步节点 vs Agent 自主节点 | LLM Node（严格 schema 输出）vs Agent Node（带工具 / 记忆 / 多轮） |

---

## 0. 缺口判定 —— 4 个借鉴点 vs Reizo 现状

先说结论，避免重复造轮子。**加粗**的是真实缺口。

### 借鉴点 #1 · 卡片浮动动作条

**Reizo 已覆盖约 60%。**

| 竞品能力 | Reizo 现状 | 判定 |
|---|---|---|
| 卡片上弹出微动作条 | 有，但**只在 `selected` 时**：`ImageNode.tsx:137`、`AgentNode.tsx:49`、`VideoNode.tsx:100` 三份**各自重复**的 `absolute -top-8` pill | 增强现有 |
| 变体 Variations | 有 `canvasStore.forkNode`（含入边重连），但**一次只出 1 个**，位置固定 `x + w + 32` → 连点会**互相重叠**，且不自动运行 | 增强现有 |
| 转成视频 Animate | 只能「从右句柄拖线 → 松在空白 → `dropConnectMenu` 选『生成运镜视频』」（`CanvasPanel.tsx:854-878`，已正确连到 `start_frame`）。**动作条上没有一键入口** | 增强现有 |
| 高清放大 Upscale | **完全没有**。`imageExecutor.ts` 只有 `generateImage`，无放大端点，`size` 只有三档 | **新增（且需 provider 决策）** |
| 局部重绘 Inpaint | **完全没有**，且需要蒙版画笔 UI + mask 通道 + provider inpainting 端点 | **本轮不做**（见 §8） |

→ 真实缺口：**hover 即现**、**统一组件**（三份重复）、**变体 ×4 宫格**、**Upscale**。

### 借鉴点 #2 · 首尾帧 + 可视化运镜

**Reizo 首尾帧已覆盖 ~90%，运镜只覆盖 ~25%。**

| 竞品能力 | Reizo 现状 | 判定 |
|---|---|---|
| 首帧 / 尾帧双插槽 | **已有**：`VideoNode.tsx:167-195` 两个 target handle `start_frame`（top 65%）/ `end_frame`（top 85%），带中文标注；`videoExecutor.ts:36-56` 按 `targetHandle` 分派 → `startImageBytes` / `endImageBytes`；`klingDriver` 映射 `image` / `image_tail`，`falDriver` 映射 `image_url` / `end_image_url` | 已做，不动 |
| 抽帧接续 | **已有**：`VideoNode.tsx:416-443` 抽首/尾/当前帧 → `canvasStore.extractVideoFrame` 落成新 image 节点并连线 | 已做，不动 |
| Pan / Tilt / Roll / Zoom + 强度滑杆 | **只有一个 6 项枚举下拉**（`CANVAS_VIDEO_CAMERAS` = `none|zoom_in|zoom_out|pan_left|pan_right|orbit`）。**没有 Tilt、没有 Roll、没有强度、没有可视化控制器** | **增强现有（含 bug 修复）** |
| driver 侧结构化运镜 | `klingDriver.ts:31-33` 写的是 `body.camera_control = { type: params.cameraMotion }` —— **这是一个既存 bug**：可灵 `camera_control.type` 只接受 `simple` / `down_back` / `forward_up` / `right_turn_forward` / `left_turn_forward` 等预设，`zoom_in` / `pan_left` **不是合法 type**，强度要走 `config: { horizontal, vertical, pan, tilt, roll, zoom }`（各 −10..10，`simple` 下**只能有一个非零**）。`falDriver.ts` 则**完全忽略** `cameraMotion` | **增强现有（含 bug 修复）** |

→ 真实缺口：**可视化控制器 + Tilt/Roll + 强度 + driver 正确映射**。

### 借鉴点 #3 · 资产一致性图钉

**Reizo 覆盖约 15%，是四点里缺口最大的。**

| 竞品能力 | Reizo 现状 | 判定 |
|---|---|---|
| 固定的主角 / 风格素材栏 | **完全没有**。画布上没有「常驻资产」概念 | **新增** |
| 角色 / 风格 / 内容三类语义 | **完全没有**。`imageExecutor.ts:56-75` 的 `upstreamImageBytes` 就是**无序取上游前 2 张**，没有 role、没有权重 | **新增** |
| 一根细线或勾选即生效 | 最接近的是 `@[label](canvas:id)` 提及（`shared/resolveMentions.ts`）—— 它能给参考图**定序**（`<<<image N>>>`），但要求「被引节点已有产物」且**逐节点手写**；`create_storyboard_pipeline` 的 `carryReference` 是把「镜头 1 关键帧」硬编码 @ 进后续 prompt（`canvasTools.ts:145-148`），是这个需求的**土办法** | 增强 + 新增 |
| IP-Adapter / Character Reference 底层通道 | **没有**。`generateImage({ prompt: { text, images } })` 是 `ai` SDK 的通用 img2img，**没有 per-image role / weight 参数位** | **需产品决策（见 §8）** |

→ 真实缺口：**图钉节点 + 素材栏 UI + role/strength 语义 + 批量挂载**。底层 v1 只能做到「有序垫图 + 语义化 prompt 前缀」。

### 借鉴点 #4 · LLM 确定性节点 vs Agent 自主节点

**Reizo 覆盖约 40%（VLM 那半意外地已经有了）。**

| 竞品能力 | Reizo 现状 | 判定 |
|---|---|---|
| Agent 自主节点（带工具、多轮） | **已有**：`agentExecutor.ts:runAgentNode` —— headless、隔离、只读工具 `read_canvas` / `read_node`、`stopWhen: isStepCount(12)`、流式写 `output.text` | 已做 |
| 「画面监工」看得见图 | **已有但没人知道**：`agentExecutor.ts:78-102` `collectUpstreamImages` 会把上游 image 节点的图作为 `{type:'image'}` part 送进多模态消息，system prompt 也已写了「inspect their visual composition…」 | 增强现有（补 UI 与结构化输出） |
| LLM 确定性单步节点（严格 schema） | **完全没有**。只有 `agent` 一种，输出永远是自由文本 `output.text`，下游只能当上下文塞 prompt，**无法结构化 fan-out** | **新增节点类型** |
| 质检结果驱动自动重跑 | **完全没有** | **新增（P2，默认关闭）** |

→ 真实缺口：**`llm` 确定性节点（分镜编剧）** + **质检的结构化 verdict**。

### 优先级总表

| 工作项 | 借鉴点 | 类型 | 优先级 |
|---|---|---|---|
| P0-1 统一悬停浮动动作条 | #1 | 增强 | P0 |
| P0-2 变体宫格派生 `forkVariations` | #1 | 增强 | P0 |
| P0-3 可视化运镜控制器 + driver 修复 | #2 | 增强 + 修 bug | P0 |
| P1-1 参考图钉 `anchor` 节点 + 资产素材栏 | #3 | 新增类型 | P1 |
| P1-2 确定性 `llm` 节点（分镜编剧） | #4 | 新增类型 | P1 |
| P2-1 高清放大 Upscale + imageDrivers 抽象 | #1 | 新增 | P2 |
| P2-2 质检 Agent 结构化 verdict + 自动重跑 | #4 | 增强 | P2 |

---

## P0-1 · 统一悬停浮动动作条 NodeActionBar

### 现状

三处**重复实现**同一个视觉：
- `ImageNode.tsx:137-182` — 变体分支 / + 质检 Agent /（有产物时）存为产物
- `AgentNode.tsx:49-81` — 变体分支 /（有答案时）复制结果
- `VideoNode.tsx:100-149` — 变体分支 / + 质检 Agent /（有产物时）存为产物

三份都是 `selected ? <div className="nodrag absolute -top-8 left-0 z-20 …">`。问题：

1. **只在选中时出现**，Krea/MJ 是**悬停即现**，少一次点击。
2. 三份样式/顺序/间距各自维护，已经开始漂移（VideoNode 的 tooltip 文案与 ImageNode 不一致）。
3. image 卡上**没有 Animate 入口** —— 用户必须知道「拖线松在空白处」这个隐藏手势才能一键转视频。
4. video 卡上「抽首/尾帧」藏在产物图片的 hover 层里（`VideoNode.tsx:416`），跟动作条是两套心智。

### 目标

- 一个共享组件 `NodeActionBar`，三种节点类型（后续 `anchor` / `llm` 也复用）统一挂载。
- 触发条件 `selected || hovered`，hover 离开有 ~140ms 宽限期，鼠标移到动作条本身不算离开。
- image 卡新增 **🎬 转成视频（Animate）** —— 在右侧自动建 video 节点、自动连 `start_frame`、预填运镜 prompt，**一步到位**，与 `dropConnectMenu` 的那条路径共用同一个 store 方法。
- video 卡把「抽尾帧续拍」提到动作条（保留产物 hover 层的三个按钮不动，两个入口指向同一 `extractVideoFrame`）。
- 动作条上留出「变体 ×4」「高清放大」的槽位（分别由 P0-2 / P2-1 填充，本项先渲染 `disabled` 或不渲染，PR 里说明选择）。

### 改动文件

- **新增** `src/renderer/components/canvas/NodeActionBar.tsx`
- **新增** `src/renderer/hooks/useHoverIntent.ts`（或就近放在 `NodeActionBar.tsx` 里，PR 里给结论）
- 改 `src/renderer/components/canvas/ImageNode.tsx`：删掉内联 bar（`:137-182`），改 `<NodeActionBar actions={…} visible={selected || hovered} />`；根 `<div>` 挂 `onMouseEnter` / `onMouseLeave`
- 改 `src/renderer/components/canvas/AgentNode.tsx`：同上（`:49-81`）
- 改 `src/renderer/components/canvas/VideoNode.tsx`：同上（`:100-149`），并加「抽尾帧续拍」动作
- 改 `src/renderer/state/canvasStore.ts`：新增 `animateFromImage(sessionId, imageNodeId): Promise<string | null>`
- 改 `src/renderer/index.css`：`.node-action-bar` 的 opacity / translateY 过渡 + `prefers-reduced-motion` 降级

### 数据结构

纯前端，无 DTO / DB 变更。

```ts
// NodeActionBar.tsx
export interface NodeAction {
  id: string;
  icon: React.ReactNode;
  label: string;
  title: string;              // tooltip
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'accent'; // accent 走 --accent token
}

export default function NodeActionBar(props: {
  visible: boolean;
  actions: NodeAction[];
  /** 视口顶部时翻到卡片下方，避免出界 */
  placement?: 'top' | 'bottom';
}): JSX.Element | null;
```

`animateFromImage` 走**现有** `addNodeAndConnect`，因此天然是一条撤销记录：

```ts
export async function animateFromImage(sessionId: string, imageNodeId: string): Promise<string | null> {
  const src = nodeById(sessionId, imageNodeId);
  if (!src || src.type !== 'image') return null;
  return addNodeAndConnect(
    sessionId,
    {
      type: 'video',
      x: src.x + src.w + 56,
      y: src.y,
      title: src.title ? `${src.title} · 运镜` : '视频生成',
      params: { prompt: '', duration: '5s', ratio: '16:9', cameraMotion: 'none' },
    },
    imageNodeId,
    null,          // sourceHandle
    'start_frame', // targetHandle —— 必须，否则退化成普通输入
  );
}
```

### 验收标准

1. 鼠标悬停任一 image / agent / video 卡片（**不点击**），动作条淡入；移开 ~140ms 后淡出。
2. 鼠标从卡片移到动作条上（穿过两者之间的间隙）**不会**让动作条消失。
3. 选中态下动作条常驻（与改动前行为一致），即使鼠标不在卡上。
4. image 卡点「🎬 转成视频」→ 右侧出现 video 节点，连线落在 **`start_frame` 句柄**（不是默认输入）；Ctrl+Z **一次**同时撤掉节点和边。
5. `dropConnectMenu` 的「生成运镜视频」与动作条的「转成视频」产出**结构一致**（同 params、同 handle）。
6. 三种节点类型的动作条在**同一垂直高度、同一圆角、同一间距**（截图 diff 或人工确认）。
7. 卡片位于视口最上沿时，动作条不被裁切（翻到下方或自动内缩，PR 里说明采用哪种）。
8. `prefers-reduced-motion: reduce` 下无淡入动画，直接显示/隐藏。

### Review 检查点

- [ ] 三个节点文件里**没有**残留的 `absolute -top-8` 内联 bar（`rg "absolute -top-8" src/renderer` 应只命中 `NodeActionBar.tsx`）。
- [ ] 动作条根元素带 `nodrag`，且 `onClick` 里 `e.stopPropagation()`，避免触发 React Flow 的节点拖拽 / 选中变化。
- [ ] hover 状态存在**节点组件本地 state**，不进 `canvasStore`（不能污染撤销栈，也不能引起全画布重渲染）。
- [ ] `animateFromImage` 走 `addNodeAndConnect`，**没有**手写 `_addNode` + `_addEdge` 两条 `record()`。
- [ ] 动作条 `z-index` 高于同层节点但低于 `dropConnectMenu`（`z-[160]`）与右键菜单（`z-[150]`）。
- [ ] 颜色全部走 `--accent` / `--ink` / `--line` / `--paper-raised` token，无硬编码 hex。
- [ ] 大画布（50+ 节点）下 hover 不产生可感知掉帧（hover state 局部化即可满足）。

### 风险

- 低。纯前端、可回退。
- 唯一需要注意的是 hover 与 React Flow 的 `panOnDrag` / `selectionOnDrag` 事件竞争 —— 用 `nodrag` + `stopPropagation` 即可。

---

## P0-2 · 变体宫格派生 forkVariations

### 现状

`canvasStore.ts:357-389` `forkNode`：克隆 1 个节点到 `x + source.w + 32`，重连所有入边，一条 `record()`。
问题：

1. 连点 4 次 → 4 个新节点**坐标完全相同**，叠成一摞（每次都基于同一 `source.x`）。
2. `CanvasPanel.tsx:749-761` 的「批量派生变体」对多选节点各调一次 `forkNode` → **N 条撤销记录**，Ctrl+Z 要按 N 次。
3. 派生后不会自动运行，用户要逐个点「生成」。
4. Krea/MJ 的心智是「一次给我 4 个候选并排」，Reizo 现在是「一次给我 1 个」。

### 目标

- 动作条上的 **`+ 变体 ×4`**：在源节点右侧生成 N（默认 4）个继承 params + 入边的兄弟节点，按 **2×2 宫格**排布，标题 `原名 (变体 1..4)`。
- **一条**撤销记录撤掉全部 N 个节点 + 全部重连的边。
- 可选「立即生成」：一次 `runGraph(sessionId, undefined, newIds)`，直接吃到现有波浪调度的 `MAX_CONCURRENCY = 3` 并发（`graphExecutor.ts:17`），比逐个点快 ~3x。付费动作 → 走与 `runAll` 相同的**二次确认**（`CanvasPanel.tsx:329-339` 的 `confirmAll` 模式）。
- 宫格位置要**避开已有节点**，否则跟旁边的分镜叠在一起。

### 改动文件

- **新增** `src/shared/variantLayout.ts` + `src/shared/variantLayout.test.ts`（vitest，与 `arrangeNodes.test.ts` 同目录同风格）
- 改 `src/renderer/state/canvasStore.ts`：新增 `forkVariations()`
- 改 `src/renderer/components/canvas/NodeActionBar` 的调用方 `ImageNode.tsx` / `VideoNode.tsx`：加 `变体 ×4` 动作（agent 节点保留单个 `forkNode`）
- 改 `src/renderer/components/canvas/CanvasPanel.tsx`：底部多选条的「批量派生变体」（`:749-761`）改为**一条**记录 —— 要么复用 `forkVariations(…, count: 1)` 逐个但包一层 `record`，要么新增 `forkSelected`。PR 里给结论。

### 数据结构

```ts
// src/shared/variantLayout.ts — 纯函数，无 IO
export interface Box { x: number; y: number; w: number; h: number }

/**
 * 在 `source` 右侧铺 `count` 个同尺寸格子（默认 2 列），并整体向右/向下平移
 * 直到与 `occupied` 中任何盒子都不相交。返回左上角坐标数组，顺序 = 行优先。
 */
export function variantGrid(
  source: Box,
  count: number,
  occupied: Box[],
  opts?: { cols?: number; gapX?: number; gapY?: number },
): Array<{ x: number; y: number }>;
```

```ts
// canvasStore.ts
export async function forkVariations(
  sessionId: string,
  nodeId: string,
  count = 4,
): Promise<string[]>;
```

实现要点（与 `duplicateSelectedNodes`（`canvasStore.ts:757-809`）同构，照抄其 `record()` 写法）：

```
positions = variantGrid({x,y,w,h of source}, count, 画布上所有节点的盒子)
for i in 0..count-1:
  newId = _addNode({ type: source.type, ...positions[i], w, h,
                     title: `${source.title || 默认名} (变体 ${i+1})`,
                     params: { ...source.params } })
  createdIds.push(newId)
  for edge of 入边(nodeId):
    createdEdgeIds.push(_addEdge(sessionId, edge.sourceId, newId,
                                 edge.sourceHandle, edge.targetHandle))   // ← handle 必须带上
record(sessionId, {
  undo: 先删所有 createdEdgeIds 再删所有 createdIds,
  redo: forkVariations(sessionId, nodeId, count),
})
```

**注意**：现有 `forkNode` 重连入边时**丢掉了 handle**（`canvasStore.ts:373` `_addEdge(sessionId, edge.sourceId, newId)`），这会让 video 节点变体的首帧连线退化成默认输入。`forkVariations` **必须**带上 `edge.sourceHandle` / `edge.targetHandle`；顺手把 `forkNode` 也修掉（同 PR，一行）。

无 DTO / DB 变更。

### 验收标准

1. 一个有上游连线的 image 节点点「变体 ×4」→ 右侧出现 2×2 共 4 个节点，**互不重叠**，且各自都保留了与原上游的连线。
2. 旁边已有节点占位时，宫格整体让位，不与任何已有节点相交。
3. Ctrl+Z **一次**撤掉全部 4 个节点和 4×M 条边；Ctrl+Shift+Z 再全部恢复。
4. 一个连了 `start_frame` 的 video 节点做变体 → 新节点的入边仍落在 `start_frame` 句柄（回归 `forkNode` 的 handle 丢失 bug）。
5. 勾「立即生成」→ 需二次点击确认；确认后网络面板显示**最多 3 个并发**请求，`graph_run` 进度 `total = 4`。
6. `variantLayout.test.ts` 覆盖：count=1/4/6、cols 参数、`occupied` 为空、`occupied` 完全挡住右侧（应向下让位）、源节点尺寸非默认。
7. 底部多选条的「批量派生变体」也变成一条撤销记录。

### Review 检查点

- [ ] `variantGrid` 在 `src/shared/`，纯函数、无 `Date.now()` / 无随机、配 vitest。
- [ ] `forkVariations` 只 `record()` **一次**；`undo` 里边先删、节点后删（顺序反了会留孤儿边）。
- [ ] 重连入边**带上 `sourceHandle` / `targetHandle`**；`forkNode` 的同类 bug 一并修。
- [ ] 自动运行走 `canvasStore.runGraph(sessionId, undefined, newIds)`（已有的 `nodeIds` 白名单路径，`canvasStore.ts:818`），**不要**逐个 `runNode`。
- [ ] 付费动作有二次确认，且确认态 3s 自动回退（与 `runAll` 一致）。
- [ ] `redo` 重新调 `forkVariations` 会产生**新 id** —— 与 `duplicateSelectedNodes` 现有行为一致，可接受，但要在注释里写明。

### 风险

- 中：`redo` 产生新 id 意味着「撤销 → 重做 → 再撤销」这条链上的第二次 undo 依赖闭包里被覆盖的 `createdIds`。照抄 `duplicateSelectedNodes` 的写法（它已在 main 上跑通）即可，不要自创。
- 低：4 张并发生成的费用感知 —— 靠二次确认 + 按钮文案写明「将生成 4 张（付费）」。

---

## P0-3 · 可视化运镜控制器 CameraDial（含 driver 映射修复）

### 现状

```
VideoNode.tsx:285-310   一个 <Select>，6 个选项
   ↓ params.cameraMotion: 'none'|'zoom_in'|'zoom_out'|'pan_left'|'pan_right'|'orbit'
videoExecutor.ts:76     cameraMotion: params.cameraMotion || 'none'
   ↓ VideoGenerateParams.cameraMotion: string   (videoDrivers/types.ts:5)
klingDriver.ts:31-33    body.camera_control = { type: params.cameraMotion }   ← 非法 type
falDriver.ts            完全不读 cameraMotion                                  ← 静默丢弃
mockDriver.ts           不回显
```

缺三样东西：**Tilt**（俯仰）、**Roll**（旋转）、**强度**。而且 orbit / zoom_in 这些字符串直接当可灵的
`camera_control.type` 发出去是错的 —— 可灵的 `simple` 类型要求把量放进
`config: { horizontal, vertical, pan, tilt, roll, zoom }`，每项 −10..10，且 **`simple` 下只能有一个非零**。
Runway Gen-3 Turbo 的形态同样是「四个轴 + 方向 + 强度滑杆（−10..10）」，两家可以用同一套抽象。

### 目标

- `VideoNode` 上把单个 Select 换成一个**运镜控制器 popover**：
  - 二维方向摇杆（拖拽同时给 `pan` 水平 + `tilt` 垂直，或两个滑杆，实现二选一）
  - `zoom` 滑杆（推进 / 拉远）
  - `roll` 滑杆（顺 / 逆时针）
  - 每轴显示 `−10 … +10` 的数值与中文语义（「向右摇 6」「俯拍 3」）
  - 顶部保留**现有 6 个 preset chip**，一键把值填进去（老用户零学习成本，也是 `cameraMotion` 的迁移路径）
  - 触发按钮上显示当前运镜的一句话摘要
- 底层出一份 `src/shared/cameraMotion.ts` 纯函数，负责：preset → 结构化值、夹取与归一（可灵单轴约束）、结构化值 → 自然语言 prompt 后缀、结构化值 → 可灵 `camera_control`。
- **向后兼容**：`cameraMotion` 字段保留不删；`camera` 缺失时由 `cameraFromPreset(cameraMotion)` 派生。老画布、老 `.reizo.zip`、`create_storyboard_pipeline` 写入的节点全部照常工作。
- 修 `klingDriver` 的非法 type；给 `falDriver` 补 prompt 后缀降级（fal 的 kling 端点没有 `camera_control` 通道）。

### 改动文件

- **新增** `src/shared/cameraMotion.ts` + `src/shared/cameraMotion.test.ts`
- 改 `src/shared/canvas.ts`：`CanvasVideoParams` 加 `camera?: CameraControl`；导出 `CAMERA_AXES`
- 改 `src/main/server/canvas/videoDrivers/types.ts`：`VideoGenerateParams` 加 `camera?: CameraControl`（保留 `cameraMotion`）
- 改 `src/main/server/canvas/videoExecutor.ts`：派生 `camera`，拼 prompt 后缀，传给 driver
- 改 `src/main/server/canvas/videoDrivers/klingDriver.ts`：`camera_control` 走 `cameraToKlingConfig`
- 改 `src/main/server/canvas/videoDrivers/falDriver.ts`：注释说明无结构化通道，靠 prompt 后缀
- 改 `src/main/server/canvas/videoDrivers/mockDriver.ts`：把收到的 `camera` 存进 `MockTask` 以便断言
- **新增** `src/renderer/components/canvas/CameraDial.tsx`
- 改 `src/renderer/components/canvas/VideoNode.tsx`：`:284-310` 的 Select → CameraDial popover 触发按钮
- 改 `src/main/server/agent/canvasTools.ts`：`update_node` 加**可选** `camera` 参数（schema 向后兼容）；`create_storyboard_pipeline` 的 `camera` enum **不动**，但 execute 里把 preset 同时展开成 `camera` 存入 params

### 数据结构

```ts
// src/shared/cameraMotion.ts

/** 每轴 −10..10，与可灵 simple / Runway Gen-3 的强度区间对齐。 */
export interface CameraControl {
  /** 水平平移（推轨左右），负=左 */
  horizontal?: number;
  /** 垂直平移（升降），负=下 */
  vertical?: number;
  /** 摇移，绕 y 轴，负=左摇 */
  pan?: number;
  /** 俯仰，绕 x 轴，负=下俯 */
  tilt?: number;
  /** 旋转，绕 z 轴，负=逆时针 */
  roll?: number;
  /** 推拉焦距，正=推进 */
  zoom?: number;
}

export const CAMERA_AXES: Array<{
  id: keyof CameraControl;
  label: string;      // '摇移 Pan'
  negLabel: string;   // '向左摇'
  posLabel: string;   // '向右摇'
}>;

/** 老的 6 个 preset → 结构化值。'none' → {}。 */
export function cameraFromPreset(preset?: string): CameraControl;

/** 夹取到 [-10,10]、丢弃 0、按需只保留绝对值最大的一轴（可灵 simple 约束）。 */
export function normalizeCamera(c: CameraControl, opts?: { singleAxis?: boolean }): CameraControl;

/** → '镜头缓慢向右摇移并轻微俯拍' 之类的自然语言后缀；空值返回 ''。 */
export function cameraToPrompt(c: CameraControl): string;

/** → 可灵 camera_control 载荷；无有效轴时返回 undefined。 */
export function cameraToKlingConfig(
  c: CameraControl,
): { type: 'simple'; config: Record<string, number> } | undefined;

/** UI 摘要，如 '右摇 6 · 推进 3'；空值返回 '默认运镜'。 */
export function cameraSummary(c: CameraControl): string;
```

`shared/canvas.ts`：

```ts
export interface CanvasVideoParams {
  prompt: string;
  duration?: '5s' | '10s';
  ratio?: '16:9' | '9:16' | '1:1';
  /** @deprecated 保留用于向后兼容与快捷 preset；实际运镜以 `camera` 为准。 */
  cameraMotion?: 'none' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'orbit';
  /** 结构化运镜。缺失时由 `cameraFromPreset(cameraMotion)` 派生。 */
  camera?: CameraControl;
  provider?: string;
  model?: string;
}
```

`videoExecutor.ts` 装配：

```ts
const camera = normalizeCamera(params.camera ?? cameraFromPreset(params.cameraMotion));
const cameraHint = cameraToPrompt(camera);
const generateParams: VideoGenerateParams = {
  prompt: cameraHint ? `${promptText}\n${cameraHint}` : promptText,
  duration: params.duration || '5s',
  ratio: params.ratio || '16:9',
  cameraMotion: params.cameraMotion || 'none',   // 保留，老 driver 不炸
  camera,
  startImageBytes,
  endImageBytes,
};
```

**DB 迁移：不需要**（`canvas_nodes.params` 是 JSON 列）。

### 验收标准

1. video 卡的运镜按钮显示摘要文本（初始「默认运镜」）；点开出现摇杆 + zoom + roll + 6 个 preset chip。
2. 点 preset「推进 (Zoom In)」→ `zoom` 填成正值，摘要变「推进 N」，`params.camera` 被写入；Ctrl+Z 能撤回（走 `updateNodeParams`）。
3. 拖摇杆到「右摇 6 + 俯拍 3」→ 摘要与数值同步；`normalizeCamera(singleAxis)` 生效时**只有 pan=6 进 kling config**，tilt 降级到 prompt 后缀（PR 里说明策略并在 UI 上提示）。
4. 用 mock driver 跑一次，`MockTask.params.camera` 等于 UI 上设的值，`params.prompt` 末尾含中文运镜后缀。
5. **回归**：一个只有 `cameraMotion: 'orbit'`、没有 `camera` 字段的老节点（可造一条，或导入旧 `.reizo.zip`）仍能正常生成，且 driver 收到的是 `cameraFromPreset('orbit')` 的结构化值。
6. `klingDriver` 发出的 body 中 `camera_control` 形如 `{ type: 'simple', config: { pan: 6 } }`，**不再**是 `{ type: 'pan_left' }`。
7. `falDriver` 的 body 不含 `camera_control`，但 `prompt` 含运镜后缀。
8. `cameraMotion.test.ts` 覆盖：6 个 preset 各自的映射、夹取（12 → 10、−99 → −10）、全 0 → `{}`、`singleAxis` 取最大轴、`cameraToPrompt` 的中英文措辞、`cameraToKlingConfig` 空值返回 `undefined`。
9. Agent 用 `update_node` 传 `camera: { tilt: -5 }` 能生效；不传 `camera` 的旧调用行为不变。

### Review 检查点

- [ ] `cameraMotion.ts` 在 `src/shared/`，纯函数，主/渲染两端**同一份**，无 `import` 任何 Node / DOM API。
- [ ] `CanvasVideoParams.cameraMotion` **没有被删**，`CANVAS_VIDEO_CAMERAS` 常量保留（preset chip 复用它）。
- [ ] `videoExecutor` 里 prompt 后缀是**追加**，不是替换用户 prompt。
- [ ] 可灵单轴约束在 `normalizeCamera` 里实现（纯函数可测），**不在 driver 里现场判**。
- [ ] `falDriver` / `mockDriver` 收到未知 `camera` 字段不会抛（结构体只加可选字段）。
- [ ] CameraDial 的拖拽挂 `nodrag`，且拖到画布外松手不会卡住（`pointerup` 挂在 `window`）。
- [ ] 写回 params 是 `onPointerUp` 一次 `updateNodeParams`，**不是**拖拽过程中每帧写 —— 否则撤销栈会被灌满（`HISTORY_CAP = 60`）。
- [ ] `create_storyboard_pipeline` 的 `camera` enum 参数**没改签名**（只在 execute 内部多写一个 `camera` 字段）。

### 风险

- 中：可灵「simple 只能一个非零轴」这条约束是本项最容易踩的坑。策略是 `normalizeCamera(singleAxis: true)` 只保留最大轴 + 其余轴降级进 prompt，并在 UI 上给一行灰字提示。若后续接入支持多轴的模型，把 `singleAxis` 按 driver 能力开关即可。
- 低：老数据兼容 —— 由 `cameraFromPreset` 兜底，且有回归用例。
- 低：`orbit` 没有直接对应轴（可灵有 `left_turn_forward` 等预设 type）。建议 `cameraFromPreset('orbit')` 映射成 `{ horizontal: 5, pan: -5 }` 的近似 + prompt 里明写「环绕运镜」，并在 `cameraToKlingConfig` 里对 orbit 特判回预设 type。PR 里给结论。

---

## P1-1 · 参考图钉 anchor 节点 + 资产素材栏 Asset Shelf

### 现状

- 参考图路径只有两条，且都很弱：
  1. `imageExecutor.ts:56-75` `upstreamImageBytes` —— 遍历上游 image 节点，**无序**取前 2 张，`slice(0, 2)` 硬编码。
  2. `@[label](canvas:id)` 提及（`shared/resolveMentions.ts`）—— 能定序（`<<<image N>>>`），但要求被引节点**已有产物**，且每个节点都要手写一遍。
- **没有** role（角色 / 风格 / 内容）、**没有** strength、**没有**常驻资产的概念。
- `create_storyboard_pipeline` 的 `carryReference`（`canvasTools.ts:145-148`）把「镜头 1 关键帧」硬编码 @ 进后续每个 prompt —— 这是本需求的土办法，说明痛点真实存在。
- 多镜头角色漂移目前只能靠用户手动 @ 每个节点。

### 目标

- 新增 **`anchor` 节点类型**：画布上的「图钉」，持有 1 张参考图 + `role`（`character` / `style` / `content`）+ `strength`（`low` / `mid` / `high`）。**非 RUNNABLE**（不会被「运行整图」误跑、不进波浪）。
- 新增 **资产素材栏**：`<Panel position="top-right">` 常驻栏位，列出本画布所有 anchor 缩略图。支持：
  - 直接把本地图片拖进素材栏 → 建 anchor
  - 点缩略图 → 高亮/居中对应节点
  - 选中若干 image/video 节点后点「挂到选中」→ **批量**连 `reference` 句柄，**一条**撤销记录
- image / video 节点左上新增 `reference` target handle（多入边），视觉上与 `start_frame`（amber）区分开（建议 violet）。
- `imageExecutor` 组装参考图时：**anchor 图排最前**（按 character → style → content 排序），其后是 `@mention` 图，最后是普通上游垫图；同时把 role/strength 展开成一段中文语义前缀拼进 prompt。

### 诚实的能力边界（**必须写进 PR 描述**）

`imageExecutor.ts` 走的是 `ai` SDK 的 `generateImage({ model, prompt: { text, images }, size })`。
这个接口**没有 per-image 的 role / weight 参数位** —— 也就是说 **v1 拿不到真正的 IP-Adapter / Character Reference**，
只能做到：

1. **有序 + 有语义的垫图**（哪张是角色、哪张是风格，靠 `<<<image N>>>` 占位 + 文字说明告诉模型）；
2. **一致的强度措辞**（`high` → 「严格保持…完全一致」，`low` → 「参考其气质即可」）。

真正的 IP-Adapter 需要在 provider 层开一个新通道（见 §8「需产品决策」）。**不要在 PR 里宣称已实现 IP-Adapter。**

video 侧更弱：`klingDriver` 的 `image` / `image_tail` 已被首尾帧占用，fal 的 kling 端点同理。
所以 **video 节点的 anchor 只影响 prompt 文本**，参考图不进 driver。这一点要在 `VideoNode` 的
`reference` 句柄 tooltip 上直说（「仅作为文字风格约束，不作为垫图」）。

### 改动文件

**shared**
- `src/shared/canvas.ts`：`CanvasNodeType` 加 `'anchor'`；加 `CanvasAnchorParams` / `AnchorRole` / `ANCHOR_ROLES` / `ANCHOR_STRENGTHS`；`defaultNodeBox('anchor')`
- **新增** `src/shared/referenceAnchors.ts` + `.test.ts`：纯函数，把 anchor 列表 → 排序后的引用列表 + prompt 前缀

**服务端**
- `src/main/server/canvas/imageExecutor.ts`：`runImageNode` 里插入 anchor 解析；把 `slice(0, 2)` 提成具名常量 `MAX_REFERENCE_IMAGES`
- `src/main/server/canvas/videoExecutor.ts`：只拼 prompt 前缀（降级路径）
- `src/main/server/canvas/graphExecutor.ts`：`RUNNABLE` **不含** `'anchor'`（默认即如此，加一行注释说明）
- `src/main/server/routes/canvas.ts`：`NODE_TYPES` set 加 `'anchor'`（`:19`）；`/import` 端点加可选 `type` 与 `params`，让拖图直接落成 anchor（`:239-279`）
- `src/main/server/agent/canvasTools.ts`：`add_node` 的 `type` enum 加 `'anchor'` + 可选 `role` / `strength`（**只增可选参数**）；`nodeBrief` 暴露 `role` / `strength`；**新增**工具 `attach_reference({ anchorId, targetIds })`

**渲染层**
- **新增** `src/renderer/components/canvas/AnchorNode.tsx`
- **新增** `src/renderer/components/canvas/AssetShelf.tsx`
- `src/renderer/components/canvas/CanvasPanel.tsx`：`NODE_TYPES` 注册 `anchor`（`:56`）；顶部工具条加「+ 图钉」；挂载 `<AssetShelf>`
- `src/renderer/components/canvas/ImageNode.tsx` / `VideoNode.tsx`：加 `reference` target handle + 标注
- `src/renderer/components/canvas/edges/edgeStyles.ts`：`reference` 边色（violet），与 handle 同源
- `src/renderer/state/canvasStore.ts`：`addAnchorFromFile()`、`attachAnchor(sessionId, anchorId, targetIds)`（一条 `record()`）、`detachAnchor()`、`setAnchorRole()` / `setAnchorStrength()`（走 `updateNodeParams`，天然可撤销）
- `src/renderer/api.ts`：`importCanvasImage` 加可选 `type` / `params` 透传

### 数据结构

```ts
// src/shared/canvas.ts
export type CanvasNodeType = 'image' | 'agent' | 'video' | 'note' | 'group' | 'anchor';

export type AnchorRole = 'character' | 'style' | 'content';
export type AnchorStrength = 'low' | 'mid' | 'high';

export interface CanvasAnchorParams {
  role: AnchorRole;
  strength: AnchorStrength;
  /** 自由备注，如「女主 · 红色风衣」；参与 prompt 前缀生成。 */
  note?: string;
}

export const ANCHOR_ROLES: Array<{ id: AnchorRole; label: string; hint: string }> = [
  { id: 'character', label: '角色', hint: '锁定人物外形 / 服装 / 面部' },
  { id: 'style',     label: '风格', hint: '锁定色调 / 笔触 / 材质' },
  { id: 'content',   label: '内容', hint: '锁定构图 / 场景元素' },
];
export const ANCHOR_STRENGTHS: Array<{ id: AnchorStrength; label: string }> = [
  { id: 'low', label: '弱' }, { id: 'mid', label: '中' }, { id: 'high', label: '强' },
];
// defaultNodeBox('anchor') => { w: 200, h: 250 }
```

参考图本体存 `node.output.assets[0]`（复用现有 `/import` 落盘 + `canvasAssetUrl` + 导出打包，零新增基础设施）。

```ts
// src/shared/referenceAnchors.ts — 纯函数
export interface AnchorRef {
  id: string;
  role: AnchorRole;
  strength: AnchorStrength;
  note?: string;
  title: string;
  assets: string[];
}

export interface AnchorPlan {
  /** 按 character → style → content 排序后的资产相对路径，喂给 images[] */
  orderedAssetRefs: string[];
  /** 追加到 prompt 最前的中文语义约束，内含 <<<image N>>> 占位 */
  promptPrefix: string;
}

/** `startIndex` 是 <<<image N>>> 的起始编号（anchor 排在 @mention 之前时为 1）。 */
export function planAnchors(anchors: AnchorRef[], startIndex?: number): AnchorPlan;
```

`planAnchors` 产出示例：

```
保持 <<<image 1>>> 中角色的面部特征、发型与服装完全一致（严格）；
采用 <<<image 2>>> 的整体色调、光影与笔触风格（中等强度）。
```

`imageExecutor.runImageNode` 里的新装配顺序（**替换** `:134-166` 那段）：

```
anchors = 入边中 targetHandle === 'reference' 或源节点 type === 'anchor' 的上游
{ orderedAssetRefs: anchorRefs, promptPrefix } = planAnchors(anchors, 1)

if (rawPrompt.includes('@')) { mentionRefs = resolveMentions(..., startIndex = anchorRefs.length + 1) }
   ↑ 注意：resolveMentions 目前把编号写死从 1 开始（resolveMentions.ts:137 `let imageNum = 1`），
     需要给它加一个可选 `startIndex` 参数（默认 1，向后兼容），否则占位符会和 anchor 撞号。

images = [...读(anchorRefs), ...读(mentionRefs)]
if (images.length === 0) images = upstreamImageBytes(...)     // 保留原兜底
images = images.slice(0, MAX_REFERENCE_IMAGES)                // 具名常量，默认 4
prompt = { text: promptPrefix ? `${promptPrefix}\n${rawPrompt}` : rawPrompt, images }
```

**DB 迁移：不需要。** `canvas_nodes.type` 是文本列、`params` 是 JSON 列。

### 验收标准

1. 把一张本地图拖进右上素材栏 → 画布上出现一个 anchor 节点，缩略图正确，默认 role=角色 / 强度=中。
2. anchor 节点上能切换 role（角色/风格/内容）与强度（弱/中/强），Ctrl+Z 可撤回。
3. 选中 3 个 image 节点 → 素材栏点「挂到选中」→ 3 条 violet 的 `reference` 边出现；**Ctrl+Z 一次**全撤掉。
4. 运行其中一个 image 节点：请求体 prompt 以中文语义前缀开头，含 `<<<image 1>>>`；`images[0]` 是该 anchor 的图。
5. 同时挂 1 个角色 anchor + 1 个风格 anchor + prompt 里写了 1 个 `@某节点` → 占位符编号为 1、2、3 且**不重号**，`images` 顺序与编号一一对应。
6. anchor 节点**不出现在**「运行整图」的 `graph_run total` 里；`buildPipelineWaves` 不把它当依赖阻塞下游（它不是 RUNNABLE，下游 image 的 deps 会穿过它 —— 确认 `canvasGraph.ts:167-185` 的「穿过非 runnable」逻辑对此成立）。
7. Agent 调 `read_canvas` 能看到 anchor 节点及其 `role` / `strength`；调 `attach_reference` 能挂线。
8. 导出 `.reizo.zip` → 新 session 导入：anchor 节点、图、`reference` 边的 handle 全部还原（`importWorkflow.ts:162-163` 已保留 handle，加一条回归用例）。
9. video 节点挂 anchor：prompt 里出现语义前缀，driver body 里**没有**多余的图片字段（首尾帧不受影响）。
10. `referenceAnchors.test.ts` 覆盖：空列表、单 role、三 role 排序、strength 措辞、`startIndex` 偏移、anchor 无产物（应被跳过且不占号）。

### Review 检查点

- [ ] `anchor` 已加进**全部四处**：`shared/canvas.ts` 的 `CanvasNodeType`、`routes/canvas.ts:19` 的 `NODE_TYPES`、`CanvasPanel.tsx:56` 的 React Flow `NODE_TYPES`、`canvasTools.ts` 的 `add_node` enum。（`graphExecutor.RUNNABLE` 是**故意不加**，注释写明。）
- [ ] `resolveMentions` 的 `startIndex` 是**可选参数、默认 1**，现有调用点与单测零改动。
- [ ] `planAnchors` 是 `src/shared/` 纯函数 + vitest，主/渲染两端复用。
- [ ] anchor 无产物时**跳过**，不占 `<<<image N>>>` 编号，也不塞空 buffer。
- [ ] `MAX_REFERENCE_IMAGES` 是具名常量并有注释（说明为何是 4 —— 与 Leonardo 最多 6 张、多数 provider 的实际上限做过取舍）。
- [ ] `attachAnchor` 一条 `record()`；undo 里删掉的是**本次新建的**边 id，不是按 (source,target) 重查。
- [ ] `reference` 边色只在 `edgeStyles.ts` 定义一份，handle 与边引用同一常量。
- [ ] 素材栏 `<Panel>` 不遮挡 MiniMap / Controls，且节点为 0 时不显示空壳。
- [ ] PR 描述里**明确写出**「v1 不是 IP-Adapter，是有序垫图 + 语义前缀」。
- [ ] **顺手记一笔**：`importWorkflow.ts:18` 的 `remapMentions` 只重写了 legacy 的 `@#<id8>`，**没有**重写规范形式 `@[label](canvas:<id>)` —— 导入后规范提及会指向不存在的旧 id。这是既存 bug，anchor 让它更明显。要么本 PR 顺手修（`CANONICAL_MENTION_RE` 走一遍 `oldToNew`），要么单开 issue，**不要默默忽略**。

### 风险

- 中高：**底层通道缺失**。做完之后一致性提升的幅度取决于模型对「有序垫图 + 文字说明」的服从度，可能明显低于 Leonardo 的 Character Reference。缓解：验收里用同一 anchor 跑 4 个镜头做主观对比，若提升不明显则把结论写进 §8 推动 provider 层扩展。
- 中：参考图数量上限。多个 anchor + 多个 @mention 很容易超过 provider 能吃的张数 → `MAX_REFERENCE_IMAGES` 截断会**静默丢图**。必须在 UI 上给出「已超出 N 张上限，末尾 M 张被忽略」的提示。
- 低：新增节点类型对导入导出 / Agent 工具的扩散 —— 靠上面的「四处都加」检查点覆盖。

---

## P1-2 · 确定性 llm 节点（分镜编剧）

### 现状

画布上**只有一种**智能节点：`agent`（`agentExecutor.ts`）。它是探索型的 —— 带只读工具、最多 12 步、
输出自由文本 `output.text`。下游节点消费它的方式是把文本折进 prompt 当上下文
（`agentExecutor.ts:63-76` `upstreamContext`）。

因此**做不到**：
- 「故事大纲 → 严格 schema 的分镜 JSON → 自动展开成 N 个 image + N 个 video 节点」
- 任何需要机器消费上一步输出的编排（结构化 fan-out）

而 `create_storyboard_pipeline`（`canvasTools.ts:84`）虽然能一次生成整条流水线，但那是
**主 Agent 在聊天里调工具**，画布上留不下「这份分镜是怎么来的、怎么改一个字重跑」的可编辑单元。

### 目标

新增 **`llm` 节点类型 = Dify 的「LLM 节点」**：确定性、单步、**无工具**、**无图片**、低温度、**输出严格 schema**。

- preset：`storyboard`（故事大纲 → 分镜 JSON）、`prompt_polish`（提示词润色，输出字符串数组）、`shot_list`（镜头清单）、`custom`（自定义 instruction + 自定义 schema=none 时退化为纯文本）
- 输出写两处：`output.text`（pretty JSON，人可读 / 可复制）与**新增**的 `output.json`（结构化，机器可读）
- 节点上一个 **「展开为画布节点」** 按钮：读 `output.json`，按 `create_storyboard_pipeline` 同款水平时间线布局，在下方生成 image + video 节点并连线 —— **一条**撤销记录
- `agent` 节点保持不变（它是探索者），文档里把两者的分工写清楚

### 改动文件

**shared**
- `src/shared/canvas.ts`：`CanvasNodeType` 加 `'llm'`；加 `CanvasLlmParams` / `CANVAS_LLM_PRESETS`；`CanvasNodeOutput` 加**可选** `json?: unknown`；`defaultNodeBox('llm')`
- **新增** `src/shared/llmSchemas.ts` + `.test.ts`：zod schema（`storyboardV1` / `promptListV1`）+ `parseLlmOutput()` 容错解析（剥 ```json 围栏、修尾逗号）

**服务端**
- **新增** `src/main/server/canvas/llmExecutor.ts`：`runLlmNode()`，与 `runImageNode` / `runAgentNode` **同契约**（fire-and-forget、`channel.broadcast` run_state / node_output、失败走 `fail()`、成功写 `paramsHash: inputHash(node, upstream)`）
- `src/main/server/canvas/graphExecutor.ts`：`RUNNABLE` 加 `'llm'`；`runOne` 分派加一支
- `src/main/server/routes/canvas.ts`：`NODE_TYPES` 加 `'llm'`；`/nodes/:id/run` 分派加一支（**文本节点，不需要 `confirmedSpend` 闸门**，与 agent 一致）
- `src/main/server/agent/canvasTools.ts`：`add_node` 的 `type` enum 加 `'llm'` + 可选 `preset`；`run_node` 分派加一支；`nodeBrief` 暴露 `preset`

**渲染层**
- **新增** `src/renderer/components/canvas/LlmNode.tsx`
- `src/renderer/components/canvas/CanvasPanel.tsx`：`NODE_TYPES` 注册 `llm`；顶部工具条 / 右键菜单加「分镜编剧」
- `src/renderer/state/canvasStore.ts`：`expandStoryboard(sessionId, llmNodeId): Promise<string[]>` —— 读 `output.json`，批量建节点 + 连线，一条 `record()`

### 数据结构

```ts
// src/shared/canvas.ts
export type CanvasLlmPreset = 'storyboard' | 'prompt_polish' | 'shot_list' | 'custom';

export interface CanvasLlmParams {
  preset: CanvasLlmPreset;
  /** preset='custom' 时的自由指令；其余 preset 下作为附加要求。 */
  instruction?: string;
  /** 输出 schema。'none' → 纯文本，不产 output.json。 */
  schema?: 'storyboard_v1' | 'prompt_list_v1' | 'none';
  model?: string;
}

export interface CanvasNodeOutput {
  assets?: string[];
  text?: string;
  /** 结构化结果（llm 节点、以及 P2-2 的质检 verdict）。 */
  json?: unknown;
  progress?: number;
  error?: string;
}
// defaultNodeBox('llm') => { w: 340, h: 300 }
```

```ts
// src/shared/llmSchemas.ts
import { z } from 'zod';

export const storyboardV1 = z.object({
  title: z.string(),
  ratio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
  scenes: z.array(z.object({
    title: z.string(),
    script: z.string(),
    imagePrompt: z.string(),
    videoPrompt: z.string(),
    /** 与 P0-3 的 CameraControl 对齐；也接受老的 preset 字符串。 */
    camera: z.object({
      pan: z.number().min(-10).max(10).optional(),
      tilt: z.number().min(-10).max(10).optional(),
      roll: z.number().min(-10).max(10).optional(),
      zoom: z.number().min(-10).max(10).optional(),
    }).optional(),
    duration: z.enum(['5s', '10s']).default('5s'),
  })).min(1).max(12),
});
export type StoryboardV1 = z.infer<typeof storyboardV1>;

export const promptListV1 = z.object({ prompts: z.array(z.string()).min(1).max(20) });

/** 剥 ```json 围栏 / 前后废话 / 尾逗号后 JSON.parse，再交给 zod。失败返回 null。 */
export function parseLlmOutput<T>(raw: string, schema: z.ZodType<T>): T | null;
```

`llmExecutor` 关键点：

- 用 `ai` SDK 的 `generateObject({ model, schema, prompt })`（**不是** `streamText`，因为要确定性 + schema）
- **无 `tools`**，**无图片**（这是它和 `agent` 的分界线）
- `temperature: 0.3`（具名常量 + 注释）
- `generateObject` 抛错时**降级一次**：`generateText` → `parseLlmOutput()` → 仍失败才 `fail()`
- provider 解析复用 `agentExecutor.ts:150-163` 那段（settings → preset → apiKey / baseUrl / modelId），**抽成共享 helper** 避免第三份拷贝

`expandStoryboard` 布局：照抄 `canvasTools.ts:140-214` 的水平时间线（`colX = base + i * 360`，image 在上 y、video 在下 y+420，image→video 连 `start_frame`），**但**要读 `llmNode.x / y` 作为基点而不是硬编码 40。

**DB 迁移：不需要。**

### 验收标准

1. 画布上加一个「分镜编剧」节点，preset=storyboard，输入「一个赛博朋克雨夜追逐的三镜短片」→ 运行后节点内出现分镜**表格预览**（镜头号 / 标题 / 画面提示 / 运镜 / 时长）。
2. `output.json` 通过 `storyboardV1` 校验；`output.text` 是同一份的 pretty JSON。
3. 点「展开为画布节点」→ 下方生成 3 个 image + 3 个 video 节点，image→video 连在 `start_frame`，横向时间线排布；**Ctrl+Z 一次**全撤。
4. 展开出的 video 节点的 `camera` 字段来自分镜 JSON（与 P0-3 的 `CameraControl` 打通）。
5. 模型返回带 ```json 围栏 / 前后废话时仍能解析（`parseLlmOutput` 单测覆盖）。
6. 模型返回完全不合 schema 时，节点进 `error` 态并给出可读原因，**不写坏** `output.json`。
7. 「运行整图」时 llm 节点参与波浪调度：`llm → image` 链上，image **在** llm 完成后才开始。
8. llm 节点运行**不**要求 `confirmedSpend`（与 agent 一致）。
9. Agent 调 `add_node({ type: 'llm', preset: 'storyboard', prompt: '…' })` 能建出来；`read_canvas` 能看到 preset。
10. `llmSchemas.test.ts` 覆盖：围栏剥离、尾逗号、scenes 超上限、camera 越界夹取、`schema: 'none'` 时不产 `output.json`。

### Review 检查点

- [ ] `'llm'` 已加进**五处**：`shared/canvas.ts`、`routes/canvas.ts:19`、`CanvasPanel.tsx:56`、`graphExecutor.RUNNABLE`、`canvasTools.add_node` enum。
- [ ] `llmExecutor` **没有** `tools`、**没有** `collectUpstreamImages` —— 确定性节点不看图，这是它存在的意义。
- [ ] provider 解析被抽成共享 helper（`agentExecutor` / `llmExecutor` 两处引用同一份），没有第三份复制粘贴。
- [ ] `CanvasNodeOutput.json` 是**可选**字段；现有读 `output.text` / `output.assets` 的代码零改动。
- [ ] `expandStoryboard` 一条 `record()`，且布局基点取自 llm 节点自身坐标。
- [ ] `parseLlmOutput` 在 `src/shared/`，纯函数、无 IO、配 vitest。
- [ ] `agent` 节点的行为**完全没变**（`agentExecutor.test.ts` 全绿）。
- [ ] 文档 / tooltip 里把两者分工写清：**llm = 确定性工人（格式化、拆解、润色，输入确定输出严格）；agent = 自主探索者（带工具、多轮、看图质检）**。

### 风险

- 中：`generateObject` 对 OpenAI 兼容第三方网关的支持度参差（有的不支持 `response_format: json_schema`）。缓解：内建 `generateText + parseLlmOutput` 降级路径，且降级要在节点上给一个小徽章（「已降级解析」）方便排查。
- 低：新增 RUNNABLE 类型对波浪调度的影响 —— `buildPipelineWaves` 是按 `isRunnable` 谓词工作的通用实现，加类型即可，已有 `graph.test.ts` 兜底。

---

## P2-1 · 高清放大 Upscale（+ imageDrivers 抽象）

### 现状

**完全没有**。`imageExecutor.ts` 只有一条 `generateImage` 路径，`size` 只有
`1024x1024` / `1024x1536` / `1536x1024` 三档（`CANVAS_IMAGE_SIZES`），没有任何超分 / 放大端点。

### 目标

动作条上的 **`🔍 高清放大`**：对一个已有产物的 image 节点，在其右侧生成一个「放大」节点，
产出更高分辨率的同一画面，并自动连线。

### 方案（二选一，PR 里给结论）

**A. img2img 伪放大（零新依赖，效果有限）**
把源图当垫图 + 固定 prompt（`super resolution, highly detailed, preserve composition exactly`）+
最大 size 再跑一次 `generateImage`。**缺点**：会改画面细节，不是真正的超分，容易「越放越不像」。
只适合当占位实现。

**B. 独立 upscale driver（推荐）**
照搬 `videoDrivers/` 的形状新建 `src/main/server/canvas/imageDrivers/`：

```
imageDrivers/
  types.ts        UpscaleDriver { id, name, upscale(bytes, {scale}) -> Promise<Uint8Array> }
  falUpscale.ts   fal 的 clarity-upscaler / esrgan 端点（同步或队列，队列则复用 asyncJobManager 形状）
  mockUpscale.ts  本地 2x 最近邻，供开发与单测
  index.ts        getUpscaleDriver(id) / listUpscaleDrivers()
```

放 P2 的理由：它引入**一个新的 provider 维度**（放大服务商 + 计费 + 设置项），
这是产品决策而不仅是工程量。

### 改动文件（按方案 B）

- **新增** `src/main/server/canvas/imageDrivers/{types,falUpscale,mockUpscale,index}.ts`
- `src/shared/canvas.ts`：`CanvasImageParams` 加可选 `mode?: 'generate' | 'upscale'`、`upscaleScale?: 2 | 4`、`upscaleProvider?: string`
- `src/main/server/canvas/imageExecutor.ts`：`runImageNode` 开头分流 —— `mode === 'upscale'` 时取上游 image 的 `assets[0]` → `getUpscaleDriver().upscale()` → 落盘 → 走**同一套** broadcast，不碰 `generateImage`
- `src/renderer/components/canvas/ImageNode.tsx`：`mode === 'upscale'` 时隐藏 prompt / size / 模型选择器，改显示倍率 pill
- `src/renderer/state/canvasStore.ts`：`upscaleFrom(sessionId, imageNodeId, scale = 2)` → `addNodeAndConnect`（一条 record）
- `NodeActionBar` 调用方：填上 P0-1 预留的「高清放大」槽位
- `src/main/server/storage/settingsStore.ts` 相关设置页：放大 provider 的 key（沿用现有 providers map，PR 里确认字段名）

### 数据结构

```ts
export interface CanvasImageParams {
  prompt: string;
  size: '1024x1024' | '1024x1536' | '1536x1024';
  model?: string;
  /** 'upscale' 时不调 generateImage，改走 imageDrivers 超分上游产物。 */
  mode?: 'generate' | 'upscale';
  upscaleScale?: 2 | 4;
  upscaleProvider?: string;
}
```

**DB 迁移：不需要。**

### 验收标准

1. 一个已完成的 image 节点点「高清放大」→ 右侧出现「×2 放大」节点并自动连线；Ctrl+Z 一次撤掉。
2. 运行该节点 → 产物分辨率是源图的 2 倍（读 PNG 头断言），**构图与源图一致**（人工确认，不是重绘）。
3. 放大节点没有 prompt / size / 模型选择器，只有倍率 pill 与运行按钮。
4. 上游无产物时运行 → 明确报错「上游没有可放大的图片」，不发请求。
5. mock driver 下能在无网络环境跑通全链路（含单测）。
6. 放大产物能 `saveAsset` 存入作品库、能被下游 video 节点当 `start_frame`。
7. 「运行整图」时放大节点参与波浪，且在其上游 image 之后执行。

### Review 检查点

- [ ] `imageDrivers` 的接口形状与 `videoDrivers/types.ts` **对齐**（id / name / 方法签名风格一致），便于后续统一。
- [ ] `mode === 'upscale'` 的分流在 `runImageNode` **最前面**，不误入 provider / `generateImage` 分支。
- [ ] 失败信息走现有 `classifyMediaError`（`mediaError.ts`），与生成失败的展示一致。
- [ ] 放大是付费动作 → `/nodes/:id/run` 的 `confirmedSpend` 闸门对它同样生效（image 类型天然已有，确认没被 `mode` 绕过）。
- [ ] 大图不整体进内存两次（读 → 上传 → 下载 → 写盘，注意 buffer 复用）。

### 风险

- 中：provider 选型与计费是产品决策，可能卡住。缓解：先合 `mockUpscale` + 接口，真实 driver 单独一个小 PR。
- 低：方案 A 若被选中，要在 UI 上诚实标注「AI 重绘放大，细节可能变化」。

---

## P2-2 · 质检 Agent 结构化 verdict + 自动重跑

### 现状

`agentExecutor.runAgentNode` **已经会看图**（`:78-102` `collectUpstreamImages` 把上游 image 的
assets 作为多模态 `{type:'image'}` part 送进去，system prompt 也写了要检查构图 / 光影 / 人物细节）。
`ImageNode` / `VideoNode` 的「+ 质检 Agent」（`canvasStore.addDownstreamAgent`）已经是这套的入口。

缺的是：
- 输出是**自由文本**，没有 `pass` / `fail` 判定，机器无法消费
- 没有「检查项清单」（手指数量、肢体、文字乱码、与 anchor 的一致性…）
- 质检发现问题后，用户要手动改 prompt 再手动重跑

### 目标

- `CanvasAgentParams` 加**可选** `mode?: 'explore' | 'inspect'`（缺省 `'explore'` = 现有行为，零回归）
- `inspect` 模式：
  - system prompt 换成质检版，附带 `checks` 清单
  - 要求输出结构化 JSON `{ verdict, issues[], suggestedPrompt? }` → 写进 `output.json`，人读摘要写 `output.text`
  - 节点上显示大号 **通过 / 不通过** 徽章 + 问题列表
- 可选 **自动重跑**（默认关闭）：`verdict === 'fail'` 且存在上游 image 节点时，用 `suggestedPrompt` 更新上游 prompt 并重跑一次，最多 `maxAttempts` 次

### 改动文件

- `src/shared/canvas.ts`：`CanvasAgentParams` 加 `mode?` / `checks?: string[]` / `autoRetry?: { maxAttempts: number }`
- **新增** `src/shared/inspectionSchema.ts` + `.test.ts`：zod `inspectionV1` + 默认检查项常量 `DEFAULT_IMAGE_CHECKS`
- `src/main/server/canvas/agentExecutor.ts`：`mode === 'inspect'` 分支（不同 system prompt、要求 JSON、解析写 `output.json`）
- **新增** `src/main/server/canvas/retryPolicy.ts`：内存 `Map<`canvasId:nodeId`, attempts>` 的重试计数（**不进 DB**，进程重启即清零 —— 这是刻意的，防死循环比持久化重要）
- `src/renderer/components/canvas/AgentNode.tsx`：mode 切换、检查项编辑、verdict 徽章、issues 列表、autoRetry 开关（带次数上限与费用提示）
- `src/main/server/agent/canvasTools.ts`：`add_node` 加可选 `mode` / `checks`；`nodeBrief` 暴露 `verdict`

### 数据结构

```ts
// src/shared/inspectionSchema.ts
export const inspectionV1 = z.object({
  verdict: z.enum(['pass', 'fail']),
  issues: z.array(z.object({
    severity: z.enum(['low', 'medium', 'high']),
    area: z.string(),      // '手部' / '文字' / '风格一致性'
    note: z.string(),
  })).default([]),
  /** fail 时给出的修正提示词，供自动重跑使用。 */
  suggestedPrompt: z.string().optional(),
});

export const DEFAULT_IMAGE_CHECKS = [
  '手指数量与关节是否自然',
  '肢体与透视是否合理',
  '画面内文字是否为乱码',
  '与参考图钉的角色 / 风格是否一致',
  '构图是否被主体或水印遮挡',
];
```

```ts
export interface CanvasAgentParams {
  instruction: string;
  /** 'explore'（默认，现有行为）| 'inspect'（多模态质检，输出结构化 verdict） */
  mode?: 'explore' | 'inspect';
  checks?: string[];
  autoRetry?: { maxAttempts: number };
}
```

### 验收标准

1. 一个默认 agent 节点（无 `mode`）行为与改动前**逐字一致**（`agentExecutor.test.ts` 全绿，输出仍是流式自由文本）。
2. 切到 inspect 模式并连一张有明显手部问题的图 → 节点显示「不通过」红徽章 + issues 列表，`output.json` 通过 `inspectionV1` 校验。
3. 一张正常图 → 显示「通过」绿徽章，`issues` 为空数组。
4. 开启 autoRetry（maxAttempts=2）：fail → 自动用 `suggestedPrompt` 更新上游 image 的 prompt 并重跑；第二次仍 fail → **停止**，节点上写明「已达重试上限」。
5. 重试次数计数按 `canvasId:nodeId` 隔离；换一个节点不共享计数。
6. autoRetry 默认**关闭**；打开时 UI 明确提示「每次重试都会产生图片生成费用」。
7. 模型不吐合法 JSON 时降级为纯文本展示 + 一个「解析失败」徽章，**不**进 error 态（质检本身仍有参考价值）。

### Review 检查点

- [ ] `mode` 是**可选**字段，缺省走 `'explore'`；现有 `addDownstreamAgent` 调用点行为不变（或显式改为 `mode: 'inspect'`，PR 里给结论）。
- [ ] 自动重跑有**硬上限**且计数在**内存**里；`runGraph` 内部**不**触发自动重跑（否则整图运行可能级联失控）—— 只在单节点运行路径上生效。
- [ ] 自动重跑修改上游 prompt 时走 `canvasStore.updateNode` + `channel.broadcast`，用户能在画布上看到 prompt 变了，且**不**静默覆盖用户手写内容（建议改前把原 prompt 存进 `params.prevPrompt`）。
- [ ] `inspect` 模式是否保留 `read_canvas` / `read_node` 工具 —— PR 里给结论并说明理由（倾向：**保留**，它对「与其它镜头是否一致」这类检查有用）。
- [ ] 费用提示到位；autoRetry 的开关状态进 `params`，走 `updateNodeParams`（可撤销）。

### 风险

- **高**：自动重跑会自动花钱。默认关闭 + 硬上限 + 显式费用提示 + 只在单节点路径生效，四道闸门缺一不可。
- 中：不同多模态模型对「手指」这类细节的判别力差异极大，可能出现大量假阳性。缓解：`checks` 可编辑，且 verdict 只是建议不阻塞流程。

---

## 落地顺序与依赖

```
P0-1 NodeActionBar ────────┬─→ P0-2 forkVariations （用它的动作槽位）
                           └─→ P2-1 Upscale        （用它的动作槽位）
P0-3 CameraDial ───────────────→ P1-2 llm 节点（分镜 JSON 的 camera 字段对齐 CameraControl）
P1-1 anchor 图钉 ──────────────→（无强依赖；但会顺带修 resolveMentions 的 startIndex
                                  与 importWorkflow 的规范提及重映射）
P1-2 llm 节点 ─────────────────→ P2-2 质检 verdict（共用 output.json 与 zod 解析套路）
P2-1 Upscale （独立，除动作槽位外无依赖）
P2-2 质检 verdict （依赖 P1-2 的 output.json 字段）
```

**PR 拆分建议：每个工作项 1 个 PR。**其中 P0-3 里的 `klingDriver` 非法 `camera_control.type` 修复，
以及 P0-2 里的 `forkNode` 丢 handle 修复，都可以各自作为**独立的前置小 PR** 先合，
这样两个真实 bug 不必等整个交互改造评审完。

---

## 统一约定（所有工作项）

- 纯逻辑放 `src/shared/`，配 `*.test.ts`（vitest 已配置，参考 `arrangeNodes.test.ts` / `resolveMentions.test.ts`）。
- 所有画布结构改动经渲染层 `canvasStore` 的 `record()`，保证 Ctrl+Z / Ctrl+Shift+Z 闭环；
  一次用户手势 = **一条**历史记录（`HISTORY_CAP = 60`，别灌）。
- 服务端是权威图，改动经 `CanvasChannel.broadcast`，渲染层订阅 NDJSON 流，**不新增任何轮询**。
- Agent 工具（`src/main/server/agent/canvasTools.ts`）的对外 schema 只能**加可选参数 / 加 enum 成员 / 加新工具**，
  不改既有必填参数的含义。
- 新增节点类型必须同步这**五处**，缺一会静默坏掉：
  1. `src/shared/canvas.ts` 的 `CanvasNodeType` + `defaultNodeBox`
  2. `src/main/server/routes/canvas.ts:19` 的 `NODE_TYPES` set（否则 POST /nodes 400）
  3. `src/renderer/components/canvas/CanvasPanel.tsx:56` 的 React Flow `NODE_TYPES`（否则渲染成默认方块）
  4. `src/main/server/canvas/graphExecutor.ts:10` 的 `RUNNABLE`（**明确决定加不加**，并写注释）
  5. `src/main/server/agent/canvasTools.ts` 的 `add_node` type enum + `nodeBrief`（否则 Agent 看不见）
- 颜色 / 间距走既有设计 token：`--paper` / `--paper-raised` / `--paper-inset` / `--ink` / `--ink-muted` /
  `--line` / `--accent` / `--accent-ink`（定义在 `src/renderer/index.css`，含 dark 变体）。**不要硬编码 hex。**
- DB：`canvas_nodes.params` / `output` 都是 JSON 列，**本计划里的所有数据结构变更都不需要迁移**。
  若某个工作项发现需要迁移，先停下来在 PR 里论证。
- 每个 PR 描述里回填「验收标准逐条勾选 + Review 检查点逐条勾选」。

---

## 本轮不做 / 需产品决策

1. **局部重绘 Inpaint（借鉴点 #1 的第 4 个动作）—— 不做。**
   需要：画布内蒙版画笔 UI（笔刷 / 橡皮 / 撤销，本身就是一个独立的编辑器）、mask 的存储与传输通道
   （现有 `output.assets` 是产物数组，没有 mask 概念）、provider 侧的 inpainting 端点
   （`ai` SDK 的 `generateImage` 没有 mask 参数位）。**三样都要新建**，工作量约等于本文件其余六项之和。
   建议单独立项评估，或先用「@提及 + 文字描述要改哪里」这个廉价替代观察需求强度。

2. **真正的 IP-Adapter / Character Reference 通道 —— 需决策。**
   P1-1 的 v1 只能做「有序垫图 + 语义前缀」。要拿到 Leonardo 那种效果，需要在
   `createOpenAiProvider` 之外开一条**图像专用 provider 路径**（直接打 fal / Replicate 的
   `ip-adapter` / `instantid` / `flux-redux` 端点，带 `weight` 参数）。
   **要回答的问题**：(a) 目标用户实际用哪家？(b) 愿不愿意为一致性单独配一个 provider key？
   (c) 现有 OpenAI 兼容网关里有没有已经透传 IP-Adapter 参数的？
   在没答案之前，P1-1 就按「有序垫图」交付，并在 UI 上诚实措辞（写「参考」不写「锁定」）。

3. **Upscale 的 provider 选型 —— 需决策。**
   见 P2-1 方案 A / B。A 零依赖但会改画面，B 效果对但要新增 provider 维度与计费。
   建议先合接口 + mock driver，真实 driver 待决策后单独 PR。

4. **VLM 质检节点用哪个多模态模型 —— 需决策。**
   现在 `agentExecutor` 用的是 `settings.activeProviderId` 的**同一个**对话模型
   （`agentExecutor.ts:151-158`）。质检对视觉细节的要求高于闲聊，可能需要：
   (a) 允许 agent 节点单独选模型（`CanvasAgentParams.model`），
   (b) 还是在设置里加一个全局「视觉质检模型」。
   **建议 (a)**，与 image / video 节点已有的 per-node 模型选择器一致。但这会让 agent 节点的
   参数面板变复杂 —— 需要产品拍板。

5. **可灵「simple 只能一个非零轴」时，其余轴怎么办 —— 需决策。**
   P0-3 的默认策略是「最大轴进结构化 config，其余降级进 prompt 文本」。
   另一种是「UI 上就只允许一个轴非零」（更诚实但表达力弱）。建议先按默认策略做，
   在 UI 上给一行灰字说明，观察实际生成效果后再定。

6. **Agent 是否需要 `fork_variations` 工具 —— 暂不加。**
   P0-2 只做 UI 侧。让主 Agent 也能一键铺 4 个变体是合理的，但会增加一个需要长期维护的工具，
   且 Agent 现在已可以用 `add_node` × 4 达成。等有实际请求再加。

7. **hover 动作条在触屏 / 触控板设备上的行为 —— 未覆盖。**
   Electron 桌面端目前假定有鼠标。若后续要上触屏，`hover` 分支需要 fallback 到长按。
   本轮按桌面端做，`selected` 那条路径天然是触屏的可用降级。

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
