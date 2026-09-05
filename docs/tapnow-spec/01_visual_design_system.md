# TapNow 创意画布全景工程落地规范
## 第 01 篇：设计语言与视觉系统规范 (Visual & Design System)

> **版本**：v1.0.0  
> **面向对象**：UI/UX 设计师、前端组件开发者、Tailwind CSS / 样式工程师  
> **核心目标**：提供标准化的调色盘、几何排版、LOD 视口保护、语义连线与微质感样式代码，确保所有节点与画布控件具备工业级的一致性。

---

### 1. 暗色工作室美学设计原则 (Dark Studio Aesthetic)

TapNow 的界面之所以呈现专业调色台（如 DaVinci Resolve）的电影质感，遵循三大视觉铁律：

1. **绝对内容优先（Result-First）**：
   界面的主人是 AI 渲染出的高质量视觉成果（1080P 视频帧、高清图片、动态音频波形）。界面所有 UI 装饰（边框、按键、文字）必须采取**低对比度退后策略**，绝不喧宾夺主。
2. **纯粹暗调与微质感（Subtle Glass & Micro-Border）**：
   摒弃廉价的刺眼白色与大面积高饱和色彩，采用深冷灰底色搭配 1px 半透明内衬与微弱漫反射，消除长时间审片与连线导致的视觉疲劳。
3. **物理触感反馈（Tangible Physics）**：
   卡片悬浮、端口拉线、节点吸附均有严格的微动效阻尼（Spring Curve），带来如实体导播台一般的操控确信感。

---

### 2. 设计令牌与色彩系统 (Design Tokens & Color Palette)

#### 2.1 画布基底与表面色阶 (Surface Tokens)

| Token 名称 | 颜色值 (Hex / HSL) | Tailwind 映射 | 适用场景 |
| :--- | :--- | :--- | :--- |
| `canvas-bg` | `#0d0e12` (HSL 225, 17%, 6%) | `bg-neutral-950` / 自定义 | 主画布无限视口背景色 |
| `canvas-grid-dot` | `rgba(255, 255, 255, 0.05)` | - | 画布 16px/24px 极淡点阵参考网格 |
| `surface-raised` | `#16171d` (HSL 230, 14%, 10%) | `bg-paper-raised` | 普通节点卡片默认底色 |
| `surface-overlay` | `#1e2029` (HSL 230, 15%, 14%) | `bg-neutral-900` | 悬浮工具栏、右键菜单、下拉列表 |
| `surface-subtle` | `#232530` (HSL 230, 15%, 16%) | `bg-neutral-800/80` | 输入框背景、滑块轨道背景 |
| `border-subtle` | `rgba(255, 255, 255, 0.08)` | `border-white/10` | 节点默认边框（1px 内敛线） |
| `border-active` | `rgba(255, 255, 255, 0.22)` | `border-white/20` | 节点选中/悬停态高亮边框 |
| `text-primary` | `#f1f5f9` (Slate-100) | `text-slate-100` | 节点标题、核心指标、高亮按钮 |
| `text-muted` | `#94a3b8` (Slate-400) | `text-slate-400` | 参数标签、时间码、快捷键提示 |
| `text-faint` | `#64748b` (Slate-500) | `text-slate-500` | 空状态占位提示、字数计数器 |

#### 2.2 六大语义数据流分色体系 (Semantic Wire Tokens)

连线与端口必须严格按照数据流语义上色，禁止随意混用：

```
[Prompt 母本] ──── 翠绿 Emerald-400 (#4ade80) ────► [分镜提示词输入]
[关键帧图像]  ──── 靛蓝 Indigo-400 (#818cf8) ────► [视频首帧输入]
[镜头视频流]  ──── 洋红 Rose-500 (#f43f5e)   ────► [抽帧/最终拼接]
[音频配乐流]  ──── 琥珀 Amber-500 (#f59e0b)  ────► [视频配乐输入]
[角色风格图钉] ──── 紫罗兰 Purple-400 (#a78bfa) ───► [全镜头广播绑定]
[场景逻辑控制] ──── 冷灰 Slate-400 (#94a3b8)   ────► [大区分组/子图]
```

