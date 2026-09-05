# Reizo Studio 画布与 Agent 协同实施规划

> 目标：把 TapNow 已验证的画布工作流转化为 Reizo Studio 可分阶段实现、可独立验收的工程任务。
> 范围：仅包含画布、节点、连线、生成面板，以及右侧 Agent 与画布之间的双向协同。
> 证据边界：TapNow 官方实测行为使用 `OBSERVED`；项目设计愿景使用 `DOC`。未实测能力必须先按产品决策实现，不得声称是 TapNow 已验证行为。

## 0. 交接说明：其他 AI 必须先读什么

这份文件是执行计划，不是调研任务。接手的 AI 不需要重新调查 TapNow，也不应把未验证功能当作现成事实。开始编码前必须按以下顺序读取：

1. **`docs/tapnow-spec/08_canvas_interaction_field_notes.md`**：这是本项目记录的 TapNow 官方画布登录后实测笔记，包含证据等级、截图/DOM 测量、左右加号语义、磁吸参数、节点面板、分组、缩放、撤销和 4× 生成结果。所有“TapNow 已验证行为”只能引用这份文件。
2. **`docs/tapnow-spec/01_visual_design_system.md`**：读取颜色、节点密度、网格、LOD 和动效视觉基线；其中未在 08 文件标为 `OBSERVED` 的内容属于设计建议。
3. **`docs/tapnow-spec/02_node_taxonomy_and_anatomy.md`**：读取节点骨架、端口命名和节点动作栏建议；若与现有代码冲突，以现有数据模型和本文件的阶段任务为准。
4. **`docs/tapnow-spec/04_interaction_and_workflow_logic.md`**：读取上下文绑定、连线约束、撤销命令和抽帧/变体的产品设计；其中 TapNow 实测差异以 08 文件为准。
5. **`docs/tapnow-spec/06_agentic_orchestration_architecture.md`**：读取 Agent 工具、Ghost Proposal 和剧本转分镜的产品设计；不要据此声称 TapNow 官方行为已验证。
6. **`docs/tapnow-spec/07_implementation_roadmap_for_reizo.md`**：读取 Reizo 文件映射和已有能力盘点。

7. **`docs/tapnow-spec/screenshots/README.md`**：读取截图命名、状态和证据边界。当前目录提供稳定截图清单；目前截图二进制尚未落盘，不能假设执行 AI 已经看过此前对话中的临时截图。

随后检查 `git status`，重点阅读 `src/shared/canvas.ts`、`src/renderer/state/canvasStore.ts`、`src/renderer/components/canvas/CanvasPanel.tsx`、`src/main/server/agent/canvasTools.ts`、`src/main/server/agent/agentExecutor.ts`、`src/renderer/components/canvas/AgentActivityStrip.tsx` 和 `ProposalBar.tsx`。必须保留现有未提交改动；不得 reset、checkout、删除或大范围格式化。

**不要做的事**：不要重新搜索 TapNow、不要修改首页/社区/模型宣传页面、不要凭空新增一套画布 store、不要直接在 React Flow 组件内修改拓扑、不要把 `DOC` 段落直接当成已存在功能。若某个行为在 08 文件中是 `TODO`，实现前应将其作为 Reizo 的明确产品决定，并在交付报告中标注。

## 1. 最终用户流程

用户在左侧无限画布中排列剧本、图片、视频、音频、Agent 和分组节点；节点默认低信息密度，选中后在原地展开生成面板。节点左右端点是两个不同的创作入口：右侧表示继续生成下游结果，左侧表示补充上游上下文。点击或拖拽端点后，用户选择创作类型，系统自动创建节点、连线、选中新节点并展开输入面板。

右侧 Agent 始终可见。用户可以把节点作为 `@引用` 放入对话，也可以从节点发起“让 Agent 处理”。Agent 先解释计划，再通过画布工具创建节点、连接和分组；批量修改默认以提案状态展示，用户接受后才正式写入。Agent 执行期间，画布显示逐步进度，完成后消息中的节点引用可以反向定位并高亮画布节点。

## 2. 实施原则

1. 画布是共享工作记忆，Agent 消息只描述意图和结果，拓扑事实以画布状态为准。
2. 所有拓扑变化都经过统一 command/history 层，支持撤销和重做。
3. 节点参数、媒体结果、运行状态、提案状态分开建模；生成结果不默认创建新节点。
4. 交互反馈必须即时：创建、连接、运行、失败、提案和定位都要有可见状态。
5. 保留现有 Reizo 未提交改动，改造时只修改本规划涉及的文件。

