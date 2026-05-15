// useWorksheet — encapsulates all worksheet state and operations.
//
// Owns: the grid (committed X/✓ marks and scratch labels), the active tool,
// turn-tracking for golf scoring, the scratch label picker overlay, and the
// grid zoom level.
//
// Does NOT own: the puzzle, hint state, verify-marks state, or any of the
// app-level controls (theme, difficulty, sample count). App composes those.
//
// `reset()` clears all worksheet state to a fresh-puzzle baseline. App calls
// it from its own `resetGrid` button handler and at the start of `generate`.
// Tool selection persists across resets — the player's preferred mark stays.

import { useState } from 'react';
import { canonKey } from '../engine/propagation.js';

export function useWorksheet() {
  // Grid state: keyed by canonKey, value = { catA, a, catB, b, committed: 'x'|'check'|null, scratch: string|null }.
  // Coordinates stored inline so we never have to decode canonKey to iterate.
  const [gridState, setGridState] = useState({});

  // Active tool. 'x' / 'check' / 'scratch'.
  const [tool, setTool] = useState('x');

  // Turn mechanics (Phase 2: golf scoring).
  // A "turn" is bounded by a single committed-tool type. Switching between X
  // and ✓ mid-turn (when committed changes have been made) ends the turn and
  // advances the counter. Scratch is always free.
  const [turnNumber, setTurnNumber] = useState(1);
  const [turnStartGrid, setTurnStartGrid] = useState({});      // committed-layer snapshot at turn start
  const [lastCommittedTool, setLastCommittedTool] = useState(null); // the X/✓ that "owns" this turn

  // Scratch label picker state. When a player taps a blank cell in scratch
  // mode, we open a tiny picker overlay anchored to that cell. `editing` is
  // true when the cell already has a scratch label being edited.
  const [scratchPicker, setScratchPicker] = useState(null); // { key, catA, a, catB, b, editing } or null
  const [scratchInput, setScratchInput] = useState('');
  const [recentLabels, setRecentLabels] = useState([]); // most-recent first, capped

  // Grid zoom — multiplier applied to all grid dimensions via CSS variable.
  // Default 1 fits a small phone; up to 3 for inspection.
  const [gridZoom, setGridZoom] = useState(1);

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
    // regenerated. (Clearing happens in App, not here.)
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

  // Predicate for the tool palette: would clicking `target` advance the turn?
  // True iff the committed layer has changed since turn-start AND the target
  // is a committed tool different from the one that owns the current turn.
  // Used by App to render the "+1" pip on tool buttons.
  const wouldEndTurn = (target) => {
    if (target === 'scratch' || lastCommittedTool === null) return false;
    if (target === lastCommittedTool) return false;
    return committedDiffers(gridState, turnStartGrid);
  };

  // Clear all worksheet state to fresh-puzzle baseline. Tool stays — that's a
  // player preference, not puzzle-bound state.
  const reset = () => {
    setGridState({});
    setTurnNumber(1);
    setTurnStartGrid({});
    setLastCommittedTool(null);
  };

  return {
    // State (read-only from App's perspective).
    gridState,
    tool,
    turnNumber,
    scratchPicker,
    scratchInput,
    recentLabels,
    gridZoom,
    // Setters App needs direct access to (zoom buttons, picker dismissal, input field).
    setScratchPicker,
    setScratchInput,
    setGridZoom,
    // Operations.
    selectTool,
    tapCell,
    commitScratchLabel,
    clearScratchLabel,
    wouldEndTurn,
    reset,
  };
}
