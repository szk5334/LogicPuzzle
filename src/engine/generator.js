// Puzzle generation.
//
//   generateSolution     — random consistent assignment over the theme's
//                          categories; the anchor category stays in its
//                          natural order, others are shuffled bijections.
//   generateAllTrueClues — emit every supported clue type that holds for
//                          the solution (heavy enumeration; the filter
//                          step in generatePuzzle culls to a minimal set).
//   generatePuzzle       — sample-and-filter loop. Build the candidate
//                          clue pool, weight by difficulty, attempt to
//                          reach a uniquely-solvable subset, return the
//                          minimal set + trace.
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
} from './clues/positional.js';
import { clueOneOf, clueEither, clueXor2, clueNeither, clueIfThen } from './clues/operator.js';
import { clueGenericFormula } from './clues/formula.js';

// ----- Solution generation -----
// A solution is an array of N row-objects, each mapping category -> item.
// The anchor category (e.g. seat position) is in its natural order; the
// others are random bijections onto it.
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
  return { categories, solution, anchorKey, subjectKey: theme.subjectKey || null };
}

// ----- Generate every true clue of each supported type for the solution -----
export function generateAllTrueClues({ categories, solution, anchorKey }) {
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

// ----- Generate a puzzle -----
export function generatePuzzle(theme, numCategories, numItems, difficulty) {
  const { categories, solution, anchorKey, subjectKey } = generateSolution(theme, numCategories, numItems);
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
    subjectKey,
    clues: minimal,
    trace,
    status: finalSolve.status,
    passes: finalSolve.passes,
  };
}
