# TapNow 创意画布全景工程落地规范
## 第 07 篇：Reizo Studio 精确改造指南与实操清单 (Implementation Roadmap)

> **版本**：v2.0.0 (基于 Reizo Studio 现有代码深度逆向校准)  
> **面向对象**：项目技术负责人、全栈开发工程师、后续协同 AI 助手  
> **核心目标**：盘点当前 Reizo Studio 已有底座，杜绝重复造轮子，精准定位与 TapNow 之间的实际技术差距，给出可直接按文件实施的代码改造清单。

---

### 1. 现有代码资产深度盘点 (已实现 vs 待升级)

在对当前代码库深入逆向审计后，我们惊喜地发现 Reizo Studio **已经具备了相当优秀的底座资产**，绝对不要重复重写！以下是精准的资产对比表：

| 功能模块 | Reizo 现有底层资产 | TapNow 标杆体验 | 实际差距 (Gap) 与改造策略 |
| :--- | :--- | :--- | :--- |
| **四大基础卡片** | `ImageNode.tsx`<br>`VideoNode.tsx`<br>`NoteNode.tsx`<br>`AudioNode.tsx` | 纯封面化、统一卡片外框、悬停浮现动作栏、滑块抽屉 | ✅ **已基本对齐**：音频波形与四大节点已高度统一，可微调边框质感。 |
| **运镜控制** | `CameraDial.tsx`<br>`shared/cameraMotion.ts` (支持 6 轴运镜：Pan, Tilt, Zoom, Roll, Track, Boom) | Cinema Lab：6 轴运镜 + **传奇镜头组 (Lens Combos)** + **摄影棚布光 (Studio Lighting)** | 🟡 **需升级扩充**：现有 `CameraDial` 仅有 6 轴滑块，需在抽屉中增加镜头组（Arri Alexa/Cooke 等）与灯光方案。 |
| **变体派生** | `canvasStore.forkVariations()`<br>`variantGrid()` 空间防重叠布局 | 悬停动作栏派生变体 ×4 并排试拍 | ✅ **已实现**：`VideoNode` 动作栏已接入该函数，支持自动间距避障排布！ |
| **抽尾帧接力** | `canvasStore.extractVideoFrame()`<br>`grabVideoFrameBlob()`<br>`FrameExtractorNode.tsx` | 悬停动作栏一键抽尾帧并自动生成图片节点 | ✅ **核心链路已通**：`VideoNode` 动作栏中已有“抽尾帧续拍”，可进一步优化自动连线目标。 |
| **角色图钉** | `AnchorNode.tsx`<br>`ANCHOR_ROLES`<br>`ANCHOR_STRENGTHS` | 角色三视图母本绑定，紫罗兰广播连线 | 🟡 **需升级**：已有图钉卡片与角色/风格角色切换，需打通将其注入视频/图像执行器的约束通道。 |
| **连线与语义** | `edgeStyles.ts`<br>`EDGE_COLORS` (翠绿/靛蓝/洋红/琥珀/紫罗兰已全齐) | 连线严格类型校验、数据流动粒子流光 | 🟡 **需升级**：颜色已完全齐备，需在 `CanvasPanel.tsx` 的 `isValidConnection` 增加类型校验防错。 |
| **幽灵节点** | `ProposalBar.tsx`<br>`isProposal` 虚线高亮动画 | Agent 生成幽灵分镜节点，用户审查后确认应用 | ✅ **底层机制完全具备**：已有 `isProposal` 状态与接受/拒绝栏，只需 Agent 批量下发。 |
| **场景大区分组** | `SectionNode.tsx`<br>`GroupNode.tsx`<br>`SubgraphNode.tsx` | 场景大区框选底板 + 一键收折子图 | 🟡 **需联动**：已有独立组件，需实现框选节点一键打包为 Subgraph 的右键菜单动作。 |

---

### 2. 逐文件精准改造计划 (File-by-File Action Plan)

基于上述盘点，后续 AI 或工程师改造 Reizo Studio 画布时，只需精准执行以下**5 个关键文件的改造**：

