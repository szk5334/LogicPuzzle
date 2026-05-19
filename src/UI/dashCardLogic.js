// DashCard logic — pure data and config-derivation. No JSX. Imported by both
// DashCard.jsx and Node-based tests.
//
// IMPORTANT — DATA PROVENANCE
// The TIME_PER_TYPE and DIFF_PER_TYPE tables below come from an OLS regression
// against 1000 random 4-type combos at K=3 each. β values are CENTERED around
// zero (representing each type's deviation from the average 4-type-combo
// effect) and POOLED for true directional opposites (immLeft/immRight,
// leftOf/rightOf get identical ratings by symmetry). See
// /experiments/per_type_contributions.json and EXPERIMENTS.md for the full
// derivation.

// All clue types the engine emits, ordered by family for the custom checklist.
export const ALL_TYPES = [
  'is', 'not',
  'nextTo', 'notNextTo', 'immLeft', 'immRight',
  'leftOf', 'rightOf',
  'exactlyApart', 'within', 'atLeastApart', 'between',
  'atEnd', 'notAtEnd',
  'oneOf', 'either', 'xor', 'ifThen', 'iff', 'ifThenAnd',
  'allDifferent', 'unalignedPair', 'mixed',
];

// ---------- Lookup tables from 1000-combo OLS regression ----------
// β-time: marginal time contribution (ms) of adding this type to a 4-type combo,
// centered. Negative = faster than average; positive = slower.
// β-diff: same for difficulty score, centered around zero.
// Types not in the 20-type regression set (is, not, unalignedPair) use
// extrapolated values from the earlier single-type-focus experiments.
export const TIME_PER_TYPE = {
  // From 1000-combo regression (centered β-time):
  nextTo: -42, notNextTo: 23, immLeft: -67, immRight: -67,
  leftOf: 117, rightOf: 117,
  exactlyApart: 37, within: 130, atLeastApart: -25, between: -58,
  atEnd: -71, notAtEnd: -42,
  oneOf: 139, either: -1, xor: -112, ifThen: -6, iff: -133, ifThenAnd: 62,
  allDifferent: 108, mixed: -110,
  // Not in regression — single-focus values centered toward typical range:
  is: -20, not: -30, unalignedPair: -150,
};

export const DIFF_PER_TYPE = {
  // From 1000-combo regression (centered β-diff):
  nextTo: -23, notNextTo: -6, immLeft: -11, immRight: -11,
  leftOf: -7, rightOf: -7,
  exactlyApart: -10, within: -8, atLeastApart: -35, between: -39,
  atEnd: -90, notAtEnd: -56,
  oneOf: 1, either: 31, xor: 85, ifThen: 35, iff: 56, ifThenAnd: 41,
  allDifferent: -30, mixed: 84,
  // Not in regression:
  is: -120, not: -120, unalignedPair: -150,
};

// Difficulty arrows. Bins on the CENTERED β scale (β > 0 = above average).
export function diffArrow(t) {
  const d = DIFF_PER_TYPE[t] ?? 0;
  if (d >=  50) return { mark: '↑↑↑', cls: 'arrow-up3' };
  if (d >=  25) return { mark: '↑↑',  cls: 'arrow-up2' };
  if (d >=  10) return { mark: '↑',   cls: 'arrow-up1' };
  if (d >  -10) return { mark: '=',   cls: 'arrow-flat' };
  if (d >  -25) return { mark: '↓',   cls: 'arrow-dn1' };
  if (d >  -50) return { mark: '↓↓',  cls: 'arrow-dn2' };
  return                       { mark: '↓↓↓', cls: 'arrow-dn3' };
}

