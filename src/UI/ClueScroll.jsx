// Horizontal-scroll clue strip — sits directly above the worksheet grid so the
// player can glance up at the clues without scrolling back to the Evidence
// section. Each card is a compact pin-card with the clue's index + full text.
export function ClueScroll({ clues, theme }) {
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
