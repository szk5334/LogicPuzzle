import { shortLabel } from '../utils.js';

export function Legend({ categories, anchorKey }) {
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
