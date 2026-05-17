// Interestingness scoring — used by the sample-and-filter generator.
//
// Eight priority modes are available, each implementing a different notion of
// "best puzzle in the sample batch":
//
//   balance       — original scoring: passes × leverage + diversity − count penalty
//   fewClues      — minimize clue count, lightly reward passes
//   diversity     — maximize distinct clue types (quadratic)
//   difficulty    — passes² × leverage (passes alone correlates 0.95 with this)
//   diffDiversity — passes × leverage + 3 × distinct types
//   diffFewClues  — passes × leverage − 5 × clue count
//   maxLeverage   — leverage² (per-clue derivation depth)
//   bottleneck    — top-1 clue's share of trace DAG + 0.1 × leverage
//
// scorePuzzle(puzzle, mode) is the entry point. scoreInterestingness(puzzle) is
// kept as a back-compat alias = scorePuzzle(puzzle, 'balance').

import { metricsFor } from './par.js';

// ----- Helpers -----
function leverageOf(p) {
  const m = metricsFor(p);
  const propDerivs =
    m.bySource.exclusivity + m.bySource.transitivity + m.bySource['last-option'];
  return propDerivs / Math.max(m.clueCount, 1);
}

// DAG fanout per clue: how many trace facts ultimately depend on each clue.
// For clue-sourced facts: count directly. For derived facts: walk source.deps
// back until we hit a clue-sourced fact, then credit that clue. Returns the
// top-1 share — the single most load-bearing clue's fraction of total
// derivations. High top-1 share means one clue dominates the cascade.
function bottleneckTopShare(puzzle) {
  const totalByClue = new Map();
  for (const c of puzzle.clues) totalByClue.set(c, 0);
  for (const t of puzzle.trace) {
    if (t.marker) continue;
    if (t.source?.clue) {
      const c = t.source.clue;
      totalByClue.set(c, (totalByClue.get(c) || 0) + 1);
      continue;
    }
    const seen = new Set();
    const stack = [...(t.source?.deps || [])];
    while (stack.length) {
      const a = stack.pop();
      if (!a || seen.has(a)) continue;
      seen.add(a);
      const ac = a.source?.clue;
      if (ac) totalByClue.set(ac, (totalByClue.get(ac) || 0) + 1);
      else for (const d of (a.source?.deps || [])) stack.push(d);
    }
  }
  const vals = [...totalByClue.values()];
  if (vals.length === 0) return 0;
  const sum = vals.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  return Math.max(...vals) / sum;
}

// ----- Priority-mode scoring functions -----
// All take a fully-traced puzzle; higher = better fit.
const SCORERS = {
  balance: (p) => {
    const m = metricsFor(p);
    const lev = leverageOf(p);
    const n = p.solution.length;
    const diversity = Object.keys(m.byClueType).length;
    const ideal = Math.max(4, Math.floor(n * 1.4));
    return m.passes * lev + diversity * 2 - Math.abs(m.clueCount - ideal);
  },
  fewClues: (p) => {
    const m = metricsFor(p);
    return -m.clueCount * 10 + m.passes;
  },
  diversity: (p) => {
    const m = metricsFor(p);
    return Object.keys(m.byClueType).length ** 2 + m.passes;
  },
  difficulty: (p) => {
    const m = metricsFor(p);
    return (m.passes ** 2) * leverageOf(p);
  },
  diffDiversity: (p) => {
    const m = metricsFor(p);
    return m.passes * leverageOf(p) + Object.keys(m.byClueType).length * 3;
  },
  diffFewClues: (p) => {
    const m = metricsFor(p);
    return m.passes * leverageOf(p) - m.clueCount * 5;
  },
  maxLeverage: (p) => leverageOf(p) ** 2,
  bottleneck: (p) => bottleneckTopShare(p) + leverageOf(p) * 0.1,
};

// Public registry — UI imports this to render the priority-mode picker.
// Order here is the order shown in the dropdown.
export const PRIORITY_MODES = [
  'balance',
  'fewClues',
  'diversity',
  'difficulty',
  'diffDiversity',
  'diffFewClues',
  'maxLeverage',
  'bottleneck',
];

// Human-readable labels for the UI.
export const PRIORITY_MODE_LABELS = {
  balance:       'Balanced',
  fewClues:      'Fewest clues',
  diversity:     'Most diverse',
  difficulty:    'Hardest (passes × leverage)',
  diffDiversity: 'Hard + diverse',
  diffFewClues:  'Hard + few clues',
  maxLeverage:   'Max leverage',
  bottleneck:    'Bottleneck (load-bearing)',
};

// Score a puzzle under a chosen priority mode. Unknown mode falls back to balance.
export function scorePuzzle(puzzle, mode = 'balance') {
  const scorer = SCORERS[mode] || SCORERS.balance;
  return scorer(puzzle);
}

// Back-compat alias — preserves the original API for App.jsx and SamplingPanel.
// New code should call scorePuzzle(puzzle, mode) directly.
export function scoreInterestingness(puzzle) {
  return SCORERS.balance(puzzle);
}
