# 对话排版与文件预览

2026-10-24，按用户提供的 Codex 截图调整 Reizo Studio 对话界面。

- 字体：系统拉丁字体 + 随应用打包的 Noto Sans SC Variable；中文不依赖系统回退字体。字体包使用 Fontsource 的 OFL-1.1 许可版本，无需在线字体请求。
- 气泡：右侧用户消息使用黑底白字圆角气泡；深色模式使用浅底深字。助手保留无气泡阅读区，正文 15px、1.8 行高。
- Markdown：语义化粗体、列表、引用、标题与代码块；深色代码使用 Shiki 对应主题颜色。模型提示加入适度强调和文件链接格式；历史纯文本不会凭空增加重点。
- 文件：Markdown 文件链接、行内代码文件名，以及成功的 write_file/edit_file 结果提供蓝色预览入口。图片、视频、音频直接预览，Markdown/HTML/代码复用现有阅读器；其他格式提示在文件夹中查看。生成文档、表格和幻灯片继续使用原有右侧工作区。
- 范围：预览限定当前绑定的工作区，复用真实路径/符号链接边界校验；媒体支持字节范围请求，HTML 继续使用隔离预览。

验证：TypeScript 检查通过，相关 5 个测试文件共 19 项通过；主进程 Vite 构建通过。页面验证了中文粗体、文件链接、图片和视频预览、Markdown 文案预览及浅/深色样式。

本机 Node 25 的测试工作进程需要禁用实验性 Web Storage：

```powershell
$env:NODE_OPTIONS='--no-experimental-webstorage'
node node_modules/vitest/vitest.mjs run src/renderer/components/chat/MarkdownContent.test.tsx src/main/server/routes/workspacePreview.test.ts src/renderer/components/workspace/FilePreview.test.tsx src/renderer/components/chat/ProducedFiles.test.tsx src/renderer/lib/markdown/workspaceFileLinks.test.ts --pool=threads --maxWorkers=1
Remove-Item Env:\NODE_OPTIONS
```

运行中的桌面进程需要重启才能加载新的文件预览 API 和回复格式提示。前端开发服务可热更新样式。临时交互预览位于 `http://127.0.0.1:46174/.cache/chat-qa.html`，使用实际对话组件和隔离的示例文件。
