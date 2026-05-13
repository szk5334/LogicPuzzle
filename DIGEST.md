# DIGEST

What was discussed across the conversations that produced this document set, and where the project currently stands.

## What's been built

`logic_puzzle_generator.jsx` — a working React artifact (~2790 lines) implementing **Phase 0, Phase 1, and Phase 2** of the build plan.

### Phase 0 — Engine (foundation)

- Constraint propagation: exclusivity, transitivity, last-option exhaustion.
- Rich clue vocabulary: 2 atomic + 11 positional + 5 operator-flavored + compositional mixed (boolean formulas up to depth 2, 5 operands). All non-atomic non-positional clues route through a generic `clueFormula` propagator that enumerates 2^n atom assignments.
- Generation: random solution → enumerate true clues → greedy add with difficulty-bias weights → minimize → re-solve for trace.
- Sample-and-filter: best-of-N (1/5/10/25) by `passes × leverage + diversity − clue-count` interestingness score.
- Three themes (classic, soapOpera, noir) sharing a `renderClueShared` dispatcher with per-theme primitives.

### Phase 1 — Hints + Verify

- `solveFromState` is the new core solver; `solveWithClues` is a thin wrapper for the empty-seed case.
- Player marks seed propagation via `pushFact` with `source: {type: 'mark'}`. Trace gets a `{marker: 'mark-seed'}` entry before the first pass-start.
- `verifyMarks` returns **count only**, no per-cell flags. Scratch ignored.
- `hintTier1` — first newly-derived clue-driven fact + originating clue.
- `hintTier2` — full proof chain. UI renders forward (clue/mark → cascade → target).
- `hintTier3` — solvability check. Contradiction routes inline to verify count for all three tiers.
- `HintResult` component renders all tier outputs in theme-aware prose.

### Phase 2 — Golf scoring + mobile

- **Two-layer cells**: every cell has independent `committed` (✕/✓/null) and `scratch` (text/null) layers.
- **Three tools**: `x` / `check` / `scratch`. Radio-style, one active. Scratch-tool tap on blank cell opens a label picker (1–2 chars, recent-label chips); tap on existing scratch opens picker pre-filled with `remove` button.
- **Cell restrictions**: ✕ tool can only modify blank or ✕ cells. ✓ tool only blank or ✓ cells. Scratch can touch anything. Disallowed cells dim with `cursor: not-allowed`.
- **Turn mechanics**: `turnNumber` advances when player switches between ✕ and ✓ tools (directly or via scratch) iff the committed layer has changed since turn-start. Scratch is transparent — entering/exiting always free. Scratch changes don't count as "grid changed."
- **Par**: precomputed at generation time via DP across propagation passes. Stored as `puzzle.par`. Distribution: 3×3 → par 2, 4×4 medium → 3–6 (mode 4), 5×5 hard → 3–6 (mode 5).
- **Mobile-fit grid**: all dimensions driven by `--grid-zoom` CSS variable. Default sizes fit 5×5×4-cats in 360px. Zoom control with 6 levels (1× to 3×). Grid wrapper has `overflow-x: auto` with iOS momentum scrolling.

## Key design decisions (settled)

These came up in conversation and were resolved explicitly. Do not relitigate.

### Worksheet model

- **Old "tap cycle" is dead.** No more blank → X → O → ✓ → blank. The cycle was reductive — it conflated tentative-yes with committed-yes and forced ordering. Replaced by three independent tool toggles.
- **Scratch is text, not just one symbol.** Player picks any 1–2 character label per cell. Engine ignores all scratch. The "tentative" concept is replaced by free-form annotation.
- **Scratch labels survive committed marks.** Tapping ✕ on a cell with a scratch label preserves the label (it just becomes hidden in non-scratch mode). Toggling into scratch mode re-reveals it. Notes are never lost without explicit removal.
- **Display: scratch mode OFF = scratch labels only on blank-committed cells, grayed. Scratch mode ON = labels on every cell that has one (corner badge if committed, solo if alone), full color, with red/green tints on cells with committed ✕/✓.**

### Hint behavior

- **Verify-marks output is count-only.** No per-cell flags. The player is told *how many* are wrong, never *which*. This preserves trust without spoiling solution structure.
- **Tier-3 contradiction routes inline to verify count.** When the player's marks contradict the clues, all three tiers short-circuit and return the same "you have N incorrect marks" response.
- **Tier-1 filters cascade-from-marks.** The "first new fact" must have a clue terminus in its source chain — pure cascade from existing player marks doesn't count as a useful hint.
- **Tier-2 chain rendering is forward** (clue/mark first, target last). The internal data structure walks target → terminus, but the UI reverses for natural reading.
- **Tier-2 doesn't recurse into clue dependencies.** Clues are leaves of the proof tree. The chain terminates at the clue without explaining what the clue itself needed from the table. Acceptable per BUILD.md acceptance criterion.

### Turn / par mechanics

