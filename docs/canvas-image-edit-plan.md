# 画布图片节点 · 快捷编辑操作 — 完整实现规划

> 目标:上传/生成后的图片节点悬浮出现一条编辑工具条(裁剪 / 多角度 / 重绘 / 打光 / 扩图 / 擦除 / 标注 / 增强 / 抠图 / 调整像素 / 快速切分)。
> 每个编辑操作 **在画布上派生一个新的 `image` 节点**,并从源节点连一条边过去;新节点携带 `params.edit` 描述这次编辑。模型类编辑复用现有 `runImageNode`(prompt + 调 `v2api.top` 图片模型),本地类编辑在渲染层用 `<canvas>` 算像素后走已有的 asset 上传接口。
>
> 本文件是自包含的执行说明。执行者不需要额外对话上下文。

---

## 0. 背景与关键事实(动手前必读)

代码库:Electron Forge + Vite + React 19,三个构建面(main / preload / renderer)。画布相关:

| 关注点 | 位置 |
|---|---|
| 画布 DTO / 节点类型 | `src/shared/canvas.ts` |
| 图片节点组件 | `src/renderer/components/canvas/ImageNode.tsx` |
| 悬浮工具条(通用样式) | `src/renderer/components/canvas/NodeActionBar.tsx` |
| 生成参数面板 | `src/renderer/components/canvas/NodeFloatingPanel.tsx` |
| 渲染层画布状态 + 动作 | `src/renderer/state/canvasStore.ts` |
| 渲染层 HTTP 客户端 | `src/renderer/api.ts` |
| 服务端画布路由(Hono) | `src/main/server/routes/canvas.ts` |
| 图片节点执行器 | `src/main/server/canvas/imageExecutor.ts` |
| 节点就绪检查(纯函数) | `src/shared/canvasReadiness.ts` |
| 计价(纯函数) | `src/shared/canvasPricing.ts` |
| 资源 URL hook | `src/renderer/components/canvas/useAssetUrl.ts` |

已确认的事实:

1. **图片节点只有一种类型** `type: 'image'`。"空节点"与"已上传节点"是同一个节点,区别只是 `node.output.assets` 是否有内容。
2. `runImageNode` 已支持图生图:`generateImage({ model, prompt: { text, images }, size })`。编辑操作本质就是"源图 + 指令 prompt",**不需要独立的 inpaint 接口**。
3. 默认后端 `https://v2api.top/v1`(new-api 网关,与网页 Studio 同后端),走指令式图像编辑模型。
4. `ImageNode.tsx` 已有**变体切换器**(`output.assets[]` + `output.activeAssetIndex`)——仅用于同一节点内的多次生成结果;本方案**不往这里塞编辑结果**,编辑结果永远是新节点。
5. 项目**没有** `sharp` / `jimp` / `cropper` 等依赖。本方案**不新增原生依赖**,本地像素操作全部在渲染层 `<canvas>` 完成。
6. `POST /:canvasId/nodes/:id/run` 路由已按 `node.type` 分派;`image` 类型进 `runImageNode`。所以编辑节点只需在 `runImageNode` 内部按 `params.edit` 分支,**不需要新路由跑生成**。
7. `POST /:canvasId/nodes/:id/asset`(客户端方法 `api.setCanvasNodeAsset`)会把节点 `output.assets` 替换为**单个**上传文件并置 `runState:'done'` —— 正好用于本地编辑结果落盘。
8. 计费闸:模型类运行要求 body `confirmedSpend: true`(渲染层 `runNode` 已带)。
9. `canvasStore.addNodeAndConnect(sessionId, spec, sourceId, sourceHandle, targetHandle)` 一次性建节点 + 连边 + 注册一条 undo 记录 —— 直接用它派生编辑节点。
10. 悬浮 UI(header / action bar / floating panel)都做**反缩放补偿** `scale(1/zoom)`,新写的 overlay 也要遵循(见 §5.3)。
11. `originGuard`(`src/main/server/app.ts`)限制跨源;新增路由挂在既有 `router` 上即可,无需动 CORS。
12. 服务端 `POST /nodes` 与 `PATCH /nodes/:id` 对 `params` **不做字段白名单**,`edit` 字段可直接透传。
13. 图片节点的磁吸 handle id:输出 `image_out`(右,source),输入 `prompt`(左,target)。本方案**新增**输入 handle `edit_src`(见 §3.4)。

---

## 1. 操作清单与分类

