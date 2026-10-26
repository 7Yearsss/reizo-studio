---
name: commit-message
description: Draft a git commit message from the current workspace diff.
trigger: 用户要为当前改动生成 git commit 信息
do-not-trigger: 只是在问 commit 规范
allowed-tools: run_command(git diff*), run_command(git status*), run_command(git log*), run_command(git show*), read_file, grep, find_files, list_dir
category: dev
---

Write a commit message for the current workspace.

1. Run `git status` and `git diff` (include staged and unstaged).
2. Summarize what actually changed, not what the user hoped changed.
3. Output a subject line ≤ 72 characters, then an optional body.
4. Do not commit unless the user explicitly asks.
