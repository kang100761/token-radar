// The token radar's model (radar-3): one snapshot of the protocol universe in, one ranked board out.
//
// radar-3 prices a protocol that records no token the way the market prices the ones that already
// trade, and it says how much that price should be trusted. Every tokenized protocol in the same
// snapshot is a comparable: its market-cap/TVL ratio says what one dollar of locked value is worth
// once a token exists. radar-3 works in log space, because ratios are multiplicative: it takes the
// winsorized geometric mean of each category's comparable ratios (the mean of their log-ratios),
// shrinks thin categories toward the global center with an empirical-Bayes pseudo-count, and
// applies the result to a pre-token protocol's TVL, adjusted by three things the snapshot itself
// reports:
//
//   implied = round( tvl_usd x category_ratio x momentum x maturity x breadth )
//
//   category_ratio  the shrunk geometric-mean mcap/TVL of the category's tokenized protocols
//   momentum        1 + 0.45 x clamp(change_7d, -40, 60) / 100; a protocol with no reported
//                   seven-day change is neutral at exactly 1
//   maturity        0.75 + 0.45 x min(age_days, 1460) / 1460: the longer a protocol has run with
//                   no token, the more of a launch its record supports; an unknown age counts 365
//   breadth         1 + 0.04 for every chain past the first, up to six chains: a protocol that
//                   holds value on several chains has more holders to launch to
//
// Two things radar-2 could not say, radar-3 states on every row:
//
//   a RANGE. Each category's comparables disagree, and their robust log-space dispersion (a
//   median-absolute-deviation sigma, shrunk toward the pooled within-category dispersion) becomes
//   a factor f = e^sigma: the row's range is implied / f to implied x f, the band the category's
//   own history says a launch price plausibly lands in.
//
//   a CONFIDENCE score, 0 to 100, from three stated parts: evidence (how many comparables priced
//   the row), agreement (how tightly those comparables agree, from the same sigma), and
//   completeness (how much of the protocol's own record the snapshot actually reports).
//
// Every multiplier the dashboard prints is rounded before it is used (ratios to 6 decimals, the
// rest to 4), so a reader can recompute every row's implied value, range and confidence from the
// printed inputs and land on the printed answer, exactly.
//
// The board's universe is the house's own screen with no TVL floor: a protocol is rankable when it
// records no token (no market cap, no CoinGecko id, no symbol) and is not a wrapped, staked or
// bridged product of one that trades — its category is not Bridge, Canonical Bridge, Liquid
// Staking, Liquid Restaking, Restaked BTC or CEX, its name ends in no version marker, carries no
// whole word wrapped, staked or staking, and begins with no exchange's name. Every watchlist slug
// passes that screen by construction, so the watchlist is covered whole, and the same screen at
// any TVL finds the early protocols below the $50M floor. No protocol name is ever special-cased:
// one function scores every row, and the tokenized protocols are set aside as the comparable set,
// never ranked.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the board's rows carry it. */
export const MODEL_VERSION = 'radar-3';

/** One comparable ratio before it is trusted: a single protocol's mcap/TVL is winsorized to this band. */
export const RATIO_OBS_FLOOR = 0.02;
export const RATIO_OBS_CAP = 5;
/** A category median is shrunk toward the global median as if the global had this many observations. */
export const RATIO_SHRINK_K = 6;
/** No category's final multiple leaves this band, however its comparables voted. */
export const RATIO_FINAL_MIN = 0.03;
export const RATIO_FINAL_MAX = 3;
/** No dispersion is ever stated below this: even a unanimous category keeps a plausible band. */
export const SIGMA_FLOOR = 0.05;
/** Seven-day momentum: the clamp on change_7d and the weight each point of it carries. */
export const MOMENTUM_FLOOR = -40;
export const MOMENTUM_CAP = 60;
export const MOMENTUM_WEIGHT = 0.45;
/** Maturity: the multiplier runs from MATURITY_BASE at age zero to +MATURITY_RANGE at MATURITY_DAYS. */
export const MATURITY_BASE = 0.75;
export const MATURITY_RANGE = 0.45;
export const MATURITY_DAYS = 1460;
export const UNKNOWN_AGE_DAYS = 365;
/** Breadth: each chain past the first adds this, counting at most BREADTH_CHAINS chains. */
export const BREADTH_PER_CHAIN = 0.04;
export const BREADTH_CHAINS = 6;
/** Confidence: the three parts' weights, and the pseudo-count in the evidence part. */
export const CONF_WEIGHT_EVIDENCE = 0.45;
export const CONF_WEIGHT_AGREEMENT = 0.3;
export const CONF_WEIGHT_COMPLETENESS = 0.25;
export const CONF_EVIDENCE_K = 4;
/** Readiness tiers by confidence: Prime at 69, Strong at 57, Watch at 45, Speculative below. */
export const TIER_PRIME = 69;
export const TIER_STRONG = 57;
export const TIER_WATCH = 45;

/** Round to 4 decimals: every multiplier and score part the dashboard prints. */
const r4 = (n: number): number => Math.round(n * 10_000) / 10_000;
/** Round to 6 decimals: every ratio the dashboard prints. */
const r6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** What one category's comparables say, after winsorizing, the log median, the shrink and the dispersion. */
export interface CategoryStats {
  /** The category's name as the snapshot writes it ('' when it names none). */
  category: string;
  /** How many tokenized protocols in the category carried a usable market cap and so voted. */
  comps: number;
  /** The category's raw center before the shrink: the geometric mean of its comparable ratios. */
  center_ratio: number;
  /** The multiple applied to TVL: the shrunk geometric mean of the category's comparable ratios. */
  ratio: number;
  /** The shrunk robust dispersion of the category's log-ratios (a MAD sigma, in log space). */
  sigma: number;
  /** e^sigma: the factor the row's plausible range is built with. */
  factor: number;
}