| kind | 中文名 | 类别 | 交互采集 | 结果来源 |
|---|---|---|---|---|
| `crop` | 裁剪 | 本地 | `CropOverlay` 拖拽框 + 宽高比预设 | 渲染层 canvas 裁剪 → 上传 |
| `resize` | 调整像素 | 本地 | 小面板:目标宽高 / 预设倍率 | 渲染层 canvas 缩放 → 上传 |
| `annotate` | 标注 | 本地 | `AnnotateOverlay` 画笔/形状/文字 | 渲染层 canvas 合成 → 上传 |
| `split` | 快速切分 | 本地 | 小面板:2×2 / 3×3 / 4×4 | 渲染层切成 N 块 → 建 N 个节点(见 §6.4) |
| `multiAngle` | 多角度 | 模型 | `MultiAnglePanel` 旋转/倾斜/缩放/广角 | `runImageNode` edit 分支 |
| `inpaint` | 重绘 | 模型 | `MaskOverlay`(画笔/矩形/橡皮/套索)+ prompt | edit 分支 + 蒙版图 |
| `erase` | 擦除 | 模型 | `MaskOverlay`(无 prompt,指令固定) | edit 分支 + 蒙版图 |
| `relight` | 打光 | 模型 | `RelightPanel` 亮度/色温/主光方向/轮廓光 | edit 分支 |
| `outpaint` | 扩图 | 模型 | `OutpaintOverlay` 向外拖框 + 填充比例 | edit 分支 + 扩边蒙版图 |
| `enhance` | 增强 | 模型 | 小面板:放大倍率 / 强度 | edit 分支 |
| `matting` | 抠图 | 模型 | 无(直接执行) | edit 分支(输出带透明通道) |

---

## 2. 共享类型 —— 新增 `src/shared/canvasImageEdit.ts`

