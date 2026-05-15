// Atomic clue types: direct "is" / "is not" pair assertions.

import { getFact, pushFact } from '../propagation.js';

export function clueIs(catA, a, catB, b) {
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

export function clueNot(catA, a, catB, b) {
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