/** The comparable set as a whole: one ratio per category, plus the global fallback. */
export interface RatioTable {
  byCategory: Map<string, CategoryStats>;
  global: CategoryStats;
  /** Every category that has comparables, best-evidenced first, for the dashboard's model page. */
  categories: CategoryStats[];
  /** The pooled within-category dispersion: the anchor each category's own dispersion shrinks toward. */
  pooled_sigma: number;
}

/** The full arithmetic of one protocol's implied value, carried on its board row. */
export interface ModelBreakdown {
  category_ratio: number;
  ratio_comps: number;
  center_ratio: number;
  used_global_ratio: boolean;
  sigma: number;
  dispersion_factor: number;
  implied_low_usd: number;
  implied_high_usd: number;
  momentum_pct: number | null;
  momentum_multiplier: number;
  age_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
  confidence: number;
  confidence_evidence: number;
  confidence_agreement: number;
  confidence_completeness: number;
  tier: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: string;
  breakdown: ModelBreakdown;
  plan_note: string;
  farm_steps: string[];
}

/** The dashboard's view of one board row: the figures, the model's parts and the farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  category_ratio: number;
  ratio_comps: number;
  center_ratio: number;
  used_global_ratio: boolean;
  sigma: number;
  dispersion_factor: number;
  momentum_pct: number | null;
  momentum_multiplier: number;
  age_multiplier: number;
  breadth_multiplier: number;
  confidence: number;
  confidence_evidence: number;
  confidence_agreement: number;
  confidence_completeness: number;
  tier: string;
  plan_note: string;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own record, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  symbol: string | null;
  change_7d: number | null;
  /** Its own market-cap/TVL ratio when both figures are usable: one of the comparables the model reads. */
  ratio: number | null;
  /** Whether this protocol's ratio is one of the observations the calibration is built from. */
  comparable: boolean;
}

/** How one pricing rule did at pricing the comparables themselves, leave-one-out (see backtest). */
export interface BacktestLine {
  /** Median absolute log error against the comparables' real market caps (lower is better). */
  median_abs_log_error: number;
  /** The share of comparables priced within a factor of two of their real market cap, in per cent. */
  within_2x_pct: number;
}

/** The model's headline figures, stated on the dashboard so a reader can check the arithmetic. */
export interface ModelSummary {
  version: string;
  global_ratio: number;
  global_comps: number;
  global_sigma: number;
  global_factor: number;
  pooled_sigma: number;
  shrink_k: number;
  ratio_obs_floor: number;
  ratio_obs_cap: number;
  ratio_final_min: number;
  ratio_final_max: number;
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  maturity_base: number;
  maturity_range: number;
  maturity_days: number;
  breadth_per_chain: number;
  conf_weight_evidence: number;
  conf_weight_agreement: number;
  conf_weight_completeness: number;
  conf_evidence_k: number;
  tier_prime: number;
  tier_strong: number;
  tier_watch: number;
  backtest: { n: number; naive: BacktestLine; category: BacktestLine; full: BacktestLine };
}

/** Everything the dashboard needs: the board, the live set, the categories and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelSummary;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  comparable_size: number;
  combined_implied_usd: number;
  median_confidence: number;
  categories: CategoryStats[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped or staked product of another asset. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories that are products of a token that already trades, never a launch of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Exchange names a product of an exchange begins with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a protocol whose token already trades. This is the watchlist's own screen with no
 * TVL floor, so every watchlist slug passes it and the early rows come from the same rule.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((name) => p.name.startsWith(name))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Calibration. One observation is one tokenized protocol's winsorized log-ratio. The category
// center is the mean log-ratio (a geometric mean of ratios), shrunk toward the global center
// with a pseudo-count of RATIO_SHRINK_K global observations; the category dispersion is a robust
// MAD sigma in log space, shrunk by pooling variances toward the pooled within-category sigma —
// the typical disagreement inside a category, not the whole market's cross-category spread. A
// category with no comparables of its own is priced off the global center and the pooled sigma.
// ---------------------------------------------------------------------------

/** One calibration observation: a comparable's category key and its winsorized log-ratio. */
interface Obs {
  key: string;
  log: number;
}

