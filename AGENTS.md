# AGENTS.md

Rules for AI agents working in this repository. Architecture and commands live in `CLAUDE.md`.

## UI copy: no explanatory text

Keep every screen minimal. Do not add text that explains the UI to the user.

- Let the component, its state and motion carry the meaning: icons, labels on controls, selected/disabled/loading states, transitions, tooltips on icon-only buttons.
- Do not add helper paragraphs, subtitles, hint lines, "how to use" sentences, or descriptions under titles, fields, empty states or dropdown options.
- Do not repeat what is already visible: no type label beside an identical title, no section label above a single obvious control, no group label inside a dropdown that the trigger already names (use `aria-label` instead).
- Placeholders are short (a few words), not instructions.
- Empty states: one short title and the primary action. Show progress with a spinner or motion, not a sentence describing it.
- Errors and destructive confirmations are the exception: say what went wrong and what to do, briefly.
- When unsure, leave the text out. Add copy only when the user cannot act without it.
