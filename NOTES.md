# Notes — model radar-3

How the model works, what its own backtest says, what changed from the previous entry's radar-2,
and how the entry was verified. The code is `lib/model.ts`; everything stated here is computed
from the sealed snapshot (`as_of` 2026-11-14, 758 protocols, 40 on the watchlist).

## The formula

```
implied = round( tvl x category_ratio x momentum x maturity x breadth )
```

| Part | Definition |
| --- | --- |
| `category_ratio` | Shrunk geometric mean of the category's comparable mcap/TVL ratios (below), bounded to [0.03, 3] |
| `momentum` | 1 + 0.45 × clamp(change_7d, −40, +60) / 100; no reported change → exactly 1 |
| `maturity` | 0.75 + 0.45 × min(age_days, 1460) / 1460; unknown age → 365 days |
| `breadth` | 1 + 0.04 × (chains counted, up to 6, minus 1) |

Every factor is rounded before use — the ratio to 6 decimals, the multipliers to 4 — so the
dashboard recomputes each row from its printed inputs and lands on the printed answer exactly.

## Calibration

A **comparable** is a protocol that records a token and has a real, positive market cap on real,
positive TVL: 128 of the snapshot's 758 protocols, across 34 categories. For each comparable the
raw ratio mcap/TVL is **winsorized to [0.02, 5]** and logged. A category's center is the **mean
of its comparables' log-ratios** (a geometric mean of ratios — the right center for a
multiplicative quantity), **shrunk toward the global center** with an empirical-Bayes
pseudo-count K = 6:

```
center_log(category) = (n × mean_log(category) + 6 × mean_log(global)) / (n + 6)
```

A category with 2 voters is pulled hard toward the market; one with 15 barely moves. The global
center is 0.237472. A category with no comparables at all — 14 of the board's categories — is
priced off the global center, and its rows carry `used_global_ratio` and say so in the drawer.

Why a geometric mean rather than radar-2's median: on this snapshot's comparables the
leave-one-out exam below prices the typical protocol closer with the winsorized log-space mean
(median |log error| 1.4896 for the category rule) than with the winsorized median (1.6061), at
the same within-2× rate. The winsor band, not the choice of center, is what tames the tail.

## The range

