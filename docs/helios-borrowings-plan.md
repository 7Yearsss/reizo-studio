# HeliosGen 借鉴点 — Reizo 实施计划

Status: **计划待实施**（2026-09-03）。目标：把 HeliosGen（`SegFault42/HeliosGen`，
commit `e0f673e`）在视觉工作流交互与调度上的成熟做法，移植进 Reizo 的
Agent-Centric 画布，且不破坏现有的「Agent 主动编排 + 服务端权威图 + 撤销栈」架构。

本文件写给**实施方（其他 AI / 工程师）**：每个工作项自带「现状 / 目标 / 改动文件 /
方案 / 数据结构 / 验收标准 / Review 检查点 / 风险」。按 P0 → P2 顺序做，工作项之间
除注明的依赖外互相独立，可分 PR。

---

## 0. Reizo 画布现有能力盘点（不要重复造）

已经存在，不在本计划范围：

| 能力 | 位置 |
|---|---|
| 拖线到空白处 → 弹出「快速延伸流水线」菜单 | `src/renderer/components/canvas/CanvasPanel.tsx:206` `onConnectEnd` → `dropConnectMenu` |
| 底部多选工具条（投送 Agent 质检 / 引用输入框 / 批量派生变体） | `CanvasPanel.tsx:578-645` |
| 一键整理布局（分层布局 + fitView） | `CanvasPanel.tsx:281` `tidy()` → `shared/canvasGraph.ts:layoutGraph` |
| 撤销 / 重做（渲染层逆操作栈，`HISTORY_CAP=60`） | `src/renderer/state/canvasStore.ts:38-102` |
| 变体派生 `forkNode` / 克隆 `duplicateNode`（含入边重连） | `canvasStore.ts:309-361` |
| 串联审片（顺序播放所有 video 分镜） | `src/renderer/components/canvas/StoryboardModal.tsx` |
| video 节点消费上游图片的 `start_frame` / `end_frame` 输入句柄 | `src/renderer/components/canvas/VideoNode.tsx:538-566`；`src/main/server/canvas/videoExecutor.ts:33-53` |
| dirty（待更新）追踪 + `inputHash` | `shared/canvasGraph.ts:inputHash`；`imageExecutor.ts:broadcastDownstreamDirty` |
| 拓扑串行执行 + 「从这里往下运行」+ 停止 | `src/main/server/canvas/graphExecutor.ts` |
| Agent 画布工具（`add_node` / `run_node` / `run_graph` / `create_storyboard_pipeline` / `connect_nodes` / `update_node` …） | `src/main/server/agent/canvasTools.ts` |

因此本计划是**增量改造**，重点补齐 HeliosGen 相对 Reizo 的 6 个缺口。

---

## P0-1 · 悬浮剪刀线 CuttableEdge + 类型化边色

### 现状
`CanvasPanel.tsx:135-153` 把每条边渲染成裸对象，无 `edgeTypes`，无自定义组件。
删除边只能选中后按 Delete，细线难点中、易误删。边色只有两态（运行中 accent /
静止 line）。

### 目标
- 鼠标悬停连线时，在光标离曲线最近处吸附一个圆形剪刀徽章；点击徽章 →
  `stroke-dashoffset` 收起动画 → 删除该边（走**现有** `canvasStore.removeEdge`，
  保留撤销）。
- 按 `sourceHandle` / `targetHandle` 的语义类型给边染色 + SVG 线性渐变
  （文本 teal、图像 indigo、首帧/尾帧 amber、视频 sky、默认灰）。
- 运行中的目标节点入边仍保留 `animated` + 高亮（叠加在类型色上，不是替换）。

### 改动文件
- 新增 `src/renderer/components/canvas/edges/CuttableEdge.tsx`
- 新增 `src/renderer/components/canvas/edges/edgeStyles.ts`（颜色表 + `edgeKind()` 推导）
- 改 `CanvasPanel.tsx`：
  - `import` 并注册 `const EDGE_TYPES = { cuttable: CuttableEdge }`，`<ReactFlow edgeTypes={EDGE_TYPES}>`
  - `edges` memo（`:135`）里给每条边 `type: 'cuttable'`，把类型色/渐变 id/`isRunning`
    放进 `data`，不再直接写死 `style.stroke`
  - 传一个 `onCutEdge={(edgeId) => void canvasStore.removeEdge(sessionId, edgeId)}`
    给 `data`（或用 `useReactFlow` 的 store，二选一，注明理由）

