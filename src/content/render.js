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
    // Compound operators (AND/OR/XOR) all wrap non-atom children in parens so
    // precedence is unambiguous. Without this, AND(OR(a,b), OR(c,d)) would
    // render as "a OR b AND c OR d" — totally ambiguous. With it: "(a OR b)
    // AND (c OR d)". The rule applies uniformly to AND, OR, and XOR.
    const wrap = (c) => {
      const inner = renderFormula(c);
      return c.kind === 'atom' ? inner : `(${inner})`;
    };
    if (f.kind === 'and') {
      const items = f.children.map(wrap);
      if (items.length <= 1) return items[0] || '';
      if (items.length === 2) return `${items[0]} AND ${items[1]}`;
      return `${items.slice(0, -1).join(', ')}, AND ${items[items.length - 1]}`;
    }
    if (f.kind === 'or') {
      const items = f.children.map(wrap);
      if (items.length <= 1) return items[0] || '';
      if (items.length === 2) return `${items[0]} OR ${items[1]}`;
      return `${items.slice(0, -1).join(', ')}, OR ${items[items.length - 1]}`;
    }
    if (f.kind === 'xor') {
      // Semicolon separates XOR alternatives so it doesn't collide with the
      // commas used by nested AND/OR.
      return `exactly one of: ${f.children.map(wrap).join('; ')}`;
    }
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
      return `Either ${renderAtom(p1)} or ${renderAtom(p2)} (possibly both).`;
    }
    case 'xor': {
      const [p1, p2] = c.formula.children;
      return `Exactly one is true — either ${renderAtom(p1)} or ${renderAtom(p2)}, but not both.`;
    }
    case 'neither': {
      const [n1, n2] = c.formula.children;
      return `Neither ${renderAtom(n1.child)} nor ${renderAtom(n2.child)}.`;
    }
    case 'ifThen': {
      const [notP, q] = c.formula.children;
      return `If ${renderAtom(notP.child)}, then ${renderAtom(q)}.`;
    }
    case 'iff': {
      // formula structure: fNot(fXor(p1, p2)) — pull p1 and p2 from inside the XOR.
      const xor = c.formula.child;
      const [p1, p2] = xor.children;
      return `${capit(renderAtom(p1))} if and only if ${renderAtom(p2)}.`;
    }
    case 'ifThenAnd': {
      // formula structure: fOr(fNot(p1), fNot(p2), p3).
      const [notP1, notP2, p3] = c.formula.children;
      return `If ${renderAtom(notP1.child)} and ${renderAtom(notP2.child)}, then ${renderAtom(p3)}.`;
    }
    case 'mixed':
    case 'formula':
      return capit(renderFormula(c.formula)) + '.';
    default: return '?';
  }
}
