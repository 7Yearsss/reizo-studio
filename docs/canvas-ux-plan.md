# Reizo 画布 UI/UX 编排规范 — Agent ↔ 画布 · 工具栏 · 节点内按钮

Status: **规范草案**（更新 2026-09-04）。姊妹文档：`docs/canvas-plan.md`（原始决策）、
`docs/helios-borrowings-plan.md`（已实施）、`docs/studio-borrowings-plan.md`（竞品借鉴）。
§0–§7 是初版编排；**§8「Runway 形态改造」是当前主线** —— 对标 Runway Workflows 的
底部导航条 / 框选 / 强类型句柄 / 能量流动边，取代 §3 的顶部工具栏、并入 §4.4 句柄。

已落地（`feat/helios-borrowings-canvas`）：UX-1 顶部 4 分区（`d2dacc4`，将被 §8 取代）、
`studio` P0-1 动作条（`c4b0278`）、P0-2 变体宫格（`0ec6bda`）、P0-3 运镜（`b4b3d04`）、
P1-1 参考图钉（`18f7471`）。

本文件只谈**布局与交互**，不谈新功能。目标：把画布现在「按钮一字排开、动作藏在隐藏手势里、
三种节点各画各的」收敛成一套**可解释、可扩展、跨节点一致**的编排。落地项与
`studio-borrowings-plan.md` 的 P0-1 / P0-2 对齐，两份文档一起看。

---

## 0. 现状盘点（问题清单）

### 0.1 Agent（左）↔ 画布（右）

| 现状 | 位置 | 问题 |
|---|---|---|
| 右面板 Tab：画布 / 作品（会话级）+ 文件 / Git / 终端（工作区级） | `RightPanel.tsx:35-42` | 「画布」和「作品」并列，但作品其实是画布产物的归档 —— 关系没有在视觉上表达 |
| Agent 产出媒体 / 建流水线时自动切到画布 Tab | `RightPanel.tsx:45-47` `preferCanvas` | 只切 Tab，不给「Agent 刚动了什么」的落点提示（除了 `focusNode` 的一次高亮脉冲） |
| 顶栏两个独立开关：作品、画布 | `ChatPage.tsx:163-176` | 两个 icon 按钮，用户得知道「画布」是什么才会点 |
| 节点 → 对话：右键「让 agent 处理」/ 底部「投送 Agent 质检」/ 拖节点进输入框成引用 chip | `CanvasPanel.tsx:827` / `:702-724` / `chatStore.addNodeRef` | 三条路径、三种措辞、散落三处；用户不知道哪条是「标准做法」 |
| Agent → 节点：`focusBySession` 平移 + 1.8s 高亮 | `CanvasPanel.tsx:102-110` | 一次性，错过就没了；多节点批量操作只高亮最后一个 |
| 分隔条：`-left-1` 2px 命中区，hover 才显形 | `RightPanel.tsx:75-85` | 可用，但最大化 / 还原 / 关闭挤在 Tab 行右端，和 Tab 是同一视觉层级 |

### 0.2 画布顶部工具栏（`CanvasPanel.tsx:572-695`，`top-left` Panel）

当前**一行 13+ 个按钮**，无分组、无优先级：

```
图片 视频 Agent 便签 [串联审片] 整理 [导出↧] [导入↥] [撤销] [重做] [运行整图] [?]
```

问题：

1. **创建类**（图片/视频/Agent/便签）和**画布操作类**（整理/导出/撤销/运行）平铺，视觉权重一样。
2. 「运行整图」是最高频、最危险（付费）的动作，却排在最右、和「?」挨着。
3. 「串联审片」只在有 video 节点时出现，导致工具栏**宽度会跳变**。
4. 撤销 / 重做 / 导入导出用的是 `!px-1.5` 挤出来的紧凑图标钮，和左边带文字的按钮不是一个节奏。
5. 全部堆在左上，和 React Flow 自带的 `<Controls>`（左下）、`<MiniMap>`（右下）没有呼应，右上完全空着。

