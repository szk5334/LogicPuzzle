// Formula AST for compositional clues.
//
// Atoms are leaf propositions about (catA-item, catB-item) pairs with a
// polarity. fNot/fAnd/fOr/fXor compose them. Used by clueFormula and the
// operator-flavored constructors (either, xor, neither, ifThen).

import { canonKey } from './propagation.js';

// Atoms: { kind: 'atom', catA, a, catB, b, polarity: 'yes'|'no' }
//   polarity 'yes' means "catA[a] paired with catB[b]"
//   polarity 'no'  means "catA[a] NOT paired with catB[b]"
export const fAtom = (catA, a, catB, b, polarity = 'yes') =>
  ({ kind: 'atom', catA, a, catB, b, polarity });
export const fNot = (child) => ({ kind: 'not', child });
export const fAnd = (...children) => ({ kind: 'and', children });
export const fOr  = (...children) => ({ kind: 'or',  children });
export const fXor = (...children) => ({ kind: 'xor', children });

export function extractAtoms(f) {
  if (f.kind === 'atom') return [f];
  if (f.kind === 'not') return extractAtoms(f.child);
  return f.children.flatMap(extractAtoms);
}

// Deduplicate atoms by their underlying proposition (ignoring polarity).
export function uniqueProps(atoms) {
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
export function evalFormula(f, vmap) {
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
export function formulaHoldsForSolution(formula, solution) {
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