/** A protocol is a comparable when it trades (not pre-token) and both its cap and TVL are real and positive. */
function isComparable(p: SnapshotProtocol): boolean {
  // A market cap of -1 is the source's "not reported" sentinel (one protocol carries it), and a
  // cap of 0 prices nothing: a comparable needs a real, positive cap on real, positive TVL.
  return !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** Every comparable in the snapshot, as observations. */
function collectObs(snapshot: Snapshot): Obs[] {
  const obs: Obs[] = [];
  for (const p of snapshot.protocols) {
    if (!isComparable(p)) continue;
    const ratio = clamp(p.mcap_usd! / p.tvl_usd, RATIO_OBS_FLOOR, RATIO_OBS_CAP);
    obs.push({ key: p.category ?? '', log: Math.log(ratio) });
  }
  return obs;
}

/** A robust dispersion in log space: the MAD of the values around their median, scaled to a sigma. */
function madSigma(values: number[], med: number): number {
  return 1.4826 * median(values.map((v) => Math.abs(v - med)));
}

/** The mean of a non-empty list of numbers. */
function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Build one category's line from its log-ratios and the global anchors. */
function categoryLine(category: string, logs: number[], globalCenter: number, pooledSigma: number): CategoryStats {
  const n = logs.length;
  const center = mean(logs);
  const shrunkLog = (n * center + RATIO_SHRINK_K * globalCenter) / (n + RATIO_SHRINK_K);
  const ownSigma = n >= 2 ? madSigma(logs, median(logs)) : pooledSigma;
  const pooledVar = (n * ownSigma * ownSigma + RATIO_SHRINK_K * pooledSigma * pooledSigma) / (n + RATIO_SHRINK_K);
  const sigma = r4(Math.max(SIGMA_FLOOR, Math.sqrt(pooledVar)));
  return {
    category,
    comps: n,
    center_ratio: r6(Math.exp(center)),
    ratio: r6(clamp(Math.exp(shrunkLog), RATIO_FINAL_MIN, RATIO_FINAL_MAX)),
    sigma,
    factor: r4(Math.exp(sigma)),
  };
}

/** The comparable set as a whole: one ratio per category, plus the global fallback. */
export function calibrate(obs: Obs[]): RatioTable {
  const all = obs.map((o) => o.log);
  // With no comparables at all there is nothing to calibrate from; the sealed snapshot always
  // carries some, and this fallback only keeps the arithmetic finite if one ever did not.
  const globalCenter = all.length > 0 ? mean(all) : Math.log(0.2);
  const globalMed = all.length > 0 ? median(all) : Math.log(0.2);
  const globalSigma = all.length >= 2 ? Math.max(SIGMA_FLOOR, madSigma(all, globalMed)) : 0.8;
  const byKey = new Map<string, number[]>();
  for (const o of obs) {
    const list = byKey.get(o.key);
    if (list === undefined) byKey.set(o.key, [o.log]);
    else list.push(o.log);
  }
  // The pooled within-category dispersion: the one-way pooled MAD sigma over every category with
  // at least two comparables — how much protocols inside one category typically disagree.
  let poolNum = 0;
  let poolDen = 0;
  for (const logs of byKey.values()) {
    if (logs.length < 2) continue;
    const s = madSigma(logs, median(logs));
    poolNum += (logs.length - 1) * s * s;
    poolDen += logs.length - 1;
  }
  const pooledSigma = poolDen > 0 ? Math.sqrt(poolNum / poolDen) : globalSigma;
  const global: CategoryStats = {
    category: 'All categories',
    comps: all.length,
    center_ratio: r6(Math.exp(globalCenter)),
    ratio: r6(clamp(Math.exp(globalCenter), RATIO_FINAL_MIN, RATIO_FINAL_MAX)),
    sigma: r4(globalSigma),
    factor: r4(Math.exp(r4(globalSigma))),
  };
  const byCategory = new Map<string, CategoryStats>();
  for (const [key, logs] of byKey) byCategory.set(key, categoryLine(key, logs, globalCenter, pooledSigma));
  const categories = [...byCategory.values()].sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1));
  return { byCategory, global, categories, pooled_sigma: r4(pooledSigma) };
}

/** The calibration of the snapshot's comparables. */
export function ratioTable(snapshot: Snapshot): RatioTable {
  return calibrate(collectObs(snapshot));
}

/** The line a protocol is priced with: its category's, or the global when its category has none. */
function statsFor(p: SnapshotProtocol, table: RatioTable): { stats: CategoryStats; usedGlobal: boolean } {
  const own = table.byCategory.get(p.category ?? '');
  if (own !== undefined) return { stats: own, usedGlobal: false };
  // Priced off the global center; its plausible band borrows the pooled within-category
  // dispersion, the typical disagreement inside a category, not the whole market's spread.
  const sigma = table.pooled_sigma;
  return { stats: { ...table.global, sigma, factor: r4(Math.exp(sigma)) }, usedGlobal: true };
}

/** The readiness tier a confidence score earns. */
export function tierFor(confidence: number): string {
  if (confidence >= TIER_PRIME) return 'Prime';
  if (confidence >= TIER_STRONG) return 'Strong';
  if (confidence >= TIER_WATCH) return 'Watch';
  return 'Speculative';
}

