# Logic Puzzle Game

Roguelike investigative-journalism game built on a logic puzzle engine.
Phase 0–2 are implemented (engine, hints + verify, golf scoring + mobile).
Phase 3 (puzzle graph + cross-edges) is the active work.

## Development

```sh
npm install
npm run dev
```

## Documentation

- `SPEC.md` — vision, mechanics, per-phase acceptance criteria
- `SCHEMA.md` — data structures and JSON content shapes
- `BUILD.md` — phased implementation plan
- `DIGEST.md` — conversation-style notes from prior chats
- `OPENING_PROMPT.md` — handoff prompt for a fresh chat

## Current state

`src/App.jsx` is a single-file artifact at ~2790 lines containing the entire engine + UI for Phases 0–2. Stage B of the modularization (planned for the start of Phase 3) splits this into the layout described in `BUILD.md`.
