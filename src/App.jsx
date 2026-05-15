import { useState, useMemo, useLayoutEffect, useRef } from 'react';

import { DEFAULT_SCRATCH_LABELS } from './utils.js';

import { canonKey } from './engine/propagation.js';
import { generatePuzzle } from './engine/generator.js';
import { computePar, metricsFor } from './engine/par.js';
import { scoreInterestingness } from './engine/scorer.js';
import { verifyMarks } from './engine/verify.js';
import { hintTier1, hintTier2, hintTier3 } from './engine/hints.js';

import { themes } from './content/themes.js';

import { useWorksheet } from './hooks/useWorksheet.js';

import { HintResult } from './ui/HintResult.jsx';
import { Metric } from './ui/Metric.jsx';
import { ClueScroll } from './ui/ClueScroll.jsx';
import { DeductionsPanel } from './ui/DeductionsPanel.jsx';
import { TraceView, OptimalTraceView } from './ui/TraceView.jsx';
import { Legend } from './ui/Legend.jsx';
import { StaircaseGrid } from './ui/StaircaseGrid.jsx';
import { SamplingPanel } from './ui/SamplingPanel.jsx';

// ============================================================
// UI
// ============================================================

export default function App() {
  const [numCategories, setNumCategories] = useState(4);
  const [numItems, setNumItems] = useState(4);

  // Ref on the pin-card that wraps the grid. Used by both the auto-fit-on-
  // generate effect and the FIT button to measure actual available width,
  // not viewport width (the grid lives inside a max-w-5xl container that's
  // narrower than the window on desktop).
  const gridPanelRef = useRef(null);
  const [themeKey, setThemeKey] = useState('soapOpera');
  const [difficulty, setDifficulty] = useState('medium');
  const [sampleCount, setSampleCount] = useState(10);
  const [puzzle, setPuzzle] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [showSolution, setShowSolution] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [showOptimalTrace, setShowOptimalTrace] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Whenever a new puzzle is loaded, measure the actual grid panel width
  // and snap zoom to it (capped at 3×). useLayoutEffect runs after the DOM
  // is updated but before paint, so the user never sees a wrong-zoom flash.
  useLayoutEffect(() => {
    if (!puzzle || !gridPanelRef.current) return;
    // Measure the actual rendered table element. We can't use the wrap's
    // scrollWidth because when the grid fits, the wrap clamps to its
    // parent's content area, so the measurement no longer reflects the
    // grid's true size — and the ratio would shrink every click.
    // The table itself doesn't overflow-clamp; offsetWidth is its real
    // rendered width including its outer border.
    const table = gridPanelRef.current.querySelector('.sc-table');
    if (!table || table.offsetWidth === 0) return;
    const available = gridPanelRef.current.clientWidth - 54;
    setGridZoom((prev) => Math.min((available / table.offsetWidth) * prev, 3));
  }, [puzzle]);

  // Worksheet state (grid marks, active tool, turns, scratch picker, zoom)
  // and operations all live in useWorksheet. App composes its own resetGrid /
  // generate around the hook's reset() to also clear hint/verify state.
  const {
    gridState, tool,
    turnNumber,
    scratchPicker, setScratchPicker,
    scratchInput, setScratchInput,
    recentLabels,
    gridZoom, setGridZoom,
    selectTool, tapCell,
    commitScratchLabel, clearScratchLabel,
    wouldEndTurn,
    reset: resetWorksheet,
  } = useWorksheet();
  const ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5, 3];

  // Hint UI state.
  const [hint, setHint] = useState(null);  // last hint response, or null
  const [verifyResult, setVerifyResult] = useState(null);

  const theme = themes[themeKey];

  const generate = () => {
    setGenerating(true);
    setShowSolution(false);
    setShowTrace(false);
    setShowOptimalTrace(false);
    resetWorksheet();
    setHint(null);
    setVerifyResult(null);
    setPuzzle(null);
    setCandidates(null);
    setProgress({ done: 0, total: sampleCount });

    const accum = [];
    let i = 0;
    const step = () => {
      try {
        const p = generatePuzzle(theme, numCategories, numItems, difficulty);
        if (p.status === 'solved') {
          p._score = scoreInterestingness(p);
          p.par = computePar(p);
          accum.push(p);
        }
      } catch (e) { /* skip bad sample */ }
      i++;
      setProgress({ done: i, total: sampleCount });
      if (i < sampleCount) {
        setTimeout(step, 0);
      } else {
        accum.sort((a, b) => b._score - a._score);
        if (accum.length === 0) {
          setGenerating(false);
          return;
        }
        setPuzzle(accum[0]);
        setCandidates(accum);
        setGenerating(false);
      }
    };
    setTimeout(step, 30);
  };


  const resetGrid = () => {
    resetWorksheet();
    setHint(null);
    setVerifyResult(null);
  };

  // Hint actions. Button tier numbers map to:
  //   1 → solvable?   (hintTier3 — yes/no/contradiction)
  //   2 → next step   (hintTier1 — first clue-driven fact)
  //   3 → proof       (hintTier2 — full DAG to next fact)
  // The nonce forces React to treat each click as a fresh result even when
  // the underlying answer is unchanged, so the hint card visibly re-fires.
  const runHint = (tier) => {
    if (!puzzle) return;
    let result;
    if (tier === 1) result = hintTier3(puzzle, gridState);
    else if (tier === 2) result = hintTier1(puzzle, gridState);
    else result = hintTier2(puzzle, gridState, null);
    result.nonce = Date.now();
    setHint(result);
    setVerifyResult(null);
  };
  const runVerify = () => {
    if (!puzzle) return;
    const result = verifyMarks(puzzle, gridState);
    result.nonce = Date.now();
    setVerifyResult(result);
    setHint(null);
  };

  const metrics = useMemo(() => puzzle ? metricsFor(puzzle) : null, [puzzle]);

  return (
    <>

      <div className="paper grain relative min-h-screen ink p-6 md:p-10 font-mono" style={{ position: 'relative' }}>
        <div className="max-w-5xl mx-auto relative" style={{ zIndex: 1 }}>

          {/* Header */}
          <header className="mb-8">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs ink-faded tracking-[0.3em] uppercase mb-1">Case File · No. 7B-12</div>
                <h1 className="font-display text-5xl md:text-6xl font-semibold leading-none ink">
                  The Deduction Engine
                </h1>
                <div className="font-display italic text-lg ink-mute mt-3 max-w-xl">
                  A generator for sprawling, uniquely-solvable logic puzzles — sample a solution, distill the minimal clue set, watch the cascade.
                </div>
              </div>
              <div className="stamp font-mono text-xs">CONFIDENTIAL</div>
            </div>
            <div className="divider mt-6"></div>
          </header>

          {/* Controls */}
          <section className="mb-8">
            <div className="text-xs ink-faded tracking-[0.25em] uppercase mb-3">Parameters</div>
            <div className="flex flex-wrap gap-6">
              <div>
                <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5">Categories</div>
                <select
                  className="ctrl-select"
                  value={numCategories}
                  onChange={(e) => setNumCategories(parseInt(e.target.value, 10))}
                >
                  {[3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5">Items per category</div>
                <select
                  className="ctrl-select"
                  value={numItems}
                  onChange={(e) => setNumItems(parseInt(e.target.value, 10))}
                >
                  {[3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5">Theme</div>
                <div className="flex gap-1 flex-wrap">
                  {Object.entries(themes).map(([k, t]) => (
                    <button key={k} className={`ctrl-btn ${themeKey === k ? 'active' : ''}`} onClick={() => setThemeKey(k)}>
                      {t.label.split('—')[0].trim()}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5">Difficulty bias</div>
                <div className="flex gap-1">
                  {['easy', 'medium', 'hard'].map((d) => (
                    <button key={d} className={`ctrl-btn ${difficulty === d ? 'active' : ''}`} onClick={() => setDifficulty(d)}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] ink-faded uppercase tracking-widest mb-1.5" title="Generate N candidates and keep the highest-scoring one.">
                  Samples
                </div>
                <div className="flex gap-1">
                  {[1, 5, 10, 25].map((n) => (
                    <button key={n} className={`ctrl-btn ${sampleCount === n ? 'active' : ''}`} onClick={() => setSampleCount(n)}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={generate} disabled={generating} className="btn-primary mt-6 font-mono text-sm">
              {generating ? `GENERATING ${progress.done}/${progress.total}...` : 'GENERATE PUZZLE'}
            </button>
          </section>

          <div className="hr-fade mb-8"></div>

          {/* Empty state */}
          {!puzzle && !generating && (
            <div className="ink-faded font-display italic text-lg max-w-xl">
              Press <span className="ink">GENERATE PUZZLE</span> to sample a fresh case. Pick a theme to taste — the engine doesn't care what skin you put on the variables.
            </div>
          )}

          {/* Puzzle output */}
          {puzzle && (
            <div className="space-y-8">
              {/* Prompt */}
              <section>
                <div className="text-xs ink-faded tracking-[0.25em] uppercase mb-2">The Brief</div>
                <p className="font-display text-2xl ink leading-snug">{theme.prompt}</p>
              </section>

              {/* Clues */}
              <section>
                <div className="flex items-baseline justify-between mb-3">
                  <div className="text-xs ink-faded tracking-[0.25em] uppercase">Evidence — {puzzle.clues.length} clues</div>
                  <div className="text-[11px] ink-faded font-mono">minimal set; each clue is load-bearing</div>
                </div>
                <ol className="space-y-2">
                  {puzzle.clues.map((c, i) => (
                    <li key={i} className="pin-card-tight p-3 flex gap-3 items-start">
                      <span className="ink-red font-bold text-xs mt-0.5 min-w-[28px]">№{String(i + 1).padStart(2, '0')}</span>
                      <span className="ink text-sm leading-relaxed">{theme.renderClue(c)}</span>
                      <span className="ml-auto text-[10px] ink-faded uppercase tracking-widest shrink-0">{c.type}</span>
                    </li>
                  ))}
                </ol>
              </section>

              {/* Worksheet grid */}
              <section>
                <div className="flex items-baseline justify-between mb-3 gap-4 flex-wrap">
                  <div>
                    <div className="text-xs ink-faded tracking-[0.25em] uppercase">Worksheet</div>
                    <div className="text-[11px] ink-faded font-mono mt-0.5">
                      pick a tool — tap cells to mark
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="turn-counter">
                      <span className="text-[10px] ink-faded uppercase tracking-widest mr-1.5">Turn</span>
                      <span className="font-display text-xl ink leading-none">{turnNumber}</span>
                      <span className="text-[10px] ink-faded uppercase tracking-widest mx-1.5">/ par</span>
                      <span className={`font-display text-xl leading-none ${turnNumber > puzzle.par ? 'ink-red' : 'ink'}`}>{puzzle.par}</span>
                    </div>
                    <button className="ctrl-btn" onClick={resetGrid}>reset</button>
                  </div>
                </div>

                {/* Tool palette */}
                <div className="pin-card-tight p-2 mb-3 flex gap-2 items-center flex-wrap">
                  <span className="text-[10px] ink-faded uppercase tracking-widest mr-1">Tool:</span>
                  <button
                    className={`tool-btn ${tool === 'x' ? 'active tool-x' : ''} ${wouldEndTurn('x') ? 'ends-turn' : ''}`}
                    onClick={() => selectTool('x')}
                    aria-label="X tool (eliminate)"
                  >
                    <span className="tool-glyph">✕</span>
                    <span className="tool-name">eliminate</span>
                    {wouldEndTurn('x') && <span className="end-turn-pip">+1</span>}
                  </button>
                  <button
                    className={`tool-btn ${tool === 'check' ? 'active tool-check' : ''} ${wouldEndTurn('check') ? 'ends-turn' : ''}`}
                    onClick={() => selectTool('check')}
                    aria-label="Check tool (confirm)"
                  >
                    <span className="tool-glyph">✓</span>
                    <span className="tool-name">confirm</span>
                    {wouldEndTurn('check') && <span className="end-turn-pip">+1</span>}
                  </button>
                  <button
                    className={`tool-btn ${tool === 'scratch' ? 'active tool-scratch' : ''}`}
                    onClick={() => selectTool('scratch')}
                    aria-label="Scratch tool (label)"
                  >
                    <span className="tool-glyph">··</span>
                    <span className="tool-name">scratch</span>
                  </button>
                </div>

                {/* Hint cluster */}
                <div className="pin-card-tight p-2 mb-3 flex gap-2 items-center flex-wrap">
                  <span className="text-[10px] ink-faded uppercase tracking-widest mr-1">Stuck?</span>
                  <button className="ctrl-btn" onClick={() => runHint(1)}>tier 1 · solvable?</button>
                  <button className="ctrl-btn" onClick={() => runHint(2)}>tier 2 · next step</button>
                  <button className="ctrl-btn" onClick={() => runHint(3)}>tier 3 · proof</button>
                  <button className="ctrl-btn" onClick={runVerify}>verify marks</button>
                </div>

                {/* Hint / verify result */}
                {verifyResult && (
                  <div key={verifyResult.nonce} className="pin-card p-3 mb-3 hint-result hint-flash">
                    {verifyResult.status === 'all-consistent' ? (
                      <div className="ink text-sm">
                        <span className="stamp text-[10px] mr-2">VERIFIED</span>
                        All your marks are consistent with the solution so far.
                      </div>
                    ) : (
                      <div className="ink text-sm">
                        <span className="stamp text-[10px] mr-2">RETRACTION</span>
                        <strong className="ink-red">{verifyResult.count}</strong> of your marks {verifyResult.count === 1 ? 'is' : 'are'} incorrect.
                      </div>
                    )}
                  </div>
                )}
                {hint && (
                  <div key={hint.nonce} className="pin-card p-3 mb-3 hint-result hint-flash">
                    <HintResult hint={hint} theme={theme} />
                  </div>
                )}

                <Legend categories={puzzle.categories} anchorKey={puzzle.anchorKey} />
                <ClueScroll clues={puzzle.clues} theme={theme} />
                <div ref={gridPanelRef} className="mt-3 pin-card p-3">
                  <div className="flex items-center justify-end mb-2 gap-2">
                    <div className="zoom-ctrl">
                      <button
                        onClick={() => {
                          // Coarse step down: largest preset strictly less than current.
                          const prev = [...ZOOM_STEPS].reverse().find((z) => z < gridZoom);
                          if (prev !== undefined) setGridZoom(prev);
                        }}
                        disabled={gridZoom <= ZOOM_STEPS[0]}
                        aria-label="zoom out"
                      >−</button>
                      <span className="zoom-label">{(+gridZoom.toFixed(2))}×</span>
                      <button
                        onClick={() => {
                          // Coarse step up: smallest preset strictly greater than current.
                          const next = ZOOM_STEPS.find((z) => z > gridZoom);
                          if (next !== undefined) setGridZoom(next);
                        }}
                        disabled={gridZoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                        aria-label="zoom in"
                      >+</button>
                      <button
                        className="zoom-fit-btn"
                        onClick={() => {
                          if (!gridPanelRef.current) return;
                          const table = gridPanelRef.current.querySelector('.sc-table');
                          if (!table || table.offsetWidth === 0) return;
                          const available = gridPanelRef.current.clientWidth - 54;
                          setGridZoom((prev) => Math.min((available / table.offsetWidth) * prev, 3));
                        }}
                        aria-label="fit to width"
                        title="fit grid to panel width"
                      >fit</button>
                    </div>
                  </div>
                  <StaircaseGrid
                    puzzle={puzzle}
                    gridState={gridState}
                    onTap={tapCell}
                    scratchMode={tool === 'scratch'}
                    activeTool={tool}
                    zoom={gridZoom}
                  />
                </div>
              </section>

              {/* Deductions — prose summary per subject + case-status stamp */}
              <DeductionsPanel puzzle={puzzle} gridState={gridState} theme={theme} />

              {/* Metrics */}
              <section>
                <div className="text-xs ink-faded tracking-[0.25em] uppercase mb-3">Trace Profile</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Metric label="Propagation passes" value={metrics.passes} note="depth of deduction" />
                  <Metric label="Total derivations" value={metrics.totalDerivations} note="facts the solver inferred" />
                  <Metric label="From clue→table" value={metrics.bySource.clue} note="direct clue applications" />
                  <Metric label="From propagation" value={metrics.bySource.exclusivity + metrics.bySource.transitivity + metrics.bySource['last-option']} note="exclusivity + transitivity + last-option" />
                </div>
                <div className="mt-3 text-xs ink-faded font-mono">
                  Clue mix: {Object.entries(metrics.byClueType).map(([k, v]) => `${k}×${v}`).join(' · ')}
                </div>
              </section>

              {/* Sampling stats */}
              {candidates && candidates.length > 0 && (
                <SamplingPanel candidates={candidates} selected={puzzle} />
              )}

              {/* Solution toggle */}
              <section>
                <div className="flex gap-2 mb-3 flex-wrap">
                  <button className={`ctrl-btn ${showSolution ? 'active' : ''}`} onClick={() => setShowSolution((s) => !s)}>
                    {showSolution ? 'hide solution' : 'reveal solution'}
                  </button>
                  <button className={`ctrl-btn ${showOptimalTrace ? 'active' : ''}`} onClick={() => setShowOptimalTrace((s) => !s)}>
                    {showOptimalTrace ? 'hide optimal trace' : 'show optimal trace'}
                  </button>
                  <button className={`ctrl-btn ${showTrace ? 'active' : ''}`} onClick={() => setShowTrace((s) => !s)}>
                    {showTrace ? 'hide full trace' : 'show full trace'}
                  </button>
                </div>

                {showSolution && (
                  <div className="pin-card p-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          {Object.keys(puzzle.categories).map((cat) => (
                            <th key={cat} className="text-left ink-faded uppercase text-[10px] tracking-widest pb-2 pr-4">{cat}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {puzzle.solution.map((row, i) => (
                          <tr key={i} className="border-t border-[#c8b48a]/50">
                            {Object.keys(puzzle.categories).map((cat) => (
                              <td key={cat} className="py-2 pr-4 ink">{row[cat]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {showOptimalTrace && (
                  <div className="pin-card p-4 mt-3 max-h-96 overflow-y-auto">
                    <OptimalTraceView puzzle={puzzle} theme={theme} />
                  </div>
                )}

                {showTrace && (
                  <div className="pin-card p-4 mt-3 max-h-96 overflow-y-auto">
                    <TraceView puzzle={puzzle} theme={theme} />
                  </div>
                )}
              </section>

              {/* Notes */}
              <section className="pt-4">
                <div className="hr-fade mb-4"></div>
                <div className="text-xs ink-faded italic font-display leading-relaxed max-w-3xl">
                  Notes from the field: the engine samples a random bijection, enumerates every true statement of each clue type, then greedily adds clues until propagation alone collapses the puzzle to one solution. It then runs three minimization passes — dropping any clue whose absence still permits solving — leaving you with a tight, load-bearing set. Difficulty bias weights the candidate ordering toward Is-clues (easy) or relational/Not-clues (hard); the actual difficulty is observable in the trace profile, not declared up front.
                </div>
              </section>
            </div>
          )}

          <footer className="mt-16 pt-6 border-t border-[#8a7960]/40 text-[10px] ink-faded uppercase tracking-[0.25em] flex justify-between">
            <span>Deduction Engine · v0.1</span>
            <span>filed for review</span>
          </footer>
        </div>
      </div>
      {scratchPicker && (
        <div
          className="scratch-picker-backdrop"
          onClick={() => setScratchPicker(null)}
        >
          <div
            className="scratch-picker pin-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] ink-faded uppercase tracking-widest mb-2">
              {scratchPicker.editing ? 'Edit scratch label' : 'New scratch label'}
            </div>
            <div className="text-[11px] ink-faded mb-3 italic">
              {scratchPicker.editing
                ? 'Change the label, or clear it.'
                : 'Pick a 1–2 character note. Engine ignores these — they\'re just for you.'}
            </div>
            <input
              autoFocus
              className="scratch-input font-mono"
              type="text"
              maxLength={2}
              value={scratchInput}
              onChange={(e) => setScratchInput(e.target.value.slice(0, 2))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitScratchLabel(scratchInput);
                if (e.key === 'Escape') setScratchPicker(null);
              }}
              placeholder="e.g. 1, A, ?"
            />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(recentLabels.length > 0 ? recentLabels : DEFAULT_SCRATCH_LABELS).map((l) => (
                <button
                  key={l}
                  className="chip-btn font-mono"
                  onClick={() => commitScratchLabel(l)}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2 flex-wrap">
              {scratchPicker.editing && (
                <button className="ctrl-btn ctrl-btn-warn" onClick={clearScratchLabel}>
                  remove
                </button>
              )}
              <button className="ctrl-btn" onClick={() => setScratchPicker(null)}>cancel</button>
              <button
                className="btn-primary text-xs"
                onClick={() => commitScratchLabel(scratchInput)}
                disabled={!scratchInput}
              >
                {scratchPicker.editing ? 'save' : 'place'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

