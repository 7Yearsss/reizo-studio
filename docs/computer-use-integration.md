# Computer Use — research + integration

Background note. Not a current-state spec; the code is the source of truth.

## What we looked at: `trycua/cua`

Cloned to `E:\CodeCode\cua` (research only, not vendored). Cua is a large
multi-runtime project ("give AI agents computers they can use"). The parts
relevant to us:

- **`libs/typescript/computer/src/interface/`** — `BaseComputerInterface`, an
  abstract control surface. Its method list is the de-facto vocabulary for
  computer use: `screenshot`, `getScreenSize`, `getCursorPosition`,
  `moveCursor`, `leftClick`/`rightClick`/`doubleClick`, `mouseDown`/`mouseUp`,
  `dragTo`/`drag`, `typeText`, `pressKey`, `hotkey`, `keyDown`/`keyUp`,
  `scroll`/`scrollUp`/`scrollDown`, plus window / clipboard / filesystem /
  accessibility extras.
- **`libs/typescript/agent/src/types.ts`** — the agent loop message shapes.
  A turn is a sequence of `computer_call` items carrying a `ComputerAction`
  union (`ClickAction`, `TypeAction`, `KeyPressAction`, `ScrollAction`,
  `WaitAction`, …); each is answered by a `computer_call_output` whose payload
  is **always a screenshot**. This is the standard screenshot-feedback loop
  (same shape as Anthropic's / OpenAI's computer-use tools).
- Everything in cua is mediated by a **`computer-server`** (Python) running
  *inside* the target — a cloud Fleet desktop, a local macOS VM (Lume), or a
  Docker/QEMU sandbox — reached over a WebSocket. The SDK never touches the
  host directly; it always drives a disposable/remote OS.

### Why we did not vendor or depend on cua

- It is Python + Swift + Rust, built around **isolated/remote desktops**. Reizo
  is Electron/TypeScript and explicitly **local-first — it runs on the user's
  own machine**. Pulling in `computer-server`, Lume, or Fleet would add a whole
  runtime and a network hop to control a screen that is already right here.
- Cua's value for us is the **action vocabulary and the loop design**, both of
  which are small and well understood. We reimplemented that directly.

## What we built

A native, in-process computer-use tool for the agent runtime — no native
node modules, no extra services.

- **`src/shared/computerUse.ts`** — the `computer` tool's input schema (a zod
  discriminated union over `action`), the action vocabulary (a trimmed cua
  set), and pure helpers (`clampPoint`, `summarizeComputerAction`,
  `normalizeHotkey`). Co-located unit test.
- **`src/main/computerUse/`** — the driver, in the Electron **main** process:
  - `capture.ts` — screenshots via Electron's built-in `desktopCapturer` +
    `screen` (logical size, scale factor, downscale to a max width). Zero deps.
  - `winInput.ts` / `posixInput.ts` — OS input backends. Windows drives a
    persistent PowerShell process with `Add-Type` Win32 (`SetCursorPos`,
    `mouse_event`, `keybd_event`, `SendInput` for Unicode text). macOS uses
    `osascript` "System Events"; Linux uses `xdotool` (documented dependency).
    Script builders are pure and unit-tested.
  - `controller.ts` — ties capture + input, clamps coordinates to the display,
    adds a short settle delay after each action, exposes
    `isComputerUseSupported()`.
- **`src/main/server/agent/computerTools.ts`** — the `computer` tool. First use
  in a session raises a one-time permission (`allow` / `allow for this session`
  / `deny`) through the existing `ApprovalRequiredError` suspend/resume path;
  once `allow-session` is granted the agent runs actions back-to-back. Every
  action returns a fresh screenshot, which is fed to the model as an image via
  the tool's `toModelOutput` (live pass) and re-inflated from disk in
  `assistantTurnToModelMessages` (resume path), with a small retention window
  so history stays bounded.
- **`src/main/server/routes/computerUse.ts`** — serves the saved screenshots
  (`GET /api/computer-use/:sessionId/:file`) and a capability probe
  (`GET /api/computer-use/status`).
- **Settings** — `computerUse: boolean` (default **off**). Toggle in
  Settings → 通用. The tool is only assembled when the flag is on *and* the
  platform is supported.

### The loop

```
model → computer(action)               (tool call)
      → controller executes on the OS
      → screenshot captured, saved, downscaled
      → tool result: { ok, action, cursor, screenSize, screenshotUrl }
        + model output: text summary + image/png
model → computer(next action) …        (repeats, no re-prompt after allow-session)
```

### Safety

- Off by default; explicit settings toggle.
- One approval gate per session before the first action (independent of
  `permissionMode` — even `full` prompts once).
- Screenshots are saved under `<userData>/data/computer-use/<sessionId>/` and
  served only over the loopback origin-guarded API.
- `toolLoopGuard` already covers a stuck click loop.
