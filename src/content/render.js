// Shared clue renderer. Themes provide the small primitives — phrase, propLine,
// renderPositional — and this dispatcher handles every clue type, building prose
// out of those primitives. Adding a new clue type means adding a case here and
// (usually) a renderPositional branch in each theme.
//
// Positional clues carry `axisKey`. Each theme's renderPositional inspects
// axisKey internally and returns either a flavored sentence (anchor-axis or
// any non-anchor axis the theme has prose for) or null. When null comes back,
// we fall back to the theme-agnostic skeleton in renderPositionalNonAnchor —
// it appends "in the {axisKey} ordering" to a generic frame, which is fine for
// axes a theme hasn't bothered to flavor (e.g., classic's letter/numeral/tone
// axes) but reads awkwardly enough that themes are nudged to flavor their
// frequently-used axes.
//
// Phase 3 RenderContext (scaffolding; no current callers pass it):
//   renderClueShared(c, theme, ctx?) accepts an optional ctx = { puzzleId }.
//   When an atom inside a clue carries a `puzzleId` that differs from
//   `ctx.puzzleId`, the rendered atom text gets a cross-puzzle marker
//   appended: ` (→<puzzleId>)`. The marker is provisional — we may swap in
//   a JSX <sup> styling once a case-aware UI exists.
//
//   Themes' renderClue(c, ctx?) forwards ctx through unchanged. UI call sites
//   that don't yet know about cases pass no ctx; their atoms also lack
//   puzzleId, so the output is byte-identical to before this scaffolding.
//   Positional clues, allDifferent, and unalignedPair are local-only by
//   Phase 3 design and don't consult ctx.

import { capit } from '../utils.js';

// Apply the cross-puzzle annotation to atom text when the atom belongs to a
// puzzle other than the current rendering context. Provisional notation —
// final styling lives wherever this string is finally rendered.
function annotateCross(text, atomOrClue, ctx) {
  const pid = atomOrClue && atomOrClue.puzzleId;
  if (pid == null) return text;
  if (ctx && ctx.puzzleId === pid) return text; // same puzzle, no marker
  return `${text} (→${pid})`;
}

// Generic prose skeleton for positional clues whose theme returned null —
// either the theme doesn't know about this axis, or it doesn't handle this
// clue type. Names the axis explicitly so the reader knows which ordering is
// being referenced.
function renderPositionalNonAnchor(c, theme) {
  const phrase = (cat, x) => theme.phrase(cat, x);
  const A = capit(phrase(c.catA, c.a));
  const B = c.catB ? phrase(c.catB, c.b) : null;
  const C = c.catC ? phrase(c.catC, c.c) : null;
  const ax = c.axisKey;
  switch (c.type) {
    case 'nextTo':       return `${A} and ${B} are adjacent in the ${ax} ordering.`;
    case 'notNextTo':    return `${A} and ${B} are NOT adjacent in the ${ax} ordering.`;
    case 'immLeft':      return `${A} comes immediately before ${B} in the ${ax} ordering.`;
    case 'immRight':     return `${A} comes immediately after ${B} in the ${ax} ordering.`;
    case 'leftOf':       return `${A} comes somewhere before ${B} in the ${ax} ordering.`;
    case 'rightOf':      return `${A} comes somewhere after ${B} in the ${ax} ordering.`;
    case 'exactlyApart': return `${A} and ${B} are exactly ${c.dist} apart in the ${ax} ordering.`;
    case 'within':       return `${A} and ${B} are within ${c.dist} of each other in the ${ax} ordering.`;
    case 'atLeastApart': {
      // Two equivalent phrasings of |i - j| >= k, chosen at construction.
      // 'notWithin' phrases it as "not within k-1," reading it back through
      // the within frame; the constraint is identical to 'apart' framing.
      if (c.phrasing === 'notWithin') {
        return `${A} and ${B} are NOT within ${c.k - 1} of each other in the ${ax} ordering.`;
      }
      return `${A} and ${B} are at least ${c.k} apart in the ${ax} ordering.`;
    }
    case 'between':      return `${A} is between ${B} and ${C} in the ${ax} ordering.`;
    case 'atEnd':        return `${A} is at one end of the ${ax} ordering.`;
    case 'notAtEnd':     return `${A} is not at either end of the ${ax} ordering.`;
    default: return '?';
  }
}

