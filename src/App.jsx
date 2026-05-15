import { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';

import { capit, shortLabel, TOOLS, DEFAULT_SCRATCH_LABELS } from './utils.js';

import { canonKey } from './engine/propagation.js';
import { generatePuzzle } from './engine/generator.js';
import { computePar, metricsFor } from './engine/par.js';
import { scoreInterestingness } from './engine/scorer.js';
import { verifyMarks } from './engine/verify.js';
import { entityStatus, puzzleStatus } from './engine/deductions.js';
import { hintTier1, hintTier2, hintTier3 } from './engine/hints.js';

import { themes } from './content/themes.js';

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

  // Grid state: keyed by canonKey, value = { catA, a, catB, b, committed: 'x'|'check'|null, scratch: string|null }.
  // Coordinates stored inline so we never have to decode canonKey to iterate.
  const [gridState, setGridState] = useState({});

  // Active tool. 'x' / 'check' / 'scratch'.
  const [tool, setTool] = useState('x');

  // Turn mechanics (Phase 2: golf scoring).
  // A "turn" is bounded by a single committed-tool type. Switching between X and ✓
  // mid-turn (when committed changes have been made) ends the turn and advances the counter.
  // Scratch is always free.
  const [turnNumber, setTurnNumber] = useState(1);
  const [turnStartGrid, setTurnStartGrid] = useState({});      // committed-layer snapshot at turn start
  const [lastCommittedTool, setLastCommittedTool] = useState(null); // the X/✓ that "owns" this turn

  // Scratch label picker state. When a player taps a blank cell in scratch mode,
  // we open a tiny picker overlay anchored to that cell.
  // `editing` is true when the cell already has a scratch label being edited.
  const [scratchPicker, setScratchPicker] = useState(null); // { key, catA, a, catB, b, editing } or null
  const [scratchInput, setScratchInput] = useState('');
  const [recentLabels, setRecentLabels] = useState([]); // most-recent first, capped

  // Grid zoom — multiplier applied to all grid dimensions via CSS variable.
  // Default 1 fits a small phone; up to 3 for inspection.
  const [gridZoom, setGridZoom] = useState(1);
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
    setGridState({});
    setHint(null);
    setVerifyResult(null);
    setPuzzle(null);
    setCandidates(null);
    setTurnNumber(1);
    setTurnStartGrid({});
    setLastCommittedTool(null);
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

  // Returns true if the committed layer differs between two grid states.
  // Only X/✓ marks matter for turn-locking — scratch changes are free.
  const committedDiffers = (gridA, gridB) => {
    const allKeys = new Set([...Object.keys(gridA), ...Object.keys(gridB)]);
    for (const k of allKeys) {
      const a = gridA[k]?.committed ?? null;
      const b = gridB[k]?.committed ?? null;
      if (a !== b) return true;
    }
    return false;
  };

  // Tool selection with turn semantics.
  // Scratch is a "transparent" overlay over your current committed tool:
  //   - Going INTO scratch is always free; lastCommittedTool is preserved.
  //   - Going OUT of scratch to a committed tool follows the X⇄✓ rule against lastCommittedTool.
  //   - Direct X⇄✓ swap is the same rule.
  // The rule: if the new committed tool differs from lastCommittedTool AND
  // the committed layer has changed since turn-start, advance the turn.
  const selectTool = (newTool) => {
    if (newTool === tool) return;

    // Going into scratch: always free.
    if (newTool === 'scratch') {
      setTool('scratch');
      return;
    }

    // From here, newTool is 'x' or 'check'.
    if (lastCommittedTool === null) {
      // First commitment claim ever.
      setTool(newTool);
      setLastCommittedTool(newTool);
      return;
    }

    if (newTool === lastCommittedTool) {
      // Returning to this turn's claimed tool (e.g., scratch → x where lastCommittedTool='x').
      setTool(newTool);
      return;
    }

    // newTool is a committed tool that differs from lastCommittedTool — this is a true swap.
    if (committedDiffers(gridState, turnStartGrid)) {
      setTurnNumber((n) => n + 1);
      setTurnStartGrid(gridState);
      setLastCommittedTool(newTool);
      setTool(newTool);
    } else {
      setLastCommittedTool(newTool);
      setTool(newTool);
    }
  };

  // Helper: produce updated cell value, or null to delete the cell entirely.
  const updateCell = (key, catA, a, catB, b, mutator) => {
    setGridState((prev) => {
      const cur = prev[key] || { catA, a, catB, b, committed: null, scratch: null };
      const next = mutator(cur);
      const out = { ...prev };
      if (!next || (next.committed == null && next.scratch == null)) {
        delete out[key];
      } else {
        out[key] = next;
      }
      return out;
    });
    // Hint/verify panels intentionally PERSIST across mark actions — the
    // player asked for them and may keep referring back. They're cleared
    // only when a new hint is run, the grid is reset, or the puzzle is
    // regenerated.
  };

  // Whether the active tool is allowed to touch a given cell.
  // X tool: cells with committed in {null, 'x'} only.
  // ✓ tool: cells with committed in {null, 'check'} only.
  // Scratch: always.
  const canModifyCell = (cell) => {
    if (tool === 'scratch') return true;
    const c = cell?.committed ?? null;
    if (tool === 'x') return c === null || c === 'x';
    if (tool === 'check') return c === null || c === 'check';
    return false;
  };

  const tapCell = (catA, a, catB, b) => {
    const key = canonKey(catA, a, catB, b);
    const cur = gridState[key];

    // Phase 2: cell restriction by active tool.
    if (!canModifyCell(cur)) return;

    // First committed-tool action ever: claim the turn's tool.
    if ((tool === 'x' || tool === 'check') && lastCommittedTool === null) {
      setLastCommittedTool(tool);
    }

    if (tool === 'x') {
      updateCell(key, catA, a, catB, b, (c) => ({
        ...c,
        committed: c.committed === 'x' ? null : 'x',
      }));
      return;
    }
    if (tool === 'check') {
      updateCell(key, catA, a, catB, b, (c) => ({
        ...c,
        committed: c.committed === 'check' ? null : 'check',
      }));
      return;
    }
    // scratch: tap opens picker. If a label already exists, picker pre-fills for editing.
    if (cur && cur.scratch) {
      setScratchInput(cur.scratch);
      setScratchPicker({ key, catA, a, catB, b, editing: true });
    } else {
      setScratchInput('');
      setScratchPicker({ key, catA, a, catB, b, editing: false });
    }
  };

  const commitScratchLabel = (label) => {
    if (!scratchPicker) return;
    const clean = String(label).slice(0, 2);
    if (!clean) { setScratchPicker(null); return; }
    const { key, catA, a, catB, b } = scratchPicker;
    updateCell(key, catA, a, catB, b, (c) => ({ ...c, scratch: clean }));
    setRecentLabels((prev) => {
      const without = prev.filter((l) => l !== clean);
      return [clean, ...without].slice(0, 6);
    });
    setScratchPicker(null);
    setScratchInput('');
  };

  // Clear the scratch label of the cell currently being edited.
  const clearScratchLabel = () => {
    if (!scratchPicker) return;
    const { key, catA, a, catB, b } = scratchPicker;
    updateCell(key, catA, a, catB, b, (c) => ({ ...c, scratch: null }));
    setScratchPicker(null);
    setScratchInput('');
  };

  const resetGrid = () => {
    setGridState({});
    setHint(null);
    setVerifyResult(null);
    setTurnNumber(1);
    setTurnStartGrid({});
    setLastCommittedTool(null);
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
                {(() => {
                  const turnLocked = lastCommittedTool !== null && committedDiffers(gridState, turnStartGrid);
                  const wouldEndTurn = (target) =>
                    turnLocked && target !== 'scratch' && target !== lastCommittedTool;
                  return (
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
                  );
                })()}

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

// ============================================================
// Hint result rendering
// ============================================================

// Render a fact in theme-aware prose. Uses theme.propLine like the trace view.
function factSentence(fact, theme) {
  return capit(theme.propLine(fact.catA, fact.a, fact.catB, fact.b, fact.value));
}

// Describe a cascade step in a single readable phrase.
function cascadePhrase(kind) {
  if (kind === 'exclusivity') return 'by exclusivity';
  if (kind === 'transitivity') return 'by transitivity';
  if (kind === 'last-option') return 'only that option remains';
  return kind;
}

function HintResult({ hint, theme }) {
  // Contradiction routes (Tier 1/2/3 all use this when player marks contradict).
  if (hint.contradiction) {
    return (
      <div className="ink text-sm leading-relaxed">
        <span className="hint-tag">tier {hint.tier}</span>
        Your marks contradict the clues. You have{' '}
        <strong className="ink-red">{hint.count}</strong> incorrect{' '}
        {hint.count === 1 ? 'mark' : 'marks'}. Reset and rethink, or look for a wrong ✕ or ✓.
      </div>
    );
  }

  if (hint.tier === 2) {
    if (hint.complete) {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 2 · complete</span>
          No next step needed. Your check marks determine every remaining cell by exclusivity — the puzzle is solved. Filling in the X's is optional cleanup.
        </div>
      );
    }
    if (hint.noProgress) {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 2</span>
          No clue-driven next step from here. Either you've extracted everything the clues offer — in which case just keep propagating exclusivity through your committed marks — or try Tier 3 to see a proof for a specific cell.
        </div>
      );
    }
    if (hint.wrongMarks) {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 2</span>
          No clue-driven progress is possible, and you have{' '}
          <strong className="ink-red">{hint.count}</strong> incorrect{' '}
          {hint.count === 1 ? 'mark' : 'marks'} blocking it. Use <em>verify marks</em> to locate them.
        </div>
      );
    }
    return (
      <div className="ink text-sm leading-relaxed">
        <span className="hint-tag">tier 2 · next step</span>
        <strong>{factSentence(hint.fact, theme)}.</strong>{' '}
        {hint.originClue && (
          <>
            <span className="ink-faded">— follows from </span>
            <em>"{theme.renderClue(hint.originClue)}"</em>
          </>
        )}
      </div>
    );
  }

  if (hint.tier === 3) {
    if (hint.complete) {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 3 · complete</span>
          Nothing left to prove. Your check marks determine every remaining fact by exclusivity — the puzzle is solved.
        </div>
      );
    }
    if (hint.noProgress) {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 3</span>
          No new deduction is currently reachable from your marks. The clues may already be exhausted — try propagating exclusivity through your existing committed cells row by row.
        </div>
      );
    }
    if (hint.wrongMarks) {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 3</span>
          No new deduction is reachable, and you have{' '}
          <strong className="ink-red">{hint.count}</strong> incorrect{' '}
          {hint.count === 1 ? 'mark' : 'marks'} blocking progress. Use <em>verify marks</em> to locate them.
        </div>
      );
    }
    if (hint.focusUnreachable) {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 3</span>
          That cell isn't derivable from your current state. Either it's already determined by your marks, or you need to lay more groundwork first.
        </div>
      );
    }
    // hint.dag is topologically ordered: dependencies first, target last.
    // The FINAL step is the conclusion's own derivation — we pull its rule and
    // direct inputs up into a prose headline, then render the upstream steps
    // as supporting evidence (how each input was established).
    const steps = hint.dag;
    const final = steps[steps.length - 1];
    const supporting = steps.slice(0, -1);

    // Headline reads as: "By <rule>: <input>, <input>, therefore <conclusion>."
    let headline;
    if (final.kind === 'cascade') {
      const inputs = [final.from, ...final.deps].filter(Boolean);
      const prefix = final.cascadeType === 'last-option'
        ? 'By elimination'
        : `By ${final.cascadeType}`;
      headline = (
        <>
          <em>{prefix}:</em>{' '}
          {inputs.map((d, i) => (
            <span key={i}>
              {i > 0 ? ', ' : ''}
              <em>{factSentence(d, theme)}</em>
            </span>
          ))}
          , therefore <strong>{factSentence(final.fact, theme)}</strong>.
        </>
      );
    } else if (final.kind === 'clue') {
      headline = (
        <>
          <em>By clue "{theme.renderClue(final.clue)}"</em>
          {final.deps.length > 0 && (
            <>
              {', given '}
              {final.deps.map((d, i) => (
                <span key={i}>
                  {i > 0 ? ', ' : ''}
                  <em>{factSentence(d, theme)}</em>
                </span>
              ))}
            </>
          )}
          {': '}<strong>{factSentence(final.fact, theme)}</strong>.
        </>
      );
    } else {
      headline = <strong>{factSentence(hint.fact, theme)}</strong>;
    }

    return (
      <div className="ink text-sm leading-relaxed">
        <span className="hint-tag">tier 3 · proof</span>
        <div>{headline}</div>
        {supporting.length > 0 && (
          <>
            <div className="mt-2 ink-faded text-xs uppercase tracking-widest mb-1">
              Chain that established those inputs:
            </div>
            <div className="space-y-1 text-sm">
              {supporting.map((s, i) => {
                if (s.kind === 'clue') {
                  return (
                    <div key={i} className="proof-step">
                      <em>Clue:</em> "{theme.renderClue(s.clue)}" — gives{' '}
                      <strong>{factSentence(s.fact, theme)}</strong>
                      {s.deps.length > 0 && (
                        <span className="ink-faded">
                          {' '}(given{' '}
                          {s.deps.map((d, j) => (
                            <span key={j}>
                              {j > 0 ? ', ' : ''}
                              <em>{factSentence(d, theme)}</em>
                            </span>
                          ))}
                          )
                        </span>
                      )}
                    </div>
                  );
                }
                if (s.kind === 'mark') {
                  return (
                    <div key={i} className="proof-step">
                      <span className="ink-red">Your mark:</span>{' '}
                      <strong>{factSentence(s.fact, theme)}</strong>
                    </div>
                  );
                }
                if (s.kind === 'given') {
                  return (
                    <div key={i} className="proof-step ink-faded">
                      Given: <strong>{factSentence(s.fact, theme)}</strong>
                    </div>
                  );
                }
                // cascade — list every input fact
                const inputs = [s.from, ...s.deps].filter(Boolean);
                return (
                  <div key={i} className="proof-step ink-faded">
                    {inputs.map((src, j) => (
                      <span key={j}>
                        {j > 0 ? ' + ' : ''}
                        <em>{factSentence(src, theme)}</em>
                      </span>
                    ))}
                    {' '}({cascadePhrase(s.cascadeType)}) →{' '}
                    <strong className="ink">{factSentence(s.fact, theme)}</strong>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  if (hint.tier === 1) {
    if (hint.complete) {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 1 · complete</span>
          Puzzle fully resolved from your check marks. Nothing left to deduce — exclusivity covers every remaining cell.
        </div>
      );
    }
    if (hint.status === 'solved') {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 1 · solvable</span>
          From your current marks, the puzzle resolves to a unique solution in{' '}
          <strong>{hint.passes}</strong> further propagation pass{hint.passes === 1 ? '' : 'es'}.
        </div>
      );
    }
    if (hint.status === 'underdetermined') {
      return (
        <div className="ink text-sm leading-relaxed">
          <span className="hint-tag">tier 1 · stuck</span>
          The clues plus your current marks don't determine a unique solution. You may have missed a deduction — try Tier 2 to surface the next step.
        </div>
      );
    }
    return null;
  }

  return null;
}


function Metric({ label, value, note }) {
  return (
    <div className="pin-card-tight p-3">
      <div className="text-[10px] ink-faded uppercase tracking-widest mb-1">{label}</div>
      <div className="font-display text-3xl ink leading-none">{value}</div>
      <div className="text-[10px] ink-faded mt-1.5 italic">{note}</div>
    </div>
  );
}

// Horizontal-scroll clue strip — sits directly above the worksheet grid so the
// player can glance up at the clues without scrolling back to the Evidence
// section. Each card is a compact pin-card with the clue's index + full text.
function ClueScroll({ clues, theme }) {
  return (
    <div className="clue-scroll" role="region" aria-label="Clue quick reference">
      {clues.map((c, i) => (
        <div key={i} className="clue-card pin-card-tight">
          <div className="clue-card-num">№{String(i + 1).padStart(2, '0')}</div>
          <div className="clue-card-body">{theme.renderClue(c)}</div>
        </div>
      ))}
    </div>
  );
}

// Per-subject prose lines + status icon, plus a "case status" header that
// switches to a celebratory or retraction stamp once every subject row is
// filled. Layout is always rendered — placeholders ("_____") fill unknowns —
// so the section's height doesn't shift as the player marks cells.
function DeductionsPanel({ puzzle, gridState, theme }) {
  const subjectKey = puzzle.subjectKey;
  if (!subjectKey || !theme.factPhrasing) return null;
  const subjects = puzzle.categories[subjectKey];
  const status = puzzleStatus(puzzle, gridState);

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 gap-4 flex-wrap">
        <div>
          <div className="text-xs ink-faded tracking-[0.25em] uppercase">Deductions</div>
          <div className="text-[11px] ink-faded font-mono mt-0.5">
            fills in as you confirm cells
          </div>
        </div>
        <div className="deductions-status">
          {status === 'won' && <span className="stamp stamp-green">CASE CLOSED · SOLVED</span>}
          {status === 'wrong' && <span className="stamp stamp-red">RETRACTION · CHECK YOUR WORK</span>}
          {status === 'in-progress' && <span className="stamp-placeholder">&nbsp;</span>}
        </div>
      </div>
      <ol className="space-y-2">
        {subjects.map((subj) => {
          const { state, attrs } = entityStatus(puzzle, gridState, subjectKey, subj);
          const line = theme.factPhrasing(subj, attrs);
          let icon = null;
          if (state === 'correct') icon = <span className="ink-green deduction-icon">✓</span>;
          else if (state === 'wrong') icon = <span className="ink-red deduction-icon">✕</span>;
          else icon = <span className="deduction-icon-placeholder">&nbsp;</span>;
          return (
            <li key={subj} className={`deduction-line ${state}`}>
              <span className="deduction-text">{line}</span>
              {icon}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TraceView({ puzzle, theme }) {
  // Group derivations by pass markers.
  const groups = [];
  let cur = null;
  for (const t of puzzle.trace) {
    if (t.marker === 'pass-start') {
      if (cur) groups.push(cur);
      cur = { pass: t.pass, items: [] };
    } else if (cur) {
      cur.items.push(t);
    }
  }
  if (cur) groups.push(cur);

  const fmtFact = (f) => {
    const left = `${f.catA}=${f.a}`;
    const right = `${f.catB}=${f.b}`;
    const op = f.value === 'yes' ? '=' : '≠';
    return `${left} ${op} ${right}`;
  };
  const fmtSource = (s) => {
    if (!s) return '';
    if (s.type === 'clue') return `clue: ${theme.renderClue(s.clue)}`;
    return s.type;
  };

  return (
    <div className="space-y-3 text-xs">
      {groups.map((g, i) => (
        <div key={i}>
          <div className="ink-red font-bold tracking-widest text-[10px] uppercase mb-1.5">Pass {g.pass} · {g.items.length} derivations</div>
          <ul className="space-y-1 pl-2">
            {g.items.map((f, j) => (
              <li key={j} className="ink flex gap-2">
                <span className="ink-faded shrink-0 w-32 truncate">[{fmtSource(f.source).slice(0, 30)}]</span>
                <span>{fmtFact(f)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Compact view of the load-bearing deductions only: filters out the
// exclusivity cascades that just fill in ✕s once a ✓ is placed. What's left
// is the clue-driven facts plus the cross-category bridges (transitivity)
// and the by-elimination steps (last-option) — the actual proof skeleton.
function OptimalTraceView({ puzzle, theme }) {
  const INFORMATIVE = new Set(['clue', 'transitivity', 'last-option']);
  const groups = [];
  let cur = null;
  for (const t of puzzle.trace) {
    if (t.marker === 'pass-start') {
      if (cur && cur.items.length) groups.push(cur);
      cur = { pass: t.pass, items: [] };
    } else if (cur && t.source && INFORMATIVE.has(t.source.type)) {
      cur.items.push(t);
    }
  }
  if (cur && cur.items.length) groups.push(cur);

  const totalKept = groups.reduce((n, g) => n + g.items.length, 0);
  const totalRaw = puzzle.trace.filter((t) => !t.marker).length;

  return (
    <div className="space-y-3 text-xs">
      <div className="ink-faded italic text-[11px]">
        Showing the {totalKept} load-bearing steps out of {totalRaw} total
        derivations. The {totalRaw - totalKept} hidden steps are exclusivity
        cascades — automatic ✕s that follow once a ✓ is placed in the same
        row or column.
      </div>
      {groups.map((g, i) => (
        <div key={i}>
          <div className="ink-red font-bold tracking-widest text-[10px] uppercase mb-1.5">
            Pass {g.pass} · {g.items.length} step{g.items.length === 1 ? '' : 's'}
          </div>
          <ol className="space-y-1.5 pl-4 list-decimal marker:ink-faded">
            {g.items.map((f, j) => {
              const s = f.source;
              if (s.type === 'clue') {
                return (
                  <li key={j} className="ink leading-snug">
                    <span className="ink-faded">By clue:</span>{' '}
                    <em>"{theme.renderClue(s.clue)}"</em>{' '}
                    <span className="ink-faded">⇒</span>{' '}
                    <strong>{factSentence(f, theme)}</strong>
                  </li>
                );
              }
              if (s.type === 'last-option') {
                return (
                  <li key={j} className="ink leading-snug">
                    <span className="ink-faded">By elimination:</span>{' '}
                    <strong>{factSentence(f, theme)}</strong>
                  </li>
                );
              }
              // transitivity — show the parent pair if available
              const parents = [s.from, ...(s.deps || [])].filter(Boolean);
              return (
                <li key={j} className="ink leading-snug">
                  <span className="ink-faded">By transitivity:</span>{' '}
                  {parents.map((p, k) => (
                    <span key={k}>
                      {k > 0 ? ' + ' : ''}
                      <em>{factSentence(p, theme)}</em>
                    </span>
                  ))}{' '}
                  <span className="ink-faded">⇒</span>{' '}
                  <strong>{factSentence(f, theme)}</strong>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Worksheet grid
// ============================================================

function Legend({ categories, anchorKey }) {
  const order = [anchorKey, ...Object.keys(categories).filter(k => k !== anchorKey)];
  // One column per category — adapts to 3, 4, or 5.
  const cols = order.length;
  return (
    <div
      className="grid gap-x-6 gap-y-2 text-[11px] pin-card-tight p-3"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {order.map(cat => {
        const items = categories[cat];
        const hasLongNames = items.some(it => String(it).length > 7);
        return (
          <div key={cat}>
            <div className="cat-tag mb-1">{cat}</div>
            {items.map(item => {
              const sl = shortLabel(item);
              const full = String(item);
              return (
                <div key={item} className="leading-snug">
                  {hasLongNames ? (
                    <><span className="font-bold ink">{sl}</span> <span className="ink-faded">— {full}</span></>
                  ) : (
                    <span className="ink">{full}</span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function StaircaseGrid({ puzzle, gridState, onTap, scratchMode, activeTool, zoom }) {
  const { categories, anchorKey } = puzzle;
  const order = [anchorKey, ...Object.keys(categories).filter((k) => k !== anchorKey)];
  const nCats = order.length;
  // Rows: every category except the last (which would have no pairs to show).
  const rowCats = order.slice(0, -1);
  // Columns: non-anchor categories in REVERSE order. This puts the staircase
  // shape XXX/XX/X with all rows left-aligned and empty cells in the bottom-right.
  const colCats = order.slice(1).reverse();
  const n = categories[order[0]].length;

  // Decide whether a (row, col) intersection in the staircase should hold a real
  // subgrid or be empty. Pair (rowCats[i], colCats[j]) is unique iff i+j < nCats-1.
  const showPair = (rowIdx, colIdx) => rowIdx + colIdx < nCats - 1;

  // Whether the active tool is allowed to touch this cell's committed state.
  // Scratch tool: anything. X tool: only blank or X cells. ✓ tool: only blank or ✓ cells.
  const isDisallowed = (committed) => {
    if (activeTool === 'scratch') return false;
    if (activeTool === 'x') return committed === 'check';
    if (activeTool === 'check') return committed === 'x';
    return false;
  };

  return (
    <div className="grid-zoom-wrap">
      <table className="sc-table" style={{ '--grid-zoom': zoom || 1 }}>
        <thead>
          {/* Row 1: category names spanning their item columns. */}
          <tr>
            <th colSpan={2} className="sc-corner sc-corner-top"></th>
            {colCats.map((catCol, idx) => (
              <th
                key={catCol}
                colSpan={n}
                className={`sc-cat-col ${idx < colCats.length - 1 ? 'sc-subgrid-edge-r' : ''}`}
              >
                <div className="cat-tag">{catCol}</div>
              </th>
            ))}
          </tr>
          {/* Row 2: per-item column labels (rotated vertically). */}
          <tr>
            <th colSpan={2} className="sc-corner sc-corner-bottom"></th>
            {colCats.flatMap((catCol, catIdx) =>
              categories[catCol].map((item, idx) => (
                <th
                  key={`${catCol}::${item}`}
                  className={`sc-item-col ${idx === n - 1 && catIdx < colCats.length - 1 ? 'sc-subgrid-edge-r' : ''}`}
                  title={String(item)}
                >
                  <div className="vlabel">{shortLabel(item)}</div>
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {rowCats.flatMap((rowCat, rowCatIdx) =>
            categories[rowCat].map((rowItem, itemIdx) => {
              const isLastInStripe = itemIdx === n - 1;
              const stripeEdge = isLastInStripe && rowCatIdx < rowCats.length - 1;
              return (
                <tr key={`${rowCat}::${rowItem}`}>
                  {itemIdx === 0 && (
                    <th
                      rowSpan={n}
                      className={`sc-cat-row ${rowCatIdx < rowCats.length - 1 ? 'sc-subgrid-edge-b' : ''}`}
                    >
                      <div
                        className="cat-tag"
                        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                      >
                        {rowCat}
                      </div>
                    </th>
                  )}
                  <th
                    className={`sc-item-row ${stripeEdge ? 'sc-subgrid-edge-b' : ''}`}
                    title={String(rowItem)}
                  >
                    {shortLabel(rowItem)}
                  </th>
                  {colCats.flatMap((colCat, colCatIdx) => {
                    if (!showPair(rowCatIdx, colCatIdx)) {
                      // Empty triangle in bottom-right of staircase.
                      return categories[colCat].map((colItem) => (
                        <td key={`${colCat}::${colItem}`} className="sc-empty" />
                      ));
                    }
                    return categories[colCat].map((colItem, colItemIdx) => {
                      const key = canonKey(rowCat, rowItem, colCat, colItem);
                      const cell = gridState[key];
                      const committed = cell?.committed || null;
                      const scratch = cell?.scratch || null;
                      // Compose the inner content depending on what's present.
                      let glyph = null;
                      let corner = null;
                      let solo = null;
                      if (committed === 'x') glyph = '✕';
                      else if (committed === 'check') glyph = '✓';
                      // Scratch display rules:
                      //   scratch mode ON  → always show full-size (committed
                      //     glyph is hidden by CSS in this mode, so the cell
                      //     has the green/red highlight + scratch label only)
                      //   scratch mode OFF → only visible if no committed mark
                      //     underneath; rendered grayed as a faint preview
                      if (scratch) {
                        if (scratchMode || !committed) {
                          solo = scratch;
                        }
                      }
                      const inSubgridEdge = colItemIdx === n - 1 && colCatIdx < colCats.length - 1;
                      const disallowed = isDisallowed(committed);
                      const cellClasses = [
                        'grid-cell',
                        committed === 'x' ? 'committed-x' : '',
                        committed === 'check' ? 'committed-check' : '',
                        scratchMode ? 'scratch-mode' : '',
                        disallowed ? 'cell-disallowed' : '',
                      ].filter(Boolean).join(' ');
                      return (
                        <td
                          key={`${colCat}::${colItem}`}
                          className={`sc-td ${inSubgridEdge ? 'sc-subgrid-edge-r' : ''} ${stripeEdge ? 'sc-subgrid-edge-b' : ''}`}
                        >
                          <button
                            onClick={() => onTap(rowCat, rowItem, colCat, colItem)}
                            className={cellClasses}
                            aria-label={`${rowCat}=${rowItem} vs ${colCat}=${colItem}: ${committed || 'blank'}${scratch ? ` (scratch:${scratch})` : ''}`}
                          >
                            {glyph && !scratchMode && <span className="glyph">{glyph}</span>}
                            {solo && <span className={`scratch-solo ${scratchMode ? '' : 'faded'}`}>{solo}</span>}
                            {corner && <span className="scratch-corner">{corner}</span>}
                          </button>
                        </td>
                      );
                    });
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Sampling stats
// ============================================================

function SamplingPanel({ candidates, selected }) {
  // candidates is sorted desc by _score.
  const scores = candidates.map((c) => c._score);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const range = Math.max(max - min, 0.0001);
  const median = scores[Math.floor(scores.length / 2)];
  const selectedScore = selected._score;

  return (
    <section>
      <div className="text-xs ink-faded tracking-[0.25em] uppercase mb-3">Candidate Sampling</div>
      <div className="pin-card p-4">
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs font-mono mb-4">
          <div>
            <span className="ink-faded">selected </span>
            <span className="ink-red font-bold text-base">{selectedScore.toFixed(1)}</span>
          </div>
          <div>
            <span className="ink-faded">median </span>
            <span className="ink">{median.toFixed(1)}</span>
          </div>
          <div>
            <span className="ink-faded">range </span>
            <span className="ink">{min.toFixed(1)} – {max.toFixed(1)}</span>
          </div>
          <div>
            <span className="ink-faded">samples </span>
            <span className="ink">{candidates.length}</span>
          </div>
        </div>
        {/* Histogram: one bar per candidate, sorted desc, selected highlighted */}
        <div className="flex items-end gap-1" style={{ height: 60 }}>
          {scores.map((s, i) => {
            const h = ((s - min) / range) * 56 + 4;
            const isTop = i === 0;
            return (
              <div
                key={i}
                style={{
                  height: h,
                  width: 18,
                  flexShrink: 0,
                  background: isTop ? '#8b1a1a' : 'rgba(138, 121, 96, 0.5)',
                }}
                title={`#${i + 1}: ${s.toFixed(2)}`}
              />
            );
          })}
        </div>
        <div className="mt-3 text-[11px] ink-faded italic font-display leading-snug max-w-2xl">
          Score = passes × leverage + 2·diversity − clue-count penalty. Leverage is cascade derivations per clue; high values mean each clue powers a lot of follow-on facts. A wide range here is the sampling filter doing real work — without it you'd get whichever puzzle generated first, not the most cascade-rich one.
        </div>
      </div>
    </section>
  );
}
