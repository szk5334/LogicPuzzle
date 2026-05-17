// Puzzle generation.
//
//   generateSolution     — random consistent assignment over the theme's
//                          categories; the anchor category stays in its
//                          natural order, others are shuffled bijections.
//                          Returns `categoryMeta` declaring which categories
//                          are ordered axes (anchor + theme.orderedKeys).
//   generateAllTrueClues — emit every supported clue type that holds for
//                          the solution (heavy enumeration; the filter
//                          step in generatePuzzle culls to a minimal set).
//                          Iterates positional clue generation over each
//                          ordered axis declared in `categoryMeta`.
//   generatePuzzle       — sample-and-filter loop. Build the candidate
//                          clue pool, weight by difficulty, attempt to
//                          reach a uniquely-solvable subset, return the
//                          minimal set + trace + categoryMeta.
//
// Phase 3.B will add graph-level generation that plans a joint truth table
// across all puzzles before emitting per-puzzle clues. The per-puzzle
// pieces here remain the building blocks.

import { rand, shuffle, canonKey, solveWithClues } from './propagation.js';
import { fAtom, fAnd, fOr, fXor, formulaHoldsForSolution } from './formula.js';
import { clueIs, clueNot } from './clues/atomic.js';
import {
  clueNextTo, clueImmLeft, clueImmRight, clueLeftOf, clueRightOf,
  clueExactlyApart, clueBetween, clueNotNextTo, clueWithin,
  clueAtEnd, clueNotAtEnd,
  clueAtLeastApart,
} from './clues/positional.js';
import { clueOneOf, clueEither, clueXor2, clueIfThen, clueIff, clueIfThenAnd, clueAllDifferent, clueUnalignedPair } from './clues/operator.js';
import { clueGenericFormula } from './clues/formula.js';

// ----- Solution generation -----
// A solution is an array of N row-objects, each mapping category -> item.
// The anchor category (e.g. seat position) is in its natural order; the
// others are random bijections onto it.
//
// `categoryMeta` declares per-category metadata. Right now there's exactly
// one field: `ordered: bool`. The anchor is always ordered; non-anchor
// categories opt in via `theme.orderedKeys`. Helpers downstream consult
// categoryMeta to decide which categories can be the axis for positional
// clues.
export function generateSolution(theme, numCategories, numItems) {
  const categories = theme.categoriesFor(numCategories, numItems);
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
  const orderedSet = new Set([anchorKey, ...(theme.orderedKeys || [])]);
  const categoryMeta = {};
  for (const key of Object.keys(categories)) {
    categoryMeta[key] = { ordered: orderedSet.has(key) };
  }
  return { categories, categoryMeta, solution, anchorKey, subjectKey: theme.subjectKey || null };
}

