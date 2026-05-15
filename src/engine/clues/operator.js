// Operator-flavored clue factories. These are thin sugar over clueFormula,
// constructing the appropriate AST for each operator pattern.

import { fAtom, fNot, fAnd, fOr, fXor } from '../formula.js';
import { clueFormula } from './formula.js';

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