CSS 与 Tailwind 颜色配置参考：

```typescript
export const SEMANTIC_EDGE_COLORS = {
  prompt: {
    stroke: '#4ade80',
    glow: 'rgba(74, 222, 128, 0.35)',
    label: '提示词流 (Text/Prompt)',
  },
  image: {
    stroke: '#818cf8',
    glow: 'rgba(129, 140, 248, 0.35)',
    label: '关键帧图像 (Keyframe/Image)',
  },
  video: {
    stroke: '#f43f5e',
    glow: 'rgba(244, 63, 94, 0.35)',
    label: '视频流 (Video Stream)',
  },
  audio: {
    stroke: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.35)',
    label: '音频与旁白 (Audio Track)',
  },
  anchor: {
    stroke: '#a78bfa',
    glow: 'rgba(167, 139, 250, 0.35)',
    label: '角色图钉 (Character Anchor)',
  },
  control: {
    stroke: '#94a3b8',
    glow: 'rgba(148, 163, 184, 0.25)',
    label: '控制与子图 (Control/Flow)',
  },
} as const;
```

---

### 3. 节点卡片物理几何与微质感规范

所有节点在 React Flow / XYFlow 画布中必须遵循同一套几何律：

#### 3.1 基础几何尺寸 (Geometry Dimensions)
- **网格基准**：8px 网格（8 / 16 / 24 / 32）。
- **默认宽度**：
  - 媒体类卡片（视频、图片、音频）：标准宽 `320px`（宽银幕比例协调）。
  - 文本/大纲卡片：标准宽 `360px`。
  - 角色图钉卡片：紧凑宽 `240px`。
  - 场景大区（Section Frame）：自适应框选区域，最小 `480px × 360px`。
- **圆角规范**：
  - 外层容器：`rounded-xl` (`12px` / `0.75rem`)。
  - 内部媒体内容 Stage：`rounded-lg` (`8px` / `0.5rem`)。
  - 悬浮胶囊动作条：`rounded-full` (`9999px`)。
- **内边距 (Padding)**：卡片内衬固定统一为 `p-2.5` (`10px`)。

#### 3.2 质感层叠与 CSS 样式范式

```css
/* 标准节点外容器基础样式 */
.tapnow-node-container {
  position: relative;
  display: flex;
  flex-direction: column;
  background-color: rgba(22, 23, 29, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.5),
              inset 0 1px 0 0 rgba(255, 255, 255, 0.06);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  user-select: none;
}

/* 选中或悬停时的微光边界 */
.tapnow-node-container:hover,
.tapnow-node-container.selected {
  border-color: rgba(255, 255, 255, 0.22);
  box-shadow: 0 8px 30px -4px rgba(0, 0, 0, 0.7),
              0 0 0 1px rgba(255, 255, 255, 0.15),
              inset 0 1px 0 0 rgba(255, 255, 255, 0.12);
}

/* 执行中的呼吸辉光效果 (Running State) */
.tapnow-node-container.running {
  animation: node-pulse-glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes node-pulse-glow {
  0%, 100% {
    box-shadow: 0 0 15px -2px rgba(99, 102, 241, 0.4),
                0 0 0 1px rgba(99, 102, 241, 0.5);
  }
  50% {
    box-shadow: 0 0 25px 2px rgba(99, 102, 241, 0.7),
                0 0 0 1.5px rgba(129, 140, 248, 0.9);
  }
}
```

---

### 4. 动态层次细节缩放 (Level of Detail - LOD)

当一个长片或广告工作流包含 50~200 个节点时，若所有卡片都挂载复杂的 HTML5 Video 解码器或 Web Audio Canvas，浏览器主线程与 GPU 将迅速卡死。TapNow 采用三级空间语义降级机制：

