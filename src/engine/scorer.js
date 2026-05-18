// Interestingness scoring — used by the sample-and-filter generator.
//
// Twelve priority modes are available, each implementing a different notion of
// "best puzzle in the sample batch":
//
//   GENERAL-PURPOSE
//   balance       — original scoring: passes × leverage + diversity − count penalty
//   fewClues      — minimize clue count, lightly reward passes
//   diversity     — maximize distinct clue types (quadratic)
//   difficulty    — passes² × leverage (passes alone correlates 0.95 with this)
//   diffDiversity — passes × leverage + 3 × distinct types
//   diffFewClues  — passes × leverage − 5 × clue count
//   maxLeverage   — leverage² (per-clue derivation depth)
//   bottleneck    — top-1 clue's share of trace DAG + 0.1 × leverage
//
//   BAND-CAPPED — pick the hardest puzzle whose difficulty score is ≤ cap.
//   If no in-batch puzzle is under the cap, the closest above-cap is chosen.
//   These power the easy/medium/hard/brutal presets in the dash card.
//   bandEasy      — cap 200
//   bandMedium    — cap 300
//   bandHard      — cap 400
//   bandBrutal    — no cap (equivalent to 'difficulty')
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

function rawDifficulty(p) {
  const m = metricsFor(p);
  return (m.passes ** 2) * leverageOf(p);
}

// DAG fanout per clue — see Batch 1 comment block.
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

// Band-capped score factory. Returns a function that:
//   - returns puzzle's raw difficulty if ≤ cap (so best-of-N picks the hardest in-band)
//   - returns -(diff - cap) - 100000 if above cap (so best-of-N picks the closest above-cap
//     only if literally no in-band sample exists; any in-band sample beats any above-cap)
function makeBandCapped(cap) {
  return (p) => {
    const d = rawDifficulty(p);
    if (d <= cap) return d;
    return -(d - cap) - 100000;
  };
}

// ----- Priority-mode scoring functions -----
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
  difficulty: rawDifficulty,
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

  // Band-capped — UI cap matches difficultyToStars cutoffs in dashCardLogic.
  bandEasy:   makeBandCapped(200),
  bandMedium: makeBandCapped(300),
  bandHard:   makeBandCapped(400),
  bandBrutal: rawDifficulty,
};

// Cap values exported so the UI can display them next to the preset buttons.
export const BAND_CAPS = { bandEasy: 200, bandMedium: 300, bandHard: 400, bandBrutal: Infinity };

// Public registry — UI imports this to render the priority-mode picker.
export const PRIORITY_MODES = [
  'balance',
  'fewClues',
  'diversity',
  'difficulty',
  'diffDiversity',
  'diffFewClues',
  'maxLeverage',
  'bottleneck',
  'bandEasy',
  'bandMedium',
  'bandHard',
  'bandBrutal',
];

export const PRIORITY_MODE_LABELS = {
  balance:       'Balanced',
  fewClues:      'Fewest clues',
  diversity:     'Most diverse',
  difficulty:    'Hardest (raw)',
  diffDiversity: 'Hard + diverse',
  diffFewClues:  'Hard + few clues',
  maxLeverage:   'Max leverage',
  bottleneck:    'Bottleneck (load-bearing)',
  bandEasy:      'Easy band (≤200)',
  bandMedium:    'Medium band (≤300)',
  bandHard:      'Hard band (≤400)',
  bandBrutal:    'Brutal (uncapped)',
};

export function scorePuzzle(puzzle, mode = 'balance') {
  const scorer = SCORERS[mode] || SCORERS.balance;
  return scorer(puzzle);
}

export function scoreInterestingness(puzzle) {
  return SCORERS.balance(puzzle);
}