### 关键实现点（照抄 HeliosGen 思路，见其 `components/edges/CuttableEdge.tsx`）
- 用 `getBezierPath` 拿 `[path, labelX, labelY]`，同时把 `path` 塞进一个隐藏
  `<path ref>` 以调用 `getTotalLength()` / `getPointAtLength()`。
- `onMouseMove`（挂在 edge 的透明加宽交互层，`strokeWidth: 20`, `stroke: transparent`）
  时按 ~24 步粗采样 + 2~3 次二分细化，求光标到曲线的最近点，`setBadgePos`。
- 徽章：`<foreignObject>` 或纯 SVG `<g>`；`Scissors` 图标（lucide 已在依赖）。
- 切断动画：`state: 'idle' | 'dying'`，`dying` 时
  `strokeDasharray = pathLength; strokeDashoffset` 从 0 → `pathLength`，
  `transition: stroke-dashoffset 0.4s ease-in`，`onTransitionEnd` 再调 `onCutEdge`。
- 渐变：`<defs><linearGradient id={`edge-grad-${id}`}>` 两端色 = 源/目标句柄类型色。
- **可访问性 / 降级**：`prefers-reduced-motion` 时跳过 dashoffset 动画直接删。

### edgeStyles.ts 颜色表（与节点句柄色对齐，最终以设计 token 为准）
```ts
export const EDGE_COLORS = {
  prompt: '#2dd4bf',      // 文本/prompt
  image:  '#818cf8',      // 图像
  startFrame: '#f59e0b',  // 首帧
  endFrame:   '#f59e0b',  // 尾帧
  video:  '#38bdf8',      // 视频产物
  default:'#94a3b8',
} as const;
/** 从 handle id 推导类型：'start_frame'->startFrame, 'end_frame'->endFrame,
 *  其余按源节点 type：image->image, video->video, agent/note->prompt */
export function edgeKind(sourceType: string, sourceHandle: string|null, targetHandle: string|null): keyof typeof EDGE_COLORS
```

### 验收标准
1. 悬停任意连线，剪刀徽章出现在光标最近点，移动光标时跟随吸附；移出连线徽章消失。
2. 点击徽章：连线播放收起动画后消失；**Ctrl+Z 能恢复这条边**（证明走了 `removeEdge`）。
3. image→video 的 `start_frame` 边显示 amber；image→image 边显示 indigo 渐变；
   note→image 边显示 teal。运行时目标节点入边仍有流动动画。
4. 无自定义 edge 的旧数据（`type` 缺失）不报错（`edgeTypes` 有 fallback 或 memo 兜底）。
5. `prefers-reduced-motion: reduce` 下点击徽章立即删除，无动画。

### Review 检查点
- [ ] 剪刀命中测试用的是加宽透明交互层，不是给可见描边加 `pointerEvents`（否则窄线仍难触发）。
- [ ] `getPointAtLength` 的 ref path 每次 `path` 变化后重新测长（依赖数组含 `edgePath`）。
- [ ] 删除走 `canvasStore.removeEdge`，**没有**绕过去直接调 API 或 `setEdges`。
- [ ] 大量边（50+）时 `onMouseMove` 有节流或只在 hover 的那条边上算，不是每条边都算。
- [ ] 颜色只在 `edgeStyles.ts` 定义，节点句柄和边引用同一份。

### 风险
- React Flow v12 自定义边需要 `BaseEdge` + `EdgeLabelRenderer`；徽章放
  `EdgeLabelRenderer` 里用屏幕坐标，注意 `zoom` 缩放（HeliosGen 用 `transform: scale`
  跟随缩放）。低风险，纯前端，可回退。

---

## P0-2 · 分层波浪并发调度 buildPipelineWaves