- **A turn is one committed-tool type.** Switching ✕↔✓ mid-turn with commits advances the turn counter.
- **Scratch is exempt.** You can dip into scratch at any time, do as much annotation as you want, and come back to your committed tool without cost. Switching from scratch to the *other* committed tool follows the same X↔✓ rule.
- **"Grid changed" means committed layer only.** Scratch is free annotation — making scratch notes shouldn't cost turn budget.
- **Par follows BUILD.md spec**: minimum tool-switches to mark every derived fact. A player who marks fewer than every fact (e.g., only yeses and lets the engine derive nos) beats par. Par is the "thorough-player" benchmark, not the absolute floor.
- **Cell restrictions enforce the turn rule physically.** ✕ tool can't clobber ✓ marks. To swap a ✕ for a ✓ on a cell, you must remove the ✕ first (in ✕ tool), then add the ✓ in ✓ tool — costing a turn if commits exist.

### Mobile-first

- **Mobile-first is now the explicit platform target.** Overrides the earlier "non-goal" framing. Grid sizes are tuned to fit a 360px phone at 1× zoom across all current size options (3×3, 4×4, 5×5 with 4 cats).
- **Cells are small (18px) but zoomable.** User explicitly accepted small default cells in exchange for the whole grid fitting on screen. Zoom-up scales everything via a single CSS variable; the wrapper scrolls when zoomed past viewport.

### Conversation-level decisions filed for later phases

- **Cross-puzzle edges: placeholder model (Option B).** Dependent puzzles show their cross-references explicitly from the start. Partial solves before resolution are possible.
- **Circular cross-puzzle dependencies allowed.** Joint propagation across the full graph.
- **Geometric edges as sub-puzzles.** "The pair whose distance is exactly d" forces sub-reasoning.
- **Lies are generated, not authored.** K-subset corruption + uniqueness verification.
- **Lie detection = same engine on metadata.** Truthfulness atoms `L_C`, conditional constraints.
- **Retraction week.** Wrong publications spawn retraction puzzles, degrade reputation, ramp difficulty in-fiction.
- **JSON content separation.** Engine knows nothing about characters/drama; all content rolled per-run.

## What was filed but not yet decided

- Lie budget per difficulty (proposed easy=0, medium=1, hard=3, unvalidated).
- Edge density per arc (sparse vs. dense networks).
- Reputation effects on puzzle generation (which dial does it move?).
- Save/load strategy (artifact persistent storage API is available).
- Authoring vs. procedural cross-edge generation.
- LLM-rewriting for narrative variety (probably yes, via Claude API in artifacts).
- Per-puzzle vs. graph-level par for multi-puzzle scoring (probably per-puzzle sum).

## Notable technical decisions

1. **Grid state stores coordinates inline.** Each cell value carries `{catA, a, catB, b, committed, scratch}` — never decode canonKey to iterate. Future-proof if categories ever contain `::` or `||` characters.

2. **Trace source extended with `'mark'` type.** Cleanly distinguishes player-mark terminus from clue terminus. Existing trace consumers (`metricsFor`, `TraceView`, `scoreInterestingness`) handle unknown source types gracefully.

3. **`puzzle.trace` stays clean of mark sources.** Generation calls `solveFromState([])`, so the puzzle's static trace never contains mark sources. Hint-time traces are computed fresh per request from the player's gridState.

4. **Par DP across passes, not facts.** Each pass is a "round" within which marks can be batched by tool. Cross-pass tool state carries over. Yields tractable computation and intuitive numbers.

5. **All grid dimensions via one CSS variable.** `--grid-zoom` × base values gives every dimension (cell, label, font) via `calc()`. Single knob, no JS-side resize logic.

6. **Three-tool palette replaces tap cycle.** The cycle was always going to be a problem for golf scoring — cycling clobbered existing marks unpredictably. Independent tools with cell restrictions make turn semantics enforceable.

## Conversation style notes (for handoff)

- The user is a programmer who has previously built logic puzzle generators. Don't over-explain mechanics.
- They prefer collaborative design discussion. Open with thinking-out-loud about tensions; don't jump straight to code.
- When they say "YES EXACTLY" or commit to an option, that's settled. Don't relitigate.
- Strong aesthetic preferences. The dossier theme (Fraunces serif display, JetBrains Mono body, warm paper background, oxblood accents) is locked.
- **Mobile-first is the platform target now.** Even though SPEC originally said otherwise, user clarified intent and SPEC has been updated.
- They surface concerns proactively. "I have a feeling people would claim hard puzzles are impossible" is a real design constraint, not paranoia — that's why verify-marks exists and outputs only a count.
- They make decisions fast and explicitly. When they spec a behavior, take it literally and ask only about genuinely ambiguous edges. The X(commit)→scratch→✓ "does this end the turn?" question is the kind of thing worth confirming; "should I add some flair to the UI?" is not.
- They like keeping big-game ideas filed separately from immediate work. The journalism-game vision was tagged as "its own riff" early; we touch it via SPEC and BUILD without letting it derail Phase-N work.

## Outstanding immediate work

**Phase 3 — Puzzle graph + cross-edges** is the next concrete build. SPEC and BUILD have the acceptance criteria. The OPENING_PROMPT.md file is the suggested kickoff for a fresh chat.

The artifact's current shape (single `.jsx` file, ~2790 lines) is approaching the limit of maintainability. Phase 3 is the natural inflection point for splitting into modules per the file layout in BUILD.md.
