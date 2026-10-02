# Reizo 产品方向与资产层调研

核对日期：2026-10-02。定位以用户本轮澄清及项目 README 为准：Reizo 是本地优先的通用创作工作台，包含对话、Agent、开放画布、技能、自动化和代码工作区。电商内容批量生产是本轮重点验证场景；其需求不应收窄整个平台或进入所有工具共用的存储模型。

本次核对公开官方产品说明、API 文档与平台要求，没有购买或实际使用竞争产品。公开功能可以比较，未公开的数据库、文件去重、引用计数和回收算法不能从宣传资料推定。收益、转化率和实际生成质量仍需要 Reizo 自己的用户验证。

## 通用创作平台的参照

| 参照 | 官方资料证实的能力 | 对 Reizo 的启示，属于设计推论 |
| --- | --- | --- |
| Figma Weave | Weavy 已更名；工作流可封装为 Tools，创作者继续编辑画布；已发布版本可回看，旧版只读。[FAQ](https://help.figma.com/hc/en-us/articles/35965787376919-Figma-Weave-FAQ)、[Tools 与版本](https://help.weavy.ai/en/articles/12267755-tools) | 保留通用画布，成熟技能可包装为有明确输入和产物的工具。模板版本与某次生成版本分别记录。 |
| FLORA | Library、账户生成历史支持跨项目复用；API 区分 run、node、asset 身份，并允许把既有资产附加到画布。[工具栏](https://docs.flora.ai/editor/toolbar)、[生成历史](https://developer.flora.ai/reference/operations/listgenerations/)、[附加资产](https://developer.flora.ai/reference/operations/attachcanvasasset/) | 资产身份不宜等同于节点或任务。保存结果、查看来源、再次使用应有共同基础，但这不证明其物理文件采用不可变存储。 |
| ComfyUI | 开放节点图、模板、子图及 App Mode；工作流可以保存为 JSON，编辑格式与 API 执行格式有不同用途。[官方项目](https://github.com/Comfy-Org/ComfyUI/blob/master/README.md)、[格式说明](https://github.com/Comfy-Org/docs/blob/main/development/api-development/workflow-api-format.mdx) | 区分可编辑文档与执行计划。能导入节点图，不代表依赖、模型环境和随机过程完全可复现。 |
| Adobe Firefly | 加入 Projects/Your files 会创建用户可见的副本；删除生成历史原件不会影响已经保存在其他位置的副本。[生命周期说明](https://helpx.adobe.com/firefly/web/access-your-files/organize-your-generations.html) | 删除会话、删除画布、删除保存的资产应分别定义。这是可见生命周期事实，不能推断它实际复制了二进制文件。 |

这些资料支持保留平台的多工具形态。某个垂直场景可以提供更简单的入口，底层仍应能被开放画布、Agent 和其他技能复用。

## 素材复用与固定引用的进一步核对

FLORA 的附加资产 API 将已有 ready asset 放入项目画布作为静态媒体节点，返回独立 asset_id 与 node_id。这支持将“把既有结果加入画布”作为结构操作，而非重新发起生成；这是公开接口事实，不证明其物理文件是否复制或如何回收。[官方接口](https://developer.flora.ai/reference/operations/attachcanvasasset/)

Weave 的 Import 支持图片、视频、音频与 GLB；Preview 接入上游生成结果，Router 将一个输入分给多个输出。这些说明静态导入与跟随连线输入是不同使用方式，公开说明没有承诺 Preview 可以固定某次生成版本。[官方 Helpers](https://help.weavy.ai/en/articles/12268300-helpers-overview)

ComfyUI 的 LoadImage 在 IS_CHANGED 中读取文件并计算 SHA-256，在 VALIDATE_INPUTS 中检查文件存在。它说明缓存和输入检查需要考虑实际文件；这不能推导出它使用不可变资产注册表。[官方源码](https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py#L1580-L1647)

Reizo 本轮据此实现两项通用能力：加入画布复用指定资产；引用此版本建立固定图片图钉。图钉保存资产 ID，不连接原生产节点；图片和视频任务在接受时解析并冻结引用，缺失的固定文件在生成请求前明确失败。普通连线仍读取上游当前选择，继续支持迭代。固定引用随工作流导出携带媒体并在导入时映射本地身份。这些是 Reizo 的设计和验证结论，不是对竞争产品内部实现的判断。

## 电商场景与内容生产链的参照

Photoroom 把批量背景、阴影、布局、导出设置与 Brand Kit、可复用模板组合起来；Claid 把素材检查、处理链、异步批量执行和回调作为工作流能力。它们给电商技能的启示是固定输入、重复应用规则、检查成套产物，而不是只增加可调用模型数量。[Photoroom 批量目录](https://www.photoroom.com/use-cases/catalog-images)、[Claid 工作流](https://claid.ai/api-workflows)、[Claid 平台规格教程](https://docs.claid.ai/guides/e-commerce)

Photoroom 官方也区分围绕原主体的编辑与可能改变商品外观的生成能力，并建议在商品准确性重要时人工确认结果。电商技能应保存真实商品参考、供用户对照确认，并区分主图与场景图；这一规则属于电商交付策略，不属于通用 AssetStore。[官方说明](https://docs.photoroom.com/)

Adobe 的内容生产链把规划、制作、管理、发布及效果回收连接起来。Reizo 可借鉴「计划中的产物与实际产物分开」的组织方式；目前没有证据需要照搬企业多组织审批或复杂 DAM 权限体系。[内容生产链](https://business.adobe.com/resources/sdk/supercharge-your-content-supply-chain.html)、[品牌一致内容制作](https://business.adobe.com/solutions/content-supply-chain/marketer-led-creation.html)

## 行业边界：来源记录、成本和导出

Google Merchant Center 当前要求 AI 生成的商品图片携带相应 IPTC 数字来源标识，并保留已有嵌入标记。通用文件存储先原样保留字节；未来 Google Shopping 导出适配器再检查标识及渠道字段。本批 SQLite 的生成来源记录不等于已经写入平台要求的图片元数据。[Google 官方要求](https://support.google.com/merchants/answer/14743464?hl=en)

C2PA 用来源声明、内容绑定和签名描述媒体来源，涉及信任与验证。Reizo 本批 assetId、内容校验值和 job 来源属于本地执行追溯；暂不宣称实现了 Content Credentials，也不为当前媒体存储引入签名基础设施。[C2PA 2.4 规范](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html)

Weave、FLORA 对不同生成任务展示成本或使用明细；FLORA 的 API 估算不会锁定价格或预留额度。Reizo 当前的 Agent 预算是执行次数，应明确保留这个含义；后续费用估算和实际账单另建来源，不能把次数显示为金额。[Weave 信用点](https://help.weavy.ai/en/articles/12267166-figma-weave-s-credit-system)、[FLORA 使用明细](https://flora.ai/updates/editing-tools-usage-insights-credit-clarity)、[生成与估算 API](https://developer.flora.ai/reference/operations/startgeneration/)

## 本轮决定与后续验证

| 决定 | 所在层与理由 |
| --- | --- |
| 稳定资产 ID、内容校验、生成来源、文件安全写入 | 平台媒体基础。图片、视频、音频及各技能共享；不添加 SKU 或渠道刊登字段。 |
| 元信息独立于来源画布、节点和任务的删除 | 平台生命周期。先保留历史，不自动垃圾回收；用户可见素材库及引用保护规则另行设计。 |
| Node 当前选择、Job 固定输入、Artifact 保存版本分开 | 平台职责。防止新选择改变在途任务，也保留各工具自己的展示方式。 |
| 工作流包携带有效历史资产、蒙版与引用映射 | 通用可移植性。读取旧包，新导入分配本地身份，不把外部 jobId 当成本地已验证执行。 |
| 商品身份、一致性镜头、渠道规格与导出命名 | 电商技能和交付计划。封面、音视频等其他技能可定义自己的同类规则。 |
| 平台素材库、跨画布复用、固定版本引用 | 本轮实现媒体筛选、加入画布和引用此版本，并验证来源删除、版本选择与导入后的行为；电商套图及封面技能的生成质量和查找效率仍需用户验证。 |

研究也发现 README 的「不上传」与实际调用远端模型服务不一致，已改为准确描述本地保存及按用户配置发送生成请求。保持本地优先需要说明实际数据流，不能通过定位文案掩盖供应商调用。

后续优先用既有电商套图和封面两个技能做用户场景验证：重新打开已保存产物、复用某个确定版本、只补失败产物、带蒙版导出再导入。观察是否减少查找和返工，而非仅统计新节点数量。当前资料还不能证明最合适的素材库布局、定价模型或商家实际转化收益，相关决定继续保留为待验证项。
