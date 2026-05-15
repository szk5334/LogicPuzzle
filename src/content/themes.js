// Themes wire content pools to engine categories, expose theme-local naming
// (phrase, propLine, factPhrasing), and render clue prose via renderClueShared.
//
// Three themes ship: classic (abstract symbols), soapOpera (party-drama),
// noir (whodunit). Each declares a priority-ordered category list, a subjectKey
// for the deduction panel, and per-positional-type prose.
//
// Phase 5 will lift theme content (pools, priority orders, factPhrasing strings)
// into JSON. Phase 2.5 keeps them as JS exports.

import { capit } from '../utils.js';
import { shuffle } from '../engine/propagation.js';
import {
  CHARACTER_POOL, DRINK_POOL, SECRET_POOL, RUMOR_POOL,
  OBJECT_POOL, MOTIVE_POOL, WEAPON_POOL, ALIBI_POOL,
  GIFT_POOL, ATTIRE_POOL,
  LETTERS, NUMERALS, SHAPES, COLORS, TONES, SYMBOLS, ACCENTS,
} from './pools.js';
import { renderClueShared } from './render.js';

export const themes = {
  classic: {
    name: 'classic',
    label: 'Classic — letters & numerals',
    anchorKey: 'position',
    subjectKey: 'letter',
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
    renderPositional(c) {
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
        case 'between':      return `${A} is positionally between ${B} and ${C}.`;
        case 'atEnd':        return `${A} is at one of the end positions.`;
        case 'notAtEnd':     return `${A} is not at either end.`;
        default: return '?';
      }
    },
    renderClue(c) { return renderClueShared(c, this); },
  },
  soapOpera: {
    name: 'soapOpera',
    label: 'Soap Opera — the dinner party',
    anchorKey: 'seat',
    subjectKey: 'guest',
    categoriesFor(numCats, numItems) {
      const all = {
        seat:   () => Array.from({ length: numItems }, (_, i) => i + 1),
        guest:  () => shuffle(CHARACTER_POOL).slice(0, numItems),
        drink:  () => shuffle(DRINK_POOL).slice(0, numItems),
        secret: () => shuffle(SECRET_POOL).slice(0, numItems),
        rumor:  () => shuffle(RUMOR_POOL).slice(0, numItems),
        gift:   () => shuffle(GIFT_POOL).slice(0, numItems),
        attire: () => shuffle(ATTIRE_POOL).slice(0, numItems),
      };
      const order = ['seat', 'guest', 'drink', 'secret', 'rumor', 'gift', 'attire'];
      const out = {};
      for (let i = 0; i < numCats; i++) out[order[i]] = all[order[i]]();
      return out;
    },
    prompt: 'Reconstruct what the gossip means: who sat where, what they drank, and what they were hiding.',
    phrase(cat, x) {
      if (cat === 'seat') return `seat ${x}`;
      if (cat === 'guest') return x;
      if (cat === 'drink') return `the ${x} drinker`;
      if (cat === 'secret') return `whoever was hiding ${x}`;
      if (cat === 'rumor') return `whoever was rumored ${x}`;
      if (cat === 'gift') return `whoever brought ${x}`;
      if (cat === 'attire') return `whoever wore ${x}`;
      return `${cat}=${x}`;
    },
    factPhrasing(subj, attrs) {
      const parts = [];
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
      return polarity === 'yes'
        ? `${this.phrase(catA, a)} matches ${this.phrase(catB, b)}`
        : `${this.phrase(catA, a)} does not match ${this.phrase(catB, b)}`;
    },
    renderPositional(c) {
      const A = capit(this.phrase(c.catA, c.a));
      const B = c.catB && this.phrase(c.catB, c.b);
      const C = c.catC && this.phrase(c.catC, c.c);
      switch (c.type) {
        case 'nextTo':       return `${A} sat next to ${B}.`;
        case 'notNextTo':    return `${A} did NOT sit next to ${B}.`;
        case 'immLeft':      return `${A} sat immediately to the left of ${B}.`;
        case 'immRight':     return `${A} sat immediately to the right of ${B}.`;
        case 'leftOf':       return `${A} sat somewhere to the left of ${B}.`;
        case 'rightOf':      return `${A} sat somewhere to the right of ${B}.`;
        case 'exactlyApart': return `${A} and ${B} sat exactly ${c.dist} seats apart.`;
        case 'within':       return `${A} and ${B} sat within ${c.dist} seats of each other.`;
        case 'between':      return `${A} sat between ${B} and ${C}.`;
        case 'atEnd':        return `${A} sat at one of the ends of the table.`;
        case 'notAtEnd':     return `${A} sat somewhere in the middle — not at either end.`;
        default: return '?';
      }
    },
    renderClue(c) { return renderClueShared(c, this); },
  },
  noir: {
    name: 'noir',
    label: 'Noir — the suspects',
    anchorKey: 'room',
    subjectKey: 'suspect',
    categoriesFor(numCats, numItems) {
      const all = {
        room:     () => Array.from({ length: numItems }, (_, i) => i + 1),
        suspect:  () => shuffle(CHARACTER_POOL).slice(0, numItems),
        evidence: () => shuffle(OBJECT_POOL).slice(0, numItems),
        color:    () => shuffle(COLORS).slice(0, numItems),
        motive:   () => shuffle(MOTIVE_POOL).slice(0, numItems),
        weapon:   () => shuffle(WEAPON_POOL).slice(0, numItems),
        alibi:    () => shuffle(ALIBI_POOL).slice(0, numItems),
      };
      const order = ['room', 'suspect', 'evidence', 'color', 'motive', 'weapon', 'alibi'];
      const out = {};
      for (let i = 0; i < numCats; i++) out[order[i]] = all[order[i]]();
      return out;
    },
    prompt: 'Pin each suspect to a room, the evidence they left, the color they wore, and the motive that drove them.',
    phrase(cat, x) {
      if (cat === 'room') return `room ${x}`;
      if (cat === 'suspect') return x;
      if (cat === 'evidence') return `the one who left the ${x}`;
      if (cat === 'color') return `the one in ${x}`;
      if (cat === 'motive') return `the one driven by ${x}`;
      if (cat === 'weapon') return `whoever used ${x}`;
      if (cat === 'alibi') return `whoever claimed to be ${x}`;
      return `${cat}=${x}`;
    },
    factPhrasing(subj, attrs) {
      const parts = [];
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
      return polarity === 'yes'
        ? `${this.phrase(catA, a)} is ${this.phrase(catB, b)}`
        : `${this.phrase(catA, a)} is not ${this.phrase(catB, b)}`;
    },
    renderPositional(c) {
      const A = capit(this.phrase(c.catA, c.a));
      const B = c.catB && this.phrase(c.catB, c.b);
      const C = c.catC && this.phrase(c.catC, c.c);
      switch (c.type) {
        case 'nextTo':       return `${A}'s room is adjacent to ${B}'s.`;
        case 'notNextTo':    return `${A}'s room is NOT adjacent to ${B}'s.`;
        case 'immLeft':      return `${A}'s room is immediately before ${B}'s.`;
        case 'immRight':     return `${A}'s room is immediately after ${B}'s.`;
        case 'leftOf':       return `${A}'s room comes somewhere before ${B}'s.`;
        case 'rightOf':      return `${A}'s room comes somewhere after ${B}'s.`;
        case 'exactlyApart': return `${A} and ${B} are exactly ${c.dist} rooms apart.`;
        case 'within':       return `${A} and ${B} are within ${c.dist} rooms of each other.`;
        case 'between':      return `${A}'s room is between ${B}'s and ${C}'s.`;
        case 'atEnd':        return `${A} was in one of the end rooms.`;
        case 'notAtEnd':     return `${A} was not in an end room.`;
        default: return '?';
      }
    },
    renderClue(c) { return renderClueShared(c, this); },
  },
};
