# Reizo Studio

Local-first desktop agent for Reizo. Chat, workspace files, skills, and scheduled runs live on your machine.

## Stack

- Electron Forge + Vite (main / preload / renderer)
- React renderer, not a wrapped website
- In-process Hono on loopback

- JSON under userData/data

## Run
See package.json scripts: start, lint, test:api

### Add the Reizo (Winlume) provider

1. Open Settings, then Providers (left rail Settings).
2. Choose Reizo (Winlume). Copy: same backend as web Studio (Reizo BFF to new-api).
3. Paste a virtual key from the web Studio console. Do not commit secrets.
4. Base URL is the Winlume OpenAI-compatible endpoint. Pick a model and chat.

Other OpenAI-compatible providers stay available.

### Workspace tabs

Chrome-style tabs live in the custom title bar. Plus opens a blank new-chat tab. Open chats stay mounted while you switch, so draft, scroll, and in-flight streams survive. Chat tabs restore on restart if those sessions still exist.

### Projects

Left rail Projects: create a project, select it, and see its chats. New conversations pick up the selected project. Data is local JSON under userData/data/projects. Optional working rules go into the agent system prompt.

## Test

package.json script: test:api (headless Hono smoke test).

## Features

- Keep-alive workspace tabs, custom title bar, mode rail (Chat / Projects / Skills / Settings)
- Session artifacts panel (attachments and generated files)
- Multi-provider catalog including Reizo (Winlume)
- Workspace file tree, Git status, terminal
- Mentions, skills, attachments, permission prompts, automations

## License

MIT
