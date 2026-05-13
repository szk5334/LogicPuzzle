# BUILD

Phased implementation plan. Each phase is shippable on its own. Later phases assume earlier ones; everything composes on top of the constraint engine.

## Phase 0 — Logic Puzzle Engine ✓ DONE

**Status**: implemented in `logic_puzzle_generator.jsx`.

**Contents**:

- Constraint propagation engine: exclusivity (one yes per row/column), transitivity (yes/no facts cascade across categories), last-option (only-one-left forces yes).
- Clue grammar: atomic (Is/Not), 11 positional types, 5 operator-flavored types, and a compositional mixed-formula type. All non-positional non-atomic clues route through a generic `clueFormula` propagator that enumerates 2^n atom assignments and derives facts that hold in every consistent assignment.
- Generation: random solution → enumerate every true clue → greedy add until propagation determines uniqueness → minimize by removing redundant clues → re-solve for trace.
- Sample-and-filter: generate N candidates (1/5/10/25), score each by `passes × leverage + diversity − clue-count penalty`, ship the best. Histogram of candidate scores visible to the user.
- Difficulty bias: per-type weight tables (easy/medium/hard) that bias the greedy ordering of candidate clues.
- Three themes (classic, soapOpera, noir) sharing a `renderClueShared` function via per-theme primitives (`phrase`, `propLine`, `renderPositional`).

---

## Phase 1 — Hint System + Verify-Marks ✓ DONE

**Shipped**:

1. **Engine refactor**: `solveWithClues` is now a thin wrapper for `solveFromState(categories, clues, initialMarks, trace)`. Marks are seeded via `pushFact` with `source: {type: 'mark'}` so cascade fires and any trace walking terminates cleanly at marks. A `{marker: 'mark-seed'}` precedes the seed phase in the trace.
2. **`verifyMarks(puzzle, gridState)`** — returns `{status, count}` only. No per-cell flagging, no truth disclosure. Scratch and blank cells are ignored.
3. **`hintTier1(puzzle, gridState)`** — runs `solveFromState`, finds the first newly-derived fact post-pass-start whose source-chain terminus is a clue (cascade-from-marks facts are filtered out as trivially derivable). Returns `{tier:1, fact, originClue, chain}`.
4. **`hintTier2(puzzle, gridState, focusCell?)`** — same picker logic, but returns the full proof chain. Chain walks `source.from` through cascades until a clue or mark terminus. UI renders the chain reversed (forward reading: clue/mark → cascade steps → target).
5. **`hintTier3(puzzle, gridState)`** — runs `solveFromState` from current state; returns `{status: 'solved' | 'underdetermined', passes}`. **Contradiction case routes inline to verify-mark count** per user spec — all three tiers short-circuit to `{contradiction: true, count}` on mark contradictions.
6. **UI**: hint button cluster (T1/T2/T3 + verify) above the worksheet grid. `HintResult` component renders all tier outputs in theme-aware prose using `theme.propLine` and `theme.renderClue`.
7. **Worksheet state refactor**: gridState shape changed from `{[canonKey]: 'x'|'o'|'check'}` to `{[canonKey]: {catA, a, catB, b, committed, scratch}}`. Coordinates stored inline so iteration never decodes canonKey. Independent committed/scratch layers.
8. **Tool palette** (three-way radio): `x` / `check` / `scratch`. Replaces the prior tap-cycle model. Scratch is a separate annotation layer with its own picker UI.
9. **Scratch picker**: modal with 1–2 char input, recent-label chips (capped at 6), edit-on-tap for existing labels (with `remove` button), `place`/`save` action.

**Notes vs. original plan**:
- The original plan envisioned verify-marks with per-cell error highlighting. User explicitly requested **count-only output, no cell highlighting** — to preserve trust without spoiling locations.
- Tier-3 contradiction routing to verify-count is also a user-spec decision (originally Tier 3 was meant to be a pure solvability check; now it serves double duty when player marks are wrong).
- The old `o` (tentative-yes) cycle state is gone entirely. Scratch labels with arbitrary text replace it and are more expressive.

---

## Phase 2 — Par Solver + Golf Scoring ✓ DONE

**Shipped**:

1. **Par computation** (`computePar(puzzle)`). DP across propagation passes with state = tool held at pass end. Group `puzzle.trace` by `pass-start` markers; count yes-facts and no-facts per pass; compute minimum tool-switches.
   - Both-types-in-pass: same-end-as-start = 2 switches, different-end = 1 switch.
   - Only-one-type-in-pass: must end on matching tool; 0 or 1 switch.
   - Par returned as `minSwitches + 1` to match the displayed turn-counter scale.
   - Verified empirically across sizes — 3×3 par 2, 4×4 medium par 3–6 (mode 4), 5×5 hard par 3–6 (mode 5).
   - Stored as `puzzle.par` at generation time.