### 现状
`graphExecutor.ts:runGraph` 是严格串行 `for (const id of order)`，注释明说
「parallel independent branches land later if it matters」。4 个独立分镜串行生成
≈ 1 分钟以上。**另有一个既存隐患**：`runVideoNode` → `submitVideoJob` 在
`driver.submit()` 后即 resolve，轮询在 `setInterval` 上跑（`asyncJobManager.ts:99`），
所以串行执行器里 `await runVideoNode()` 其实没等视频真正完成 —— 波浪化会放大这个问题，
必须一并修。

### 目标
- 把 RUNNABLE 节点按依赖分层：同层无相互依赖 → `Promise.all` 并发；上一层全部
  settle 后再进下一层。
- 加**并发上限**（默认 3，常量 + 后续可配），避免 provider 限流。
- 保留现有语义：`fromNodeId` 子图裁剪、`failed` 传播（上游失败 → 下游标 error 跳过）、
  `AbortController` 停止、`graph_run` 进度广播（`done/total`）、
  `broadcastDownstreamDirty`。
- video 节点必须**等作业真正结束**再算该层完成。

### 改动文件
- 改 `src/main/server/canvas/graphExecutor.ts`（核心）
- 改 `src/main/server/canvas/asyncJobManager.ts`：新增
  `export function awaitVideoJob(canvasId, nodeId): Promise<void>` —— 在
  `submitVideoJob` 内维护一个 `resolve/reject` 挂到 `ActiveJob`，`succeed`/`fail`/
  `cancel`/`timeout` 时兑现；`runVideoNode` 改为 `await submitVideoJob(...); await awaitVideoJob(...)`。
- （可选）`shared/canvasGraph.ts` 加纯函数 `buildWaves(nodes, edges, isRunnable): string[][]`
  + 单测（与现有 `graph.test.ts` 同目录）。

### buildWaves 逻辑（参考 HeliosGen `lib/executor.ts:37`）
```
只保留 RUNNABLE 且 inScope 的节点集合 S。
deps(n) = { 属于 S 的直接前驱 }。
waves = []; remaining = S
while remaining:
  wave = [ n in remaining | deps(n) ∩ remaining == ∅ ]
  if wave 为空: break        // 环保护（正常不会，建边时已挡环）
  waves.push(wave); remaining -= wave
```
执行：
```
for wave of waves:
  if aborted: break
  分批（每批 ≤ MAX_CONCURRENCY）并发：
    await Promise.allSettled(batch.map(runOne))
  runOne 里：上游 failed → 标 error + failed.add；否则按 type 分派
             （image: await runImageNode；video: await runVideoNode 现已真正等待；
              agent: await runAgentNode）
  每个节点 settle 后 done++ 并广播 graph_run 进度
```

### 验收标准
1. 4 个互不相连的 image 节点「运行整图」：网络面板显示请求**并发**发出（≤3 个同时），
   总耗时 ≈ ceil(4/3) 轮 ≈ 单张的 2 倍，而非 4 倍。
2. `image → video → image` 链：中间 video 未完成前，末端 image **不**开始
   （证明 `awaitVideoJob` 生效）。
3. 上游节点失败 → 同层其余节点照跑；下游节点标记 `error: 'Upstream node failed'` 并跳过。
4. 运行中点「停止」：当前层进行中的节点跑完后不再进入下一层，`graph_run running:false` 广播。
5. `create_storyboard_pipeline` 生成的分镜图跑完，产物与串行版本一致。
6. `graph.test.ts` 新增 `buildWaves` 用例：菱形依赖、多根、孤立节点、`fromNodeId` 裁剪。

### Review 检查点
- [ ] `MAX_CONCURRENCY` 是具名常量并有注释说明为何是 3（provider 限流）。
- [ ] 用 `Promise.allSettled` 不是 `Promise.all`（一个节点抛错不能中断整层）。
- [ ] `activeRuns` 的 `AbortController` 语义不变；层间检查 `abort.signal.aborted`。
- [ ] `awaitVideoJob` 在 **cancel / timeout / fail** 三条路径都兑现 promise，不泄漏挂起。
- [ ] `done`/`total` 计数在并发下无竞态（用原子自增或串行化广播）。
- [ ] 未改 `run_node`（单节点）与 Agent `run_graph` 工具的对外行为。

