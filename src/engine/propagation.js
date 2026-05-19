// Constraint propagation engine.
//
// The table holds 'yes' / 'no' facts about (catA-item, catB-item) pairs and
// pushes new facts through three cascades: exclusivity (only one yes per row
// or column), transitivity (yes-yes chains through any third category), and
// last-option (when all other options for a row or column are 'no', the last
// surviving cell is forced to 'yes').
//
// pushFact is the entry point for every fact: clue propagators call it, the
// solver seeds it for marks, and the cascades feed it via the internal queue.
// All trace entries are appended in derivation order.
//
// Phase 3 cross-puzzle plumbing (scaffolding only; no current callers):
//   - A table may be tagged with a `puzzleId`. Facts stored in that table are
//     stamped with the same `puzzleId` so downstream consumers (proof DAGs,
//     case-graph rendering) know which puzzle a fact belongs to.
//   - A table may carry a `crossPuzzleState` reference: a read-only
//     Map<canonKey, Fact> of atoms known from OTHER puzzles in the same case.
//     Future cross-puzzle clue propagators will consult it; the current
//     in-puzzle solver never reads from it.
//   - canonKey accepts an optional 5th `puzzleId` argument used by callers
//     constructing keys for crossPuzzleState lookups. Local-table operations
//     omit it (atoms in a single table all share the table's puzzleId, so the
//     key prefix is redundant).
//
// All Phase 3 additions are opt-in. Tables created without `opts` behave
// exactly as before — no puzzleId stamping, no crossPuzzleState lookups.

export const rand = (max) => Math.floor(Math.random() * max);

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ----- Constraint table -----
// Canonical key normalizes (catA,a,catB,b) so order doesn't matter.
// When a puzzleId is supplied (5th arg), the key is namespaced — used by
// cross-puzzle clue propagators looking up atoms in `table.crossPuzzleState`.
// 4-arg calls are unchanged.
export function canonKey(catA, a, catB, b, puzzleId) {
  const base = (catA <= catB)
    ? `${catA}=${a}|${catB}=${b}`
    : `${catB}=${b}|${catA}=${a}`;
  return puzzleId != null ? `${puzzleId}::${base}` : base;
}

// makeTable accepts an optional opts = { puzzleId, crossPuzzleState }.
//   puzzleId          — tag for facts stored in this table (Phase 3)
//   crossPuzzleState  — read-only Map<canonKey, Fact> of atoms from other
//                       puzzles. Inert today; future cross-puzzle clue
//                       propagators will consult `table.crossPuzzleState`.
// Both default to null/null — i.e. legacy behavior.
export function makeTable(categories, opts) {
  const { puzzleId = null, crossPuzzleState = null } = opts || {};
  return { categories, facts: new Map(), puzzleId, crossPuzzleState };
}

export function cloneTable(t) {
  return {
    categories: t.categories,
    facts: new Map(t.facts),
    puzzleId: t.puzzleId ?? null,
    crossPuzzleState: t.crossPuzzleState ?? null,
  };
}

export function getFact(table, catA, a, catB, b) {
  const e = table.facts.get(canonKey(catA, a, catB, b));
  if (!e) return null;
  // Normalize: caller may have asked in either order, but stored entry
  // carries its own catA/catB; just hand back the value.
  return e.value;
}

export function getFactEntry(table, catA, a, catB, b) {
  return table.facts.get(canonKey(catA, a, catB, b)) || null;
}