```ts
import type { CanvasNode } from './canvas';

export type ImageEditKind =
  | 'crop' | 'resize' | 'annotate' | 'split'
  | 'multiAngle' | 'inpaint' | 'erase' | 'relight'
  | 'outpaint' | 'enhance' | 'matting';

/** 挂在派生 image 节点 params.edit 上的编辑描述符。 */
export interface ImageEditSpec {
  kind: ImageEditKind;
  /** 源图节点 id(用于追溯,执行器优先按 edit_src 边解析,这里冗余存一份)。 */
  sourceNodeId: string;
  /** 已上传到本节点资源目录的蒙版 PNG 的 rel 路径(inpaint/erase/outpaint)。白=作用区。 */
  maskAsset?: string;
  /** 归一化裁剪矩形 0..1(crop;本地已裁,仅留痕)。 */
  cropRect?: { x: number; y: number; w: number; h: number };
  /** 结构化参数,按 kind 取用。 */
  params?: ImageEditParams;
  /** 用户自由文本(inpaint 主要用)。 */
  instruction?: string;
}

export interface ImageEditParams {
  // multiAngle
  rotateDeg?: number;   // -180..180
  tiltDeg?: number;     // -90..90
  zoom?: number;        // -10..10
  wideAngle?: boolean;
  // relight
  brightness?: number;  // 0..100 (%)
  colorTempK?: number;  // 2000..10000
  lightDir?: 'left' | 'top' | 'right' | 'front' | 'bottom' | 'back';
  rimLight?: boolean;
  // outpaint
  pad?: { left: number; right: number; top: number; bottom: number }; // 归一化,相对原图边长
  // enhance
  scale?: 2 | 4;
  strength?: number;    // 0..100
  // resize (本地,不进模型)
  targetW?: number;
  targetH?: number;
  // split (本地)
  grid?: '2x2' | '3x3' | '4x4';
}

export const EDIT_META: Record<ImageEditKind, {
  label: string;
  /** lucide 图标名,渲染层按名映射。 */
  icon: string;
  local: boolean;
  needsMask: boolean;
  needsCrop: boolean;
  /** 是否在悬浮工具条一级可见(其余进「更多」菜单)。 */
  primary: boolean;
}> = {
  crop:       { label: '裁剪',     icon: 'Crop',        local: true,  needsMask: false, needsCrop: true,  primary: true },
  multiAngle: { label: '多角度',   icon: 'Box',         local: false, needsMask: false, needsCrop: false, primary: true },
  inpaint:    { label: '重绘',     icon: 'Brush',       local: false, needsMask: true,  needsCrop: false, primary: true },
  relight:    { label: '打光',     icon: 'Lightbulb',   local: false, needsMask: false, needsCrop: false, primary: true },
  outpaint:   { label: '扩图',     icon: 'Expand',      local: false, needsMask: true,  needsCrop: false, primary: false },
  erase:      { label: '擦除',     icon: 'Eraser',      local: false, needsMask: true,  needsCrop: false, primary: false },
  annotate:   { label: '标注',     icon: 'PenLine',     local: true,  needsMask: false, needsCrop: false, primary: false },
  enhance:    { label: '增强',     icon: 'Sparkles',    local: false, needsMask: false, needsCrop: false, primary: false },
  resize:     { label: '调整像素', icon: 'Ruler',       local: true,  needsMask: false, needsCrop: false, primary: false },
  matting:    { label: '抠图',     icon: 'Scissors',    local: false, needsMask: false, needsCrop: false, primary: false },
  split:      { label: '快速切分', icon: 'Grid3x3',     local: true,  needsMask: false, needsCrop: false, primary: false },
};

export function isLocalEdit(kind: ImageEditKind): boolean {
  return EDIT_META[kind].local;
}

/**
 * 结构化参数 → 中文模型指令。纯函数,单测覆盖每个 kind。
 * 约定:模型收到 images = [源图, (可选)蒙版图],指令里显式说明蒙版语义。
 */
export function buildEditPrompt(spec: ImageEditSpec): string {
  const p = spec.params ?? {};
  const maskNote = spec.maskAsset
    ? '第二张图是蒙版:仅修改蒙版中白色区域,黑色区域必须与原图逐像素一致。'
    : '';
  switch (spec.kind) {
    case 'multiAngle': {
      const bits: string[] = [];
      if (p.rotateDeg) bits.push(`水平旋转视角约 ${p.rotateDeg} 度`);
      if (p.tiltDeg) bits.push(`俯仰倾斜约 ${p.tiltDeg} 度`);
      if (p.zoom) bits.push(p.zoom > 0 ? `镜头推近 ${p.zoom} 档` : `镜头拉远 ${-p.zoom} 档`);
      if (p.wideAngle) bits.push('使用广角镜头畸变');
      return `保持主体与材质不变,重新渲染为新的相机视角:${bits.join('、') || '轻微换一个角度'}。保留原有光照与风格,背景合理补全。`;
    }
    case 'inpaint':
      return `${maskNote}在蒙版区域内按以下描述重绘:${spec.instruction || '与周围环境自然融合的内容'}。边缘平滑过渡,无接缝。`;
    case 'erase':
      return `${maskNote}移除蒙版区域内的物体,用符合周围环境的背景无痕填充,不要留下痕迹或阴影残留。`;
    case 'relight': {
      const dir = ({ left: '左侧', top: '顶部', right: '右侧', front: '正前方', bottom: '底部', back: '背后' } as const)[p.lightDir ?? 'front'];
      const bits = [`主光来自${dir}`];
      if (typeof p.brightness === 'number') bits.push(`整体亮度约 ${p.brightness}%`);
      if (typeof p.colorTempK === 'number') bits.push(`色温约 ${p.colorTempK}K`);
      if (p.rimLight) bits.push('加入轮廓光勾勒主体边缘');
      return `在不改变主体形状、构图与内容的前提下重新打光:${bits.join('、')}。阴影方向与强度需与新光源一致,保持照片级真实感。`;
    }
    case 'outpaint':
      return `${maskNote}向画面外扩展构图,在蒙版(新增边缘)区域内延续原图的场景、透视与风格,自然衔接,不改变原有区域。`;
    case 'enhance':
      return `提升清晰度与细节,放大约 ${p.scale ?? 2} 倍,${(p.strength ?? 50) > 60 ? '较强' : '适度'}锐化与去噪,不改变内容、构图与色调。`;
    case 'matting':
      return `精确抠出主体,移除背景并输出透明背景(alpha 通道)。发丝、边缘保留细节,不带白边。`;
    default:
      return spec.instruction || '按描述编辑图片。';
  }
}

/** 派生节点标题。 */
export function editNodeTitle(kind: ImageEditKind): string {
  return EDIT_META[kind].label;
}

/** 就绪检查用:该 edit 节点当前能否运行。 */
export function editReadiness(node: CanvasNode, hasUpstreamImage: boolean): string[] {
  const edit = (node.params as { edit?: ImageEditSpec }).edit;
  if (!edit) return [];
  const issues: string[] = [];
  if (!hasUpstreamImage) issues.push('缺少源图输入');
  if (EDIT_META[edit.kind].needsMask && !edit.maskAsset) issues.push('尚未绘制蒙版');
  if (edit.kind === 'inpaint' && !edit.instruction?.trim()) issues.push('重绘描述为空');
  return issues;
}
```

**新增测试 `src/shared/canvasImageEdit.test.ts`**:对 `buildEditPrompt` 每个 kind 断言关键词;对 `editReadiness` 覆盖「无源图 / 无蒙版 / 无描述 / 就绪」四态;`isLocalEdit` 对照 `EDIT_META`。

---

## 3. 数据模型改动

### 3.1 `src/shared/canvas.ts`

