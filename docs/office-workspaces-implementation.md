# Office 工作区集成进度

更新日期：2026 年 10 月 9 日。PPT、Doc、Excel、HTML 四个与画布平级的工作区，以及各自与 agent 的读取、选区和修改交互已经落地。本文件保留了阶段记录；当前状态以本表和末尾验收表为准。完整调研见 [选型与审核报告](office-workspaces-agent-review-research.md)。

| 工作区 | 当前状态 | 下一步 |
| --- | --- | --- |
| Excel | 已实现平级入口、新建、XLSX 导入导出、选区引用、发送前保存、范围读取、版本校验、agent 局部修改与刷新 | 已完成回归与 Grok 4.6 联调；高级 Excel 对象仍受转换库支持范围限制 |
| Doc | 已实现平级入口、富文本编辑、DOCX 导入导出、选段引用、AI 建议审核、用户编辑文字候选、正式版本查看与恢复 | 原生 Word 修订往返与复杂分页保真不在已实现范围 |
| HTML | 已实现平级入口、源码编辑、预览、文件导入导出、源码选区引用、AI 建议差异与审核、版本历史 | 扩展文件兼容性验收；后续可考虑 GrapesJS 可视化搭建 |
| PPT | 已接入独立面板、Presenton 元素编辑、页面管理、自动保存、整稿/页/元素引用、agent 建议审核、版本历史、PPTX 导入导出与恢复副本导入 | 已验证基础格式往返；复杂 Office 效果会提示转换限制或明确拒绝导出 |

Excel 的实现复用了 winlume 的转换和交互思路。新增 `read_sheet`，已有 `generate_sheet` 修改需要 `expectedVersion`；新建同名表格不会覆盖旧工作簿。正式版本写入通过序列化和事务版本检查拒绝并发陈旧保存。手动编辑保存不会重建编辑器，外部 agent 版本会重新加载；未保存失败内容保留在应用运行期间的恢复缓存中。

已发现并修正合并单元格从单元覆盖主单元、公式缓存未失效、主题同步循环、切换历史版本前未保存，以及上下文摘要直接显示在聊天记录中的问题。公式由 Univer 重算，导出前等待计算结果；XLSX 标记为在 Excel 中重新计算。

Grok 4.6 的真实 agent 联调使用现有 Reizo 配置，凭据仅通过 Electron safeStorage 读取；会话和文档均在隔离临时目录。它调用 `read_sheet` 和 `generate_sheet`，将 B2 从 120 改为 888，同时保留 B3 的 360、B4 的 `=SUM(B2:B3)` 和备注工作表，工作簿数量仍为 1。[实测结果](../artifacts/office-qa/excel-grok-result.json)。

浏览器验收确认了平级入口、工作簿打开、选区引用、手动编辑、自动保存、计算结果与重新加载。模拟 agent 将 B2 改成 999 后，B4 重算为 1359；导入测试工作簿手动编辑后，B2 为 120、B3 为 321、B4 为 441。浏览器 CDP 记录到 XLSX 下载完成，文件长度 7339 字节。[界面截图](../artifacts/office-qa/excel-panel-verified.jpg)。

Chrome 扩展未开启本地文件 URL 访问权限，文件选择器的自动上传受限；文件内容通过同一后端导入接口传入，界面打开和导出另行验证。转换单元测试覆盖文字、公式、常见样式、合并单元格、行列尺寸、agent 修改后的导出。复杂 Office 对象的格式保留范围仍以选型报告为准。

新增隔离 QA 启动脚本：`scripts/office-preview.ts` 和 `scripts/office-vite-preview.mjs` 使用 47170、47171、47172 端口；`scripts/office-live-smoke.cjs` 在 Electron 中运行真实模型测试。当前可复用临时数据目录为 `C:/Users/XXB/AppData/Local/Temp/reizo-office-preview-E83kBb`。重启模拟服务器时通过 `REIZO_OFFICE_FIXTURE_DIR` 指定该目录，避免重新生成验收数据。真实模型测试脚本固定使用 `grok-4.6`，不会修改用户原有模型配置。

