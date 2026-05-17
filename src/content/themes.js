// Themes wire content pools to engine categories, expose theme-local naming
// (phrase, propLine, factPhrasing), and render clue prose via renderClueShared.
//
// Three themes ship: classic (abstract symbols), soapOpera (party-drama),
// noir (whodunit). Each declares a priority-ordered category list, a subjectKey
// for the deduction panel, and per-positional-type prose.
//
// Per-theme `orderedKeys` lists non-anchor categories whose items have an
// inherent natural ordering. The puzzle generator combines this with the
// anchor (always ordered) to produce categoryMeta and to iterate positional
// clue generation over every ordered axis.
//
// Each theme's renderPositional(c) is the SINGLE source of positional prose
// for that theme — it branches on c.axisKey to pick anchor-flavored vs.
// other-axis-flavored language (e.g., "sat next to" for the seat axis vs.
// "just younger than" for the age axis). For axes a theme doesn't know about,
// it returns null and render.js falls back to the theme-agnostic skeleton.
//
// Phase 5 will lift theme content (pools, priority orders, factPhrasing strings)
// into JSON. Phase 2.5 keeps them as JS exports.

import { capit } from '../utils.js';
import { shuffle } from '../engine/propagation.js';
import {
  CHARACTER_POOL, DRINK_POOL, SECRET_POOL, RUMOR_POOL,
  OBJECT_POOL, MOTIVE_POOL, WEAPON_POOL, ALIBI_POOL,
  GIFT_POOL, ATTIRE_POOL, AGE_POOL,
  LETTERS, NUMERALS, SHAPES, COLORS, TONES, SYMBOLS, ACCENTS,
} from './pools.js';
import { renderClueShared } from './render.js';

// Helpers shared by soap and noir for the `age` category. Sample N distinct
// ages then sort ascending so the array's index order matches numeric order.
const sampleAges = (numItems) =>
  shuffle(AGE_POOL).slice(0, numItems).sort((a, b) => a - b);