```ts
import type { ImageEditSpec } from './canvasImageEdit';

export interface CanvasImageParams {
  prompt: string;
  size: '1024x1024' | '1024x1536' | '1536x1024';
  model?: string;
  count?: 1 | 2 | 4;
  /** 存在时,本节点是一次「编辑派生」节点,由 runImageNode 的 edit 分支处理。 */
  edit?: ImageEditSpec;
}
```

`CanvasNodeParams` 联合类型无需改(`CanvasImageParams` 已在内)。`defaultNodeBox('image')` 保持 `{ w: 320, h: 380 }`。

### 3.2 `src/shared/canvasReadiness.ts`

在 `nodeReadinessIssues` 里,`image` 分支开头插入:

```ts
const edit = (params as { edit?: import('./canvasImageEdit').ImageEditSpec }).edit;
if (node.type === 'image' && edit) {
  const hasUpstreamImage = edges.some((e) => {
    if (e.targetId !== node.id) return false;
    const src = nodesById.get(e.sourceId);
    return (e.targetHandle === 'edit_src' || src?.type === 'image' || src?.type === 'video')
      && (src?.output?.assets?.length ?? 0) > 0;
  });
  return editReadiness(node, hasUpstreamImage); // 直接返回,跳过 prompt 为空等常规检查
}
```

(`import { editReadiness } from './canvasImageEdit';` 置顶。)

### 3.3 `src/shared/canvasPricing.ts`

`estimateNodeCost` 对带 `edit` 的 image 节点:本地类(`isLocalEdit`)返回 `0`;模型类沿用现有 image 估价(必要时 `enhance` × 1.5,可后置)。加一条对应单测。

### 3.4 新输入 handle `edit_src`

`ImageNode.tsx` 里,当 `params.edit` 存在时,额外渲染一个 `MagneticHandle`:

```tsx
{params.edit ? (
  <MagneticHandle
    type="target" position={Position.Left} id="edit_src"
    nodeId={node.id} kind="image" label="源图" top="28%"
    nodeHovered={hovered || selected}
  />
) : null}
```

派生边统一用 `sourceHandle="image_out"` → `targetHandle="edit_src"`。

---

## 4. 服务端

### 4.1 `src/main/server/canvas/imageExecutor.ts` — `runImageNode` 增加 edit 分支

在解析 `params` 之后、组织 `rawPrompt` 之前插入:

```ts
const edit = (params as CanvasImageParams).edit;
if (edit) {
  // 1) 指令 prompt
  rawPrompt = buildEditPrompt(edit);

  // 2) 源图:优先 edit_src 边,退回任意上游 image/video 的 activeAsset
  const snap = canvasStore.getSnapshot(canvasId);
  const srcEdge = snap?.edges.find((e) => e.targetId === node.id && e.targetHandle === 'edit_src');
  const srcNode =
    (srcEdge && snap?.nodes.find((n) => n.id === srcEdge.sourceId)) ||
    canvasStore.upstreamNodes(canvasId, node.id).find((u) => (u.output?.assets?.length ?? 0) > 0);
  if (!srcNode?.output?.assets?.length) {
    fail('编辑节点缺少源图输入');
    return;
  }
  const srcAssets = srcNode.output.assets;
  const srcRel = srcAssets[srcNode.output.activeAssetIndex ?? 0] ?? srcAssets[0];

  const imgs: Uint8Array[] = [new Uint8Array(await readCanvasAsset(dataRoot, srcRel))];
  if (edit.maskAsset) {
    try { imgs.push(new Uint8Array(await readCanvasAsset(dataRoot, edit.maskAsset))); } catch { /* ignore */ }
  }

  // 3) 直接走生成,跳过 anchor/mention/upstream 逻辑
  const { provider, modelId, size } = await resolveImageProvider(/* 抽出下方公共逻辑 */);
  const result = await generateImage({ model: provider.image(modelId), prompt: { text: rawPrompt, images: imgs }, size });
  await writeAssetsAndBroadcast(result /* 复用现有写盘 + node_output 广播段 */);
  return;
}
```

实现要点:
- 把现有函数中「解析 provider / apiKey / baseUrl / modelId」与「写盘 + `node_output` 广播 + `broadcastDownstreamDirty`」两段抽成局部 helper,edit 分支与常规分支共用,避免复制。
- `size`:编辑节点取源图尺寸最接近的合法枚举(读不到就用源节点 `params.size` 或 `'1024x1024'`)。`matting` 输出需保留 PNG alpha —— `writeFile` 时若 `image.mediaType` 非 png 也强制 `.png`。
- `edit.cropRect` 服务端忽略(本地已裁)。
- 失败路径复用现有 `fail(...)`。

### 4.2 `src/main/server/routes/canvas.ts` — 新增蒙版上传路由

紧邻 `POST /:canvasId/nodes/:id/asset` 增加:

