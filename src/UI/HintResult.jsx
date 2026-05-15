import { factSentence, cascadePhrase } from './factPhrase.js';

export function HintResult({ hint, theme }) {
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