/** The three adjustment multipliers of one protocol, each rounded the way the dashboard prints it. */
function adjustments(p: SnapshotProtocol, asOf: string): {
  age: number | null;
  momentumPct: number | null;
  momentumMult: number;
  ageMult: number;
  breadthMult: number;
} {
  const age = ageDays(asOf, p.listed_at);
  const momentumPct = p.change_7d === null ? null : clamp(p.change_7d, MOMENTUM_FLOOR, MOMENTUM_CAP);
  const momentumMult = r4(momentumPct === null ? 1 : 1 + (momentumPct / 100) * MOMENTUM_WEIGHT);
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const ageMult = r4(MATURITY_BASE + (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE);
  const breadthMult = r4(1 + BREADTH_PER_CHAIN * Math.max(0, Math.min(p.chains.length, BREADTH_CHAINS) - 1));
  return { age, momentumPct, momentumMult, ageMult, breadthMult };
}

/** The implied value of one protocol and every part of the arithmetic, under the ratio table. */
export function impliedValue(p: SnapshotProtocol, asOf: string, table: RatioTable): { implied: number; breakdown: ModelBreakdown } {
  const { stats, usedGlobal } = statsFor(p, table);
  const adj = adjustments(p, asOf);
  const implied = Math.max(1, Math.round(p.tvl_usd * stats.ratio * adj.momentumMult * adj.ageMult * adj.breadthMult));
  const low = Math.max(1, Math.round(implied / stats.factor));
  const high = Math.round(implied * stats.factor);
  // Confidence: evidence counts the comparables behind the applied ratio (a row priced off the
  // global line because its category has none counts the global pool as one pooled observation);
  // agreement falls as the applied dispersion widens; completeness counts the fields of the
  // protocol's own record the snapshot actually reports.
  const ownComps = usedGlobal ? 0 : stats.comps;
  const nEff = ownComps > 0 ? ownComps : 1;
  const evidence = r4(nEff / (nEff + CONF_EVIDENCE_K));
  const agreement = r4(1 / (1 + stats.sigma));
  const reported = (p.change_7d !== null ? 1 : 0) + (p.listed_at !== null ? 1 : 0) + (p.category !== null ? 1 : 0) + (p.chains.length > 0 ? 1 : 0);
  const completeness = r4(reported / 4);
  const confidence = clamp(
    Math.round(100 * (CONF_WEIGHT_EVIDENCE * evidence + CONF_WEIGHT_AGREEMENT * agreement + CONF_WEIGHT_COMPLETENESS * completeness)),
    0,
    100,
  );
  return {
    implied,
    breakdown: {
      category_ratio: stats.ratio,
      ratio_comps: ownComps,
      center_ratio: stats.center_ratio,
      used_global_ratio: usedGlobal,
      sigma: stats.sigma,
      dispersion_factor: stats.factor,
      implied_low_usd: low,
      implied_high_usd: high,
      momentum_pct: adj.momentumPct,
      momentum_multiplier: adj.momentumMult,
      age_multiplier: adj.ageMult,
      breadth_multiplier: adj.breadthMult,
      age_days: adj.age,
      confidence,
      confidence_evidence: evidence,
      confidence_agreement: agreement,
      confidence_completeness: completeness,
      tier: tierFor(confidence),
    },
  };
}

// ---------------------------------------------------------------------------
// Backtest. The model's own exam: price every comparable as if it were pre-token, leaving its
// own observation out of every median it is priced with, and compare against its real market
// cap. Three rules sit the same exam: a naive single global multiple, a category median alone,
// and the full radar-3 model. The dashboard's model page and NOTES.md quote the results.
// ---------------------------------------------------------------------------

/** One rule's exam results from a list of absolute log errors. */
function examLine(errors: number[]): BacktestLine {
  if (errors.length === 0) return { median_abs_log_error: 0, within_2x_pct: 0 };
  const within = errors.filter((e) => e <= Math.log(2)).length;
  return { median_abs_log_error: r4(median(errors)), within_2x_pct: r4((100 * within) / errors.length) };
}

/** Leave-one-out backtest of the three pricing rules on the snapshot's comparables. */
export function backtest(snapshot: Snapshot): { n: number; naive: BacktestLine; category: BacktestLine; full: BacktestLine } {
  const comps = snapshot.protocols.filter(isComparable);
  const naiveErrors: number[] = [];
  const categoryErrors: number[] = [];
  const fullErrors: number[] = [];
  for (const p of comps) {
    const actual = p.mcap_usd!;
    const rest = snapshot.protocols.filter((q) => q.slug !== p.slug);
    const restSnap: Snapshot = { ...snapshot, protocols: rest };
    const obs = collectObs(restSnap);
    const table = calibrate(obs);
    // Naive: one global multiple, the plain median of every other comparable's raw ratio.
    const rawRatios = rest.filter(isComparable).map((q) => q.mcap_usd! / q.tvl_usd);
    const naiveEst = p.tvl_usd * median(rawRatios);
    // Category alone: the protocol's category median (global when its category has none left).
    const catLogs = obs.filter((o) => o.key === (p.category ?? ''));
    const categoryEst = p.tvl_usd * (catLogs.length > 0 ? Math.exp(mean(catLogs.map((o) => o.log))) : table.global.center_ratio);
    // Full radar-3: the shrunk category ratio (global line when its category has none left) and
    // the protocol's own three adjustments.
    const adj = adjustments(p, snapshot.as_of);
    const ownLine = table.byCategory.get(p.category ?? '');
    const fullEst = p.tvl_usd * (ownLine === undefined ? table.global.ratio : ownLine.ratio) * adj.momentumMult * adj.ageMult * adj.breadthMult;
    naiveErrors.push(Math.abs(Math.log(naiveEst / actual)));
    categoryErrors.push(Math.abs(Math.log(categoryEst / actual)));
    fullErrors.push(Math.abs(Math.log(fullEst / actual)));
  }
  return { n: comps.length, naive: examLine(naiveErrors), category: examLine(categoryErrors), full: examLine(fullErrors) };
}

// ---------------------------------------------------------------------------
// Farm plans. A plan is five steps: set up a dedicated wallet on the protocol's main chain, two
// core actions chosen by what the protocol does, a weekly cadence that keeps the wallet looking
// like a real user, and a hold-and-claim step that keeps the position safe. Capital scales with
// the protocol's TVL, gas with its chain, and the cadence length and hold with its age, so no two
// rows read alike. Every step names its cost and its time in the step itself.
// ---------------------------------------------------------------------------

type Step = { text: string; cost: string; time: string };

/** One plan line: the action, then its cost and its time, the way the board's readers scan for both. */
const stepText = (step: Step): string => `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;

interface GasTier {
  /** What one on-chain action costs on the chain. */
  action: string;
  /** What a week of light activity costs on the chain. */
  weekly: string;
  /** What funding the wallet for the first session costs in gas. */
  setup: string;
}

const GAS_HIGH: GasTier = { action: '$12-30 in gas', weekly: '$10-25 in gas', setup: 'about $20 in gas to fund and approve' };
const GAS_LOW: GasTier = { action: '$0.30-3 in gas', weekly: '$1-5 in gas', setup: 'about $2 in gas to fund and approve' };
const GAS_TINY: GasTier = { action: 'under $0.50 in gas', weekly: 'under $1 in gas', setup: 'under $1 in gas to fund and approve' };

/** Gas reality by chain: Ethereum mainnet is the expensive outlier, Solana is near-free, the rest are cheap. */
function gasFor(chain: string): GasTier {
  if (chain === 'Ethereum') return GAS_HIGH;
  if (chain === 'Solana') return GAS_TINY;
  return GAS_LOW;
}

/** The capital a plan commits, scaled to the protocol's size: bigger protocols reward bigger, real positions. */
function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 250;
  if (tvl >= 75_000_000) return 150;
  if (tvl >= 20_000_000) return 100;
  return 50;
}

/** A plan's shape for one protocol: the money, the cadence and the hold its own figures imply. */
interface PlanMeta {
  chain: string;
  gas: GasTier;
  capital: number;
  weeks: number;
  holdDays: number;
}

function planMeta(p: SnapshotProtocol, age: number | null): PlanMeta {
  return {
    chain: p.chains[0] ?? 'Ethereum',
    gas: gasFor(p.chains[0] ?? 'Ethereum'),
    capital: capitalFor(p.tvl_usd),
    weeks: age === null ? 6 : age < 180 ? 8 : age < 730 ? 6 : 4,
    holdDays: age === null ? 45 : age < 180 ? 60 : age < 730 ? 45 : 30,
  };
}

type Family = 'lending' | 'dex' | 'yield' | 'curator' | 'chain' | 'derivatives' | 'rwa' | 'stable' | 'staking' | 'launchpad' | 'prediction' | 'insurance' | 'payments' | 'bridge' | 'general';

/** What a protocol does, from its category: the two core steps of its plan follow from this. */
function familyOf(category: string | null): Family {
  switch (category) {
    case 'Lending':
    case 'Uncollateralized Lending':
    case 'CDP':
    case 'CDP Manager':
    case 'Collateral Markets':
    case 'Collateral Management':
      return 'lending';
    case 'Dexs':
      return 'dex';
    case 'Yield':
    case 'Yield Aggregator':
    case 'Farm':
    case 'Leveraged Farming':
    case 'Liquidity Manager':
      return 'yield';
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return 'curator';
    case 'Chain':
      return 'chain';
    case 'Derivatives':
    case 'Options':
    case 'Options Vault':
    case 'Interest Rate Derivatives':
    case 'Basis Trading':
    case 'Synthetics':
      return 'derivatives';
    case 'RWA':
      return 'rwa';
    case 'Algo-Stables':
    case 'Dual-Token Stablecoin':
    case 'Stablecoin Issuer':
    case 'Stablecoin Wrapper':
    case 'Reserve Currency':
      return 'stable';
    case 'Staking Pool':
    case 'Restaking':
    case 'Anchor BTC':
    case 'Decentralized BTC':
      return 'staking';
    case 'Launchpad':
      return 'launchpad';
    case 'Prediction Market':
      return 'prediction';
    case 'Insurance':
      return 'insurance';
    case 'Payments':
    case 'Crypto Card Issuer':
      return 'payments';
    case 'Cross Chain Bridge':
      return 'bridge';
    default:
      return 'general';
  }
}

/** The two core steps of a plan: the actions that make a wallet a real user of this kind of protocol. */
function coreSteps(family: Family, name: string, meta: PlanMeta): [Step, Step] {
  const c = `$${meta.capital}`;
  const { chain, gas } = meta;
  switch (family) {
    case 'lending':
      return [
        { text: `Supply ${c} of USDC (or the deepest stablecoin market on ${chain}) as collateral in ${name}'s largest lending market`, cost: `${gas.action} plus the ${c} supplied, which stays withdrawable`, time: '10 minutes' },
        { text: `Borrow roughly 30% against the supply, keep the loan open a full week, then repay it in full so the wallet has used both sides of the market`, cost: `${gas.action} twice, plus a few dollars of borrow interest`, time: '15 minutes, then 5 minutes a week later' },
      ];
    case 'dex':
      return [
        { text: `Route four swaps totalling about ${c} through ${name}'s main pairs on ${chain}, split across two separate days instead of one burst`, cost: `${gas.action} per swap plus normal price impact`, time: '20 minutes across two days' },
        { text: `Open a liquidity position of ${c} in the busiest stable or blue-chip pair and leave it in place`, cost: `${gas.action} to open, plus the ${c} committed`, time: '10 minutes' },
      ];
    case 'yield':
      return [
        { text: `Deposit ${c} into ${name}'s flagship vault or pool on ${chain} and keep the receipt position open`, cost: `${gas.action}, plus the ${c} committed`, time: '10 minutes' },
        { text: `Place a second, smaller deposit in a different vault or strategy inside the same app, so the history spans more than one product`, cost: `${gas.action}, plus about half the first deposit`, time: '10 minutes' },
      ];
    case 'curator':
      return [
        { text: `Deposit ${c} into the ${name} curated vault with the most deposits on ${chain}`, cost: `${gas.action}, plus the ${c} committed`, time: '10 minutes' },
        { text: `Add a smaller position in a second vault run on a different strategy, and claim any vault rewards the app issues along the way`, cost: `${gas.action}, plus about half the first deposit`, time: '10 minutes' },
      ];
    case 'chain':
      return [
        { text: `Bridge ${c} onto ${chain} through the canonical route, then make the first native transactions: one swap and one transfer`, cost: 'the bridge fee plus $5-15 of gas across the session', time: '25 minutes' },
        { text: `Work two native apps on ${chain} — a DEX and a lending market — so the wallet's activity spans contract types, not only transfers`, cost: `${gas.action} per app, plus the amounts used`, time: '20 minutes' },
      ];
    case 'derivatives':
      return [
        { text: `Post ${c} of margin in ${name} on ${chain} and open one small position, sized or hedged so an ordinary move cannot liquidate it`, cost: `${gas.action} plus trading fees of roughly 0.1% of the position`, time: '15 minutes' },
        { text: `Trade a second instrument the app lists, or roll the first position once, so the account shows repeat trading rather than a single touch`, cost: `${gas.action} plus trading fees`, time: '15 minutes' },
      ];
    case 'rwa':
      return [
        { text: `Finish any onboarding ${name} requires, then buy or mint ${c} of its tokenized asset on ${chain}`, cost: `${gas.action}, plus the ${c} committed`, time: '20 minutes including onboarding' },
        { text: `Hold the asset, and where the app offers a venue for it, supply a smaller second position to its lending or liquidity market`, cost: `${gas.action}, plus about half the first amount`, time: '10 minutes' },
      ];
    case 'stable':
      return [
        { text: `Mint ${c} of ${name}'s stablecoin against the app's standard collateral type on ${chain}`, cost: `${gas.action}, plus the collateral locked`, time: '15 minutes' },
        { text: `Put the minted stablecoin to work in a lending market or stable pair the app points to, so both the mint and the use are on record`, cost: `${gas.action}, plus the minted amount supplied`, time: '10 minutes' },
      ];
    case 'staking':
      return [
        { text: `Stake ${c} of the chain's asset through ${name} on ${chain} and keep the staking receipt in the wallet`, cost: `${gas.action}, plus the ${c} staked`, time: '10 minutes' },
        { text: `Use the receipt token once — as collateral in a lending market or inside a vault — so the wallet shows the full staking loop`, cost: `${gas.action}, plus the receipt committed`, time: '10 minutes' },
      ];
    case 'launchpad':
      return [
        { text: `Deposit or stake ${c} in ${name} on ${chain} early enough to sit in the qualifying tier before the next sale snapshot`, cost: `${gas.action}, plus the ${c} committed`, time: '10 minutes' },
        { text: `Take a small ticket in one actual launch instead of only watching from the sidelines`, cost: 'the ticket amount, kept under the qualifying deposit', time: '15 minutes on launch day' },
      ];
    case 'prediction':
      return [
        { text: `Fund ${c} in ${name} and take small positions in three different markets, at least one of them long-dated`, cost: `${gas.action}, plus the ${c} spread across positions`, time: '20 minutes' },
        { text: `Add liquidity to one market, or trade a second category of market, so the account is not one-note`, cost: `${gas.action}, plus about $25 of positions`, time: '15 minutes' },
      ];
    case 'insurance':
      return [
        { text: `Buy one month of cover in ${name} on about ${c} of value against a common risk — a large protocol failure or a stablecoin depeg`, cost: 'the cover premium, roughly 2-4% of the covered value', time: '10 minutes' },
        { text: `If the underwriting pool is open to the public, stake a smaller amount into it so the wallet appears on both sides of the product`, cost: `${gas.action}, plus the amount staked`, time: '10 minutes' },
      ];
    case 'payments':
      return [
        { text: `Open a ${name} account, fund it with ${c}, and make the first real payments through the app or card`, cost: "the funded amount itself; fees follow the app's published schedule", time: '20 minutes including signup' },
        { text: `Keep a small recurring weekly spend running through ${name} instead of a single deposit left idle`, cost: 'about $10-20 a week of ordinary spending rerouted', time: '5 minutes a week' },
      ];
    case 'bridge':
      return [
        { text: `Bridge ${c} through ${name} to ${chain === 'Ethereum' ? 'a low-fee chain' : chain}, then bridge back on a different day, keeping both directions on record`, cost: 'the bridge fee both ways, roughly $2-10 in total', time: '15 minutes per direction' },
        { text: `Bridge a smaller amount to a second destination chain the app serves, so the routes span more than one corridor`, cost: 'the bridge fee, roughly $1-5', time: '15 minutes' },
      ];
    default:
      return [
        { text: `Make a first real deposit of ${c} into ${name}'s main product on ${chain}`, cost: `${gas.action}, plus the ${c} committed`, time: '10 minutes' },
        { text: `Use a second feature the app offers — a swap, a vote, a stake or a borrow — so the wallet is not a single-action address`, cost: `${gas.action}, plus any amount the feature needs`, time: '10 minutes' },
      ];
  }
}

