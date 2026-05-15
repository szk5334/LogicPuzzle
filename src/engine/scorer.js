// Interestingness scoring — used by the sample-and-filter generator.
//
// Higher score = more cascading. The core signal is passes × leverage, where
// leverage = (cascade derivations) / (clue count). A 'chewy' puzzle requires
// multiple propagation rounds AND has each clue spawning lots of follow-on
// facts. Clue-type diversity is a bonus; deviation from an ideal clue count
// (1.4 × N) is a penalty.

import { metricsFor } from './par.js';

// ----- Interestingness score -----
// Measure how chewy the puzzle is from its trace profile. Higher = more cascading.
// Core signal: passes × (cascade derivations / clue count). A puzzle that requires
// multiple propagation rounds AND has each clue spawning lots of follow-on facts
// is the satisfying-to-solve kind.
export function scoreInterestingness(puzzle) {
  const m = metricsFor(puzzle);
  const n = puzzle.solution.length;
  const propDerivs =
    m.bySource.exclusivity + m.bySource.transitivity + m.bySource['last-option'];
  const leverage = propDerivs / Math.max(m.clueCount, 1);
  const core = m.passes * leverage;
  const diversity = Object.keys(m.byClueType).length;
  const idealClues = Math.max(4, Math.floor(n * 1.4));
  const cluePenalty = Math.abs(m.clueCount - idealClues) * 1.0;
  return core + diversity * 2 - cluePenalty;
}