Doc 已选用 Tiptap 3.31.4、Handle With Care 0.1.8、Mammoth 1.13.0 和 TurboDocx HTML-to-DOCX 1.23.1。Tiptap 的 React peer 支持 React 19；后端 HTML 工具和 UniqueID 的服务端函数可直接复用。Mammoth 是 BSD-2-Clause，其余上述核心和转换组件为 MIT。待审核内容必须独立保存，agent 只提出修改，用户接受后由服务端校验基线版本并提交。原生 Word 修订不是 HTML 增删标记自动提供的能力，不能在尚未实现时向用户宣称支持。

应用源码的类型检查使用 `artifacts/office-qa/tsconfig.app.json`。全项目原始类型检查已有 `scripts/canvas-handle-benchmark.ts:29` 的两个 TS7018 错误，来自 `paramsHash` 和 `output` 的类型推断；它们在本次实现前就存在，应与本任务新增错误区分。

Excel 的最终回归批次为 9 个文件、37 项检查通过；随后新增的超限快照拒绝测试也通过。应用源码类型检查已通过。额外的 Doc 核心验证共 7 项通过，覆盖稳定 ID、选区限制、开源修订引擎的接受与拒绝、草稿不改原文、逐项接受、重复点击幂等、陈旧审核拒绝、持久化恢复和事务失败时内容与审核状态一并回滚。

Doc 当前代码入口为 `src/shared/documentContent.ts`、`src/main/server/agent/documentReviewAdapter.ts`、`src/main/server/storage/artifactReviewStore.ts`，对应迁移为 `0014_artifact_reviews`。待审核内容保存于独立表中；文档正式版本拒绝来自 `chat` 的直接追加，接受动作以 `manual_edit` 来源与审核记录同事务提交。新插入块的身份在创建建议时准备，完整接受时发布与待审内容一致的内容。

Doc 新增 `documentIO.ts`、`routes/documents.ts`、`documentTools.ts` 和 `DocumentPanel` / `DocumentEditor` / `DocumentReview`。会话创建、DOCX 导入、正式版本导出和审核 HTTP 路由已接入主应用。`read_document` 返回稳定块 ID 和最新版本，`propose_document_edits` 仅创建待审内容，工具集中没有接受/拒绝工具。选段范围在服务端限制，steer 的新引用会更新本轮工具范围。新建文档使用 `generate_document`，同名不会覆盖。

自动保存基础已从 `sheetWorkspace.ts` 抽出为 `editorPersistence.ts`，Excel 保留兼容导出。Doc 发送、切换、导出、审核前等待保存；失败保留应用运行期间的恢复副本，可下载后重新载入。正式内容校验也下沉至 artifact store。新插入块重新分配身份，防止 AI 提供重复节点 ID。Doc 的引用上下文在聊天中显示为可点击文档标签。

浏览器实测发现 Tiptap 的 `setEditable` 默认会触发 update，导致仅点击引用也新增版本并清空引用，已通过关闭该事件并忽略内容未变化的更新修复，添加真实 Tiptap React 回归测试。Handle With Care 只有 ESM 导出，曾使 CJS 后端启动失败，现把审核预览单独移到 `shared/documentReview.ts`，后端只加载干净的文档模型。

最新本地验证为 7 个文件、20 项检查通过，覆盖 Doc 的 DOCX 转换、审核与 React 引用，及 Excel 的路由、持久化和编辑器回归。应用源码类型检查通过；新增核心文件 ESLint 无错误，有 4 个默认导入/非空断言警告。浏览器使用隔离本地 mock agent：原文“预计周一发布”在待审时不变，接受后变为“预计周五发布”；人工补充后旧建议过期、接受按钮禁用，拒绝后人工内容仍在。刷新保留正式内容。[待审截图](../artifacts/office-qa/doc-review-pending.jpg)、[浏览器验收数据](../artifacts/office-qa/doc-ui-result.json)。