export function renderClueShared(c, theme, ctx) {
  ctx = ctx || { puzzleId: null };
  const phrase = (cat, x) => theme.phrase(cat, x);
  const propLine = (catA, a, catB, b, pol) => theme.propLine(catA, a, catB, b, pol);
  const renderAtom = (atom) => annotateCross(
    propLine(atom.catA, atom.a, atom.catB, atom.b, atom.polarity),
    atom,
    ctx,
  );
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
    case 'is':      return annotateCross(capit(propLine(c.catA, c.a, c.catB, c.b, 'yes')), c, ctx) + '.';
    case 'not':     return annotateCross(capit(propLine(c.catA, c.a, c.catB, c.b, 'no')),  c, ctx) + '.';
    case 'nextTo':
    case 'notNextTo':
    case 'immLeft':
    case 'immRight':
    case 'leftOf':
    case 'rightOf':
    case 'exactlyApart':
    case 'within':
    case 'atLeastApart':
    case 'between':
    case 'atEnd':
    case 'notAtEnd': {
      // Theme owns axis routing. If it returns null (axis it doesn't flavor),
      // fall back to the theme-agnostic skeleton.
      const themed = theme.renderPositional(c);
      if (themed != null) return themed;
      return renderPositionalNonAnchor(c, theme);
    }
    case 'oneOf': {
      const atoms = c.formula.children;
      const head = atoms[0];
      const opts = atoms.map((x) => phrase(x.catB, x.b));
      const joined = opts.length === 2
        ? `${opts[0]} or ${opts[1]}`
        : `${opts.slice(0, -1).join(', ')}, or ${opts[opts.length - 1]}`;
      const subj = annotateCross(capit(phrase(head.catA, head.a)), head, ctx);
      return `${subj} is one of: ${joined}.`;
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
    case 'allDifferent': {
      // Per-theme prose. Theme provides `allDifferentVerbs` — a {catKey: verb-phrase}
      // map — and the joined subject list slots in front. Falls back to a
      // generic "differ in their X" sentence if a theme hasn't supplied a
      // verb for this catKey.
      const subjs = c.subjects.map((s, i) => i === 0 ? capit(phrase(s.cat, s.item)) : phrase(s.cat, s.item));
      const list = subjs.length === 2
        ? `${subjs[0]} and ${subjs[1]}`
        : `${subjs.slice(0, -1).join(', ')}, and ${subjs[subjs.length - 1]}`;
      const verb = theme.allDifferentVerbs?.[c.catKey] || `differ in their ${c.catKey}`;
      return `${list} ${verb}.`;
    }
    case 'unalignedPair': {
      // Themes can fully override via renderUnalignedPair(c) → string | null.
      // Returning null falls through to the generic skeleton below.
      if (theme.renderUnalignedPair) {
        const themed = theme.renderUnalignedPair(c);
        if (themed != null) return themed;
      }
      const [s1, s2] = c.subjects;
      const [v1, v2] = c.values;
      const sPhrase = (item) => phrase(c.subjectCat, item);
      // Theme may supply unalignedPairVerbs to flavor specific catKeys —
      // a {catKey: (value) => string} map, where the function returns the
      // sentence-fragment for one half (e.g., 'was hiding embezzlement').
      // For catKeys without an entry we fall back to "is paired with X",
      // using the theme's standard phrase() for the value (works well for
      // anchor and other compact-noun categories).
      const verb = theme.unalignedPairVerbs?.[c.catKey];
      if (verb) {
        return `Of ${capit(sPhrase(s1))} and ${sPhrase(s2)}, one ${verb(v1)} and the other ${verb(v2)}.`;
      }
      return `Of ${capit(sPhrase(s1))} and ${sPhrase(s2)}, one is paired with ${phrase(c.catKey, v1)} and the other with ${phrase(c.catKey, v2)}.`;
    }
    default: return '?';
  }
}