// Time arrows. Centered β; negative = faster than average.
export function timeArrow(t) {
  const ms = TIME_PER_TYPE[t] ?? 0;
  if (ms >=  100) return { mark: '↑↑↑', cls: 'arrow-up3' };
  if (ms >=   50) return { mark: '↑↑',  cls: 'arrow-up2' };
  if (ms >=   20) return { mark: '↑',   cls: 'arrow-up1' };
  if (ms >   -20) return { mark: '=',   cls: 'arrow-flat' };
  if (ms >   -50) return { mark: '↓',   cls: 'arrow-dn1' };
  if (ms >  -100) return { mark: '↓↓',  cls: 'arrow-dn2' };
  return                        { mark: '↓↓↓', cls: 'arrow-dn3' };
}

// Star rating cutoffs aligned with band caps (200/300/400/420).
export function diffToStars(d) {
  if (d >= 420) return '★★★★★';
  if (d >= 340) return '★★★★☆';
  if (d >= 260) return '★★★☆☆';
  if (d >= 180) return '★★☆☆☆';
  if (d >=  80) return '★☆☆☆☆';
  return '☆☆☆☆☆';
}

// ---------- Estimate model ----------
// The intercept of the centered regression is ~395 (mean diff across all
// 4-type combos). For a custom combo: predicted = 395 + Σ β. For natural:
// see lookup. Best-of-K boost is empirical.
const REGRESSION_INTERCEPT_DIFF = 395;
const REGRESSION_INTERCEPT_TIME = 280;

export function estimateMetrics(config) {
  const { difficulty, sampleCount, typeFocusMode, customAssignments, adaptiveMin, priorityMode } = config;

  // ----- Per-sample time -----
  let msPerSample;
  if (typeFocusMode === 'natural') {
    msPerSample = difficulty === 'hard' ? 380 : difficulty === 'medium' ? 280 : 200;
  } else if (typeFocusMode === 'even') {
    msPerSample = 220;
  } else {
    const fixed = Object.keys(customAssignments).filter((t) => customAssignments[t] === 'fixed');
    const rotate = Object.keys(customAssignments).filter((t) => customAssignments[t] === 'rotate');
    const pool = [...fixed, ...rotate];
    if (pool.length === 0) {
      msPerSample = 250;
    } else if (pool.length >= 4) {
      // Use the regression-predicted time for the combo (sum of β + intercept).
      // For rotating: average over the rotate pool with fixed members locked.
      const fixedSum = fixed.reduce((s, t) => s + (TIME_PER_TYPE[t] ?? 0), 0);
      const rotateMean = rotate.length > 0
        ? rotate.reduce((s, t) => s + (TIME_PER_TYPE[t] ?? 0), 0) / rotate.length
        : 0;
      const otherSum = fixed.length + (rotate.length > 0 ? 1 : 0) === 4
        ? fixedSum + rotateMean
        : (fixedSum + rotateMean * Math.max(0, 4 - fixed.length));
      msPerSample = Math.max(120, Math.round(REGRESSION_INTERCEPT_TIME + otherSum));
    } else {
      // 1–3 type focus: scale by pool size; less reliable
      const avg = pool.reduce((s, t) => s + (TIME_PER_TYPE[t] ?? 0), 0) / pool.length;
      msPerSample = Math.max(120, Math.round(REGRESSION_INTERCEPT_TIME + avg * 1.5));
    }
  }
  if (adaptiveMin) msPerSample = Math.round(msPerSample * 0.98);

  // ----- Difficulty (chosen winner) -----
  let baseDiff;
  if (typeFocusMode === 'natural') {
    baseDiff = difficulty === 'hard' ? 290 : difficulty === 'medium' ? 250 : 200;
  } else if (typeFocusMode === 'even') {
    baseDiff = 200;
  } else {
    const fixed = Object.keys(customAssignments).filter((t) => customAssignments[t] === 'fixed');
    const rotate = Object.keys(customAssignments).filter((t) => customAssignments[t] === 'rotate');
    const pool = [...fixed, ...rotate];
    if (pool.length === 0) {
      baseDiff = REGRESSION_INTERCEPT_DIFF;
    } else if (pool.length >= 4) {
      const fixedSum = fixed.reduce((s, t) => s + (DIFF_PER_TYPE[t] ?? 0), 0);
      const rotateMean = rotate.length > 0
        ? rotate.reduce((s, t) => s + (DIFF_PER_TYPE[t] ?? 0), 0) / rotate.length
        : 0;
      const otherSum = fixed.length + (rotate.length > 0 ? 1 : 0) === 4
        ? fixedSum + rotateMean
        : (fixedSum + rotateMean * Math.max(0, 4 - fixed.length));
      baseDiff = REGRESSION_INTERCEPT_DIFF + otherSum;
    } else {
      const avg = pool.reduce((s, t) => s + (DIFF_PER_TYPE[t] ?? 0), 0) / pool.length;
      baseDiff = REGRESSION_INTERCEPT_DIFF + avg * 1.5;
    }
  }
  // Best-of-K boost. Empirical: chosen mean ≈ base × (1 + 0.5·log10(K)).
  const bestOfBoost = 1 + 0.5 * Math.log10(Math.max(sampleCount, 1));
  let finalDiff = Math.round(baseDiff * bestOfBoost);

  // Band-capped priority modes constrain the chosen puzzle to a band cap.
  // Reflect that in the estimate.
  const CAPS = { bandEasy: 200, bandMedium: 300, bandHard: 400 };
  if (priorityMode && CAPS[priorityMode] != null) {
    finalDiff = Math.min(finalDiff, CAPS[priorityMode]);
  }

  return {
    msPerSample,
    totalMs: msPerSample * sampleCount,
    difficulty: finalDiff,
    stars: diffToStars(finalDiff),
  };
}

