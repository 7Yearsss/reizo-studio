# TapNow 创意画布全景工程落地规范
## 第 00 篇：全景架构与系统总览 (Master Architecture Overview)

> **版本**：v1.0.0  
> **面向对象**：AI 编码智能体、系统架构师、前端图形学工程师、产品设计师  
> **核心目标**：提供完整、精确、可直接指导代码编写的工业级 AI 创意画布落地工程规范。

---

### 1. 调研资料全景溯源与方法论

为了让后续 AI 及工程团队能够毫无歧义地还原与超越 TapNow 的画布系统，本套规范不是概念性泛谈，而是基于官方一手系统与行业专业评测交叉逆向验证总结提炼而成。主要渠道覆盖：

1. **官方产品矩阵与核心文档体系**：
   - 官方入口与产品系统：[tapnow.ai](https://tapnow.ai) 与 [app.tapnow.ai](https://app.tapnow.ai)
   - 官方教程频道：YouTube 官方频道 `@tapnow_global` 发布的《TapNow Basic Tutorial》、《AI Filmmaking with TapNow》、《Cinema Lab & Camera Control》、《Agentic Canvas Workflow》实操全流程。
   - 官方更新日志与模型适配说明：深度集成的 Kling 3.0 (快手可灵)、Seedance 2.0、Sora 2 Pro、Veo 3.1、Flux 1.1 Pro、ElevenLabs 与 Suno 的调用管线。
2. **专业影视创作者与 AI 广告工作室实操复盘**：
   - Facebook AI Filmmaking 创作者群组、Reddit `r/AIVideo` / `r/StableDiffusion` 中专业团队使用 TapNow 生产长片、TVC 商业广告的拆解。
   - 海外独立导演关于“多镜头角色一致性”、“前后帧运动接力（Frame-to-Frame Continuity）”与“镜头组预设（Lens Combos）”的评测。
3. **技术智库与竞品架构评测**：
   - *FutureStack Reviews*、*ToolCenter*、*Wireflow*、*Alignify* 关于“节点式 AI 工作流（Node-based AI Creative Canvas）”的架构与交互评测报告。
   - 对标成熟工具：ComfyUI（算法流）、Runway Gen-3 Canvas（单点剪辑流）、Figma Weave / FigJam（空间白板流）。
4. **前端图形引擎底座技术栈对标**：
   - 基于 `@xyflow/react` (React Flow 12+)、Web Audio API (动态波形分析)、HTML5 Video MediaSource、Zustand 瞬时拓扑状态管理与服务端 DAG 有向无环图异步调度引擎。

---

### 2. 核心设计哲学：四阶语言学隐喻体系

传统 AI 工具最大的痛点在于**心智模型错位**：
- **单点提示词工具（Midjourney / 网页版 Runway）**：黑箱抽卡，缺乏上下文空间关联，镜头与镜头之间割裂，角色容易变脸。
- **底层极客工具（ComfyUI）**：暴露了过于琐碎的模型底层节点（如 VAE Decode、CLIP Text Encode、KSampler、Latent 组合），创作者 80% 的时间在连无意义的技术线，无法专注于视听语言。

TapNow 提出了专为影视导演和视觉创作者设计的**“四阶语言学宇宙”**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Canvas (Universe / 宇宙)                        │
│             无限延展的二维非线性空间，打破一维时间线的束缚                  │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                    Group / Section (Phrase / 词组)              │   │
│   │        场景大区分组，将一组分镜的创作 Know-how 沉淀为独立单元        │   │
│   │                                                                 │   │
│   │   ┌──────────────┐                 ┌────────────────────────┐   │   │
│   │   │  Node (词汇)  │ ──Wire(语法)──► │       Node (词汇)       │   │   │
│   │   │ 剧本 / 角色图钉│  上下文约束传递   │ 镜头 1: 运镜与视频生成   │   │   │
│   │   └──────────────┘                 └───────────┬────────────┘   │   │
│   │                                                │ Wire           │   │
│   │                                                ▼ 抽尾帧接力     │   │
│   │                                    ┌────────────────────────┐   │   │
│   │                                    │       Node (词汇)       │   │   │
│   │                                    │ 镜头 2: 动作衔接与视频  │   │   │
│   │                                    └────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

1. **Node = Vocabulary（词汇）**：
   - 创意的最小具象实体。每一个节点都是创作者看得懂的“剧本台词”、“关键帧图片”、“机位视频”、“音频播放器”、“角色图钉”。
   - 节点外表是 100% 的**纯视听产物**（Result-First），参数面板被收纳于滑块抽屉中（Progressive Disclosure）。
2. **Wire = Logic（语法逻辑）**：
   - 定义上下文与创意约束的流动。线不再是冷冰冰的数据电缆，而是语义流动：
     - 把角色图钉连到镜头 = **注入角色外貌与服饰一致性约束**；
     - 把前镜尾帧连到后镜首帧 = **注入动作与光影连续性插值约束**；
     - 把剧本提示词连到机位 = **注入运镜调度指令**。
3. **Group = Phrase（词组段落）**：
   - 对应影视剧本中的“场（Scene）”或“镜头组（Sequence）”。
   - 可以一键折叠坍缩为“子图节点（Subgraph Node）”，只对外暴露输入和输出端口，保障数百个镜头的超大工程不杂乱。
4. **Canvas = Universe（创作宇宙）**：
   - 空间化、非线性排列。主线镜头向右推进，备选镜头垂直向下派生分支（Branching），情绪看板在周围散布，构成了导演的全局视听控制台。

---

### 3. 系统分层架构模型 (System Layer Architecture)

为了让 AI 和工程师清晰代码的模块边界，TapNow 架构分为四层：

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. 表现与交互层 (Presentation & UI/UX Layer)                             │
│    - Canvas Stage: @xyflow/react 无限视口, LOD 动态渲染, 极简网格底色     │
│    - Node Container: 统一骨架 (Header + Content Stage + Hover Bar)       │
│    - Media Renderers: 视频原地轻量解码, 音频交互波形(Web Audio), 图片LightBox│
│    - Drawer Controls: Cinema Lab 运镜旋钮, 经典镜头滤镜, 提示词编辑器      │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. 画布运行时与状态层 (Canvas Runtime & State Layer)                     │
│    - Zustand Stores: nodesState, edgesState, selectionState, lodState   │
│    - Undo/Redo Engine: 基于 Command Pattern 的时间旅行栈 (50 步步深)     │
│    - Spatial Indexing: R-Tree 视口外元素剔除 (onlyRenderVisibleElements)│
│    - Semantic Port Validator: 端口连线类型强校验 (Type Guard)            │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. 拓扑图调度与执行引擎 (Graph Execution Engine)                         │
│    - DAG Scheduler: 基于 Kahn 算法的拓扑依赖排序与并行层级分组            │
│    - Dirty State & Cache: 基于 paramsHash 的节点级产物缓存, 增量执行    │
│    - Realtime Event Stream: SSE / WebSocket 推送任务进度与错误重试     │
├─────────────────────────────────────────────────────────────────────────┤
│ 4. 多模态模型网关与 Agent 协调层 (Model Gateway & Agent Layer)          │
│    - Agent-in-the-Loop: 画布自治 Tool-Calling (建点、连线、批量排布)     │
│    - Video Pipeline: Kling 3.0 / Seedance 2.0 / Sora 2 统一参数转译器   │
│    - Continuity Adapter: 尾帧抽取与首帧插值 (Frame-to-Frame Continuity) │
│    - Community Engine (TapTV): 工作流拓扑无损导出与一键 Remix 引擎      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 4. 落地实施规范文档目录体系 (Specification Suite Index)

为了保证深度与实操细节，整套规范拆分为以下 7 个互为支撑的专业工程文档，全部存放在项目的 `docs/tapnow-spec/` 目录中：

| 文档编号与名称 | 核心职责与落地指导范围 |
| :--- | :--- |
| [**`01_visual_design_system.md`**](./01_visual_design_system.md) | 暗调美学色卡、几何排版、LOD 视口保护算法、六大语义分色连线体系、微质感 CSS 规范 |
| [**`02_node_taxonomy_and_anatomy.md`**](./02_node_taxonomy_and_anatomy.md) | 六大实体节点（文本/图片/视频/音频/角色图钉/子图）的结构解剖、端口定义与 TypeScript 数据结构 |
| [**`03_cinema_lab_system_spec.md`**](./03_cinema_lab_system_spec.md) | Cinema Lab 三维运镜旋钮数学映射、电影级器材组合预设、三点式布光与模型提示词编译算法 |
| [**`04_interaction_and_workflow_logic.md`**](./04_interaction_and_workflow_logic.md) | 约束传递逻辑、一键抽尾帧续拍、并排派生变体 ×4 算法、撤销重做状态机、TapTV Remix 引擎 |
| [**`05_graph_engine_and_runtime.md`**](./05_graph_engine_and_runtime.md) | DAG 拓扑排序调度器、节点级 Dirty 状态追踪与哈希缓存、SSE 实时双向事件通信协议 |
| [**`06_agentic_orchestration_architecture.md`**](./06_agentic_orchestration_architecture.md) | Agent 画布操作工具协议、剧本一键拆解为分镜图的时序逻辑、幽灵节点（Ghost Nodes）交互 |
| [**`07_implementation_roadmap_for_reizo.md`**](./07_implementation_roadmap_for_reizo.md) | 针对 Reizo Studio 代码库的逐阶段实施路径、数据库迁移方案、端到端测试用例清单 |

---

### 5. 后续 AI 开发者的快速实施心智模型

当后续 AI 或工程师接手某个具体模块的开发时，只需遵循以下实施法则：
1. **写 UI 节点时**：阅读 `01` 和 `02`，确保使用统一的容器 CSS、微质感边框和语义端点。
2. **写运镜或视频高级参数时**：阅读 `03`，直接套用 Cinema Lab 的机位参数数学转换公式与器材预设字典。
3. **写连线交互与抽帧时**：阅读 `04`，严格按照上下文约束传递规则与自动坐标计算公式生成新节点。
4. **写后端生成与并发调度时**：阅读 `05`，实现 DAG 拓扑排序与 `paramsHash` 缓存过滤。
5. **写 Agent 画布联动时**：阅读 `06`，直接调用标准化定义的 JSON Schema 工具契约。
