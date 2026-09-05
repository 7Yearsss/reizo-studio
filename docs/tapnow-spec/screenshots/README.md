# TapNow 画布截图证据

本目录用于存放 TapNow 官方画布实测截图。截图不是营销参考图，而是帮助实施 AI 理解空间关系、节点状态和交互层级的视觉证据。

当前仓库目前只有截图索引，截图二进制尚未落盘。此前截图只在对话界面内展示，未形成可被其他 AI 打开的本地附件。重新取得截图后，应按下表命名并放入本目录：

| 文件名 | 应记录的状态 | 对应调查笔记 |
|---|---|---|
| `01-canvas-overview.png` | 画布与右侧 Agent 双栏总览 | `08_canvas_interaction_field_notes.md` 1.1 |
| `02-node-selected-floating-panel.png` | 图片节点选中、节点下方生成面板 | 1.2、8.2 |
| `03-magnetic-handle-idle.png` | 左右加号默认态与真实节点位置 | 2.1 |
| `04-magnetic-handle-following.png` | 鼠标接近时加号吸附偏移 | 2.2 |
| `05-create-menu-downstream.png` | 右侧“引用该节点生成”菜单 | 3.1 |
| `06-create-menu-upstream.png` | 左侧“添加上下文”菜单 | 3.3 |
| `07-context-pill-and-edge.png` | 上下文来源条目与语义连线 | 3.4、3.6 |
| `08-edge-cut-control.png` | 连线剪刀断开控件 | 3.5 |
| `09-group-selected.png` | 多选工具条与组容器 | 1.4 |
| `10-group-moved-undo.png` | 组移动后的空间关系 | 1.4、5.1 |
| `11-image-generating.png` | 图片生成中、控件禁用、Generating 状态 | 4.4 |
| `12-image-4x-result-set.png` | 4× 结果叠放在同一图片节点 | 4.2、4.4 |
| `13-agent-node-reference.png` | Agent 消息引用节点并定位画布 | Agent 协同规划 |
| `14-ghost-proposal.png` | Reizo 提案节点与正式节点对比 | Agent 协同规划 |

## 使用规则

- 截图文件名必须稳定，规划文档只引用文件名，不引用临时浏览器 URL。
- 每张截图旁边的说明必须写“观察到什么”和“不能推断什么”。
- 截图只能证明视觉状态，不能单独证明持久化、服务端事件或生成结果；这些仍需日志和状态快照。
- 执行 AI 读取本目录后仍需以 `08_canvas_interaction_field_notes.md` 的文字证据为准。
- 当前可直接查看的原始总览截图已在本次对话中重新展示；由于浏览器桥接没有提供本地二进制写入接口，不能把对话中的临时图片路径伪装成仓库文件。
