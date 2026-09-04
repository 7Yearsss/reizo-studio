# 竞品好用功能全清单 — 生成式节点画布（Web 调研 2024–2026）

Status: **调研归档**（2026-09-04）。姊妹文档：`docs/canvas-ux-plan.md`（当前主线布局规范）、
`docs/studio-borrowings-plan.md`（4 点借鉴集成计划）、`docs/canvas-plan.md`（原始决策）。

来源:两轮 Opus + Web search 调研，覆盖
**Flora / Weavy→Figma Weave / Krea / Runway / Freepik Spaces / Recraft / Visual Electric /
Playground / LTX Studio / Kaiber Superstudio / ComfyUI / InvokeAI / tldraw / Figma UI3 /
n8n / Blender 几何节点 / Unreal Blueprint / Nuke / TouchDesigner / Vidu / Pika / Luma / Kling**。
本文件只**罗列他们做得好的 feature**,不含实施方案(方案见姊妹文档)。

每条标注:**做得好的点** · **谁做的** · **为什么值得抄** · **Reizo 现状**(✓ 已有 / ⚠ 部分 / ✗ 缺 / — 不适用)。

置信度:Runway Workflows、Weavy 帮助中心、Freepik 快捷键均 403,标 **[二手]**;
其余为一手文档 / changelog。

---

## 目录

- §1 每家的招牌 feature(逐产品)
- §2 画布导航
- §3 节点创建
- §4 节点解剖(节点本体 vs 面板)
- §5 连线 / 边
- §6 生成 / 运行 / 批量 / 版本
- §7 选择 / 容器 / 组织
- §8 工具栏 / chrome / 快捷键
- §9 画布里的 Agent
- §10 参考 / 素材
- §11 视觉语言 / 动效
- §12 空状态 / onboarding
- §13 性能(React Flow 专项)
- §14 视频生成节点输入口(专项,见 studio-borrowings-plan 补充)
- §15 一句话优先级

---

## §1 每家的招牌 feature

### Flora (flora.ai) — 最"画布原生"

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| 选中节点后按 `I` / `V` / `T` 直接生成一个**已连线**的对应模态节点 | 全场最快的建节点方式,模态即键位,几乎独一份 | ✗ |
| 连接**仍在生成中**的节点 —— 就绪校验放在生成时,不是连线时 | 去掉一整类阻塞等待,让并行创作真正并行 | ✓ `isValidConnection` 只查环/重复,`nodeReadinessIssues` 渲染时校验 |
| 多选**同类**节点批量改参,带"mixed values"混合值标记 | 30 个图节点的画布才可治理 | ✗ |
| 连接输入可**拖拽上下重排**改参考优先级 | 三张图喂一个生成节点时,模型在意"谁是 reference 1" | ✗ |
| `[H]` 一键隐藏所有控件表面 → 画布变纯 moodboard | 用户一半时间在看图不是调参 | ✗ |
| 节点**色标签**(用户自定义)标状态/主题 | 唯一可行是因为底色全去饱和 | ✗ |
| 工具栏 6 格里 **3 格是检索**(Assets / Generation History / Flows) | 规模上来后"找到你的东西"才是主任务 | ⚠ 有 Asset Shelf |
| 拖线接近视口边缘**自动平移** | 大图上连远处节点不用先缩小 | ✗ |
| 导入的文件**自动吸附成整齐网格**落在空白处 | 最接近 auto-layout 的东西 | ✗ |
| `Cmd/Ctrl+F` 节点搜索,**高亮匹配**(含用户改过的标签名) | 大图找节点 | ✗ |
| 节点**运行前显示每节点成本** | 计费信用隐形烧是全品类第一大非 UI 抱怨 | ✗ |
| 画布并排 **Image Comparison** | 版本对比 | ⚠ 有 forkVariations 2×2 |

### Weavy → Figma Weave — 合成大脑

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| **Compositor 节点 = 一个节点内部一个图层栈**,每个输入变一层 | "一节点一操作"纯粹主义的聪明逃生口;曲线/色阶/alpha/调色都是节点 | ✗ |
| 拖线时按 Option/Alt → 松手给**建议节点 + 自动连接** [二手] | 连线即创建的进阶版 | ✗ |
| `Tab` 唤起节点搜索;右键画布出完整节点菜单 | 专业节点工具惯例 | ⚠ 有 `/` 面板? 待确认 |
| 节点保持小、图片优先,参数全在右侧属性面板 [二手] | 节点不膨胀 | ✗ 全塞节点上 |
| Figma 把 Weave 工作流打包成 Design 左栏一键 **"Tool"**(锁定表单) | 图是作者基建,消费面是表单 | ✗(≈ Runway Publish as App) |
| 节点颜色按类型:绿=图 / 紫=文 / 红=视频 / 蓝=3D/数组 [二手] | 颜色答"能不能插" | ✓ edgeStyles |

