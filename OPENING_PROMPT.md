# OPENING_PROMPT

Paste this into a new chat to pick up where this one left off.

---

I'm continuing work on a roguelike investigative-journalism game built on a logic puzzle engine. The current state of work is captured in four handoff docs and a working React artifact:

- **`DIGEST.md`** — what happened in the previous chats, decisions made, conversation-style notes. Read this first.
- **`SPEC.md`** — the vision, mechanics, and per-phase acceptance criteria.
- **`SCHEMA.md`** — data structures, types, JSON content shapes.
- **`BUILD.md`** — phased implementation plan with dependencies and scope estimates.
- **`logic_puzzle_generator.jsx`** — the working artifact (~2790 lines). It currently implements Phases 0, 1, and 2: the constraint engine, the hint system + verify-marks, golf-scoring par + turn mechanics, the three-tool worksheet (X/✓/scratch with edit-able scratch labels), and a mobile-fit zoomable grid.

Read them in order: DIGEST → SPEC → SCHEMA → BUILD. Then look at the artifact.

We're starting **Phase 3: puzzle graph + cross-edges**. Acceptance criteria are in BUILD.md under Phase 3. The short version:

- A `PuzzleGraph` of `Puzzle` nodes connected by typed `CrossEdge`s.
- One edge type to start: `value-at-cell` with `literal-value` binding. ("In puzzle B, clue 4's first atom is the value at puzzle A's cell [3,2].")
- **Placeholder model (Option B)**: target puzzles show cross-references explicitly from the start (`"the value of A's cell at position 2 for Guest"`). Once A determines that value, the placeholder resolves and B's propagation uses it.
- Joint propagation across all nodes — cycles allowed as long as the union has a unique model.
- Hint system traces through cross-edges (Tier 2 chains may walk into another puzzle).
- Multi-puzzle navigation UI for mobile (probably tab/swipe-based).

A few approach notes from prior chats that should carry over:

- Approach this as a collaborative design partner. Surface tensions, engage with them. There are several open design questions in BUILD.md for Phase 3 (procedural vs. explicit edge authoring, per-puzzle vs. graph-level par, etc.) — raise them before coding.
- The user is technical and has built logic puzzle generators before. Don't over-explain mechanics they already know.
- When the user says "YES EXACTLY" or commits to an option, that's settled. Don't relitigate.
- **Mobile-first is the platform target.** This overrides the original SPEC's "mobile-first is a non-goal" framing — the SPEC has been updated. Grid is currently zoomable via a `--grid-zoom` CSS variable; respect that pattern for any new dimensions you introduce.
- Strong aesthetic preferences. The artifact's dossier theme (Fraunces serif display, JetBrains Mono body, warm paper background, oxblood accents) stays. New UI elements should be composed from the existing class vocabulary (`pin-card`, `ink-*`, `stamp`, `ctrl-btn`, `tool-btn`, etc.).
- The user values surfacing concerns proactively. "Will this be misread as a broken puzzle?" is a legitimate design concern. "Will cross-edge resolution be discoverable on a phone screen?" is the same flavor of question for Phase 3.

Before writing any code:

1. Walk me through your plan for the graph data model and joint propagation. Specifically:
   - How does `solveFromState` extend to operate over a graph rather than a single puzzle's table? Probably one shared "table view" that joins per-puzzle tables, with edge resolution happening as a propagator step. But there are alternatives.
   - When a placeholder clue is unresolved, what does the engine do with it? Skip in propagation, or contribute partial information?
   - How does the existing hint API extend? Tier-2 chains that cross edges need a new step kind. The chain-rendering UI needs to display which puzzle a fact came from.
   - Tool palette / turn counter — are these per-puzzle, or is there a single active puzzle at a time?
2. Anything ambiguous in the spec — surface it. BUILD.md has open design questions listed under Phase 3; address those.
3. The artifact is at ~2790 lines and bumping against single-file limits. Is Phase 3 the right moment to split into modules? The target layout is in BUILD.md. Or do we squeeze one more phase out of the single file?

If you want to look at the artifact code first to ground the plan, do that. Key functions to extend are `solveFromState`, `pushFact`, `hintTier1/2/3`, and the `propagate` methods on clue objects. The cell-state shape in `gridState` and the trace `source` shapes are documented in SCHEMA.md — preserve their invariants.
