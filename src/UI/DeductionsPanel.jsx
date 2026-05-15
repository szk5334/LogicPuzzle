import { puzzleStatus, entityStatus } from '../engine/deductions.js';

// Per-subject prose lines + status icon, plus a "case status" header that
// switches to a celebratory or retraction stamp once every subject row is
// filled. Layout is always rendered — placeholders ("_____") fill unknowns —
// so the section's height doesn't shift as the player marks cells.
export function DeductionsPanel({ puzzle, gridState, theme }) {
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
