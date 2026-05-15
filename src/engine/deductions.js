// Deductions: derive per-subject 'rows' from the player's grid marks for the
// deductions panel.
//
//   getSubjectAttrs — for one subject, gather the player's ✓ choices across
//                     each other category
//   entityStatus    — classify each row as incomplete / correct / wrong
//   puzzleStatus    — graph-wide status; 'won' only when all rows complete
//                     AND verifyMarks reports zero errors

import { canonKey } from './propagation.js';
import { solutionTruth, verifyMarks } from './verify.js';

export function getSubjectAttrs(puzzle, gridState, subjectKey, subjectVal) {
  const cats = Object.keys(puzzle.categories);
  const attrs = {};
  for (const cat of cats) {
    if (cat === subjectKey) continue;
    let found = null;
    for (const v of puzzle.categories[cat]) {
      const key = canonKey(subjectKey, subjectVal, cat, v);
      if (gridState[key]?.committed === 'check') { found = v; break; }
    }
    attrs[cat] = found;
  }
  return attrs;
}

// Per-subject state: 'incomplete' (some blanks), 'correct' (all filled and right),
// or 'wrong' (all filled but at least one disagrees with truth).
export function entityStatus(puzzle, gridState, subjectKey, subjectVal) {
  const attrs = getSubjectAttrs(puzzle, gridState, subjectKey, subjectVal);
  const cats = Object.keys(puzzle.categories).filter((c) => c !== subjectKey);
  for (const cat of cats) {
    if (attrs[cat] == null) return { state: 'incomplete', attrs };
  }
  for (const cat of cats) {
    const truth = solutionTruth(puzzle.solution, subjectKey, subjectVal, cat, attrs[cat]);
    if (truth !== 'yes') return { state: 'wrong', attrs };
  }
  return { state: 'correct', attrs };
}

// Puzzle-wide status. 'won' = every subject's row is complete AND every player
// mark agrees with the truth. 'wrong' = every subject's row is complete but
// at least one mark (here or elsewhere on the grid) disagrees with truth.
// 'in-progress' otherwise.
export function puzzleStatus(puzzle, gridState) {
  const subjectKey = puzzle.subjectKey;
  if (!subjectKey) return 'in-progress';
  const subjects = puzzle.categories[subjectKey];
  let allFilled = true;
  for (const subj of subjects) {
    if (entityStatus(puzzle, gridState, subjectKey, subj).state === 'incomplete') {
      allFilled = false;
      break;
    }
  }
  if (!allFilled) return 'in-progress';
  const verify = verifyMarks(puzzle, gridState);
  return verify.count === 0 ? 'won' : 'wrong';
}
