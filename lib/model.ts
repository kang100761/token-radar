// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// radar-2 prices a protocol that records no token the way the market prices the ones that already
// trade. Every tokenized protocol in the same snapshot is a comparable: its market-cap/TVL ratio says
// what one dollar of locked value is worth once a token exists. The model takes the median ratio of
// each category's comparables, shrinks thin categories toward the global median, and applies it to a
// pre-token protocol's TVL, adjusted by three things the snapshot itself reports:
//
//   implied = round( tvl_usd x category_ratio x momentum x maturity x breadth )
//
//   category_ratio  the shrunk median mcap/TVL of the category's tokenized protocols (see below)
//   momentum        1 + 0.45 x clamp(change_7d, -40, 60) / 100; a protocol with no reported
//                   seven-day change is neutral at exactly 1
//   maturity        0.75 + 0.45 x min(age_days, 1460) / 1460: the longer a protocol has run with
//                   no token, the more of a launch its record supports; an unknown age counts 365
//   breadth         1 + 0.04 for every chain past the first, up to six chains: a protocol that
//                   holds value on several chains has more holders to launch to
//
// The board's universe is the house's own screen with no TVL floor: a protocol is rankable when it
// records no token (no market cap, no CoinGecko id, no symbol) and is not a wrapped, staked or
// bridged product of one that trades — its category is not Bridge, Canonical Bridge, Liquid Staking,
// Liquid Restaking, Restaked BTC or CEX, its name ends in no version marker, carries no whole word
// wrapped, staked or staking, and begins with no exchange's name. Every watchlist slug passes that
// screen by construction, so the watchlist is covered whole, and the same screen at any TVL finds
// the early protocols below the $50M floor. No protocol name is ever special-cased: one function
// scores every row, and the tokenized protocols are set aside as the comparable set, never ranked.

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
export const MODEL_VERSION = 'radar-2';

/** One comparable ratio before it is trusted: a single protocol's mcap/TVL is winsorized to this band. */
export const RATIO_OBS_FLOOR = 0.02;
export const RATIO_OBS_CAP = 5;
/** A category median is shrunk toward the global median as if the global had this many observations. */
export const RATIO_SHRINK_K = 6;
/** No category's final multiple leaves this band, however its comparables voted. */
export const RATIO_FINAL_MIN = 0.03;
export const RATIO_FINAL_MAX = 3;
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
/** How many live-token protocols the dashboard's Live token view carries, by market cap. */
export const LIVE_ROWS = 32;

/** What one category's comparables say, after winsorizing, the median and the shrink. */
export interface CategoryRatio {
  /** The multiple applied to TVL: the shrunk median of the category's comparable ratios. */
  ratio: number;
  /** How many tokenized protocols in the category carried a market cap and so voted. */
  comps: number;
  /** The category's raw median before the shrink toward the global median. */
  median: number;
}

/** The comparable set as a whole: one ratio per category, plus the global fallback. */
export interface RatioTable {
  byCategory: Map<string, CategoryRatio>;
  global: CategoryRatio;
}

/** The full arithmetic of one protocol's implied value, carried on its board row. */
export interface ModelBreakdown {
  category_ratio: number;
  ratio_comps: number;
  momentum_pct: number | null;
  momentum_multiplier: number;
  age_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
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
  model: ModelBreakdown;
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
  category_ratio: number;
  ratio_comps: number;
  momentum_multiplier: number;
  age_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  /** Its own market-cap/TVL ratio when both figures exist: one of the comparables the model reads. */
  ratio: number | null;
}

/** The model's headline figures, stated on the dashboard so a reader can check the arithmetic. */
export interface ModelSummary {
  version: string;
  global_ratio: number;
  global_comps: number;
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  maturity_base: number;
  maturity_range: number;
  maturity_days: number;
  breadth_per_chain: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
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

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

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

/**
 * The comparable set: every tokenized protocol with a market cap and a TVL is one observation of
 * what a dollar of TVL is worth with a token. Ratios are winsorized, taken as a median per
 * category, then shrunk toward the global median by the category's observation count, so a
 * category with one wild comparable cannot price a whole board on its own.
 */
export function ratioTable(snapshot: Snapshot): RatioTable {
  const observed = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    // A market cap of -1 is the source's "not reported" sentinel (one protocol carries it): a
    // comparable needs a real, positive cap, so anything not positive never votes.
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, RATIO_OBS_FLOOR, RATIO_OBS_CAP);
    const key = p.category ?? '';
    const list = observed.get(key);
    if (list === undefined) observed.set(key, [ratio]);
    else list.push(ratio);
    all.push(ratio);
  }
  const globalMedian = all.length > 0 ? median(all) : 0.2;
  const global: CategoryRatio = { ratio: clamp(globalMedian, RATIO_FINAL_MIN, RATIO_FINAL_MAX), comps: all.length, median: globalMedian };
  const byCategory = new Map<string, CategoryRatio>();
  for (const [key, values] of observed) {
    const med = median(values);
    const shrunk = (values.length * med + RATIO_SHRINK_K * globalMedian) / (values.length + RATIO_SHRINK_K);
    byCategory.set(key, { ratio: clamp(shrunk, RATIO_FINAL_MIN, RATIO_FINAL_MAX), comps: values.length, median: med });
  }
  return { byCategory, global };
}