### 0.3 节点内按钮（三份各自实现）

| 区域 | image | video | agent | 一致性 |
|---|---|---|---|---|
| 选中态浮动条 `absolute -top-8` | 变体分支 / +质检Agent / 存为产物 | 变体分支 / +质检Agent / 存为产物 | 变体分支 / 复制结果 | 措辞、顺序、分隔线各写各的 |
| 输入区 | prompt textarea | prompt textarea + 模型 + **运镜** + 比例 + 时长 | instruction textarea | video 的参数行会换行挤压 |
| 运行按钮 | 右下 `生成` | 右下 `生成视频` | 右下 `运行` | 文案不统一 |
| 产物区悬浮层 | 下载 / 存库 / 多版本圆点 | 下载 / 存库 / 多版本 v1..vN / **抽首尾帧** | 复制 | 抽帧和动作条是两套心智（`studio` P0-1 已指出） |
| 句柄 | 左 target / 右 source（无标注） | 左 `首帧`/`尾帧`（有标注）/ 右 source | 左 target / 右 source | image / agent 句柄没有语义标注 |

核心问题：**没有一份"节点解剖图"规范**，所以每加一个节点类型就重画一次，且必然漂移。

---

## 1. 借鉴对象与提炼的原则

| 产品 | 拿来的 | 用在哪 |
|---|---|---|
| **ComfyUI** | 双击空白 / 拖线松手 → 节点搜索面板；句柄强类型配色 | 已有拖线菜单；句柄配色见 §4.4 |
| **Krea / Midjourney** | 卡片**悬停即现**的浮动动作条；变体并排平铺 | §3.1 节点动作条 = `studio` P0-1/P0-2 |
| **Figma / FigJam** | 顶部工具栏**按用途分区**（创建 / 排版 / 视图）；选中对象才出现的上下文浮条；右上留给协作态 | §2 工具栏分区、§3.3 底部条 |
| **tldraw** | 主工具竖排贴边、次要操作收进「…」；画布四角各司其职 | §2.2 四角分工 |
| **Runway / 可灵** | 运镜用可视化控件而非下拉；首尾帧是**带语义标注**的插槽 | 已由 `studio` P0-3 落地；§4.4 句柄标注 |
| **Dify / Coze** | 左侧编排、右侧运行日志；节点状态徽章统一在右上角 | §4.3 节点状态区 |
| **Claude Code / Cursor 分栏** | 左对话、右工作区，分隔条 + 最大化 + 关闭是一组；Agent 动作在右侧留「足迹」 | §2.1、§2.3 Agent 足迹 |

**四条总原则**

1. **一个动作只有一个标准入口。** 右键菜单 / 浮动条 / 底部条可以重复承载，但措辞、图标、顺序必须来自同一份定义表。
2. **按"用途"分区，不按"添加顺序"排。** 创建、编辑、视图、运行是四类，视觉上分开。
3. **危险与高频动作要显眼且有确认。** 「运行整图」独占一个区，付费时二次确认（已有 `confirmAll`）。
4. **节点是有解剖结构的。** 顶部=身份+状态，中部=输入，底部=参数+运行，外沿=句柄，悬停=动作条。任何节点类型都套这张图。

---

## 2. Agent ↔ 画布 交互模型

### 2.1 右面板结构：画布是主，作品是抽屉

- Tab 行保留，但把 **画布 / 作品** 的关系表达出来：`作品` 改为画布 Tab 内的一个**次级视图切换**（`画布 | 作品库`），或至少在 `作品` Tab 顶部加一句「本会话画布产出的已存档资产」。
  - 最小改动：`RightPanel.tsx:35-42` 的 `visible` 顺序保证 `canvas` 恒在 `artifacts` 左侧；`LABELS.artifacts` 从「作品」改为「作品库」。
- **窗口控制独立成组**：`最大化 / 关闭` 从 Tab 行右端移到分隔条顶端的一个小竖条（`RightPanel.tsx:75-85` 的 drag handle 区域扩展），与 Tab 视觉分层。（低优先，可留到面板改造 PR。）