```ts
router.post('/:canvasId/nodes/:id/mask', async (c) => {
  const canvasId = c.req.param('canvasId');
  const id = c.req.param('id');
  if (!canvasStore.getNode(canvasId, id)) return c.json({ error: 'Node not found' }, 404);
  const body = await c.req.json().catch((): null => null);
  if (!body || typeof body.dataBase64 !== 'string') return c.json({ error: 'dataBase64 is required' }, 400);
  const bytes = Buffer.from(body.dataBase64, 'base64');
  const dir = canvasAssetsDir(dataRoot, canvasId);
  await mkdir(dir, { recursive: true });
  const file = `${id}-mask-${nanoid(6)}.png`;
  await writeFile(path.join(dir, file), bytes);
  return c.json({ maskAsset: `${canvasId}/${file}` }, 201);   // 不改节点,不广播
});
```

`run` 路由**不需要改**——`node.type === 'image'` 已进 `runImageNode`,edit 分支在里面。

### 4.3 服务端测试(`npm run test:api` / vitest)

- `src/main/server/canvas/imageExecutor.test.ts`(若不存在则新建):mock provider 的 `generateImage`,构造「源图节点 + edit 节点 + edit_src 边」,断言:
  - `runImageNode` 对 edit 节点用 `buildEditPrompt` 的产物作为 `prompt.text`;
  - `images[0]` 为源图字节,`edit.maskAsset` 存在时 `images[1]` 为蒙版字节;
  - 成功后 `node.output.assets` 有一张、`runState:'done'`、发出 `node_output` 广播;
  - 无源图时 `runState:'error'`。
- 新 `/mask` 路由:POST 合法 base64 → 201 且返回 `maskAsset` 形如 `<canvasId>/<id>-mask-*.png`;缺字段 → 400。

---

## 5. 渲染层

### 5.1 `src/renderer/api.ts`

```ts
export async function uploadCanvasNodeMask(canvasId: string, nodeId: string, dataBase64: string): Promise<{ maskAsset: string }> {
  const res = await api(`/api/canvas/${canvasId}/nodes/${nodeId}/mask`, {
    method: 'POST', body: JSON.stringify({ dataBase64 }),
  });
  return res as { maskAsset: string };
}
```

(`setCanvasNodeAsset` / `addCanvasNode` / `addCanvasEdge` / `runCanvasNode` 已存在,复用。)

### 5.2 `src/renderer/state/canvasStore.ts` — 核心动作

```ts
import {
  type ImageEditSpec, type ImageEditKind, isLocalEdit, editNodeTitle, EDIT_META,
} from '../../shared/canvasImageEdit';

const EDIT_NODE_GAP = 80; // 源节点右侧留白

/**
 * 从源图节点派生一次编辑:建新 image 节点 + edge(image_out → edit_src),
 * 本地类在客户端算像素并上传;模型类上传蒙版(若有)后 runNode。
 * localResultBlob: 本地类必传,已算好的结果 PNG。
 */
export async function deriveImageEdit(
  sessionId: string,
  sourceNodeId: string,
  spec: Omit<ImageEditSpec, 'sourceNodeId'>,
  opts?: { localResultBlob?: Blob; maskBlob?: Blob },
): Promise<string | null> {
  const src = nodeById(sessionId, sourceNodeId);
  if (!src) return null;
  const at = { x: src.x + src.w + EDIT_NODE_GAP, y: src.y };
  const fullSpec: ImageEditSpec = { ...spec, sourceNodeId };

  const newId = await addNodeAndConnect(
    sessionId,
    {
      type: 'image', x: at.x, y: at.y,
      title: editNodeTitle(spec.kind),
      params: { prompt: '', size: (src.params as CanvasImageParams).size ?? '1024x1024', edit: fullSpec },
    },
    sourceNodeId, 'image_out', 'edit_src',
  );
  if (!newId) return null;

  if (isLocalEdit(spec.kind)) {
    if (opts?.localResultBlob) {
      await uploadAssetToNode(sessionId, newId, new File([opts.localResultBlob], `${spec.kind}.png`, { type: 'image/png' }));
    }
    return newId;
  }

  // 模型类
  if (EDIT_META[spec.kind].needsMask && opts?.maskBlob) {
    const cid = canvasId(sessionId);
    if (cid) {
      const b64 = await blobToBase64(opts.maskBlob);
      const { maskAsset } = await api.uploadCanvasNodeMask(cid, newId, b64);
      await updateNodeParams(sessionId, newId, {
        ...(nodeById(sessionId, newId)!.params as CanvasImageParams),
        edit: { ...fullSpec, maskAsset },
      });
    }
  }
  await runNode(sessionId, newId);
  return newId;
}

/** 快速切分:源图切成 N 块,每块建一个 image 节点。 */
export async function deriveImageSplit(
  sessionId: string, sourceNodeId: string, grid: '2x2' | '3x3' | '4x4', tiles: Blob[],
): Promise<void> { /* 循环 addNodeAndConnect + uploadAssetToNode;网格定位;一条 history 记录包起来 */ }
```

