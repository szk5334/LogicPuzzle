// DashCard — the puzzle-shaping control panel. View-only; pure logic
// (lookup tables, estimates, config-derivation, presets) lives in
// dashCardLogic.js so it's testable from Node without a JSX runtime.
//
// Props:
//   config:   the full dash-card state (see DEFAULT_CONFIG)
//   onChange: setter — receives the next full config object

import { PRIORITY_MODES, PRIORITY_MODE_LABELS, BAND_CAPS } from '../engine/scorer.js';
import {
  ALL_TYPES,
  TIME_PER_TYPE,
  DIFF_PER_TYPE,
  diffArrow,
  timeArrow,
  PRESETS,
  PRESET_GROUPS,
  SAMPLE_COUNTS,
} from './dashCardLogic.js';

// Re-export commonly imported pieces so App.jsx can import everything from
// './UI/DashCard.jsx' as before. estimateMetrics is still exported for
// programmatic callers, even though the UI no longer displays an estimate
// inline — it remains available for future curation tooling.
export { configToEngineFocus, DEFAULT_CONFIG, estimateMetrics, PRESETS, ALL_TYPES } from './dashCardLogic.js';

// ----------------------------------------------------------------------------
// UI MODE FLAG
// ----------------------------------------------------------------------------
// The simplified player-facing surface is four band buttons: Easy / Medium /
// Hard / Brutal, all using natural type distribution and band-capped scoring.
// To re-enable the full customization UI (priority dropdown, type-focus
// checklist, presets group, sample count, adaptive-min toggle), flip this to
// true. All advanced state and logic is preserved — only the rendering is
// gated.
const SHOW_ADVANCED = false;

// The four simplified band buttons. Each maps 1:1 to a natural-distribution
// preset key in dashCardLogic.PRESETS.
const BAND_BUTTONS = [
  { presetKey: 'naturalEasy',   label: 'Easy',   range: '≤200'    },
  { presetKey: 'naturalMedium', label: 'Medium', range: '201–300' },
  { presetKey: 'naturalHard',   label: 'Hard',   range: '301–400' },
  { presetKey: 'naturalBrutal', label: 'Brutal', range: '400+'    },
];

export function DashCard({ config, onChange }) {
  if (!SHOW_ADVANCED) {
    return <SimplifiedDashCard config={config} onChange={onChange} />;
  }
  return <AdvancedDashCard config={config} onChange={onChange} />;
}