### Krea (krea.ai) — 最"可读"的节点系统

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| 左栏**显式 Pan / Select 模式切换**,空格 / Cmd 双向临时覆盖 | 裸鼠标行为没有安全默认,只能"选一个 + 给开关" | ✗ |
| 从句柄拖出 → 打开**只列可连类型**的过滤菜单 | 连线即创建的关键细节:过滤,不是全目录 | ⚠ 有 dropConnectMenu,是否过滤待确认 |
| 每节点出边**硬上限 10 条** | 主动限制混乱,而非放任意面 | ✗ |
| 三种组织原语:**section 节点 / node group / sticky note** | 各司其职 | ✗ |
| **内容哈希缓存**:改 10 节点链顶部的 prompt,前 9 个缓存结果不动 | 重跑只算下游 | ⚠ 待确认 |
| 每节点 cache 开关(承 InvokeAI) | 有的节点要保留随机性 | ✗ |
| **Realtime** 分屏:左画右出,无渲染按钮 | 实时是独立模式不是开关,没人成功合并进主界面 | — |
| Node Agent:见 §9 | | |

### Runway — 图是构建面,不是日常驾驶

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| **Publish as App**:标注输入输出、眼睛图标藏字段、发一个锁定表单给工作区 | 图给作者,消费者永远不碰图 | ✗ |
| 三类节点收敛:Input / media-model / LLM | 心智简单 | ⚠ 图/视频/Agent/便签 |
| 类型兼容才连(Text 输出只连 Text 输入)[二手] | | ✓ |
| Agent 能**列出 / 打开 / 改 / 跑**整个 Workflow(2026-08) | 对话是产品,图是被对话操作的基底 | ⚠ Agent 写画布 |
| 节点启动同时上线**精选 workflow 模板** | 缓解空白画布瘫痪 | ✗ |

### Freepik Spaces / Magnific — 建节点人体工学最佳

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| `Space` 或 `/` 唤起 **Spotlight 命令面板**:实时过滤搜索 **+ 分类 tab**(Image/Video/Audio/Text/Utility);Enter 落视口中心,拖行落精确位置 [二手] | 三种落点方式覆盖所有意图 | ⚠ 有 `/`? 待确认 |
| **List 节点**聚合条目 → 扇出批量生成 | 批处理原语 | ✗ |
| **Designer 节点**:节点内嵌完整多页平面编辑器,占位符绑定上游 | 一个节点里一个 App | ✗ |
| 三种媒体节点分开:Upload / Assets / Stock [二手] | 来源清晰 | ⚠ |
| 实时多人 | | — |

### Recraft — 不做图,做 Figma 级画布卫生

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| 顶栏 zoom 菜单:**Zoom to fit project** + **Zoom to fit selection** 两个都显式暴露 | 高频操作不该藏 | ✗ |
| 左"Selected object"面板显示选中物的**生成参数** | 选中即见参数 | ✗ 无右/左属性面板 |
| 右键 → "Create new" **就在那个位置**建 | 空间就近 | ⚠ addNode 有 at 参数 |
| Prompt 面板分 **Create / Chat(agentic)** 两个 tab | 两种意图分开 | ✗ |

### Playground.com

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| 结构单元是 **frame**,生成设置作用于**选中的 frame**,不是全局 | 无边情况下"参数放哪"的干净答案 | ✗ |
| Board(简单) / Canvas(灵活)两个工作区 | 渐进 | — |

### LTX Studio — 视频序列的反例(值得抄的反面)

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| 脚本 → 自动切分镜 → 生成故事板缩略图(带建议构图)→ 时间轴编辑 | **序列用线性时间轴 > DAG**;视频编排的最强反模型 | — 值得考虑 |

### Kaiber Superstudio

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| "每次生成都是一个节点,每个节点记得来处" | 血缘 | ✓ agent trail / forkNode 重连入边 |
| **节点是 opt-in 高级功能**,默认工作流永远不碰 | 渐进披露,全场最可抄的一条 | ✗(画布即主界面) |

### ComfyUI — 前车之鉴,近期的改革者(每一条都是对差评的直接回应)

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| **Subgraph**:把选区打包成可复用模块("像文件夹"),可拆回主图 | 真正的抽象边界,40–60 节点后的墙 | ✗ |
| **Mini Map** | 大图导航 | ⚠ React Flow 自带 |
| "standard navigation mode":滚轮**滚动**而非缩放(legacy 保留在设置) | 用户对这个有宗教信仰,做错要同时维护两套 | ✗ 无切换开关 |
| 集中式快捷键面板 | | ✗ |
| Tab 预览、重设计的节点选择工具箱 | | |
| **App Mode**:意面图 → 干净表单 UI | ≈ Runway Publish as App | ✗ |
| 输入分 `required` / `optional` / `hidden` 三档;`forceInput` 把 widget 提成 socket | 精细控制哪些参数上句柄 | ✗ |