### 风险
- 中：并发放大 provider 限流 / 配额错误。缓解：并发上限 + 现有
  `classifyMediaError` 已能把 429 归一化展示。
- 低：`awaitVideoJob` 改动触及既有 video 单跑路径 —— 加回归测试
  `videoExecutor.test.ts`。

---

## P1-1 · 提示词内 @节点引用（resolveMentions）

### 现状
image/video 节点多参考图时只能靠连线，prompt 里无法精确指代「谁是谁」。
`imageExecutor.ts:upstreamImageBytes` 简单取前 2 张上游图，顺序不可控。
Reizo 已有另一套「输入框 @ 引用」（`chatStore.addNodeRef`）是给**聊天**用的，
与此无关，不要混。

### 目标
在 image / video 节点的 prompt 里支持 `@节点标题`（或 `@#id` 兜底），运行时：
1. 解析 prompt 中所有 `@提及`，按其在文本中**出现顺序**编号；
2. 替换为底层占位符 `<<<image N>>>`（保留 HeliosGen 约定，便于后续换模型）；
3. 重排传给模型的参考图数组，使 `images[N-1]` 恰好对应 `<<<image N>>>`；
4. 未命中的 `@xxx` 原样保留为纯文本（不 fallback 到第 0 张）。
5. 编辑框里 `@` 触发一个联想菜单，列出画布上有产物的节点。

### 改动文件
- 新增 `src/shared/resolveMentions.ts`（**纯函数 + 单测**，两端复用）：
  ```ts
  export function resolveMentions(
    prompt: string,
    candidates: { id: string; label: string; assets: string[] }[],
  ): { resolvedPrompt: string; orderedAssetRefs: string[] /* 相对路径，按 <<<image N>>> 顺序 */ }
  ```
  匹配规则：先按 `label` 长度降序，转义正则，匹配 `@label`；再匹配 `@#<id前8位>`。
- 改 `src/main/server/canvas/imageExecutor.ts`：`runImageNode` 里，若 prompt 含
  `@`，调 `resolveMentions`（candidates = 直接上游 image 节点 + 它们的 `output.assets`），
  用 `resolvedPrompt` 替 `params.prompt`，用 `orderedAssetRefs` 替
  `upstreamImageBytes` 的默认顺序。无 `@` 时保持原逻辑。
- 改 `src/main/server/canvas/videoExecutor.ts`：同理，作用于 start/end 帧之外的
  「主体参考图」（如果 video driver 支持多参考图；不支持则只做 prompt 文本替换，
  见风险）。
- 新增 `src/renderer/components/canvas/MentionMenu.tsx`：受控的 `@` 联想浮层。
- 改 `ImageNode.tsx` / `VideoNode.tsx` 的 `<textarea>`：监听输入，`@` 且光标前是
  词首时打开菜单，选中插入 `@标题 `。菜单数据来自
  `useCanvasStore` 里同 session 的节点（过滤 `output.assets.length > 0`）。
- 服务端 `app/api/generate` 对应物：Reizo 是 `ai` SDK 的 `generateImage`，
  `<<<image N>>>` 只是我们内部约定 —— 若目标模型不认，`imageExecutor` 里在发请求前
  把 `<<<image N>>>` 再降级成自然语言（如 `图 N`），**保留** `images` 数组顺序即可。
  （HeliosGen 也这么干，见其 `app/api/generate/route.ts:458`。）

### 数据结构
无 DB 变更。`resolveMentions` 输出的 `orderedAssetRefs` 是画布相对路径
（`<canvasId>/<file>`），复用 `readCanvasAsset`。

### 验收标准
1. 两个上游 image 节点标题「女主特写」「雨夜街道」都连到一个 image 节点，
   prompt 写「让 @女主特写 的人物站在 @雨夜街道 里」→ 运行后请求体里
   prompt 变成「让 <<<image 1>>> 的人物站在 <<<image 2>>> 里」（或其降级形式），
   且 `images[0]` 是女主特写产物、`images[1]` 是雨夜街道产物。