`blobToBase64` 放 `src/renderer/lib/`(chunked,避免大图爆栈,可参考 `importWorkflow` 里的分块写法)。

### 5.3 Overlay 通用规范

- 用 `createPortal` 挂到画布容器;半透明遮罩压暗背景(参考 `Lightbox.tsx`)。
- 目标图按节点在视口的实际位置放大居中显示;工具条/滑杆面板固定在 overlay 内,**不随画布缩放**(overlay 在画布 DOM 之外,天然 1:1;若挂在节点内则需 `scale(1/zoom)` 补偿,优先挂 overlay 层)。
- 关闭:`Esc` / 点遮罩 / 「取消」;确认按钮文案随操作(「确认裁剪」等)。
- 蒙版/裁剪计算统一在**源图原始像素坐标系**;overlay 里记录归一化坐标,导出时按原图尺寸绘制到离屏 `<canvas>` → `toBlob('image/png')`。
- 蒙版 PNG:与源图**同尺寸**,黑底(`#000`)、作用区纯白(`#fff`),无羽化(羽化交给模型)。

### 5.4 组件清单(`src/renderer/components/canvas/imageEdit/`)

| 文件 | 职责 |
|---|---|
| `ImageNodeEditToolbar.tsx` | 悬浮工具条 pill。`hasImage && (hovered||selected)` 显示。`EDIT_META` 里 `primary` 的直接排开,其余进「更多」下拉(参考截图的 `⋯`)。点击 → 打开对应 overlay/panel;`matting` 无 UI,直接 `deriveImageEdit`。图标名 → lucide 组件的映射表放本文件。 |
| `CropOverlay.tsx` | 8 handle 裁剪框 + 宽高比预设(自由 / 1:1 / 4:3 / 3:4 / 16:9)。确认 → 离屏 canvas 裁剪 → `deriveImageEdit('crop', { cropRect }, { localResultBlob })`。 |
| `MaskOverlay.tsx` | 画笔 / 矩形 / 橡皮 / 套索 + 笔刷大小滑杆 + undo/redo 栈。`mode:'inpaint'` 时底部带 prompt 输入框;`mode:'erase'` 无输入框。确认 → 生成蒙版 blob → `deriveImageEdit(kind, { instruction? }, { maskBlob })`。 |
| `AnnotateOverlay.tsx` | 画笔 / 矩形 / 箭头 / 文本,颜色 + 粗细。确认 → 源图 + 标注层合成 → `deriveImageEdit('annotate', {}, { localResultBlob })`。 |
| `MultiAnglePanel.tsx` | 旋转 / 倾斜 / 缩放三滑杆 + 广角开关 + CSS 3D 预览方块(`transform: rotateX/rotateY/scale`)。确认 → `deriveImageEdit('multiAngle', { params })`。 |
| `RelightPanel.tsx` | 亮度 % 滑杆、色温 K 滑杆(带暖冷渐变轨)、主光方向 3×2 宫格(左/顶/右 · 前/底/后)、轮廓光开关、透视/正面预览切换。确认 → `deriveImageEdit('relight', { params })`。 |
| `OutpaintOverlay.tsx` | 原图居中,四边可向外拖拽虚线框;导出扩边后的画布尺寸 + 扩边区域蒙版(原图区黑、新增区白)。确认 → `deriveImageEdit('outpaint', { params:{pad} }, { maskBlob })`。 |
| `ParamPopover.tsx` | `resize`(目标宽高 + 预设倍率)、`enhance`(2×/4× + 强度)、`split`(2×2/3×3/4×4)通用小面板。`resize` 本地缩放上传;`enhance` 走模型;`split` 调 `deriveImageSplit`。 |

### 5.5 `ImageNode.tsx` 接线

1. `import ImageNodeEditToolbar from './imageEdit/ImageNodeEditToolbar';`
2. `hasImage` 为真时,在卡片内渲染 `<ImageNodeEditToolbar sessionId={sessionId} node={node} assetUrl={assetUrl} onOpenOverlay={setActiveOverlay} />`,位置同 `NodeActionBar`(`bottom-[calc(100%+6px)]`),与现有 header/action bar 错开一层(再 `translateY` 一段)。
3. overlay 状态 `const [activeOverlay, setActiveOverlay] = useState<ImageEditKind | null>(null)`,按 kind 渲染对应组件(portal)。
4. `params.edit` 存在的节点:
   - 顶部 `FloatingNodeHeader` 的 `fallback` 用 `editNodeTitle(edit.kind)`;`icon` 换成 `EDIT_META` 图标。
   - **隐藏** `NodeFloatingPanel`(编辑节点不需要 prompt/模型/尺寸/变体面板)。第三期再给它做「编辑参数回改面板」。
   - 渲染 `edit_src` handle(§3.4)。
   - 无图且未运行时,占位文案改为「等待编辑生成 · 来源:<源节点标题>」+ 一个「运行」按钮(调 `runNode`)。
