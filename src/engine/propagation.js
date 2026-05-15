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
export function canonKey(catA, a, catB, b) {
  if (catA <= catB) return `${catA}=${a}|${catB}=${b}`;
  return `${catB}=${b}|${catA}=${a}`;
}

export function makeTable(categories) {
  return { categories, facts: new Map() };
}

export function cloneTable(t) {
  return { categories: t.categories, facts: new Map(t.facts) };
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
// order it was committed.
export function pushFact(table, catA, a, catB, b, value, source, trace) {
  const queue = [{ catA, a, catB, b, value, source }];
  const derived = [];
  while (queue.length) {
    const f = queue.shift();
    const cur = getFact(table, f.catA, f.a, f.catB, f.b);
    if (cur === f.value) continue;
    if (cur !== null && cur !== f.value) return { ok: false };
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
        // The deduction depends on all the other (N-1) "no" facts in this row,
        // which together exhaust the alternatives. f itself is one of them; the
        // rest are pulled from the table as deps.
        const exhausted = table.categories[f.catB]
          .filter((b2) => b2 !== remB[0])
          .map((b2) => getFactEntry(table, f.catA, f.a, f.catB, b2))
          .filter(Boolean);
        queue.push({ catA: f.catA, a: f.a, catB: f.catB, b: remB[0], value: 'yes', source: { type: 'last-option', from: f, deps: exhausted } });
      }
      const remA = table.categories[f.catA].filter((a2) => getFact(table, f.catA, a2, f.catB, f.b) !== 'no');
      if (remA.length === 0) return { ok: false };
      if (remA.length === 1 && getFact(table, f.catA, remA[0], f.catB, f.b) !== 'yes') {
        const exhausted = table.categories[f.catA]
          .filter((a2) => a2 !== remA[0])
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
export function solveFromState(categories, clues, initialMarks, trace) {
  const table = makeTable(categories);

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

export function solveWithClues(categories, clues, trace) {
  return solveFromState(categories, clues, [], trace);
}
