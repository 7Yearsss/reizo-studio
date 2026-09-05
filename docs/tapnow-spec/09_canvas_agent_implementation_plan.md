# Reizo Studio 画布与 Agent 协同实施规划

> 目标：把 TapNow 已验证的画布工作流转化为 Reizo Studio 可分阶段实现、可独立验收的工程任务。
> 范围：仅包含画布、节点、连线、生成面板，以及右侧 Agent 与画布之间的双向协同。
> 证据边界：TapNow 官方实测行为使用 `OBSERVED`；项目设计愿景使用 `DOC`。未实测能力必须先按产品决策实现，不得声称是 TapNow 已验证行为。

## 1. 最终用户流程

用户在左侧无限画布中排列剧本、图片、视频、音频、Agent 和分组节点；节点默认低信息密度，选中后在原地展开生成面板。节点左右端点是两个不同的创作入口：右侧表示继续生成下游结果，左侧表示补充上游上下文。点击或拖拽端点后，用户选择创作类型，系统自动创建节点、连线、选中新节点并展开输入面板。

右侧 Agent 始终可见。用户可以把节点作为 `@引用` 放入对话，也可以从节点发起“让 Agent 处理”。Agent 先解释计划，再通过画布工具创建节点、连接和分组；批量修改默认以提案状态展示，用户接受后才正式写入。Agent 执行期间，画布显示逐步进度，完成后消息中的节点引用可以反向定位并高亮画布节点。

## 2. 实施原则

1. 画布是共享工作记忆，Agent 消息只描述意图和结果，拓扑事实以画布状态为准。
2. 所有拓扑变化都经过统一 command/history 层，支持撤销和重做。
3. 节点参数、媒体结果、运行状态、提案状态分开建模；生成结果不默认创建新节点。
4. 交互反馈必须即时：创建、连接、运行、失败、提案和定位都要有可见状态。
5. 保留现有 Reizo 未提交改动，改造时只修改本规划涉及的文件。

## 3. 分阶段任务

### 3.0 当前代码资产映射

规划应优先复用现有实现：`CanvasPanel.tsx` 已有 React Flow 画布、端点菜单、聚焦和快捷键；`canvasStore.ts` 已有 `focusNode`、`forkVariations`、`addDownstreamAgent`、`extractVideoFrame`、分组和 proposal 状态；`canvasTools.ts` 已有 `add_node`、`update_node`、`connect_nodes`、`create_storyboard_pipeline`、`group_nodes`、`run_graph`；`AgentActivityStrip.tsx` 和 `ProposalBar.tsx` 已存在。其他 AI 接手时应先做差距审计和补齐验收，不要重复创建平行状态管理或第二套工具协议。

### Phase 0：基线与状态契约

目标：先稳定数据模型，避免 UI 与 Agent 各自维护一套画布事实。

重点文件：`src/shared/canvas.ts`、`src/renderer/state/canvasStore.ts`、`src/main/server/routes/canvas.ts`、`src/main/server/db/schema.ts`。

任务：

- 统一 `NodeType`、端口语义、边语义、节点运行状态、选中状态和提案状态。
- 为节点增加 `paramsHash`、`runState`、`resultSet`、`proposalId`、`sourceRefs` 等可选字段。
- 定义 `CanvasCommand`：add/remove node、move nodes、connect/remove edge、update params、group/ungroup、batch proposal。
- `onNodeDragStop` 才写入移动历史；批量删除、组移动、批量创建作为一个用户意图记录。
- 明确服务端持久化事件与浏览器 UI 事件的转换层。

验收：刷新后节点、边、参数和标题保持；撤销/重做不丢边；旧数据可加载。

### Phase 1：TapNow 基础画布交互

重点文件：`CanvasPanel.tsx`、`NodeHandle.tsx`、`NodeActionBar.tsx`、各节点组件、`edges/`。

任务：

- 节点默认低密度，选中后在节点下方展开浮动面板；面板使用反向缩放补偿，跟随节点而不是固定在右侧。
- 左右端点采用“大命中区 + 小视觉加号 + 透明真实 Handle”。实现镜像磁吸、跟随和回弹；接近约 250ms，离开约 400ms，动效可中断并支持 reduced-motion。
- 右端点菜单：文本、图片、视频、图片编辑、Agent；左端点菜单：文本上下文、图片上下文。
- 选择菜单项后自动建点、自动连线、自动选中、展开面板；拖向空白处保留落点。
- 连线悬停/操作时显示剪刀断开控件；断边不删除节点。
- 实现 Shift 多选、组容器、组内同步移动、解组和组移动原子撤销。

验收：鼠标和键盘均能完成“选节点→端点→类型→新节点→面板”；缩放 0.15 至 2 时节点和面板仍可操作；组移动一次撤销完整恢复。

### Phase 2：上下文与语义连线

重点文件：`canvasStore.ts`、`CanvasPanel.tsx`、端口定义、边组件。

任务：

- 建立端口兼容矩阵：prompt、image、video、audio、anchor、control。
- 连接成功后，目标节点面板显示可点击来源胶囊；来源可预览、移除和排序。
- 连接改变目标节点可运行状态；空 Prompt 节点接入文本后可运行。
- 多输入采用明确策略：允许多条上下文边；单值端口换接前给出替换反馈并保留撤销。
- 非法连接显示红色回弹、`not-allowed` 和端口错误提示；不能静默失败。

