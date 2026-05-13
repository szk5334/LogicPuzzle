# SCHEMA

Data structures and content shapes. TypeScript-style interfaces for readability; the actual implementation is JavaScript.

## Engine

### Puzzle

```ts
type Categories = Record<string, (string | number)[]>;

type Solution = Array<Record<string, string | number>>;
// One row per anchor item, each row maps every category to its item for that row.

interface Puzzle {
  id?: string;
  categories: Categories;
  anchorKey: string;             // category whose items are ordered (e.g. 'seat')
  solution: Solution;
  clues: Clue[];
  trace: TraceEntry[];
  status: 'solved' | 'underdetermined' | 'contradiction';
  passes: number;                // depth of deduction
  par: number;                   // Phase 2: precomputed minimum-turn count
  _score?: number;               // Phase 0 interestingness score
  contradictionSource?: 'marks' | 'propagation';  // set only when status=contradiction
}
```

### Clue

```ts
type ClueType =
  | 'is' | 'not'
  | 'nextTo' | 'notNextTo'
  | 'immLeft' | 'immRight'
  | 'leftOf' | 'rightOf'
  | 'exactlyApart' | 'within'
  | 'between'
  | 'atEnd' | 'notAtEnd'
  | 'oneOf' | 'either' | 'xor' | 'neither' | 'ifThen'
  | 'mixed' | 'formula';

interface Clue {
  type: ClueType;
  // Type-specific fields (catA/a/catB/b for binary, catC/c for ternary, dist, formula, etc.)
  test(sol: Solution): boolean;
  propagate(table: ConstraintTable, trace: TraceEntry[]): {
    ok: boolean;
    changed?: boolean;
  };

  // Phase 4+
  attestation?: Attestation;
  speakerId?: string;
}
```

### Formula AST

```ts
type Atom = {
  kind: 'atom';
  catA: string; a: string | number;
  catB: string; b: string | number;
  polarity: 'yes' | 'no';
};

type Formula =
  | Atom
  | { kind: 'and' | 'or' | 'xor'; children: Formula[] }
  | { kind: 'not'; child: Formula };
```

### Constraint table

```ts
interface ConstraintTable {
  categories: Categories;
  facts: Map<string, 'yes' | 'no'>;
  // Key is canonKey(catA, a, catB, b) — canonicalized so (A,a,B,b) and (B,b,A,a) collide.
}
```

### Trace

```ts
type TraceEntry =
  | { marker: 'pass-start'; pass: number }
  | { marker: 'mark-seed' }       // Phase 1: precedes player-mark seeding in solveFromState
  | FactEntry;

interface FactEntry {
  catA: string; a: string | number;
  catB: string; b: string | number;
  value: 'yes' | 'no';
  source: TraceSource;
}

type TraceSource =
  | { type: 'clue'; clue: Clue }
  | { type: 'mark' }                           // Phase 1: player-mark terminus
  | {
      type: 'exclusivity' | 'transitivity' | 'last-option';
      from: FactEntry;                         // parent fact that triggered this cascade step
    };
```

### Attestation (Phase 4)

```ts
interface Attestation {
  speakerId: string;             // character id from characters.json
  occasion: string;              // narrative context label
  context: 'interview' | 'overheard' | 'document' | 'observation';
  topic?: string;                // for motive matching during lie selection
}
```

## Solver API

```ts
// Solve from an arbitrary starting state. solveWithClues is a thin wrapper for [] initial marks.
function solveFromState(
  categories: Categories,
  clues: Clue[],
  initialMarks: Array<{ catA: string; a: any; catB: string; b: any; value: 'yes' | 'no' }>,
  trace: TraceEntry[] | null
): {
  table: ConstraintTable;
  status: 'solved' | 'underdetermined' | 'contradiction';
  passes: number;
  contradictionSource?: 'marks' | 'propagation';
};

function solveWithClues(
  categories: Categories,
  clues: Clue[],
  trace: TraceEntry[] | null
): ReturnType<typeof solveFromState>;
```

When `initialMarks` is non-empty, `solveFromState` emits a `{marker: 'mark-seed'}` trace entry followed by mark facts (each with `source: {type: 'mark'}`) before the first `pass-start`. This makes any later trace-walking terminate cleanly at marks vs. clues.

## Worksheet state (Phase 1+)

### Grid

```ts
interface CellState {
  catA: string; a: string | number;     // coordinates stored inline — never decode canonKey
  catB: string; b: string | number;
  committed: 'x' | 'check' | null;       // X/✓ feed engine; null = blank-committed
  scratch: string | null;                // 1–2 char label; engine-invisible
}

type GridState = Record<string, CellState>;  // keyed by canonKey(catA, a, catB, b)
// Cells with neither committed nor scratch are deleted from the record entirely.
```

### Tool / turn state

