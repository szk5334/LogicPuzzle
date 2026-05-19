export function SamplingPanel({ candidates, selected }) {
  // candidates is sorted desc by _score (the active priority-mode score).
  // For display we use _difficulty (raw passes²×leverage) so the numbers are
  // meaningful regardless of priority mode — band-capped modes return huge
  // negative penalty values for above-cap samples, which would otherwise
  // break the histogram.
  const diffs = candidates.map((c) => c._difficulty);
  const max = Math.max(...diffs);
  const min = Math.min(...diffs);
  const range = Math.max(max - min, 0.0001);
  // Median by raw difficulty (sort a copy — candidates ordering by _score is
  // not the same as the difficulty rank under band-capped modes).
  const sortedDiffs = [...diffs].sort((a, b) => a - b);
  const median = sortedDiffs[Math.floor(sortedDiffs.length / 2)];
  const selectedDiff = selected._difficulty;
  // Selected's position when ranked by raw difficulty desc — tells the user
  // "the selected puzzle is the Nth hardest in the batch" even when the
  // priority mode put it first via a different criterion.
  const sortedDesc = [...diffs].sort((a, b) => b - a);
  const selectedRank = sortedDesc.indexOf(selectedDiff) + 1;

  return (
    <section>
      <div className="text-xs ink-faded tracking-[0.25em] uppercase mb-3">Candidate Sampling</div>
      <div className="pin-card p-4">
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs font-mono mb-4">
          <div>
            <span className="ink-faded">selected </span>
            <span className="ink-red font-bold text-base">{selectedDiff.toFixed(1)}</span>
            {selectedRank > 1 && (
              <span className="ink-faded ml-1">(rank #{selectedRank} by difficulty)</span>
            )}
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
        {/* Histogram: one bar per candidate, ordered as the active priority
            mode ranked them (sort-desc by _score). Bar height encodes raw
            difficulty. The leftmost bar is the chosen winner. */}
        <div className="flex items-end gap-1" style={{ height: 60 }}>
          {diffs.map((d, i) => {
            const h = ((d - min) / range) * 56 + 4;
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
                title={`#${i + 1} by priority: difficulty ${d.toFixed(2)}`}
              />
            );
          })}
        </div>
        <div className="mt-3 text-[11px] ink-faded italic font-display leading-snug max-w-2xl">
          Difficulty is passes² × leverage — the depth and breadth of cascade
          a solver must follow. The histogram orders candidates by the active
          priority mode; bar height shows raw difficulty. A wide range means
          the sampling filter is doing real work — without it you'd take the
          first puzzle generated, not the chosen one.
        </div>
      </div>
    </section>
  );
}