### InvokeAI — "图 vs 表单"的最佳答案

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| **Form Builder**:右键任意输入标签 → "Add to Linear View" → 拖进真表单(标题/文本/行列容器/分隔),眼睛图标切换 | 图是机器,表单是产品 | ✗ |
| 类型化 + 颜色编码 socket;不同但可转换的类型自动提示 | | ✓ |
| 节点页脚**每节点 Use Cache 开关** | | ✗ |
| Workflow 库分**精选默认**(固定 tag)+ **个人**(动态 tag 带计数) | | ✗ |
| minimap | | ⚠ |

### tldraw — 架构值得偷

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| 真无限画布:**空间索引 + 视锥剔除**,响应式相机 | 几百节点不卡的前提 | ✗ |
| "React 组件一路到底"而非 HTML Canvas | 正是这个让富交互 widget 能活在画布上 | ✓(React Flow 同理) |
| **上下文工具条**浮在选区上方 | | ✓ NodeActionBar |
| 论点:无限画布 + 生成模型天然契合 —— 设计是迭代的,画布保留**进程**,可空间分叉、可在结果上批注变成下一个 prompt | 产品哲学基线 | ✓ |

### Figma / FigJam UI3 — 肌肉记忆基线

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| 浮动工具栏移到**底部中间**(腾画布 + 跨产品统一) | 用户的手已经会了 | ✓ RW-1 底部导航 |
| 右侧属性面板选中时**上下文展开**,左侧保持最小 | | ✗ 右面板未做 |

### n8n — 画布重写

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| **向后回环的连线也画得正确** | 循环依赖可视 | ⚠ 待确认 |
| 大图加载性能大改 | | |
| 实验:**不离开画布直接编辑节点**(从模态面板往内联漂移) | | ✓ 内联 |
| 角色即类型:`ai_tool` / `ai_languageModel` / `ai_memory` 等具名连接类型,子节点只能插进对应角色口 | 角色重要时,把角色做成类型 | ⚠ 见 §14 |

### Blender 几何节点 / Unreal Blueprint — 几十年节点人体工学,修的全是防意面

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| `C` 键**注释框**绑定一组节点,整体移动 | | ✗ |
| **`Ctrl+双击`一条线创建 reroute 节点** —— 弯折/分叉不交叉 | 有史以来最好的防意面原语,AI 画布几乎没人做 | ✗ |
| "Straighten Connections" | | ✗ |
| **multi-input socket**:画得更高表示接多条,连线按入射角排序防交叉;**明确不用于顺序重要的场合** | 无序"还有这些"专用,有序用独立命名 socket | ✗ |
| Nuke:前 4 个输入横排在节点顶部,其余堆左侧,标签拾起时才显;标签 1–3 字符;**常连的放低索引** | N 个同类型不同角色输入的成熟解法 | ✗ |
| Unreal:pin 颜色 = 类型;连可转换的不同类型**自动插可见转换节点**,不静默强转 | | ✗ |
| TouchDesigner:输入永远左、输出右、上到下排序;multi-input 连接器画得更宽 | | ✓ 左右 |

### Vidu / Pika / Luma / Kling — 无节点,但产品层惯例值得看

| 做得好的点 | 为什么 | Reizo 现状 |
|---|---|---|
| Kling:元素/参考**先给名字/tag**,prompt 里 `@Banana Cat` 引用 —— 参考是可寻址具名实体,prompt 是声明其角色的地方 | Vidu name+tag 同理;直接印证 @mention 设计 | ✓ MentionTextArea + 参考锚点 |
| Kling:精确一个的首帧/尾帧用**独立命名槽**;0–N 个的元素用**列表**(不是 N 个 socket) | 两种基数两种处理 | ⚠ 见 §14 |
| Luma:**Extend 是独立操作**,end keyframe **可选**(留空 = 开放式延伸) | 续拍不是连线强转 | ✗ |
| Pika:Pikaframes(首+尾+时长)/ Pikascenes ingredients(无序多传)**拆成独立命名功能** | 角色分散到不同功能而非一个带模式开关的表单 | ⚠ |

---

## §2 画布导航 — 收敛点

