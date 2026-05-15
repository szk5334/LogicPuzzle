// Formula-based clue. Propagates by enumerating consistent yes/no assignments
// to the formula's atoms; any atom that takes a single value across all
// satisfying assignments is forced.

import { getFact, getFactEntry, pushFact } from '../propagation.js';
import { extractAtoms, uniqueProps, evalFormula, formulaHoldsForSolution } from '../formula.js';

// Generic formula-based clue. Propagates by enumerating consistent assignments
// to the formula's atoms and deriving any fact that holds in every assignment.
// Caps atoms at 8 (256 enumerations) for safety; usually 2-5.
export function clueFormula(formula, type, render) {
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

export function clueGenericFormula(formula) {
  return clueFormula(formula, 'mixed');
}