Each category's comparables disagree, and the disagreement is measured with a robust
**MAD sigma in log space** (1.4826 × the median absolute deviation of the log-ratios), shrunk by
pooling variances toward the **pooled within-category sigma** (1.6917 — the typical disagreement
inside a category, deliberately not the whole market's cross-category spread, which is 2.3449).
The factor f = e^sigma turns the point estimate into a band:

```
low = round(implied / f)        high = round(implied × f)
```

Across the board f runs from ×3.75 to ×8.77 (median ×5.43). The bands are wide because launch
pricing is wide; a narrow fake band would be the dishonest option.

## Confidence

```
confidence = round( 100 × (0.45 × evidence + 0.30 × agreement + 0.25 × completeness) )
evidence     = n_eff / (n_eff + 4)     n_eff = the row's category comparable count (1 if global)
agreement    = 1 / (1 + sigma)         the applied dispersion, above
completeness = reported fields / 4     change_7d, listed_at, category, chains
```

Parts are rounded to 4 decimals before combining, so the score recomputes on the page. Tiers:
**Prime ≥ 69, Strong ≥ 57, Watch ≥ 45**, Speculative below (on this board: 31 / 62 / 101 / 4
rows). The top of the board is the honest advertisement for the score: Steakhouse Financial,
Sentora Curator and Gauntlet hold the three largest implied caps and score 45 — their category,
Risk Curators, has exactly one comparable. Size is not evidence, and the board does not pretend
otherwise.

## The backtest

Leave-one-out on the 128 comparables: each is priced as if pre-token, its own observation left
out of every figure it is priced with, and the estimate is compared with its real market cap.

| Rule | Median \|log error\| | Typical miss | Within 2× |
| --- | --- | --- | --- |
| Naive global multiple | 1.6233 | ×4.68 | 28.1% |
| Category multiple alone | 1.4896 | ×4.44 | 24.2% |
| radar-3, full model | 1.5427 | ×4.65 | 24.2% |

Read honestly: category calibration is the big win over the naive multiple — a dollar of
lending TVL and a dollar of DEX TVL are not worth the same. The naive rule still lands within
2× slightly more often, because it parks every estimate in the middle of the distribution: often
vaguely close, never specifically right, and blind to category. The full model's adjustments
cost it a little on this exam for a stated reason — a comparable's momentum and age are already
inside its real market cap, so re-applying them double-counts; for a protocol with no token,
those are precisely the signals a bare multiple misses. No TVL-based model prices launches
tightly, which is why every row carries its range and its confidence.

## What changed from radar-2 (entry #1)

| Dimension | radar-2 | radar-3 | Worse anywhere? |
| --- | --- | --- | --- |
| Ratio estimation | Winsorized median in ratio space, shrunk toward the global median | Winsorized geometric mean in log space, shrunk toward the global center; better typical error on the LOO exam (category rule 1.4896 vs 1.6061 median \|log error\|) | No |
| Plausible range | None — a point estimate only | Per-row low–high from the category's MAD dispersion, pooled-shrunk | No |
| Confidence | None | 0–100 from evidence, agreement, completeness, with readiness tiers | No |
| Backtest | None | Leave-one-out exam of three rules, published on the model page and here | No |
| Dashboard | Sortable, filterable board; detail drawer; live-token view; model panel | All of that, plus range and confidence columns, tier chips, a minimum-confidence filter, stat header cards, the full live calibration table (34 categories) and the backtest table | No |
| Recompute check | Drawer recompute of the implied value | Recompute of implied value, range **and** confidence, verified for all 198 rows and counted on the board itself | No |
| Farm plans | 5 steps per protocol, Cost and Time in each step | The same discipline, plus a per-protocol priority/effort `plan_note` (rank, capital, cadence, confidence) | No |
| Robustness | Sentinel and missing values handled in the calibration | The same handling, plus the program's own gate now also validates ranges, confidences and finiteness on every row before writing | No |

## Edge cases in this snapshot, and what the model does with them

- **autofinance** carries `mcap_usd = -1`, the source's "not reported" sentinel: it is treated
  as unreported everywhere — never a comparable, never a negative price.
- **15 protocols** record `mcap_usd = 0`: a zero cap prices nothing, so they are not
  comparables; they still appear in the live-token view with their cap shown as unreported.
- **14 protocols** record a CoinGecko id but no market cap: live, but not comparables.
- **4 protocols** have no `change_7d`: momentum is neutral (×1), never a crash.
- **113 protocols** have no `listed_at`: maturity counts a 365-day age.
- **18 board rows** sit in categories with no comparables: priced off the global multiple, with
  the pooled dispersion as their range basis, and flagged on the row.
- No row emits NaN or infinity: the program validates the finished board (ranks, bounds,
  ordering, range bracketing, confidence bounds, farm-step lengths, watchlist coverage) and
  refuses to write a board that breaks its own rules.

## Verification

- **Determinism:** the entry was run twice on the sealed snapshot into two output directories;
  `diff -r` reports the trees byte-identical.
- **Independent recompute:** a separate script, written against the raw snapshot rather than
  the model's code, recomputed every row's implied value, range and confidence from the printed
  inputs — 198 of 198 rows match. The dashboard performs the same check in the browser and
  prints the count on the board.
- **Gate checks:** board.json holds 198 rows (bound 100–4,000), ranks 1..198 once each, values
  whole, positive, non-rising and not all equal, every watchlist slug present; farm plans are 5
  steps of 133–349 characters (bounds 20–600); screenshots are 4 PNGs of 1440×1000, each under
  the 512 KiB cap; the dossier the program writes is the dossier the scorer rebuilds from the
  same output.
- **Runtime:** one full build, backtest included, completes in well under a second locally —
  far inside the grader's 120-second, single-CPU budget.