验收：合法连接生成正确来源条目；非法连接不改变拓扑；替换、断开、撤销后状态一致。

### Phase 3：生成、结果和媒体工作流

重点文件：`ImageNode.tsx`、`VideoNode.tsx`、`FrameExtractorNode.tsx`、运行器和 SSE 事件处理。

任务：

- 运行中禁用冲突参数，按钮显示准备/生成/完成/失败状态。
- 图片结果默认回写原节点；`1×/2×/4×` 作为同一节点的 result set，不自动派生四个拓扑节点。
- 为 result set 提供当前结果、缩略图切换、下载、删除和设为当前版本接口；未实现前不要伪造历史轮盘。
- 视频完成后显示播放器、重试和抽尾帧动作；抽帧节点自动放置并连线，但目标镜头由用户确认。
- 失败状态保留错误原因和 Retry；重试使用同一节点和同一输入快照。

验收：生成中刷新不会显示假完成；失败可重试；图片 4× 不增加节点；视频抽帧产生可追踪的新节点和边。

### Phase 4：Agent ↔ 画布双向协同

重点文件：`src/main/server/agent/canvasTools.ts`、`agentExecutor.ts`、聊天 Composer/消息组件、`AgentActivityStrip.tsx`、`ProposalBar.tsx`。

任务：

- Agent 工具统一为 `create_node`、`update_node`、`delete_node`、`connect_edge`、`group_nodes`、`focus_node`、`create_storyboard_pipeline`。
- 每个工具带 `sessionId`、预期版本号、幂等 operationId；服务端校验端口和权限后再写入。
- 用户从画布发起 Agent 时，Composer 自动插入稳定的 `@[节点标题](canvas:id)` 引用，并保留用户可编辑文本。
- Agent 回复中的节点引用可点击，触发 `focusNode`：平移、缩放、短暂高亮；找不到节点时显示明确错误。
- 批量建点先生成 Ghost Proposal：虚线节点、预览连线、ProposalBar 的接受/拒绝；接受时一次性提交，拒绝时无残留。
- Agent 执行显示 `AgentActivityStrip`，包含当前动作、进度和可取消状态；每个工具调用完成后高亮受影响节点。
- Agent 只能通过画布 command 层修改拓扑，禁止直接改 React Flow 本地数组。

验收：Agent 可根据剧本创建分镜链；用户接受/拒绝提案后拓扑准确；执行期间右侧聊天可继续查看，画布不会冻结；点击消息引用能定位节点。

### Phase 5：空间工作流增强

任务：

- 子图折叠/展开，外部边映射保持稳定。
- 变体节点与同节点 result set 的产品区分：只有明确“派生分支”才创建新节点。
- 视口级 LOD、网格吸附、搜索、框选、快捷键和 reduced-motion。
- Agent 批量布局使用避碰算法，并支持用户手动调整后再次运行不覆盖布局。

验收：50 个以上节点仍可操作；折叠不会丢边；Agent 重复执行具有幂等性。

## 4. Agent 消息与画布事件协议

浏览器消息继续使用项目现有 `StudioUIMessage` parts；画布内部使用统一事件：`node.created`、`node.updated`、`node.deleted`、`edge.connected`、`edge.removed`、`node.run.started`、`node.run.progress`、`node.run.completed`、`node.run.failed`、`proposal.created`、`proposal.accepted`、`proposal.rejected`、`canvas.focus`。服务端持久化事件必须携带 `sessionId`、`operationId`、`actor`、`timestamp` 和 `revision`。

## 5. 推荐实现顺序

先做 Phase 0 → Phase 1，建立可用的 TapNow 空间交互；再做 Phase 2，确保连接真的传递上下文；随后做 Phase 3 的图片/视频状态；最后接入 Phase 4 Agent 协同。Phase 5 属于规模化增强，不应阻塞第一版。

## 6. 禁止直接照搬的规范描述

当前官方实测没有确认：四个变体自动排成四个节点、完整历史版本轮盘、视频抽尾帧自动接入下一镜、Ghost Proposal 的真实服务端落库边界、子图折叠和 Agent 活动条。因此这些内容在 Reizo 中应作为明确的产品设计实现，并在验收中单独标注，不得写成“TapNow 已验证行为”。

## 7. 交付要求

每个 Phase 交付：实现变更、针对性运行证据、已知限制和回滚点。不要以全仓库 lint 通过作为唯一标准；应同时提供画布交互录屏或截图、事件日志、关键状态快照，以及对应的手动验收步骤。

## 8. 交给其他 AI 的执行指令模板

开始任何阶段前，先读取本文件、`08_canvas_interaction_field_notes.md`、目标阶段引用的源文件，并检查 `git status`。只修改当前阶段涉及的文件，保留其他未提交改动。实现时优先调用现有 `canvasStore` 和画布 command/event 层；不得在组件内复制一份节点或边状态。

每完成一个阶段，必须报告：修改文件、状态/事件变化、手动验收步骤、自动化检查结果、未实现项和截图或日志证据。若实测行为与 TapNow 规范不同，以官方实测记录和当前产品决策为准，并在文档中注明差异。