5. `memo` 比较函数补上 `prevData.node.params` 已含 `edit`,无需额外字段。

### 5.6 渲染层测试(`npm run test:unit`)

- `buildEditPrompt` 已在 shared 覆盖。
- `ImageNodeEditToolbar`:给定有图节点,渲染出 `primary` 按钮;点击 `matting` 触发 `deriveImageEdit` mock。
- `MaskOverlay`:画一笔后导出 blob 非空、尺寸等于传入的源图尺寸(可用 jsdom + `OffscreenCanvas` polyfill 或 mock `toBlob`)。
- `canvasStore.deriveImageEdit`:mock `api`,断言建节点 params.edit 正确、连边 `image_out→edit_src`、本地类走 `setCanvasNodeAsset`、模型类走 `mask` 上传 + `run`。

---

## 6. 边界与约定

1. **结果落点**:永远是新节点 + 一条 `image_out → edit_src` 边。绝不写回源节点的 `output.assets`。
2. **链式编辑**:编辑节点本身有图后,其工具条照常出现,可再派生下一个编辑节点(`sourceNodeId` 指向它)。
3. **源图选取**:执行器优先 `edit_src` 边的源节点;该源节点用其 `activeAssetIndex` 对应的资源。用户在源节点切了变体后再编辑 → 用当前选中变体。
4. **快速切分**:`deriveImageSplit` 建 N 个节点,按行列在源节点右侧网格排布(间距复用 `EDIT_NODE_GAP`);N 条边全部 `image_out → edit_src`(切分节点也是 `image` + `edit.kind='split'`,但 `output` 直接由本地上传填充,不跑模型)。
5. **计费**:本地类 `confirmedSpend` 不需要(`runNode` 不会被调用);模型类沿用现有 `runNode`(已带 `confirmedSpend:true`)。工具条对模型类操作在按钮 tooltip 标注预估点数(`estimateNodeCost`)。
6. **matting 透明输出**:执行器写盘强制 `.png`;`ImageNode` 展示时容器背景用棋盘格(可加一个 `checker` class)。
7. **失败**:编辑节点复用现有 image 节点的错误 UI(`node.output.error` + 「让 Agent 协助修复」按钮,文案可保留)。
8. **撤销**:`addNodeAndConnect` 已注册一条 undo(删边 + 删节点)。本地上传结果无需额外 undo 项(节点删了结果就没了)。`deriveImageSplit` 用一条 `record(...)` 包住多节点创建。
9. **i18n**:文案全中文硬编码,与现有画布组件一致(项目未上 i18n 框架)。
10. **反缩放**:overlay 一律走 portal 层(画布 DOM 之外),避免 `scale(1/zoom)` 补偿;工具条 pill 在节点内,复用 `NodeActionBar` 的 `scale` 逻辑。

---

## 7. 分期与验收

> 每期结束跑:`npm run lint && npm run typecheck && npm run test:unit && npm run test:api`。

### 第 1 期 · 骨架 + 本地操作
**范围**:§2 `canvasImageEdit.ts`(全量类型 + `buildEditPrompt` + `EDIT_META` + 测试) · §3.1–3.4 数据模型 · §5.1 api `uploadCanvasNodeMask`(先加不用) · §5.2 `deriveImageEdit` + `deriveImageSplit` + `blobToBase64` · §5.4 `ImageNodeEditToolbar` / `CropOverlay` / `AnnotateOverlay` / `ParamPopover`(仅 `resize`、`split` 分支) · §5.5 `ImageNode` 接线(工具条 + edit_src handle + 编辑节点隐藏 FloatingPanel)。
**产出**:选中/悬浮有图节点 → 工具条出现 → 裁剪/调整像素/标注/快速切分派生出连线的新节点,内容由客户端像素生成,**零模型调用、零计费**。
**验收**:
- 裁剪 640×640 图选中间 50% → 新节点图为 320×320。
- 快速切分 2×2 → 4 个新节点,每个是原图对应象限。
- 编辑节点不显示 prompt/模型/变体面板;标题显示中文操作名。
- `Esc`/点遮罩关闭 overlay 不留残留。