2. 调换 prompt 里两个 @ 的先后 → `images` 顺序随之调换。
3. prompt 写 `@不存在的节点` → 该串原样保留，不报错，不塞图。
4. 编辑框输入 `@` → 浮层列出有产物的节点；选一个插入 `@标题 `；Esc 关闭。
5. 无 `@` 的 prompt 行为与改动前完全一致（回归）。
6. `resolveMentions` 单测覆盖：顺序、重复 @同一节点、@子串（「女主」vs「女主特写」
   取长匹配）、正则特殊字符标题、中英文混排。

### Review 检查点
- [ ] `resolveMentions` 是 `src/shared/` 下的纯函数，无 IO，两端同一份。
- [ ] 最长匹配优先（避免「@女主」吃掉「@女主特写」）。
- [ ] 未命中 `@` **不** fallback 到 `images[0]`（HeliosGen 明确注释了这一点）。
- [ ] 只在 prompt 实际含 `@` 时改变 `upstreamImageBytes` 的取图路径，否则零影响。
- [ ] 联想菜单不吞 `nodrag` / 输入法组合键（`compositionstart/end` 处理）。
- [ ] Agent 侧：`update_node` / `create_storyboard_pipeline` 写入的 prompt 也能带 `@`，
      文档字符串里补一句说明。

### 风险
- 中：Reizo 的 video driver（fal / kling）多参考图支持不一。若不支持，本项对 video
  只做 prompt 文本替换，参考图仍走 start/end 帧 —— 在验收里对 video 降级说明。
- 低：标题可改名，`@旧名` 会失效 —— 可接受，与 HeliosGen 一致；菜单只提供当前有效名。

---

## P1-2 · GroupNode 分组容器 + 多选排版工具条

### 现状
`CanvasPanel.tsx` 底部多选条只有「投送 Agent / 引用 / 派生」。无分组容器、无网格
对齐、无整组操作。`shared/canvas.ts` 的 `CanvasNodeType` 是
`'image' | 'agent' | 'video' | 'note'`。

### 目标
- 新增 `group` 节点类型：半透明彩色容器，`data` 记 `memberIds: string[]`、
  `color`、`locked`。
- 多选（≥2）工具条增加：
  - **网格重排 Arrange**：以选中集包围盒中心为锚，自动算行列 + 平滑位移
    （复用 `applyLayout` 走单条撤销记录）。
  - **打组 Group**：新建 group 容器包住选中节点。
  - **克隆 Duplicate（多选）**：批量克隆选中节点 + 重映射它们之间的内部边
    （复用 / 泛化现有 `forkNode` 的入边重连逻辑）。
- group 容器操作：改色、锁定（`locked` 时成员不可拖动 / 不可框选）、
  局部聚焦（`fitBounds` 到容器范围）、**仅运行本组**
  （`runGraph` 加 `nodeIds?: string[]` 白名单，或前端多次 `runNode`）、
  解组。
- **导出组产物 zip** 归入 P2-2（依赖打包能力），本项先不做。

### 改动文件
- `src/shared/canvas.ts`：`CanvasNodeType` 加 `'group'`；加 `CanvasGroupParams`
  （`memberIds`, `color`, `locked`）；`defaultNodeBox('group')`。
- `src/main/server/storage/canvasStore.ts`：`group` 视为普通节点存储，无特殊逻辑；
  确认 `addNode` / `updateNode` 对未知 params 形状透明（当前是 `Record<string,unknown>`，OK）。
- `src/main/server/canvas/graphExecutor.ts`：`RUNNABLE` **不含** `group`；
  `runGraph` options 加可选 `nodeIds?: string[]`，与 `fromNodeId` 互斥，
  作为 `inScope` 白名单。
- `src/main/server/agent/canvasTools.ts`：`run_graph` 工具加可选
  `nodeIds: string[]`；（可选）加 `group_nodes` 工具让 Agent 也能打组。
- 新增 `src/renderer/components/canvas/GroupNode.tsx`（参考 HeliosGen
  `components/nodes/GroupNode.tsx`：`NodeResizeControl`、锁标、滚动标题、
  色板、运行下拉、聚焦按钮、解组按钮）。