// Push a fact and run the three cascades (exclusivity, transitivity, last-option)
// to fixed point. Every derived fact is appended to `trace` (if non-null) in the
// order it was committed. When the table carries a `puzzleId`, every stored fact
// is stamped with it for downstream consumers; otherwise facts are left unmarked.
export function pushFact(table, catA, a, catB, b, value, source, trace) {
  const queue = [{ catA, a, catB, b, value, source }];
  const derived = [];
  while (queue.length) {
    const f = queue.shift();
    const cur = getFact(table, f.catA, f.a, f.catB, f.b);
    if (cur === f.value) continue;
    if (cur !== null && cur !== f.value) return { ok: false };
    if (table.puzzleId != null) f.puzzleId = table.puzzleId;
    table.facts.set(canonKey(f.catA, f.a, f.catB, f.b), f);
    derived.push(f);
    if (trace) trace.push(f);

    const cats = Object.keys(table.categories);

    if (f.value === 'yes') {
      // Exclusivity: only one yes per row and per column.
      for (const other of table.categories[f.catA]) {
        if (other !== f.a) {
          queue.push({ catA: f.catA, a: other, catB: f.catB, b: f.b, value: 'no', source: { type: 'exclusivity', from: f } });
        }
      }
      for (const other of table.categories[f.catB]) {
        if (other !== f.b) {
          queue.push({ catA: f.catA, a: f.a, catB: f.catB, b: other, value: 'no', source: { type: 'exclusivity', from: f } });
        }
      }
      // Transitivity through any third category.
      for (const catC of cats) {
        if (catC === f.catA || catC === f.catB) continue;
        for (const c of table.categories[catC]) {
          const ac = getFact(table, f.catA, f.a, catC, c);
          const bc = getFact(table, f.catB, f.b, catC, c);
          if (ac === 'yes' && bc !== 'yes') {
            const acE = getFactEntry(table, f.catA, f.a, catC, c);
            queue.push({ catA: f.catB, a: f.b, catB: catC, b: c, value: 'yes', source: { type: 'transitivity', from: f, deps: acE ? [acE] : [] } });
          }
          if (bc === 'yes' && ac !== 'yes') {
            const bcE = getFactEntry(table, f.catB, f.b, catC, c);
            queue.push({ catA: f.catA, a: f.a, catB: catC, b: c, value: 'yes', source: { type: 'transitivity', from: f, deps: bcE ? [bcE] : [] } });
          }
          if (ac === 'no' && bc === null) {
            const acE = getFactEntry(table, f.catA, f.a, catC, c);
            queue.push({ catA: f.catB, a: f.b, catB: catC, b: c, value: 'no', source: { type: 'transitivity', from: f, deps: acE ? [acE] : [] } });
          }
          if (bc === 'no' && ac === null) {
            const bcE = getFactEntry(table, f.catB, f.b, catC, c);
            queue.push({ catA: f.catA, a: f.a, catB: catC, b: c, value: 'no', source: { type: 'transitivity', from: f, deps: bcE ? [bcE] : [] } });
          }
        }
      }
    } else {
      // 'no' — check last-option in both directions.
      const remB = table.categories[f.catB].filter((b2) => getFact(table, f.catA, f.a, f.catB, b2) !== 'no');
      if (remB.length === 0) return { ok: false };
      if (remB.length === 1 && getFact(table, f.catA, f.a, f.catB, remB[0]) !== 'yes') {
        // The deduction depends on (N-1) "no" facts in this row that together
        // exhaust the alternatives. f itself is one of them — recorded as
        // `from` — and the OTHER N-2 are the supporting deps. We exclude both
        // the survivor and f.b here so f isn't cited twice in the proof.
        const exhausted = table.categories[f.catB]
          .filter((b2) => b2 !== remB[0] && b2 !== f.b)
          .map((b2) => getFactEntry(table, f.catA, f.a, f.catB, b2))
          .filter(Boolean);
        queue.push({ catA: f.catA, a: f.a, catB: f.catB, b: remB[0], value: 'yes', source: { type: 'last-option', from: f, deps: exhausted } });
      }
      const remA = table.categories[f.catA].filter((a2) => getFact(table, f.catA, a2, f.catB, f.b) !== 'no');
      if (remA.length === 0) return { ok: false };
      if (remA.length === 1 && getFact(table, f.catA, remA[0], f.catB, f.b) !== 'yes') {
        const exhausted = table.categories[f.catA]
          .filter((a2) => a2 !== remA[0] && a2 !== f.a)
          .map((a2) => getFactEntry(table, f.catA, a2, f.catB, f.b))
          .filter(Boolean);
        queue.push({ catA: f.catA, a: remA[0], catB: f.catB, b: f.b, value: 'yes', source: { type: 'last-option', from: f, deps: exhausted } });
      }
    }
  }
  return { ok: true, derived };
}

// ----- Run propagation to fixed point -----
// Core solver: starts from a seeded table of `initialMarks` (each: {catA, a, catB, b, value})
// and runs clue propagation to fixed point. Initial marks are pushed via pushFact with
// source {type: 'mark'} so their cascade fires and any later trace-walking terminates at them.
// solveWithClues is now a thin wrapper for the empty-seed case (generator flow).
//
// Optional `opts = { puzzleId, crossPuzzleState }` is forwarded to makeTable.
// When omitted, behaviour is identical to before this scaffolding shipped.
export function solveFromState(categories, clues, initialMarks, trace, opts) {
  const table = makeTable(categories, opts);

  // Seed initial marks. If two marks contradict each other (or their cascades collide),
  // we return contradiction immediately with contradictionSource: 'marks'.
  if (initialMarks && initialMarks.length > 0) {
    if (trace) trace.push({ marker: 'mark-seed' });
    for (const m of initialMarks) {
      const cur = getFact(table, m.catA, m.a, m.catB, m.b);
      if (cur === m.value) continue;
      const r = pushFact(table, m.catA, m.a, m.catB, m.b, m.value, { type: 'mark' }, trace);
      if (!r.ok) return { table, status: 'contradiction', passes: 0, contradictionSource: 'marks' };
    }
  }

  let pass = 0;
  while (true) {
    pass++;
    let any = false;
    const passStartIdx = trace ? trace.length : 0;
    if (trace) trace.push({ marker: 'pass-start', pass });
    for (const c of clues) {
      const r = c.propagate(table, trace);
      if (!r.ok) return { table, status: 'contradiction', passes: pass, contradictionSource: 'propagation' };
      if (r.changed) any = true;
    }
    if (!any) {
      // Roll back the no-op pass marker.
      if (trace) trace.splice(passStartIdx);
      pass--;
      break;
    }
  }
  // Is it fully determined? Every (catA item, catB item) pair has a value.
  const cats = Object.keys(categories);
  let determined = true;
  outer: for (let i = 0; i < cats.length; i++) {
    for (let j = i + 1; j < cats.length; j++) {
      for (const a of categories[cats[i]]) for (const b of categories[cats[j]]) {
        if (getFact(table, cats[i], a, cats[j], b) === null) { determined = false; break outer; }
      }
    }
  }
  return { table, status: determined ? 'solved' : 'underdetermined', passes: pass };
}

export function solveWithClues(categories, clues, trace, opts) {
  return solveFromState(categories, clues, [], trace, opts);
}
