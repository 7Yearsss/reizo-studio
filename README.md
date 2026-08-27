# Reizo Studio

Local-first desktop agent for Reizo. Chat, workspace files, skills, and scheduled runs live on your machine.

## Stack

- Electron Forge + Vite (main / preload / renderer)
- React renderer, not a wrapped website
- In-process Hono API on loopback (`API_BASE_PORT` in `src/shared/constants.ts`)
- Sessions and settings as JSON under `app.getPath('userData')/data`
- API keys encrypted with Electron `safeStorage`

## Run

```bash
npm install
npm start
```

Open Settings → 模型供应商 and paste an API key. Bind a workspace if you want the agent to read, edit, and run commands. Type `/` for skills (`review-code`, `explain`, `commit-message`, `fix-bug`). Drop files onto the composer to attach them.

Permission modes: 每次询问 / 工作区可写 / 全部允许.

Global shortcut: `Ctrl/⌘+Shift+Space` brings the window back.

## Test the API without a GUI

```bash
npm run test:api
```

## Features

- Tabbed sessions, custom title bar, sidebar (new / automation / plugins / search / tasks)
- Multi-provider OpenAI-compatible catalog
- Workspace file tree, Git status, terminal
- `@` file mentions, `/` skills, attachments
- Tools: list/read/find/grep, write/edit, shell, todos, ask-user, MEMORY.md
- Permission prompts, message queue, jump-to-bottom
- Ideas + interval automations
- Skill install from `SKILL.md`
- Tray resident process, light/dark appearance

## License

MIT