/** The ratio a protocol is priced with: its category's, or the global when its category has no comparables. */
function ratioFor(p: SnapshotProtocol, table: RatioTable): CategoryRatio {
  return table.byCategory.get(p.category ?? '') ?? table.global;
}

/** The implied value of one protocol and every part of the arithmetic, under the ratio table. */
export function impliedValue(p: SnapshotProtocol, asOf: string, table: RatioTable): { implied: number; model: ModelBreakdown } {
  const { ratio, comps } = ratioFor(p, table);
  const age = ageDays(asOf, p.listed_at);
  const momentumPct = p.change_7d === null ? null : clamp(p.change_7d, MOMENTUM_FLOOR, MOMENTUM_CAP);
  const momentumMult = momentumPct === null ? 1 : 1 + (momentumPct / 100) * MOMENTUM_WEIGHT;
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const ageMult = MATURITY_BASE + (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
  const breadthMult = 1 + BREADTH_PER_CHAIN * Math.max(0, Math.min(p.chains.length, BREADTH_CHAINS) - 1);
  const implied = Math.max(1, Math.round(p.tvl_usd * ratio * momentumMult * ageMult * breadthMult));
  return {
    implied,
    model: {
      category_ratio: ratio,
      ratio_comps: comps,
      momentum_pct: momentumPct,
      momentum_multiplier: momentumMult,
      age_multiplier: ageMult,
      breadth_multiplier: breadthMult,
      age_days: age,
    },
  };
}

// ---------------------------------------------------------------------------
// Farm plans. A plan is five steps: set up a wallet on the protocol's main chain, two core actions
// chosen by what the protocol does, a weekly cadence that keeps the wallet looking like a real user,
// and a hold-and-claim step that keeps the position safe. Capital scales with the protocol's TVL,
// gas with its chain, and the cadence length and hold with its age, so no two rows read alike.
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

const GAS_HIGH: GasTier = { action: '$12–30 in gas', weekly: '$10–25 in gas', setup: 'about $20 in gas to fund and approve' };
const GAS_LOW: GasTier = { action: '$0.30–3 in gas', weekly: '$1–5 in gas', setup: 'about $2 in gas to fund and approve' };
const GAS_TINY: GasTier = { action: 'under $0.50 in gas', weekly: 'under $1 in gas', setup: 'under $1 in gas to fund and approve' };

/** Gas reality by chain: Ethereum mainnet is the expensive outlier, Solana is near-free, the rest are cheap. */
function gasFor(chain: string): GasTier {
  if (chain === 'Ethereum') return GAS_HIGH;
  if (chain === 'Solana') return GAS_TINY;
  return GAS_LOW;
}

/** The capital a plan commits, scaled to the protocol's size: bigger protocols reward bigger, real positions. */
function capitalFor(tvl: number): number {
  if (tvl >= 2_000_000_000) return 500;
  if (tvl >= 500_000_000) return 250;
  if (tvl >= 100_000_000) return 150;
  if (tvl >= 25_000_000) return 100;
  return 50;
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
function coreSteps(family: Family, name: string, chain: string, capital: number, gas: GasTier): [Step, Step] {
  const c = `$${capital}`;
  switch (family) {
    case 'lending':
      return [
        { text: `Supply ${c} of USDC (or the main stablecoin on ${chain}) as collateral in ${name}'s largest market`, cost: `${gas.action} plus the ${c} supplied, which stays withdrawable`, time: '10 minutes' },
        { text: `Borrow about 30% of the supplied value, hold the loan for a week, then repay in full so the wallet shows both sides of the market`, cost: `${gas.action} twice, plus a few dollars of borrow interest`, time: '15 minutes, then 5 minutes a week later' },
      ];
    case 'dex':
      return [
        { text: `Make four swaps totalling about ${c} across ${name}'s main pairs on ${chain}, spread over two days rather than in one burst`, cost: `${gas.action} per swap plus normal price impact`, time: '20 minutes across two days' },
        { text: `Add ${c} of liquidity to the busiest stable or blue-chip pair and leave the position open`, cost: `${gas.action} to open, plus the ${c} committed`, time: '10 minutes' },
      ];
    case 'yield':
      return [
        { text: `Deposit ${c} into ${name}'s flagship vault or pool on ${chain} and keep the receipt position open`, cost: `${gas.action}, plus the ${c} committed`, time: '10 minutes' },
        { text: `Put a second, smaller deposit into a different vault or strategy the app offers, so activity spans more than one product`, cost: `${gas.action}, plus about half the first deposit`, time: '10 minutes' },
      ];
    case 'curator':
      return [
        { text: `Deposit ${c} into one of ${name}'s curated vaults on ${chain}, choosing the vault with the most deposits`, cost: `${gas.action}, plus the ${c} committed`, time: '10 minutes' },
        { text: `Add a smaller position in a second vault with a different strategy, and claim any vault rewards the app issues along the way`, cost: `${gas.action}, plus about half the first deposit`, time: '10 minutes' },
      ];
    case 'chain':
      return [
        { text: `Bridge ${c} onto ${chain} through the chain's canonical route and make the first transactions: one swap and one transfer`, cost: 'the bridge fee plus $5–15 of gas across the session', time: '25 minutes' },
        { text: `Use two native apps on ${chain} — a DEX and a lending market — so the wallet's activity spans contract types, not just transfers`, cost: `${gas.action} per app, plus the amounts used`, time: '20 minutes' },
      ];
    case 'derivatives':
      return [
        { text: `Deposit ${c} of margin in ${name} on ${chain} and open one small position, hedged or sized so a normal move cannot liquidate it`, cost: `${gas.action} plus trading fees of roughly 0.1% of the position`, time: '15 minutes' },
        { text: `Trade a second market or instrument the app lists, or roll the first position once, so the account shows repeat trading rather than a single touch`, cost: `${gas.action} plus trading fees`, time: '15 minutes' },
      ];
    case 'rwa':
      return [
        { text: `Complete any onboarding ${name} requires, then buy or mint ${c} of its tokenized asset on ${chain}`, cost: `${gas.action}, plus the ${c} committed`, time: '20 minutes including onboarding' },
        { text: `Hold the asset and, where the app offers one, supply it to its lending or liquidity venue for a smaller second position`, cost: `${gas.action}, plus about half the first amount`, time: '10 minutes' },
      ];
    case 'stable':
      return [
        { text: `Mint ${c} of ${name}'s stablecoin against collateral on ${chain}, using the app's standard collateral type`, cost: `${gas.action}, plus the collateral locked`, time: '15 minutes' },
        { text: `Supply the minted stablecoin to a lending market or a stable pair the app points to, so both minting and use are on record`, cost: `${gas.action}, plus the minted amount supplied`, time: '10 minutes' },
      ];
    case 'staking':
      return [
        { text: `Stake ${c} of the chain's asset through ${name} on ${chain} and keep the staking receipt in the wallet`, cost: `${gas.action}, plus the ${c} staked`, time: '10 minutes' },
        { text: `Use the receipt token once — as collateral in a lending market or inside a vault — so the wallet shows the full staking loop`, cost: `${gas.action}, plus the receipt committed`, time: '10 minutes' },
      ];
    case 'launchpad':
      return [
        { text: `Deposit or stake ${c} in ${name} on ${chain} to qualify for the next sale tier before its snapshot`, cost: `${gas.action}, plus the ${c} committed`, time: '10 minutes' },
        { text: `Take part in one launch with a small ticket rather than watching from the sidelines`, cost: 'the ticket amount, kept under the qualifying deposit', time: '15 minutes on launch day' },
      ];
    case 'prediction':
      return [
        { text: `Fund ${c} in ${name} and take small positions in three different markets, at least one of them long-dated`, cost: `${gas.action}, plus the ${c} spread across positions`, time: '20 minutes' },
        { text: `Add liquidity to one market or trade a second category of market, so the account is not one-note`, cost: `${gas.action}, plus about $25 of positions`, time: '15 minutes' },
      ];
    case 'insurance':
      return [
        { text: `Buy cover in ${name} for about ${c} of value on a common risk (a large protocol or a stablecoin depeg) for one month`, cost: 'the cover premium, roughly 2–4% of the covered value', time: '10 minutes' },
        { text: `If the underwriting pool is open, stake a smaller amount into it so the wallet appears on both sides of the product`, cost: `${gas.action}, plus the amount staked`, time: '10 minutes' },
      ];
    case 'payments':
      return [
        { text: `Open a ${name} account, fund ${c}, and make the first real payments through the app or card`, cost: 'the funded amount itself; fees follow the app\'s published schedule', time: '20 minutes including signup' },
        { text: `Keep a small recurring weekly spend running through ${name} rather than a single deposit-and-idle balance`, cost: 'about $10–20 a week of ordinary spending rerouted', time: '5 minutes a week' },
      ];
    case 'bridge':
      return [
        { text: `Bridge ${c} through ${name} to ${chain === 'Ethereum' ? 'a low-fee chain' : chain} and back on a different day, keeping both directions on record`, cost: 'the bridge fee both ways, roughly $2–10 total', time: '15 minutes per direction' },
        { text: `Bridge a smaller amount to a second destination chain the app serves, so routes span more than one corridor`, cost: 'the bridge fee, roughly $1–5', time: '15 minutes' },
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
 * Every figure in the plan comes from the protocol's own row — its chain sets the gas, its TVL the
 * capital, its age the cadence and the hold — so plans differ across the board the way the
 * protocols themselves differ.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = gasFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const [coreA, coreB] = coreSteps(familyOf(p.category), p.name, chain, capital, gas);
  const weeks = age === null ? 6 : age < 180 ? 8 : age < 730 ? 6 : 4;
  const holdDays = age === null ? 45 : age < 180 ? 60 : age < 730 ? 45 : 30;
  const steps: Step[] = [
    {
      text: `Create a fresh wallet for ${p.name} and fund it on ${chain} with the gas token plus the stablecoins the plan uses; never farm it from a wallet that holds your main funds`,
      cost: gas.setup,
      time: '10 minutes',
    },
    coreA,
    coreB,
    {
      text: `Repeat one qualifying action in ${p.name} every week for ${weeks} weeks — a small deposit, swap or claim — and vary the day and the amount so the history reads as a person, not a script`,
      cost: `${gas.weekly} a week, about ${weeks} weeks in total`,
      time: `10 minutes a week for ${weeks} weeks`,
    },
    {
      text: `Hold the position for at least ${holdDays} days, check ${p.name}'s official points or rewards page weekly, and claim only through the official app — a launch never charges a fee to claim, so any page that asks for one is a fake`,
      cost: 'no fee to check or to claim through the official app',
      time: `${holdDays} days of holding, 5 minutes a week to check`,
    },
  ];
  return steps.map(stepText);
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
    const { implied, model } = impliedValue(p, snapshot.as_of, table);
    return { p, implied, model };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map(({ p, implied, model }, i) => ({
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
    age_days: model.age_days,
    implied_value_usd: implied,
    model,
    farm_steps: farmSteps(p, model.age_days),
  }));
}

/** The live-token view's rows: the largest tokenized protocols outside the exchanges, by market cap. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 ? p.mcap_usd / p.tvl_usd : null,
    }));
}

/** Everything one run produces: the ranked board itself, and the dashboard's view of it. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const table = ratioTable(snapshot);
  const watch = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      version: MODEL_VERSION,
      global_ratio: table.global.ratio,
      global_comps: table.global.comps,
      momentum_weight: MOMENTUM_WEIGHT,
      momentum_floor: MOMENTUM_FLOOR,
      momentum_cap: MOMENTUM_CAP,
      maturity_base: MATURITY_BASE,
      maturity_range: MATURITY_RANGE,
      maturity_days: MATURITY_DAYS,
      breadth_per_chain: BREADTH_PER_CHAIN,
    },
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((row) => !watch.has(row.slug)).length,
    live_size: live.length,
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
      category_ratio: row.model.category_ratio,
      ratio_comps: row.model.ratio_comps,
      momentum_multiplier: row.model.momentum_multiplier,
      age_multiplier: row.model.age_multiplier,
      breadth_multiplier: row.model.breadth_multiplier,
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
 * never rising as rank ascends, not all equal, and every plan inside its step and length bounds.
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