本轮创建并启动真实 Grok 文档测试的组合命令被自动审批拒绝，工具仅返回 blocked by policy，未提供更具体原因。该命令未执行，尚无 Doc 的真实 Grok 成功证据，也未绕过审批重试。之前 Excel 的真实模型成功证据仍有效。QA API 最新运行 PID 3664、exec session 80269；Vite exec session 62178。重启前应再次查看端口实际进程。

Doc 和 HTML 现在共用 `ArtifactHistoryDialog`、原有版本栏以及带 `expectedVersion` 的恢复接口。历史预览只读，恢复创建新版本。版本栏嵌套 button 的无效结构已修正。浏览器实测 Doc v1 原文可读，恢复 v4 后生成 v7，再恢复含人工补充的 v6 后生成 v8；HTML 从 v3 恢复 v2 后生成 v4，再恢复 v3 后生成 v5。正式内容和历史均保留。浏览器记录 DOCX 下载完成 20523 字节，HTML 下载完成 567 字节。

HTML 源码编辑直接使用已安装的 `@pierre/diffs@1.3.6` 的 `EditProvider`、`Editor`、`File` 和 `Virtualizer`，差异复用现有 `LazyDiffView`。注意该版本编辑器工厂为 `new Editor(options)`，与技能文档所述新版签名不同，应以安装版本类型声明为准。没有引入新编辑器依赖。`useTextArtifact` 管理异步保存串行化、修改期间继续输入、恢复副本和版本冲突。

HTML 工具为 `read_html`、`generate_html`、`propose_html_edits`。审核使用 `htmlReviewAdapter`，拒绝有歧义的 oldText、重叠操作、陈旧版本和选区外修改；接受部分建议后会更新剩余建议的行位置。已有 HTML 也不能由聊天来源直接追加版本。预览 iframe 不开放 same-origin，默认静态，用户可运行页面内脚本；CSP 禁止网络请求、外部脚本、表单和嵌套页面，允许 HTTPS 图片/样式/字体。原始 HTML 下载接口也返回 attachment 和 sandbox CSP，避免直接访问 raw URL 获得应用同源执行权限。

HTML 浏览器验收已确认源码手动追加注释、发送前保存、选中源码引用、待审时原页面保持原样、接受后更新标题并保留说明/按钮/人工注释、静态模式不执行点击脚本、运行模式计数从 0 增为 1、恢复版本与导出。证据：[待审差异](../artifacts/office-qa/html-review-pending.jpg)、[最终界面](../artifacts/office-qa/html-panel-verified.jpg)、[内容快照](../artifacts/office-qa/html-ui-result.json)。最新整体回归 10 个文件、27 项通过；随后增加剩余建议行号更新测试，相关 4 个文件、12 项通过。应用源码类型检查通过，新增 HTML/历史模块 ESLint 无错误。

PPT 源码调查下载了 Presenton commit `2b5078ba266c67b16bc4f97943081e46d6dc0f21`，其 `TemplateV2KonvaSlide` 已有 `onLayoutChange`、撤销命令和 selection 事件。静态依赖闭包为 122 个文件、约 50526 行，包含原应用 Redux、图片服务、Next Image 和遥测边界，不能作为无依赖组件直接粘贴。依赖清单：[presenton-editor-dependencies.json](../artifacts/research/presenton-editor-dependencies.json)。独立导出包 1.0.34 已下载仅供检查，未安装或执行；README 将 open-source edition 描述为低质量导出，压缩包未找到 LICENSE 或 package license 字段，需要单独核验，不能套用主仓库 Apache 许可。

Presenton 的完整研究 checkout 现位于 `C:/Users/XXB/AppData/Local/Temp/reizo-presenton-research-2b5078ba`，避免研究源码进入应用代码扫描和开发服务器监听。跨盘移动曾因隐藏 Git 元数据报错，源文件已移动，元数据补复制后 `rev-parse` 与原 commit 一致，`git status --porcelain` 为空。工作区 `artifacts/research/presenton` 仅残留 `.git`；清理命令被自动审批拒绝，未提供原因，未重试删除。后续从上述临时 checkout 读取候选源码。导出包检查路径仍为 `artifacts/research/presenton-export-core/package`，它没有产品代码接入。

