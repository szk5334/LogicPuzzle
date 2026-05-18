// DashCard logic — pure data and config-derivation, no JSX. Lives separately
// from DashCard.jsx so it's importable from Node tests and from other JS
// modules without needing a JSX transform.

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

// ---------- Lookup tables from front-loaded experiments ----------
// Time per single-type focus at hard band, 5×5 (ms). From the type-focus
// sweep with K=15 each. Combos pool to ~200ms regardless; only single- or
// dual-type focuses show the per-type cost meaningfully.
export const TIME_PER_TYPE = {
  is: 246, not: 230,
  nextTo: 178, notNextTo: 223, immLeft: 130, immRight: 184,
  leftOf: 339, rightOf: 339, exactlyApart: 185, within: 460,
  atLeastApart: 210, between: 235, atEnd: 261, notAtEnd: 322,
  oneOf: 1187, either: 463, xor: 274, ifThen: 395, iff: 254,
  ifThenAnd: 600, mixed: 308, allDifferent: 609, unalignedPair: 92,
};

// Difficulty score per single-type focus.
export const DIFF_PER_TYPE = {
  is: 38, not: 35,
  nextTo: 259, notNextTo: 276, immLeft: 212, immRight: 170,
  leftOf: 156, rightOf: 163, exactlyApart: 213, within: 128,
  atLeastApart: 158, between: 124, atEnd: 162, notAtEnd: 150,
  oneOf: 409, either: 282, xor: 277, ifThen: 287, iff: 349,
  ifThenAnd: 197, mixed: 320, allDifferent: 67, unalignedPair: 28,
};

// Difficulty arrows for the checklist UI. Bins selected to spread the 22
// emitting types across six visible buckets.
export function diffArrow(t) {
  const d = DIFF_PER_TYPE[t] ?? 200;
  if (d >= 340) return { mark: '↑↑↑', cls: 'arrow-up3' };
  if (d >= 260) return { mark: '↑↑',  cls: 'arrow-up2' };
  if (d >= 190) return { mark: '↑',   cls: 'arrow-up1' };
  if (d >= 140) return { mark: '=',   cls: 'arrow-flat' };
  if (d >= 100) return { mark: '↓',   cls: 'arrow-dn1' };
  return                      { mark: '↓↓',  cls: 'arrow-dn2' };
}

export function timeArrow(t) {
  const ms = TIME_PER_TYPE[t] ?? 250;
  if (ms >= 800) return { mark: '↑↑↑', cls: 'arrow-up3' };
  if (ms >= 500) return { mark: '↑↑',  cls: 'arrow-up2' };
  if (ms >= 400) return { mark: '↑',   cls: 'arrow-up1' };
  if (ms >= 250) return { mark: '=',   cls: 'arrow-flat' };
  if (ms >= 150) return { mark: '↓',   cls: 'arrow-dn1' };
  return                       { mark: '↓↓',  cls: 'arrow-dn2' };
}

// Difficulty band cutoffs for the ★ rating in the running estimate.
export function diffToStars(d) {
  if (d >= 420) return '★★★★★';
  if (d >= 340) return '★★★★☆';
  if (d >= 260) return '★★★☆☆';
  if (d >= 180) return '★★☆☆☆';
  if (d >=  80) return '★☆☆☆☆';
  return '☆☆☆☆☆';
}

// ---------- Estimate model ----------
// Directional only. Time and difficulty depend on RNG, theme, and the
// interaction between difficulty band and type focus. The model is calibrated
// from the front-loaded experiments. Treat as ballpark, not commitment.
export function estimateMetrics(config) {
  const { difficulty, sampleCount, typeFocusMode, customAssignments, adaptiveMin } = config;

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
    } else {
      const avg = pool.reduce((s, t) => s + (TIME_PER_TYPE[t] ?? 250), 0) / pool.length;
      // Pooling discount — empirically: 3+ types → ~0.5× of per-type-mean,
      // because per-puzzle the focused pool stays plentiful and the
      // generator never has to fall back to the 10% deadlock floor.
      const discount = pool.length >= 4 ? 0.45
                     : pool.length === 3 ? 0.50
                     : pool.length === 2 ? 0.70
                     : 1.00;
      msPerSample = Math.max(120, Math.round(avg * discount));
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
    if (pool.length === 0) baseDiff = 220;
    else baseDiff = pool.reduce((s, t) => s + (DIFF_PER_TYPE[t] ?? 200), 0) / pool.length;
  }
  // Best-of-K boost. Empirical: chosen mean ≈ base × (1 + 0.5·log10(K)).
  // K=1 → 1.0× | K=5 → 1.35× | K=10 → 1.5× | K=25 → 1.7× | K=100 → 2.0×
  const bestOfBoost = 1 + 0.5 * Math.log10(Math.max(sampleCount, 1));
  const finalDiff = Math.round(baseDiff * bestOfBoost);

  return {
    msPerSample,
    totalMs: msPerSample * sampleCount,
    difficulty: finalDiff,
    stars: diffToStars(finalDiff),
  };
}

