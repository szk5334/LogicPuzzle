import { useState, useMemo } from 'react';

// ============================================================
// ENGINE
// ============================================================

const rand = (max) => Math.floor(Math.random() * max);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ----- Solution generation -----
// A solution is an array of N row-objects, each mapping category -> item.
// The anchor category (e.g. seat position) is in its natural order; the
// others are random bijections onto it.
function generateSolution(theme, n) {
  const categories = theme.categoriesFor(n);
  const anchorKey = theme.anchorKey;
  const anchor = categories[anchorKey];
  const solution = anchor.map((a) => ({ [anchorKey]: a }));
  for (const key of Object.keys(categories)) {
    if (key === anchorKey) continue;
    const shuffled = shuffle(categories[key]);
    shuffled.forEach((item, i) => {
      solution[i][key] = item;
    });
  }
  return { categories, solution, anchorKey };
}

// ----- Constraint table -----
// We store pairwise facts between items of *different* categories.
// Key is canonicalized so (catA,a,catB,b) and (catB,b,catA,a) map to the same slot.

function canonKey(catA, a, catB, b) {
  const lhs = `${catA}::${a}`;
  const rhs = `${catB}::${b}`;
  return lhs < rhs ? `${lhs}||${rhs}` : `${rhs}||${lhs}`;
}

function makeTable(categories) {
  return { categories, facts: new Map() };
}

function cloneTable(t) {
  return { categories: t.categories, facts: new Map(t.facts) };
}

function getFact(table, catA, a, catB, b) {
  if (catA === catB) return a === b ? 'yes' : 'no';
  const entry = table.facts.get(canonKey(catA, a, catB, b));
  return entry ? entry.value : null;
}

// Like getFact, but returns the full FactEntry with provenance (source field).
// Used by cascade and formula-clue propagators when they need to cite the
// already-established facts that justify a new deduction. Returns null for
// the synthetic same-category-identity case and for missing facts.
function getFactEntry(table, catA, a, catB, b) {
  if (catA === catB) return null;
  return table.facts.get(canonKey(catA, a, catB, b)) ?? null;
}