QA 当前 API 进程为 PID 50792，exec session 62296；Vite 进程为 PID 47184，exec session 62178。修改后端代码后重启 API，Vite 配置关闭 HMR，新增依赖优化后需主动刷新浏览器。使用端口前仍应再次核实实际运行状态。

下一步先验证 Presenton 元素编辑器的可抽取部分，保留上游许可证并替换宿主状态/图片/遥测接缝；转换层同时评估 MIT 的 pptxtojson 和已有 PptxGenJS。当前不应把只有图片页的旧导出视为可编辑 PPT 面板完成。Doc 支持基础可编辑转换，不提供原生 Word 修订往返或复杂分页保真；导入保留原始二进制附件。

PPT 已复用 Presenton commit `2b5078ba266c67b16bc4f97943081e46d6dc0f21` 的 92 个源模块，位于 `src/renderer/vendor/presenton`。保留 Apache-2.0 `LICENSE`、`NOTICE` 和原始文件 SHA256 清单 `UPSTREAM.json`。已移除 Redux 发布与遥测调用，接入 Reizo 布局回调；图片与图标选择改为本地资源，图表使用 NPM Chart.js/datalabels，不依赖原服务。Tiptap 2→3 的 setContent API 与重复 Underline 扩展已适配，严格类型检查中的若干推断问题已补充类型。

PPT 新增 `presentationContent.ts`、`presentationReferences.ts`、`presentationTools.ts`、`PresentationPanel` / `PresentationEditor` / `PresentationSurface` / `PresentationReview`。内部 JSON 保留 Template V2 布局，分配稳定页面和元素 ID，限定 128 页、6000 元素和 24 MB。`read_presentation` 精确读页/元素，`generate_presentation` 新建，`propose_presentation_edits` 只创建待审操作。页面/元素范围和陈旧版本由服务端校验，组合的选区可覆盖其子元素；重叠修改须合并。已有演示稿禁止聊天来源直接追加正式版本。

编辑器保留自己的实时布局和撤销栈；只有切换页面或外部版本到来才提供新的初始布局。`useTextArtifact` 新增同步 beforeFlush 接缝。浏览器发现内联文字的 requestAnimationFrame 回传可能晚于引用按钮点击，曾造成旧文字被提交；现在通过作用于当前编辑区的 `reizo:flush-presentation-inline` 事件先读取实时 Tiptap 内容再提交，已用浏览器和真实 Tiptap 单元测试验证。不要退回只调用高层 closeInlineEditor 的方案。

PPTX 导出入口为 `src/renderer/lib/presentationPptx.ts`，复用编辑器的 `absoluteBoxForSelection` 计算布局，以 PptxGenJS 写入原生文字、基本/自定义几何形状、表格、常见图表、内嵌图片及备注。测试检查 PPTX ZIP 内的 `a:custGeom`、`a:tbl`、`c:chart`、42pt 字号和文字，并确认未整页栅格化。PptxGenJS 4.0.1 运行时支持 `custGeom`，但枚举类型漏声明，适配处有明确注释。当前对公式、旋转组合、曲线/圆角自由路径、部分图表、infographic 等尚不能准确转换的元素直接报错，不静默丢失；远程图片须先内嵌。图片裁剪/比例、复杂颜色/列表样式等仍需进一步兼容性验证，不能宣称完整 Office 保真。

本轮浏览器使用隔离 mock agent，确认手动标题在引用前保存、选中元素进入聊天、待审时不改原稿、人工更新后旧建议禁用接受、拒绝旧建议、接受新建议保留正文；另验证复制页面、插入表格和图表，以及两页 PPTX 下载完成（92753 字节）。初始仅文字导出也完成（46276 字节）。[PPT 界面截图](../artifacts/office-qa/ppt-panel-verified.jpg)、[PPT 验收数据](../artifacts/office-qa/ppt-ui-result.json)。fixture artifact `RjLEN9SlZ6a3iVGVxwt_Y`，当前 v7，两页。最新相关回归 9 文件、27 项通过；应用源码类型检查与新增自有 PPT 模块 ESLint 通过。

