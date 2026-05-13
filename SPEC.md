# SPEC

## Vision

A roguelike investigative-journalism game where the player figures out what's happening in a soap-opera-rich small town. The core mechanic is logic puzzles, but puzzles aren't isolated — they form an interconnected network. Solving one reveals facts needed for others. NPCs lie about specific things tied to their motives. Some puzzles are partially unsolvable until cross-references resolve. The player publishes stories at the end of a run; wrong stories spawn retraction puzzles. JSON-driven content means every run rolls fresh characters and drama.

## Core Loop

Per run:

1. **Roll content**: characters, motives, theme, story arc — all drawn from JSON.
2. **Generate puzzle graph**: 5–10 interconnected puzzles with typed cross-edges, partial-information nodes, and a lie budget.
3. **Play**: the player works through puzzles, marking the grid, requesting hints, identifying lies, cross-referencing between puzzles.
4. **Publish**: the player commits to a story (a set of asserted facts). Correct stories advance the arc; wrong ones spawn retraction puzzles and degrade reputation.
5. **Run-end**: scored by golf-style turn count vs. par across all puzzles, plus a reputation score.

## Mechanics

### Logic puzzles (Phase 0, done)

Standard N-category × N-item grid with rich clue vocabulary:

- **Atomic**: Is, Not.
- **Positional** (11 types): NextTo, NotNextTo, ImmLeft, ImmRight, LeftOf, RightOf, ExactlyApart(d), Within(d), Between, AtEnd, NotAtEnd.
- **Operator-flavored**: OneOf, Either, Xor, Neither, IfThen.
- **Mixed**: compositional boolean formulas up to ~5 operands, depth 2.

Solving is by constraint propagation (exclusivity within categories, transitivity across categories, last-option exhaustion). The engine produces a deduction trace recording every derived fact, its source, and the propagation pass it fired on.

### Worksheet model (Phase 1, done)

Each cell in the player's worksheet has two independent layers:

- **Committed layer**: empty, ✕ (no-fact), or ✓ (yes-fact). These feed the engine.
- **Scratch layer**: a 1–2 character text label (e.g. `1`, `A`, `?`, `b2`). Engine-invisible; pure player annotation.

Both layers coexist freely — a cell can have both a committed mark and a scratch label.

**Tool palette** (radio-style, one active):

- **✕ tool**: tap toggles a committed ✕. Can only modify cells whose committed layer is empty or already ✕ (✓ cells are protected, taps are silent no-ops).
- **✓ tool**: mirror image — only blank-committed or ✓ cells.
- **Scratch tool**: tap a blank cell opens a label picker (text input + recent-label chips). Tap a cell with an existing scratch label opens the picker pre-filled for editing (with a remove button). Scratch can touch any cell regardless of its committed state.

**Display rules**:

- Scratch mode **off**: committed marks display normally; scratch labels display only on cells with no committed mark, and are rendered grayed.
- Scratch mode **on**: scratch labels display on every cell that has one (corner badge when a committed mark is also present, solo and centered when alone). Cells with committed ✕ get a red background tint; cells with committed ✓ get a green tint. Scratch labels render in normal ink.

### Hint system (Phase 1, done)

Three tiers plus a verify-marks button.

**Tier 1 — Next step**. From the player's current committed marks, run propagation and return the first newly derived fact whose source-chain terminus is a clue (not just cascade from existing marks). Render as a single sentence with the originating clue: "the [B-letterer] is NOT at position 1 — follows from clue: '[between phrasing]'."

**Tier 2 — Proof of a cell**. Same picking logic as Tier 1 (auto-pick first clue-driven fact), or accept a focus cell. Walk the source chain back to clue/mark terminus and render in forward order: clue or mark first, then each cascade step (`by exclusivity`, `by transitivity`, `only that option remains`), arriving at the target fact.

**Tier 3 — Solvability check**. Run propagation from current marks. Three outcomes:

- `solved`: report passes remaining to a unique solution.
- `underdetermined`: explain that current marks + clues aren't enough; suggest Tier 1.
- `contradiction`: the player's marks contradict the clues. **Routes inline to verify behavior**: reports only the count of incorrect marks ("you have N incorrect marks").

**Verify-marks**. Compares committed marks against the truth. Returns only a count of wrong marks — no cell highlighting, no per-cell flags. Scratch and blank cells are ignored. This count-only output is intentional: it preserves trust without revealing which cells are wrong.

For lie puzzles (Phase 4+), the tiers map to:

- Tier 1: highlight a contradiction set ("these three clues can't all be true").
- Tier 2: prove a specific clue must be the lie via contradiction.
- Tier 3: full uniqueness proof that only the asserted K corruption is consistent.

### Golf scoring (Phase 2, done)

**Turn semantics**:

- A "turn" is bounded by a single committed-tool type (✕ or ✓). The scratch tool is exempt.
- If the committed layer is unchanged from turn-start, the player may switch between any tools freely.
- If committed changes exist, switching between ✕ and ✓ (directly or via scratch) advances the turn counter. Switching to/from scratch is always free, and switching back to the turn's committed tool is always free.
- Scratch-layer changes never count toward "grid changed since turn-start."

**Cell restrictions** are part of the turn rule's enforcement: ✕ tool cannot touch ✓ cells (and vice versa). To swap a ✕ for a ✓ on the same cell, the player must remove the ✕ first (in ✕ tool), then add the ✓ in ✓ tool — costing a turn advance if commits exist.