### 2.2 顶栏入口：一个开关，不是两个

`ChatPage.tsx:163-176` 的「作品」「画布」两个按钮合并为**一个「工作台」开关** + 一个下拉箭头选默认 Tab；或直接：点一下开画布，画布内切作品库。减少「用户得先理解画布是什么」的门槛。

### 2.3 Agent 在画布上留"足迹"（替代一次性高亮）

现状 `focusBySession`（`CanvasPanel.tsx:102-110`）只脉冲 1.8s。改为：

- Agent 的每次画布写操作（`add_node` / `connect_nodes` / `update_node` / `run_node`）在目标节点上留一个**短时"Agent 徽章"**（右上角小 `✦`，8s 淡出），而不是只有平移高亮。
- 多节点操作（`create_storyboard_pipeline`）结束后，一次 `fitView` 到**新增节点的包围盒**，而不是只 focus 最后一个。
- 画布右上角（现在空着）放一个**「Agent 活动」薄条**：最近 3 条画布写操作的一行摘要（「+ 3 个分镜节点」「运行 镜头2·关键帧」），点一下跳到对应节点。数据来自现有 `CanvasChannel` 事件流，不新增通道。

### 2.4 节点 → 对话：收敛成两个动词

| 场景 | 标准入口 | 措辞 | 现有实现 |
|---|---|---|---|
| 「让 Agent 看看 / 改改这个」 | 节点动作条 `问 Agent` + 右键同名项 | **问 Agent** | 合并 `askAgent`（`CanvasPanel.tsx:347`）与「投送质检」 |
| 「把这个节点当素材接着聊」 | 拖节点进输入框 / 动作条 `引用` | **引用** | `chatStore.addNodeRef` 保持 |

删掉「投送给 Agent 质检」这个第三种措辞；质检是 `问 Agent` 的一个预设话术，不是独立动作。

---

## 3. 画布顶部工具栏 —— 重新编排

### 3.1 目标布局（`top-left` 一个 Panel，内部分 4 段，段间加 `w-px bg-line` 分隔）

```
┌ 创建 ─────────────┐ ┌ 编辑 ────┐ ┌ 视图 ┐ ┌ 运行 ─────────────┐
│ ＋节点▾  拖图提示  │ │ 整理 撤销 重做 │ │ 适应 │ │ ▶ 运行整图   ⋯更多 │
└───────────────────┘ └──────────┘ └─────┘ └───────────────────┘
```

- **创建**：`＋节点 ▾` 一个主按钮 + 下拉（图片 / 视频 / Agent / 便签 / 后续 anchor / llm）。取代现在 4~6 个并列按钮，宽度**恒定**，新增节点类型不再撑破工具栏。双击空白 / 拖线松手的菜单复用同一份节点清单。
- **编辑**：`整理`、`撤销`、`重做`。三个都作用于"画布结构"，归一为带文字的同规格按钮，不用 `!px-1.5` 挤图标。
- **视图**：`适应视图`（F）。跟 React Flow 左下 `<Controls>` 是一类，但放工具栏更好发现；`<Controls>` 保留做缩放。
- **运行**：`▶ 运行整图`（主色实心，最显眼）+ `⋯ 更多`（收纳低频项：导出工程、导入工程、串联审片、快捷键 `?`）。
  - 「串联审片」进「更多」后，工具栏**不再因有无 video 节点而跳变**。
  - 「运行整图」保留现有 2 段式确认（`confirmAll`，`CanvasPanel.tsx:329-339`）。

### 3.2 空画布引导卡（`CanvasPanel.tsx:519-570`）

保留，但按钮跟随 §3.1 的节点清单；文案对齐 `＋节点` 下拉里的名称。

### 3.3 底部上下文浮条（`bottom-center`，`CanvasPanel.tsx:697-807`）

方向对（Figma 式选中即现），但**动作太多**（投送/引用/派生/网格/成组/克隆/串联）。收敛为：