- 新增 `src/shared/arrangeNodes.ts`：纯函数 `gridArrange(nodes, opts)` →
  `Record<id,{x,y}>`（包围盒中心锚定 + 行列）。
- 改 `CanvasPanel.tsx`：`NODE_TYPES` 注册 `group`；底部工具条加 Arrange / Group /
  Duplicate 按钮；group 渲染在节点层最底（`zIndex` 或 React Flow `parentId` 方案，
  见风险）。
- `src/renderer/state/canvasStore.ts`：加 `groupNodes(sessionId, ids)`、
  `ungroup`、`arrangeNodes`、`duplicateNodes`（多选，重映射内部边）——
  全部走 `record()` 保证撤销。

### 数据结构
```ts
export interface CanvasGroupParams {
  memberIds: string[];
  color: string;       // hex
  locked: boolean;
}
```
DB `canvas_nodes` 无需迁移（`params` 是 JSON 列）。

### 验收标准
1. 框选 3 个节点 → 工具条出现 Arrange / Group / Duplicate。
2. Arrange：3 个节点排成整齐网格，中心不漂移；Ctrl+Z 一次全部还原。
3. Group：出现半透明容器，标题「Group 1」，拖容器 → 成员跟随移动。
4. 容器锁定后成员不可单独拖动；解锁恢复。
5. 「仅运行本组」：只有组内 RUNNABLE 节点进入执行，`graph_run total` 等于组内可运行数。
6. Duplicate 多选：克隆出的新节点之间保留原内部连线，且不与原节点串边。
7. 解组：容器消失，成员保留，位置不变。
8. 删除容器时**默认只删容器不删成员**（除非显式「删除组及成员」）。
9. Agent `read_canvas` 能看到 group 节点及其 `memberIds`。

### Review 检查点
- [ ] `group` 不在 `RUNNABLE`，`topoOrder` / `inputHash` 不因 group 边产生副作用
      （建议 group 不参与 edge，纯 UI 容器；成员关系只存在 `memberIds`）。
- [ ] 所有新 store 方法都 `record()` 了逆操作，撤销/重做闭环。
- [ ] Duplicate 多选的内部边重映射：只重连「两端都在选中集」的边，跨界边不复制。
- [ ] `arrangeNodes` / `gridArrange` 是 `src/shared` 纯函数 + 单测。
- [ ] 容器与成员的层级：不要用真的 React Flow `parentId`（会牵动坐标系与现有拖拽/
      撤销逻辑），用「独立节点 + 渲染在底层 + 拖容器时批量 `moveNodeLive` 成员」。
      若选择 `parentId` 方案，必须在 PR 说明里论证对 `commitMove` / `applyLayout` 的影响。
- [ ] 锁定状态下 React Flow 的 `nodesDraggable` / `selectable` 按成员粒度控制。

### 风险
- 中高：容器-成员层级是这一项的主要复杂度。默认走「非 parentId」的轻量方案。
- 中：与现有底部多选条的交互叠加，注意 z-index / 事件冒泡。
- 可回退：group 是新增类型，不动现有节点。

---

## P2-1 · 视频尾帧抽取 + 视频→视频续写

### 现状
video 节点只**消费**上游图片作首尾帧；自己的产物只有整段视频输出句柄，
不暴露首帧/尾帧/任意帧。无法「上一段视频的尾帧 → 下一段视频的首帧」实现镜头衔接。
Reizo 无 ffmpeg 依赖（HeliosGen 用服务端 `app/api/extract-frame` + ffmpeg）。

### 目标
video 节点新增输出句柄：`startFrameOut`（首帧）、`endFrameOut`（尾帧）、
`framePickOut`（进度条选帧）。把 video 的某一帧作为图片资产喂给下游 video 的
`start_frame` / `end_frame` 或下游 image 的图生图输入。

