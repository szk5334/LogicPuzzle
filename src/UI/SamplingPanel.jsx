export function SamplingPanel({ candidates, selected }) {
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
