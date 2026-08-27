---
name: commit-message
description: Draft a git commit message from the current workspace diff.
---

Write a commit message for the current workspace.

1. Run `git status` and `git diff` (include staged and unstaged).
2. Summarize what actually changed, not what the user hoped changed.
3. Output a subject line ≤ 72 characters, then an optional body.
4. Do not commit unless the user explicitly asks.
