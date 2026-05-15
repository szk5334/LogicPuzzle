// Positional clues. The anchor category must be ordered (numeric or otherwise
// comparable). Each clue's predicate constrains anchor positions of the named
// items; the propagator enumerates surviving (pa, pb[, pc]) combinations and
// marks 'no' for any position eliminated for one of the items.
//
// Phase 2.5.B will generalize the implicit anchor to a `categoryRef` parameter
// for ordered non-anchor categories. The current signatures still take an
// `anchorKey` directly.

import { getFact, pushFact } from '../propagation.js';

// ----- Positional clues (binary helper) -----
// Two items with positions constrained by a predicate on (pa, pb). Anchor must be
// an ordered numeric category. Propagates by enumerating valid (pa,pb) pairs that
// are still consistent with the table and deriving forced facts.
export function binaryPosClue(type, catA, a, catB, b, anchorKey, predicate, extra = {}) {
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
export function ternaryPosClue(type, catA, a, catB, b, catC, c, anchorKey, predicate) {
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
export const clueNextTo = (catA, a, catB, b, ak) =>
  binaryPosClue('nextTo', catA, a, catB, b, ak, (pa, pb) => Math.abs(pa - pb) === 1);

export const clueImmLeft = (catA, a, catB, b, ak) =>
  binaryPosClue('immLeft', catA, a, catB, b, ak, (pa, pb) => pa + 1 === pb);

export const clueLeftOf = (catA, a, catB, b, ak) =>
  binaryPosClue('leftOf', catA, a, catB, b, ak, (pa, pb) => pa < pb);

export const clueExactlyApart = (catA, a, catB, b, ak, dist) =>
  binaryPosClue('exactlyApart', catA, a, catB, b, ak, (pa, pb) => Math.abs(pa - pb) === dist, { dist });

export const clueBetween = (catA, a, catB, b, catC, c, ak) =>
  ternaryPosClue('between', catA, a, catB, b, catC, c, ak,
    (pa, pb, pc) => (pb < pa && pa < pc) || (pc < pa && pa < pb));

// Additional binary positional clues.
export const clueImmRight  = (catA, a, catB, b, ak) =>
  binaryPosClue('immRight',  catA, a, catB, b, ak, (pa, pb) => pa === pb + 1);
export const clueRightOf   = (catA, a, catB, b, ak) =>
  binaryPosClue('rightOf',   catA, a, catB, b, ak, (pa, pb) => pa > pb);
export const clueNotNextTo = (catA, a, catB, b, ak) =>
  binaryPosClue('notNextTo', catA, a, catB, b, ak, (pa, pb) => pa !== pb && Math.abs(pa - pb) !== 1);
export const clueWithin    = (catA, a, catB, b, ak, dist) =>
  binaryPosClue('within',    catA, a, catB, b, ak, (pa, pb) => pa !== pb && Math.abs(pa - pb) <= dist, { dist });

// Unary positional clues — single item, constraint on its anchor position alone.
export function unaryPosClue(type, catA, a, anchorKey, satisfies) {
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

export const clueAtEnd = (catA, a, ak) =>
  unaryPosClue('atEnd', catA, a, ak, (p, ps) => p === Math.min(...ps) || p === Math.max(...ps));
export const clueNotAtEnd = (catA, a, ak) =>
  unaryPosClue('notAtEnd', catA, a, ak, (p, ps) => p !== Math.min(...ps) && p !== Math.max(...ps));
