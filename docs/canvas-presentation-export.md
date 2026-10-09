# 本地图片页 PPTX 导出

画布导出把 1–40 张已有图片页按选定顺序封装成 16:9 PPTX。每页只有一个原生图片对象，图片居中并保持比例，空白区域为白色。不增添封面，不生成新素材，不调用付费模型。图片对象可移动、缩放或替换；图片中的文字没有独立可编辑文字层。

## 固定来源与任务身份

`POST /api/canvas/:canvasId/presentation-export` 必须发送稳定的 `Idempotency-Key`。请求示例：

```json
{
  "title": "新品介绍",
  "planId": "可选的本画布交付计划ID",
  "pages": [
    { "nodeId": "第一页节点", "assetId": "选定的已登记版本" },
    { "nodeId": "第二页节点", "assetId": "选定的已登记版本" }
  ]
}
```

传 `assetId` 固定指定版本；仅传 `nodeId` 时，在首次受理时捕获当时选定版本。UI 还可传 `expectedPath` 断言预览的选定路径；这是匹配断言，不是读取来源，版本变化时拒绝受理。受理后修改节点当前版本不会改动已排队的导出。未知响应重放同操作 ID 返回同一任务和导出节点；同 ID 改变请求会冲突。来源必须属于本画布，或已通过素材库明确复用到本画布。导出关联交付计划时只接受已登记图片版本，计划、页数与画布必须匹配。

服务器返回 `202 { jobId, nodeId, status }`。导出节点使用 `note` 类型，`params.localExport.kind='pptx-image-pages'`。任务历史、重试、节点运行与 Graph 均识别此本地类型，避免走 agent/媒体生成协议。取得本地计算许可后登记实际身份 `providerId='local'`、`model='pptxgenjs-4.0.1'`；排队不等于已经执行。仅运行本地导出不消耗付费生成预算。

取消及退出使用现有 NodeJobs fence。JSZip 的内存打包无法中途抢占；取消立即落任务终态，打包完成后的迟到结果被丢弃，本地计算许可在实际工作结束后释放。重新启动后中断任务可通过任务历史重试，使用原来捕获的来源。重试创建新执行，稳定的重试操作 ID 仍防止重复受理。

## 原生文件与交付校验

PPTX 作为 `binary/raw` 原生 artifact 登记，不伪装为 image。输出保留 artifact ID，重复运行发布新版本。每个成功任务记录 `artifactId`、`artifactVersion`、文件 SHA-256、页数以及固定版本下载地址 `/api/artifacts/:id/raw?v=:version`，历史版本仍可读取。

文件先写入唯一暂存路径并同步内容，随后排他发布；artifact/version、成功任务、画布投影以及可选的 `delivery_exports` 关联在同一 SQLite 事务中提交。原生发布从暂存到 keep/discard 持有每 artifact 路径锁，与单文件/会话 artifact 删除串行，旧删除不能清除新发布的文件。取消或事务失败撤销尚未提交的文件；提交后监听器触发退出也会保留已提交文件。读取使用 canonical 路径、父目录和文件 inode 校验，不接受链接或越界路径。突然断电的目录持久性仍依赖文件系统，未承诺电源故障级事务。

`deck-maker` 的技能约定新增可选通用字段 `requiredExports: [{ format: 'pptx', count: 1 }]`。`export_presentation` 只封装已有页图；`check_delivery` 在原素材校验后验证：

- export 与 plan 属于同一会话，任务成功，原生 artifact 与固定版本存在；
- 原生文件哈希吻合，真实页数为所需页数，每页一个图片对象，16:9 且没有外部资源链接；
- `sourceAssetIds` 与提交的图片页 manifest 页序完全一致。

最终缺 PPTX 时不能完成交付。其他技能没有 `requiredExports` 时保留原校验行为。删除 export artifact 会撤销关联计划的完成状态。文件验证遇到取消或应用退出时返回中断，不在文件 await 恢复后访问已关闭数据库。

`GET /api/canvas/:canvasId/deliveries/:planId/exports` 读取关联文件，`GET /api/canvas/:canvasId/deliveries` 读取计划。renderer helpers 为 `exportCanvasPresentation`、`listDeliveryExports`、`listCanvasDeliveryPlans` 与已有 `artifactRawUrl(id, version)`。

## 格式、依赖与验证范围

生产导出使用公开 MIT 依赖 PptxGenJS 4.0.1、JSZip 与 image-size。PNG/JPEG/GIF 直接嵌入；WebP 使用现有 FFmpeg 转为 PNG。每张图最多 12000 像素宽/高、3200 万像素，全部来源最多 128 MB。单仓库一次只运行一个本地打包任务。大图内存占用仍需实机压力验证；动图的播放行为依赖目标演示软件。

PptxGenJS 4.0.1 的内容清单会按页数声明并不存在的额外母版。本导出器只移除这些明确不存在的 `slideMasterN.xml` 声明，并对输出重新验证；其他缺失内容文件直接报错，不修改依赖包。

存储维护只把本导出器的明确 local job、input/result/version 关联及文件哈希均吻合的自含 PPTX 视作已知包。仍扫描数据库保存的页图来源来保护原图。未登记、损坏或其他来源的二进制包继续使候选变为需复核；包内容超出保守扫描上限也不隔离。

验证在临时 fixtures 中运行，未改真实用户数据库、未调用真实收费供应商。三条导出 storage/job 回归覆盖固定旧版本/顺序/receipt、本地 Graph 预算与原生历史、取消与提交后退出、显式库复用及关闭数据库 fence。两页真实图片样本另经 presentation skill 的包完整性、几何、Artifact Tool 导入和全页渲染检查。未在 PowerPoint/Keynote/Google Slides 中打开，Electron 打包版、非 NTFS 文件系统和大图峰值内存仍待验证。

```powershell
npx vitest run src/main/server/canvas/presentationExport.test.ts src/main/server/storage/canvasMaintenance.test.ts src/main/server/storage/artifactStore.test.ts src/main/server/agent/canvasTools.test.ts src/main/server/canvas/graphExecution.test.ts src/main/server/canvas/graph.test.ts
```
