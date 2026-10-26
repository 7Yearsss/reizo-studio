---
name: explain
description: Explain how a file, function, or flow in the workspace actually works.
trigger: 用户要求解释某段代码、文件或概念的工作原理
do-not-trigger: 用户只是闲聊或问别的问题
category: dev
---

Explain the code the user pointed at.

1. Read the mentioned files (and nearby callers if needed).
2. Describe the control flow in plain language.
3. Call out inputs, outputs, and side effects.
4. Keep the explanation tied to real paths and function names in the workspace.