/**
 * The concrete plan for positioning in one protocol: five steps, each with its cost and its time.
 * Every figure in the plan comes from the protocol's own row — its chain sets the gas, its TVL
 * the capital, its age the cadence and the hold — so plans differ across the board the way the
 * protocols themselves differ.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): { steps: string[]; meta: PlanMeta } {
  const meta = planMeta(p, age);
  const [coreA, coreB] = coreSteps(familyOf(p.category), p.name, meta);
  const steps: Step[] = [
    {
      text: `Create a fresh wallet for ${p.name} and fund it on ${meta.chain} with the gas token plus the stablecoins the plan uses; never farm from a wallet that holds your main funds`,
      cost: meta.gas.setup,
      time: '10 minutes',
    },
    coreA,
    coreB,
    {
      text: `Repeat one qualifying action in ${p.name} every week for ${meta.weeks} weeks — a small deposit, swap or claim — varying the day and the amount so the history reads as a person, not a script`,
      cost: `${meta.gas.weekly} a week, about ${meta.weeks} weeks in total`,
      time: `10 minutes a week for ${meta.weeks} weeks`,
    },
    {
      text: `Hold the position for at least ${meta.holdDays} days, check ${p.name}'s official points or rewards page weekly, and claim only through the official app — a launch never charges a fee to claim, so any page that asks for one is a fake`,
      cost: 'no fee to check or to claim through the official app',
      time: `${meta.holdDays} days of holding, 5 minutes a week to check`,
    },
  ];
  return { steps: steps.map(stepText), meta };
}

/** The one-line priority and effort note a row carries beside its plan. */
function planNote(rank: number, boardSize: number, meta: PlanMeta, confidence: number, tier: string): string {
  const priority = rank <= 20 ? 'High' : rank <= 75 ? 'Medium' : 'Low';
  return (
    `Priority: ${priority} (rank ${rank} of ${boardSize}). Effort: about $${meta.capital} committed plus gas on ${meta.chain}; ` +
    `roughly 35 minutes to set up, then 10 minutes a week for ${meta.weeks} weeks. Radar-3 confidence ${confidence}/100 (${tier}).`
  );
}