### 方案（二选一，PR 里给结论）
**A. 前端 `<video>` + `<canvas>` 抽帧（无新依赖，推荐先做）**
- 渲染层：video 节点产物已是 `<video>`。加一个 seek 到 `duration-0.05` 的隐藏
  `<video>`，`drawImage` 到 `<canvas>`，`toBlob` → 上传为该节点的附属资产。
- 新增 API `POST /api/canvas/:canvasId/nodes/:id/extract-frame`
  `{ at: 'start'|'end'|number }` → 服务端把前端传来的 PNG 存进
  `<dataRoot>/canvas/<canvasId>/`，写进节点 `output.frames?: {start?,end?,pick?}`。
- 或全前端：直接把抽出的 blob 走现有 `importCanvasImage` 落成一个新 image 节点并
  自动连线（更简单，少一个 schema 字段）。**默认取这个子方案。**

**B. 服务端 ffmpeg**（HeliosGen 原味）：引入 `ffmpeg-static`，
`-ss <t> -i in -frames:v 1 out.jpg`。跨平台体积大（每平台 ~50MB），Electron 打包
需 `forge.config.ts` 处理 `extraResource` + `asarUnpack`。**除非 A 的画质/精度不够
再上。**

### 改动文件（子方案 A-全前端）
- `VideoNode.tsx`：产物区加「抽首帧 / 抽尾帧 / 抽当前帧」按钮 →
  `<canvas>` 抽帧 → `canvasStore.importImageBlob(sessionId, blob, at)` →
  新 image 节点出现在 video 右侧并 `connectNodes(video, newImage)`（或反过来按需）。
- `src/renderer/state/canvasStore.ts`：加 `importImageBlob`（`importImage` 已接受
  `File`，泛化成 `Blob` 即可）+ `addNodeAndConnect` 组合，走 `record()`。
- 无 schema 变更。

### 验收标准
1. 一个已完成的 video 节点，点「抽尾帧」→ 右侧生成 image 节点，画面是视频最后一帧，
   且已连线。
2. 把该 image 节点连到新 video 的 `start_frame` → 新 video 以该帧为首帧生成，
   镜头衔接连续。
3. 「抽当前帧」按视频当前播放进度取帧。
4. 抽帧 image 节点可正常 `saveAsset` 存入作品库、可 Ctrl+Z 撤销。
5. video 尚未完成（无产物）时抽帧按钮禁用。

### Review 检查点
- [ ] 抽帧走 `<video>.currentTime` seek + `seeked` 事件后再 `drawImage`，不要
      在 `loadedmetadata` 就画（会是黑帧）。
- [ ] 跨域：画布资产是本地 `canvasAssetUrl`（file/自有协议），`canvas` 不会被
      污染（`toBlob` 可用）；若走远程 URL 需 `crossOrigin='anonymous'`。
- [ ] 新节点+连线是**一条**撤销记录（用 `addNodeAndConnect`）。
- [ ] 不引入 ffmpeg 依赖（除非明确走方案 B 并在 PR 说明打包改动）。

### 风险
- 低（方案 A）。中（方案 B，打包体积 + 跨平台）。

---

## P2-2 · 便携式工程 .zip 导出 / 导入

### 现状
画布持久化在 SQLite + 磁盘资产（`<dataRoot>/canvas/<canvasId>/`）。无导出/导入，
无法分享「分镜模板/工作流」。

### 目标
把一个 session 的画布打包成便携 `.zip`：
```
workflow.json     // { version, nodes, edges, viewport, meta }  资产路径改写为 assets/<sha256>.<ext>
assets/<sha256>.<ext>   // 所有被引用的图片/视频二进制，按内容哈希去重
```
可在另一台机 / 另一个 session 无损导入（重新落盘 + 重建节点/边 + 重映射 id）。

### 改动文件
- 新增 `src/main/server/canvas/exportWorkflow.ts`：读 snapshot，遍历
  `node.output.assets`，`readCanvasAsset` → `sha256` → `assets/<hash>.<ext>`，
  深拷贝 nodes 时把资产相对路径替换为 zip 内路径。
- 新增 `src/main/server/canvas/makeZip.ts`：最小 zip 封装（`store`/`deflate`
  皆可；可用 Node 内置 `zlib` 手写 zip64，或引入轻量 `fflate`（~10KB，纯 JS，
  建议）。