```ts
type ToolKind = 'x' | 'check' | 'scratch';

interface WorksheetState {
  tool: ToolKind;
  gridState: GridState;

  // Turn mechanics (Phase 2)
  turnNumber: number;                   // starts at 1
  turnStartGrid: GridState;             // committed-layer snapshot at start of this turn
  lastCommittedTool: 'x' | 'check' | null;  // the committed tool that owns this turn

  // Scratch picker
  scratchPicker:
    | { key: string; catA: string; a: any; catB: string; b: any; editing: boolean }
    | null;
  scratchInput: string;
  recentLabels: string[];               // most-recent first, capped to 6

  // Grid zoom (mobile-first display)
  gridZoom: number;                     // 1 | 1.25 | 1.5 | 2 | 2.5 | 3
}
```

**Turn-advance rule** (formal):

```
selectTool(newTool):
  if newTool === currentTool: noop
  if newTool === 'scratch': set tool='scratch'; lastCommittedTool unchanged.
  else if lastCommittedTool === null: set tool, claim lastCommittedTool = newTool.
  else if newTool === lastCommittedTool: set tool (free return from scratch).
  else (newTool is X/✓ and differs from lastCommittedTool):
    if committedDiffers(gridState, turnStartGrid):
      turnNumber++; turnStartGrid = snapshot(gridState); lastCommittedTool = newTool; tool = newTool.
    else:
      lastCommittedTool = newTool; tool = newTool.

committedDiffers(a, b):
  any canonKey k where (a[k]?.committed ?? null) !== (b[k]?.committed ?? null).
  // Scratch differences are ignored — scratch is free annotation.
```

**Cell-restriction rule** (per active tool):

```
canModifyCell(cell, tool):
  if tool === 'scratch': true
  if tool === 'x':     cell.committed in (null, 'x')
  if tool === 'check': cell.committed in (null, 'check')
```

## Hint API (Phase 1, shipped)

```ts
interface HintBase {
  tier: 1 | 2 | 3;
}

// Tier 1 — first new clue-driven fact
type HintT1 = HintBase & ({
  tier: 1;
  fact: FactEntry;
  originClue: Clue;
  chain: ProofStep[];
} | {
  tier: 1; noProgress: true;
} | {
  tier: 1; contradiction: true;
  status: 'has-errors'; count: number;     // from verifyMarks
});

// Tier 2 — full proof chain for a fact
type HintT2 = HintBase & ({
  tier: 2;
  fact: FactEntry;
  chain: ProofStep[];          // ordered target → terminus; UI renders reversed for forward reading
} | {
  tier: 2; noProgress: true;
} | {
  tier: 2; focusUnreachable: true;
} | {
  tier: 2; contradiction: true;
  status: 'has-errors'; count: number;
});

// Tier 3 — solvability check
type HintT3 = HintBase & ({
  tier: 3;
  status: 'solved'; passes: number;
} | {
  tier: 3;
  status: 'underdetermined';
} | {
  tier: 3; contradiction: true;
  status: 'has-errors'; count: number;
});

type ProofStep =
  | { kind: 'clue'; fact: FactEntry; clue: Clue }
  | { kind: 'mark'; fact: FactEntry }
  | { kind: 'cascade'; fact: FactEntry; cascadeType: 'exclusivity' | 'transitivity' | 'last-option' };
```

### Verify-marks

```ts
interface VerifyMarksResponse {
  status: 'all-consistent' | 'has-errors';
  count: number;                // count of incorrect committed marks; scratch and blank ignored
}
```

Per user spec: **count-only**, no cell highlighting and no per-cell error array. The shipped UI displays just the count.

### Tier-3 contradiction routing

When the player's marks contradict the clues, all three tiers short-circuit and return `{ contradiction: true, status: 'has-errors', count: N }`. The UI presents this identically to a standalone verify-marks invocation.

## Par (Phase 2, shipped)

```ts
function computePar(puzzle: Puzzle): number;
```

Algorithm: group `puzzle.trace` by `pass-start` markers; for each pass count yes-facts and no-facts; DP across passes with state = tool held at pass end (`{x, check}`).

Within a pass:
- both yes and no present: start-end-same costs 2 switches; start-end-different costs 1.
- only-yes: must end on ✓; cost 0 if started on ✓, else 1.
- only-no: must end on ✕; cost 0 if started on ✕, else 1.

Return value is `minSwitches + 1` (the +1 accounts for the initial tool claim being the first "move"), matching the displayed turn-counter scale. Verified empirically:

- 3×3 easy: par 2 (one mixed pass).
- 4×4 medium: par range 3–6, mode 4.
- 5×5 hard: par range 3–6, mode 5.

## Puzzle Graph (Phase 3, planned)

