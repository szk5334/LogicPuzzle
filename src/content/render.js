// Shared clue renderer. Themes provide the small primitives — phrase, propLine,
// renderPositional — and this dispatcher handles every clue type, building prose
// out of those primitives. Adding a new clue type means adding a case here and
// (usually) a renderPositional branch in each theme.
//
// Phase 3 will add a RenderContext parameter so cross-puzzle atoms can be labeled
// with → ⁿ superscript notation. The single-puzzle signature stays compatible.

import { capit } from '../utils.js';

export function renderClueShared(c, theme) {
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
