// Par and trace metrics.
//
// metricsFor walks a generated puzzle's trace and aggregates per-source-type
// counts plus per-clue-type counts. Used by scoreInterestingness and surfaced
// in the sampling panel.
//
// computePar derives the minimum 'tool switches + 1' to mark every fact in
// the trace via a per-pass DP. Each propagation pass requires the player to
// be holding the right tool (✓ for yes-facts, X for no-facts); within a pass
// they can mark in either order. The +1 accounts for the initial tool select.
//
// Per-puzzle par sums to run-total par in Phase 3.A.

// ----- Trace metrics -----
export function metricsFor(puzzle) {
  const { trace, clues } = puzzle;
  const passes = puzzle.passes;
  const facts = trace.filter((t) => !t.marker);
  const bySource = { clue: 0, exclusivity: 0, transitivity: 0, 'last-option': 0 };
  for (const f of facts) {
    const t = f.source?.type;
    if (t && bySource[t] !== undefined) bySource[t]++;
  }
  const byClueType = {};
  for (const c of clues) byClueType[c.type] = (byClueType[c.type] || 0) + 1;
  return { passes, totalDerivations: facts.length, bySource, byClueType, clueCount: clues.length };
}

// ----- Par computation (Phase 2: golf scoring) -----
// Par = minimum number of "moves" to mark every fact in the trace, where:
//   - A "move" is one period of using a single committed tool (X or ✓).
//   - To mark a no-fact, you must hold X; to mark a yes-fact, you must hold ✓.
//   - Within a propagation pass, you may mark in either order (yes-first or no-first).
//   - Between passes, your held tool carries over.
// Algorithm: DP across passes, state = tool held at end of pass.
// Initial tool selection is free (the first "move" claims the tool with no prior cost).
//
// Within a pass that has BOTH yes and no facts:
//   start=X, end=X: 2 switches (mark X, switch to ✓, mark ✓, switch back to X)
//   start=X, end=✓: 1 switch
//   start=✓, end=X: 1 switch
//   start=✓, end=✓: 2 switches
// Within a pass with ONLY yes: end must be ✓; switches = (start === ✓ ? 0 : 1).
// Within a pass with ONLY no:  end must be X; switches = (start === X  ? 0 : 1).
//
// Returned par = min total switches + 1 (the +1 accounts for the initial tool selection
// being the first "move"). If no facts at all (degenerate), par = 0.
export function computePar(puzzle) {
  // Group fact entries by pass-start markers.
  const passCounts = [];
  let cur = null;
  for (const entry of puzzle.trace) {
    if (entry.marker === 'pass-start') {
      if (cur) passCounts.push(cur);
      cur = { yes: 0, no: 0 };
    } else if (entry.marker) {
      continue; // ignore mark-seed and other markers
    } else if (cur) {
      if (entry.value === 'yes') cur.yes++;
      else if (entry.value === 'no') cur.no++;
    }
  }
  if (cur) passCounts.push(cur);
  // Filter out totally-empty passes (defensive; solveWithClues strips no-op passes already).
  const passes = passCounts.filter((p) => p.yes > 0 || p.no > 0);
  if (passes.length === 0) return 0;

  const INF = Number.POSITIVE_INFINITY;
  // dp[tool] = min switches to reach this state with `tool` held.
  let prev = { x: 0, check: 0 };

  for (const p of passes) {
    const next = { x: INF, check: INF };
    const both = p.yes > 0 && p.no > 0;
    const onlyYes = p.yes > 0 && p.no === 0;
    const onlyNo  = p.no  > 0 && p.yes === 0;

    for (const start of ['x', 'check']) {
      const startCost = prev[start];
      if (startCost === INF) continue;

      if (both) {
        // Both must be marked; switches = 1 if end != start, 2 if end == start.
        next.x     = Math.min(next.x,     startCost + (start === 'x'     ? 2 : 1));
        next.check = Math.min(next.check, startCost + (start === 'check' ? 2 : 1));
      } else if (onlyYes) {
        // Must end on ✓.
        const sw = start === 'check' ? 0 : 1;
        next.check = Math.min(next.check, startCost + sw);
      } else if (onlyNo) {
        // Must end on X.
        const sw = start === 'x' ? 0 : 1;
        next.x = Math.min(next.x, startCost + sw);
      }
    }
    prev = next;
  }
  const minSwitches = Math.min(prev.x, prev.check);
  return minSwitches + 1;
}
