import { factSentence } from './factPhrase.js';

export function TraceView({ puzzle, theme }) {
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
export function OptimalTraceView({ puzzle, theme }) {
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