## 2.1 UI/UX 交互逻辑规范

本节是实现约束，不是视觉灵感。每条规则都要落实为组件状态、事件处理和可观察反馈。实现 UI 时先画出状态表，再写 JSX/CSS；不能只完成静态外观。

### 空间层级

- 画布占据主要工作区，右侧 Agent 面板固定可见；两者不通过页面跳转切换。
- 画布背景、网格和工具栏保持低对比度，让节点成为视觉焦点。
- 顶部保留画布名称、切换、返回工作区；底部保留缩放、适配视图、网格吸附、连线显示和帮助入口。
- Agent 面板保持稳定宽度；打开节点面板时不挤压 Agent，也不改变画布坐标系。

**状态要求**：

- `idle`：画布可平移/缩放，节点无选中边框，Agent 面板显示历史消息和输入框。
- `node-selected`：仅被选节点显示高亮和面板，其他节点不变；Agent 面板继续可输入。
- `connecting`：源端点、候选目标和临时连线高亮；画布平移仍可用，但不能误触发节点拖动。
- `menu-open`：菜单锚定于端点或落点，点击空白关闭；点击菜单外不创建节点。
- `agent-running`：画布保持可读和可移动，AgentActivityStrip 显示进度，不覆盖节点编辑。
- `proposal-review`：提案节点可见但不可当作正式结果运行；ProposalBar 固定在画布上层。

### 节点的渐进式披露

- 默认节点只显示类型标识、标题、媒体预览/摘要和左右端点。
- 悬停显示动作条，选中显示边框、端点和生成面板；失焦后面板收起但节点结果保留。
- 选中节点时，面板锚定在节点下方；靠近视口边缘时自动翻转到可见方向，并保持输入控件可操作。
- 生成面板的文字和控件尺寸不随画布无限缩小，使用反向缩放补偿；节点本体仍遵循画布缩放。
- 运行中只锁定会造成冲突的控件，允许用户移动节点、查看 Agent 和取消任务。

**每种状态的视觉与交互**：

| 状态 | 视觉 | 可用操作 | 禁止操作 |
|---|---|---|---|
| 默认 | 低对比边框、摘要 | 选中、拖动、端点、右键 | 无 |
| 悬停 | 动作条淡入、端点增强 | 动作条、选中 | 不改变参数 |
| 选中 | 高亮边框、面板展开 | 编辑、运行、连线 | 无 |
| 运行中 | 进度/脉冲状态 | 移动、查看、取消 | 修改正在使用的模型/Prompt |
| 完成 | 媒体结果、结果操作 | 预览、切换、下载、下游连接 | 无 |
| 失败 | 红色边框、错误摘要 | Retry、查看详情、撤销 | 显示为成功 |
| 提案 | 虚线、低饱和、轻脉冲 | 走查、接受、拒绝 | 直接运行或覆盖正式节点 |

### 图片节点与多结果集交互落地规范

- **单节点多结果集与卡牌层叠物理感（Stacked Card Deck）**：
  - 1×/2×/4× 变体生成归属于同一图片节点的结果集（`output.resultSet`），严禁自动派生多个独立拓扑分支（对应 `screenshots/` 索引 `12-image-4x-result-set.png` 与 `08_canvas_interaction_field_notes.md` 4.4 节实测）。
  - 当变体数量 > 1 时，卡片主体背后渲染 1~2 层微偏移卡牌边框与微阴影，直观表达“内含成套多张生成变体”的实体层叠感。
  - 卡片顶部 Header 显式展示 `变体 [当前序号/总数]`（如 `变体 1/4`）胶囊徽标。
- **交互式缩略图条（Variant Thumbnail Strip）与单张变体管理**：
  - 主图底部提供微缩略图预览条，每张变体均带独立缩略图与序号标定，当前选中项施加 `ring-2 ring-accent` 高亮。
  - 单击变体即时切换主视口，并同步持久化回写至 SQLite 的 `output.activeAssetIndex`。
  - 悬停单张变体缩略图显示微型剔除 `×` 按钮，调用 `canvasStore.removeNodeAsset`，支持用户剔除次优变体；移除后自动收敛 `assets` 与 `resultSet`。
  - 提供一键存入作品库（`saveAsset`）与本地下载操作。
- **图片空状态与上游驱动就绪态**：
  - 空图片卡片提供整区文件拖拽（Dropzone）与点击上传（PNG/JPG/WebP）；
  - 接入上游便签或 Agent 提示词连线后，卡片自动切换为“已接入上游提示词”高亮就绪态，展示一键生成画面与积分预估；
  - 点击图片主体原地弹出全屏高精度 Lightbox 灯箱，支持大图细节检视。

