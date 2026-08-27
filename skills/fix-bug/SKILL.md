---
name: fix-bug
description: Reproduce and fix a bug in the workspace, then verify.
---

Fix a real bug in the workspace.

1. Restate the bug and the expected behavior.
2. Read the relevant files and identify the smallest cause.
3. Use todo_write for plan → edit → verify.
4. Apply a focused edit_file / write_file change.
5. Run the closest test or command you can. Report what you ran and what happened.
