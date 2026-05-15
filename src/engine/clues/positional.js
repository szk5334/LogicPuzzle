// Positional clues. Each clue carries:
//   - `axisKey`:   the ordered category whose item order defines positions.
//   - `axisValues`: a snapshot of that category's item array at construction
//                   time. Position is the INDEX of an item's axis-value in
//                   axisValues (0..N-1), so predicates work uniformly across
//                   numeric anchors (e.g., seat 1..N) and non-numeric ordered
//                   axes (e.g., ages [22, 31, 41, 55]).
//
// Field name note: this file calls the axis category `axisKey` throughout.
// Before Phase 2.5.B it was named `anchorKey`, on the assumption the anchor
// was the only ordered axis. The new name reads correctly whether the axis
// is the puzzle's anchor or any other ordered non-anchor category. The field
// is internal to positional.js and the renderer-axis branch in render.js —
// nothing else inspects it.

import { getFact, pushFact } from '../propagation.js';

// ----- Positional clues (binary helper) -----
// Predicate takes (indexA, indexB) where indices are 0-based positions on
// axisKey. Propagation enumerates surviving (vA, vB) value pairs that satisfy
// the predicate under the current table, then marks 'no' for any axis value
// that survives for neither item.
export function binaryPosClue(type, catA, a, catB, b, axisKey, axisValues, predicate, extra = {}) {
  return {
    type,
    catA, a, catB, b, axisKey, axisValues,
    ...extra,
    test: (sol) => {
      const va = sol.find((r) => r[catA] === a)[axisKey];
      const vb = sol.find((r) => r[catB] === b)[axisKey];
      return predicate(axisValues.indexOf(va), axisValues.indexOf(vb));
    },
    propagate(table, trace) {
      const axisVals = table.categories[axisKey];
      const possibleA = axisVals.filter((v) => getFact(table, catA, a, axisKey, v) !== 'no');
      const possibleB = axisVals.filter((v) => getFact(table, catB, b, axisKey, v) !== 'no');
      const valid = [];
      for (const va of possibleA) for (const vb of possibleB) {
        if (predicate(axisVals.indexOf(va), axisVals.indexOf(vb))) valid.push([va, vb]);
      }
      if (valid.length === 0) return { ok: false };
      const okA = new Set(valid.map((p) => p[0]));
      const okB = new Set(valid.map((p) => p[1]));
      let changed = false;
      for (const v of axisVals) {
        if (!okA.has(v) && getFact(table, catA, a, axisKey, v) !== 'no') {
          const r = pushFact(table, catA, a, axisKey, v, 'no', { type: 'clue', clue: this }, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
        if (!okB.has(v) && getFact(table, catB, b, axisKey, v) !== 'no') {
          const r = pushFact(table, catB, b, axisKey, v, 'no', { type: 'clue', clue: this }, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
      }
      return { ok: true, changed };
    },
  };
}

// Three items, predicate on (iA, iB, iC). Same conventions as binaryPosClue.
export function ternaryPosClue(type, catA, a, catB, b, catC, c, axisKey, axisValues, predicate) {
  return {
    type,
    catA, a, catB, b, catC, c, axisKey, axisValues,
    test: (sol) => {
      const va = sol.find((r) => r[catA] === a)[axisKey];
      const vb = sol.find((r) => r[catB] === b)[axisKey];
      const vc = sol.find((r) => r[catC] === c)[axisKey];
      return predicate(axisValues.indexOf(va), axisValues.indexOf(vb), axisValues.indexOf(vc));
    },
    propagate(table, trace) {
      const axisVals = table.categories[axisKey];
      const possA = axisVals.filter((v) => getFact(table, catA, a, axisKey, v) !== 'no');
      const possB = axisVals.filter((v) => getFact(table, catB, b, axisKey, v) !== 'no');
      const possC = axisVals.filter((v) => getFact(table, catC, c, axisKey, v) !== 'no');
      const valid = [];
      for (const va of possA) for (const vb of possB) for (const vc of possC) {
        if (va === vb || va === vc || vb === vc) continue;
        if (predicate(axisVals.indexOf(va), axisVals.indexOf(vb), axisVals.indexOf(vc))) valid.push([va, vb, vc]);
      }
      if (valid.length === 0) return { ok: false };
      const okA = new Set(valid.map((v) => v[0]));
      const okB = new Set(valid.map((v) => v[1]));
      const okC = new Set(valid.map((v) => v[2]));
      let changed = false;
      for (const v of axisVals) {
        if (!okA.has(v) && getFact(table, catA, a, axisKey, v) !== 'no') {
          const r = pushFact(table, catA, a, axisKey, v, 'no', { type: 'clue', clue: this }, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
        if (!okB.has(v) && getFact(table, catB, b, axisKey, v) !== 'no') {
          const r = pushFact(table, catB, b, axisKey, v, 'no', { type: 'clue', clue: this }, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
        if (!okC.has(v) && getFact(table, catC, c, axisKey, v) !== 'no') {
          const r = pushFact(table, catC, c, axisKey, v, 'no', { type: 'clue', clue: this }, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
      }
      return { ok: true, changed };
    },
  };
}

// ----- Specific positional clue factories -----
// All predicates operate on INDICES into axisValues (0..N-1).
export const clueNextTo = (catA, a, catB, b, axisKey, axisValues) =>
  binaryPosClue('nextTo', catA, a, catB, b, axisKey, axisValues, (ia, ib) => Math.abs(ia - ib) === 1);

export const clueImmLeft = (catA, a, catB, b, axisKey, axisValues) =>
  binaryPosClue('immLeft', catA, a, catB, b, axisKey, axisValues, (ia, ib) => ia + 1 === ib);

export const clueLeftOf = (catA, a, catB, b, axisKey, axisValues) =>
  binaryPosClue('leftOf', catA, a, catB, b, axisKey, axisValues, (ia, ib) => ia < ib);

export const clueExactlyApart = (catA, a, catB, b, axisKey, axisValues, dist) =>
  binaryPosClue('exactlyApart', catA, a, catB, b, axisKey, axisValues, (ia, ib) => Math.abs(ia - ib) === dist, { dist });

export const clueBetween = (catA, a, catB, b, catC, c, axisKey, axisValues) =>
  ternaryPosClue('between', catA, a, catB, b, catC, c, axisKey, axisValues,
    (ia, ib, ic) => (ib < ia && ia < ic) || (ic < ia && ia < ib));

export const clueImmRight  = (catA, a, catB, b, axisKey, axisValues) =>
  binaryPosClue('immRight',  catA, a, catB, b, axisKey, axisValues, (ia, ib) => ia === ib + 1);
export const clueRightOf   = (catA, a, catB, b, axisKey, axisValues) =>
  binaryPosClue('rightOf',   catA, a, catB, b, axisKey, axisValues, (ia, ib) => ia > ib);
export const clueNotNextTo = (catA, a, catB, b, axisKey, axisValues) =>
  binaryPosClue('notNextTo', catA, a, catB, b, axisKey, axisValues, (ia, ib) => ia !== ib && Math.abs(ia - ib) !== 1);
export const clueWithin    = (catA, a, catB, b, axisKey, axisValues, dist) =>
  binaryPosClue('within',    catA, a, catB, b, axisKey, axisValues, (ia, ib) => ia !== ib && Math.abs(ia - ib) <= dist, { dist });

// AtLeastApart(k): |i - j| >= k. The inverse-direction companion to Within.
// `notNextTo` already covers k=2 (|i-j| >= 2 with i != j), so the generator
// skips k=2 here to avoid two clue types expressing the identical constraint.
//
// `phrasing` is a cosmetic field consumed only at render time. Two equivalent
// prose forms:
//   'apart'     → "X and Y sat at least K seats apart."
//   'notWithin' → "X and Y did NOT sit within (K-1) seats of each other."
// The constraint is the same; the renderer reads `phrasing` to pick which
// sentence to produce. Phrasing is decided at construction (one Math.random
// call per candidate) and stored on the clue so the same clue renders
// identically across multiple view-renderings.
export const clueAtLeastApart = (catA, a, catB, b, axisKey, axisValues, k, phrasing) =>
  binaryPosClue('atLeastApart', catA, a, catB, b, axisKey, axisValues,
    (ia, ib) => Math.abs(ia - ib) >= k, { k, phrasing });

// Unary positional clues — single item, constraint on its axis position alone.
// `satisfies(index, axisValues)` returns boolean.
export function unaryPosClue(type, catA, a, axisKey, axisValues, satisfies) {
  return {
    type, catA, a, axisKey, axisValues,
    test: (sol) => {
      const va = sol.find((r) => r[catA] === a)[axisKey];
      return satisfies(axisValues.indexOf(va), axisValues);
    },
    propagate(table, trace) {
      const axisVals = table.categories[axisKey];
      let changed = false;
      for (const v of axisVals) {
        const i = axisVals.indexOf(v);
        if (!satisfies(i, axisVals) && getFact(table, catA, a, axisKey, v) !== 'no') {
          const r = pushFact(table, catA, a, axisKey, v, 'no', { type: 'clue', clue: this }, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
      }
      return { ok: true, changed };
    },
  };
}

export const clueAtEnd = (catA, a, axisKey, axisValues) =>
  unaryPosClue('atEnd', catA, a, axisKey, axisValues, (i, vs) => i === 0 || i === vs.length - 1);
export const clueNotAtEnd = (catA, a, axisKey, axisValues) =>
  unaryPosClue('notAtEnd', catA, a, axisKey, axisValues, (i, vs) => i !== 0 && i !== vs.length - 1);