### 节点浮动标题与防缩抗锯齿规范（Anti-Zoom Floating Header / LOD）

- **标题外置与结果优先（Result-First Container）**：
  - 节点的类型图标与标题不再挤占卡片内部空间（对应实测截图 `media_1788617439447.png`），而是外置提升为卡片左上方浮动标头（`FloatingNodeHeader`，`absolute bottom-[calc(100%+6px)] left-0`）；
  - 卡片内部 100% 空间留给媒体生成画面/文本/播放器本身，视觉清爽通透。
- **反向缩放补偿（Anti-Zoom Scaling）**：
  - 浮动标题应用反向缩放补偿：$\text{scale} = \min(8, \max(1, \frac{1}{\text{zoom}}))$，变换基准锚定于 `bottom left`；
  - 画布缩小（如 0.2x、0.1x 远景俯瞰全图）时，节点卡片缩小为微型方块，但**上方的 `[图标] + 标题` 不会跟着缩小，在屏幕上始终维持 13px 恒定物理字号**，一眼看清全局拓扑所有节点名称；
  - 缩放基点位于左下角，放大时只向天花板和右侧扩展，绝不向下穿模遮挡卡片画面。
- **鸟瞰图 LOD 语义展示（Dynamic LOD）**：
  - 在低缩放（$zoom < 0.5$ 且未选中/未悬停）状态下，自动隐藏变体序号、就绪文字、齿轮开关等次要角标，仅露出纯粹的 `[图标] + 标题`（及生成中微型 spinner），极大减少鸟瞰视觉噪点；
  - 当视口放大或节点被悬停/选中时，完整胶囊角标与动作栏（`NodeActionBar` 同步反向缩放与堆叠）平滑展开。

### 左右端点的心智模型

- 右端点文案使用“继续生成/引用该节点生成”，表示从当前节点向下游扩展。
- 左端点文案使用“添加上下文”，表示为当前节点补充上游素材或约束。
- 鼠标接近时，加号向指针方向磁吸；离开时弹回原位。跟随和回弹都可被新的指针动作打断。
- 点击端点打开菜单；拖向空白处显示临时连线和菜单，松手后菜单锚定在落点附近。
- 菜单项按创作意图分组，图标、颜色和文案同时表达“文本/图片/视频/Agent”，避免只依赖颜色。

**端点实现细节**：真实连接 Handle 可以保持约 3px；可见加号约 12px；父级命中容器约 80 个画布单位。加号的位移必须作用于父容器，不能改变 React Flow Handle 的拓扑位置。接近过渡约 250ms，离开回弹约 400ms，使用带轻微 overshoot 的 cubic-bezier；`prefers-reduced-motion` 时改为无弹性、短淡入。

### 连线反馈

- 可连接端口在拖拽开始后提高亮度；候选目标出现吸附预览。
- 合法连接显示语义颜色和短暂确认动画；连线建立后目标面板更新来源条目。
- 非法连接显示红色端口、`not-allowed` 光标和轻微回弹，并提供原因；不静默丢弃。
- 连线悬停显示操作 affordance；剪刀控件只删除边，不能误删节点。
- 连线隐藏开关只影响视觉显示，不改变拓扑和运行结果。

**反馈时序**：拖拽开始立即显示临时边；进入合法目标时显示吸附和目标端口高亮；松手后先显示确认动画，再写入 store；写入失败时回滚临时边并显示原因。剪刀控件必须有独立命中区和 tooltip，点击后只发出 `remove_edge` command。

### 选择、拖动和分组

- 单击选中并展开面板；Shift 点击追加选择；点击空白取消选择。
- 框选和多选工具条只在存在多个选中节点时出现，工具条提供打组、保存、批量执行等动作。
- 组拖动时成员跟随，组外节点不移动；拖动结束才写入一条历史记录。
- 打组和解组都要有明确的过渡反馈；解组后成员和边保持原位置与连接。
- 删除、解组、拒绝提案等破坏性动作提供可撤销反馈，不使用不可逆确认弹窗阻断节奏。

### 画布与 Agent 的双向 UX