#### 改造点 1：将 `CameraDial.tsx` 升级为 Cinema Lab 全功能控制台
- **目标文件**：[`src/shared/cameraMotion.ts`](file:///e:/CodeCode/Reizo/desktop/src/shared/cameraMotion.ts) 与 [`src/renderer/components/canvas/CameraDial.tsx`](file:///e:/CodeCode/Reizo/desktop/src/renderer/components/canvas/CameraDial.tsx)
- **改造内容**：
  1. 在 `cameraMotion.ts` 中补充 `CineLensCombo`（Arri+Cooke, RED+Zeiss, Canon K-35 等）与 `StudioLightingPreset` 类型定义与提示词拼装。
  2. 在 `CameraDial.tsx` 弹窗中，在现有运镜滑块下方增加两组选择器：
     - [镜头组合] 下拉胶囊；
     - [摄影棚布光] 图标切换组。
  3. `cameraToPrompt()` 自动把选中的镜头组和布光英文提示词追加到输出字符串。

#### 改造点 2：在 `CanvasPanel.tsx` 接入端口语义强类型校验 (Connection Guard)
- **目标文件**：[`src/renderer/components/canvas/CanvasPanel.tsx`](file:///e:/CodeCode/Reizo/desktop/src/renderer/components/canvas/CanvasPanel.tsx)
- **改造内容**：
  - 找到 `isValidConnection` 回调函数。
  - 引入 `docs/tapnow-spec/04_interaction_and_workflow_logic.md` 中的端口兼容性矩阵：
    - 严禁非音频端口接入 `audio_in`；
    - 严禁将图片输出接入 `prompt` 端口；
    - 允许 `anchor` 端口多路广播接入下游的 `reference`。
  - 若连接不合法，返回 `false`，界面显示阻断禁止光标。

#### 改造点 3：优化“抽尾帧续拍”与下游镜头的自动接力
- **目标文件**：[`src/renderer/state/canvasStore.ts`](file:///e:/CodeCode/Reizo/desktop/src/renderer/state/canvasStore.ts) 中的 `extractVideoFrame()`
- **改造内容**：
  - 目前 `extractVideoFrame` 抽取尾帧后，在右侧生成一个 `ImageNode`，并建立了 `video ➔ image` 的连线。
  - 增强：如果当前右侧已经存在下一个 `video` 节点，或者用户处于“连续镜头创作模式”，自动将该新 `ImageNode` 的 `image_out` 端口顺接连接到下一个视频节点的 `start_frame` 端口，实现真正的动作连续性（Continuity）。

#### 改造点 4：打通角色图钉（Anchor）向底层视频模型的约束注入
- **目标文件**：[`src/main/server/routes/canvas.ts`](file:///e:/CodeCode/Reizo/desktop/src/main/server/routes/canvas.ts) 或对应的节点执行器（Executor）
- **改造内容**：
  - 当触发 `runNode` 执行视频生成时，回溯入度连线（Incoming Edges）。
  - 若检测到来自 `anchor` 节点的连线：
    - 读取该 Anchor 节点的图片资源与 `role`（角色/风格）及 `strength`（弱/中/强）；
    - 若底层是 Kling/Seedance，将其作为 `image_tail` 或 ControlNet 参考图传入；若仅支持纯文本，则将角色 Prompt 前缀（如 `Character description: ...`）自动追加到提示词首部。

#### 改造点 5：场景大区框选一键打包为 Subgraph
- **目标文件**：[`src/renderer/components/canvas/SectionNode.tsx`](file:///e:/CodeCode/Reizo/desktop/src/renderer/components/canvas/SectionNode.tsx) 与 `canvasStore.ts`
- **改造内容**：
  - 在 `SectionNode` 标题栏右侧增加一个「收折为子图」按钮。
  - 点击后，调用 `canvasStore.collapseSectionToSubgraph(sessionId, sectionId)`，将大区内包裹的所有节点和内部连线隐藏，替换为一个芯片化的 `SubgraphNode`，并在大区外保留与外部的连线。

---

### 3. 可执行开发步骤与验收标准 (Implementation Phases)

后续对 Reizo 进行 TapNow 升级时，建议分为三步，每步均可独立编译验收：

```
第一步 (1-2 天): Cinema Lab 镜头组与布光接入
 - 修改 shared/cameraMotion.ts 注入 CINE_LENS_PRESETS 与 LIGHTING_PRESETS
 - 扩充 CameraDial.tsx UI
 - 验证：在视频卡片选择 Arri+Cooke，点击运行，生成提示词带上好莱坞宽银幕 Prompt。

第二步 (1 天): 端口强校验与抽帧接力闭环
 - 在 CanvasPanel.tsx isValidConnection 实现强类型守卫
 - 增强 extractVideoFrame 顺接下游视频首帧
 - 验证：尝试把音频连到提示词端点被拦截，抽尾帧后自动挂入下个镜头的首帧。

第三步 (2 天): 角色图钉上下文注入与 Section 收折
 - 在视频生成执行链路中读取上游 AnchorNode 资产
 - SectionNode 增加折叠为 Subgraph
 - 验证：广播角色图钉到 3 个视频节点，所有镜头保持相同角色面部特征。
```

---

### 4. 自动化回归测试命令

开发过程中随时通过终端运行验证，保证零回归问题：

```powershell
# 1. 静态类型校验 (确保新扩展类型无报错)
npm run typecheck

# 2. 核心单元测试 (包含已有的 49 个测试套件)
npm run test:unit

# 3. 本地打包验证
npm run build
```
