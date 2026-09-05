# TapNow 创意画布全景工程落地规范
## 第 06 篇：Agentic 智能体编排系统规范 (Agentic Orchestration Architecture)

> **版本**：v1.0.0  
> **面向对象**：LLM 算法工程师、Agent 开发架构师、人机交互协同设计师  
> **核心目标**：定义画布专职 Agent 的自治编排能力，包括 Agent-in-the-Loop 双轨协同、画布底层 Tool-Calling 契约、剧本一键拆解为分镜管线以及“幽灵节点（Ghost Nodes）”确认交互机制。

---

### 1. 双轨协同架构：画布作为人机共享记忆 (Canvas as Shared Memory)

TapNow 的核心特色之一在于其原生的 **Agentic Workflow**。不同于传统仅在右侧弹出问答聊天框的弱 AI 插件，TapNow 的 Agent 将**画布本身作为其认知与行动的“外部工作记忆空间”**：

```
┌────────────────────────────────────────────────────────────────────────┐
│                        人类创作者 (Human Director)                      │
│        - 输入创意灵感与意图        - 审美把关与关键决策                  │
│        - 微调机位与运镜旋钮        - 挑选满意的分镜分支                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                       双向交互视窗  │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  共享工作区：AI 创意画布 (Creative Canvas)               │
│          [剧本卡] ──► [镜头 1] ──► [镜头 2] ──► [配乐轨] ──► [成片]      │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │
                       特权操作与感知│
                                    │
┌────────────────────────────────────────────────────────────────────────┐
│                     画布专职智能体 (TapNow Agent)                       │
│        - 自主分析剧本节拍          - 在画布上自动建点连线                │
│        - 自动注入专业镜头器材预设  - 异步调度底层模型流水线              │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 2. 画布 Agent 工具集契约 (Canvas Tool-Calling Schemas)

为了让大模型能够精准操作画布拓扑，必须向 Agent 提供标准化的 Tool-Calling 接口：

#### 2.1 工具定义与 JSON Schema

```typescript
export const CANVAS_AGENT_TOOLS = [
  {
    name: 'create_canvas_node',
    description: '在指定画布会话中创建一个新的实体节点（如文本、图片、视频、音频或角色图钉）',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '当前画布会话 ID' },
        type: { 
          type: 'string', 
          enum: ['text', 'image', 'video', 'audio', 'character_anchor', 'section_group'] 
        },
        position: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['x', 'y'],
        },
        params: {
          type: 'object',
          description: '节点的具体参数负载（提示词、模型类型、Cinema Lab 参数等）',
        },
      },
      required: ['sessionId', 'type', 'position', 'params'],
    },
  },
  {
    name: 'connect_canvas_edge',
    description: '在两个节点之间建立带有特定语义的连接线（如传递角色约束、尾帧接力或音频接入）',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        sourceNodeId: { type: 'string' },
        targetNodeId: { type: 'string' },
        sourceHandle: { type: 'string' },
        targetHandle: { type: 'string' },
        semantic: { 
          type: 'string', 
          enum: ['prompt', 'image', 'video', 'audio', 'anchor', 'control'] 
        },
      },
      required: ['sessionId', 'sourceNodeId', 'targetNodeId', 'sourceHandle', 'targetHandle'],
    },
  },
  {
    name: 'batch_generate_storyboard',
    description: '高阶原子工具：根据剧本文本，一次性在画布上排布完整的分镜节点链条并连线',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        startX: { type: 'number', default: 100 },
        startY: { type: 'number', default: 200 },
        shots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              shotNumber: { type: 'number' },
              title: { type: 'string' },
              prompt: { type: 'string' },
              cameraType: { type: 'string', enum: ['close_up', 'medium_shot', 'wide_shot', 'tracking'] },
              lensComboId: { type: 'string' },
              durationSeconds: { type: 'number', default: 5 },
            },
            required: ['shotNumber', 'title', 'prompt'],
          },
        },
      },
      required: ['sessionId', 'shots'],
    },
  },
];
```

---

### 3. 一键剧本转分镜执行时序 (Script-to-Storyboard Pipeline)

当用户说：“*请帮我把这段赛博朋克追车戏拆解为 4 个镜头的视频分镜*”时，Agent 的执行流程如下：

```
1. 剧本理解与视听语言拆解 (LLM Prompt Pipeline)
   - 提取角色主体、环境设定、光影基调、动作时序
   - 规划景别推进：[特写] ➔ [中景] ➔ [全景大场面] ➔ [终结特写]
   - 为每个镜头分配最优的 Cinema Lab 机位运镜与镜头器材组合
   
2. 画布空间化拓扑排布规划
   - 自动在画布 (x: 100, y: 150) 放置 1 个母本剧本文本节点
   - 在 (x: 520, y: 150) 水平并列排布 4 个视频镜头节点（间距 dx = 380px）
   - 在底部放置 1 个音频背景配乐节点
   
3. 拓扑约束连线自动闭环
   - 剧本文本节点.prompt_out ──► 镜头 01.prompt_in
   - 镜头 01.end_frame ──────► 镜头 02.start_frame (尾帧接力)
   - 镜头 02.end_frame ──────► 镜头 03.start_frame (尾帧接力)
   - 音频节点.audio_out ──────► 镜头 01 / 02 / 03 / 04.audio_in
```

---

### 4. 幽灵预览节点与人机确认机制 (Ghost Nodes & Plan Confirmation)

为了防止 Agent 一下子在画布上盲目生成 20 个节点破坏用户原有的排版，TapNow 引入了**“幽灵态节点（Ghost Nodes）”**机制：

```
┌────────────────────────────────────────────────────────────┐
│ 👻 幽灵分镜 01: 暴雨霓虹巷道 (虚线边框，半透明 60%)         │
│ (这是 Agent 规划的候选节点，尚未真实写入底层数据库)          │
├────────────────────────────────────────────────────────────┤
│ 提示词: "俯拍特写，雨夜积水倒映霓虹招牌，跑车车轮急速滑过..." │
├────────────────────────────────────────────────────────────┤
│ [ ✅ 确认应用到画布 ]               [ ✕ 放弃此方案 ]         │
└────────────────────────────────────────────────────────────┘
```

1. **投射状态（Draft Projection）**：
   - Agent 调用建议时，前端画布以 `opacity: 0.6`、`border: 1px dashed #818cf8` 的半透明幽灵状态渲染这些候选节点与虚拟虚线连线。
2. **审查与微调**：
   - 用户可以在画布上直接拖拽幽灵节点调整坐标位置，或双击修改里面的提示词。
3. **固化提交（Materialize）**：
   - 用户在工具条点击 **「确认应用到画布（Apply）」**：
   - 前端触发批量写入 API，幽灵节点转为实体数据库节点，边框恢复实线微质感，调度引擎自动开始排队生成。
