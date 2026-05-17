// Operator-flavored clue factories. These are thin sugar over clueFormula,
// constructing the appropriate AST for each operator pattern.

import { fAtom, fNot, fAnd, fOr, fXor } from '../formula.js';
import { clueFormula } from './formula.js';
import { pushFact } from '../propagation.js';

export function clueOneOf(catA, a, catB, options) {
  // "a is paired with one of [options]" — OR of positive atoms.
  return clueFormula(
    fOr(...options.map(b => fAtom(catA, a, catB, b, 'yes'))),
    'oneOf',
  );
}
export function clueEither(p1, p2) {
  return clueFormula(fOr(p1, p2), 'either');
}
export function clueXor2(p1, p2) {
  return clueFormula(fXor(p1, p2), 'xor');
}
export function clueNeither(p1, p2) {
  // Neither of the two pairings holds. = NOR. Cleanest: each negated.
  return clueFormula(fAnd(fNot(p1), fNot(p2)), 'neither');
}
export function clueIfThen(p1, p2) {
  // p1 -> p2 == (!p1) OR p2
  return clueFormula(fOr(fNot(p1), p2), 'ifThen');
}
// Biconditional: p1 iff p2. Both atoms have the same truth value.
// Logically: NOT(XOR(p1, p2)) — same propagation as XOR, just inverted.
export function clueIff(p1, p2) {
  return clueFormula(fNot(fXor(p1, p2)), 'iff');
}
// IfThen with compound antecedent: if (p1 AND p2) then p3.
// Logically: NOT(p1 AND p2) OR p3 = (NOT p1) OR (NOT p2) OR p3.
export function clueIfThenAnd(p1, p2, p3) {
  return clueFormula(fOr(fNot(p1), fNot(p2), p3), 'ifThenAnd');
}

// AllDifferent: K subjects are pairwise distinct rows, expressed as a single
// sentence rather than K*(K-1)/2 separate NOT clues. Sugar over `fAnd` of
// NOT-atoms — one per pair.
//
// In the current bijective category scheme (every category has exactly N items
// in 1-to-1 correspondence with the anchor), the propagation is identical to
// the equivalent NOT-clue compound: each pair generates a single "these two
// don't co-occur" fact. The clue type doesn't add a new logical primitive —
// it adds prose variety (one compact sentence vs. several pairwise NOTs).
//
// `catKey` is cosmetic, used only by the renderer to pick which category-noun
// to mention ("at different seats" vs. "drank different drinks"). The
// constraint itself is row-distinctness regardless of the named axis.
//
// Constructor expects K ≥ 2; the generator emits K=3 only (K=2 is just
// clueNot with extra ceremony; K≥5 would push the formula's atom count
// past clueFormula's 8-atom enumeration cap — K=4 yields 6 atoms and would
// still be safe, but stays unused for now to keep prose compact).
export function clueAllDifferent(subjects, catKey) {
  const atoms = [];
  for (let i = 0; i < subjects.length; i++) {
    for (let j = i + 1; j < subjects.length; j++) {
      const s1 = subjects[i], s2 = subjects[j];
      atoms.push(fAtom(s1.cat, s1.item, s2.cat, s2.item, 'no'));
    }
  }
  const clue = clueFormula(fAnd(...atoms), 'allDifferent');
  clue.subjects = subjects;
  clue.catKey = catKey;
  return clue;
}

// UnalignedPair: "Of subjects s1 and s2 (same category), one is paired with
// value v1 and the other with value v2 (in catKey), but the matching is
// unsaid." This is a DOUBLE-OF — two subjects, two values, one of two
// possible matchings holds.
//
// The propagator pushes the BIPARTITE RESTRICTIONS that follow regardless
// of which matching is the true one:
//   1. s1 and s2 each have their catKey limited to {v1, v2}
//   2. in s1.cat, v1 and v2 each have their subject limited to {s1, s2}
//
// Together with pushFact's existing exclusivity + last-option cascade,
// these are sufficient: once any other clue pins one of the four cells
// (e.g., s1=v1), the cascade derives the rest of the pair automatically.
//
// We don't need an explicit XOR-formula clue layered on top — the underlying
// constraint `(s1=v1 ∧ s2=v2) XOR (s1=v2 ∧ s2=v1)` is fully captured by the
// bipartite cell limits plus the existing fact cascade.
//
// By spec, subjects come from a non-anchor category; catKey may be any
// other category (anchor or non-anchor). Caller is responsible for that.
export function clueUnalignedPair(s1, s2, catKey, v1, v2) {
  return {
    type: 'unalignedPair',
    subjectCat: s1.cat,
    subjects: [s1.item, s2.item],
    catKey,
    values: [v1, v2],
    test(solution) {
      const r1 = solution.find((r) => r[s1.cat] === s1.item);
      const r2 = solution.find((r) => r[s2.cat] === s2.item);
      const p1 = r1[catKey], p2 = r2[catKey];
      return (p1 === v1 && p2 === v2) || (p1 === v2 && p2 === v1);
    },
    propagate(table, trace) {
      const src = { type: 'clue', clue: this, deps: [] };
      let changed = false;
      // Restriction 1: s1 and s2 are limited to {v1, v2} in catKey.
      for (const v of table.categories[catKey]) {
        if (v === v1 || v === v2) continue;
        for (const s of this.subjects) {
          const r = pushFact(table, this.subjectCat, s, catKey, v, 'no', src, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
      }
      // Restriction 2: in subjectCat, v1 and v2 are limited to {s1, s2}.
      for (const x of table.categories[this.subjectCat]) {
        if (x === this.subjects[0] || x === this.subjects[1]) continue;
        for (const v of this.values) {
          const r = pushFact(table, this.subjectCat, x, catKey, v, 'no', src, trace);
          if (!r.ok) return { ok: false };
          if (r.derived.length > 0) changed = true;
        }
      }
      return { ok: true, changed };
    },
  };
}