// ---------- Resolve engine typeFocus from UI state ----------
export function configToEngineFocus(config) {
  if (config.typeFocusMode === 'natural') return 'natural';
  if (config.typeFocusMode === 'even') return 'even';
  const fixed = ALL_TYPES.filter((t) => config.customAssignments[t] === 'fixed');
  const rotate = ALL_TYPES.filter((t) => config.customAssignments[t] === 'rotate');
  if (rotate.length > 0) return { fixed, rotate };
  if (fixed.length > 0) return fixed;
  return 'even';
}

// Helper: turn a 4-type array into a customAssignments map (all fixed).
function asFixed(types) {
  const obj = {};
  for (const t of types) obj[t] = 'fixed';
  return obj;
}

// ---------- Presets ----------
// CURATED bands: each preset is a verified 4-type combo + the matching
// band-capped priority mode. Winners come from K=40 verification on 1000
// random combos. See /experiments/band_winners.json.
//
// NATURAL bands: no type restriction; the difficulty band controls clue
// weights via the WEIGHTS table in generator.js. Same band-capped scoring.
export const PRESETS = {
  // ----- Curated 4-type presets -----
  easy: {
    label: 'Easy',
    group: 'curated',
    note: 'Curated combo · cap 200 · K=40 verified',
    config: {
      difficulty: 'hard',
      priorityMode: 'bandEasy',
      sampleCount: 100,
      typeFocusMode: 'custom',
      customAssignments: asFixed(['atEnd', 'between', 'either', 'ifThenAnd']),
      adaptiveMin: true,
    },
  },
  medium: {
    label: 'Medium',
    group: 'curated',
    note: 'Curated combo · cap 300 · K=40 verified',
    config: {
      difficulty: 'hard',
      priorityMode: 'bandMedium',
      sampleCount: 100,
      typeFocusMode: 'custom',
      customAssignments: asFixed(['atLeastApart', 'iff', 'notAtEnd', 'rightOf']),
      adaptiveMin: true,
    },
  },
  hard: {
    label: 'Hard',
    group: 'curated',
    note: 'Curated combo · cap 400 · K=40 verified · capHit=400 exactly',
    config: {
      difficulty: 'hard',
      priorityMode: 'bandHard',
      sampleCount: 100,
      typeFocusMode: 'custom',
      customAssignments: asFixed(['allDifferent', 'iff', 'immRight', 'mixed']),
      adaptiveMin: true,
    },
  },
  brutal: {
    label: 'Brutal',
    group: 'curated',
    note: 'Curated combo · uncapped · K=40 max=926',
    config: {
      difficulty: 'hard',
      priorityMode: 'bandBrutal',
      sampleCount: 500,
      typeFocusMode: 'custom',
      customAssignments: asFixed(['mixed', 'nextTo', 'oneOf', 'xor']),
      adaptiveMin: true,
    },
  },

  // ----- Natural-distribution bands (no type restriction) -----
  naturalEasy: {
    label: 'Easy (natural)',
    group: 'natural',
    note: 'No type restriction · cap 200',
    config: {
      difficulty: 'easy',
      priorityMode: 'bandEasy',
      sampleCount: 25,
      typeFocusMode: 'natural',
      customAssignments: {},
      adaptiveMin: true,
    },
  },
  naturalMedium: {
    label: 'Medium (natural)',
    group: 'natural',
    note: 'No type restriction · cap 300',
    config: {
      difficulty: 'medium',
      priorityMode: 'bandMedium',
      sampleCount: 25,
      typeFocusMode: 'natural',
      customAssignments: {},
      adaptiveMin: true,
    },
  },
  naturalHard: {
    label: 'Hard (natural)',
    group: 'natural',
    note: 'No type restriction · cap 400',
    config: {
      difficulty: 'hard',
      priorityMode: 'bandHard',
      sampleCount: 25,
      typeFocusMode: 'natural',
      customAssignments: {},
      adaptiveMin: true,
    },
  },
  naturalBrutal: {
    label: 'Brutal (natural)',
    group: 'natural',
    note: 'No type restriction · uncapped · 500 samples to hunt outliers',
    config: {
      difficulty: 'hard',
      priorityMode: 'bandBrutal',
      sampleCount: 500,
      typeFocusMode: 'natural',
      customAssignments: {},
      adaptiveMin: true,
    },
  },
};

