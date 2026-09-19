---
name: testing-reizo-studio
description: How to launch and drive the Reizo Studio Electron app for E2E testing in this sandbox, including the renderer-crash workaround and CDP fallback.
---

# Testing Reizo Studio (Electron) in this sandbox

## Launching

`REIZO_DEV_NO_SANDBOX=1 npm start` (per blueprint) can crash the renderer on this box:
it adds `--disable-dev-shm-usage`, moving Chromium shared memory to `/tmp`, where
creation fails with ESRCH → `[render-process-gone] exitCode 133` → black/unresponsive
window. Workaround — pass the flags directly (keeps shm in `/dev/shm`, which is a
healthy tmpfs here):

```bash
cd /home/ubuntu/repos/reizo-studio
npx electron-forge start -- --no-sandbox --disable-gpu --disable-software-rasterizer --remote-debugging-port=9222
```

Electron args go after the `--` separator (`npm start -- --flag` forwards to
electron-forge, not electron). The window may start behind Chrome or unmaximized:

```bash
WID=$(wmctrl -l | grep 'Reizo Studio' | awk '{print $1}')
wmctrl -i -a "$WID"; wmctrl -i -r "$WID" -b add,maximized_vert,maximized_horz
```

X11 typing (`type` tool) into the Electron window works for ASCII, but CJK text
(e.g. 中文) silently fails to land in the textarea — use ASCII test strings, or drive
the renderer via CDP `Input.insertText` (handles Unicode) on :9222. Note that after
a chip/palette pick the textarea cursor can land at position 0, so typed text may
prepend the seeded draft rather than append — harmless, still proves focus.

## CDP access

`/json/list` works over plain HTTP, but the WebSocket handshake rejects any Origin —
use `websocket-client` (pip) with `suppress_origin=True`, or relaunch with
`--remote-allow-origins=*`. A helper script lives at /tmp/cdp.py (ephemeral — recreate
if gone): connect to the page target whose URL contains `:46173`, then
`Runtime.evaluate`/`Page.captureScreenshot`/`Input.insertText`.

## Paths

- userData: `~/.config/Reizo Studio/` (dev: productName, not package name)
- Real SQLite: `~/.config/Reizo Studio/data/reizo.db` (the top-level `reizo.db` is empty/unused)
- User skills: `~/.config/Reizo Studio/data/skills/<id>/` + `.skillhub.json` marker for hub installs
- Renderer dev server: http://127.0.0.1:46173 ; local API: 127.0.0.1:47100

## Feature map (relevant pages)

- Sidebar "技能" (Sparkles icon, 2nd item) → uiStore.mode 'skills' → PluginsPage ("插件" title):
  "我的技能" + "SkillHub 技能市场" (search, sort chips, install cards)
- 使用 on a user skill → creates session "/<skillId>" and sends a message with skillId
- No API key configured by default → chat turns fail with 400 "No API key configured";
  session/tab creation is still verifiable, provider reply is not.

## Devin Secrets Needed

None for launch/UI testing. A provider API key would be needed to verify an actual
model reply end-to-end.