// ---------- Resolve engine typeFocus from UI state ----------
// generator.js accepts a string, array, or { fixed, rotate } object.
// The UI's `typeFocusMode` + `customAssignments` map to one of those forms.
export function configToEngineFocus(config) {
  if (config.typeFocusMode === 'natural') return 'natural';
  if (config.typeFocusMode === 'even') return 'even';
  // custom mode
  const fixed = ALL_TYPES.filter((t) => config.customAssignments[t] === 'fixed');
  const rotate = ALL_TYPES.filter((t) => config.customAssignments[t] === 'rotate');
  if (rotate.length > 0) return { fixed, rotate };
  if (fixed.length > 0) return fixed;
  return 'even'; // empty custom → same as even
}

// ---------- Presets ----------
// Each preset is a fully-specified config that overwrites all dash-card state
// when clicked. Notes explain why this preset exists.
export const PRESETS = {
  classic: {
    label: 'Classic',
    note: 'Balanced default — medium hard, natural type mix.',
    config: {
      difficulty: 'medium',
      priorityMode: 'balance',
      sampleCount: 10,
      typeFocusMode: 'natural',
      customAssignments: {},
      adaptiveMin: true,
    },
  },
  brutal: {
    label: 'Brutal',
    // iff/mixed/xor are the top-3 single-type-difficulty operators that
    // generate quickly. The 9 rotate-pool members each pushed p90 ≥ 640 in
    // a K=50 trio+wildcard experiment. Rotating gives each call a slightly
    // different shape, so the 100-sample run finds at least one outlier.
    note: 'iff + mixed + xor + rotating 4th from 9 hard wildcards. 100 samples.',
    config: {
      difficulty: 'hard',
      priorityMode: 'difficulty',
      sampleCount: 100,
      typeFocusMode: 'custom',
      customAssignments: {
        iff: 'fixed', mixed: 'fixed', xor: 'fixed',
        notNextTo: 'rotate', exactlyApart: 'rotate', ifThenAnd: 'rotate',
        ifThen: 'rotate', nextTo: 'rotate', oneOf: 'rotate',
        either: 'rotate', leftOf: 'rotate', immLeft: 'rotate',
      },
      adaptiveMin: true,
    },
  },
  fewClues: {
    label: 'Sparse',
    note: 'Hardest puzzles with the fewest clues. Priority = fewClues.',
    config: {
      difficulty: 'hard',
      priorityMode: 'fewClues',
      sampleCount: 25,
      typeFocusMode: 'natural',
      customAssignments: {},
      adaptiveMin: true,
    },
  },
  diverse: {
    label: 'Diverse',
    note: 'Maximize the variety of clue types. Even spread + diversity scorer.',
    config: {
      difficulty: 'hard',
      priorityMode: 'diversity',
      sampleCount: 25,
      typeFocusMode: 'even',
      customAssignments: {},
      adaptiveMin: true,
    },
  },
};

// Default config — the "normal distribution" landing point you asked for.
// Medium difficulty, balanced scoring, natural type mix, sane sample count.
// Lands at ~250 difficulty / ★★★☆☆ per the front-loaded estimates.
export const DEFAULT_CONFIG = {
  difficulty: 'medium',
  priorityMode: 'balance',
  sampleCount: 10,
  typeFocusMode: 'natural',
  customAssignments: {},
  adaptiveMin: true,
};