### 第 2 期 · 模型编辑
**范围**:§4.1 `runImageNode` edit 分支(含公共 helper 抽取) · §4.2 `/mask` 路由 · §4.3 服务端测试 · §5.4 `MaskOverlay` / `MultiAnglePanel` / `RelightPanel` / `OutpaintOverlay` + `ParamPopover` 的 `enhance` 分支 · `ImageNodeEditToolbar` 接入全部 kind。
**接入顺序**:`inpaint` + `erase`(共用 `MaskOverlay`)→ `relight` + `multiAngle` → `outpaint` → `enhance` → `matting`。
**产出**:11 个操作全部可用,模型类派生节点自动 `runNode` 并流式出图。
**验收**:
- 重绘:涂一块蒙版 + 输入「换成红色气球」→ 新节点出图,蒙版外区域与源图基本一致。
- 打光:主光「左侧」+ 色温 3000K → 新节点出暖调、左向阴影的图。
- 抠图:新节点输出透明背景 PNG,节点展示棋盘格底。
- 无源图 / 无蒙版 / 重绘描述为空 → 节点 `readiness` 徽标提示,不发起请求。
- `npm run test:api` 覆盖 edit 分支 prompt/images 组装与 `/mask` 路由。

### 第 3 期 · 可回改 + Agent 工具
**范围**:
1. 编辑节点选中时,`ImageNode` 渲染「编辑参数面板」(按 `edit.kind` 复用 §5.4 的 panel,预填 `edit.params`)→ 改参数 → `updateNodeParams` + 重新 `runNode`;蒙版/裁剪可「重新绘制」。
2. `src/main/server/agent/imageTools.ts` 增加工具 `canvas_edit_image({ nodeId, kind, instruction?, params? })`:服务端直接 `deriveImageEdit` 等价逻辑(建节点 + 连边 + 跑),供对话里「把这个节点打暖一点」「把背景抠掉」。
3. (可选)`CanvasContextMenu` 右键图片节点 → 「编辑」子菜单,等价工具条。
**验收**:
- 选中已生成的「打光」节点,把色温从 3000K 拉到 6500K,重跑 → 图变冷调,构图不变。
- 对话「@图片节点 抠掉背景」→ 画布上出现连线的抠图节点并出图。

---

## 8. 执行顺序清单(给执行者的 checklist)

第 1 期:
- [ ] 新建 `src/shared/canvasImageEdit.ts` + `.test.ts`,`npm run test:unit` 绿。
- [ ] `canvas.ts`:`CanvasImageParams.edit?`。
- [ ] `canvasReadiness.ts`:edit 分支提前返回 `editReadiness`。
- [ ] `canvasPricing.ts`:本地 edit 计 0 + 单测。
- [ ] `api.ts`:`uploadCanvasNodeMask`。
- [ ] `canvasStore.ts`:`deriveImageEdit` / `deriveImageSplit` / `blobToBase64` + 单测。
- [ ] `components/canvas/imageEdit/`:`ImageNodeEditToolbar`、`CropOverlay`、`AnnotateOverlay`、`ParamPopover`(resize/split)。
- [ ] `ImageNode.tsx`:工具条挂载、`edit_src` handle、编辑节点隐藏 `NodeFloatingPanel`、标题/图标、占位文案、overlay 状态机。
- [ ] lint / typecheck / test:unit / test:api 全绿。

第 2 期:
- [ ] `imageExecutor.ts`:抽 `resolveImageProvider` + `writeAssetsAndBroadcast` helper;加 `edit` 分支。
- [ ] `routes/canvas.ts`:`POST /:canvasId/nodes/:id/mask`。
- [ ] `imageExecutor.test.ts` + `/mask` 路由测试。
- [ ] `MaskOverlay`(inpaint/erase)、`MultiAnglePanel`、`RelightPanel`、`OutpaintOverlay`、`ParamPopover` enhance。
- [ ] `ImageNodeEditToolbar` 接入全部 kind + 预估点数 tooltip。
- [ ] 四项检查全绿 + 手动跑通验收项。

第 3 期:
- [ ] `ImageNode.tsx`:编辑参数回改面板 + 重跑。
- [ ] `imageTools.ts`:`canvas_edit_image` 工具 + 单测。
- [ ] (可选)`CanvasContextMenu.tsx` 编辑子菜单。
- [ ] 四项检查全绿 + 验收项。

---

## 9. 不做 / 明确排除

- 不新增 `image` 之外的节点类型。
- 不引入 `sharp` / `jimp` / 原生图像库;本地像素操作全在渲染层 `<canvas>`。
- 不把编辑结果写回源节点变体列表。
- 不做逐像素图层编辑器(PS 式);标注是一次性合成。
- 不做独立的 mask 数据库表;蒙版就是画布资源目录里的一张 PNG,路径存在 `params.edit.maskAsset`。