// Push a fact onto the table and cascade exclusivity + transitivity.
// Returns { ok: true, derived } or { ok: false } on contradiction.
function pushFact(table, catA, a, catB, b, value, source, trace) {
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

// ----- Clue types -----
// Each clue has: type, fields, propagate(table, trace) -> {ok, anyChange},
// and a render(theme) for prose output.

function clueIs(catA, a, catB, b) {
  return {
    type: 'is',
    catA, a, catB, b,
    test: (sol) => sol.find((r) => r[catA] === a)[catB] === b,
    propagate(table, trace) {
      const cur = getFact(table, catA, a, catB, b);
      if (cur === 'yes') return { ok: true, changed: false };
      const r = pushFact(table, catA, a, catB, b, 'yes', { type: 'clue', clue: this }, trace);
      return { ok: r.ok, changed: r.ok && r.derived.length > 0 };
    },
  };
}

function clueNot(catA, a, catB, b) {
  return {
    type: 'not',
    catA, a, catB, b,
    test: (sol) => sol.find((r) => r[catA] === a)[catB] !== b,
    propagate(table, trace) {
      const cur = getFact(table, catA, a, catB, b);
      if (cur === 'no') return { ok: true, changed: false };
      const r = pushFact(table, catA, a, catB, b, 'no', { type: 'clue', clue: this }, trace);
      return { ok: r.ok, changed: r.ok && r.derived.length > 0 };
    },
  };
}

// ----- Positional clues (binary helper) -----
// Two items with positions constrained by a predicate on (pa, pb). Anchor must be
// an ordered numeric category. Propagates by enumerating valid (pa,pb) pairs that
// are still consistent with the table and deriving forced facts.
function binaryPosClue(type, catA, a, catB, b, anchorKey, predicate, extra = {}) {
  return {
    type,
    catA, a, catB, b, anchorKey,
    ...extra,
    test: (sol) => {
      const pa = sol.find((r) => r[catA] === a)[anchorKey];
      const pb = sol.find((r) => r[catB] === b)[anchorKey];
      return predicate(pa, pb);
    },
    propagate(table, trace) {
      const positions = table.categories[anchorKey];
      const possibleA = positions.filter((p) => getFact(table, catA, a, anchorKey, p) !== 'no');
      const possibleB = positions.filter((p) => getFact(table, catB, b, anchorKey, p) !== 'no');
      const valid = [];
      for (const pa of possibleA) for (const pb of possibleB) {
        if (predicate(pa, pb)) valid.push([pa, pb]);
      }
      if (valid.length === 0) return { ok: false };
      const okA = new Set(valid.map((p) => p[0]));
      const okB = new Set(valid.map((p) => p[1]));
      let changed = false;
      for (const p of positions) {
        if (!okA.has(p) && getFact(table, catA, a, anchorKey, p) !== 'no') {
          const r = pushFact(table, catA, a, anchorKey, p, 'no', { type: 'clue', clue: this }, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
        if (!okB.has(p) && getFact(table, catB, b, anchorKey, p) !== 'no') {
          const r = pushFact(table, catB, b, anchorKey, p, 'no', { type: 'clue', clue: this }, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
      }
      return { ok: true, changed };
    },
  };
}

// Three items with positions constrained by a predicate on (pa, pb, pc).
function ternaryPosClue(type, catA, a, catB, b, catC, c, anchorKey, predicate) {
  return {
    type,
    catA, a, catB, b, catC, c, anchorKey,
    test: (sol) => {
      const pa = sol.find((r) => r[catA] === a)[anchorKey];
      const pb = sol.find((r) => r[catB] === b)[anchorKey];
      const pc = sol.find((r) => r[catC] === c)[anchorKey];
      return predicate(pa, pb, pc);
    },
    propagate(table, trace) {
      const positions = table.categories[anchorKey];
      const possA = positions.filter((p) => getFact(table, catA, a, anchorKey, p) !== 'no');
      const possB = positions.filter((p) => getFact(table, catB, b, anchorKey, p) !== 'no');
      const possC = positions.filter((p) => getFact(table, catC, c, anchorKey, p) !== 'no');
      const valid = [];
      for (const pa of possA) for (const pb of possB) for (const pc of possC) {
        if (pa === pb || pa === pc || pb === pc) continue;
        if (predicate(pa, pb, pc)) valid.push([pa, pb, pc]);
      }
      if (valid.length === 0) return { ok: false };
      const okA = new Set(valid.map((v) => v[0]));
      const okB = new Set(valid.map((v) => v[1]));
      const okC = new Set(valid.map((v) => v[2]));
      let changed = false;
      for (const p of positions) {
        if (!okA.has(p) && getFact(table, catA, a, anchorKey, p) !== 'no') {
          const r = pushFact(table, catA, a, anchorKey, p, 'no', { type: 'clue', clue: this }, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
        if (!okB.has(p) && getFact(table, catB, b, anchorKey, p) !== 'no') {
          const r = pushFact(table, catB, b, anchorKey, p, 'no', { type: 'clue', clue: this }, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
        if (!okC.has(p) && getFact(table, catC, c, anchorKey, p) !== 'no') {
          const r = pushFact(table, catC, c, anchorKey, p, 'no', { type: 'clue', clue: this }, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
      }
      return { ok: true, changed };
    },
  };
}

// Specific positional clue factories.
const clueNextTo = (catA, a, catB, b, ak) =>
  binaryPosClue('nextTo', catA, a, catB, b, ak, (pa, pb) => Math.abs(pa - pb) === 1);

const clueImmLeft = (catA, a, catB, b, ak) =>
  binaryPosClue('immLeft', catA, a, catB, b, ak, (pa, pb) => pa + 1 === pb);

const clueLeftOf = (catA, a, catB, b, ak) =>
  binaryPosClue('leftOf', catA, a, catB, b, ak, (pa, pb) => pa < pb);

const clueExactlyApart = (catA, a, catB, b, ak, dist) =>
  binaryPosClue('exactlyApart', catA, a, catB, b, ak, (pa, pb) => Math.abs(pa - pb) === dist, { dist });

const clueBetween = (catA, a, catB, b, catC, c, ak) =>
  ternaryPosClue('between', catA, a, catB, b, catC, c, ak,
    (pa, pb, pc) => (pb < pa && pa < pc) || (pc < pa && pa < pb));

// Additional binary positional clues.
const clueImmRight  = (catA, a, catB, b, ak) =>
  binaryPosClue('immRight',  catA, a, catB, b, ak, (pa, pb) => pa === pb + 1);
const clueRightOf   = (catA, a, catB, b, ak) =>
  binaryPosClue('rightOf',   catA, a, catB, b, ak, (pa, pb) => pa > pb);
const clueNotNextTo = (catA, a, catB, b, ak) =>
  binaryPosClue('notNextTo', catA, a, catB, b, ak, (pa, pb) => pa !== pb && Math.abs(pa - pb) !== 1);
const clueWithin    = (catA, a, catB, b, ak, dist) =>
  binaryPosClue('within',    catA, a, catB, b, ak, (pa, pb) => pa !== pb && Math.abs(pa - pb) <= dist, { dist });

// Unary positional clues — single item, constraint on its anchor position alone.
function unaryPosClue(type, catA, a, anchorKey, satisfies) {
  return {
    type, catA, a, anchorKey,
    test: (sol) => {
      const positions = sol.map((r) => r[anchorKey]);
      const pa = sol.find((r) => r[catA] === a)[anchorKey];
      return satisfies(pa, positions);
    },
    propagate(table, trace) {
      const positions = table.categories[anchorKey];
      let changed = false;
      for (const p of positions) {
        if (!satisfies(p, positions) && getFact(table, catA, a, anchorKey, p) !== 'no') {
          const r = pushFact(table, catA, a, anchorKey, p, 'no', { type: 'clue', clue: this }, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
      }
      return { ok: true, changed };
    },
  };
}

const clueAtEnd = (catA, a, ak) =>
  unaryPosClue('atEnd', catA, a, ak, (p, ps) => p === Math.min(...ps) || p === Math.max(...ps));
const clueNotAtEnd = (catA, a, ak) =>
  unaryPosClue('notAtEnd', catA, a, ak, (p, ps) => p !== Math.min(...ps) && p !== Math.max(...ps));

// ----- Formula AST for compositional clues -----
// Atoms: { kind: 'atom', catA, a, catB, b, polarity: 'yes'|'no' }
//   polarity 'yes' means "catA[a] paired with catB[b]"
//   polarity 'no'  means "catA[a] NOT paired with catB[b]"
// Composites: { kind: 'and'|'or'|'xor', children: [...] }, { kind: 'not', child: ... }
const fAtom = (catA, a, catB, b, polarity = 'yes') =>
  ({ kind: 'atom', catA, a, catB, b, polarity });
const fNot = (child) => ({ kind: 'not', child });
const fAnd = (...children) => ({ kind: 'and', children });
const fOr  = (...children) => ({ kind: 'or',  children });
const fXor = (...children) => ({ kind: 'xor', children });

function extractAtoms(f) {
  if (f.kind === 'atom') return [f];
  if (f.kind === 'not') return extractAtoms(f.child);
  return f.children.flatMap(extractAtoms);
}

// Deduplicate atoms by their underlying proposition (ignoring polarity).
function uniqueProps(atoms) {
  const seen = new Set();
  const out = [];
  for (const a of atoms) {
    const k = canonKey(a.catA, a.a, a.catB, a.b);
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ catA: a.catA, a: a.a, catB: a.catB, b: a.b, key: k });
    }
  }
  return out;
}

// Evaluate formula given a map<propKey, 'yes'|'no'>. Returns true/false, or
// undefined if any required atom isn't determined yet.
function evalFormula(f, vmap) {
  if (f.kind === 'atom') {
    const v = vmap.get(canonKey(f.catA, f.a, f.catB, f.b));
    if (v === undefined) return undefined;
    return f.polarity === 'yes' ? v === 'yes' : v === 'no';
  }
  if (f.kind === 'not') {
    const c = evalFormula(f.child, vmap);
    return c === undefined ? undefined : !c;
  }
  if (f.kind === 'and') {
    let anyU = false;
    for (const c of f.children) {
      const r = evalFormula(c, vmap);
      if (r === false) return false;
      if (r === undefined) anyU = true;
    }
    return anyU ? undefined : true;
  }
  if (f.kind === 'or') {
    let anyU = false;
    for (const c of f.children) {
      const r = evalFormula(c, vmap);
      if (r === true) return true;
      if (r === undefined) anyU = true;
    }
    return anyU ? undefined : false;
  }
  if (f.kind === 'xor') {
    let trueCount = 0, anyU = false;
    for (const c of f.children) {
      const r = evalFormula(c, vmap);
      if (r === undefined) anyU = true;
      else if (r === true) trueCount++;
      if (trueCount > 1 && !anyU) return false;
    }
    if (anyU) return undefined;
    return trueCount === 1;
  }
}

// True if the formula holds for the given solution.
function formulaHoldsForSolution(formula, solution) {
  const cats = Object.keys(solution[0]);
  const vmap = new Map();
  for (const row of solution) {
    for (let i = 0; i < cats.length; i++) {
      for (let j = i + 1; j < cats.length; j++) {
        vmap.set(canonKey(cats[i], row[cats[i]], cats[j], row[cats[j]]), 'yes');
      }
    }
  }
  // Fill in 'no' for any atom the formula references that we didn't set.
  for (const a of uniqueProps(extractAtoms(formula))) {
    if (!vmap.has(a.key)) vmap.set(a.key, 'no');
  }
  return evalFormula(formula, vmap) === true;
}

// Generic formula-based clue. Propagates by enumerating consistent assignments
// to the formula's atoms and deriving any fact that holds in every assignment.
// Caps atoms at 8 (256 enumerations) for safety; usually 2-5.
function clueFormula(formula, type, render) {
  return {
    type,
    formula,
    render,
    test(sol) { return formulaHoldsForSolution(formula, sol); },
    propagate(table, trace) {
      const atoms = uniqueProps(extractAtoms(formula));
      if (atoms.length === 0) return { ok: true, changed: false };
      if (atoms.length > 8) return { ok: true, changed: false };
      const known = atoms.map(p => getFact(table, p.catA, p.a, p.catB, p.b));
      const valid = [];
      const n = atoms.length;
      for (let mask = 0; mask < (1 << n); mask++) {
        const vmap = new Map();
        let ok = true;
        for (let i = 0; i < n; i++) {
          const v = (mask >> i) & 1 ? 'yes' : 'no';
          if (known[i] !== null && known[i] !== v) { ok = false; break; }
          vmap.set(atoms[i].key, v);
        }
        if (!ok) continue;
        if (evalFormula(formula, vmap) === true) valid.push(vmap);
      }
      if (valid.length === 0) return { ok: false };
      // Any atom already known when this propagator runs is part of why
      // the new deduction follows from the clue. Collect those as deps.
      const knownDeps = [];
      for (let i = 0; i < n; i++) {
        if (known[i] !== null) {
          const e = getFactEntry(table, atoms[i].catA, atoms[i].a, atoms[i].catB, atoms[i].b);
          if (e) knownDeps.push(e);
        }
      }
      let changed = false;
      for (let i = 0; i < n; i++) {
        if (known[i] !== null) continue;
        const vs = new Set(valid.map(a => a.get(atoms[i].key)));
        if (vs.size === 1) {
          const v = vs.values().next().value;
          const r = pushFact(table, atoms[i].catA, atoms[i].a, atoms[i].catB, atoms[i].b, v, { type: 'clue', clue: this, deps: knownDeps }, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
      }
      return { ok: true, changed };
    },
  };
}

// ----- Operator-flavored clue factories -----
function clueOneOf(catA, a, catB, options) {
  // "a is paired with one of [options]" — OR of positive atoms.
  return clueFormula(
    fOr(...options.map(b => fAtom(catA, a, catB, b, 'yes'))),
    'oneOf',
  );
}
function clueEither(p1, p2) {
  return clueFormula(fOr(p1, p2), 'either');
}
function clueXor2(p1, p2) {
  return clueFormula(fXor(p1, p2), 'xor');
}
function clueNeither(p1, p2) {
  // Neither of the two pairings holds. = NOR. Cleanest: each negated.
  return clueFormula(fAnd(fNot(p1), fNot(p2)), 'neither');
}
function clueIfThen(p1, p2) {
  // p1 -> p2 == (!p1) OR p2
  return clueFormula(fOr(fNot(p1), p2), 'ifThen');
}
function clueGenericFormula(formula) {
  return clueFormula(formula, 'mixed');
}

// ----- Generate every true clue of each supported type for the solution -----
function generateAllTrueClues({ categories, solution, anchorKey }) {
  const out = [];
  const cats = Object.keys(categories);
  for (let i = 0; i < cats.length; i++) {
    for (let j = i + 1; j < cats.length; j++) {
      const catA = cats[i], catB = cats[j];
      for (const a of categories[catA]) for (const b of categories[catB]) {
        const isPair = solution.find((r) => r[catA] === a)[catB] === b;
        if (isPair) out.push(clueIs(catA, a, catB, b));
        else out.push(clueNot(catA, a, catB, b));
      }
    }
  }
  // Positional clues — only between non-anchor pairs (more interesting).
  const nonAnchor = cats.filter((c) => c !== anchorKey);
  const positions = categories[anchorKey];
  const N = positions.length;
  const posOf = (cat, item) => solution.find(r => r[cat] === item)[anchorKey];
  for (let i = 0; i < nonAnchor.length; i++) {
    for (let j = i; j < nonAnchor.length; j++) {
      const catA = nonAnchor[i], catB = nonAnchor[j];
      for (const a of categories[catA]) for (const b of categories[catB]) {
        if (catA === catB && a >= b) continue;
        const pa = posOf(catA, a), pb = posOf(catB, b);
        // NextTo / NotNextTo
        if (Math.abs(pa - pb) === 1) out.push(clueNextTo(catA, a, catB, b, anchorKey));
        if (Math.abs(pa - pb) > 1) out.push(clueNotNextTo(catA, a, catB, b, anchorKey));
        // ImmLeft / ImmRight (directed — generate both orderings)
        if (pa + 1 === pb) out.push(clueImmLeft(catA, a, catB, b, anchorKey));
        if (pb + 1 === pa) out.push(clueImmLeft(catB, b, catA, a, anchorKey));
        if (pa === pb + 1) out.push(clueImmRight(catA, a, catB, b, anchorKey));
        if (pb === pa + 1) out.push(clueImmRight(catB, b, catA, a, anchorKey));
        // LeftOf / RightOf (loose, directed)
        if (pa < pb) {
          out.push(clueLeftOf(catA, a, catB, b, anchorKey));
          out.push(clueRightOf(catB, b, catA, a, anchorKey));
        }
        if (pb < pa) {
          out.push(clueLeftOf(catB, b, catA, a, anchorKey));
          out.push(clueRightOf(catA, a, catB, b, anchorKey));
        }
        // ExactlyApart with N >= 2 (N=1 == NextTo, already covered)
        const dist = Math.abs(pa - pb);
        if (dist >= 2) out.push(clueExactlyApart(catA, a, catB, b, anchorKey, dist));
        // Within(d) for d in [2, 3] when actual distance qualifies (loose bound).
        // Skip dist=0 (same seat) since the Within predicate excludes it.
        for (const d of [2, 3]) {
          if (d < positions.length && dist > 0 && dist <= d) {
            out.push(clueWithin(catA, a, catB, b, anchorKey, d));
          }
        }
      }
    }
  }

  // Unary positional clues: AtEnd / NotAtEnd for every non-anchor item.
  const minP = Math.min(...positions);
  const maxP = Math.max(...positions);
  for (const cat of nonAnchor) {
    for (const a of categories[cat]) {
      const pa = posOf(cat, a);
      if (pa === minP || pa === maxP) out.push(clueAtEnd(cat, a, anchorKey));
      else out.push(clueNotAtEnd(cat, a, anchorKey));
    }
  }

  // Between: 3 items from any non-anchor categories, middle one positionally between others.
  const betweenItems = [];
  for (const cat of nonAnchor) for (const it of categories[cat]) betweenItems.push({ cat, it, pos: posOf(cat, it) });
  for (let i = 0; i < betweenItems.length; i++) {
    for (let j = i + 1; j < betweenItems.length; j++) {
      for (let k = j + 1; k < betweenItems.length; k++) {
        const [x, y, z] = [betweenItems[i], betweenItems[j], betweenItems[k]];
        // Skip duplicate items.
        if ((x.cat === y.cat && x.it === y.it) || (x.cat === z.cat && x.it === z.it) || (y.cat === z.cat && y.it === z.it)) continue;
        // Identify the middle by position.
        const sorted = [x, y, z].sort((u, v) => u.pos - v.pos);
        const [low, mid, high] = sorted;
        // Skip triples with any positional tie — Between requires STRICT betweenness,
        // so the predicate would be false and the clue would contradict the solution.
        if (low.pos === mid.pos || mid.pos === high.pos) continue;
        out.push(clueBetween(mid.cat, mid.it, low.cat, low.it, high.cat, high.it, anchorKey));
      }
    }
  }

  // ----- Operator-flavored clues -----
  // Build an inventory of atomic propositions in the solution, split by truth.
  const trueProps = []; // each entry is a positive atom: catA[a] = catB[b]
  const allCatPairs = [];
  for (let i = 0; i < cats.length; i++) {
    for (let j = i + 1; j < cats.length; j++) allCatPairs.push([cats[i], cats[j]]);
  }
  for (const [catA, catB] of allCatPairs) {
    for (const a of categories[catA]) {
      const matched = solution.find(r => r[catA] === a)[catB];
      trueProps.push(fAtom(catA, a, catB, matched, 'yes'));
    }
  }

  // Helper: pick a random positive atom that is true in the solution.
  const pickTruePositive = () => trueProps[rand(trueProps.length)];
  // Helper: pick a random NEGATIVE atom (catA[a] != catB[b]) that is true (i.e. they really don't match).
  const pickTrueNegative = () => {
    for (let tries = 0; tries < 20; tries++) {
      const [catA, catB] = allCatPairs[rand(allCatPairs.length)];
      const a = categories[catA][rand(categories[catA].length)];
      const b = categories[catB][rand(categories[catB].length)];
      const truthA = solution.find(r => r[catA] === a)[catB];
      if (truthA !== b) return fAtom(catA, a, catB, b, 'no');
    }
    return null;
  };
  // Helper: a random atom (positive or negative) that is true.
  const pickTrueAtom = () => rand(2) ? pickTruePositive() : (pickTrueNegative() || pickTruePositive());
  // Helper: a random atom that is FALSE in the solution.
  const pickFalseAtom = () => {
    for (let tries = 0; tries < 20; tries++) {
      const [catA, catB] = allCatPairs[rand(allCatPairs.length)];
      const a = categories[catA][rand(categories[catA].length)];
      const b = categories[catB][rand(categories[catB].length)];
      const truthA = solution.find(r => r[catA] === a)[catB];
      // Positive atom "a paired with b" is false iff truthA !== b
      if (rand(2)) {
        if (truthA !== b) return fAtom(catA, a, catB, b, 'yes');
      } else {
        if (truthA === b) return fAtom(catA, a, catB, b, 'no');
      }
    }
    return null;
  };
  const sameAtom = (x, y) => canonKey(x.catA, x.a, x.catB, x.b) === canonKey(y.catA, y.a, y.catB, y.b);

  // OneOf: "catA[a] is one of [b1, b2, ...]" (with the true partner among options).
  // Always include the true partner; pad with distractors.
  for (const [catA, catB] of allCatPairs) {
    for (const a of categories[catA]) {
      const truthB = solution.find(r => r[catA] === a)[catB];
      const otherBs = categories[catB].filter(b => b !== truthB);
      // 2-option variant: trueB + 1 distractor.
      for (const d of otherBs) {
        out.push(clueOneOf(catA, a, catB, shuffle([truthB, d])));
      }
      // 3-option variant (if available): trueB + 2 random distractors.
      if (otherBs.length >= 2) {
        const ds = shuffle(otherBs).slice(0, 2);
        out.push(clueOneOf(catA, a, catB, shuffle([truthB, ...ds])));
      }
    }
  }

  // Either(p1, p2): OR of two atoms, at least one true. Generate variants with
  // (true, anything), so the OR holds.
  for (let k = 0; k < 24; k++) {
    const p1 = pickTrueAtom();
    const p2 = rand(2) ? pickTrueAtom() : (pickFalseAtom() || pickTrueAtom());
    if (!p1 || !p2 || sameAtom(p1, p2)) continue;
    out.push(clueEither(p1, p2));
  }

  // Xor: exactly one is true. Pair a true atom with a false atom.
  for (let k = 0; k < 20; k++) {
    const t = pickTrueAtom();
    const f = pickFalseAtom();
    if (!t || !f || sameAtom(t, f)) continue;
    out.push(clueXor2(t, f));
  }

  // Neither (NOR): both atoms are false. Pick two false atoms.
  for (let k = 0; k < 20; k++) {
    const a1 = pickFalseAtom();
    const a2 = pickFalseAtom();
    if (!a1 || !a2 || sameAtom(a1, a2)) continue;
    out.push(clueNeither(a1, a2));
  }

  // IfThen: p1 -> p2. True iff p1 false or p2 true. Pick one of two recipes.
  for (let k = 0; k < 20; k++) {
    let p1, p2;
    if (rand(2)) {
      p1 = pickFalseAtom(); // antecedent false → implication vacuously true
      p2 = pickTrueAtom();
    } else {
      p1 = pickTrueAtom();  // consequent true → implication true
      p2 = pickTrueAtom();
    }
    if (!p1 || !p2 || sameAtom(p1, p2)) continue;
    out.push(clueIfThen(p1, p2));
  }

  // Mixed compositional clues — depth-2 formulas with up to 5 operands.
  // Generate a handful of each shape and keep ones that hold for the solution.
  for (let k = 0; k < 18; k++) {
    let formula;
    const shape = rand(4);
    if (shape === 0) {
      // And(Or(a,b), Or(c,d)) — 4 operands
      const a = pickTrueAtom(), b = pickTrueAtom();
      const c = pickTrueAtom(), d = pickFalseAtom();
      if (!a || !b || !c || !d) continue;
      formula = fAnd(fOr(a, b), fOr(c, d));
    } else if (shape === 1) {
      // Or(And(a,b), c) — 3 operands
      const a = pickTrueAtom(), b = pickTrueAtom();
      const c = pickFalseAtom() || pickTrueAtom();
      if (!a || !b || !c) continue;
      formula = fOr(fAnd(a, b), c);
    } else if (shape === 2) {
      // Xor(Or(a,b), c) — 3 operands
      const a = pickFalseAtom(), b = pickFalseAtom();
      const c = pickTrueAtom();
      if (!a || !b || !c) continue;
      formula = fXor(fOr(a, b), c);
    } else {
      // Or(a, b, c) — 3 operands flat OR
      const a = pickTrueAtom();
      const b = pickFalseAtom() || pickTrueAtom();
      const c = pickFalseAtom() || pickTrueAtom();
      if (!a || !b || !c) continue;
      formula = fOr(a, b, c);
    }
    if (formulaHoldsForSolution(formula, solution)) {
      out.push(clueGenericFormula(formula));
    }
  }

  // Defensive safety net: drop any clue that doesn't actually hold for the solution.
  // Protects against generator bugs where the emission condition doesn't match the
  // predicate (e.g. same-seat pairs slipping through for Within/Between).
  return out.filter((c) => c.test(solution));
}

// ----- Run propagation to fixed point -----
// Core solver: starts from a seeded table of `initialMarks` (each: {catA, a, catB, b, value})
// and runs clue propagation to fixed point. Initial marks are pushed via pushFact with
// source {type: 'mark'} so their cascade fires and any later trace-walking terminates at them.
// solveWithClues is now a thin wrapper for the empty-seed case (generator flow).
function solveFromState(categories, clues, initialMarks, trace) {
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

function solveWithClues(categories, clues, trace) {
  return solveFromState(categories, clues, [], trace);
}

// ----- Generate a puzzle -----
function generatePuzzle(theme, n, difficulty) {
  const { categories, solution, anchorKey } = generateSolution(theme, n);
  const allClues = generateAllTrueClues({ categories, solution, anchorKey });

  // Bias the clue ordering by difficulty. Each type gets a base weight per band.
  const WEIGHTS = {
    easy:   { is: 6, not: 1, nextTo: 2, notNextTo: 1, immLeft: 2, immRight: 2, leftOf: 1, rightOf: 1, exactlyApart: 1, within: 1, between: 1, atEnd: 1, notAtEnd: 1, oneOf: 2, either: 1, xor: 1, neither: 1, ifThen: 1, mixed: 1 },
    medium: { is: 3, not: 3, nextTo: 3, notNextTo: 3, immLeft: 3, immRight: 3, leftOf: 3, rightOf: 3, exactlyApart: 3, within: 3, between: 3, atEnd: 3, notAtEnd: 3, oneOf: 3, either: 3, xor: 3, neither: 3, ifThen: 3, mixed: 3 },
    hard:   { is: 1, not: 4, nextTo: 5, notNextTo: 4, immLeft: 5, immRight: 5, leftOf: 4, rightOf: 4, exactlyApart: 5, within: 4, between: 5, atEnd: 3, notAtEnd: 3, oneOf: 4, either: 5, xor: 5, neither: 4, ifThen: 5, mixed: 6 },
  };
  const wTable = WEIGHTS[difficulty] || WEIGHTS.medium;
  const weighted = allClues.map((c) => {
    const w = wTable[c.type] ?? 2;
    return { clue: c, w: w * (0.5 + Math.random()) };
  }).sort((x, y) => y.w - x.w);

  // Add clues until propagation determines the puzzle.
  const chosen = [];
  for (const { clue } of weighted) {
    chosen.push(clue);
    const r = solveWithClues(categories, chosen, null);
    if (r.status === 'solved') break;
    if (chosen.length > allClues.length) break;
  }

  // Minimize: drop any clue whose absence still leaves it solvable.
  const reduce = (clueList) => {
    let cur = [...clueList];
    const order = shuffle(cur.map((_, i) => i));
    for (const idx of order) {
      const target = cur[idx];
      if (target == null) continue;
      const trial = cur.filter((c) => c !== target);
      const r = solveWithClues(categories, trial, null);
      if (r.status === 'solved') {
        cur = trial;
      }
    }
    return cur;
  };
  let minimal = reduce(chosen);
  // Run two more passes — order matters, so additional rounds can shave more.
  minimal = reduce(minimal);
  minimal = reduce(minimal);

  // Re-solve with trace.
  const trace = [];
  const finalSolve = solveWithClues(categories, minimal, trace);

  return {
    categories,
    solution,
    anchorKey,
    clues: minimal,
    trace,
    status: finalSolve.status,
    passes: finalSolve.passes,
  };
}

// ----- Trace metrics -----
function metricsFor(puzzle) {
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
function computePar(puzzle) {
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

// ----- Interestingness score -----
// Measure how chewy the puzzle is from its trace profile. Higher = more cascading.
// Core signal: passes × (cascade derivations / clue count). A puzzle that requires
// multiple propagation rounds AND has each clue spawning lots of follow-on facts
// is the satisfying-to-solve kind.
function scoreInterestingness(puzzle) {
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

// ============================================================
// PHASE 1 — Hint System + Verify Marks
// ============================================================

// Truth lookup against a solution: does (catA,a) pair with (catB,b)?
function solutionTruth(solution, catA, a, catB, b) {
  if (catA === catB) return a === b ? 'yes' : 'no';
  const row = solution.find((r) => r[catA] === a);
  if (!row) return null;
  return row[catB] === b ? 'yes' : 'no';
}

// Convert the player's gridState into a list of committed facts.
// Only 'x' (→ no) and 'check' (→ yes) feed the engine. Scratch labels are ignored.
function marksToFacts(gridState) {
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
function verifyMarks(puzzle, gridState) {
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

// Walk a fact's source chain to find what ultimately produced it.
// Cascade types (exclusivity/transitivity/last-option) recurse via source.from.
// Terminal types: 'clue' (a clue fired) or 'mark' (a player mark).
// Does this fact's derivation closure include any clue-rooted leaf?
// Walks both `source.from` (trigger) and `source.deps` (extra inputs) so
// we don't miss clue-roots that live on a non-trigger branch of the DAG.
function chainTerminusType(fact) {
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
function buildProofDag(target) {
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
function hintTier1(puzzle, gridState) {
  const marks = marksToFacts(gridState);
  const trace = [];
  const result = solveFromState(puzzle.categories, puzzle.clues, marks, trace);

  if (result.status === 'contradiction') {
    return { tier: 1, contradiction: true, ...verifyMarks(puzzle, gridState) };
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
      return { tier: 1, fact: t, originClue, dag };
    }
  }
  // No clue-driven progress reachable. If the player has wrong marks,
  // route to verify instead of the generic noProgress message.
  const verify = verifyMarks(puzzle, gridState);
  if (verify.count > 0) return { tier: 1, wrongMarks: true, ...verify };
  return { tier: 1, noProgress: true };
}

// Tier 2: full proof DAG for a focus cell. If no focus cell supplied, picks the same
// first-clue-driven fact Tier 1 would pick (so T2 = full proof of T1's headline).
function hintTier2(puzzle, gridState, focusCell) {
  const marks = marksToFacts(gridState);
  const trace = [];
  const result = solveFromState(puzzle.categories, puzzle.clues, marks, trace);

  if (result.status === 'contradiction') {
    return { tier: 2, contradiction: true, ...verifyMarks(puzzle, gridState) };
  }

  let target = null;
  if (focusCell) {
    target = trace.find((t) =>
      !t.marker &&
      ((t.catA === focusCell.catA && t.a === focusCell.a && t.catB === focusCell.catB && t.b === focusCell.b) ||
       (t.catA === focusCell.catB && t.a === focusCell.b && t.catB === focusCell.catA && t.b === focusCell.a))
    );
    if (!target) return { tier: 2, focusUnreachable: true };
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
      if (verify.count > 0) return { tier: 2, wrongMarks: true, ...verify };
      return { tier: 2, noProgress: true };
    }
  }

  const dag = buildProofDag(target);
  return { tier: 2, fact: target, dag };
}

// Tier 3: confirm the puzzle is still solvable from current marks. Three outcomes:
// - solved: yes, propagation reaches a full solution; report passes used
// - underdetermined: clues + marks aren't enough; player needs more progress
// - contradiction: routes to verify-mark count (per user spec)
function hintTier3(puzzle, gridState) {
  const marks = marksToFacts(gridState);
  const result = solveFromState(puzzle.categories, puzzle.clues, marks, null);

  if (result.status === 'contradiction') {
    return { tier: 3, contradiction: true, ...verifyMarks(puzzle, gridState) };
  }
  return { tier: 3, status: result.status, passes: result.passes };
}

// ============================================================
// THEMES — define categories + clue rendering
// ============================================================

const CHARACTER_POOL = ['Marisol', 'Dax', 'Yuki', 'Cordelia', 'Renard', 'Imani', 'Felix', 'Odette'];
const DRINK_POOL = ['martini', 'cabernet', 'whiskey', 'champagne', 'absinthe', 'mezcal'];
const SECRET_POOL = [
  'an affair with the host',
  'embezzlement at the firm',
  'a fake medical degree',
  'a secret second family',
  'a stolen manuscript',
  'a buried prior identity',
];
const OBJECT_POOL = ['silver locket', 'matchbook', 'lipstick-stained napkin', 'torn letter', 'pearl earring', 'antique pen'];

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const SHAPES = ['◯', '△', '□', '◇', '☆', '✕'];
const COLORS = ['red', 'blue', 'green', 'gold', 'violet', 'white'];

// Shared clue-rendering. Each theme provides small primitives (phrase, propLine,
// renderNextTo, renderImmLeft); the shared function handles every clue type.
function renderClueShared(c, theme) {
  const phrase = (cat, x) => theme.phrase(cat, x);
  const propLine = (catA, a, catB, b, pol) => theme.propLine(catA, a, catB, b, pol);
  const renderAtom = (atom) => propLine(atom.catA, atom.a, atom.catB, atom.b, atom.polarity);
  const renderFormula = (f) => {
    if (f.kind === 'atom') return renderAtom(f);
    if (f.kind === 'not') return `it is NOT the case that (${renderFormula(f.child)})`;
    if (f.kind === 'and') return f.children.map(renderFormula).join(', AND ');
    if (f.kind === 'or')  return f.children.map(renderFormula).join(', OR ');
    if (f.kind === 'xor') return `exactly one of: [${f.children.map(renderFormula).join(' / ')}]`;
    return '?';
  };

  switch (c.type) {
    case 'is':      return capit(propLine(c.catA, c.a, c.catB, c.b, 'yes')) + '.';
    case 'not':     return capit(propLine(c.catA, c.a, c.catB, c.b, 'no')) + '.';
    case 'nextTo':
    case 'notNextTo':
    case 'immLeft':
    case 'immRight':
    case 'leftOf':
    case 'rightOf':
    case 'exactlyApart':
    case 'within':
    case 'between':
    case 'atEnd':
    case 'notAtEnd':
      return theme.renderPositional(c);
    case 'oneOf': {
      const atoms = c.formula.children;
      const head = atoms[0];
      const opts = atoms.map((x) => phrase(x.catB, x.b));
      const joined = opts.length === 2
        ? `${opts[0]} or ${opts[1]}`
        : `${opts.slice(0, -1).join(', ')}, or ${opts[opts.length - 1]}`;
      return `${capit(phrase(head.catA, head.a))} is one of: ${joined}.`;
    }
    case 'either': {
      const [p1, p2] = c.formula.children;
      return `Either ${renderAtom(p1)}, or ${renderAtom(p2)} (possibly both).`;
    }
    case 'xor': {
      const [p1, p2] = c.formula.children;
      return `Exactly one is true — either ${renderAtom(p1)}, or ${renderAtom(p2)}, but not both.`;
    }
    case 'neither': {
      const [n1, n2] = c.formula.children;
      return `Neither ${renderAtom(n1.child)} nor ${renderAtom(n2.child)}.`;
    }
    case 'ifThen': {
      const [notP, q] = c.formula.children;
      return `If ${renderAtom(notP.child)}, then ${renderAtom(q)}.`;
    }
    case 'mixed':
    case 'formula':
      return capit(renderFormula(c.formula)) + '.';
    default: return '?';
  }
}

const themes = {
  classic: {
    name: 'classic',
    label: 'Classic — letters & numerals',
    anchorKey: 'position',
    categoriesFor(n) {
      return {
        position: Array.from({ length: n }, (_, i) => i + 1),
        letter: LETTERS.slice(0, n),
        numeral: NUMERALS.slice(0, n),
        shape: SHAPES.slice(0, n),
      };
    },
    prompt: 'Determine which letter, numeral, and shape go at each position.',
    phrase(cat, x) { return `${cat[0].toUpperCase()}=${x}`; },
    propLine(catA, a, catB, b, polarity) {
      const op = polarity === 'yes' ? '↔' : '⊥';
      return `${this.phrase(catA, a)} ${op} ${this.phrase(catB, b)}`;
    },
    renderPositional(c) {
      const A = this.phrase(c.catA, c.a);
      const B = c.catB && this.phrase(c.catB, c.b);
      const C = c.catC && this.phrase(c.catC, c.c);
      switch (c.type) {
        case 'nextTo':       return `${A} and ${B} are at adjacent positions.`;
        case 'notNextTo':    return `${A} and ${B} are NOT at adjacent positions.`;
        case 'immLeft':      return `${A} is immediately left of ${B}.`;
        case 'immRight':     return `${A} is immediately right of ${B}.`;
        case 'leftOf':       return `${A} is somewhere left of ${B}.`;
        case 'rightOf':      return `${A} is somewhere right of ${B}.`;
        case 'exactlyApart': return `${A} and ${B} are exactly ${c.dist} positions apart.`;
        case 'within':       return `${A} and ${B} are within ${c.dist} positions of each other.`;
        case 'between':      return `${A} is positionally between ${B} and ${C}.`;
        case 'atEnd':        return `${A} is at one of the end positions.`;
        case 'notAtEnd':     return `${A} is not at either end.`;
        default: return '?';
      }
    },
    renderClue(c) { return renderClueShared(c, this); },
  },
  soapOpera: {
    name: 'soapOpera',
    label: 'Soap Opera — the dinner party',
    anchorKey: 'seat',
    categoriesFor(n) {
      return {
        seat: Array.from({ length: n }, (_, i) => i + 1),
        guest: shuffle(CHARACTER_POOL).slice(0, n),
        drink: shuffle(DRINK_POOL).slice(0, n),
        secret: shuffle(SECRET_POOL).slice(0, n),
      };
    },
    prompt: 'Reconstruct what the gossip means: who sat where, what they drank, and what they were hiding.',
    phrase(cat, x) {
      if (cat === 'seat') return `seat ${x}`;
      if (cat === 'guest') return x;
      if (cat === 'drink') return `the ${x} drinker`;
      if (cat === 'secret') return `whoever was hiding ${x}`;
      return `${cat}=${x}`;
    },
    propLine(catA, a, catB, b, polarity) {
      // Special phrasing when seat is involved (positional).
      if (catA === 'seat' || catB === 'seat') {
        const seatVal = catA === 'seat' ? a : b;
        const otherCat = catA === 'seat' ? catB : catA;
        const otherVal = catA === 'seat' ? b : a;
        return polarity === 'yes'
          ? `${this.phrase(otherCat, otherVal)} was at seat ${seatVal}`
          : `${this.phrase(otherCat, otherVal)} was NOT at seat ${seatVal}`;
      }
      return polarity === 'yes'
        ? `${this.phrase(catA, a)} matches ${this.phrase(catB, b)}`
        : `${this.phrase(catA, a)} does not match ${this.phrase(catB, b)}`;
    },
    renderPositional(c) {
      const A = capit(this.phrase(c.catA, c.a));
      const B = c.catB && this.phrase(c.catB, c.b);
      const C = c.catC && this.phrase(c.catC, c.c);
      switch (c.type) {
        case 'nextTo':       return `${A} sat next to ${B}.`;
        case 'notNextTo':    return `${A} did NOT sit next to ${B}.`;
        case 'immLeft':      return `${A} sat immediately to the left of ${B}.`;
        case 'immRight':     return `${A} sat immediately to the right of ${B}.`;
        case 'leftOf':       return `${A} sat somewhere to the left of ${B}.`;
        case 'rightOf':      return `${A} sat somewhere to the right of ${B}.`;
        case 'exactlyApart': return `${A} and ${B} sat exactly ${c.dist} seats apart.`;
        case 'within':       return `${A} and ${B} sat within ${c.dist} seats of each other.`;
        case 'between':      return `${A} sat between ${B} and ${C}.`;
        case 'atEnd':        return `${A} sat at one of the ends of the table.`;
        case 'notAtEnd':     return `${A} sat somewhere in the middle — not at either end.`;
        default: return '?';
      }
    },
    renderClue(c) { return renderClueShared(c, this); },
  },
  noir: {
    name: 'noir',
    label: 'Noir — the suspects',
    anchorKey: 'room',
    categoriesFor(n) {
      return {
        room: Array.from({ length: n }, (_, i) => i + 1),
        suspect: shuffle(CHARACTER_POOL).slice(0, n),
        evidence: shuffle(OBJECT_POOL).slice(0, n),
        color: shuffle(COLORS).slice(0, n),
      };
    },
    prompt: 'Pin each suspect to a room, the evidence they left, and the color they wore.',
    phrase(cat, x) {
      if (cat === 'room') return `room ${x}`;
      if (cat === 'suspect') return x;
      if (cat === 'evidence') return `the one who left the ${x}`;
      if (cat === 'color') return `the one in ${x}`;
      return `${cat}=${x}`;
    },
    propLine(catA, a, catB, b, polarity) {
      if (catA === 'room' || catB === 'room') {
        const otherCat = catA === 'room' ? catB : catA;
        const otherVal = catA === 'room' ? b : a;
        const roomVal = catA === 'room' ? a : b;
        return polarity === 'yes'
          ? `${this.phrase(otherCat, otherVal)} was in room ${roomVal}`
          : `${this.phrase(otherCat, otherVal)} was NOT in room ${roomVal}`;
      }
      return polarity === 'yes'
        ? `${this.phrase(catA, a)} is ${this.phrase(catB, b)}`
        : `${this.phrase(catA, a)} is not ${this.phrase(catB, b)}`;
    },
    renderPositional(c) {
      const A = capit(this.phrase(c.catA, c.a));
      const B = c.catB && this.phrase(c.catB, c.b);
      const C = c.catC && this.phrase(c.catC, c.c);
      switch (c.type) {
        case 'nextTo':       return `${A}'s room is adjacent to ${B}'s.`;
        case 'notNextTo':    return `${A}'s room is NOT adjacent to ${B}'s.`;
        case 'immLeft':      return `${A}'s room is immediately before ${B}'s.`;
        case 'immRight':     return `${A}'s room is immediately after ${B}'s.`;
        case 'leftOf':       return `${A}'s room comes somewhere before ${B}'s.`;
        case 'rightOf':      return `${A}'s room comes somewhere after ${B}'s.`;
        case 'exactlyApart': return `${A} and ${B} are exactly ${c.dist} rooms apart.`;
        case 'within':       return `${A} and ${B} are within ${c.dist} rooms of each other.`;
        case 'between':      return `${A}'s room is between ${B}'s and ${C}'s.`;
        case 'atEnd':        return `${A} was in one of the end rooms.`;
        case 'notAtEnd':     return `${A} was not in an end room.`;
        default: return '?';
      }
    },
    renderClue(c) { return renderClueShared(c, this); },
  },
};

function capit(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Tool modes for the worksheet. One active at a time.
// - 'x':     tap toggles a committed X mark (no-fact)
// - 'check': tap toggles a committed ✓ mark (yes-fact)
// - 'scratch': tap on blank cell opens label picker; tap on cell w/ scratch removes it
const TOOLS = ['x', 'check', 'scratch'];

// Default scratch label suggestions (player can type anything 1-2 chars).
const DEFAULT_SCRATCH_LABELS = ['1', '2', '3', 'A', 'B', '?'];

function shortLabel(s, maxLen = 7) {
  if (typeof s === 'number') return String(s);
  const trimmed = String(s);
  if (trimmed.length <= maxLen) return trimmed;
  const stop = new Set(['a', 'an', 'the', 'with', 'of', 'at', 'in', 'and', 'on', 'her', 'his']);
  const words = trimmed.split(/[\s-]+/);
  for (const w of words) {
    if (!stop.has(w.toLowerCase())) {
      return w.length > maxLen ? w.slice(0, maxLen - 1) + '…' : w;
    }
  }
  return trimmed.slice(0, maxLen - 1) + '…';
}

// ============================================================
// UI
// ============================================================

export default function App() {
  const [size, setSize] = useState(4);
  const [themeKey, setThemeKey] = useState('soapOpera');
  const [difficulty, setDifficulty] = useState('medium');
  const [sampleCount, setSampleCount] = useState(10);
  const [puzzle, setPuzzle] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [showSolution, setShowSolution] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Grid state: keyed by canonKey, value = { catA, a, catB, b, committed: 'x'|'check'|null, scratch: string|null }.
  // Coordinates stored inline so we never have to decode canonKey to iterate.
  const [gridState, setGridState] = useState({});

  // Active tool. 'x' / 'check' / 'scratch'.
  const [tool, setTool] = useState('x');

  // Turn mechanics (Phase 2: golf scoring).
  // A "turn" is bounded by a single committed-tool type. Switching between X and ✓
  // mid-turn (when committed changes have been made) ends the turn and advances the counter.
  // Scratch is always free.
  const [turnNumber, setTurnNumber] = useState(1);
  const [turnStartGrid, setTurnStartGrid] = useState({});      // committed-layer snapshot at turn start
  const [lastCommittedTool, setLastCommittedTool] = useState(null); // the X/✓ that "owns" this turn

  // Scratch label picker state. When a player taps a blank cell in scratch mode,
  // we open a tiny picker overlay anchored to that cell.
  // `editing` is true when the cell already has a scratch label being edited.
  const [scratchPicker, setScratchPicker] = useState(null); // { key, catA, a, catB, b, editing } or null
  const [scratchInput, setScratchInput] = useState('');
  const [recentLabels, setRecentLabels] = useState([]); // most-recent first, capped

  // Grid zoom — multiplier applied to all grid dimensions via CSS variable.
  // Default 1 fits a small phone; up to 3 for inspection.
  const [gridZoom, setGridZoom] = useState(1);
  const ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5, 3];

  // Hint UI state.
  const [hint, setHint] = useState(null);  // last hint response, or null
  const [verifyResult, setVerifyResult] = useState(null);

  const theme = themes[themeKey];

  const generate = () => {
    setGenerating(true);
    setShowSolution(false);
    setShowTrace(false);
    setGridState({});
    setHint(null);
    setVerifyResult(null);
    setPuzzle(null);
    setCandidates(null);
    setTurnNumber(1);
    setTurnStartGrid({});
    setLastCommittedTool(null);
    setProgress({ done: 0, total: sampleCount });

    const accum = [];
    let i = 0;
    const step = () => {
      try {
        const p = generatePuzzle(theme, size, difficulty);
        if (p.status === 'solved') {
          p._score = scoreInterestingness(p);
          p.par = computePar(p);
          accum.push(p);
        }
      } catch (e) { /* skip bad sample */ }
      i++;
      setProgress({ done: i, total: sampleCount });
      if (i < sampleCount) {
        setTimeout(step, 0);
      } else {
        accum.sort((a, b) => b._score - a._score);
        if (accum.length === 0) {
          setGenerating(false);
          return;
        }
        setPuzzle(accum[0]);
        setCandidates(accum);
        setGenerating(false);
      }
    };
    setTimeout(step, 30);
  };

  // Returns true if the committed layer differs between two grid states.
  // Only X/✓ marks matter for turn-locking — scratch changes are free.
  const committedDiffers = (gridA, gridB) => {
    const allKeys = new Set([...Object.keys(gridA), ...Object.keys(gridB)]);
    for (const k of allKeys) {
      const a = gridA[k]?.committed ?? null;
      const b = gridB[k]?.committed ?? null;
      if (a !== b) return true;
    }
    return false;
  };

  // Tool selection with turn semantics.
  // Scratch is a "transparent" overlay over your current committed tool:
  //   - Going INTO scratch is always free; lastCommittedTool is preserved.
  //   - Going OUT of scratch to a committed tool follows the X⇄✓ rule against lastCommittedTool.
  //   - Direct X⇄✓ swap is the same rule.
  // The rule: if the new committed tool differs from lastCommittedTool AND
  // the committed layer has changed since turn-start, advance the turn.
  const selectTool = (newTool) => {
    if (newTool === tool) return;

    // Going into scratch: always free.
    if (newTool === 'scratch') {
      setTool('scratch');
      return;
    }

    // From here, newTool is 'x' or 'check'.
    if (lastCommittedTool === null) {
      // First commitment claim ever.
      setTool(newTool);
      setLastCommittedTool(newTool);
      return;
    }

    if (newTool === lastCommittedTool) {
      // Returning to this turn's claimed tool (e.g., scratch → x where lastCommittedTool='x').
      setTool(newTool);
      return;
    }

    // newTool is a committed tool that differs from lastCommittedTool — this is a true swap.
    if (committedDiffers(gridState, turnStartGrid)) {
      setTurnNumber((n) => n + 1);
      setTurnStartGrid(gridState);
      setLastCommittedTool(newTool);
      setTool(newTool);
    } else {
      setLastCommittedTool(newTool);
      setTool(newTool);
    }
  };

  // Helper: produce updated cell value, or null to delete the cell entirely.
  const updateCell = (key, catA, a, catB, b, mutator) => {
    setGridState((prev) => {
      const cur = prev[key] || { catA, a, catB, b, committed: null, scratch: null };
      const next = mutator(cur);
      const out = { ...prev };
      if (!next || (next.committed == null && next.scratch == null)) {
        delete out[key];
      } else {
        out[key] = next;
      }
      return out;
    });
    // Any cell change invalidates the last hint/verify result.
    setHint(null);
    setVerifyResult(null);
  };

  // Whether the active tool is allowed to touch a given cell.
  // X tool: cells with committed in {null, 'x'} only.
  // ✓ tool: cells with committed in {null, 'check'} only.
  // Scratch: always.
  const canModifyCell = (cell) => {
    if (tool === 'scratch') return true;
    const c = cell?.committed ?? null;
    if (tool === 'x') return c === null || c === 'x';
    if (tool === 'check') return c === null || c === 'check';
    return false;
  };

  const tapCell = (catA, a, catB, b) => {
    const key = canonKey(catA, a, catB, b);
    const cur = gridState[key];

    // Phase 2: cell restriction by active tool.
    if (!canModifyCell(cur)) return;

    // First committed-tool action ever: claim the turn's tool.
    if ((tool === 'x' || tool === 'check') && lastCommittedTool === null) {
      setLastCommittedTool(tool);
    }

    if (tool === 'x') {
      updateCell(key, catA, a, catB, b, (c) => ({
        ...c,
        committed: c.committed === 'x' ? null : 'x',
      }));
      return;
    }
    if (tool === 'check') {
      updateCell(key, catA, a, catB, b, (c) => ({
        ...c,
        committed: c.committed === 'check' ? null : 'check',
      }));
      return;
    }
    // scratch: tap opens picker. If a label already exists, picker pre-fills for editing.
    if (cur && cur.scratch) {
      setScratchInput(cur.scratch);
      setScratchPicker({ key, catA, a, catB, b, editing: true });
    } else {
      setScratchInput('');
      setScratchPicker({ key, catA, a, catB, b, editing: false });
    }
  };

  const commitScratchLabel = (label) => {
    if (!scratchPicker) return;
    const clean = String(label).slice(0, 2);
    if (!clean) { setScratchPicker(null); return; }
    const { key, catA, a, catB, b } = scratchPicker;
    updateCell(key, catA, a, catB, b, (c) => ({ ...c, scratch: clean }));
    setRecentLabels((prev) => {
      const without = prev.filter((l) => l !== clean);
      return [clean, ...without].slice(0, 6);
    });
    setScratchPicker(null);
    setScratchInput('');
  };

  // Clear the scratch label of the cell currently being edited.
  const clearScratchLabel = () => {
    if (!scratchPicker) return;
    const { key, catA, a, catB, b } = scratchPicker;
    updateCell(key, catA, a, catB, b, (c) => ({ ...c, scratch: null }));
    setScratchPicker(null);
    setScratchInput('');
  };

  const resetGrid = () => {
    setGridState({});
    setHint(null);
    setVerifyResult(null);
    setTurnNumber(1);
    setTurnStartGrid({});
    setLastCommittedTool(null);
  };

  // Hint actions
  const runHint = (tier) => {
    if (!puzzle) return;
    let result;
    if (tier === 1) result = hintTier1(puzzle, gridState);
    else if (tier === 2) result = hintTier2(puzzle, gridState, null);
    else result = hintTier3(puzzle, gridState);
    setHint(result);
    setVerifyResult(null);
  };
  const runVerify = () => {
    if (!puzzle) return;
    setVerifyResult(verifyMarks(puzzle, gridState));
    setHint(null);
  };

  const metrics = useMemo(() => puzzle ? metricsFor(puzzle) : null, [puzzle]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,800&family=JetBrains+Mono:wght@300;400;500;700&display=swap');
        .font-display { font-family: 'Fraunces', 'Times New Roman', serif; font-optical-sizing: auto; }
        .font-mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace; }
        .paper {
          background-color: #f4ecdc;
          background-image:
            radial-gradient(at 15% 20%, rgba(180,100,60,0.08) 0px, transparent 50%),
            radial-gradient(at 85% 80%, rgba(120,40,40,0.06) 0px, transparent 55%),
            repeating-linear-gradient(0deg, rgba(120,80,40,0.02) 0px, rgba(120,80,40,0.02) 1px, transparent 1px, transparent 4px);
        }
        .grain::before {
          content: '';
          position: absolute; inset: 0; pointer-events: none;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.15  0 0 0 0 0.10  0 0 0 0 0.05  0 0 0 0.18 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
          opacity: 0.35;
          mix-blend-mode: multiply;
        }
        .stamp {
          border: 2px solid #8b1a1a;
          color: #8b1a1a;
          padding: 2px 8px;
          letter-spacing: 0.15em;
          display: inline-block;
          transform: rotate(-2deg);
          font-weight: 700;
          background: rgba(255,240,225,0.4);
        }
        .ink { color: #1f1a14; }
        .ink-mute { color: #4a3f30; }
        .ink-red { color: #8b1a1a; }
        .ink-faded { color: #7a6a52; }
        .pin-card {
          background: #fbf6e9;
          border: 1px solid #c8b48a;
          box-shadow: 2px 3px 0 rgba(50,30,10,0.08), inset 0 0 30px rgba(180,140,80,0.05);
        }
        .pin-card-tight {
          background: #fbf6e9;
          border: 1px solid #c8b48a;
        }
        .btn-primary {
          background: #1f1a14;
          color: #f4ecdc;
          padding: 10px 18px;
          font-weight: 600;
          letter-spacing: 0.1em;
          border: 1px solid #1f1a14;
          transition: all 0.15s;
        }
        .btn-primary:hover { background: #8b1a1a; border-color: #8b1a1a; }
        .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
        .ctrl-btn {
          padding: 6px 12px;
          border: 1px solid #8a7960;
          background: transparent;
          color: #1f1a14;
          font-size: 13px;
          letter-spacing: 0.08em;
          transition: all 0.1s;
        }
        .ctrl-btn.active {
          background: #1f1a14;
          color: #f4ecdc;
          border-color: #1f1a14;
        }
        /* Tool palette buttons */
        .tool-btn {
          font-family: 'JetBrains Mono', monospace;
          padding: 6px 12px;
          border: 1px solid #8a7960;
          background: transparent;
          color: #1f1a14;
          font-size: 12px;
          letter-spacing: 0.06em;
          display: inline-flex; align-items: center; gap: 6px;
          transition: all 0.1s;
        }
        .tool-btn .tool-glyph { font-size: 14px; font-weight: 700; }
        .tool-btn .tool-name { text-transform: lowercase; }
        .tool-btn.active.tool-x {
          background: #8b1a1a; color: #f4ecdc; border-color: #8b1a1a;
        }
        .tool-btn.active.tool-check {
          background: #3a5a30; color: #f4ecdc; border-color: #3a5a30;
        }
        .tool-btn.active.tool-scratch {
          background: #1f1a14; color: #f4ecdc; border-color: #1f1a14;
        }
        /* Pip that appears on tool buttons when clicking would advance the turn. */
        .tool-btn.ends-turn { border-color: #8b1a1a; }
        .tool-btn .end-turn-pip {
          font-size: 9px;
          font-weight: 700;
          color: #8b1a1a;
          background: rgba(139,26,26,0.12);
          padding: 1px 4px;
          margin-left: 4px;
          letter-spacing: 0;
        }
        .tool-btn.active.ends-turn .end-turn-pip { color: #f4ecdc; background: rgba(255,255,255,0.18); }
        /* Disallowed cell: subtle low-contrast hint that the active tool can't touch it. */
        .grid-cell.cell-disallowed { cursor: not-allowed; opacity: 0.65; }
        .grid-cell.cell-disallowed:hover { background: #fbf6e9; }
        /* Turn counter on worksheet header */
        .turn-counter {
          display: inline-flex; align-items: baseline;
          padding: 4px 10px;
          border: 1px solid #8a7960;
          background: #fbf6e9;
        }
        /* Destructive variant of ctrl-btn for the picker's remove action */
        .ctrl-btn-warn { color: #8b1a1a; border-color: #8b1a1a; }
        .ctrl-btn-warn:hover { background: #8b1a1a; color: #f4ecdc; }
        /* Chip buttons (recent labels) */
        .chip-btn {
          font-family: 'JetBrains Mono', monospace;
          padding: 4px 10px;
          border: 1px solid #c8b48a;
          background: #fbf6e9;
          color: #1f1a14;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
          cursor: pointer;
          transition: all 0.1s;
        }
        .chip-btn:hover { background: #ede2c5; }
        /* Scratch picker modal */
        .scratch-picker-backdrop {
          position: fixed; inset: 0;
          background: rgba(31,26,20,0.45);
          display: flex; align-items: center; justify-content: center;
          z-index: 100;
          padding: 20px;
        }
        .scratch-picker {
          max-width: 320px;
          width: 100%;
          background: #fbf6e9;
        }
        .scratch-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #8a7960;
          background: #fff;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-align: center;
          color: #1f1a14;
          outline: none;
        }
        .scratch-input:focus { border-color: #1f1a14; }
        /* Hint result styling */
        .hint-result { font-family: 'JetBrains Mono', monospace; }
        .hint-result .hint-tag {
          display: inline-block;
          font-size: 9px;
          letter-spacing: 0.18em;
          padding: 2px 6px;
          border: 1px solid #1f1a14;
          margin-right: 8px;
          text-transform: uppercase;
        }
        .hint-result .proof-step {
          padding-left: 16px;
          position: relative;
          line-height: 1.55;
        }
        .hint-result .proof-step::before {
          content: '—';
          position: absolute;
          left: 0;
          color: #8b1a1a;
        }
        .divider {
          height: 1px;
          background: linear-gradient(90deg, transparent 0%, #8a7960 20%, #8a7960 80%, transparent 100%);
        }
        .hr-fade {
          background-image: linear-gradient(90deg, #8a7960 50%, transparent 50%);
          background-size: 6px 1px;
          height: 1px;
        }
        .cell-yes { background: #1f1a14; color: #f4ecdc; }
        .cell-no { color: #b8a48a; }
        .grid-cell {
          background: #fbf6e9;
          border: none;
          position: relative;
          padding: 0; margin: 0;
          font-family: 'JetBrains Mono', monospace;
          line-height: 1;
          cursor: pointer;
          transition: background 0.08s;
          user-select: none;
        }
        .grid-cell:hover { background: #f1e6c8; }
        .grid-cell.committed-x { color: #8b1a1a; font-weight: 700; }
        .grid-cell.committed-check { color: #1f1a14; background: #ede2c5; font-weight: 700; }
        /* Scratch-mode-on tints. Override committed cell backgrounds. */
        .grid-cell.scratch-mode.committed-x { background: rgba(139,26,26,0.18); }
        .grid-cell.scratch-mode.committed-check { background: rgba(70,110,50,0.18); }
        /* Belt-and-suspenders: hide the committed glyph in scratch mode at CSS
           level too, in case the React conditional somehow doesn't fire. */
        .grid-cell.scratch-mode .glyph { display: none; }
        /* Main glyph (X / check / scratch when alone) */
        .grid-cell .glyph {
          display: flex; align-items: center; justify-content: center;
          width: 100%; height: 100%;
        }
        /* Scratch label as a corner badge when committed mark also exists */
        .grid-cell .scratch-corner {
          position: absolute;
          top: 1px;
          right: 2px;
          font-size: 9px;
          line-height: 1;
          font-weight: 600;
          color: #4a3f30;
          font-family: 'JetBrains Mono', monospace;
        }
        /* Scratch label as the sole content of the cell */
        .grid-cell .scratch-solo {
          font-size: 12px;
          font-weight: 600;
          color: #1f1a14;
        }
        .grid-cell .scratch-solo.faded {
          color: #b3a585;
          font-weight: 500;
        }
        /* Verify-error highlight: distinct cells flagged by verify-marks (not used per
           user spec — they wanted count-only — but kept for potential future use) */
        .grid-cell.verify-err { box-shadow: inset 0 0 0 2px #8b1a1a; }
        .vlabel {
          writing-mode: vertical-rl;
          transform: rotate(180deg);
          white-space: nowrap;
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          color: #1f1a14;
        }
        .rlabel {
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          text-align: right;
          padding-right: 6px;
          line-height: 30px;
          height: 30px;
          color: #1f1a14;
        }
        .cat-tag {
          font-size: 9px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: #8b1a1a;
          font-weight: 700;
        }
        /* Unified staircase table */
        .sc-table {
          border-collapse: collapse;
          font-family: 'JetBrains Mono', monospace;
          /* All grid dimensions derive from these two vars so zoom is one knob. */
          --grid-zoom: 1;
          --cell-base: 18px;
          --col-label-base: 46px;
          --row-label-base: 44px;
          --cat-row-base: 14px;
          --cell-w: calc(var(--cell-base) * var(--grid-zoom));
          --col-h: calc(var(--col-label-base) * var(--grid-zoom));
          --row-w: calc(var(--row-label-base) * var(--grid-zoom));
          --cat-row-w: calc(var(--cat-row-base) * var(--grid-zoom));
        }
        .sc-table th, .sc-table td { padding: 0; margin: 0; }
        .sc-corner {
          background: transparent;
          border: none;
        }
        .sc-cat-col {
          padding: 2px 3px;
          border-bottom: 1px solid #8a7960;
          border-right: 1px solid #c8b48a;
          background: rgba(180,140,80,0.06);
          text-align: center;
          font-size: calc(9px * var(--grid-zoom));
        }
        .sc-item-col {
          height: var(--col-h);
          width: var(--cell-w);
          vertical-align: bottom;
          text-align: center;
          border-bottom: 1px solid #8a7960;
          border-right: 1px solid #c8b48a;
          background: rgba(180,140,80,0.04);
          padding: 0 1px 3px 1px;
        }
        .sc-cat-row {
          width: var(--cat-row-w);
          background: rgba(180,140,80,0.06);
          border-right: 1px solid #8a7960;
          padding: 3px 2px;
          text-align: center;
          vertical-align: middle;
          font-size: calc(9px * var(--grid-zoom));
        }
        .sc-item-row {
          font-size: calc(10px * var(--grid-zoom));
          text-align: right;
          padding-right: calc(4px * var(--grid-zoom));
          border-right: 1px solid #8a7960;
          background: rgba(180,140,80,0.04);
          color: #1f1a14;
          font-weight: 400;
          height: var(--cell-w);
          max-width: var(--row-w);
          width: var(--row-w);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sc-td {
          width: var(--cell-w);
          height: var(--cell-w);
          border: 1px solid #c8b48a;
        }
        .sc-empty {
          width: var(--cell-w);
          height: var(--cell-w);
          background: rgba(120,80,40,0.04);
          border: none;
        }
        .sc-subgrid-edge-r { border-right: 2px solid #8a7960; }
        .sc-subgrid-edge-b { border-bottom: 2px solid #8a7960; }
        /* Scale the grid cell glyphs with zoom too. */
        .sc-table .grid-cell {
          width: var(--cell-w);
          height: var(--cell-w);
          font-size: calc(11px * var(--grid-zoom));
        }
        .sc-table .grid-cell .scratch-corner { font-size: calc(7px * var(--grid-zoom)); }
        .sc-table .grid-cell .scratch-solo  { font-size: calc(9px * var(--grid-zoom)); }
        /* Wrapper that owns horizontal scroll when grid > viewport. */
        .grid-zoom-wrap {
          overflow-x: auto;
          overflow-y: visible;
          -webkit-overflow-scrolling: touch;
        }
        /* Zoom controls */
        .zoom-ctrl {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          border: 1px solid #8a7960;
          background: transparent;
        }
        .zoom-ctrl button {
          font-family: 'JetBrains Mono', monospace;
          background: transparent;
          border: none;
          color: #1f1a14;
          width: 26px;
          height: 26px;
          font-size: 16px;
          cursor: pointer;
          line-height: 1;
        }
        .zoom-ctrl button:disabled { color: #b8a48a; cursor: not-allowed; }
        .zoom-ctrl .zoom-label {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          padding: 0 6px;
          min-width: 30px;
          text-align: center;
          color: #4a3f30;
        }
      `}</style>

      <div className="paper grain relative min-h-screen ink p-6 md:p-10 font-mono" style={{ position: 'relative' }}>
        <div className="max-w-5xl mx-auto relative" style={{ zIndex: 1 }}>

          {/* Header */}
          <header className="mb-8">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs ink-faded tracking-[0.3em] uppercase mb-1">Case File · No. 7B-12</div>
                <h1 className="font-display text-5xl md:text-6xl font-semibold leading-none ink">
                  The Deduction Engine
                </h1>
                <div className="font-display italic text-lg ink-mute mt-3 max-w-xl">
                  A generator for sprawling, uniquely-solvable logic puzzles — sample a solution, distill the minimal clue set, watch the cascade.
                </div>
              </div>
              <div className="stamp font-mono text-xs">CONFIDENTIAL</div>
            </div>
            <div className="divider mt-6"></div>
          </header>

          {/* Controls */}
          <section className="mb-8">
            <div className="text-xs ink-faded tracking-[0.25em] uppercase mb-3">Parameters</div>
            <div className="flex flex-wrap gap-6">
              <div>
                <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5">Size</div>
                <div className="flex gap-1">
                  {[3, 4, 5].map((n) => (
                    <button key={n} className={`ctrl-btn ${size === n ? 'active' : ''}`} onClick={() => setSize(n)}>
                      {n}×{n}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5">Theme</div>
                <div className="flex gap-1 flex-wrap">
                  {Object.entries(themes).map(([k, t]) => (
                    <button key={k} className={`ctrl-btn ${themeKey === k ? 'active' : ''}`} onClick={() => setThemeKey(k)}>
                      {t.label.split('—')[0].trim()}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5">Difficulty bias</div>
                <div className="flex gap-1">
                  {['easy', 'medium', 'hard'].map((d) => (
                    <button key={d} className={`ctrl-btn ${difficulty === d ? 'active' : ''}`} onClick={() => setDifficulty(d)}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5" title="Generate N candidates and keep the highest-scoring one.">
                  Samples
                </div>
                <div className="flex gap-1">
                  {[1, 5, 10, 25].map((n) => (
                    <button key={n} className={`ctrl-btn ${sampleCount === n ? 'active' : ''}`} onClick={() => setSampleCount(n)}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={generate} disabled={generating} className="btn-primary mt-6 font-mono text-sm">
              {generating ? `GENERATING ${progress.done}/${progress.total}...` : 'GENERATE PUZZLE'}
            </button>
          </section>

          <div className="hr-fade mb-8"></div>

          {/* Empty state */}
          {!puzzle && !generating && (
            <div className="ink-faded font-display italic text-lg max-w-xl">
              Press <span className="ink">GENERATE PUZZLE</span> to sample a fresh case. Pick a theme to taste — the engine doesn't care what skin you put on the variables.
            </div>
          )}

          {/* Puzzle output */}
          {puzzle && (
            <div className="space-y-8">
              {/* Prompt */}
              <section>
                <div className="text-xs ink-faded tracking-[0.25em] uppercase mb-2">The Brief</div>
                <p className="font-display text-2xl ink leading-snug">{theme.prompt}</p>
              </section>

              {/* Clues */}
              <section>
                <div className="flex items-baseline justify-between mb-3">
                  <div className="text-xs ink-faded tracking-[0.25em] uppercase">Evidence — {puzzle.clues.length} clues</div>
                  <div className="text-[11px] ink-faded font-mono">minimal set; each clue is load-bearing</div>
                </div>
                <ol className="space-y-2">
                  {puzzle.clues.map((c, i) => (
                    <li key={i} className="pin-card-tight p-3 flex gap-3 items-start">
                      <span className="ink-red font-bold text-xs mt-0.5 min-w-[28px]">№{String(i + 1).padStart(2, '0')}</span>
                      <span className="ink text-sm leading-relaxed">{theme.renderClue(c)}</span>
                      <span className="ml-auto text-[10px] ink-faded uppercase tracking-widest shrink-0">{c.type}</span>
                    </li>
                  ))}
                </ol>
              </section>

              {/* Worksheet grid */}
              <section>
                <div className="flex items-baseline justify-between mb-3 gap-4 flex-wrap">
                  <div>
                    <div className="text-xs ink-faded tracking-[0.25em] uppercase">Worksheet</div>
                    <div className="text-[11px] ink-faded font-mono mt-0.5">
                      pick a tool — tap cells to mark
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="turn-counter">
                      <span className="text-[10px] ink-faded uppercase tracking-widest mr-1.5">Turn</span>
                      <span className="font-display text-xl ink leading-none">{turnNumber}</span>
                      <span className="text-[10px] ink-faded uppercase tracking-widest mx-1.5">/ par</span>
                      <span className={`font-display text-xl leading-none ${turnNumber > puzzle.par ? 'ink-red' : 'ink'}`}>{puzzle.par}</span>
                    </div>
                    <button className="ctrl-btn" onClick={resetGrid}>reset</button>
                  </div>
                </div>

                {/* Tool palette */}
                {(() => {
                  const turnLocked = lastCommittedTool !== null && committedDiffers(gridState, turnStartGrid);
                  const wouldEndTurn = (target) =>
                    turnLocked && target !== 'scratch' && target !== lastCommittedTool;
                  return (
                    <div className="pin-card-tight p-2 mb-3 flex gap-2 items-center flex-wrap">
                      <span className="text-[10px] ink-faded uppercase tracking-widest mr-1">Tool:</span>
                      <button
                        className={`tool-btn ${tool === 'x' ? 'active tool-x' : ''} ${wouldEndTurn('x') ? 'ends-turn' : ''}`}
                        onClick={() => selectTool('x')}
                        aria-label="X tool (eliminate)"
                      >
                        <span className="tool-glyph">✕</span>
                        <span className="tool-name">eliminate</span>
                        {wouldEndTurn('x') && <span className="end-turn-pip">+1</span>}
                      </button>
                      <button
                        className={`tool-btn ${tool === 'check' ? 'active tool-check' : ''} ${wouldEndTurn('check') ? 'ends-turn' : ''}`}
                        onClick={() => selectTool('check')}
                        aria-label="Check tool (confirm)"
                      >
                        <span className="tool-glyph">✓</span>
                        <span className="tool-name">confirm</span>
                        {wouldEndTurn('check') && <span className="end-turn-pip">+1</span>}
                      </button>
                      <button
                        className={`tool-btn ${tool === 'scratch' ? 'active tool-scratch' : ''}`}
                        onClick={() => selectTool('scratch')}
                        aria-label="Scratch tool (label)"
                      >
                        <span className="tool-glyph">··</span>
                        <span className="tool-name">scratch</span>
                      </button>
                      {tool === 'scratch' && (
                        <span className="text-[10px] ink-faded italic ml-2">
                          tap a cell to label · tap an existing label to edit
                        </span>
                      )}
                      {turnLocked && tool !== 'scratch' && (
                        <span className="text-[10px] ink-red italic ml-2">
                          locked to {tool === 'x' ? '✕' : '✓'} this turn — switching ends it
                        </span>
                      )}
                    </div>
                  );
                })()}

                {/* Hint cluster */}
                <div className="pin-card-tight p-2 mb-3 flex gap-2 items-center flex-wrap">
                  <span className="text-[10px] ink-faded uppercase tracking-widest mr-1">Stuck?</span>
                  <button className="ctrl-btn" onClick={() => runHint(1)}>tier 1 · next step</button>
                  <button className="ctrl-btn" onClick={() => runHint(2)}>tier 2 · proof</button>
                  <button className="ctrl-btn" onClick={() => runHint(3)}>tier 3 · solvable?</button>
                  <button className="ctrl-btn" onClick={runVerify}>verify marks</button>
                </div>

                {/* Hint / verify result */}
                {verifyResult && (
                  <div className="pin-card p-3 mb-3 hint-result">
                    {verifyResult.status === 'all-consistent' ? (
                      <div className="ink text-sm">
                        <span className="stamp text-[10px] mr-2">VERIFIED</span>
                        All your marks are consistent with the solution so far.
                      </div>
                    ) : (
                      <div className="ink text-sm">
                        <span className="stamp text-[10px] mr-2">RETRACTION</span>
                        <strong className="ink-red">{verifyResult.count}</strong> of your marks {verifyResult.count === 1 ? 'is' : 'are'} incorrect.
                      </div>
                    )}
                  </div>
                )}
                {hint && (
                  <div className="pin-card p-3 mb-3 hint-result">
                    <HintResult hint={hint} theme={theme} />
                  </div>
                )}

                <Legend categories={puzzle.categories} anchorKey={puzzle.anchorKey} />
                <div className="mt-3 pin-card p-3">
                  <div className="flex items-center justify-end mb-2 gap-2">
                    <div className="zoom-ctrl">
                      <button
                        onClick={() => {
                          const i = ZOOM_STEPS.indexOf(gridZoom);
                          if (i > 0) setGridZoom(ZOOM_STEPS[i - 1]);
                        }}
                        disabled={gridZoom === ZOOM_STEPS[0]}
                        aria-label="zoom out"
                      >−</button>
                      <span className="zoom-label">{gridZoom}×</span>
                      <button
                        onClick={() => {
                          const i = ZOOM_STEPS.indexOf(gridZoom);
                          if (i < ZOOM_STEPS.length - 1) setGridZoom(ZOOM_STEPS[i + 1]);
                        }}
                        disabled={gridZoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                        aria-label="zoom in"
                      >+</button>
                    </div>
                  </div>
                  <StaircaseGrid
                    puzzle={puzzle}
                    gridState={gridState}
                    onTap={tapCell}
                    scratchMode={tool === 'scratch'}
                    activeTool={tool}
                    zoom={gridZoom}
                  />
                </div>
              </section>

              {/* Metrics */}
              <section>
                <div className="text-xs ink-faded tracking-[0.25em] uppercase mb-3">Trace Profile</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Metric label="Propagation passes" value={metrics.passes} note="depth of deduction" />
                  <Metric label="Total derivations" value={metrics.totalDerivations} note="facts the solver inferred" />
                  <Metric label="From clue→table" value={metrics.bySource.clue} note="direct clue applications" />
                  <Metric label="From propagation" value={metrics.bySource.exclusivity + metrics.bySource.transitivity + metrics.bySource['last-option']} note="exclusivity + transitivity + last-option" />
                </div>
                <div className="mt-3 text-xs ink-faded font-mono">
                  Clue mix: {Object.entries(metrics.byClueType).map(([k, v]) => `${k}×${v}`).join(' · ')}
                </div>
              </section>

              {/* Sampling stats */}
              {candidates && candidates.length > 0 && (
                <SamplingPanel candidates={candidates} selected={puzzle} />
              )}

              {/* Solution toggle */}
              <section>
                <div className="flex gap-2 mb-3">
                  <button className={`ctrl-btn ${showSolution ? 'active' : ''}`} onClick={() => setShowSolution((s) => !s)}>
                    {showSolution ? 'hide solution' : 'reveal solution'}
                  </button>
                  <button className={`ctrl-btn ${showTrace ? 'active' : ''}`} onClick={() => setShowTrace((s) => !s)}>
                    {showTrace ? 'hide trace' : 'show deduction trace'}
                  </button>
                </div>

                {showSolution && (
                  <div className="pin-card p-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          {Object.keys(puzzle.categories).map((cat) => (
                            <th key={cat} className="text-left ink-faded uppercase text-[10px] tracking-widest pb-2 pr-4">{cat}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {puzzle.solution.map((row, i) => (
                          <tr key={i} className="border-t border-[#c8b48a]/50">
                            {Object.keys(puzzle.categories).map((cat) => (
                              <td key={cat} className="py-2 pr-4 ink">{row[cat]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {showTrace && (
                  <div className="pin-card p-4 mt-3 max-h-96 overflow-y-auto">
                    <TraceView puzzle={puzzle} theme={theme} />
                  </div>
                )}
              </section>

              {/* Notes */}
              <section className="pt-4">
                <div className="hr-fade mb-4"></div>
                <div className="text-xs ink-faded italic font-display leading-relaxed max-w-3xl">
                  Notes from the field: the engine samples a random bijection, enumerates every true statement of each clue type, then greedily adds clues until propagation alone collapses the puzzle to one solution. It then runs three minimization passes — dropping any clue whose absence still permits solving — leaving you with a tight, load-bearing set. Difficulty bias weights the candidate ordering toward Is-clues (easy) or relational/Not-clues (hard); the actual difficulty is observable in the trace profile, not declared up front.
                </div>
              </section>
            </div>
          )}

          <footer className="mt-16 pt-6 border-t border-[#8a7960]/40 text-[10px] ink-faded uppercase tracking-[0.25em] flex justify-between">
            <span>Deduction Engine · v0.1</span>
            <span>filed for review</span>
          </footer>
        </div>
      </div>
      {scratchPicker && (
        <div
          className="scratch-picker-backdrop"
          onClick={() => setScratchPicker(null)}
        >
          <div
            className="scratch-picker pin-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] ink-faded uppercase tracking-widest mb-2">
              {scratchPicker.editing ? 'Edit scratch label' : 'New scratch label'}
            </div>
            <div className="text-[11px] ink-faded mb-3 italic">
              {scratchPicker.editing
                ? 'Change the label, or clear it.'
                : 'Pick a 1–2 character note. Engine ignores these — they\'re just for you.'}
            </div>
            <input
              autoFocus
              className="scratch-input font-mono"
              type="text"
              maxLength={2}
              value={scratchInput}
              onChange={(e) => setScratchInput(e.target.value.slice(0, 2))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitScratchLabel(scratchInput);
                if (e.key === 'Escape') setScratchPicker(null);
              }}
              placeholder="e.g. 1, A, ?"
            />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(recentLabels.length > 0 ? recentLabels : DEFAULT_SCRATCH_LABELS).map((l) => (
                <button
                  key={l}
                  className="chip-btn font-mono"
                  onClick={() => commitScratchLabel(l)}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2 flex-wrap">
              {scratchPicker.editing && (
                <button className="ctrl-btn ctrl-btn-warn" onClick={clearScratchLabel}>
                  remove
                </button>
              )}
              <button className="ctrl-btn" onClick={() => setScratchPicker(null)}>cancel</button>
              <button
                className="btn-primary text-xs"
                onClick={() => commitScratchLabel(scratchInput)}
                disabled={!scratchInput}
              >
                {scratchPicker.editing ? 'save' : 'place'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// Hint result rendering
// ============================================================

// Render a fact in theme-aware prose. Uses theme.propLine like the trace view.
function factSentence(fact, theme) {
  return capit(theme.propLine(fact.catA, fact.a, fact.catB, fact.b, fact.value));
}

// Describe a cascade step in a single readable phrase.
function cascadePhrase(kind) {
  if (kind === 'exclusivity') return 'by exclusivity';
  if (kind === 'transitivity') return 'by transitivity';
  if (kind === 'last-option') return 'only that option remains';
  return kind;
}

function HintResult({ hint, theme }) {
  // Contradiction routes (Tier 1/2/3 all use this when player marks contradict).
  if (hint.contradiction) {
    return (
      <div className="ink text-sm leading-relaxed">
        <span className="hint-tag">tier {hint.tier}</span>
        Your marks contradict the clues. You have{' '}
        <strong className="ink-red">{hint.count}</strong> incorrect{' '}
        {hint.count === 1 ? 'mark' : 'marks'}. Reset and rethink, or look for a wrong ✕ or ✓.
      </div>
    );
  }

  if (hint.tier === 1) {
    if (hint.noProgress) {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 1</span>
          No clue-driven next step from here. Either you've extracted everything the clues offer — in which case just keep propagating exclusivity through your committed marks — or try Tier 2 to see a proof for a specific cell.
        </div>
      );
    }
    if (hint.wrongMarks) {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 1</span>
          No clue-driven progress is possible, and you have{' '}
          <strong className="ink-red">{hint.count}</strong> incorrect{' '}
          {hint.count === 1 ? 'mark' : 'marks'} blocking it. Use <em>verify marks</em> to locate them.
        </div>
      );
    }
    return (
      <div className="ink text-sm leading-relaxed">
        <span className="hint-tag">tier 1 · next step</span>
        <strong>{factSentence(hint.fact, theme)}.</strong>{' '}
        {hint.originClue && (
          <>
            <span className="ink-faded">— follows from </span>
            <em>"{theme.renderClue(hint.originClue)}"</em>
          </>
        )}
      </div>
    );
  }

  if (hint.tier === 2) {
    if (hint.noProgress) {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 2</span>
          No new deduction is currently reachable from your marks. The clues may already be exhausted — try propagating exclusivity through your existing committed cells row by row.
        </div>
      );
    }
    if (hint.wrongMarks) {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 2</span>
          No new deduction is reachable, and you have{' '}
          <strong className="ink-red">{hint.count}</strong> incorrect{' '}
          {hint.count === 1 ? 'mark' : 'marks'} blocking progress. Use <em>verify marks</em> to locate them.
        </div>
      );
    }
    if (hint.focusUnreachable) {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 2</span>
          That cell isn't derivable from your current state. Either it's already determined by your marks, or you need to lay more groundwork first.
        </div>
      );
    }
    // hint.dag is topologically ordered: dependencies first, target last.
    // The FINAL step is the conclusion's own derivation — we pull its rule and
    // direct inputs up into a prose headline, then render the upstream steps
    // as supporting evidence (how each input was established).
    const steps = hint.dag;
    const final = steps[steps.length - 1];
    const supporting = steps.slice(0, -1);

    // Headline reads as: "By <rule>: <input>, <input>, therefore <conclusion>."
    let headline;
    if (final.kind === 'cascade') {
      const inputs = [final.from, ...final.deps].filter(Boolean);
      const prefix = final.cascadeType === 'last-option'
        ? 'By elimination'
        : `By ${final.cascadeType}`;
      headline = (
        <>
          <em>{prefix}:</em>{' '}
          {inputs.map((d, i) => (
            <span key={i}>
              {i > 0 ? ', ' : ''}
              <em>{factSentence(d, theme)}</em>
            </span>
          ))}
          , therefore <strong>{factSentence(final.fact, theme)}</strong>.
        </>
      );
    } else if (final.kind === 'clue') {
      headline = (
        <>
          <em>By clue "{theme.renderClue(final.clue)}"</em>
          {final.deps.length > 0 && (
            <>
              {', given '}
              {final.deps.map((d, i) => (
                <span key={i}>
                  {i > 0 ? ', ' : ''}
                  <em>{factSentence(d, theme)}</em>
                </span>
              ))}
            </>
          )}
          {': '}<strong>{factSentence(final.fact, theme)}</strong>.
        </>
      );
    } else {
      headline = <strong>{factSentence(hint.fact, theme)}</strong>;
    }

    return (
      <div className="ink text-sm leading-relaxed">
        <span className="hint-tag">tier 2 · proof</span>
        <div>{headline}</div>
        {supporting.length > 0 && (
          <>
            <div className="mt-2 ink-faded text-xs uppercase tracking-widest mb-1">
              Chain that established those inputs:
            </div>
            <div className="space-y-1 text-sm">
              {supporting.map((s, i) => {
                if (s.kind === 'clue') {
                  return (
                    <div key={i} className="proof-step">
                      <em>Clue:</em> "{theme.renderClue(s.clue)}" — gives{' '}
                      <strong>{factSentence(s.fact, theme)}</strong>
                      {s.deps.length > 0 && (
                        <span className="ink-faded">
                          {' '}(given{' '}
                          {s.deps.map((d, j) => (
                            <span key={j}>
                              {j > 0 ? ', ' : ''}
                              <em>{factSentence(d, theme)}</em>
                            </span>
                          ))}
                          )
                        </span>
                      )}
                    </div>
                  );
                }
                if (s.kind === 'mark') {
                  return (
                    <div key={i} className="proof-step">
                      <span className="ink-red">Your mark:</span>{' '}
                      <strong>{factSentence(s.fact, theme)}</strong>
                    </div>
                  );
                }
                if (s.kind === 'given') {
                  return (
                    <div key={i} className="proof-step ink-faded">
                      Given: <strong>{factSentence(s.fact, theme)}</strong>
                    </div>
                  );
                }
                // cascade — list every input fact
                const inputs = [s.from, ...s.deps].filter(Boolean);
                return (
                  <div key={i} className="proof-step ink-faded">
                    {inputs.map((src, j) => (
                      <span key={j}>
                        {j > 0 ? ' + ' : ''}
                        <em>{factSentence(src, theme)}</em>
                      </span>
                    ))}
                    {' '}({cascadePhrase(s.cascadeType)}) →{' '}
                    <strong className="ink">{factSentence(s.fact, theme)}</strong>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  if (hint.tier === 3) {
    if (hint.status === 'solved') {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 3 · solvable</span>
          From your current marks, the puzzle resolves to a unique solution in{' '}
          <strong>{hint.passes}</strong> further propagation pass{hint.passes === 1 ? '' : 'es'}.
        </div>
      );
    }
    if (hint.status === 'underdetermined') {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 3 · stuck</span>
          The clues plus your current marks don't determine a unique solution. You may have missed a deduction — try Tier 1 to surface the next step.
        </div>
      );
    }
    return null;
  }

  return null;
}


function Metric({ label, value, note }) {
  return (
    <div className="pin-card-tight p-3">
      <div className="text-[10px] ink-faded uppercase tracking-widest mb-1">{label}</div>
      <div className="font-display text-3xl ink leading-none">{value}</div>
      <div className="text-[10px] ink-faded mt-1.5 italic">{note}</div>
    </div>
  );
}

function TraceView({ puzzle, theme }) {
  // Group derivations by pass markers.
  const groups = [];
  let cur = null;
  for (const t of puzzle.trace) {
    if (t.marker === 'pass-start') {
      if (cur) groups.push(cur);
      cur = { pass: t.pass, items: [] };
    } else if (cur) {
      cur.items.push(t);
    }
  }
  if (cur) groups.push(cur);

  const fmtFact = (f) => {
    const left = `${f.catA}=${f.a}`;
    const right = `${f.catB}=${f.b}`;
    const op = f.value === 'yes' ? '=' : '≠';
    return `${left} ${op} ${right}`;
  };
  const fmtSource = (s) => {
    if (!s) return '';
    if (s.type === 'clue') return `clue: ${theme.renderClue(s.clue)}`;
    return s.type;
  };

  return (
    <div className="space-y-3 text-xs">
      {groups.map((g, i) => (
        <div key={i}>
          <div className="ink-red font-bold tracking-widest text-[10px] uppercase mb-1.5">Pass {g.pass} · {g.items.length} derivations</div>
          <ul className="space-y-1 pl-2">
            {g.items.slice(0, 30).map((f, j) => (
              <li key={j} className="ink flex gap-2">
                <span className="ink-faded shrink-0 w-32 truncate">[{fmtSource(f.source).slice(0, 30)}]</span>
                <span>{fmtFact(f)}</span>
              </li>
            ))}
            {g.items.length > 30 && <li className="ink-faded italic">…{g.items.length - 30} more</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Worksheet grid
// ============================================================

function Legend({ categories, anchorKey }) {
  const order = [anchorKey, ...Object.keys(categories).filter(k => k !== anchorKey)];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-[11px] pin-card-tight p-3">
      {order.map(cat => {
        const items = categories[cat];
        const hasLongNames = items.some(it => String(it).length > 7);
        return (
          <div key={cat}>
            <div className="cat-tag mb-1">{cat}</div>
            {items.map(item => {
              const sl = shortLabel(item);
              const full = String(item);
              return (
                <div key={item} className="leading-snug">
                  {hasLongNames ? (
                    <><span className="font-bold ink">{sl}</span> <span className="ink-faded">— {full}</span></>
                  ) : (
                    <span className="ink">{full}</span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function StaircaseGrid({ puzzle, gridState, onTap, scratchMode, activeTool, zoom }) {
  const { categories, anchorKey } = puzzle;
  const order = [anchorKey, ...Object.keys(categories).filter((k) => k !== anchorKey)];
  const nCats = order.length;
  // Rows: every category except the last (which would have no pairs to show).
  const rowCats = order.slice(0, -1);
  // Columns: non-anchor categories in REVERSE order. This puts the staircase
  // shape XXX/XX/X with all rows left-aligned and empty cells in the bottom-right.
  const colCats = order.slice(1).reverse();
  const n = categories[order[0]].length;

  // Decide whether a (row, col) intersection in the staircase should hold a real
  // subgrid or be empty. Pair (rowCats[i], colCats[j]) is unique iff i+j < nCats-1.
  const showPair = (rowIdx, colIdx) => rowIdx + colIdx < nCats - 1;

  // Whether the active tool is allowed to touch this cell's committed state.
  // Scratch tool: anything. X tool: only blank or X cells. ✓ tool: only blank or ✓ cells.
  const isDisallowed = (committed) => {
    if (activeTool === 'scratch') return false;
    if (activeTool === 'x') return committed === 'check';
    if (activeTool === 'check') return committed === 'x';
    return false;
  };

  return (
    <div className="grid-zoom-wrap">
      <table className="sc-table" style={{ '--grid-zoom': zoom || 1 }}>
        <thead>
          {/* Row 1: category names spanning their item columns. */}
          <tr>
            <th colSpan={2} className="sc-corner"></th>
            {colCats.map((catCol, idx) => (
              <th
                key={catCol}
                colSpan={n}
                className={`sc-cat-col ${idx < colCats.length - 1 ? 'sc-subgrid-edge-r' : ''}`}
              >
                <div className="cat-tag">{catCol}</div>
              </th>
            ))}
          </tr>
          {/* Row 2: per-item column labels (rotated vertically). */}
          <tr>
            <th colSpan={2} className="sc-corner"></th>
            {colCats.flatMap((catCol, catIdx) =>
              categories[catCol].map((item, idx) => (
                <th
                  key={`${catCol}::${item}`}
                  className={`sc-item-col ${idx === n - 1 && catIdx < colCats.length - 1 ? 'sc-subgrid-edge-r' : ''}`}
                  title={String(item)}
                >
                  <div className="vlabel">{shortLabel(item)}</div>
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {rowCats.flatMap((rowCat, rowCatIdx) =>
            categories[rowCat].map((rowItem, itemIdx) => {
              const isLastInStripe = itemIdx === n - 1;
              const stripeEdge = isLastInStripe && rowCatIdx < rowCats.length - 1;
              return (
                <tr key={`${rowCat}::${rowItem}`}>
                  {itemIdx === 0 && (
                    <th
                      rowSpan={n}
                      className={`sc-cat-row ${rowCatIdx < rowCats.length - 1 ? 'sc-subgrid-edge-b' : ''}`}
                    >
                      <div
                        className="cat-tag"
                        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                      >
                        {rowCat}
                      </div>
                    </th>
                  )}
                  <th
                    className={`sc-item-row ${stripeEdge ? 'sc-subgrid-edge-b' : ''}`}
                    title={String(rowItem)}
                  >
                    {shortLabel(rowItem)}
                  </th>
                  {colCats.flatMap((colCat, colCatIdx) => {
                    if (!showPair(rowCatIdx, colCatIdx)) {
                      // Empty triangle in bottom-right of staircase.
                      return categories[colCat].map((colItem) => (
                        <td key={`${colCat}::${colItem}`} className="sc-empty" />
                      ));
                    }
                    return categories[colCat].map((colItem, colItemIdx) => {
                      const key = canonKey(rowCat, rowItem, colCat, colItem);
                      const cell = gridState[key];
                      const committed = cell?.committed || null;
                      const scratch = cell?.scratch || null;
                      // Compose the inner content depending on what's present.
                      let glyph = null;
                      let corner = null;
                      let solo = null;
                      if (committed === 'x') glyph = '✕';
                      else if (committed === 'check') glyph = '✓';
                      // Scratch display rules:
                      //   scratch mode ON  → always show if present (corner if committed exists, solo otherwise)
                      //   scratch mode OFF → only show if no committed mark, and grayed
                      if (scratch) {
                        if (committed) {
                          if (scratchMode) corner = scratch;
                          // else: hidden under committed (preserved in state)
                        } else {
                          solo = scratch;
                        }
                      }
                      const inSubgridEdge = colItemIdx === n - 1 && colCatIdx < colCats.length - 1;
                      const disallowed = isDisallowed(committed);
                      const cellClasses = [
                        'grid-cell',
                        committed === 'x' ? 'committed-x' : '',
                        committed === 'check' ? 'committed-check' : '',
                        scratchMode ? 'scratch-mode' : '',
                        disallowed ? 'cell-disallowed' : '',
                      ].filter(Boolean).join(' ');
                      return (
                        <td
                          key={`${colCat}::${colItem}`}
                          className={`sc-td ${inSubgridEdge ? 'sc-subgrid-edge-r' : ''} ${stripeEdge ? 'sc-subgrid-edge-b' : ''}`}
                        >
                          <button
                            onClick={() => onTap(rowCat, rowItem, colCat, colItem)}
                            className={cellClasses}
                            aria-label={`${rowCat}=${rowItem} vs ${colCat}=${colItem}: ${committed || 'blank'}${scratch ? ` (scratch:${scratch})` : ''}`}
                          >
                            {glyph && !scratchMode && <span className="glyph">{glyph}</span>}
                            {solo && <span className={`scratch-solo ${scratchMode ? '' : 'faded'}`}>{solo}</span>}
                            {corner && <span className="scratch-corner">{corner}</span>}
                          </button>
                        </td>
                      );
                    });
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Sampling stats
// ============================================================

function SamplingPanel({ candidates, selected }) {
  // candidates is sorted desc by _score.
  const scores = candidates.map((c) => c._score);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const range = Math.max(max - min, 0.0001);
  const median = scores[Math.floor(scores.length / 2)];
  const selectedScore = selected._score;

  return (
    <section>
      <div className="text-xs ink-faded tracking-[0.25em] uppercase mb-3">Candidate Sampling</div>
      <div className="pin-card p-4">
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs font-mono mb-4">
          <div>
            <span className="ink-faded">selected </span>
            <span className="ink-red font-bold text-base">{selectedScore.toFixed(1)}</span>
          </div>
          <div>
            <span className="ink-faded">median </span>
            <span className="ink">{median.toFixed(1)}</span>
          </div>
          <div>
            <span className="ink-faded">range </span>
            <span className="ink">{min.toFixed(1)} – {max.toFixed(1)}</span>
          </div>
          <div>
            <span className="ink-faded">samples </span>
            <span className="ink">{candidates.length}</span>
          </div>
        </div>
        {/* Histogram: one bar per candidate, sorted desc, selected highlighted */}
        <div className="flex items-end gap-1" style={{ height: 60 }}>
          {scores.map((s, i) => {
            const h = ((s - min) / range) * 56 + 4;
            const isTop = i === 0;
            return (
              <div
                key={i}
                style={{
                  height: h,
                  width: 18,
                  flexShrink: 0,
                  background: isTop ? '#8b1a1a' : 'rgba(138, 121, 96, 0.5)',
                }}
                title={`#${i + 1}: ${s.toFixed(2)}`}
              />
            );
          })}
        </div>
        <div className="mt-3 text-[11px] ink-faded italic font-display leading-snug max-w-2xl">
          Score = passes × leverage + 2·diversity − clue-count penalty. Leverage is cascade derivations per clue; high values mean each clue powers a lot of follow-on facts. A wide range here is the sampling filter doing real work — without it you'd get whichever puzzle generated first, not the most cascade-rich one.
        </div>
      </div>
    </section>
  );
}
