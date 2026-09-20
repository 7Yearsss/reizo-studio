<div align="center">

# ⚡ Reizo Studio

**你的 AI 创意工作室，就住在你的电脑里。**

本地优先的桌面 Agent —— 对话、画布、技能、自动化，一台机器全搞定。
不排队、不上传、不订阅焦虑。数据是你的，算力听你的。

[![License: MIT](https://img.shields.io/badge/License-MIT-accent.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-Forge-blue)](https://www.electronforge.io/)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)
[![Local-first](https://img.shields.io/badge/Local--first-100%25-success)](https://github.com/7Yearsss/reizo-studio)

</div>

---

## 这不是又一个聊天框

市面上大多数"AI 工具"是把网页套个壳。Reizo Studio 是反着来的：

| | 普通 AI 网页 | **Reizo Studio** |
|---|---|---|
| 数据在哪 | 别人的云 | **你的硬盘**（`userData/data`，JSON + SQLite） |
| 模型 | 锁定一家 | **OpenAI 兼容全家桶**，自带 Reizo (Winlume) 主力通道 |
| 出图 | 聊天里一闪而过 | **节点式画布**，每张图都是可复用、可编辑的资产 |
| 技能 | 没有 | **Markdown 即技能**，写个 SKILL.md 就多一项能力 |
| 跑批 | 手动催 | **计划任务 + 自动化**，人睡觉它干活 |

## 🎬 核心能力

### 🖼️ 节点画布 —— 视觉流水线，不是对话框

- 图片 / 视频 / 音频节点自由连线，输入即 `@[节点](canvas:<id>)` 引用
- **框选图上任意区域** → 变成裁剪缩略图 chip 发给 Agent，指哪改哪
- Agent 写画布时自动高亮聚焦、自动排版，附带 toast 汇报 —— 不用你审批
- 情绪板模式：一键隐藏表单控件，满屏纯视觉

### 💬 Agent 对话 —— 会提问、会等待、会自愈

- **提问卡片**：技能缺信息时弹结构化问答卡（单选/多选/方向卡带样例图），不是干巴巴的追问文本
- **方向卡嵌真图**：风格选择直接挂画布节点的真实缩略图，看着图挑，不靠猜
- **卡死不慌**：上游沉默 90 秒自动掐断重跑（最多 2 次），45 秒即可手动一键重试 —— 绝不让你干瞪眼
- 消息排队、断线重连续跑、重启不丢提问卡

### 🧩 技能系统 —— 写 Markdown 就是写功能

- 内置 **电商套图** 技能：产品图 → Listing 文案 → 产品身份证参考图 → 场景/模特资产 → 整套主图/A+ 分镜，全套落画布
- 内置 **封面图** 技能：三问卡片 → 草稿方向 → 按选定画幅出终图
- `## 提问` 小节声明要收集的信息，Agent 自动走问答卡 —— 技能作者零代码

### 🗂️ 工作区 —— 本地文件、Git、终端一体

- Chrome 式标签页，切换不丢草稿/滚动/在跑的流
- 文件树 + Git 状态 + 终端，Agent 产出直接落在工作区
- 工件面板：会话产物（Excalidraw、表格、生成图）统一归档

### 🎨 beui 驱动的高级 UI

- 流式跟读的 `message-scroller`（你上翻它就让位）
- 弹簧开关、可搜索模型下拉、方向卡画廊
- 浅色纸感设计系统，从头到尾一个调性

## 🏗️ 架构一句话

```
Electron Forge + Vite 三层构建（main / preload / renderer）
  └─ 进程内 Hono 服务器（127.0.0.1，端口自适应）
       └─ node:sqlite + drizzle + JSON 存储 —— 全部落在 userData/data
```

没有云端，没有账号墙，没有遥测。`npm start` 就跑起来。

## 🚀 快速开始

```bash
npm install
npm start
```

然后 Settings → Providers → 选 **Reizo (Winlume)**，粘一个 Web Studio 控制台的虚拟 Key，开聊。

> ⚠️ 别把 Key 提交进仓库。

## 🧪 开发命令

```bash
npm start          # Electron Forge 全量启动
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run test:unit  # vitest 单元测试
npm run test:api   # Hono 无头冒烟测试（CI 友好，不需要 GUI）
npm run make       # 打包安装包
```

## License

MIT —— 拿去用，改了就改了吧。