/** The whole ranked board: every rankable protocol, priced by the model, best implied value first. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const table = ratioTable(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) {
    if (watch.has(p.slug) && isPreToken(p)) chosen.set(p.slug, p);
    else if (isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = impliedValue(p, snapshot.as_of, table);
    const { steps, meta } = farmSteps(p, breakdown.age_days);
    return { p, implied, breakdown, steps, meta };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map(({ p, implied, breakdown, steps, meta }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    on_watchlist: watch.has(p.slug),
    age_days: breakdown.age_days,
    implied_value_usd: implied,
    model: MODEL_VERSION,
    breakdown,
    plan_note: planNote(i + 1, scored.length, meta, breakdown.confidence, breakdown.tier),
    farm_steps: steps,
  }));
}

/** The live-token view's rows: every protocol that records a token, by market cap, unusable caps last. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => {
      const am = a.mcap_usd !== null && a.mcap_usd > 0 ? a.mcap_usd : -1;
      const bm = b.mcap_usd !== null && b.mcap_usd > 0 ? b.mcap_usd : -1;
      return bm - am || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1);
    })
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      symbol: p.symbol,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 ? r6(p.mcap_usd / p.tvl_usd) : null,
      comparable: isComparable(p),
    }));
}

/** Everything one run produces: the ranked board itself, and the dashboard's view of it. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const table = ratioTable(snapshot);
  const watch = new Set(snapshot.watchlist);
  const confidences = board.map((row) => row.breakdown.confidence).sort((a, b) => a - b);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      version: MODEL_VERSION,
      global_ratio: table.global.ratio,
      global_comps: table.global.comps,
      global_sigma: table.global.sigma,
      global_factor: table.global.factor,
      pooled_sigma: table.pooled_sigma,
      shrink_k: RATIO_SHRINK_K,
      ratio_obs_floor: RATIO_OBS_FLOOR,
      ratio_obs_cap: RATIO_OBS_CAP,
      ratio_final_min: RATIO_FINAL_MIN,
      ratio_final_max: RATIO_FINAL_MAX,
      momentum_weight: MOMENTUM_WEIGHT,
      momentum_floor: MOMENTUM_FLOOR,
      momentum_cap: MOMENTUM_CAP,
      maturity_base: MATURITY_BASE,
      maturity_range: MATURITY_RANGE,
      maturity_days: MATURITY_DAYS,
      breadth_per_chain: BREADTH_PER_CHAIN,
      conf_weight_evidence: CONF_WEIGHT_EVIDENCE,
      conf_weight_agreement: CONF_WEIGHT_AGREEMENT,
      conf_weight_completeness: CONF_WEIGHT_COMPLETENESS,
      conf_evidence_k: CONF_EVIDENCE_K,
      tier_prime: TIER_PRIME,
      tier_strong: TIER_STRONG,
      tier_watch: TIER_WATCH,
      backtest: backtest(snapshot),
    },
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((row) => !watch.has(row.slug)).length,
    live_size: live.length,
    comparable_size: table.global.comps,
    combined_implied_usd: board.reduce((sum, row) => sum + row.implied_value_usd, 0),
    median_confidence: confidences.length > 0 ? median(confidences) : 0,
    categories: table.categories,
    rows: board.map((row) => ({
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      listed_at: row.listed_at,
      age_days: row.age_days,
      on_watchlist: row.on_watchlist,
      implied_value_usd: row.implied_value_usd,
      implied_low_usd: row.breakdown.implied_low_usd,
      implied_high_usd: row.breakdown.implied_high_usd,
      category_ratio: row.breakdown.category_ratio,
      ratio_comps: row.breakdown.ratio_comps,
      center_ratio: row.breakdown.center_ratio,
      used_global_ratio: row.breakdown.used_global_ratio,
      sigma: row.breakdown.sigma,
      dispersion_factor: row.breakdown.dispersion_factor,
      momentum_pct: row.breakdown.momentum_pct,
      momentum_multiplier: row.breakdown.momentum_multiplier,
      age_multiplier: row.breakdown.age_multiplier,
      breadth_multiplier: row.breakdown.breadth_multiplier,
      confidence: row.breakdown.confidence,
      confidence_evidence: row.breakdown.confidence_evidence,
      confidence_agreement: row.breakdown.confidence_agreement,
      confidence_completeness: row.breakdown.confidence_completeness,
      tier: row.breakdown.tier,
      plan_note: row.plan_note,
      farm_steps: row.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** Read the sealed snapshot document into the typed shape the model scores, or say why not. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('the snapshot is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('the snapshot document must be a JSON object');
  const doc = raw as Record<string, unknown>;
  const as_of = doc.as_of;
  const source = doc.source;
  const floor = doc.floor_usd;
  if (typeof as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(as_of)) throw new SnapshotError('snapshot.as_of must be a YYYY-MM-DD date string');
  if (typeof source !== 'string' || source.trim() === '') throw new SnapshotError('snapshot.source must be a non-empty string');
  if (typeof floor !== 'number' || !Number.isFinite(floor) || floor < 0) throw new SnapshotError('snapshot.floor_usd must be a finite, non-negative number');
  if (!Array.isArray(doc.protocols) || doc.protocols.length === 0) throw new SnapshotError('snapshot.protocols must be a non-empty array');
  if (!Array.isArray(doc.watchlist)) throw new SnapshotError('snapshot.watchlist must be an array');
  const seen = new Set<string>();
  const protocols: SnapshotProtocol[] = doc.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new SnapshotError(`protocols[${i}] must be an object`);
    const p = entry as Record<string, unknown>;
    const str = (key: string): string => {
      const v = p[key];
      if (typeof v !== 'string' || v.trim() === '') throw new SnapshotError(`protocols[${i}].${key} must be a non-empty string`);
      return v;
    };
    const strOrNull = (key: string): string | null => {
      const v = p[key];
      if (v === null || v === undefined) return null;
      if (typeof v !== 'string') throw new SnapshotError(`protocols[${i}].${key} must be a string or null`);
      return v;
    };
    const num = (key: string): number => {
      const v = p[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new SnapshotError(`protocols[${i}].${key} must be a finite number`);
      return v;
    };
    const numOrNull = (key: string): number | null => {
      const v = p[key];
      if (v === null || v === undefined) return null;
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new SnapshotError(`protocols[${i}].${key} must be a number or null`);
      return v;
    };
    if (!Array.isArray(p.chains) || p.chains.some((c) => typeof c !== 'string')) throw new SnapshotError(`protocols[${i}].chains must be an array of strings`);
    const listedAt = strOrNull('listed_at');
    if (listedAt !== null && !/^\d{4}-\d{2}-\d{2}$/.test(listedAt)) throw new SnapshotError(`protocols[${i}].listed_at must be a YYYY-MM-DD date or null`);
    const slug = str('slug');
    if (seen.has(slug)) throw new SnapshotError(`duplicate protocol slug "${slug}"`);
    seen.add(slug);
    const tvl = num('tvl_usd');
    if (tvl < 0) throw new SnapshotError(`protocols[${i}].tvl_usd must not be negative`);
    const mcap = numOrNull('mcap_usd');
    return {
      slug,
      name: str('name'),
      category: strOrNull('category'),
      chains: p.chains as string[],
      tvl_usd: tvl,
      change_7d: numOrNull('change_7d'),
      mcap_usd: mcap,
      listed_at: listedAt,
      gecko_id: strOrNull('gecko_id'),
      symbol: strOrNull('symbol'),
    };
  });
  const watchlist = doc.watchlist.map((slug, i) => {
    if (typeof slug !== 'string' || slug.trim() === '') throw new SnapshotError(`watchlist[${i}] must be a non-empty string`);
    return slug;
  });
  for (const slug of watchlist) {
    if (!seen.has(slug)) throw new SnapshotError(`watchlist slug "${slug}" is not a protocol in the snapshot`);
  }
  return { as_of, source, floor_usd: floor, protocols, watchlist };
}

/**
 * The first board requirement this board breaks, or null when it breaks none: every row a snapshot
 * protocol exactly once, every watchlist slug present, values whole, positive, within the bound and
 * never rising as rank ascends, not all equal, ranges ordered around the value, confidences in
 * bounds, and every plan inside its step and length bounds.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allEqual = board.length > 0;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${i + 1} carries rank ${row.rank}`;
    const proto = bySlug.get(row.slug);
    if (proto === undefined) return `rank ${row.rank} (${row.slug}) is not a protocol in the snapshot`;
    if (seen.has(row.slug)) return `protocol ${row.slug} appears on the board twice`;
    seen.add(row.slug);
    if (row.name !== proto.name) return `rank ${row.rank} (${row.slug}) carries a name the snapshot does not`;
    if (row.token_status !== 'pre-token') return `rank ${row.rank} (${row.slug}) is not marked pre-token`;
    const v = row.implied_value_usd;
    if (!Number.isInteger(v) || v <= 0 || v > 100_000_000_000_000) return `rank ${row.rank} (${row.slug}) carries an implied value outside the whole, positive bound`;
    if (v > previous) return `implied value rises at rank ${row.rank} (${row.slug})`;
    if (i > 0 && v !== board[0]!.implied_value_usd) allEqual = false;
    previous = v;
    const b = row.breakdown;
    if (!Number.isInteger(b.implied_low_usd) || !Number.isInteger(b.implied_high_usd) || b.implied_low_usd < 1 || b.implied_low_usd > v || b.implied_high_usd < v) {
      return `rank ${row.rank} (${row.slug}) carries a range that does not bracket its implied value`;
    }
    if (!Number.isInteger(b.confidence) || b.confidence < 0 || b.confidence > 100) return `rank ${row.rank} (${row.slug}) carries a confidence outside 0-100`;
    if (![b.category_ratio, b.sigma, b.dispersion_factor, b.momentum_multiplier, b.age_multiplier, b.breadth_multiplier].every(Number.isFinite)) {
      return `rank ${row.rank} (${row.slug}) carries a non-finite model figure`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `rank ${row.rank} (${row.slug}) carries ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const length = step.trim().length;
      if (length < 20 || length > 600) return `rank ${row.rank} (${row.slug}) carries a farm step of ${length} characters`;
    }
  }
  if (allEqual && board.length > 1) return 'every implied value on the board is equal';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: the radar's whole payload as one script assignment. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
