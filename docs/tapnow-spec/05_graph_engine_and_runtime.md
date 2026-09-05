# TapNow 创意画布全景工程落地规范
## 第 05 篇：执行图引擎与调度架构规范 (Graph Engine & Runtime)

> **版本**：v1.0.0  
> **面向对象**：后端开发工程师、调度引擎架构师、分布式任务队列开发  
> **核心目标**：规定画布底层的有向无环图（DAG）拓扑调度算法、增量缓存与脏状态追踪、多模型异步流水线及 SSE 双向实时事件协议。

---

### 1. 核心调度模型：分层波次拓扑调度 (Wave-based DAG Scheduling)

画布在底层是一个典型的有向无环图（Directed Acyclic Graph, DAG）。当用户触发“整图执行”或“从选中节点向下执行”时，调度引擎必须保证**依赖节点已完成，且能最大化并发执行同级互不依赖的节点**。

```
[Wave 0 (基础输入层)]        [Wave 1 (初级生成层)]         [Wave 2 (合成与接力层)]
┌──────────────────┐
│ 剧本节点 (Text)   │ ──────┬────────────────────────► ┌──────────────────┐
└──────────────────┘       │                          │ 镜头 01 (Video)   │
                           ▼                          └────────┬─────────┘
┌──────────────────┐ ┌──────────────────┐                      │
│ 角色图钉 (Anchor) │─►│ 关键帧图片 (Image)│ ─────────────────────┼─────────► [Wave 3]
└──────────────────┘ └──────────────────┘                      ▼           ┌─────────────┐
                                                      ┌──────────────────┐ │ 镜头 02     │
┌──────────────────┐                                  │ 尾帧抽取图片 (End)│─►│ (连续性视频)│
│ 音频节点 (Audio)  │ ────────────────────────────────► └──────────────────┘ └─────────────┘
└──────────────────┘                                            │
                                                                ▼
                                                      ┌──────────────────┐
                                                      │ 音视频合成 (Mux)  │
                                                      └──────────────────┘
```

#### 1.1 Kahn 算法波次划分实现 (TypeScript 后端调度器)

```typescript
export interface GraphNode {
  id: string;
  type: string;
  paramsHash: string;
  dirty: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
}

export function computeExecutionWaves(
  nodes: GraphNode[],
  edges: GraphEdge[],
  startNodeIds?: string[]
): string[][] {
  const inDegree: Map<string, number> = new Map();
  const adjacencyList: Map<string, string[]> = new Map();

  // 初始化图结构
  nodes.forEach(n => {
    inDegree.set(n.id, 0);
    adjacencyList.set(n.id, []);
  });

  edges.forEach(e => {
    adjacencyList.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
  });

  // 如果指定了起点（从此处向下执行），剪枝上游
  let currentWave: string[] = [];
  if (startNodeIds && startNodeIds.length > 0) {
    currentWave = [...startNodeIds];
  } else {
    // 找出所有入度为 0 的根节点作为 Wave 0
    inDegree.forEach((deg, nodeId) => {
      if (deg === 0) currentWave.push(nodeId);
    });
  }

  const waves: string[][] = [];

  while (currentWave.length > 0) {
    waves.push(currentWave);
    const nextWave: string[] = [];

    for (const nodeId of currentWave) {
      const neighbors = adjacencyList.get(nodeId) || [];
      for (const neighbor of neighbors) {
        const remainingInDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, remainingInDegree);
        if (remainingInDegree === 0) {
          nextWave.push(neighbor);
        }
      }
    }

    currentWave = nextWave;
  }

  return waves;
}
```

---

### 2. 节点级哈希缓存与脏状态追踪 (Dirty State & Cache)

AI 视听生成成本极高（显存与时间开销大）。TapNow 遵循**“上游未变且自身未改，绝不重复计算”**原则：

#### 2.1 节点参数指纹计算 (paramsHash)

```typescript
import { createHash } from 'crypto';

export function calculateNodeHash(
  nodeParams: Record<string, unknown>,
  upstreamOutputs: Record<string, string> // 上游端口传入的数据指纹
): string {
  const payload = JSON.stringify({
    params: nodeParams,
    upstream: upstreamOutputs,
  });
  return createHash('sha256').update(payload).digest('hex');
}
```

- **脏状态判定（Dirty Check）**：
  - 当节点自身被修改（如修改了提示词、调节了机位滑块）时，标记 `dirty = true`。
  - 当其上游节点的产物发生改变时，级联将其所有下游节点的 `dirty` 自动置为 `true`。
  - 在执行调度时，若检测到 `node.dirty === false` 且数据库中已存在对应 `paramsHash` 的渲染成果物，**直接跳过执行（Cache Hit），复用旧资产**，耗时 0 秒。

---

### 3. 双向实时事件推送协议 (SSE / WebSocket Protocol)

由于视频生成往往需要 10~60 秒，前后端必须基于 Server-Sent Events (SSE) 或 WebSocket 维持长连接通信，以毫秒级粒度向前端画布同步进度与状态：

#### 3.1 标准事件契约 (Event Schema)

```typescript
export type CanvasServerEvent =
  | {
      event: 'node:queued';
      data: { sessionId: string; nodeId: string; queuePosition: number };
    }
  | {
      event: 'node:running';
      data: { sessionId: string; nodeId: string; startTime: number };
    }
  | {
      event: 'node:progress';
      data: {
        sessionId: string;
        nodeId: string;
        progress: number; // 0 ~ 100
        statusText: string; // 如 "正在进行扩散渲染 (Step 18/30)"
      };
    }
  | {
      event: 'node:completed';
      data: {
        sessionId: string;
        nodeId: string;
        durationMs: number;
        outputAssets: {
          videoUrl?: string;
          previewCoverUrl?: string;
          extractedEndFrameUrl?: string;
          waveformSamples?: number[];
        };
      };
    }
  | {
      event: 'node:failed';
      data: {
        sessionId: string;
        nodeId: string;
        errorCode: string;
        errorMessage: string;
        recoverable: boolean;
      };
    };
```

#### 3.2 前端实时高亮响应规范
- 收到 `node:running`：当前节点边框触发蓝色脉冲辉光（`node-pulse-glow`），标题右侧小绿点变为旋转微图标。
- 收到 `node:progress`：节点 Stage 底部微小进度细条按实际 `progress` 填充满。
- 收到 `node:completed`：边框闪烁一次绿色成功指示光（Duration 0.3s），自动无缝加载视频封面或多媒体元素，激活下游连接端口。
- 收到 `node:failed`：边框变红（`border-rose-500/50`），右上角弹出重试动作按钮（Retry）。

---

### 4. 任务容错与自愈策略 (Resilience & Failover)

1. **上游节点异常隔离**：若某个分镜节点因敏感词或显存溢出失败，调度器仅中断该节点所在分支的后续节点，其他并行的分镜分支不受任何影响，继续执行完毕。
2. **断线重连状态对齐**：当用户刷新浏览器页面时，前端通过 `/api/canvas/sessions/:id/sync` 接口一次性全量拉取当前拓扑图各节点的实时状态，自动恢复进行中的轮询监听。