- 新增 `src/main/server/canvas/importWorkflow.ts`：解 zip → 校验 `version` →
  资产落盘到新 `canvasId` 目录 → `addNode`/`addEdge` 重建（生成新 id，维护
  `oldId→newId` 映射改写边与 `@mention`/`memberIds`）。
- 路由 `src/main/server/routes/canvas.ts`：
  `GET  /:canvasId/export`  → `application/zip` 流
  `POST /:canvasId/import`  → multipart，返回新 snapshot
- 渲染层 `CanvasPanel.tsx` 顶部工具条：「导出工程」「导入工程」按钮 + 隐藏
  `<input type=file accept=.zip>`。
- `src/renderer/state/canvasStore.ts`：`exportWorkflow` / `importWorkflow` 调 API。
- 依赖：`package.json` 加 `fflate`（如采用）。

### workflow.json 结构
```jsonc
{
  "version": 1,
  "meta": { "exportedAt": "ISO", "app": "reizo", "title": "四格漫画分镜" },
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "nodes": [ /* CanvasNode，output.assets 内路径为 assets/<hash>.<ext> */ ],
  "edges": [ /* CanvasEdge，id 保留用于导入时映射 */ ]
}
```

### 验收标准
1. 一个含 image+video+note+连线的画布「导出工程」→ 得到 `.zip`，解压可见
   `workflow.json` + `assets/`，同一张图只存一份（哈希去重）。
2. 新建空 session「导入工程」该 zip → 节点、连线、位置、产物图片/视频、视口
   全部还原，可继续运行。
3. 导入生成全新 id，不与源 session 冲突；边、`memberIds`、prompt 里的
   `@#id` 引用都被重映射。
4. `version` 不匹配 / 损坏 zip → 明确报错，不写坏当前画布。
5. 缺失资产（源导出时文件已删）→ 跳过该资产并在导入结果里列出警告。

### Review 检查点
- [ ] 资产哈希是**内容** sha256，去重按哈希；文件名不含原始路径（防路径穿越）。
- [ ] 导入解 zip 时校验每个 entry 路径在 `assets/` 或 `workflow.json`，拒绝
      `../` 与绝对路径（zip slip）。
- [ ] 导入是原子的：全部成功才 commit，中途失败回滚新建的 `canvasId` 目录。
- [ ] 大文件（视频）流式写盘，不整体进内存。
- [ ] `exportWorkflow` 复用 `readCanvasAsset` 的目录约束，不自己拼路径。

### 风险
- 中：zip 库选型（`fflate` vs 手写）。建议 `fflate`，成熟、无原生依赖。
- 低：格式向后兼容 —— `version` 字段先立好。

---

## 落地顺序与依赖

```
P0-1 CuttableEdge ─────────────┐ (纯前端，随时可做)
P0-2 波浪并发 ─────────────────┤ (含 awaitVideoJob 修复，优先)
P1-1 @mention ────────────────┤ (依赖: 无。但 P2-2 导入需感知它)
P1-2 GroupNode ───────────────┤ (依赖: 无)
P2-1 视频抽帧 ────────────────┤ (依赖: 无)
P2-2 zip 导入导出 ────────────┘ (依赖: 了解 P1-1 的 @#id、P1-2 的 memberIds 以便重映射)
```

建议 PR 拆分：每个工作项 1 PR。P0-2 的 `awaitVideoJob` 可作为独立前置小 PR 先合。

## 统一约定（所有工作项）

- 纯逻辑放 `src/shared/`，配 `*.test.ts`（vitest，已配置）。
- 所有画布结构改动经 `canvasStore` 的 `record()`，保证 Ctrl+Z。
- 服务端改动经 `CanvasChannel` 广播，渲染层订阅，不新增轮询。
- 不破坏 Agent 工具的对外 schema；新增参数一律 `optional`。
- 颜色 / 间距走既有设计 token（`--accent` / `--line` / `paper-*` / `ink-*`）。
- 每个工作项 PR 描述里回填「验收标准逐条勾选 + Review 检查点逐条勾选」。

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
