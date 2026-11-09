# 本地工作台运行

日常试用使用静态页面快照，避免依赖开发服务器及依赖预编译：

1. 源码更新后运行 `npm run desktop:build`。
2. 日常运行 `npm run desktop:open`，或双击项目根目录的 `打开工作台.cmd`。

快照放在 `.cache/desktop-preview/app`，主进程、preload 和页面一起构建；使用原有 Reizo Studio 用户目录，不迁移或清空本地项目、账号及对话。快照不会热更新，代码修改后需重新构建。

`npm start` 保留给需要热更新的开发。开发页面只监听渲染进程和共享代码；文档、主进程、preload、脚本和测试文件不再触发页面整页重载。主进程/preload 修改仍需 Forge 重新构建或重启。

`[startup]` 日志记录恢复检查、账号、数据库、接口和窗口各阶段耗时，不包含账号凭据。静态快照运行日志位于 `.cache/desktop-preview/stdout.log`、`stderr.log`。
