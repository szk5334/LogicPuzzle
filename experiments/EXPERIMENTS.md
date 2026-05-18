# Experiments — Tuning Session Data

This folder captures the experimental data from the dash-card tuning work.
Every preset, β value, and arrow rating in the UI traces back to a measurement
recorded here. When the engine changes — new clue types, retuned WEIGHTS,
different propagation order — these experiments need to be re-run to keep the
UI predictions calibrated.

## Files

| File | What's in it |
|---|---|
| `raw_combo20_K3_n1000.json` | 1000 random 4-type combinations from a 20-type pool, K=3 puzzles each (3000 puzzles). Each record: `{ key, comboArr, meanTime, meanDiff, meanPasses, n }`. The single source of truth for per-type contributions. |
| `verification_K40.json` | K=40 verification of top-5 candidates per band (easy/medium/hard/brutal), 800 puzzles. Includes per-puzzle difficulty arrays so distributions can be re-analyzed. |
| `consolidated.json` | Roll-up: regression coefficients (centered, opposite-pooled), band winners, rotation pools. Convenient single-file view. |

## Provenance

- Engine version: post-Batch-2 (with `typeFocus: 'natural' | 'even' | array | { fixed, rotate }` and `adaptiveMin`)
- Puzzle size: 5×5
- Difficulty band: hard (so the underlying WEIGHTS table is the "hard" column)
- Themes: classic, soapOpera, noir (rotated, K=1 per theme = K=3 per combo)
- PRNG seed: `mulberry32(42)` in `combo20_chunked.mjs` — the 1000-combo plan is deterministic and re-runnable
- Date: May 2026

## Experiments in chronological order

### 1. Single-type focus sweep (lost — not saved, but referenced)
For each of the 22 emitting clue types, generate K=15 puzzles where that type
holds 90% of the focus weight. Recorded mean time and mean difficulty in
isolation. **Finding:** `oneOf` solo produces hardest puzzles (diff 409) but
also slowest (1187ms). `iff`/`mixed`/`xor` are the sweet-spot trio.

### 2. C(12,4) full combinatorial sweep (lost — superseded)
All 495 four-type combos from the top-12 solo-strongest types, K=3 each.
**Finding:** pooling 4 strong types averages 188ms instead of summing — pooling
discount is real. `oneOf` in combos drops out of the difficulty winner-list:
`[iff, mixed, xor, nextTo]` beat `[iff, mixed, xor, oneOf]` at 167ms / 727 diff
vs 268ms / 393 diff in K=3 measurement.

### 3. Trio + rotating wildcard (K=50)
Fixed trio `[iff, mixed, xor]` + 4th wildcard rotating through 18 candidates.
Verified `notNextTo`, `exactlyApart`, `ifThenAnd`, `ifThen`, `nextTo`, `oneOf`,
`either`, `leftOf`, `immLeft` as the wildcards delivering p90 ≥ 640. Rotation
mechanism added to the engine: `typeFocus: { fixed, rotate }`.

### 4. The big one — 1000 random 4-type combos (this file)
Sampled 1000 random combinations from a 20-type pool (excluding atomics
`is`/`not` and `unalignedPair` as known-uninteresting), K=3 puzzles per combo
across 3 themes. **3000 puzzles, ~25 minutes of compute, deterministic seed.**

Each clue type appears in ~200 of the 1000 combos, which gives reliable OLS
estimates of per-type contributions.

OLS regression: `outcome = β₀ + Σ β_t · I(type t is in combo)` for outcomes
(meanDiff, meanTime). Coefficients are not unique (every combo has exactly 4
types so Σ is constant — one degree of freedom is unidentified) so they're
**centered**: shifted so the mean β equals zero, with the constant rolled into
the intercept. This makes them interpretable as "deviation from average effect
of any 4-type combo."

True directional opposites are **pooled** by averaging their β before centering:
- `(immLeft, immRight)` → identical rating
- `(leftOf, rightOf)` → identical rating

These pairs are computationally symmetric by construction (mirror images of the
same operation). Semantic complements (`is`/`not`, `nextTo`/`notNextTo`,
`atEnd`/`notAtEnd`) are *not* pooled — they have genuinely different cardinality
and complexity.