| 做得好的点 | 谁 | Reizo 现状 |
|---|---|---|
| 无限无界画布 | 全部 | ✓ |
| 任意模式下空格拖拽平移 | 全部 | ⚠ 待确认 |
| 滚轮/捏合缩放 | 全部 | ✓ |
| 框选 | 全部 | ✓ RW-2 |
| **zoom-to-fit + zoom-to-fit-selection 都要,且显式暴露在顶栏 zoom 菜单** | Recraft | ✗ |
| minimap(大图) | Krea / ComfyUI / InvokeAI | ⚠ React Flow 自带 |
| **节点名搜索 `Cmd+F`,高亮匹配,含用户改的标签** | Flora | ✗ |
| **裸鼠标行为切换开关(平移/选择 或 滚轮滚动/缩放),v1 就要** | Krea 显式模式 / ComfyUI 两套模式 | ✗ — 没有安全默认,做晚了要同时维护两套 |
| 拖边接近视口边缘自动平移 | Flora | ✗ |

---

## §3 节点创建 — 收敛:四条路径冗余提供,第一条要做到极致

| 做得好的点 | 谁 | Reizo 现状 |
|---|---|---|
| **① 从句柄拖到空白 → 按可连类型过滤的节点菜单**,落在松手处 | Krea / Weavy / Flora "Canvas Suggestions" / Blender / Unreal | ⚠ 有 dropConnectMenu,是否类型过滤 + 排序待确认 |
| 排序:先按兼容性,再按**该用户**的使用频率 | | ✗ |
| **② 命令面板 `/` 和 `Space`**,搜索 + 分类 tab;Enter 落视口中心,拖行落精确位置 | Freepik Spotlight / Weavy Tab / Blender Shift+A | ⚠ 待确认 |
| ③ 双击空白 → 同一面板,落点在点击处 | Flora | ⚠ |
| ④ 左栏节点分类(不知道名字时浏览) | 多数 | ⚠ 顶栏有创建按钮 |
| **⑤ 选中节点按 `I`/`V`/`T` 生成已连线的对应模态节点** | Flora 独有 | ✗ |
| 拖桌面文件 / 粘贴 | 全部(默认到没人写文档) | ⚠ |

> 建议:别做常驻左栏节点类型列表,节点**分类**放进面板,左栏留给素材/参考。

---

## §4 节点解剖 — 最大的活跃分歧

收敛的部分:输入左、输出右、参数居中、输出预览占据节点主体;上下文 hover 工具条浮在节点上方。

分歧 —— 三种流派:

| 流派 | 谁 | 说明 |
|---|---|---|
| **全在右侧属性面板**,节点保持小、图片优先 | Weavy | 点节点 → 面板显示 aspect ratio / steps / guidance / seed [二手] |
| **全在节点本体** + `[H]` 隐藏控件表面 | Flora | 外加同类多选的批量编辑面板,带"mixed values" |
| **左面板**显示选中物生成参数 | Recraft | |
| 节点内嵌整个 App | Freepik Designer / Weavy Compositor | |
| **图与表单正式分离** | InvokeAI | 作者用完整图,消费者用生成的表单 |
| 从模态面板往内联迁移 | n8n | |

**做得好的共识做法**(建议 Reizo 采用):

| 放哪 | 内容 |
|---|---|
| 节点本体(每次生成都碰、要跨节点一眼比较) | prompt、模型、参考槽、画幅、批量数、运行按钮、输出预览、**成本** |
| 右侧面板(很少碰、导致节点膨胀的) | seed、guidance、steps、sampler、负向词、模型专属高级参数 |
| 全画布开关 | `[H]` 折叠所有控件 → moodboard 模式 |

其它:

| 做得好的点 | 谁 | Reizo 现状 |
|---|---|---|
| 同类多选批量改参 + "mixed values"标记 | Flora | ✗ |
| **每节点进度就地显示 + 运行前每节点成本**(Flora 2026-08 上线节点成本显示;Krea agent 按节点拆分算力成本) | Flora / Krea | 进度 ✓ / 成本 ✗ |
| 节点宽度标准化到**恰好 3 档**;可调的是预览区不是节点 chrome | Blender 差评的反面 | ✗ |
| 折叠/展开节点 | 多数 | ✓ RW-3 collapse/expand |

---

## §5 连线 / 边