// ----- Generate every true clue of each supported type for the solution -----
// Accepts `categoryMeta` to learn which categories are ordered axes. If
// missing (legacy callers), falls back to anchor-only ordering.
export function generateAllTrueClues({ categories, categoryMeta, solution, anchorKey, subjectKey }) {
  const out = [];
  const cats = Object.keys(categories);

  // ----- Atomic clues: every cell pair gets either 'is' or 'not'. -----
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

  // ----- Positional clues: one round per ordered axis. -----
  // Subjects come from every category that isn't the axis itself. For the
  // anchor axis, that reproduces the pre-2.5.B behavior. For non-anchor
  // ordered axes (e.g., `age`), the anchor can now be a subject too — e.g.,
  // "seat 3 is older than seat 5" means whoever's at seat 3 has a higher
  // age-axis index than whoever's at seat 5.
  const orderedAxes = categoryMeta
    ? cats.filter((k) => categoryMeta[k]?.ordered)
    : [anchorKey];
  for (const axisKey of orderedAxes) {
    const axisVals = categories[axisKey];
    const N = axisVals.length;
    // O(1) value→index lookup; reused across all subject pairs on this axis.
    const indexMap = new Map(axisVals.map((v, i) => [v, i]));
    const posOnAxis = (cat, item) => {
      const row = solution.find((r) => r[cat] === item);
      return indexMap.get(row[axisKey]);
    };
    const subjectCats = cats.filter((c) => c !== axisKey);

    // Binary positional clues (NextTo / NotNextTo / ImmLeft / ImmRight /
    // LeftOf / RightOf / ExactlyApart / Within) — iterate over all pairs
    // of subjects, including same-category pairs (with a < b dedup).
    for (let i = 0; i < subjectCats.length; i++) {
      for (let j = i; j < subjectCats.length; j++) {
        const catA = subjectCats[i], catB = subjectCats[j];
        for (const a of categories[catA]) for (const b of categories[catB]) {
          if (catA === catB && a >= b) continue;
          const pa = posOnAxis(catA, a), pb = posOnAxis(catB, b);
          // NextTo / NotNextTo
          if (Math.abs(pa - pb) === 1) out.push(clueNextTo(catA, a, catB, b, axisKey, axisVals));
          if (Math.abs(pa - pb) > 1) out.push(clueNotNextTo(catA, a, catB, b, axisKey, axisVals));
          // ImmLeft / ImmRight (directed — generate both orderings)
          if (pa + 1 === pb) out.push(clueImmLeft(catA, a, catB, b, axisKey, axisVals));
          if (pb + 1 === pa) out.push(clueImmLeft(catB, b, catA, a, axisKey, axisVals));
          if (pa === pb + 1) out.push(clueImmRight(catA, a, catB, b, axisKey, axisVals));
          if (pb === pa + 1) out.push(clueImmRight(catB, b, catA, a, axisKey, axisVals));
          // LeftOf / RightOf (loose, directed)
          if (pa < pb) {
            out.push(clueLeftOf(catA, a, catB, b, axisKey, axisVals));
            out.push(clueRightOf(catB, b, catA, a, axisKey, axisVals));
          }
          if (pb < pa) {
            out.push(clueLeftOf(catB, b, catA, a, axisKey, axisVals));
            out.push(clueRightOf(catA, a, catB, b, axisKey, axisVals));
          }
          // ExactlyApart with N >= 2 (N=1 == NextTo, already covered).
          const dist = Math.abs(pa - pb);
          if (dist >= 2) out.push(clueExactlyApart(catA, a, catB, b, axisKey, axisVals, dist));
          // Within(d) for d in [2, 3] when actual distance qualifies (loose bound).
          // Skip dist=0 (same position) since the Within predicate excludes it.
          for (const d of [2, 3]) {
            if (d < N && dist > 0 && dist <= d) {
              out.push(clueWithin(catA, a, catB, b, axisKey, axisVals, d));
            }
          }
          // AtLeastApart(k) for k in [3, 4] when actual distance qualifies.
          // Mirror of within's [2, 3] band, offset by one — we skip k=2
          // because notNextTo already covers the |i-j| >= 2 constraint.
          // Phrasing is randomly assigned per candidate so the chosen clues
          // see a roughly even mix of "at least K apart" and "not within K-1
          // of each other" sentences; the constraint is identical either way.
          for (const k of [3, 4]) {
            if (k < N && dist >= k) {
              const phrasing = Math.random() < 0.5 ? 'apart' : 'notWithin';
              out.push(clueAtLeastApart(catA, a, catB, b, axisKey, axisVals, k, phrasing));
            }
          }
        }
      }
    }

    // Unary positional clues: AtEnd / NotAtEnd for every subject on this axis.
    for (const cat of subjectCats) {
      for (const a of categories[cat]) {
        const pa = posOnAxis(cat, a);
        if (pa === 0 || pa === N - 1) out.push(clueAtEnd(cat, a, axisKey, axisVals));
        else out.push(clueNotAtEnd(cat, a, axisKey, axisVals));
      }
    }

    // Between: triples of subjects, middle one positionally between the others.
    const betweenItems = [];
    for (const cat of subjectCats) for (const it of categories[cat]) {
      betweenItems.push({ cat, it, pos: posOnAxis(cat, it) });
    }
    for (let i = 0; i < betweenItems.length; i++) {
      for (let j = i + 1; j < betweenItems.length; j++) {
        for (let k = j + 1; k < betweenItems.length; k++) {
          const [x, y, z] = [betweenItems[i], betweenItems[j], betweenItems[k]];
          if ((x.cat === y.cat && x.it === y.it) || (x.cat === z.cat && x.it === z.it) || (y.cat === z.cat && y.it === z.it)) continue;
          const sorted = [x, y, z].sort((u, v) => u.pos - v.pos);
          const [low, mid, high] = sorted;
          // Strict betweenness: skip triples with any positional tie.
          if (low.pos === mid.pos || mid.pos === high.pos) continue;
          out.push(clueBetween(mid.cat, mid.it, low.cat, low.it, high.cat, high.it, axisKey, axisVals));
        }
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
  // Pairwise-distinct check for compound formulas. Without this the picks can
  // alias and produce degenerate clues like XOR(a, a, c) or AND(a, NOT(a), c).
  const allDistinct = (...atoms) => {
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        if (sameAtom(atoms[i], atoms[j])) return false;
      }
    }
    return true;
  };

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

  // Neither (NOR) is intentionally NOT generated. "Neither X nor Y is Z" decomposes
  // losslessly into two separate "not" clues — same propagation, no atom coupling —
  // and the minimizer would otherwise prefer one compound clue over two atoms.
  // clueNeither remains exported from clues/operator.js for hand-authored content.

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

  // Biconditional: p1 iff p2. Both atoms share a truth value.
  // Randomize between "both true" and "both false" picks for variety.
  for (let k = 0; k < 20; k++) {
    let p1, p2;
    if (rand(2)) {
      p1 = pickTrueAtom();
      p2 = pickTrueAtom();
    } else {
      p1 = pickFalseAtom();
      p2 = pickFalseAtom();
    }
    if (!p1 || !p2 || sameAtom(p1, p2)) continue;
    out.push(clueIff(p1, p2));
  }

  // IfThen with compound antecedent: if (p1 AND p2) then p3.
  // Randomize between "antecedent satisfied + consequent true" and
  // "antecedent vacuously false" — same strategy as clueIfThen.
  for (let k = 0; k < 20; k++) {
    let p1, p2, p3;
    if (rand(2)) {
      // Antecedent true (both p1 and p2 true); consequent must be true too.
      p1 = pickTrueAtom();
      p2 = pickTrueAtom();
      p3 = pickTrueAtom();
    } else {
      // Antecedent vacuously false: at least one of p1, p2 is false.
      p1 = pickFalseAtom();
      p2 = pickFalseAtom() || pickTrueAtom();
      p3 = pickFalseAtom() || pickTrueAtom();
    }
    if (!p1 || !p2 || !p3 || !allDistinct(p1, p2, p3)) continue;
    out.push(clueIfThenAnd(p1, p2, p3));
  }

  // Mixed compositional clues — depth-2 formulas with up to 5 operands.
  // Generate a handful of each shape and keep ones that hold for the solution.
  for (let k = 0; k < 18; k++) {
    let formula;
    const shape = rand(7);
    if (shape === 0) {
      // And(Or(a,b), Or(c,d)) — 4 operands, "at-least-one in each group"
      const a = pickTrueAtom(), b = pickTrueAtom();
      const c = pickTrueAtom(), d = pickFalseAtom();
      if (!a || !b || !c || !d || !allDistinct(a, b, c, d)) continue;
      formula = fAnd(fOr(a, b), fOr(c, d));
    } else if (shape === 1) {
      // Or(And(a,b), c) — 3 operands
      const a = pickTrueAtom(), b = pickTrueAtom();
      const c = pickFalseAtom() || pickTrueAtom();
      if (!a || !b || !c || !allDistinct(a, b, c)) continue;
      formula = fOr(fAnd(a, b), c);
    } else if (shape === 2) {
      // Xor(Or(a,b), c) — 3 operands, non-trivial atom coupling
      const a = pickFalseAtom(), b = pickFalseAtom();
      const c = pickTrueAtom();
      if (!a || !b || !c || !allDistinct(a, b, c)) continue;
      formula = fXor(fOr(a, b), c);
    } else if (shape === 3) {
      // Xor(a, b, c) — flat 3-atom XOR (exactly one of three true)
      const a = pickTrueAtom();
      const b = pickFalseAtom();
      const c = pickFalseAtom();
      if (!a || !b || !c || !allDistinct(a, b, c)) continue;
      formula = fXor(a, b, c);
    } else if (shape === 4) {
      // Or(a, b, c) — 3 operands flat OR
      const a = pickTrueAtom();
      const b = pickFalseAtom() || pickTrueAtom();
      const c = pickFalseAtom() || pickTrueAtom();
      if (!a || !b || !c || !allDistinct(a, b, c)) continue;
      formula = fOr(a, b, c);
    } else if (shape === 5) {
      // Or(And(a,b), And(c,d)) — 4 operands, "either pair is true"
      // First pair both-true (the satisfying path); second pair has at least
      // one false so the formula isn't trivially satisfied by both branches.
      const a = pickTrueAtom(), b = pickTrueAtom();
      const c = pickFalseAtom();
      const d = pickFalseAtom() || pickTrueAtom();
      if (!a || !b || !c || !d || !allDistinct(a, b, c, d)) continue;
      formula = fOr(fAnd(a, b), fAnd(c, d));
    } else {
      // Xor(And(a,b), c) — 3 operands, "exactly one: this pair, or this single"
      // AND-pair has at least one false (so the pair is false); single is true.
      // Asymmetric counterpart to Shape 2 (Xor(Or, atom)).
      const a = pickFalseAtom();
      const b = pickFalseAtom() || pickTrueAtom();
      const c = pickTrueAtom();
      if (!a || !b || !c || !allDistinct(a, b, c)) continue;
      formula = fXor(fAnd(a, b), c);
    }
    if (formulaHoldsForSolution(formula, solution)) {
      out.push(clueGenericFormula(formula));
    }
  }

  // ----- AllDifferent clues (K=3) -----
  // Pick triples of subjects from three DIFFERENT categories, verify their
  // solution rows are all distinct, then emit with a `catKey` chosen randomly
  // from the categories none of the subjects belong to. Same-category subjects
  // would make the clue trivially true (category exclusivity); catKey in the
  // subjects' cats would make the prose awkward ("gin is at a different drink
  // than..."). Skipped entirely when numCategories < 4 since there'd be no
  // remaining category to name as the axis.
  if (cats.length >= 4) {
    for (let i = 0; i < cats.length; i++) {
      for (let j = i + 1; j < cats.length; j++) {
        for (let k = j + 1; k < cats.length; k++) {
          const cA = cats[i], cB = cats[j], cC = cats[k];
          const remaining = cats.filter((c) => c !== cA && c !== cB && c !== cC);
          if (remaining.length === 0) continue;
          for (const a of categories[cA]) {
            for (const b of categories[cB]) {
              for (const c of categories[cC]) {
                const rA = solution.find((r) => r[cA] === a);
                const rB = solution.find((r) => r[cB] === b);
                const rC = solution.find((r) => r[cC] === c);
                if (rA === rB || rA === rC || rB === rC) continue;
                const catKey = remaining[rand(remaining.length)];
                out.push(clueAllDifferent(
                  [{ cat: cA, item: a }, { cat: cB, item: b }, { cat: cC, item: c }],
                  catKey,
                ));
              }
            }
          }
        }
      }
    }
  }

  // ----- UnalignedPair clues -----
  // Pick two subjects (s1, s2) from the theme's subjectKey category, and a
  // different category catKey whose values for those subjects become (v1,
  // v2). The clue says "one of {s1, s2} is paired with v1 and the other
  // with v2" — without saying which way.
  //
  // We restrict subjects to subjectKey (e.g., guest, suspect, letter) rather
  // than any non-anchor category. The constraint is symmetric — "of Alice
  // and Bob, one drinks tea" is the same logical fact as "of tea and
  // coffee, one is drunk by Alice" — so emitting one canonical direction is
  // sufficient. subjectKey gives the most natural prose: people-as-subjects
  // (or letters in the classic theme) read as actors, with values as their
  // attributes.
  const sCat = subjectKey || cats.find((c) => c !== anchorKey);
  if (sCat && sCat !== anchorKey) {
    const sItems = categories[sCat];
    for (let i = 0; i < sItems.length; i++) {
      for (let j = i + 1; j < sItems.length; j++) {
        const s1 = sItems[i], s2 = sItems[j];
        const r1 = solution.find((r) => r[sCat] === s1);
        const r2 = solution.find((r) => r[sCat] === s2);
        for (const vCat of cats) {
          if (vCat === sCat) continue;
          const v1 = r1[vCat], v2 = r2[vCat];
          out.push(clueUnalignedPair(
            { cat: sCat, item: s1 }, { cat: sCat, item: s2 },
            vCat, v1, v2,
          ));
        }
      }
    }
  }

  // Defensive safety net: drop any clue that doesn't actually hold for the solution.
  // Protects against generator bugs where the emission condition doesn't match the
  // predicate (e.g. same-seat pairs slipping through for Within/Between).
  return out.filter((c) => c.test(solution));
}

// ----- Generate a puzzle -----
export function generatePuzzle(theme, numCategories, numItems, difficulty) {
  const { categories, categoryMeta, solution, anchorKey, subjectKey } = generateSolution(theme, numCategories, numItems);
  const allClues = generateAllTrueClues({ categories, categoryMeta, solution, anchorKey, subjectKey });

  // Bias the clue ordering by difficulty. Each type gets a base weight per band.
  // Hard is tuned to spread across clue families — atomics stay low (2) so they
  // don't crowd out richer types, but they're competitive enough to surface in
  // some puzzles. Operator-binary types (either/xor/ifThen/iff/ifThenAnd) sit
  // at apex (5) alongside the mixed compound formulas. Heaviest positional
  // types (between/exactlyApart/...) sit at 4 so a single positional family
  // doesn't dominate the survivors. The 'neither' entry is gone — clueNeither
  // is no longer generated (see comment in the generator loop).
  const WEIGHTS = {
    easy:   { is: 6, not: 1, nextTo: 2, notNextTo: 1, immLeft: 2, immRight: 2, leftOf: 1, rightOf: 1, exactlyApart: 1, within: 1, atLeastApart: 1, between: 1, atEnd: 1, notAtEnd: 1, oneOf: 2, either: 1, xor: 1, ifThen: 1, iff: 1, ifThenAnd: 1, allDifferent: 1, unalignedPair: 1, mixed: 1 },
    medium: { is: 3, not: 3, nextTo: 3, notNextTo: 3, immLeft: 3, immRight: 3, leftOf: 3, rightOf: 3, exactlyApart: 3, within: 3, atLeastApart: 3, between: 3, atEnd: 3, notAtEnd: 3, oneOf: 3, either: 3, xor: 3, ifThen: 3, iff: 3, ifThenAnd: 3, allDifferent: 3, unalignedPair: 3, mixed: 3 },
    hard:   { is: 2, not: 2, nextTo: 4, notNextTo: 4, immLeft: 4, immRight: 4, leftOf: 4, rightOf: 4, exactlyApart: 4, within: 4, atLeastApart: 4, between: 4, atEnd: 3, notAtEnd: 3, oneOf: 4, either: 5, xor: 5, ifThen: 5, iff: 5, ifThenAnd: 5, allDifferent: 4, unalignedPair: 4, mixed: 5 },
  };
  const wTable = WEIGHTS[difficulty] || WEIGHTS.medium;

  // Type-balanced clue selection.
  //
  // Each type emits a wildly different number of candidates: a 7×7 puzzle
  // produces ~15k `between` candidates and ~7k `allDifferent` (their
  // generators iterate over all pairs/triples) while operator types like
  // xor/iff/ifThen emit only ~20 (their generators retry a fixed number of
  // attempts). The old "sort all candidates by weight × random and pick the
  // top until solved" scheme let high-count types monopolize the top of the
  // sort just by sheer presence — at uniform weights (medium difficulty in
  // particular), `between` would crowd out almost everything else.
  //
  // Instead: group candidates by type, shuffle within each group, then on
  // each iteration pick a TYPE weighted by its configured weight and pull
  // that type's next candidate. This makes the weight system actually mean
  // what it looks like: weight[T] / sum(weights) is the probability of T
  // contributing the next clue, independent of how many candidates T has.
  //
  // The minimizer downstream still drops over-represented types first, so
  // the final clue mix is doubly type-balanced.
  const byType = {};
  for (const c of allClues) (byType[c.type] ||= []).push(c);
  for (const type of Object.keys(byType)) shuffle(byType[type]);

  const cursors = new Map();
  for (const type of Object.keys(byType)) cursors.set(type, 0);

  const chosen = [];
  while (chosen.length <= allClues.length) {
    // Types that still have unpulled candidates
    const active = [];
    for (const type of Object.keys(byType)) {
      if (cursors.get(type) < byType[type].length) active.push(type);
    }
    if (active.length === 0) break;
    // Weighted random pick over active types
    const weights = active.map((t) => wTable[t] ?? 2);
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    let pickedType = active[active.length - 1];
    for (let i = 0; i < active.length; i++) {
      r -= weights[i];
      if (r < 0) { pickedType = active[i]; break; }
    }
    // Pull the next candidate from that type
    const idx = cursors.get(pickedType);
    cursors.set(pickedType, idx + 1);
    const newClue = byType[pickedType][idx];
    chosen.push(newClue);
    const res = solveWithClues(categories, chosen, null);
    if (res.status === 'solved') break;
  }

  // Minimize: drop any clue whose absence still leaves it solvable.
  // Drop-order is type-aware: over-represented types are tried for dropping
  // FIRST. If a clue from a heavy type can be removed while keeping the puzzle
  // solvable, it goes — biasing survivors toward type diversity. Within a
  // single type-count bucket, order is randomized so the choice isn't
  // deterministic. (We compute counts once per pass; they go stale as clues
  // drop, but the next reduce() call sees fresh counts so it self-corrects.)
  const reduce = (clueList) => {
    let cur = [...clueList];
    const counts = {};
    for (const c of cur) counts[c.type] = (counts[c.type] || 0) + 1;
    const toTry = [...cur].sort((a, b) => {
      const ca = counts[a.type], cb = counts[b.type];
      if (ca !== cb) return cb - ca;
      return Math.random() - 0.5;
    });
    for (const target of toTry) {
      if (!cur.includes(target)) continue;
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
    categoryMeta,
    solution,
    anchorKey,
    subjectKey,
    clues: minimal,
    trace,
    status: finalSolve.status,
    passes: finalSolve.passes,
  };
}