export const themes = {
  classic: {
    name: 'classic',
    label: 'Classic — letters & numerals',
    anchorKey: 'position',
    subjectKey: 'letter',
    // Letter, numeral, tone, and accent are all order-bearing string sequences
    // (alphabetical / numeric / Greek-alphabet / superscript order). Position
    // is the anchor and is always ordered; declared elsewhere.
    orderedKeys: ['letter', 'numeral', 'tone', 'accent'],
    categoriesFor(numCats, numItems) {
      // Priority order: anchor → subject → fillers. Take first numCats slots,
      // each populated with numItems items.
      const all = {
        position: () => Array.from({ length: numItems }, (_, i) => i + 1),
        letter:   () => LETTERS.slice(0, numItems),
        numeral:  () => NUMERALS.slice(0, numItems),
        shape:    () => SHAPES.slice(0, numItems),
        tone:     () => TONES.slice(0, numItems),
        symbol:   () => SYMBOLS.slice(0, numItems),
        accent:   () => ACCENTS.slice(0, numItems),
      };
      const order = ['position', 'letter', 'numeral', 'shape', 'tone', 'symbol', 'accent'];
      const out = {};
      for (let i = 0; i < numCats; i++) out[order[i]] = all[order[i]]();
      return out;
    },
    prompt: 'Determine which letter, numeral, shape, and tone go at each position.',
    phrase(cat, x) { return `${cat[0].toUpperCase()}=${x}`; },
    factPhrasing(subj, attrs) {
      const parts = [];
      if ('numeral'  in attrs) parts.push(attrs.numeral  ?? '_____');
      if ('shape'    in attrs) parts.push(attrs.shape    ?? '_____');
      if ('tone'     in attrs) parts.push(attrs.tone     ?? '_____');
      if ('symbol'   in attrs) parts.push(attrs.symbol   ?? '_____');
      if ('accent'   in attrs) parts.push(attrs.accent   ?? '_____');
      if ('position' in attrs) parts.push(attrs.position != null ? `position ${attrs.position}` : '_____');
      return parts.length ? `${subj} pairs with ${parts.join(', ')}.` : `${subj}.`;
    },
    propLine(catA, a, catB, b, polarity) {
      const op = polarity === 'yes' ? '↔' : '⊥';
      return `${this.phrase(catA, a)} ${op} ${this.phrase(catB, b)}`;
    },
    // Cosmetic verb-phrase per catKey for AllDifferent clue rendering.
    // The subject list is joined in front of the verb; e.g.,
    //   "L=A, N=II, and S=◯ are at different positions."
    allDifferentVerbs: {
      position: 'are at different positions',
      letter:   'are paired with different letters',
      numeral:  'are paired with different numerals',
      shape:    'are paired with different shapes',
      tone:     'are paired with different tones',
      symbol:   'are paired with different symbols',
      accent:   'are paired with different accents',
    },
    // Classic only flavors the anchor (position) axis. For its other ordered
    // axes (letter/numeral/tone/accent), return null and let the renderer
    // produce the generic "...in the {axis} ordering" skeleton — which, given
    // classic's symbolic phrase, comes out compact ("L=A comes before L=B in
    // the letter ordering"). Matches classic's terse aesthetic.
    renderPositional(c) {
      if (c.axisKey !== this.anchorKey) return null;
      const A = this.phrase(c.catA, c.a);
      const B = c.catB && this.phrase(c.catB, c.b);
      const C = c.catC && this.phrase(c.catC, c.c);
      switch (c.type) {
        case 'nextTo':       return `${A} and ${B} are at adjacent positions.`;
        case 'notNextTo':    return `${A} and ${B} are NOT at adjacent positions.`;
        case 'immLeft':      return `${A} is immediately left of ${B}.`;
        case 'immRight':     return `${A} is immediately right of ${B}.`;
        case 'leftOf':       return `${A} is somewhere left of ${B}.`;
        case 'rightOf':      return `${A} is somewhere right of ${B}.`;
        case 'exactlyApart': return `${A} and ${B} are exactly ${c.dist} positions apart.`;
        case 'within':       return `${A} and ${B} are within ${c.dist} positions of each other.`;
        case 'atLeastApart':
          return c.phrasing === 'notWithin'
            ? `${A} and ${B} are NOT within ${c.k - 1} positions of each other.`
            : `${A} and ${B} are at least ${c.k} positions apart.`;
        case 'between':      return `${A} is positionally between ${B} and ${C}.`;
        case 'atEnd':        return `${A} is at one of the end positions.`;
        case 'notAtEnd':     return `${A} is not at either end.`;
        default: return null;
      }
    },
    renderClue(c) { return renderClueShared(c, this); },
  },
  soapOpera: {
    name: 'soapOpera',
    label: 'Soap Opera — the dinner party',
    anchorKey: 'seat',
    subjectKey: 'guest',
    // Guests have ages — a naturally-ordered non-anchor numeric axis.
    // Other narrative attributes (drink, secret, rumor, gift, attire) are
    // unordered and stay off this list.
    orderedKeys: ['age'],
    categoriesFor(numCats, numItems) {
      const all = {
        seat:   () => Array.from({ length: numItems }, (_, i) => i + 1),
        guest:  () => shuffle(CHARACTER_POOL).slice(0, numItems),
        age:    () => sampleAges(numItems),
        drink:  () => shuffle(DRINK_POOL).slice(0, numItems),
        secret: () => shuffle(SECRET_POOL).slice(0, numItems),
        rumor:  () => shuffle(RUMOR_POOL).slice(0, numItems),
        gift:   () => shuffle(GIFT_POOL).slice(0, numItems),
        attire: () => shuffle(ATTIRE_POOL).slice(0, numItems),
      };
      // `age` slots in at position 3 so default 4-cat puzzles include it,
      // making the non-anchor ordered axis actually exercise the new
      // positional clue paths. Note: at numCats=7 (the current UI cap),
      // `attire` drops off the end of the priority list.
      const order = ['seat', 'guest', 'age', 'drink', 'secret', 'rumor', 'gift', 'attire'];
      const out = {};
      for (let i = 0; i < numCats; i++) out[order[i]] = all[order[i]]();
      return out;
    },
    prompt: 'Reconstruct what the gossip means: who sat where, what they drank, and what they were hiding.',
    phrase(cat, x) {
      if (cat === 'seat') return `seat ${x}`;
      if (cat === 'guest') return x;
      if (cat === 'age') return `the ${x}-year-old`;
      if (cat === 'drink') return `the ${x} drinker`;
      if (cat === 'secret') return `whoever was hiding ${x}`;
      if (cat === 'rumor') return `whoever was rumored ${x}`;
      if (cat === 'gift') return `whoever brought ${x}`;
      if (cat === 'attire') return `whoever wore ${x}`;
      // Defensive fallback: should never fire for soap-generated puzzles, but
      // can if a puzzle generated under a different theme is somehow rendered
      // under this one (theme/puzzle desync — App.jsx now binds theme to
      // puzzle, but the prosy fallback stays as a safety net so rendering
      // never devolves into symbol notation).
      return String(x);
    },
    factPhrasing(subj, attrs) {
      const parts = [];
      if ('age'    in attrs) parts.push(`was ${attrs.age ?? '__'}`);
      if ('drink'  in attrs) parts.push(`drank the ${attrs.drink ?? '_____'}`);
      if ('secret' in attrs) parts.push(`was hiding ${attrs.secret ?? '_____'}`);
      if ('rumor'  in attrs) parts.push(`was rumored ${attrs.rumor ?? '_____'}`);
      if ('gift'   in attrs) parts.push(`brought ${attrs.gift ?? '_____'}`);
      if ('attire' in attrs) parts.push(`wore ${attrs.attire ?? '_____'}`);
      if ('seat'   in attrs) parts.push(`sat at ${attrs.seat != null ? `seat ${attrs.seat}` : '_____'}`);
      return parts.length ? `${subj} ${parts.join(', ')}.` : `${subj}.`;
    },
    propLine(catA, a, catB, b, polarity) {
      // Special phrasing when seat is involved (positional).
      if (catA === 'seat' || catB === 'seat') {
        const seatVal = catA === 'seat' ? a : b;
        const otherCat = catA === 'seat' ? catB : catA;
        const otherVal = catA === 'seat' ? b : a;
        return polarity === 'yes'
          ? `${this.phrase(otherCat, otherVal)} was at seat ${seatVal}`
          : `${this.phrase(otherCat, otherVal)} was NOT at seat ${seatVal}`;
      }
      // Age-flavored phrasing so atomic age facts read naturally rather than
      // through the generic "matches" fallback.
      if (catA === 'age' || catB === 'age') {
        const ageVal = catA === 'age' ? a : b;
        const otherCat = catA === 'age' ? catB : catA;
        const otherVal = catA === 'age' ? b : a;
        return polarity === 'yes'
          ? `${this.phrase(otherCat, otherVal)} was ${ageVal}`
          : `${this.phrase(otherCat, otherVal)} was NOT ${ageVal}`;
      }
      return polarity === 'yes'
        ? `${this.phrase(catA, a)} matches ${this.phrase(catB, b)}`
        : `${this.phrase(catA, a)} does not match ${this.phrase(catB, b)}`;
    },
    allDifferentVerbs: {
      seat:   'sat at different seats',
      guest:  'are different guests',
      age:    'are of different ages',
      drink:  'drank different drinks',
      secret: 'were hiding different secrets',
      rumor:  'had different rumors going around them',
      gift:   'brought different gifts',
      attire: 'wore different outfits',
    },
    // Verb-fragments used by unalignedPair rendering. Each maps a catKey to
    // a function (value) => sentence-fragment, slotted into "one X and the
    // other Y" → "one was hiding the embezzlement and the other was hiding
    // the stolen will" style prose. Mirrors the soap factPhrasing verbs.
    unalignedPairVerbs: {
      seat:   (v) => `was at seat ${v}`,
      age:    (v) => `was ${v}`,
      drink:  (v) => `drank the ${v}`,
      secret: (v) => `was hiding ${v}`,
      rumor:  (v) => `was rumored ${v}`,
      gift:   (v) => `brought ${v}`,
      attire: (v) => `wore ${v}`,
    },
    renderPositional(c) {
      const A = capit(this.phrase(c.catA, c.a));
      const B = c.catB && this.phrase(c.catB, c.b);
      const C = c.catC && this.phrase(c.catC, c.c);
      // Age axis — gets specifically-flavored prose using younger/older
      // language, rather than the abstract "comes before in the age ordering"
      // generic fallback.
      if (c.axisKey === 'age') {
        switch (c.type) {
          case 'nextTo':       return `${A} and ${B} are adjacent in age.`;
          case 'notNextTo':    return `${A} and ${B} are NOT adjacent in age.`;
          case 'immLeft':      return `${A} is just younger than ${B}.`;
          case 'immRight':     return `${A} is just older than ${B}.`;
          case 'leftOf':       return `${A} is younger than ${B}.`;
          case 'rightOf':      return `${A} is older than ${B}.`;
          case 'exactlyApart': return `${A} and ${B} are exactly ${c.dist} places apart in age order.`;
          case 'within':       return `${A} and ${B} are within ${c.dist} places of each other in age order.`;
          case 'atLeastApart':
            return c.phrasing === 'notWithin'
              ? `${A} and ${B} are NOT within ${c.k - 1} places of each other in age order.`
              : `${A} and ${B} are at least ${c.k} places apart in age order.`;
          case 'between':      return `${A}'s age falls between ${B}'s and ${C}'s.`;
          case 'atEnd':        return `${A} is the youngest or the oldest at the table.`;
          case 'notAtEnd':     return `${A} is neither the youngest nor the oldest at the table.`;
          default: return null;
        }
      }
      // Seat (anchor) axis.
      if (c.axisKey === 'seat') {
        switch (c.type) {
          case 'nextTo':       return `${A} sat next to ${B}.`;
          case 'notNextTo':    return `${A} did NOT sit next to ${B}.`;
          case 'immLeft':      return `${A} sat immediately to the left of ${B}.`;
          case 'immRight':     return `${A} sat immediately to the right of ${B}.`;
          case 'leftOf':       return `${A} sat somewhere to the left of ${B}.`;
          case 'rightOf':      return `${A} sat somewhere to the right of ${B}.`;
          case 'exactlyApart': return `${A} and ${B} sat exactly ${c.dist} seats apart.`;
          case 'within':       return `${A} and ${B} sat within ${c.dist} seats of each other.`;
          case 'atLeastApart':
            return c.phrasing === 'notWithin'
              ? `${A} and ${B} did NOT sit within ${c.k - 1} seats of each other.`
              : `${A} and ${B} sat at least ${c.k} seats apart.`;
          case 'between':      return `${A} sat between ${B} and ${C}.`;
          case 'atEnd':        return `${A} sat at one of the ends of the table.`;
          case 'notAtEnd':     return `${A} sat somewhere in the middle — not at either end.`;
          default: return null;
        }
      }
      return null;
    },
    renderClue(c) { return renderClueShared(c, this); },
  },
  noir: {
    name: 'noir',
    label: 'Noir — the suspects',
    anchorKey: 'room',
    subjectKey: 'suspect',
    // Suspects have ages, same naturally-ordered numeric axis as soap.
    orderedKeys: ['age'],
    categoriesFor(numCats, numItems) {
      const all = {
        room:     () => Array.from({ length: numItems }, (_, i) => i + 1),
        suspect:  () => shuffle(CHARACTER_POOL).slice(0, numItems),
        age:      () => sampleAges(numItems),
        evidence: () => shuffle(OBJECT_POOL).slice(0, numItems),
        color:    () => shuffle(COLORS).slice(0, numItems),
        motive:   () => shuffle(MOTIVE_POOL).slice(0, numItems),
        weapon:   () => shuffle(WEAPON_POOL).slice(0, numItems),
        alibi:    () => shuffle(ALIBI_POOL).slice(0, numItems),
      };
      // `age` slots in after `suspect`; at numCats=7 `alibi` drops off the
      // priority list. Same rationale as soap.
      const order = ['room', 'suspect', 'age', 'evidence', 'color', 'motive', 'weapon', 'alibi'];
      const out = {};
      for (let i = 0; i < numCats; i++) out[order[i]] = all[order[i]]();
      return out;
    },
    prompt: 'Pin each suspect to a room, the evidence they left, the color they wore, and the motive that drove them.',
    phrase(cat, x) {
      if (cat === 'room') return `room ${x}`;
      if (cat === 'suspect') return x;
      if (cat === 'age') return `the ${x}-year-old`;
      if (cat === 'evidence') return `the one who left the ${x}`;
      if (cat === 'color') return `the one in ${x}`;
      if (cat === 'motive') return `the one driven by ${x}`;
      if (cat === 'weapon') return `whoever used ${x}`;
      if (cat === 'alibi') return `whoever claimed to be ${x}`;
      // Defensive prose fallback — see soap.phrase for the rationale.
      return String(x);
    },
    factPhrasing(subj, attrs) {
      const parts = [];
      if ('age'      in attrs) parts.push(`was ${attrs.age ?? '__'}`);
      if ('color'    in attrs) parts.push(`wore ${attrs.color ?? '_____'}`);
      if ('evidence' in attrs) parts.push(`left the ${attrs.evidence ?? '_____'}`);
      if ('motive'   in attrs) parts.push(`was driven by ${attrs.motive ?? '_____'}`);
      if ('weapon'   in attrs) parts.push(`used ${attrs.weapon ?? '_____'}`);
      if ('alibi'    in attrs) parts.push(`claimed to be ${attrs.alibi ?? '_____'}`);
      if ('room'     in attrs) parts.push(`was in ${attrs.room != null ? `room ${attrs.room}` : '_____'}`);
      return parts.length ? `${subj} ${parts.join(', ')}.` : `${subj}.`;
    },
    propLine(catA, a, catB, b, polarity) {
      if (catA === 'room' || catB === 'room') {
        const otherCat = catA === 'room' ? catB : catA;
        const otherVal = catA === 'room' ? b : a;
        const roomVal = catA === 'room' ? a : b;
        return polarity === 'yes'
          ? `${this.phrase(otherCat, otherVal)} was in room ${roomVal}`
          : `${this.phrase(otherCat, otherVal)} was NOT in room ${roomVal}`;
      }
      if (catA === 'age' || catB === 'age') {
        const ageVal = catA === 'age' ? a : b;
        const otherCat = catA === 'age' ? catB : catA;
        const otherVal = catA === 'age' ? b : a;
        return polarity === 'yes'
          ? `${this.phrase(otherCat, otherVal)} was ${ageVal}`
          : `${this.phrase(otherCat, otherVal)} was NOT ${ageVal}`;
      }
      return polarity === 'yes'
        ? `${this.phrase(catA, a)} is ${this.phrase(catB, b)}`
        : `${this.phrase(catA, a)} is not ${this.phrase(catB, b)}`;
    },
    allDifferentVerbs: {
      room:     'were in different rooms',
      suspect:  'are different suspects',
      age:      'are of different ages',
      evidence: 'left different pieces of evidence',
      color:    'wore different colors',
      motive:   'had different motives',
      weapon:   'used different weapons',
      alibi:    'gave different alibis',
    },
    // Verb-fragments used by unalignedPair rendering. Mirrors noir's
    // factPhrasing patterns ("left the X", "was driven by Y", etc.).
    unalignedPairVerbs: {
      room:     (v) => `was in room ${v}`,
      age:      (v) => `was ${v}`,
      evidence: (v) => `left the ${v}`,
      color:    (v) => `wore ${v}`,
      motive:   (v) => `was driven by ${v}`,
      weapon:   (v) => `used ${v}`,
      alibi:    (v) => `claimed to be ${v}`,
    },
    renderPositional(c) {
      const A = capit(this.phrase(c.catA, c.a));
      const B = c.catB && this.phrase(c.catB, c.b);
      const C = c.catC && this.phrase(c.catC, c.c);
      if (c.axisKey === 'age') {
        switch (c.type) {
          case 'nextTo':       return `${A} and ${B} are adjacent in age.`;
          case 'notNextTo':    return `${A} and ${B} are NOT adjacent in age.`;
          case 'immLeft':      return `${A} is just younger than ${B}.`;
          case 'immRight':     return `${A} is just older than ${B}.`;
          case 'leftOf':       return `${A} is younger than ${B}.`;
          case 'rightOf':      return `${A} is older than ${B}.`;
          case 'exactlyApart': return `${A} and ${B} are exactly ${c.dist} places apart in age order.`;
          case 'within':       return `${A} and ${B} are within ${c.dist} places of each other in age order.`;
          case 'atLeastApart':
            return c.phrasing === 'notWithin'
              ? `${A} and ${B} are NOT within ${c.k - 1} places of each other in age order.`
              : `${A} and ${B} are at least ${c.k} places apart in age order.`;
          case 'between':      return `${A}'s age falls between ${B}'s and ${C}'s.`;
          case 'atEnd':        return `${A} is the youngest or the oldest of the suspects.`;
          case 'notAtEnd':     return `${A} is neither the youngest nor the oldest of the suspects.`;
          default: return null;
        }
      }
      if (c.axisKey === 'room') {
        switch (c.type) {
          case 'nextTo':       return `${A}'s room is adjacent to ${B}'s.`;
          case 'notNextTo':    return `${A}'s room is NOT adjacent to ${B}'s.`;
          case 'immLeft':      return `${A}'s room is immediately before ${B}'s.`;
          case 'immRight':     return `${A}'s room is immediately after ${B}'s.`;
          case 'leftOf':       return `${A}'s room comes somewhere before ${B}'s.`;
          case 'rightOf':      return `${A}'s room comes somewhere after ${B}'s.`;
          case 'exactlyApart': return `${A} and ${B} are exactly ${c.dist} rooms apart.`;
          case 'within':       return `${A} and ${B} are within ${c.dist} rooms of each other.`;
          case 'atLeastApart':
            return c.phrasing === 'notWithin'
              ? `${A} and ${B} were NOT within ${c.k - 1} rooms of each other.`
              : `${A} and ${B} were at least ${c.k} rooms apart.`;
          case 'between':      return `${A}'s room is between ${B}'s and ${C}'s.`;
          case 'atEnd':        return `${A} was in one of the end rooms.`;
          case 'notAtEnd':     return `${A} was not in an end room.`;
          default: return null;
        }
      }
      return null;
    },
    renderClue(c) { return renderClueShared(c, this); },
  },
};
