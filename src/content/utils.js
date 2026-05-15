// Small leaf helpers shared across engine, content, and UI.

export function capit(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Tool modes for the worksheet. One active at a time.
//   - 'x':       tap toggles a committed X mark (no-fact)
//   - 'check':   tap toggles a committed ✓ mark (yes-fact)
//   - 'scratch': tap on blank cell opens label picker; tap on cell w/ scratch removes it
export const TOOLS = ['x', 'check', 'scratch'];

// Default scratch label suggestions (player can type anything 1-2 chars).
export const DEFAULT_SCRATCH_LABELS = ['1', '2', '3', 'A', 'B', '?'];

// Render a possibly long category-item value down to a compact grid label.
// Strips stop-words, prefers the first content word, truncates with ellipsis.
export function shortLabel(s, maxLen = 7) {
  if (typeof s === 'number') return String(s);
  const trimmed = String(s);
  if (trimmed.length <= maxLen) return trimmed;
  const stop = new Set(['a', 'an', 'the', 'with', 'of', 'at', 'in', 'and', 'on', 'her', 'his']);
  const words = trimmed.split(/[\s-]+/);
  for (const w of words) {
    if (!stop.has(w.toLowerCase())) {
      return w.length > maxLen ? w.slice(0, maxLen - 1) + '…' : w;
    }
  }
  return trimmed.slice(0, maxLen - 1) + '…';
}
