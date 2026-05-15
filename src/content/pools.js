// Content pools used by themes to populate categories.
//
// Two flavors:
//   - Narrative pools (CHARACTER_POOL, DRINK_POOL, ...): semantic items used
//     by soapOpera and noir themes. Shuffled per generation.
//   - Display arrays (LETTERS, NUMERALS, ...): order-bearing symbols used by
//     the classic theme. Sliced, not shuffled.
//
// In Phase 5 these move to JSON. Until then they're named exports.

export const CHARACTER_POOL = ['Marisol', 'Dax', 'Yuki', 'Cordelia', 'Renard', 'Imani', 'Felix', 'Odette'];
export const DRINK_POOL = ['martini', 'cabernet', 'whiskey', 'champagne', 'absinthe', 'mezcal', 'gin'];
export const SECRET_POOL = [
  'an affair with the host',
  'embezzlement at the firm',
  'a fake medical degree',
  'a secret second family',
  'a stolen manuscript',
  'a buried prior identity',
  'a fugitive past',
];
export const RUMOR_POOL = [
  'leaving town',
  'inheriting everything',
  'broke',
  'dating the host',
  'planning revenge',
  'secretly engaged',
  'in a long feud',
];
export const OBJECT_POOL = ['silver locket', 'matchbook', 'lipstick-stained napkin', 'torn letter', 'pearl earring', 'antique pen', 'gold cufflink'];
export const MOTIVE_POOL = ['jealousy', 'revenge', 'greed', 'shame', 'ambition', 'fear', 'pride'];
export const WEAPON_POOL = ['the revolver', 'the dagger', 'the rope', 'the poison', 'the candlestick', 'the lead pipe', 'the wrench'];
export const ALIBI_POOL = ['at the office', 'on a date', 'asleep at home', 'in court', 'at the gym', 'visiting family', 'at the theater'];
export const GIFT_POOL = ['white roses', 'a bottle of port', 'a silk scarf', 'a vintage book', 'a pearl necklace', 'a handwritten note', 'a chocolate box'];
export const ATTIRE_POOL = ['black tie', 'a velvet jacket', 'a sequined dress', 'a silk gown', 'a tweed suit', 'a feathered hat', 'an emerald brooch'];

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
export const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
export const SHAPES = ['◯', '△', '□', '◇', '☆', '✕', '▽'];
export const COLORS = ['red', 'blue', 'green', 'gold', 'violet', 'white', 'silver'];
export const TONES = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η'];
export const SYMBOLS = ['♠', '♥', '♦', '♣', '★', '♪', '☼'];
export const ACCENTS = ['¹', '²', '³', '⁴', '⁵', '⁶', '⁷'];