| 做得好的点 | 谁 | Reizo 现状 |
|---|---|---|
| 类型化 + 按数据类型颜色编码的句柄,句柄/边/槽标签同色 | Krea / InvokeAI / LangFlow / Unreal | ✓ edgeStyles |
| 拖拽时非法连接直接拒绝(句柄可见地"拒绝") | 全部 | ⚠ isValidConnection 只查环/重复 |
| 每节点出边上限(Krea = 10) | Krea | ✗ |
| **multi-input 输入拖拽上下重排改处理顺序** | Flora 独有,视频/参考的关键 | ✗ |
| 悬停边端点显示**槽标签**(不点开就知道这条边喂的是哪个参考) | 建议(survey 提出) | ✗ |
| `Alt` 拖句柄 = 摘下并重接现有边 | 专业节点惯例 | ✗ |
| 两段式剪线(悬停边 → 剪刀 → 点击),非模态 | Blender knife / 建议 | ✓ RW-4 两段式剪线 |
| **`Ctrl+双击` 边插 reroute 节点** | Unreal | ✗ |
| zoom < ~0.35 边降为直 1px 线、无动画 | LOD 建议 | ✗ |
| **能量流动画只 gate 到"正在传数据"的边,且只在传输时** | 建议(常驻动画第 3 小时是噪音) | ⚠ 有能量流边 RW-4,确认是否常驻 |

图论研究佐证防意面直觉:受控实验里**边交叉数是可读性的首要因素**,路径连续性第二。

---

## §6 生成 / 运行 / 批量 / 版本

| 做得好的点 | 谁 | Reizo 现状 |
|---|---|---|
| **每节点 run + 全图 run 都要** | Freepik / Weavy | ✓ runNode + runGraph |
| **内容哈希缓存**,重跑只算变更下游 | Krea | ⚠ 待确认 |
| 每节点 cache 开关(要新随机性时) | InvokeAI | ✗ |
| **允许边生成边连线**,运行时校验就绪 | Flora | ✓ |
| **队列可见性**:紧凑列表显示运行中/排队中,每项可取消;Electron 里聚合数进 tray/dock 徽章 | 建议 | ✗ |
| 批量扇出:List 节点聚合 → 喂生成器 / 数组节点做规模化变体 | Freepik / Weavy | ✗ |
| 每节点小批量数 | Flora | ⚠ |
| 变体:节点内小宫格 + 点击提升(选中的成为该节点输出,其余留在节点历史);Fork = 复制节点保留入线、放旁边 | 建议综合 | ✓ forkVariations 2×2 + forkNode 重连入边(接近) |
| **实时是独立模式不是设置**(左输入右实时输出,无渲染按钮) | Krea Realtime | — |

---

## §7 选择 / 容器 / 组织

| 做得好的点 | 谁 | Reizo 现状 |
|---|---|---|
| 框选 + shift 点选 | 全部 | ✓ |
| 右键菜单对齐/分布(auto/左/中/右/等距) | Weavy [二手] / Recraft | ✗ |
| **三种容器不可混用**: | | |
| ├ **group** —— 一起移动,浅层,事后可拖进拖出 | Krea | ✗ |
| ├ **section / frame / 注释框** —— 命名的视觉区域,**命名区域可搜索,自由簇不可搜** | Krea section / Unreal `C` / Playground frame | ✗ |
| └ **subgraph** —— 真正可进可出的抽象边界,可拆回主图 | ComfyUI(唯一三种全有) | ✗ |
| **sticky note 便签**(人人有,便宜,先上) | Krea / ComfyUI / Freepik | ⚠ 有便签节点 |
| 画布批注 / 多人评论 | Flora Comment 工具 / Recraft / Freepik | ⚠ |

> 多数 AI 画布只有前两种,40–60 节点撞墙。Agent 生成 40 节点图后**你一定需要 subgraph**,数据模型先留好口子。

---

## §8 工具栏 / chrome / 快捷键 — 收敛到四区布局

| 区 | 内容 | Reizo 现状 |
|---|---|---|
| **左栏** | 节点库 / 导航模式 → 建议改为**素材和参考(检索,不是创建)** | ⚠ |
| **底部或顶部中间浮动** | 创建工具 | ✓ RW-1 底部导航 |
| **右面板** | 属性,选中时上下文展开,没选中收起 | ✗ |
| **右上** | Run + 分享/发布 | ⚠ |
| **左上** | 项目名、撤销/重做、zoom 控件(fit-project / fit-selection) | ⚠ |
| **浮在选区上方** | 上下文节点工具条(3–5 个该节点类型专属动词) | ✓ NodeActionBar |

Flora 工具栏分区最值得抄(唯一完整文档化):
`+`(生成 Text/Image/Video/Audio;`Shift+T` 技法选择器)· **Assets**(本画布上传)· **Generation History**(全账号跨项目)· **Flows**(悬停=最近工作流带节点数;点击=精选分类)· Split Into Layers · Comment。
**6 格里 3 格是检索。**

| 做得好的点 | 谁 | Reizo 现状 |
|---|---|---|
| UI3 工具栏移**底部**腾画布 + 跨产品统一肌肉记忆 | Figma | ✓ |
| 快捷键文化两条线:专业节点系(Blender/Unreal/ComfyUI/Weavy)快捷键优先 + 可搜索面板;设计系(Flora/Recraft)对标 Figma | | |
| "几乎每个基础画布动作都有快捷键 + 内置参考指南"(`?` 唤起) | Flora | ✗ |