2. **Turn mechanics** in the UI:
   - State: `turnNumber`, `turnStartGrid`, `lastCommittedTool`.
   - `selectTool(newTool)` routes through turn logic. Switching X↔✓ (directly or via scratch) advances the turn iff the committed layer differs from `turnStartGrid`. Scratch is transparent — entering it is always free, exiting back to `lastCommittedTool` is free.
   - **Scratch changes do not count as "grid changed."** Only committed-layer changes lock the turn.
3. **Cell-restriction rule** (per active tool): X tool can only touch blank or X cells; ✓ tool only blank or ✓ cells. Scratch can touch anything. Disallowed cells render dimmed with `cursor: not-allowed`; taps are silent no-ops.
4. **UI affordances**:
   - Turn counter `Turn N / par M` in the worksheet header. `N` highlights red when over par.
   - Tool buttons get a red `+1` pip when clicking would advance the turn.
   - Status line below the palette: "locked to ✕ this turn — switching ends it" when applicable.
5. **Mobile-fit grid + zoom controls**:
   - All grid dimensions derive from a single `--grid-zoom` CSS variable via `calc()`.
   - Base sizes tuned to fit 5×5×4-cats in 360px: cells 18px, row-labels 44px (with ellipsis), col-labels 46px, cat-row 14px.
   - Zoom control: `−` / current-level / `+`, six steps (1, 1.25, 1.5, 2, 2.5, 3).
   - Grid wrapper has `overflow-x: auto` with iOS momentum scrolling — zoom past viewport scrolls horizontally.

**Deferred from original Phase 2 scope** (will land with Phase 7):
- **In-move undo**: any same-symbol mark made in the current turn undoable without incrementing the counter. Current implementation toggles cells (re-tap removes), which gives "live undo" for committed marks, but there's no proper move history. Defer until the full run loop wants it.
- **Run-level score aggregation**: total moves − total par across all puzzles in a run. Needs the multi-puzzle context from Phase 3 / Phase 7.

---

## Phase 3 — Puzzle Graph + Cross-Edges (NEXT)

**Scope**:

1. **Graph data model** (per SCHEMA.md).
2. **Joint propagation**: a single propagator pass runs over the entire graph's tables. Cross-edges contribute facts in one direction (source resolved → target slot filled).
3. **One edge type to start**: `value-at-cell` with `literal-value` binding. ("In puzzle B, clue 4's first atom is the value at puzzle A's cell [3,2].")
4. **Placeholder clues**: a clue with an unresolved edge target renders as "[the value of A's cell at position 2 for Guest]". Once A determines that value, the placeholder resolves to the literal and B's propagation can use it.
5. **Cross-puzzle uniqueness check**: validate at generation time that the full graph has exactly one model.
6. **Multi-puzzle UI**: navigator between puzzle nodes; placeholder display; visual link indicators showing which clues are cross-referenced.
7. **Hint trace through cross-edges**: Tier-2 proof chains that walk into another puzzle should render the cross-edge as a labeled step.
8. **Mobile-first navigation**: switching between puzzle nodes on a phone screen is a primary UX concern. Probably tab/swipe-based.

**Dependencies**: Phase 1 + Phase 2 (both done).

**Files** (still single-artifact for now):

- Engine: graph module, edge resolver, joint propagator.
- UI: puzzle navigator panel; cross-reference visualization.

**Acceptance**:

- Two-puzzle graph with one cross-edge: B is partially solvable before A; fully solvable after A.
- Hint system traces through cross-edges and reports them as part of proof chains.
- A simple cycle (A↔B with one fact each direction) converges to a unique solution if and only if such a solution exists.
- Turn counter and par work across the graph (each puzzle has its own turn count and par; run-total is sum).

**Estimated effort**: 700–1000 lines.

**Open design questions**:

- How do we author cross-edges per puzzle in generation? Either explicitly via story arc definitions, or procedurally by sampling pairs of puzzles and finding fact-pairs to bridge.
- What happens if a placeholder never resolves (e.g., source puzzle remains unsolved)? Target stays partially-solved indefinitely; that's the player's problem.
- Per-puzzle vs. run-level par: when scoring a multi-puzzle run, do we sum per-puzzle pars, or compute a graph-level par that considers cross-edge resolution as a "free derivation"? Probably per-puzzle sum to keep the math clean.