// ----------------------------------------------------------------------------
// Simplified view — four band buttons, nothing else. The active button is the
// one whose priorityMode matches the current config. Clicking overwrites the
// whole config from the preset.
// ----------------------------------------------------------------------------
function SimplifiedDashCard({ config, onChange }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5">Difficulty</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {BAND_BUTTONS.map(({ presetKey, label, range }) => {
          const preset = PRESETS[presetKey];
          const active = config.priorityMode === preset.config.priorityMode;
          return (
            <button
              key={presetKey}
              className={`ctrl-btn flex flex-col items-center justify-center py-3 ${active ? 'active' : ''}`}
              title={preset.note}
              onClick={() => onChange({ ...preset.config })}
            >
              <span className="text-base font-bold leading-tight">{label}</span>
              <span className="ink-faded text-[10px] mt-0.5">{range}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Advanced view — the full customization surface (presets grouped curated +
// natural, difficulty band, priority mode, sample count, type focus mode,
// custom type checklist, adaptive minimization). Preserved unchanged behind
// SHOW_ADVANCED for power-user iteration and future curation work.
// ----------------------------------------------------------------------------
function AdvancedDashCard({ config, onChange }) {
  const set = (patch) => onChange({ ...config, ...patch });

  // Cycle a single type through off → fixed → rotate → off. Deletes the key
  // when going back to 'off' so configToEngineFocus sees a clean assignment
  // map (no stale 'off' entries to filter).
  const cycleAssignment = (t) => {
    const cur = config.customAssignments[t] || 'off';
    const next = cur === 'off' ? 'fixed' : cur === 'fixed' ? 'rotate' : 'off';
    const newAssign = { ...config.customAssignments };
    if (next === 'off') delete newAssign[t];
    else newAssign[t] = next;
    set({ customAssignments: newAssign });
  };

  const fixedCount = Object.values(config.customAssignments).filter((v) => v === 'fixed').length;
  const rotateCount = Object.values(config.customAssignments).filter((v) => v === 'rotate').length;

  return (
    <div className="space-y-4 text-sm">

      {/* Presets — clicking overwrites the entire config. Two groups:
          Curated (verified 4-type combos targeting specific difficulty bands)
          and Natural (no type restriction, difficulty band drives WEIGHTS). */}
      <div>
        <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5">Presets — curated</div>
        <div className="flex gap-1 flex-wrap mb-2">
          {PRESET_GROUPS.curated.map((key) => {
            const preset = PRESETS[key];
            const cap = BAND_CAPS[preset.config.priorityMode];
            const capLabel = cap === Infinity ? '∞' : cap;
            return (
              <button
                key={key}
                className="ctrl-btn"
                title={`${preset.note}\nCap: ${capLabel}`}
                onClick={() => onChange({ ...preset.config })}
              >
                {preset.label}
                <span className="ink-faded ml-1 text-[10px]">≤{capLabel}</span>
              </button>
            );
          })}
        </div>
        <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5">Presets — natural</div>
        <div className="flex gap-1 flex-wrap">
          {PRESET_GROUPS.natural.map((key) => {
            const preset = PRESETS[key];
            const cap = BAND_CAPS[preset.config.priorityMode];
            const capLabel = cap === Infinity ? '∞' : cap;
            return (
              <button
                key={key}
                className="ctrl-btn"
                title={`${preset.note}\nCap: ${capLabel}`}
                onClick={() => onChange({ ...preset.config })}
              >
                {preset.label}
                <span className="ink-faded ml-1 text-[10px]">≤{capLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Difficulty band — drives per-type WEIGHTS when typeFocusMode is natural */}
      <div>
        <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5">Difficulty</div>
        <div className="flex gap-1">
          {['easy', 'medium', 'hard'].map((d) => (
            <button
              key={d}
              className={`ctrl-btn ${config.difficulty === d ? 'active' : ''}`}
              onClick={() => set({ difficulty: d })}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Priority mode — what the scorer optimizes when picking best-of-N */}
      <div>
        <div
          className="text-[11px] ink-faded uppercase tracking-widest mb-1.5"
          title="What the scorer optimizes when picking the best of N samples."
        >
          Priority
        </div>
        <select
          className="ctrl-btn w-full"
          value={config.priorityMode}
          onChange={(e) => set({ priorityMode: e.target.value })}
        >
          {PRIORITY_MODES.map((m) => (
            <option key={m} value={m}>{PRIORITY_MODE_LABELS[m]}</option>
          ))}
        </select>
      </div>

      {/* Sample count — N for the best-of-N sampling loop */}
      <div>
        <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5">Samples</div>
        <div className="flex gap-1 flex-wrap">
          {SAMPLE_COUNTS.map((n) => (
            <button
              key={n}
              className={`ctrl-btn ${config.sampleCount === n ? 'active' : ''}`}
              onClick={() => set({ sampleCount: n })}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Type focus mode */}
      <div>
        <div
          className="text-[11px] ink-faded uppercase tracking-widest mb-1.5"
          title="How clue types are weighted during selection. Natural uses the difficulty band's WEIGHTS; Even ignores them; Custom lets you fix/rotate specific types."
        >
          Type focus
        </div>
        <div className="flex gap-1">
          {[
            ['natural', 'Natural'],
            ['even', 'Even'],
            ['custom', 'Custom'],
          ].map(([k, label]) => (
            <button
              key={k}
              className={`ctrl-btn ${config.typeFocusMode === k ? 'active' : ''}`}
              onClick={() => set({ typeFocusMode: k })}
            >
              {label}
            </button>
          ))}
        </div>
        {config.typeFocusMode === 'custom' && (
          <div className="text-[11px] ink-faded mt-1 font-mono">
            {fixedCount > 0 && `${fixedCount} fixed`}
            {fixedCount > 0 && rotateCount > 0 && ' · '}
            {rotateCount > 0 && `${rotateCount} rotating`}
            {fixedCount === 0 && rotateCount === 0 && 'no types selected — falls back to Even'}
          </div>
        )}
      </div>

      {/* Custom type checklist — tap to cycle each type's role.
          Shown only when typeFocusMode === 'custom'. */}
      {config.typeFocusMode === 'custom' && (
        <div className="border border-current/10 rounded p-2 max-h-72 overflow-y-auto">
          <div className="text-[10px] ink-faded mb-1 font-mono">
            Tap to cycle: off → fixed → rotate → off. Fixed = always in puzzle. Rotate = one drawn per puzzle.
          </div>
          <div className="grid grid-cols-1 gap-0.5">
            {ALL_TYPES.map((t) => {
              const state = config.customAssignments[t] || 'off';
              const d = diffArrow(t);
              const tm = timeArrow(t);
              const stateClass =
                state === 'fixed' ? 'active'
                : state === 'rotate' ? 'active opacity-60'
                : '';
              const stateLabel = state === 'fixed' ? 'FIX' : state === 'rotate' ? 'ROT' : '·';
              return (
                <button
                  key={t}
                  className={`ctrl-btn ${stateClass} flex justify-between items-center text-xs`}
                  onClick={() => cycleAssignment(t)}
                  title={`${t} · diff: ${DIFF_PER_TYPE[t]} · time: ${TIME_PER_TYPE[t]}ms`}
                >
                  <span className="font-mono text-left flex-1">{t}</span>
                  <span className={`font-mono mx-2 ${d.cls}`} title="difficulty effect">{d.mark}</span>
                  <span className={`font-mono mx-2 ${tm.cls}`} title="time effect">{tm.mark}</span>
                  <span className="font-mono w-8 text-right">{stateLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Adaptive minimization — ~2% speedup, no quality cost */}
      <div>
        <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5">Adaptive minimization</div>
        <button
          className={`ctrl-btn ${config.adaptiveMin ? 'active' : ''}`}
          onClick={() => set({ adaptiveMin: !config.adaptiveMin })}
        >
          {config.adaptiveMin ? 'on' : 'off'}
        </button>
        <span className="text-[10px] ink-faded ml-2 font-mono">
          early-exit zero-drop minimizer passes (~2% faster)
        </span>
      </div>
    </div>
  );
}