- 从节点点击“让 Agent 处理”时，聊天输入框自动插入可删除的 `@节点` 胶囊，并把节点短暂高亮。
- Agent 消息中的节点引用可点击；点击后画布平移到节点、适度缩放并短暂闪烁，右侧聊天滚动位置保持不变。
- Agent 计划阶段只在聊天中显示“正在分析/准备提案”；真正修改画布前先出现 Ghost Proposal 和顶部 ProposalBar。
- 提案节点使用虚线、低饱和填充和轻微脉冲，与正式节点明显区分；接受后平滑转为正式节点，拒绝后淡出并删除临时边。
- Agent 执行时显示 AgentActivityStrip：当前动作、已完成数量、受影响节点；点击条目可聚焦对应节点。
- 画布手动操作期间 Agent 不抢焦点、不自动平移视口；只有用户点击消息引用或明确请求时才执行 focus。
- Agent 失败时同时在聊天和画布节点显示同一错误摘要，并提供重试、查看详情和撤销入口。

**完整双向时序**：

1. 用户在节点动作栏点击“让 Agent 处理”。
2. Composer 插入 `@[标题](canvas:<id>)` 胶囊，胶囊可删除、不可被普通文本误改；节点短暂高亮。
3. 用户发送后，聊天先显示准备状态；Agent 读取 `read_canvas/read_node`，再说明计划。
4. 需要改变拓扑时，Agent 调用工具层生成 proposal；画布显示幽灵节点和预览边，聊天消息显示变更摘要。
5. 用户点击“空间走查”时，画布依次 focus 提案节点；用户按 Enter 接受，按 Esc 拒绝。
6. 接受后通过一个 batch command 提交所有节点和边；拒绝后清理所有临时对象。
7. 运行阶段每个工具调用写入活动条；消息中的节点引用可随时 focus，但不能抢夺输入焦点。
8. 完成/失败事件同时更新消息、节点和活动条，三者使用同一个 operationId。

### 动效与可访问性

- 动效服务于空间因果：创建、连接、聚焦、提案和运行状态必须能看出来源与目标；避免整页位移和长时间阻塞。
- 推荐磁吸跟随约 250ms、回弹约 400ms；菜单展开约 150ms；聚焦高亮 600–900ms 后淡出。
- `prefers-reduced-motion` 下移除弹性、脉冲和大范围平移，保留颜色、边框和状态文字反馈。
- 所有图标按钮提供 aria-label 和 tooltip；端点菜单、ProposalBar、AgentActivityStrip 支持键盘操作。
- 输入框获得焦点时，画布快捷键不得截获文字输入；Escape 优先关闭当前菜单或面板，再处理全局取消。

### 空间拥挤与响应式行为

- 新建节点避开现有节点和面板；Agent 批量布局使用碰撞检测，用户手动调整后不得被重复执行覆盖。
- 面板靠近右侧 Agent 边界时自动改为左对齐或上方展开，不能被裁切。
- 窄窗口优先保持 Agent 可读性，画布允许横向缩放和导航；不把节点参数改成难以操作的极小控件。

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

重点文件：`ImageNode.tsx`、`VideoNode.tsx`、`FrameExtractorNode.tsx`、`imageExecutor.ts`、`canvasStore.ts`。

任务：

- 运行中禁用冲突参数，按钮显示准备/生成/完成/失败状态；常驻显示进度条。
- 图片结果默认回写原节点；`1×/2×/4×` 作为同一节点的 `output.resultSet`，不自动派生四个拓扑节点。
- `ImageNode.tsx` 呈现物理层叠卡牌视觉效果（Stacked Card Deck），并在底部集成交互式缩略图条（Variant Thumbnail Strip），支持直接切图、设为主图与悬停剔除单张次选变体（`removeNodeAsset`）。
- 顶部 Header 显示 `变体 [当前序号/总数]`，与持久化的 `output.activeAssetIndex` 严格双向同步。
- 视频完成后支持原地微播放器、抽尾帧动作与版本切换；抽尾帧节点自动放置并连线至下一分镜。
- 失败状态保留错误原因和 Retry；重试使用同一节点和同一输入快照。

验收：生成中刷新不会显示假完成；失败可重试；图片 4× 不增加节点并以层叠卡牌和缩略图条展示；版本切换与单张删除刷新后数据完整；视频抽帧产生可追踪的新节点和边。

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

**特别注意（缩放区间产品决策）**：TapNow 实测缩放区间约为 0.15x ~ 2.0x。Reizo 针对多达 50+ 个镜头的大体量影视故事板工程，主动做出了产品架构扩展决策，将画布底层缩放区间拓展为 **0.05x ~ 3.0x**（`minZoom: 0.05, maxZoom: 3.0`），以支持宏观鸟瞰（5% 视距下纵览全剧分镜图网）与细节审查（300% 像素检视）；底座生成面板（`NodeFloatingPanel`）对 0.10x ~ 2.0x 区间实施 1:1 物理逆缩放补偿，低于 0.10x 适度轻微缩减以防遮挡全图。此扩展属于 Reizo 的主动产品决策，不可写成 TapNow 原生实测行为。

