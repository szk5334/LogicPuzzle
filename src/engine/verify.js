// Verify-marks: count how many of the player's committed marks disagree with
// the puzzle's ground-truth solution. No propagation, no inference — just a
// direct table lookup per mark.
//
// Phase 3.B will add a graph-total variant that walks all puzzles' marks
// against a precomputed joint truth table; this single-puzzle version stays
// as the underlying primitive.

// Truth lookup against a solution: does (catA,a) pair with (catB,b)?
export function solutionTruth(solution, catA, a, catB, b) {
  if (catA === catB) return a === b ? 'yes' : 'no';
  const row = solution.find((r) => r[catA] === a);
  if (!row) return null;
  return row[catB] === b ? 'yes' : 'no';
}

// Convert the player's gridState into a list of committed facts.
// Only 'x' (→ no) and 'check' (→ yes) feed the engine. Scratch labels are ignored.
export function marksToFacts(gridState) {
  const facts = [];
  for (const key in gridState) {
    const cell = gridState[key];
    if (!cell || !cell.committed) continue;
    facts.push({
      catA: cell.catA, a: cell.a,
      catB: cell.catB, b: cell.b,
      value: cell.committed === 'check' ? 'yes' : 'no',
    });
  }
  return facts;
}

// Verify: count player marks that disagree with the solution.
// Scratch and blank cells are ignored. Returns just the count, no per-cell detail.
export function verifyMarks(puzzle, gridState) {
  let count = 0;
  for (const key in gridState) {
    const cell = gridState[key];
    if (!cell || !cell.committed) continue;
    const truth = solutionTruth(puzzle.solution, cell.catA, cell.a, cell.catB, cell.b);
    const markValue = cell.committed === 'check' ? 'yes' : 'no';
    if (markValue !== truth) count++;
  }
  return { status: count === 0 ? 'all-consistent' : 'has-errors', count };
}