```
已选 N 个   │  问 Agent   引用   变体×4   │  排版▾（网格对齐 / 成组 / 克隆）   │  ⋯
```

- 高频三个（问 Agent / 引用 / 变体）平铺；排版类收进 `排版 ▾`。
- 「批量派生变体」→ 「变体×4」，走 `studio` P0-2 的 `forkVariations`，一条撤销记录。

### 3.4 四角分工（tldraw 式）

| 角 | 归属 | 现状 |
|---|---|---|
| 左上 | 工具栏（创建/编辑/视图/运行） | 已在，需按 §3.1 分区 |
| 右上 | Agent 活动薄条（§2.3） | 空着 → 填 |
| 左下 | React Flow `<Controls>`（缩放/fitView/锁定） | 已在 |
| 右下 | `<MiniMap>` | 已在 |
| 底部中 | 选中上下文浮条 | 已在，需按 §3.3 收敛 |

---

## 4. 节点内按钮布局规范（"节点解剖图"）

**所有节点类型**（image / video / agent / note / group，及后续 anchor / llm）套同一张图：

```
        ┌─────────── 动作条（hover 或 selected 时）─────────┐
        │  变体×4   问 Agent   引用   [类型专属…]           │
        └───────────────────────────────────────────────────┘
 ┌───────────────────────────────────────────────────────────┐
 │ [icon] 标题（双击重命名）              [dirty] [状态徽章]  │  ← ① 身份 + 状态
 ├───────────────────────────────────────────────────────────┤
◉│  输入区：prompt / instruction textarea（@ 提及）          │◉ ← ② 输入（左句柄进 / 右句柄出）
 │                                                           │
 ├───────────────────────────────────────────────────────────┤
 │  参数行：模型▾  运镜◉  比例  时长          [▶ 运行]        │  ← ③ 参数 + 运行
 ├───────────────────────────────────────────────────────────┤
 │  产物区：<img>/<video>/answer   （hover: 下载 存库 版本）  │  ← ④ 输出
 └───────────────────────────────────────────────────────────┘
```

### 4.1 动作条（区域 = 卡片外沿上方）

- **统一组件**（`studio` P0-1 `NodeActionBar`）。触发 = `hovered || selected`，离开有 ~140ms 宽限。
- 动作来自一份**定义表**（id / icon / label / onClick / 适用类型），不在每个节点文件里手写：

  | id | label | 适用 | 说明 |
  |---|---|---|---|
  | `variations` | 变体×4 | image / video | `forkVariations`（P0-2） |
  | `ask` | 问 Agent | 全部 | 合并 askAgent + 质检 |
  | `ref` | 引用 | 全部 | `addNodeRef` |
  | `animate` | 转视频 | image | `addNodeAndConnect` → `start_frame` |
  | `carryFrame` | 抽尾帧续拍 | video | 复用 `extractVideoFrame` |
  | `copy` | 复制结果 | agent（有答案） | 现有 |
  | `save` | 存为产物 | image / video（有产物） | `saveAsset` |
- 顺序固定：`variations → animate/carryFrame（类型专属） → ask → ref → save/copy`。

### 4.2 身份 + 状态区（卡片顶部）

- 左：类型 icon + 标题（双击进 `renameNode`）。
- 右：`dirty` 徽章（琥珀「待更新」）+ 运行状态徽章（`未运行 / 生成中 N% / 完成 / 失败`）。**统一措辞**，三种节点现在文案不一（video「生成中」、agent「运行中」）→ 都用「生成中 / 处理中」按类型定，但格式一致。

### 4.3 参数 + 运行区（卡片底部一行）

- 参数控件从左到右按「影响面」排：**模型 → 运镜 → 画幅 → 时长**。
- 空间不够时**换行由参数区自己管**，不挤压输入区（video 现在会挤）。
- 运行按钮恒定在该行最右，文案统一为 **`运行`**（不是「生成」「生成视频」「运行」三个）。图标 `Play`，运行中转 `Loader2`。
- 运镜控件 = `CameraDial`（本次 P0-3 已落地），是这一行的标准控件形态参考：**触发钮显示摘要 + 点开是结构化 popover**，比一排下拉更省宽。