**特别注意（图片多结果集与层叠卡牌产品决策）**：TapNow 实测 4× 生成后画布仍保持单节点（未生成 4 个拓扑分支节点），并在节点内部呈现叠放边缘（见 `08_canvas_interaction_field_notes.md` 4.4 节）。Reizo 明确以此作为标准架构实现：通过 `output.resultSet` 保存多变体批次并用 `output.activeAssetIndex` 记录当前选定项；视觉上通过物理层叠卡牌效果（Stacked Card Deck）直观呈现多图深度，并在底部提供带真实缩略图与单张删除（`removeNodeAsset`）的微缩轮盘，兼顾拓扑清爽与选图自由度。

## 7. 交付要求

每个 Phase 交付：实现变更、针对性运行证据、已知限制和回滚点。不要以全仓库 lint 通过作为唯一标准；应同时提供画布交互录屏或截图、事件日志、关键状态快照，以及对应的手动验收步骤。

## 8. 交给其他 AI 的执行指令模板

开始任何阶段前，先读取本文件、`08_canvas_interaction_field_notes.md`、`screenshots/README.md`、目标阶段引用的源文件，并检查 `git status`。只修改当前阶段涉及的文件，保留其他未提交改动。实现时优先调用现有 `canvasStore` 和画布 command/event 层；不得在组件内复制一份节点或边状态。

每完成一个阶段，必须报告：修改文件、状态/事件变化、手动验收步骤、自动化检查结果、未实现项和截图或日志证据。若实测行为与 TapNow 规范不同，以官方实测记录和当前产品决策为准，并在文档中注明差异。

## 9. 阶段交付物清单

### Phase 0 交付物

- 共享类型和迁移说明。
- command/history API 及至少覆盖新增节点、连线、组移动的单元测试。
- 一份 revision/operationId 事件样例。

### Phase 1 交付物

- 端点磁吸录屏或截图：接近、跟随、离开、回弹。
- 左右端点菜单和自动建点/连线的手动验收记录。
- 0.15、0.5、1、2 四个缩放档位的面板可操作证据。

### Phase 2 交付物

- 端口兼容矩阵代码和测试表。
- 合法、非法、替换、断开四条连接路径的截图/日志。
- 来源胶囊添加、预览、删除和排序验收记录。

### Phase 3 交付物

- 图片 1× 与 4× 结果集合行为记录。
- 视频运行中、完成、失败、Retry、抽帧的状态截图。
- 生成事件与节点状态的 operationId 对照日志。

### Phase 4 交付物

- Agent 工具调用顺序和参数样例。
- “节点引用→发送→提案→走查→接受/拒绝→运行”的完整录屏。
- AgentActivityStrip 和消息引用 focus 的验收记录。

### Phase 5 交付物

- 50+ 节点性能和 LOD 记录。
- 子图折叠前后节点/边快照。
- Agent 重复执行的幂等性验证。

## 10. 可直接复制给执行 AI 的首条指令

“请在 `E:\CodeCode\Reizo\desktop` 执行本规划。先读取 `docs/tapnow-spec/09_canvas_agent_implementation_plan.md`、`docs/tapnow-spec/08_canvas_interaction_field_notes.md`、`docs/tapnow-spec/01_visual_design_system.md`、`docs/tapnow-spec/02_node_taxonomy_and_anatomy.md`、`docs/tapnow-spec/04_interaction_and_workflow_logic.md`、`docs/tapnow-spec/06_agentic_orchestration_architecture.md` 和 `docs/tapnow-spec/07_implementation_roadmap_for_reizo.md`，再检查 git 状态。不要重新调查 TapNow；只按当前阶段执行。先完成 Phase 0 的差距审计，再按顺序实现一个阶段。严格遵守本文件 2.1 的 UI/UX 状态、反馈时序、动效和可访问性规则；优先复用现有 `canvasStore`、`CanvasPanel`、`canvasTools`、`AgentActivityStrip`、`ProposalBar`。每次只修改本阶段涉及的文件，保留其他未提交改动。完成后报告修改文件、事件/状态变化、验收步骤、测试结果、截图或日志证据和剩余 TODO。”
