# TapNow 创意画布全景工程落地规范
## 第 04 篇：交互逻辑与导演工作流规范 (Interaction & Workflow Logic)

> **版本**：v1.0.0  
> **面向对象**：前端交互工程师、画布逻辑开发、体验设计师  
> **核心目标**：详细规约画布的高级交互行为，包括上下文约束绑定、一键抽尾帧续拍、并排派生变体 ×4、端口类型强校验与撤销重做状态机。

---

### 1. 实体即上下文绑定机制 (Living Context Binding)

在 TapNow 中，连线不仅是画线，而是**传递活的上下文约束（Living Constraints）**：

```
┌────────────────────────┐
│ 📌 角色图钉: 林侦探     │
└───────────┬────────────┘
            │ 紫罗兰广播线 (Anchor Wire)
            ├─────────────────────────────────────────┐
            ▼                                         ▼
┌────────────────────────┐               ┌────────────────────────┐
│ 🎬 镜头 01: 远景推镜   │ ─抽尾帧接力──► │ 🎬 镜头 02: 面部特写   │
│ (输入: 角色特征注入)   │ (end_frame)   │ (输入: 尾帧插值+角色注入)│
└────────────────────────┘               └────────────────────────┘
```

#### 1.1 角色图钉广播机制 (Character Broadcast)
- 当用户从 [角色图钉节点] 的 `anchor_out` 端口拉出一条连线并接入某个 [视频节点] 或 [图片节点] 的 `ref_anchor` 时：
  - 前端视觉：连线呈现紫罗兰光晕（`#a78bfa`），目标节点顶部浮现角色的头像徽标（Avatar Badge）。
  - 后端执行：在组装底层生图/生视频任务时，自动加载该角色关联的面部资产向量、预置 LoRA 模型或三视图 Reference 图像列表，权重设定为图钉上配置的 `consistencyWeight`（默认 0.85）。

#### 1.2 首尾帧连续性接力机制 (Frame-to-Frame Continuity)
- 在多镜头叙事中，镜头与镜头之间的动作如果突变（如上一秒手在胸口，下一秒手在腰间），会产生严重的跳帧感。
- **TapNow 的接力交互流程**：
  1. 镜头 01 视频生成完毕。
  2. 用户在镜头 01 悬停工具栏中点击 **「✂️ 抽尾帧为新图片」**。
  3. 画布自动调用后端的抽帧工具（抽取最后一帧 100% 时间戳画面），并在当前节点右侧自动生成一个全新的 [关键帧图片节点]（`ImageNode`）。
  4. 系统自动从镜头 01 的 `end_frame` 端口拉出一道蓝紫色连线，直连该新图片节点的输入。
  5. 用户再从该新图片节点拉线至镜头 02 的 `start_frame`，底层模型（如 Kling 3.0 或 Seedance 2.0）自动以此帧作为起始关键帧（First Frame）进行运动演化生成，实现**完全无缝的动作衔接**。

---

### 2. 变体分支与 A/B 并排对比试拍 (Forking Variations ×4)

影视拍摄中，导演从来不会只拍一条，而是“拍三条保底”。TapNow 提供了原生的 **派生变体 ×4** 工业化能力：

```
                                      ┌────────────────────────┐
                                      │ 🎬 镜头 01 - 分支 A    │ (方案一: 快速推镜)
                                      └────────────────────────┘
┌────────────────────────┐            ┌────────────────────────┐
│ 🎬 镜头 01 (原始节点)  │ ─派生 ×4─► │ 🎬 镜头 01 - 分支 B    │ (方案二: 慢速摇镜)
└────────────────────────┘            └────────────────────────┘
                                      ┌────────────────────────┐
                                      │ 🎬 镜头 01 - 分支 C    │ (方案三: 荷兰角微俯)
                                      └────────────────────────┘
                                      ┌────────────────────────┐
                                      │ 🎬 镜头 01 - 分支 D    │ (方案四: 静止机位)
                                      └────────────────────────┘
```

#### 2.1 空间布局自动防遮挡算法 (Spatial Collision Avoidance)
当点击「派生变体 ×4」时，系统不得将新节点重叠放置，必须执行坐标计算：

```typescript
export function calculateForkPositions(
  sourceNode: { x: number; y: number; width: number; height: number },
  count: number = 4,
  gapX: number = 80,
  gapY: number = 30
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  const targetX = sourceNode.x + sourceNode.width + gapX;
  
  // 垂直居中对齐排布在原节点右侧
  const totalHeight = count * sourceNode.height + (count - 1) * gapY;
  const startY = sourceNode.y + sourceNode.height / 2 - totalHeight / 2;

  for (let i = 0; i < count; i++) {
    positions.push({
      x: targetX,
      y: startY + i * (sourceNode.height + gapY),
    });
  }

  return positions;
}
```