### 4.4 句柄（卡片左右外沿）—— 强类型 + 标注

- 所有 target / source 句柄按 `studio` P0-1 的 `edgeStyles.ts` 配色（prompt teal / image indigo / 首尾帧 amber / video sky / reference violet）。
- **有语义的句柄要有 8px 外侧文字标注**（video 的「首帧/尾帧」已经做了，image / agent / 未来 anchor 的 `reference` 也要补）。
- 句柄命中区加宽（透明 20px），窄线难点的问题由 `CuttableEdge` 那套加宽层解决。

### 4.5 产物区悬浮层

- 统一：右上角 `下载 / 存库`，底部居中 `多版本圆点 / vN`。
- video 的「抽首/尾/当前帧」保留在产物 hover 层（精确取帧需要看着画面），但动作条上的 `抽尾帧续拍` 指向同一 `extractVideoFrame` —— 一个动作两个入口，实现同源。

---

## 5. 统一交互 / 视觉约定

- **颜色 / 间距**：只用设计 token（`--paper*` / `--ink*` / `--line` / `--accent` / `--accent-ink`，`index.css`），不硬编码 hex。动作条 / popover 背景 `bg-paper-raised/95 + backdrop-blur`。
- **圆角**：节点卡 `rounded-xl`，卡内控件 `rounded-lg`，chip / 徽章 `rounded-md` 或 `rounded-full`。
- **层级 z-index**：节点 `1` < 动作条 `20` < popover（CameraDial 等）`30` < 右键菜单 `150` < 拖线菜单 `160` < 快捷键卡 `170`。（沿用 `CanvasPanel` 现值。）
- **`nodrag`**：任何卡内可交互元素都要带，且 `onClick` `stopPropagation`，避免触发 React Flow 拖拽 / 选中。
- **hover 态存节点本地 state**，不进 `canvasStore`（不污染撤销栈、不触发全画布重渲染）。
- **一次用户手势 = 一条撤销记录**（`record()`，`HISTORY_CAP=60`）。拖拽类控件（CameraDial 滑杆、resize）在 `pointerup` 提交一次，不逐帧写。
- **`prefers-reduced-motion`**：动作条淡入、节点脉冲等一律降级为瞬显 / 无动画（`index.css:413` 已有块，新增动画都要进去）。
- **文案**：动作动词统一（问 Agent / 引用 / 运行 / 变体 / 存为产物）；状态词统一；tooltip 一句话说清「点了会怎样」。

---

## 8. Runway 形态改造（RW-*）— 当前主线

对标 Runway Workflows（用户提供截图）。四块：**底部导航条**、**框选/选中缩放**、
**强类型句柄（塌缩/展开 + 渐进槽位）**、**能量流动边 + 两段式剪线**。
取代 §3 的顶部工具栏；§4.4 句柄规范并入这里。

### RW-1 · 底部浮动导航条 + 框选模式

Runway 把「看画布」的操作全放屏幕**底部居中**一个浮动 pill，和「建节点」彻底分开。

```
┌───────────────────────────────────────────────┐
│  ▷ 选择   ▨ 框选  │  ⊖ 缩小  ⊕ 放大  ⤢ 适应  ⊙ 选中缩放  │  ↶ 撤销  ↷ 重做  │
└───────────────────────────────────────────────┘
        (V)     (M)         (-)     (+)    (F)      (Z)              (⌘Z)   (⌘⇧Z)
```

- **选择 / 框选是一对互斥模式开关**：
  - `选择`（默认）：`panOnDrag = true`，空白拖拽 = 平移画布。
  - `框选`：`panOnDrag = false` + `selectionOnDrag = true`（React Flow 原生），空白拖拽 =
    橡皮筋矩形多选。按住 `Space` 临时回到平移（现有 `panActivationKeyCode="Space"` 保留）。
  - 键盘：`V` / `M` 切换；松开鼠标自动不切回（模式是粘的，像 Figma）。
