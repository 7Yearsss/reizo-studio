# UI 样式钩子（data-ui）

给自定义 CSS（设置 → 通用 → 自定义 CSS）用的稳定选择器。应用自己的样式在 Tailwind 的 cascade layer 里，用户 CSS 不在任何 layer，所以**不需要 `!important`** 就能覆盖。

| 角色 | 位置 |
| --- | --- |
| `app.titlebar` | 顶部自绘标题栏 |
| `app.sidebar` | 左侧导航与会话列表 |
| `chat.message` | 每条消息（用户和助手都带） |
| `chat.message.user` / `chat.message.assistant` | 区分发送方 |
| `part:message-content` | 助手消息正文（Markdown 区域） |
| `chat.composer` | 底部输入区浮层 |

用法：`[data-ui~='chat.message'] { max-width: none; }`（用 `~=`，一个元素可带多个角色）。

规则：这里列出的角色是公开接口，改名必须保留旧名作别名；新增角色在此登记。`@import` 会被忽略（不加载外部样式）。