**Par**. Each puzzle has a precomputed `par` representing the minimum number of turns to mark every derived fact under the symbol-per-turn rule. Algorithm: DP across propagation passes, state = which tool is held at pass end. Within a single mixed pass (yes-facts and no-facts both present), switching once gets you through if you end on the opposite tool you started with; same-end-as-start costs two switches. Initial tool selection is the first "move" (par ≥ 1 for any non-trivial puzzle). The displayed par scale matches the turn counter scale.

**Score** = total turns − par. Lower is better. A player who marks only the minimum cells needed for the engine to propagate the rest beats par.

### Mobile UI (current platform target)

The artifact's design target is **mobile-first** — overrides the original "mobile-first is a non-goal." Default grid dimensions are tuned to fit a 360px phone screen for all currently-supported sizes (3×3, 4×4, 5×5 with 4 categories). The grid is zoomable via a single CSS variable (`--grid-zoom`) driving every dimension through `calc()`; six zoom levels from 1× to 3×. The grid wrapper has `overflow-x: auto` with iOS momentum scrolling so zoom past viewport scrolls horizontally.

### Puzzle graph (Phase 3, planned)

Puzzles are nodes; typed cross-edges carry information from one puzzle to another.

**Edge model**: source slot in puzzle A → binding rule → target slot in puzzle B.

**Edge types** (initially three; more later):

- `value-at-cell`: A's specific cell value resolves a literal Is/Not in B.
- `geometric-pattern`: a geometric constraint on A ("the two cells whose distance is exactly 4 in some direction") identifies a set of cells in A whose values resolve a B clue. Finding which cells qualify is a sub-puzzle.
- `logical-relation`: A's relation between two items ("the pair connected by ImmLeft") supplies a fact to B.

**Resolution model (Option B)**: placeholder clues are visible in B from the start. The player sees `"the value of A's cell [3,2]"` literally and can plug the value in once A is solved. The dependent puzzle can be partially solved before its cross-edges resolve.

**Cycles are allowed**. Joint propagation runs across all nodes simultaneously as one constraint system. As long as the union has a unique model, the network is valid.

### Lying NPCs (Phase 4, planned)

Lies have the same shape as facts. They are not authored as a separate content type — they're generated.

**Generation flow**:

1. Generate puzzle with all-true clues.
2. Each clue is attributed to a speaker (NPC) via an attestation field.
3. Select K clues to corrupt (K = lie budget; a difficulty parameter). Selection biased toward NPCs with motives that fit the clue's topic.
4. Replace each chosen clue's assertion with a same-shape false variant ("Maya at seat 1" → "Maya at seat 3"; "Yuki sat next to Dax" → "Yuki sat next to Renard").
5. **Uniqueness verification**: enumerate other K-subsets of the N clues. For each, run the joint solver with those clues removed. If any *other* subset yields a uniquely-solved consistent puzzle, the corruption is ambiguous — reject and try again. Only ship if the actual K lies are the unique consistent corruption.

**Lie detection** is the same engine pointed at its own metadata. Each clue gets a truthfulness atom `L_C`. The constraint is "exactly K lies AND everything else consistent." Cross-puzzle consistency provides the constraints. The player solves a meta-puzzle whose atoms are clue-truthfulness vars.

### Retraction week (Phase 7, planned)

Player can commit (publish) a solution. If correct, the arc advances. If wrong:

- A retraction puzzle is spawned. Its categories include "what was wrong about the published story" — typically a smaller, denser puzzle about which clue the player misread.
- Reputation degrades. Mechanically: future puzzles get fewer clues, more underdetermined nodes, more dependency edges. The difficulty ramp emerges from in-fiction logic.

### Content / engine separation (Phase 5, planned)

The engine knows nothing about characters, drama, motives, or narrative. All such content lives in JSON files. The engine generates puzzle structure given a content roll; a separate narrative layer consumes the resolved facts and produces in-fiction text.

## Acceptance Criteria

Per phase (matches BUILD.md):

- **Phase 0 — Engine**: ✓ done.
- **Phase 1 — Hints + verify**: ✓ done. Verify-marks correctly flags wrong marks (count-only); Tier-1 returns a new fact when one is derivable; Tier-2 chains terminate at user marks or original clues; Tier-3 correctly answers "is this still solvable?" and routes contradictions to verify count.
- **Phase 2 — Par + golf**: ✓ done (par computation, turn mechanics, mobile-fit grid). Par matches hand-counted optimal play for small puzzles; symbol-switch counting handles the free-switch case correctly. **Deferred from original Phase 2 scope**: in-move undo, run-level score aggregation (will land with Phase 7).
- **Phase 3 — Graph + cross-edges**: two-puzzle graph with one cross-edge supports partial-solve B before A; hints trace through cross-edges; cycles converge to a unique solution.
- **Phase 4 — Lies**: generated lie puzzles are uniquely solvable; the actual K lies are the only K-subset whose removal restores consistency; lie hints identify suspect clues correctly.
- **Phase 5 — JSON content**: all gameplay content lives in JSON; engine has no hardcoded character/theme strings.
- **Phase 6 — Narrative**: resolved facts → coherent narrative beats; runs feel different despite shared skeletons.
- **Phase 7 — Game loop**: run state persists; retractions and reputation work end-to-end.

## Non-goals (for the foreseeable future)

- Real-time multiplayer.
- Procedural illustration / art generation.
- Voice or audio.

(Mobile-first is **explicitly the platform target**, replacing the earlier "non-goal" framing.)