`pptxtojson@2.2.0`（MIT）已安装，尚未接入。下一步实现实际 PPTX 导入：读取解析器真实输出、保留原始附件、映射元素与富文本，明确处理不支持对象，并用导出后再次导入的样本验证。其 package `main` 是 UMD、`module` 是 ESM，Node 路径标为实验性；不要未验证就照抄 README 的 Buffer.buffer 示例（需注意偏移和长度）。上游 `adaptTemplateV2LayoutToSlide` 有页面/元素/表格/图表/文本截断上限，本实现没有用它导出，后续导入也不能无提示沿用这些截断。

以上是 PPT 编辑器阶段的记录。当时 PPTX 导入尚未完成，后续完成情况见下方最终验收。真实模型证据仍只有 Excel 的 Grok 4.6 测试；没有绕过此前的审批拒绝重试真实模型启动或研究目录清理。

PPT 验收后 QA API 为 PID 7628 / exec session 80096；Vite 为 PID 53008 / exec session 56428。最新内联提交与前端导出代码已加载；后续修改后端后仍需重启 API。`artifacts/office-qa/presentation-typecheck.log` 最新应为空。PPT 保存冲突时可下载 `.reizo-ppt.json` 恢复副本再重新载入，后续导入入口也应支持该恢复格式。

## 最终集成与验收

交付范围是四个平级的可编辑工作区及其 agent 交互、基础文件导入导出、版本与冲突保护。Excel 延续 winlume 的结构化单元格操作及版本校验；Doc、HTML、PPT 修改现有内容时先生成独立待审建议，由用户接受或拒绝。这不是对所有 Office 特性均能无损往返的承诺。

| 用户需求 | 当前实现与证据 |
| --- | --- |
| 与画布平级的 PPT / Doc / Excel / HTML | `TopRightToolbar`、`RightPanel`、`uiStore` 中有四个独立入口；作品页复用相应编辑器。四类浏览器截图保存在 `artifacts/office-qa`。 |
| 先研究、优先复用开源 | 已检查 winlume 的 Excel 转换和交互；复用 Univer、ExcelJS、Tiptap、Handle With Care、Mammoth、TurboDocx、Pierre Diffs、Presenton、PptxGenJS、pptxtojson。研究报告列有来源、许可和取舍。Presenton 的 93 个上游模块有逐文件来源哈希、修改标记、LICENSE/NOTICE；打包资源包含 `third_party`。 |
| Excel 与 agent 交互 | 选区引用、发送前 flush、范围读取、局部单元格操作、CAS、重新计算和 XLSX 往返已验证；`excel-grok-result.json` 记录真实 Grok 4.6 调用成功。 |
| Doc 的可审核修改，避免静默覆盖 | 建议保存在独立表，正文在接受前不变；支持富文本差异、逐项/批量决定、文字候选编辑、陈旧版本拒绝和正式版本恢复。`doc-candidate-edit-result.json` 记录候选从审核 v1 升到 v2、原文仍为 v8，接受后才成为 v9，预算段落保留。 |
| HTML 编辑与 agent | 源码编辑、源码选区/整页引用、静态/受隔离脚本预览、精确替换建议、diff、接受拒绝、恢复和导出已验证；`html-ui-result.json` 保留证据。 |
| PPT 编辑与 agent | 新建/复制/移动/删除页，文字/形状/图片/表格/图表，元素/页面/整稿引用，稳定 ID、待审修改与历史。`ppt-ui-result.json` 记录选中标题修改、旧建议失效、接受后正文保留、两页原生对象 PPTX 下载完成。 |
| 文件导入与导出 | XLSX、DOCX、HTML、PPTX 已接入；PPTX 和 DOCX 保留原始附件。`.reizo-ppt.json` 可作为独立恢复稿导入。PPTX 往返测试覆盖文字样式、坐标、旋转、表格、图表分类/数值、备注、组合偏移和图片裁剪；合并/不等宽表格保留为可编辑单元格图形并提示。 |
| 验证 | `office-final-tests.json`：19 个文件、67 项检查；API 冒烟日志 `api-smoke-final.log`；全项目类型日志 `full-typecheck.log`；生产 renderer 构建日志 `renderer-build.log`。最终构建结果应以日志末尾和执行结果为准。 |

