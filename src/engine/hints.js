// Hint system. Three tiers, all routed against the same trace produced by
// solveFromState(puzzle.clues, marks):
//
//   hintTier1 — 'next step': the first new fact reachable via a clue (not
//               just mark-cascade) along with the originating clue
//   hintTier2 — 'proof': full proof DAG for that fact (or for a focus cell
//               if one was supplied)
//   hintTier3 — 'solvable?': can the puzzle be solved from current marks?
//
// All three route to verifyMarks on contradiction or wrong-marks.
//
// Note: the function names predate the spec's tier numbering, which maps
// 1=Solvable?, 2=Next step, 3=Proof. The OUTPUT objects already use the
// new numbering ({ tier: 1 } from hintTier3, etc.); only the function
// names lag. Phase 3.B will add cross-puzzle variants — leaving the rename
// for that pass to avoid touching call sites twice.
//
// Phase 3.B will:
//   - extend hintTier1 (output tier 2) with a blocked-on-cross-puzzle case
//   - extend hintTier3 (output tier 1) with graphStatus
//   - add a resolveCrossEdge param to buildProofDag for cross-puzzle chains

import { canonKey, solveFromState } from './propagation.js';
import { marksToFacts, verifyMarks } from './verify.js';

export function chainTerminusType(fact) {
  if (!fact || !fact.source) return 'unknown';
  const visited = new Set();
  let sawClue = false;
  let sawMark = false;
  function visit(f) {
    if (!f) return;
    const key = canonKey(f.catA, f.a, f.catB, f.b);
    if (visited.has(key)) return;
    visited.add(key);
    const s = f.source;
    if (!s) return;
    if (s.type === 'clue') { sawClue = true; return; }
    if (s.type === 'mark') { sawMark = true; return; }
    if (s.from) visit(s.from);
    for (const d of (s.deps || [])) visit(d);
  }
  visit(fact);
  if (sawClue) return 'clue';
  if (sawMark) return 'mark';
  return 'unknown';
}

// Build a proof DAG for one fact: walk both source.from (the triggering fact)
// and source.deps (additional facts that participate in the deduction). Each
// fact appears once. Output is topologically sorted — every dependency appears
// before the step that consumes it — so the UI can render it linearly and the
// proof reads top-to-bottom from inputs to conclusion.
export function buildProofDag(target) {
  const steps = [];
  const visited = new Set();
  function walk(fact) {
    if (!fact) return;
    const key = canonKey(fact.catA, fact.a, fact.catB, fact.b);
    if (visited.has(key)) return;
    visited.add(key);
    const s = fact.source;
    if (!s) {
      steps.push({ kind: 'given', fact });
      return;
    }
    if (s.type === 'mark') {
      steps.push({ kind: 'mark', fact });
      return;
    }
    if (s.type === 'clue') {
      const deps = s.deps || [];
      deps.forEach(walk);
      steps.push({ kind: 'clue', fact, clue: s.clue, deps });
      return;
    }
    // cascade — trigger fact + extra deps
    walk(s.from);
    const deps = s.deps || [];
    deps.forEach(walk);
    steps.push({ kind: 'cascade', cascadeType: s.type, fact, from: s.from, deps });
  }
  walk(target);
  return steps;
}

// Tier 1: from the player's current marks, find the FIRST new fact derivable via a clue
// (i.e. terminus is a clue, not just mark-cascade). Return the fact + its attribution.
export function hintTier1(puzzle, gridState) {
  const marks = marksToFacts(gridState);
  const trace = [];
  const result = solveFromState(puzzle.categories, puzzle.clues, marks, trace);

  if (result.status === 'contradiction') {
    return { tier: 2, contradiction: true, ...verifyMarks(puzzle, gridState) };
  }

  // Puzzle complete from marks: result.passes === 0 means no clue pass derived
  // anything beyond what mark-seed cascades already gave us. Combined with no
  // wrong marks, the player's committed facts (typically all check marks) have
  // determined the entire puzzle via exclusivity. Check marks are sufficient
  // for the answer — X marks are scratch work and not required for completion.
  if (result.passes === 0 && verifyMarks(puzzle, gridState).count === 0) {
    return { tier: 2, complete: true };
  }

  // Walk trace post-mark-seed for the first fact whose DAG reaches a clue.
  let inMarkSeed = false;
  for (const t of trace) {
    if (t.marker === 'mark-seed') { inMarkSeed = true; continue; }
    if (t.marker === 'pass-start') { inMarkSeed = false; continue; }
    if (t.marker) continue;
    if (inMarkSeed) continue; // skip cascade-from-marks during seeding phase
    if (chainTerminusType(t) === 'clue') {
      const dag = buildProofDag(t);
      const originClue = dag.find((s) => s.kind === 'clue')?.clue;
      return { tier: 2, fact: t, originClue, dag };
    }
  }
  // No clue-driven progress reachable. If the player has wrong marks,
  // route to verify instead of the generic noProgress message.
  const verify = verifyMarks(puzzle, gridState);
  if (verify.count > 0) return { tier: 2, wrongMarks: true, ...verify };
  return { tier: 2, noProgress: true };
}

