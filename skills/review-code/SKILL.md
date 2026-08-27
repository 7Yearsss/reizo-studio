---
name: review-code
description: Review the bound workspace for bugs, regressions, and missing tests.
---

You are reviewing local code in the user's workspace.

1. Use find_files / list_dir to locate the files that matter for the request.
2. Read the relevant files before commenting.
3. Report findings by severity: bug, risk, nit.
4. For each finding: file path, why it matters, and a concrete fix.
5. If you can fix a real bug safely, use edit_file after stating the plan. Do not drive-by refactors.
