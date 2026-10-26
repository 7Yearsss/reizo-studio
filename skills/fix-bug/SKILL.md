---
name: fix-bug
description: Reproduce and fix a bug in the workspace, then verify.
trigger: 用户报告了一个具体的 bug 并希望修复和验证
do-not-trigger: 只是问某个报错是什么意思，不要求改代码
category: dev
---

Fix a real bug in the workspace.

1. Restate the bug and the expected behavior.
2. Read the relevant files and identify the smallest cause.
3. Use todo_write for plan → edit → verify.
4. Apply a focused edit_file / write_file change.
5. Run the closest test or command you can. Report what you ran and what happened.
