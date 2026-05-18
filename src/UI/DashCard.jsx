// DashCard — the puzzle-shaping control panel. View-only; pure logic
// (lookup tables, estimates, config-derivation, presets) lives in
// dashCardLogic.js so it's testable from Node without a JSX runtime.
//
// Props:
//   config:   the full dash-card state (see DEFAULT_CONFIG)
//   onChange: setter — receives the next full config object

import { useMemo } from 'react';
import { PRIORITY_MODES, PRIORITY_MODE_LABELS, BAND_CAPS } from '../engine/scorer.js';
import {
  ALL_TYPES,
  TIME_PER_TYPE,
  DIFF_PER_TYPE,
  diffArrow,
  timeArrow,
  estimateMetrics,
  PRESETS,
  PRESET_GROUPS,
  SAMPLE_COUNTS,
} from './dashCardLogic.js';

// Re-export commonly imported pieces so App.jsx can import everything from
// './UI/DashCard.jsx' as before.
export { configToEngineFocus, DEFAULT_CONFIG, estimateMetrics, PRESETS, ALL_TYPES } from './dashCardLogic.js';

export function DashCard({ config, onChange }) {
  const estimate = useMemo(() => estimateMetrics(config), [config]);
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

      {/* Running estimate — recomputes from lookup tables whenever config changes */}
      <div className="border-t border-current/15 pt-3 mt-2">
        <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5">Estimate</div>
        <div className="font-mono text-xs space-y-0.5">
          <div>
            ~{estimate.msPerSample}ms × {config.sampleCount} samples =
            <span className="ink ml-1">
              ~{estimate.totalMs >= 1000 ? `${(estimate.totalMs / 1000).toFixed(1)}s` : `${estimate.totalMs}ms`}
            </span>
          </div>
          <div>
            difficulty: <span className="ink">{estimate.stars}</span>
            <span className="ink-faded ml-2">(~{estimate.difficulty})</span>
          </div>
        </div>
      </div>
    </div>
  );
}