// Tier 2: full proof DAG for a focus cell. If no focus cell supplied, picks the same
// first-clue-driven fact Tier 1 would pick (so T2 = full proof of T1's headline).
export function hintTier2(puzzle, gridState, focusCell) {
  const marks = marksToFacts(gridState);
  const trace = [];
  const result = solveFromState(puzzle.categories, puzzle.clues, marks, trace);

  if (result.status === 'contradiction') {
    return { tier: 3, contradiction: true, ...verifyMarks(puzzle, gridState) };
  }

  // Puzzle complete from marks (see hintTier1 for rationale). When no focus
  // cell is given, we treat completeness as the top-priority outcome rather
  // than surfacing cascade-derived facts the player hasn't yet marked. If a
  // focus cell IS supplied, the player is asking for a specific proof, so
  // honor that even on a complete puzzle.
  if (!focusCell && result.passes === 0 && verifyMarks(puzzle, gridState).count === 0) {
    return { tier: 3, complete: true };
  }

  let target = null;
  if (focusCell) {
    target = trace.find((t) =>
      !t.marker &&
      ((t.catA === focusCell.catA && t.a === focusCell.a && t.catB === focusCell.catB && t.b === focusCell.b) ||
       (t.catA === focusCell.catB && t.a === focusCell.b && t.catB === focusCell.catA && t.b === focusCell.a))
    );
    if (!target) return { tier: 3, focusUnreachable: true };
  } else {
    // Pass A: first clue-driven fact (post mark-seed phase).
    let inMarkSeed = false;
    for (const t of trace) {
      if (t.marker === 'mark-seed') { inMarkSeed = true; continue; }
      if (t.marker === 'pass-start') { inMarkSeed = false; continue; }
      if (t.marker) continue;
      if (inMarkSeed) continue;
      if (chainTerminusType(t) === 'clue') { target = t; break; }
    }
    // Pass B: if no clue-driven step remains, fall back to mark-seed cascades —
    // deductions reachable from current marks alone (exclusivity/transitivity/etc).
    // Pick the first cascade-derived fact the player hasn't already committed.
    if (!target) {
      let inSeed = false;
      for (const t of trace) {
        if (t.marker === 'mark-seed') { inSeed = true; continue; }
        if (t.marker === 'pass-start') { inSeed = false; continue; }
        if (t.marker) continue;
        if (!inSeed) continue;
        if (!t.source || t.source.type === 'mark') continue; // skip the marks themselves
        const key = canonKey(t.catA, t.a, t.catB, t.b);
        if (gridState[key]?.committed != null) continue; // already on the player's grid
        target = t;
        break;
      }
    }
    // Pass C: nothing reachable at all. If the player has wrong marks, route
    // to verify. Otherwise truly stuck.
    if (!target) {
      const verify = verifyMarks(puzzle, gridState);
      if (verify.count > 0) return { tier: 3, wrongMarks: true, ...verify };
      return { tier: 3, noProgress: true };
    }
  }

  const dag = buildProofDag(target);
  return { tier: 3, fact: target, dag };
}

// Tier 3: confirm the puzzle is still solvable from current marks. Three outcomes:
// - solved: yes, propagation reaches a full solution; report passes used
// - underdetermined: clues + marks aren't enough; player needs more progress
// - contradiction: routes to verify-mark count (per user spec)
export function hintTier3(puzzle, gridState) {
  const marks = marksToFacts(gridState);
  const result = solveFromState(puzzle.categories, puzzle.clues, marks, null);

  if (result.status === 'contradiction') {
    return { tier: 1, contradiction: true, ...verifyMarks(puzzle, gridState) };
  }
  // Puzzle complete from marks (see hintTier1 for rationale).
  if (result.passes === 0 && verifyMarks(puzzle, gridState).count === 0) {
    return { tier: 1, complete: true };
  }
  return { tier: 1, status: result.status, passes: result.passes };
}