```ts
interface PuzzleGraph {
  nodes: Map<string, Puzzle>;
  edges: CrossEdge[];
}

interface CrossEdge {
  id: string;
  sourcePuzzle: string;          // puzzle id
  targetPuzzle: string;
  sourceSpec: EdgeSource;
  targetSlot: EdgeTarget;
  binding: EdgeBinding;
}

type EdgeSource =
  | { kind: 'cell'; catA: string; a: any; catB: string; b: any }
  | { kind: 'pattern'; pattern: GeometricPattern }
  | { kind: 'relation'; relation: ClueType; operands: any[] };

interface GeometricPattern {
  type: 'distance' | 'adjacency' | 'same-row' | 'same-column' | 'diagonal';
  params: Record<string, any>;
}

type EdgeTarget =
  | { kind: 'placeholder-clue'; clueIdInTarget: string }
  | { kind: 'placeholder-atom'; clueIdInTarget: string; atomIdx: number };

type EdgeBinding =
  | { kind: 'literal-value' }
  | { kind: 'pair-identity' }
  | { kind: 'transform'; fn: 'reverse' | 'invert' };
```

## Lie metadata (Phase 4)

```ts
interface LiePuzzle extends Puzzle {
  ground: {
    realClues: Clue[];           // the truthful version of every clue
    corruptedClues: Clue[];      // as-shipped to the player
  };
  lieBudget: number;             // K
  liarTruthMap: Map<string, boolean>; // clueId -> isLie
}

interface LieDetectionResult {
  status: 'unique' | 'ambiguous' | 'inconsistent';
  consistentCorruptions: Array<{ clueIds: string[] }>;
}
```

The engine extension for lie propagation: each clue gets a truthfulness atom `L_C` and contributes a conditional constraint `Or(Not(L_C), C-assertion)` — equivalent to "if not a lie, then assertion holds." A global cardinality constraint enforces exactly K lies.

## Game state (Phase 7)

```ts
interface RunState {
  seed: string;
  arcId: string;
  graph: PuzzleGraph;
  characters: Character[];
  reputation: number;            // -100..100
  history: PublicationEvent[];
}

interface PuzzleSession {
  puzzleId: string;
  gridState: GridState;
  turnNumber: number;
  status: 'unstarted' | 'in-progress' | 'committed' | 'retracted';
  finalTurnCount?: number;       // set on commit
  parScore?: number;             // finalTurnCount - par
}

interface PublicationEvent {
  puzzleId: string;
  asserted: Array<{ catA: string; a: any; catB: string; b: any }>;
  correct: boolean;
  retractionPuzzleId?: string;
}
```

## JSON Content Schemas (Phase 5)

### characters.json

```json
{
  "characters": [
    {
      "id": "marisol",
      "name": "Marisol",
      "traits": ["aristocratic", "guarded"],
      "voice": "clipped, slightly cold",
      "motives": ["protecting husband's reputation", "hiding affair"],
      "lieTendency": 0.4,
      "lieTopics": ["affair", "whereabouts-after-9pm"]
    }
  ]
}
```

### themes.json

```json
{
  "themes": {
    "dinnerParty": {
      "anchorKey": "seat",
      "anchorRange": { "min": 4, "max": 6 },
      "categories": {
        "seat": { "kind": "numeric" },
        "guest": { "kind": "characterPool" },
        "drink": { "kind": "literal", "values": ["martini", "cabernet", "whiskey", "champagne", "absinthe", "mezcal"] },
        "secret": { "kind": "secretPool" }
      },
      "prompt": "Reconstruct what the gossip means: who sat where, what they drank, and what they were hiding.",
      "phraseTemplates": {
        "seat": "seat {x}",
        "guest": "{x}",
        "drink": "the {x} drinker",
        "secret": "whoever was hiding {x}"
      }
    }
  }
}
```

### motives.json, edge_grammars.json, story_arcs.json

(Unchanged from earlier draft — see prior SCHEMA.md sections.)

## Canonical key format

For the constraint table and any cell-keyed map:

```
canonKey(catA, a, catB, b) =>
  let lhs = `${catA}::${a}`
  let rhs = `${catB}::${b}`
  lhs < rhs ? `${lhs}||${rhs}` : `${rhs}||${lhs}`
```

This ensures `(A,a,B,b)` and `(B,b,A,a)` collide. **Note**: Phase 1's `gridState` stores coordinates inline in each cell value, so iterating gridState never requires decoding the key string. This is the future-proof representation.

## Mobile / display

```ts
// Grid sizing is driven by a single CSS variable, --grid-zoom, applied to the table element.
// All dimensions (cell width/height, label widths, font sizes) derive from base values × zoom via calc().
// Default base values fit 5×5×4-categories within a 360px phone screen at zoom=1.
//
// CSS vars on .sc-table:
//   --grid-zoom: 1
//   --cell-base: 18px
//   --col-label-base: 46px   (vertical column-label cells)
//   --row-label-base: 44px   (row item label width; text-overflow ellipsis when longer)
//   --cat-row-base: 14px     (rotated category-tag column width)
```