```
                    ┌────────────────────────────┐
   Zoom > 75%       │  Level 1 (近景 - 全交互态)   │ 视频原地播放, 音频实时拖拽, 文本可编辑
                    └─────────────┬──────────────┘
                                  │ 缩放缩小 (Zoom Out)
                    ┌─────────────▼──────────────┐
  35% < Zoom <= 75% │  Level 2 (中景 - 静态性能态) │ 卸载 Video 播放器, 保持静态封面与静态波形
                    └─────────────┬──────────────┘
                                  │ 继续缩小 (Zoom Out)
                    ┌─────────────▼──────────────┐
   Zoom <= 35%      │  Level 3 (远景 - 胶囊微缩态) │ 纯色块胶囊, 仅显示类型图标与序号, 极限吞吐
                    └────────────────────────────┘
```

#### 4.1 各级别渲染行为对照表

| 缩放比例 (Zoom) | 渲染层级 | 视频节点行为 | 音频节点行为 | 交互可用性 | 目标 FPS |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Zoom > 0.75** | **Level 1 (近景)** | 原地挂载 `<video>`，悬停播放，支持进度条 | 挂载 Web Audio 交互波形，支持点击跳转试听 | 全部开放（内联改名、滑块调节、拖拽连接） | 60 FPS |
| **0.35 < Zoom <= 0.75** | **Level 2 (中景)** | 卸载 `<video>`，降级为 `<img>` 静态封面海报 | 卸载交互波形，降级为预生成的轻量静态 SVG 波形 | 仅保留拉线端点与整体拖动，点击弹出详情抽屉 | 60 FPS |
| **Zoom <= 0.35** | **Level 3 (远景)** | 隐藏所有媒体，卡片高度坍缩为 36px 色块胶囊 | 坍缩为 36px 音频色块胶囊 | 仅支持框选、批量移动、对齐和全图鸟瞰 | 60 FPS (稳如磐石) |

#### 4.2 React Flow 中基于 Hook 的 LOD 状态注入代码示例

```typescript
import { useViewport } from '@xyflow/react';

export function useNodeLOD() {
  const { zoom } = useViewport();
  
  if (zoom > 0.75) return 'high';   // 全功能交互
  if (zoom > 0.35) return 'medium'; // 静态媒体占位
  return 'low';                     // 胶囊极简骨架
}
```

---

### 5. 渐进式信息披露 (Progressive Disclosure)

TapNow 的核心交互精髓是“界面静默，悬停有灵”：

```
[默认静默态: Level 1] ──── 鼠标悬停 ────► [悬浮动作栏: Level 2] ──── 点击滑块 ────► [参数抽屉: Level 3]
 100% 呈现产物本身                        浮现派生/抽帧/Agent 胶囊                  右侧平滑滑出完整表单
```

1. **Level 1（默认静默态）**：
   - 节点顶部只显示：[节点类型图标] + [镜头标题] + [右侧状态小圆点（就绪/运行中）] + [细微滑块图标]。
   - 中间主体：100% 充满的高品质媒体（封面海报、静态图片、波形条）。
   - 底部：完全空白或仅在图片下方微显 1 行浅灰分镜描述。
2. **Level 2（悬浮意图 Hover-Intent）**：
   - 当鼠标 Hover 进入节点边界：
     - 节点顶部外侧 `-top-9` 处平滑淡入（Fade-in + Translate-y 2px）一颗悬浮动作胶囊栏（`NodeActionBar`）。
     - 底部浮现半透明的 Prompt 预览条与快速重新生成按钮。
3. **Level 3（配置展开 Settings Drawer）**：
   - 点击顶部右上角的滑块图标（Sliders），卡片右侧向外侧平滑抽屉式滑出（或主界面右侧侧边栏激活），展开完整的专业参数表单：
     - 完整 Prompt 多行编辑器与负向词。
     - 模型切换器（Kling 3.0 / Seedance 2.0 / Sora 2 Pro）。
     - 尺寸画幅选择（16:9 / 9:16 / 1:1）。
     - Cinema Lab 专业机位旋钮与光影调节器。