**Model fit:** R² = 0.53 for difficulty, R² = 0.32 for time. The remaining
variance is combo-level interaction effects (some 4-tuples have synergies the
linear model can't capture). Examples: the brutal champion `[mixed, nextTo,
oneOf, xor]` produces diff 1042 in K=30 — predicted by the linear model is
much lower; the actual top puzzles exploit interactions.

#### Final centered β values (used in dashCardLogic.js)

```
                β-diff    β-time
                ━━━━━━    ━━━━━━
mixed            +84      -110ms
xor              +85      -112ms
iff              +56      -133ms
ifThenAnd        +41      +62ms
ifThen           +35       -6ms
either           +31       -1ms
oneOf             +1     +139ms
exactlyApart    -10      +37ms
immLeft         -11      -67ms  ←┐ pooled
immRight        -11      -67ms  ←┘
within           -8     +130ms
leftOf           -7     +117ms  ←┐ pooled
rightOf          -7     +117ms  ←┘
notNextTo        -6      +23ms
nextTo          -23      -42ms
allDifferent    -30     +108ms
atLeastApart    -35      -25ms
between         -39      -58ms
notAtEnd        -56      -42ms
atEnd           -90      -71ms
```

### 5. Band-winner verification (K=40)
For each of easy/medium/hard/brutal, picked top-5 candidate combos from the
1000-combo data (closest mean to band ceiling for non-brutal, highest mean for
brutal), verified each at K=40 puzzles. Champion per band:

| Band | Combo | capHit | inBand% | Mean | Max | Time |
|---|---|---|---|---|---|---|
| easy   | atEnd + between + either + ifThenAnd | 199 | 53% | 203 | 582 | 276ms |
| medium | atLeastApart + iff + notAtEnd + rightOf | 296 | 75% | 231 | 722 | 297ms |
| hard   | allDifferent + iff + immRight + mixed | 400 | 78% | 334 | 760 | 248ms |
| brutal | mixed + nextTo + oneOf + xor | 926 | 100% | 382 | 926 | 277ms |

`capHit` = the maximum difficulty among samples that fell at or below the
band's cap. At sample-of-100 use (curated presets' default) the in-band%
becomes the fraction of samples available for the cap-hit logic — for easy at
53% that means ~53 in-band candidates per 100 samples, and the hardest of those
becomes the chosen puzzle.

The "Hard" winner has `capHit=400` exactly — meaning K=40 produced at least one
sample landing precisely at 400 (the cap). At larger N this is reliable.

### 6. Top-3 rotation pools per band
For each band, the top 3 verified combos are stored as `BAND_ROTATION_POOLS`
in `dashCardLogic.js`. These power the "even mix" progression-curation goal:
a path through varied puzzle shapes within a difficulty band. Each pool member
is independently verified to hit its band reliably.

## How to re-run

```sh
# 1. Generate the 1000 combos
node combo20_chunked.mjs 0 250
node combo20_chunked.mjs 250 500
node combo20_chunked.mjs 500 750
node combo20_chunked.mjs 750 1000

# 2. Mine candidates per band
node band_mine.mjs

# 3. Verify candidates at K=40
node band_final.mjs

# Output files end up in /tmp; copy to experiments/ to commit
```

All harness scripts live at the repo root. Total compute: ~30-40 minutes.

## What's NOT measured here

- **Per-theme effects.** Themes are pooled. Some themes may produce
  meaningfully different difficulty distributions; not investigated.
- **Different puzzle sizes.** All measurements at 5×5. 4×4 and 6×6 will
  shift the curves. New sizes need new measurements.
- **Two-stage sampling correlation.** Tested earlier in this session,
  found Spearman ρ < 0.17 across all priority modes — pre-min coarse
  score does not predict post-min final score. Two-stage sampling is dead.
- **Adaptive minimization savings.** Measured ~2% wall time, not the 33%
  initially predicted from pass-utilization stats. Pass 1 dominates cost;
  early-exiting passes 2-3 saves attempts but not much time.

## Future curation work (not done yet)

The user's stated goal: curate paths through connected puzzles, the first
type being an "even mix of different shapes of puzzles progressing from
easy to brutal before the capstone(s)."

The infrastructure for this is in place:
- `BAND_ROTATION_POOLS` provides 3 verified shape-diverse combos per band
- A curation engine could chain: rotation[easy][0] → rotation[easy][1] →
  rotation[medium][0] → ... → brutal[0]
- For an N-puzzle curated path, you'd want each band represented with
  variety, then a brutal capstone

This is a separate phase of work — not started.