---

## Phase 4 — Lie Corruption + Detection

**Scope**:

1. **Clue attestation**: extend `Clue` with speaker/occasion/context/topic fields. Generation assigns attestation per clue based on theme rules.
2. **Corruption generation**: pick K clues to corrupt, biased by NPC motive matching. For each, replace assertion with a same-shape false variant.
3. **Uniqueness verification**: enumerate other K-subsets of the puzzle's clues. Run the joint solver with each subset removed. If any other subset yields a uniquely-consistent puzzle, reject and re-roll the corruption.
4. **Lie-detection meta-puzzle**: derive a separate puzzle whose atoms are `L_C` truthfulness vars. Constraints come from cross-puzzle consistency. The player solves it like any other logic puzzle.
5. **Hint extensions**: contradiction-set highlights, "this clue must be the lie" proofs via assume-true-derive-contradiction.

**Dependencies**: Phase 3. Cross-edges provide most of the constraints that make lie detection tractable.

**Estimated effort**: 500–800 lines.

---

## Phase 5 — JSON Content Layer

**Scope**: lift all character/theme/secret/motive content out of the engine into JSON files. Engine reads JSON, generates puzzles. Per-run rolls of characters and arcs.

**Files**:

- `content/characters.json`, `themes.json`, `motives.json`, `edge_grammars.json`, `story_arcs.json`.
- Engine: content loader; theme rendering driven by JSON `phraseTemplates`.

**Acceptance**:

- All gameplay content lives in JSON.
- Engine has a default content set so it can run without overrides.
- New runs produce visibly different character/theme combinations.

**Estimated effort**: 200–400 lines + content authoring.

---

## Phase 6 — Narrative Engine

**Scope**:

1. Consume resolved facts from solved puzzles.
2. Produce in-fiction text: detective monologue, NPC dialogue, gossip-column entries.
3. Templated narrative skeletons with LLM rewriting for variety. Use the Claude API from within the artifact (see anthropic_api_in_artifacts).

**Dependencies**: Phase 5.

**Acceptance**:

- Solved facts produce coherent narrative beats consistent with the arc.
- Each run feels different even with the same arc skeleton.

**Estimated effort**: 400–600 lines.

---

## Phase 7 — Full Game Loop

**Scope**:

1. Run state persistence (artifact persistent storage API).
2. Puzzle commit / publication mechanic.
3. Retraction puzzle generation on wrong commits.
4. Reputation tracking and effects on subsequent puzzle generation.
5. End-of-run summary screen with score breakdown.
6. **In-move undo + move history** (deferred from Phase 2) — proper undo stack scoped to the current turn.
7. **Run-level score aggregation** — sum of `(turns − par)` across all puzzles in the run.

**Estimated effort**: 500–800 lines.

---

## Total scope estimate

~2200–3200 lines beyond the current artifact (~2790 lines, after Phases 0–2). Buildable in phases over many sessions. Phase 3 (graph) is the natural next step and the gateway to the bigger game.

## Testing approach

- Smoke tests run the engine end-to-end across sizes 3–5 × difficulties × N samples, asserting that all generated puzzles are uniquely solvable and that render functions don't throw.
- Property tests: generated lie puzzles must satisfy the uniqueness invariant (the actual K lies are the only consistent K-subset).
- Phase-1 verify-marks: invariant that it returns count=0 when the player has not yet made any committed mark, or has only made correct marks. **Verified empirically — 20/20 random puzzles pass with empty grid.**
- Par solver: hand-counted small cases as ground truth. **Verified empirically against synthetic traces and against the displayed turn count for the proof-perfect path.**
- Turn mechanics: 16-scenario unit test in dev covering all transition paths between X/✓/scratch with and without commits, including the critical X(commit) → scratch → ✓ → X case where the round-trip is free at turn 2.

## File layout (target)

The current artifact is a single .jsx file (~2790 lines). Splitting recommended from Phase 3 onward:

```
src/
  engine/
    propagation.js
    formula.js
    clues/
      atomic.js
      positional.js
      operator.js
      formula.js
    generator.js
    minimizer.js
    scorer.js
    par.js          # Phase 2 (done)
    hints.js        # Phase 1 (done)
    verify.js       # Phase 1 (done)
  graph/
    nodes.js
    edges.js
    joint-propagator.js
  lies/
    corruption.js
    detector.js
  content/
    loader.js
  narrative/
    templater.js
    llm-rewriter.js
  game/
    state.js
    run-loop.js
  ui/
    (React components)
```
