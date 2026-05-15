import { shortLabel } from '../utils.js';
import { canonKey } from '../engine/propagation.js';

export function StaircaseGrid({ puzzle, gridState, onTap, scratchMode, activeTool, zoom }) {
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