---

## §9 画布里的 Agent — 最有分量的维度,三种架构

### (a) Agent 作为画布操作者 + 计划闸门 —— Flora FAUNA / Krea Node Agent(成熟范式,两家惊人一致)

| 做得好的点 | Reizo 现状 |
|---|---|
| 画布内唤起(`⌘/` 任意处,或右下按钮),`⌘\` 切停靠/浮动 | ⚠ |
| **先读画布现有状态**,复用已有 style 节点而非重复建;能新增**和修改**节点 | ✓ agent 写画布 + trail |
| **执行前给可编辑计划**:编号阶段可换模型/可删,再批准 | ✗ |
| **Assist 模式(默认:显式确认 + 成本估算)vs Auto 模式** | ✗ |
| 成本按节点、执行前显示;FAUNA 自身免费不计预算,只算它提议的生成 | ✗ |
| 建图**逐层动画**:一次一层,放下时连到上一个 | ⚠ agent trail |
| **自校验图**:补缺失参数、修不兼容连接、**插转换节点** | ✗ |
| 推理可查但折叠:"View steps" 打开思考时间线(用了哪些工具、做了哪些决策) | ✗ |
| **撤销就是撤销**:agent 的画布修改 `Cmd/Ctrl+Z` 逆转,每条 agent 消息单独可逆 | ✓ agent 写入 undo 栈(P0-2) |
| 规模上限明说("一次最多 50 节点") | ✗ |

### (b) Agent 作为主界面,图是基底 —— Runway

对话是产品,Workflow 是被对话操作的东西;2026-08 agent 能在工作区列/开/改/跑 workflow,agent 会话在 Projects 里带资产 + Brand Kit 访问。

### (c) Agent 编辑 = 版本控制 —— Framer(全场最严谨的作者身份模型,AI 画布无人做到)

| 做得好的点 | Reizo 现状 |
|---|---|
| agent 编辑落在**分支**上,不是活体;左栏分支图(主线 + 不同色的 agent 分支,分叉后合并回来) | ✗ |
| commit 卡片带路径标签 + 短 hash;红/绿 diff hunk;merge 步骤 | ✗ |
| 每条 agent 消息单独可逆 | ⚠ |

### 空白 —— 你能真正差异化的地方

**没有任何生成式画布事后标出"哪些节点是 agent 写的"。** undo 栈整合是当前最高水平,而且很弱 —— 用户批准 agent 计划后又手动改十次,无法看到或选择性撤销 agent 那部分贡献。

建议差异化(Framer 分支 diff 从文本翻译到画布):
- 每个节点/边打**作者 tag**
- agent 生成的节点渲染细微、非装饰的标记(节点左缘一条 agent 身份色细条)
- **画布 diff 审查**:agent 跑完浮一条 "agent 加了 6 节点、改了 2" → **全留 / 审查 / 全撤**;审查时 dim 未动的节点、空间化逐个走查,改过的节点内联显示改前/改后参数值
- 作者身份**可查询**:"选中所有 agent 生成的节点"、"选中本次 agent 运行的节点" 作为选择命令 —— 这才让标记有用而非装饰

---

## §10 参考 / 素材

| 做得好的点 | 谁 | Reizo 现状 |
|---|---|---|
| **持久素材架**独立于画布:Assets(本画布上传)vs Generation History(账号级跨项目) | Flora | ⚠ Asset Shelf |
| 三种媒体来源节点分开:Upload / Assets / Stock [二手] | Freepik | ⚠ |
| 桌面拖放 + 粘贴(默认到没人写文档) | 全部 | ⚠ |
| **参考图钉主流模型 = 目标节点上的语义命名槽 + 边喂 + 用户控顺序**:视频节点暴露 `first frame`/`last frame`/`style ref`/`subject ref`,可用性取决于选的模型;多图输入拖拽重排改优先级 | Flora | ⚠ 见 §14 |
| N 个参考 = **具名实体从 prompt 引用**(`@Banana Cat`),不做 `reference_1/2/3` socket | Kling / Vidu | ✓ MentionTextArea |
| 连图到 reference **自动生成其 mention token**,chip 与 `@name` 是同一对象 | Kling 证明可行 | ✗ 两套并行 |

> **警告(两个 agent 都点)**:节点画布里同时有边 + prompt 里 @mention 表达同一依赖 = 图在说谎。二选一,选边;@mention 保留作自动建边的快捷方式。

---

## §11 视觉语言 / 动效

| 做得好的点 | 谁 | Reizo 现状 |
|---|---|---|
| 深色画布 + 细点阵网格,近乎单色 chrome,扁平单层高程 | 节点图产品全部 | ⚠ |
| **不要 glassmorphism** —— 半透明面板叠在任意媒体背景上不可读,这正是图片满屏画布的特定失败模式 | | ⚠ 确认 |
| 颜色预算严格: | | |
| ├ 数据类型色(句柄/边/槽标签)—— 4–6 色,永久固定 | | ✓ |
| ├ 状态色:排队(暗)/ 运行(强调+动画)/ 错误(红)/ 脏(amber 描边) | | ✓ |
| ├ 用户色标签(仅因其它全去饱和才可行) | Flora | ✗ |
| └ **agent 专属一个保留色** = "非你所写" | | ⚠ AgentMark |
| 其它一律不给色 —— **媒体本身就是颜色** | | |
| 亮/纸色 vs 深色按模式分(moodboard 模式和图模式可能主题要不同) | Recraft/Visual Electric 亮 vs 节点图产品深 | ⚠ |
| 动效只保留:①进度/生成态 ②agent 放节点 ③拖边到视口边自动平移 ④选择过渡。**其它都是第 3 小时的噪音** | | ⚠ |

---

## §12 空状态 / onboarding

| 做得好的点 | 谁 | Reizo 现状 |
|---|---|---|
| **模板,全票通过** —— 行业专属预配置节点图(电影/建筑/时尚) | Flora Flows / Runway 模板 / Weave 发到 Figma Community / Freepik / Krea | ✗ |
| 更强版本:**别放模板画廊,直接打开一个已有可运行图的画布**(文本→图→视频,预填,run 按钮就是下一步)—— 用户对可编辑的东西反应比空工作区快 | survey 建议 | ✗ |
| **图本身的渐进披露** —— 节点是 opt-in 高级功能,默认工作流不碰 | Kaiber / Runway Apps / InvokeAI Form Builder | ✗ |
| 模板入口放 Flora 式 "Flows" 工具栏项(悬停最近 / 点击分类),优于模态 | Flora | ✗ |

---

## §13 性能 — React Flow 专项(你就是 React Flow,这条会咬人)

| 做得好的点 / 必做 | 来源 | Reizo 现状 |
|---|---|---|
| React Flow **默认把每个节点渲染进 DOM**,节点拖动触发级联重渲染 | React Flow 官方文档直言 | ✗ 未处理 |
| ① 自定义节点**及其子组件** `React.memo` | | ✗ |
| ② Zustand + 窄选择器,不用 Context/`useState` | | ⚠ 用了 useCanvasStore |
| ③ 视口虚拟化(超几百节点) | | ✗ |
| ④ **按 zoom 分 LOD**:`useStore` 订阅 zoom,<0.35 只画带缩略图色块(无句柄无文字)/ 0.35–0.7 缩略图+标题+状态 / >0.7 完整节点 | | ✗ |
| tldraw 等价物:视锥剔除 + 空间索引 | | ✗ |
| 已知 React Flow 渲染 bug(特定 zoom/边组合),强制 3D transform 硬件加速可修 | xyflow discussion | ⚠ |
| **视频专项**:绝不同时挂超过个位数 `<video>` 元素;每个 zoom 层级用 poster 帧,只给 hover/选中/播放的节点换真 `<video>` | | ✗ VideoNode 只要有 assetUrl 就永远挂 `<video controls>` |
| Electron 优势:你控制 Chromium flags,可强制 GPU 加速 | | |

---

## §14 视频生成节点输入口(专项)

详见 `studio-borrowings-plan.md` 补充。核心结论:

| 做得好的点 | 谁 | Reizo 现状 |
|---|---|---|
| **没有一家把端口按数据类型命名**(没有"image in" socket);标签=角色,颜色=类型,两条正交通道 | ComfyUI / Krea / Weavy / LangFlow / Invoke / Unreal | ✓ 首帧/尾帧/参考 已是角色化 |
| **精确一个、位置有意义**的输入(首帧/尾帧)→ 独立命名 socket;**0–N 个、弱顺序**的输入(参考/元素)→ **列表不是 N 个 socket** | Kling/Pika/Vidu/Flora | ⚠ ProgressiveRefHandles 用了 ref_1/2/3 |
| **每模型端口集不同,是一等公民、要声明**:Krea 文档直接发每模型的 Start/End/Camera/Audio 矩阵,只渲染支持的口;ComfyUI 则分叉节点身份(`WanImageToVideo` vs `WanFirstLastFrameToVideo`) | Krea | ✗ 端口写死 |
| 端口 ID **跨模型稳定**(`start_frame` 对所有模型同义),绝不 `image_1/image_2` | | ✓ |
| 切模型**不静默删边**:不支持的口保留成灰显"当前模型不支持"态,payload 留着,切回来恢复 | 建议 | ✗ |
| 节点上显示**能力矩阵徽章行**("首帧 ✓ · 尾帧 ✗ · 音频 ✓") | Krea 文档做法 | ✗ |
| `reference` 口:要么真条件化模型,要么不渲染让 @mention 承载,**不能承诺连线却只拼 prompt** | Vidu/Kling 产品层 | ✗ videoExecutor 只拼文本 |
| `video` 输出 → `start_frame`:允许,但**插一个可见的抽帧适配节点**(Unreal 自动转换节点先例),不静默强转 —— 图保持诚实、用户能改抽哪帧、为将来 v2v 留口 | Unreal / Luma extend | ✗ 需先手动抽帧 |
| prompt 留节点本体,但字段做成**可提升**接收 text 入边(ComfyUI widget-input-socket:连上时 widget 禁用) | ComfyUI / Krea/Runway LLM 节点 | ✗ |
| 端口按频率从上到下排:`start_frame` → `end_frame` → `reference`(multi-input,更高的形状) | Nuke / TouchDesigner | ⚠ |

---

## §15 反模式(要避开的)

按跨来源出现频率排:

1. **空白画布 + 一个 `+` 按钮 + 别无他物** —— 每个谈 onboarding 的来源都点名的核心采用失败
2. **无类型 / 无标签端口** —— 拖拽时就类型上色 + 拒绝非法连接,retrofit 类型很痛苦
3. **拖句柄时给全节点目录** —— 连线即创建的价值就是"按能连的过滤"
4. **把输出预览藏在点击后** —— Fal 的记录在案的失败,媒体画布里缩略图就是节点
5. **让用户等着才能连线** —— 阻塞连接直到上游完成 = 把本质并行的活动串行化
6. **跑任何东西前不显示成本** —— 建起来便宜,缺它是全品类最常见书面抱怨
7. **假装是抽象的 group** —— 只会一起移动就别起个暗示封装的名字
8. **agent 写入不进 undo 栈** —— 最低标准线,以下没人敢把花几小时的画布交给它
9. **agent 编辑无可见来源** —— 当前行业水平,是个缺口不是目标
10. **重造 pan/zoom** —— ComfyUI 不得不做整套备选导航模式**并保留旧的**,第一天就暴露切换开关,默认对标 Figma
11. **一个依赖两种表达方式**(边 + @mention)—— 选边
12. **每个 zoom 层级都把每个节点渲染进 DOM** —— React Flow 默认行为,几百媒体节点会杀死你,LOD 从一开始就设计进去,retrofit = 重写每个自定义节点组件
13. **节点宽度混乱** —— Blender 实际记录在案的差评,标准化到少数几档
14. **画布堆满环境动画** —— demo GIF 里好看,第 3 小时是视觉噪音;能量流边 gate 到"正在传输"的边

---

## 附:来源

**一手(成功抓取):** FLORA Docs(Canvas/Navigation/Toolbar/FAUNA/Node Overview/Changelog)·
Krea Docs(Nodes/Realtime/Node Agent/Top node-based apps)· Runway Changelog · Recraft Canvas ·
InvokeAI Editor Interface · ComfyUI 0.3.51 frontend updates · Figma Blog(Connecting Weave/Compositor/UI3)·
React Flow Performance + xyflow discussions #4975/#4617 + Synergy Codes 优化指南 ·
tldraw Contextual toolbar + Latent Space 访谈 · Unreal Organizing a Material Graph / Comments ·
Chase Jarvis Weavy review · Framer Agents and Branching(artdirectiondaily)· n8n community canvas beta ·
eye-tracking graph layout study(arxiv 0810.4431)·
ComfyUI 内置节点文档(WanImageToVideo / WanFirstLastFrameToVideo / WanVaceToVideo / Kling Start-End Frame)·
Nuke NDK input handling · Blender GN Workshop May 2024 · LangFlow data types · n8n AI Agent node ·
Vidu Reference to Video · Luma keyframes/extend · Kling Element Library guide

**二手(源 403,经搜索片段引用):** Weavy/Figma Weave 帮助中心(快捷键 / Understanding Nodes)·
Freepik Docs(Introduction to Spaces / Utility nodes)· Runway Help(Workflows / Publishing as Apps)·
Blender code.blender.org / devtalk

**未能证实:** 任一 Tier-1 产品里 prompt 内 @mention 画布节点;Flora/Krea/Weavy/Freepik 里记录在案的剪线/改接手势;
任一生成式 AI 画布里已上线的 agent 作者身份标记 / 画布 diff 审查;任一 Tier-1 产品里的 auto-layout/tidy;
任何地方低 zoom 显式隐藏边。