- `选中缩放 (Z)` = `rf.fitView({ nodes: 选中, padding: 0.3, duration: 250 })`；无选中时禁用。
- `适应 (F)` = 现有全景 `fitView`。缩放 ± 走 `rf.zoomIn/zoomOut`。
- 撤销 / 重做移到这里，顶部不再有。
- React Flow 自带的左下 `<Controls>` **移除**（功能被这条覆盖），`<MiniMap>` 右下保留。

**改动**：`CanvasPanel.tsx` 删 §3 的 `top-left` 工具栏与 `<Controls>`；新增
`<Panel position="bottom-center">` 的 `CanvasNavBar`；新增 `interactionMode` 本地 state
（`'select' | 'marquee'`）驱动 `<ReactFlow panOnDrag selectionOnDrag>`。
`＋节点▾` 创建下拉移到 **左侧竖条**（见 RW-2）。运行整图 + `⋯更多` 移到 `top-left`
单列（只剩这两个）。

**验收**：
1. 默认模式空白拖拽平移；点「框选」后空白拖拽画出矩形并多选框内节点；`Space` 临时平移。
2. `V` / `M` 切换模式，按钮高亮同步。
3. 选中 2+ 节点点「选中缩放」→ 平滑聚焦到这些节点的包围盒。
4. 顶部不再有撤销/重做/整理/适应；它们都在底部条且行为不变。
5. `prefers-reduced-motion` 下缩放无 `duration` 动画。

### RW-2 · 左侧竖条（创建 / 插入）

Runway 截图左侧一条竖 pill，只放「加东西」。Reizo 版：

```
┌──┐
│＋ │  ＋节点 ▾（图片 / 视频 / Agent / 便签 / 参考图钉）
│▤ │  成组 / Frame（选中≥2 时可用）
│◫ │  素材栏开关（切换右上 AssetShelf 显隐）
└──┘
```

**改动**：`<Panel position="top-left">`（或 `center-left`）一个窄竖条；复用现有
`ToolbarDropdown`（`＋节点`）。删掉顶部横排创建按钮。

### RW-3 · 强类型句柄（塌缩 / 展开 + 渐进槽位）

Runway 句柄两态（截图对比）：

| 态 | 表现 |
|---|---|
| **静止 / 未选中** | 句柄 = 一个空心小圆（`8px`），无标签，节点很干净 |
| **选中 or 悬停** | 每个句柄弹出**带标签的实心彩色胶囊**：左侧输入、右侧输出 |

规则：
- **颜色按数据类型固定，同类型同色**（这是关键——用户明确要「Ref Video 都用红色，一眼看清」）：

  | 类型 | 色 | token 名 | 举例 |
  |---|---|---|---|
  | 提示词 prompt | 绿 `#4ade80` | `EDGE_COLORS.prompt` | `Prompt *` |
  | 图像 image | 靛蓝 `#818cf8` | `image` | `Ref Image` / 输出 `Image` |
  | 首帧 / 尾帧 | 蓝 `#60a5fa` | `startFrame` | `First Frame` / `Last Frame` |
  | 视频 video | 绯红 `#f43f5e` | `video`（改） | `Ref Video` / 输出 `Video` |
  | 音频 audio | 琥珀 `#f59e0b` | `audio`（新） | `Ref Audio` / 输出 `Audio` |
  | 参考图钉 anchor | 紫 `#a78bfa` | `reference` | `Ref Anchor` |
  | 文本响应 | 绿 | `prompt` | 输出 `Response` |

  → `edgeStyles.ts` 增 `audio`，`video` 由 sky 改绯红，边与句柄引用同一份。
- **必填输入带 `*`**（`Prompt *`）；缺失且未运行时该胶囊描边转 danger（复用现有
  `nodeReadinessIssues` / `MissingInputWarning` 的判定）。