#### 2.2 变体继承原则
1. **上游连线无损克隆**：原节点接入的 `prompt_in`、`start_frame`、`audio_in`、`ref_anchor`，自动一对多克隆连接至 4 个新分支。
2. **随机种子（Seed）离散化**：4 个新分支的 `seed` 自动生成不同的随机数，或机位参数微调，确保生成 4 种不同质感的分镜。
3. **并发排队**：系统自动将 4 个节点推入并发队列，节点边框同时呈现脉冲高亮。
4. **优选回写**：用户回看 4 个生成结果后，选中最佳的一条（如分支 B），点击「设为主线」，其余 3 条自动变为未激活的暗淡色块，下游镜头自动对齐分支 B 的输出。

---

### 3. 端口连线兼容性矩阵与强校验 (Type Guard Matrix)

为了防止用户把视频流连入台词文本等非法操作，画布连线引擎在 `isValidConnection` 回调中必须执行严格的强类型校验：

| 源端口语义 (Source) | 目标端口语义 (Target) | 是否允许连接 | 交互反馈 |
| :--- | :--- | :--- | :--- |
| `prompt` (文本/提示词) | `prompt_in` (任何节点) | ✅ 允许 | 绿色高亮流光，吸附连线 |
| `image` (静态图片/关键帧) | `start_frame` (视频节点) | ✅ 允许 | 靛蓝色高亮流光 |
| `image` (静态图片) | `ref_anchor` (参考底图) | ✅ 允许 | 转换为参考风格图 |
| `video` (视频流) | `video_in` / 抽帧输入 | ✅ 允许 | 洋红色流光 |
| `audio` (音频轨) | `audio_in` (视频节点) | ✅ 允许 | 琥珀金色流光 |
| `anchor` (角色图钉) | `ref_anchor` (图/视频) | ✅ 允许 (支持广播) | 紫罗兰色高亮流光 |
| **其他非法跨类型连接** | **不匹配端口** | ❌ 严禁禁止 | 连线变红，光标显示 `not-allowed` 并抖动弹回 |

---

### 4. 撤销/重做状态机规范 (Undo/Redo State Machine)

所有可能改变画布拓扑的交互必须封装为**原子命令（Atomic Command）**并推入历史栈（容量设为 50 步）：

```typescript
export interface HistoryCommand {
  type: 
    | 'ADD_NODE' 
    | 'DELETE_NODES' 
    | 'MOVE_NODES' 
    | 'UPDATE_NODE_PARAMS' 
    | 'CONNECT_EDGE' 
    | 'REMOVE_EDGE' 
    | 'BATCH_FORK_NODES';
  timestamp: number;
  undo: () => void;
  redo: () => void;
}
```

- **位置移动节流**：在拖拽移动节点时，仅在鼠标松开（`onNodeDragStop`）瞬间记录一条包含（起始坐标 ➔ 终点坐标）的历史记录，严禁在拖拽过程中每帧录制。
- **批量删除原子化**：若用户框选 10 个节点并按下 `Delete` 键，必须记录为单个复合命令，按 `Ctrl + Z` 时 10 个节点及所有关联连线同步无损复原。

---

### 5. TapTV 社区配方与工作流无损克隆 (Pipeline Recipes & Remix)

TapNow 独有的 TapTV 生态支持创作者将整张画布打包为“配方（Recipe）”供他人克隆复用：

#### 5.1 工作流序列化 JSON 规范 (Recipe Packaging)

```json
{
  "$schema": "https://tapnow.ai/schemas/v1/recipe.json",
  "recipeId": "rcp_cyberpunk_chase_001",
  "title": "赛博朋克雨夜追车 5 分镜广告管线",
  "author": "Director_Alex",
  "version": "1.2.0",
  "meta": {
    "recommendedModels": ["kling-3.0", "flux-1.1-pro", "elevenlabs-v2"],
    "totalEstimatedSeconds": 15
  },
  "assetPlaceholders": [
    {
      "key": "HERO_CHARACTER",
      "label": "主角参考三视图",
      "required": true,
      "mappedToNodeId": "node_anchor_01"
    }
  ],
  "graph": {
    "nodes": [ /* 包含所有节点类型、相对坐标与 Cinema Lab 预设 */ ],
    "edges": [ /* 完整的拓扑连线数据 */ ]
  }
}
```

#### 5.2 Remix 克隆与占位符映射交互
1. 用户在 TapTV 社区看到满意的视频效果，点击 **「Remix 克隆到我的画布」**。
2. 画布弹出轻量向导弹窗：提示“该配方需要 1 张主角参考图”。
3. 用户上传自己的模特图后，画布瞬间展开完整的 5 镜头管线，所有机位角度、镜头预设、首尾帧抽帧链路全部就绪，点击“一键运行”即刻复刻同款大片。