PPTX 导入位于 `shared/presentationImport.ts`，HTTP 入口为 `routes/presentations.ts`。使用 `pptxtojson@2.2.0` 的实际 ESM 文件，输入复制精确字节视图；ZIP、页数、元素数与载荷均设限。图表分类标签从原始图表 XML 补回，避免解析器在 PptxGenJS 样本中漏掉分类。HTML 富文本投影转换为带字体属性的 runs；形状统一为实际渲染支持的 vector，SVG 为图片。组合保留相对偏移。导入的图片裁剪可显示并重新导出；用户重新设置裁剪或替换图像会清除旧的导入裁剪参数。包含圆角/平滑路径的矢量导出复用编辑器相同的采样点，不另造路径算法。

PPT 浏览器验收进一步确认真实 PPTX 导入后显示混合字体、红色中文、绿色旋转椭圆、表格和图表；形状可拖动和撤销，整稿引用标签正确，导出完成 76159 字节。证据：[导入界面](../artifacts/office-qa/ppt-import-verified.jpg)、[导入验收数据](../artifacts/office-qa/ppt-import-ui-result.json)。Chrome 扩展的本地文件访问限制仍影响自动操作文件选择器，因此测试文件通过同一上传 HTTP 接口提交，编辑、引用和下载在浏览器验收。

Doc 的文字候选可以由用户再次编辑。共享 review store 的 `revise` 校验审核版本、待审状态和原文版本，重新生成差异，不修改正式稿；旧审核版本不能提交。浏览器确认“经我确认，预计下周三发布。”先只出现在候选中，接受后才写入正文。[截图](../artifacts/office-qa/doc-candidate-edited-verified.jpg)。格式块建议仍通过前后预览接受/拒绝，用户可在正式编辑器继续调整格式。

收尾时补了两个跨类型入口：流程图工具不能把 Office 产物当图表覆盖；工作区文件写入也不能覆写已管理的工作簿。研究/构建产物已排除在 TypeScript 和 ESLint 扫描之外，第三方源码不按本项目风格重写，但仍参与类型检查与构建。已有 canvas 基准脚本仅增加 `CanvasNode` 回调返回类型，消除了先前两处 TS7018 推断错误。

兼容范围：DOCX 为基础富文本转换，不输出原生 Word 未决修订；PPTX 的高级母版、动画、滤镜、复杂图表等不保证完整保真。复杂形状以 SVG 保留，复杂表格以单元格图形保留并显示提示；尚不能准确导出的对象会报错。HTML 预览中的外部脚本、网络请求和表单受限。协作编辑、自动冲突合并、GrapesJS 可视化建站属于后续扩展，并未作为已完成能力宣传。

真实模型测试：只有 Excel 已使用用户现有配置的 Grok 4.6 实测；其他三类已通过本地模拟 provider 的完整工具回路和前后端测试。测试没有修改用户原有模型配置，也没有重试被自动审批拒绝的凭据测试命令。

最终检查结果：67/67 项集成回归通过，`npm run typecheck` 退出码 0，`npm run test:api` 输出 `SMOKE TEST PASSED`，renderer 生产构建成功（2 分 48 秒；有现有大型 chunk 提示）。[验收索引](../artifacts/office-qa/office-completion-audit.json)关联所有证据。四工作区集成交付完成，以上格式兼容限制和后续扩展仍然明确保留。