- **渐进式同类型槽位**：`Ref Video 1` 连上一条边后，下方**才**出现空的 `Ref Video 2`；
  再连上才出 `3`（上限 3，可配）。未连的多余槽不渲染。底部提示文字
  `Connect for more ref slots`（有可加槽时才显示）。
  - 实现：一个 handle 组件按 `已连入该类型的边数 + 1` 渲染槽位；每个槽 `id`
    形如 `ref_video_1` / `ref_video_2`。执行器按 `id` 前缀归类、按序号排序取图
    （`imageExecutor` 的 anchor / `@mention` 排序逻辑扩展到带序号的 ref 槽）。
- **命中区加宽**：胶囊 + 圆点外层套 `20px` 透明 padding，窄线也好连。

**改动**：新增 `src/renderer/components/canvas/NodeHandle.tsx`（受控：`kind` / `label` /
`required` / `index` / `collapsed`）；`ImageNode` / `VideoNode` / `AgentNode` /
`AnchorNode` 的裸 `<Handle>` 全换成它。`edgeStyles.ts` 加 `audio`、改 `video` 色 +
`HANDLE_LABEL` 表。执行器侧扩展 ref 槽按序取图。

**验收**：
1. 未选中节点只见空心圆；选中或悬停 → 弹出彩色标签胶囊，移开 140ms 收起（复用
   `useHoverIntent`）。
2. 两个视频参考节点连到同一节点：先只有 `Ref Video 1`；连上后冒出 `Ref Video 2`；
   都是同一种绯红。
3. `Prompt *` 未连且未运行 → 胶囊描边告警，与现有「缺输入」提示一致。
4. 旧数据（`targetHandle: null` 的边）仍连在默认输入槽，不报错。
5. 运行时执行器按 `ref_video_1/2/3` 顺序取图，与胶囊显示顺序一致。

### RW-4 · 能量流动边 + 两段式剪线

用户原话：「线可以点击之后变成虚线，这时候才出现剪刀来剪；线需要有感觉像能量一样传输到下一个节点」。

**能量流动**（常态，不只运行时）：
- 边上叠一层 `stroke-dasharray` 的高亮虚线，`stroke-dashoffset` 用 CSS
  `@keyframes` 匀速位移，方向 = 源 → 目标，营造「能量往下游流」的观感。
- 常态：低透明度（`opacity: 0.35`）、慢速（~3s/周期）、色 = 该边类型色。
- 运行中（目标节点 `runState==='running'`）：不透明、快速（~0.8s）、加粗 —— 叠加在
  类型色上，替换现有 `animated` 布尔。
- `prefers-reduced-motion`：不流动，退化为静态实线。

**两段式剪线**（改掉现在的「悬停即出剪刀」，用户说太容易误触）：
1. 常态：实线，`onMouseMove` **不再**吸附剪刀。
2. **单击边** → 进入「待剪」态：整条边转虚线 + 轻微放大描边 + 在中点显示 `✂` 徽章。
3. 待剪态下：点 `✂` 徽章 → 播放 `stroke-dashoffset` 收起动画 → `canvasStore.removeEdge`
   （保留撤销）。点边以外任意处 / `Esc` → 退回常态。
4. 待剪态最多一条边（点另一条边转移）。
5. `Delete` / `Backspace` 对「待剪」边同样可删（现有 `deleteKeyCode` 保留）。

**改动**：`CuttableEdge.tsx` 重写：去掉 `onMouseMove` 最近点采样；加
`armed` 本地态（点击进入）；`edgeStyles.ts` 加流动动画 class；`index.css` 加
`@keyframes edge-flow` + reduced-motion 降级。`CanvasPanel` 点空白时清 `armed`
（复用现有 pane-click 关菜单的位置）。