// Pre-sorted preset groups for the UI.
export const PRESET_GROUPS = {
  curated: ['easy', 'medium', 'hard', 'brutal'],
  natural: ['naturalEasy', 'naturalMedium', 'naturalHard', 'naturalBrutal'],
};

// Rotation pools per band — top 3 verified combos per band, for future
// "even mix" curation paths that progress through varied puzzle shapes.
export const BAND_ROTATION_POOLS = {
  easy: [
    ['atEnd', 'between', 'either', 'ifThenAnd'],
    ['atEnd', 'between', 'either', 'xor'],
    ['between', 'either', 'iff', 'within'],
  ],
  medium: [
    ['atLeastApart', 'iff', 'notAtEnd', 'rightOf'],
    ['exactlyApart', 'mixed', 'notAtEnd', 'oneOf'],
    ['exactlyApart', 'iff', 'immLeft', 'immRight'],
  ],
  hard: [
    ['allDifferent', 'iff', 'immRight', 'mixed'],
    ['either', 'exactlyApart', 'mixed', 'notNextTo'],
    ['iff', 'immLeft', 'mixed', 'notAtEnd'],
  ],
  brutal: [
    ['mixed', 'nextTo', 'oneOf', 'xor'],
    ['ifThenAnd', 'iff', 'rightOf', 'xor'],
    ['ifThen', 'nextTo', 'notNextTo', 'xor'],
  ],
};

// Default config — matches the naturalMedium preset so the simplified UI's
// Medium button is active on first load. (To revert to the older
// "balance / 10 samples" default, see the prior commit.)
export const DEFAULT_CONFIG = {
  difficulty: 'medium',
  priorityMode: 'bandMedium',
  sampleCount: 25,
  typeFocusMode: 'natural',
  customAssignments: {},
  adaptiveMin: true,
};

// Allowed sample counts for the dash card.
export const SAMPLE_COUNTS = [1, 5, 10, 25, 100, 500];