**验收**：
1. 静止时鼠标划过连线**不**出现剪刀（不会误删）。
2. 单击连线 → 变虚线 + 中点出剪刀；点剪刀 → 收起动画后删除；`Ctrl+Z` 恢复该边。
3. 待剪态点画布空白 / `Esc` → 恢复实线。
4. 常态下边有低调的流动虚线（能量感）；目标节点运行中时流动加快加亮。
5. `prefers-reduced-motion` 下无流动、剪线无收起动画（直接删）。

### RW 落地顺序

```
RW-1 底部导航条 + 框选 ──────┐ (纯前端 CanvasPanel，取代 UX-1，先做)
RW-2 左侧竖条 ───────────────┤ (跟 RW-1 同 PR 或紧随)
RW-4 能量边 + 两段式剪线 ────┤ (CuttableEdge 重写 + index.css，独立)
RW-3 强类型句柄 + 渐进槽位 ──┘ (最大，含执行器改动；依赖 edgeStyles 色板先定)
```

**PR 拆分**：RW-1+RW-2 一个（导航条 + 左条，删顶部工具栏）；RW-4 一个（边）；
RW-3 一个（句柄组件 + 执行器 ref 槽）。RW-3 的 `edgeStyles` 色板调整可作前置小 PR。

---

## 6. 落地清单（与 studio-borrowings-plan.md 对齐）

| 项 | 内容 | 依赖 / 对应 | 状态 |
|---|---|---|---|
| ~~UX-1~~ | 工具栏 4 分区（§3.1） | `d2dacc4` | ✅ 已合，**将被 RW-1 取代** |
| UX-2 | `NodeActionBar` 统一组件 + hover 触发（§4.1） | `studio` P0-1 `c4b0278` | ✅ 已合 |
| UX-3 | 节点内按钮按"解剖图"归位 | 跟随 RW-3 | 待做 |
| UX-4 | 底部上下文浮条收敛为「问Agent / 引用 / 变体×4 / 排版▾」（§3.3） | `studio` P0-2 `0ec6bda` | 部分（变体已换 `forkVariations`），收敛待做 |
| **RW-1** | 底部导航条 + 框选 / 选中缩放（§8） | 纯 `CanvasPanel.tsx`，取代 UX-1 | **主线，先做** |
| **RW-2** | 左侧竖条（创建 / 成组 / 素材栏）（§8） | 跟 RW-1 同 PR | 主线 |
| **RW-3** | 强类型句柄：塌缩/展开 + 同类型同色 + 渐进槽位 + `*`（§8） | `edgeStyles` 色板 + 执行器 ref 槽 | 主线，最大 |
| **RW-4** | 能量流动边 + 两段式剪线（§8） | `CuttableEdge` 重写 + `index.css` | 主线，独立 |
| UX-6 | 右上「Agent 活动」薄条 + 多节点 fitView + Agent 徽章足迹（§2.3） | 读现有 `CanvasChannel` 事件 | 待做 |
| UX-7 | 节点 → 对话收敛为 `问 Agent` / `引用` 两个动词（§2.4） | 跟随 UX-2 定义表 | 待做 |
| UX-8 | 右面板：作品 → 画布次级视图 / 窗口控制独立成组（§2.1–2.2） | `RightPanel.tsx` + `ChatPage.tsx` | 待做 |

**PR 拆分**：RW-1+RW-2 一个（导航条 + 左条，删顶部工具栏与 `<Controls>`）；
RW-4 一个（能量边 + 两段式剪线）；RW-3 一个（`NodeHandle` 组件 + 执行器 ref 槽，
`edgeStyles` 色板调整可作前置小 PR）。之后 UX-3/6/7/8 收尾。

---

## 7. 统一约定（沿用全仓）

- 结构改动经 `canvasStore.record()`，撤销闭环。
- 服务端权威，`CanvasChannel.broadcast`，不新增轮询。
- Agent 工具 schema 只增可选参数 / 加 enum 成员 / 加新工具。
- 纯逻辑（如动作定义表、若拆成数据）放 `src/shared/`，配 vitest。
- 颜色 / 间距走设计 token；新增动画进 `prefers-reduced-motion` 降级块。

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
