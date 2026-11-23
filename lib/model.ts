/**
 * Token Radar — value model (lib/model.ts)
 *
 * Written from scratch for bounty token-radar-01. Node 22 standard library
 * only; this file has no imports at all. It reads only the numbers in the
 * sealed snapshot (TVL, 7-day change, listing date, chains, category, token
 * record) and derives everything else from them. No protocol name, slug or
 * watchlist position is ever hardcoded into a value: the watchlist is read
 * from the snapshot itself, and every multiplier below is a function of the
 * snapshot's own figures.
 *
 * Snapshot: DefiLlama protocols, as_of 2026-11-14, floor $50,000,000,
 * 758 protocols, watchlist 40. All calibration numbers in this file were
 * computed from that snapshot (see BOARD_STATS.md); if the snapshot ever
 * changed, K would need re-calibration, the formulas would not.
 *
 * ---------------------------------------------------------------- model
 *
 *   implied = K * TVL^0.85 * growth * age * chain * category
 *
 *   K              = 4.11
 *   TVL^0.85       sub-linear TVL: a linear TVL term lets the giants eat
 *                  the board (top-1 = 27.6% of total implied on the starter
 *                  formula). ^0.85 compresses max/median from ~4,240x to
 *                  ~1,014x while keeping the top-10 set unchanged
 *                  (Spearman rho 0.9937 vs the linear starter).
 *   growth         1 + 0.0075 * clamp(change_7d, -60, +120), then clamped
 *                  to [0.55, 1.90]. Stronger than the starter's 0.5 weight
 *                  (range 0.70-1.60) but still bounded: the +4,448% Shift
 *                  DeFi outlier is clamped to +120% and can at most
 *                  multiply by 1.90. Null change_7d -> 1.00 (neutral).
 *   age            0.55 + 0.45 * (1 - exp(-ageDays / 400)), saturating at
 *                  ~2 years (730 days -> 0.927, 95% of the way there), then
 *                  a "never launched" discount for very old protocols with
 *                  no token: * (1 - 0.10 * min(1, (age - 730) / 1095)) for
 *                  age > 730. Peak value is a ~2-year-old protocol; a
 *                  4.3-year-old one (Lofty) scores 0.916, below the peak.
 *                  Null listed_at -> 365 days (factor 0.819).
 *   chain          1 + 0.04 * min(chains - 1, 5): single-chain 1.00,
 *                  6+ chains capped at 1.20.
 *   category       diversification factor computed from the snapshot at
 *                  run time, never a per-name table: share = the category's
 *                  share of the strict-rankable pool; factor =
 *                  clamp(1.06 - 0.9 * share, 0.92, 1.08). The most crowded
 *                  category (Risk Curators, 17.2% of the pool) gets 0.92,
 *                  RWA (8.1%) gets 0.99, a one-protocol category gets 1.06.
 *                  This keeps the two dominant watchlist categories
 *                  (Risk Curators 12/40 + RWA 7/40 = 47.5%) from running
 *                  the board, without ever excluding a watchlist row.
 *
 * Calibration of K: the live-token anchor is the median mcap/TVL ratio
 * among protocols with mcap_usd > 0, which is 0.214 (n = 128, recomputed
 * from the snapshot). The median watchlist TVL is $152,788,602, so the
 * anchor target for the median watchlist implied value is
 * 0.214 * $152,788,602 = $32,696,761. K = 4.11 is the constant that maps
 * the median watchlist protocol's (TVL^0.85 * growth * age * chain *
 * category) to that target: median raw factor product is 7,955,955 and
 * 4.11 * 7,955,955 = $32,699,375 (within 0.10% of the precise $32,666,701
 * target; the rounded 0.214 anchor would give $32,696,761 instead).
 *
 * ------------------------------------------------------------- board
 *
 * Board = 100 rows: the 40 watchlist slugs (all of them, whatever their
 * implied value) + the 60 best early protocols by implied value. Early
 * uses the STRICT rankable definition: records no token (mcap_usd,
 * gecko_id and symbol all null) AND category not in {CEX, Bridge,
 * Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC}
 * AND name has no version marker (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|
 * \d+\.\d+)$/) AND no whole word wrapped/staked/staking AND name does
 * not start with an exchange name (Binance, Coinbase, Bybit, Kraken,
 * Bitget, OKX, Bitfinex, Gemini). Early TVL must be >= $10,000,000 and
 * below the $50,000,000 floor (94 candidates in this snapshot; the
 * $25M threshold of the 60-row board only yielded 33, too few for 60
 * early rows, and ANALYSIS §7 warns against going below $10M, where
 * the median implied value falls to ~$2M and noise dominates signal).
 *
 * Ranks 1..100 are global by implied value descending (the gate requires
 * implied_value_usd non-increasing with rank). Early rows carry
 * is_early = true and section = "early" so the dashboard renders them
 * as their own section; watchlist rows carry section = "watchlist".
 * In this snapshot the best early row ($15.0M) outranks the lowest
 * watchlist row ($10.2M), so the two sections interleave slightly at
 * the bottom of the global ranking — the flags, not the rank numbers,
 * are what keep the sections apart.
 *
 * Live-token rows (mcap_usd != null and > 0; mcap <= 0 is treated as
 * missing — the snapshot has one mcap of -$1 and fifteen of $0) never
 * enter the pre-token board. liveRows() returns them separately, top
 * by market cap, for the dashboard's live-token table.
 */

// ---------------------------------------------------------------- types

export interface Protocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Breakdown {
  /** K * TVL^0.85, in dollars, before any multiplier. */
  tvl_base_usd: number;
  /** TVL^0.85 in raw units (for display/debugging). */
  tvl_pow: number;
  growth_factor: number;
  age_factor: number;
  chain_factor: number;
  category_factor: number;
  /** change_7d after clamping, in percent (null when unreported). */
  change_7d_clamped: number | null;
  /** Age in days used by the curve (365 when listed_at is null). */
  age_days: number;
  age_unknown: boolean;
}

export interface ImpliedResult {
  value_usd: number;
  breakdown: Breakdown;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  is_early: boolean;
  section: "watchlist" | "early";
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  age_unknown: boolean;
  breakdown: Breakdown;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  mcap_usd: number;
  tvl_usd: number;
  mcap_tvl_ratio: number;
}

export interface RadarStats {
  as_of: string;
  floor_usd: number;
  total_protocols: number;
  pre_token: number;
  live_token: number;
  live_token_mcap_positive: number;
  strict_rankable: number;
  watchlist_total: number;
  watchlist_in_board: number;
  watchlist_missing: string[];
  early_pool_ge_25m: number;
  /** Strict-rankable early pool at the current EARLY_MIN_TVL_USD. */
  early_pool: number;
  early_min_tvl_usd: number;
  early_in_board: number;
  board_total: number;
  board_total_implied_usd: number;
  board_median_implied_usd: number;
  watchlist_median_implied_usd: number;
  watchlist_top_implied_usd: number;
  watchlist_bottom_implied_usd: number;
  early_top_implied_usd: number;
  early_bottom_implied_usd: number;
  board_category_counts: Record<string, number>;
  live_median_mcap_tvl_ratio: number | null;
  calibration: {
    k: number;
    tvl_exponent: number;
    anchor_mcap_tvl_median: number | null;
    anchor_target_median_implied_usd: number | null;
    median_watchlist_tvl_usd: number;
  };
}

export interface RadarResult {
  as_of: string;
  floor_usd: number;
  model: {
    formula: string;
    k: number;
    tvl_exponent: number;
    growth_weight: number;
    growth_clamp: [number, number];
    age_saturation_days: number;
    chain_cap: number;
  };
  board: BoardRow[];
  live: LiveRow[];
  stats: RadarStats;
}

// ------------------------------------------------------------ constants

export const MODEL = {
  /** Calibrated constant; see the header comment. */
  K: 4.11,
  TVL_EXPONENT: 0.85,
  /** Growth weight per percent point of clamped 7-day change. */
  GROWTH_WEIGHT: 0.0075,
  GROWTH_CLAMP_MIN: -60,
  GROWTH_CLAMP_MAX: 120,
  GROWTH_FACTOR_MIN: 0.55,
  GROWTH_FACTOR_MAX: 1.9,
  /** Age-curve time constant (days); saturation ~2 years. */
  AGE_TAU_DAYS: 400,
  AGE_FLOOR: 0.55,
  AGE_SATURATION_DAYS: 730,
  /** "Never launched" discount: up to 10% past 2 years, over 3 more years. */
  AGE_DISCOUNT_MAX: 0.1,
  AGE_DISCOUNT_SPAN_DAYS: 1095,
  AGE_DEFAULT_DAYS: 365,
  CHAIN_STEP: 0.04,
  CHAIN_CAP: 1.2,
  CATEGORY_BASE: 1.06,
  CATEGORY_SLOPE: 0.9,
  CATEGORY_MIN: 0.92,
  CATEGORY_MAX: 1.08,
  EARLY_MIN_TVL_USD: 10_000_000,
  EARLY_COUNT: 60,
  LIVE_COUNT: 20,
} as const;

export const EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  "CEX",
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
]);

export const EXCHANGE_PREFIXES: readonly string[] = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

// ------------------------------------------------------------ parsing

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Parse and validate a snapshot. Accepts the parsed JSON object or a JSON
 * string. Throws on a missing top-level field or a malformed protocol.
 * Never mutates its input.
 */
export function parseSnapshot(input: unknown): Snapshot {
  const raw: unknown =
    typeof input === "string" ? JSON.parse(input) : input;
  if (!isRecord(raw)) throw new Error("snapshot must be a JSON object");
  const asOf = asString(raw.as_of);
  const source = asString(raw.source);
  const floor = asNumber(raw.floor_usd);
  if (asOf === null || source === null || floor === null) {
    throw new Error("snapshot is missing as_of, source or floor_usd");
  }
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error("snapshot is missing protocols or watchlist arrays");
  }
  const protocols: Protocol[] = raw.protocols.map((p, i) => {
    if (!isRecord(p)) throw new Error(`protocol[${i}] is not an object`);
    const slug = asString(p.slug);
    const name = asString(p.name);
    const tvl = asNumber(p.tvl_usd);
    if (slug === null || name === null || tvl === null) {
      throw new Error(`protocol[${i}] is missing slug, name or tvl_usd`);
    }
    const chains = Array.isArray(p.chains)
      ? p.chains.filter((c): c is string => typeof c === "string")
      : [];
    return {
      slug,
      name,
      category: asString(p.category),
      chains,
      tvl_usd: tvl,
      change_7d: asNumber(p.change_7d),
      mcap_usd: asNumber(p.mcap_usd),
      listed_at: asString(p.listed_at),
      gecko_id: asString(p.gecko_id),
      symbol: asString(p.symbol),
    };
  });
  const watchlist = raw.watchlist.filter(
    (s): s is string => typeof s === "string",
  );
  return { as_of: asOf, source, floor_usd: floor, protocols, watchlist };
}

// ------------------------------------------------------------ predicates

/** Records no token at all: mcap, gecko_id and symbol are all null. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Has a usable market cap (mcap <= 0, incl. the snapshot's -$1, is missing). */
export function isLiveToken(p: Protocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0;
}

/**
 * Strict rankable definition (the README's watchlist rule, minus the
 * parentProtocol field the snapshot does not carry): pre-token, not a
 * wrapped/staked/bridged product, no version marker, not exchange-named.
 */
export function isStrictRankable(p: Protocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** Age in days from listed_at to the snapshot date; null when unknown. */
export function ageDays(p: Protocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const listed = Date.parse(p.listed_at + "T00:00:00Z");
  const ref = Date.parse(asOf + "T00:00:00Z");
  if (!Number.isFinite(listed) || !Number.isFinite(ref)) return null;
  return Math.max(0, Math.round((ref - listed) / 86_400_000));
}

// ------------------------------------------------------------ factors

export function growthFactor(p: Protocol): {
  factor: number;
  clamped: number | null;
} {
  if (p.change_7d === null) return { factor: 1, clamped: null };
  const clamped = Math.min(
    MODEL.GROWTH_CLAMP_MAX,
    Math.max(MODEL.GROWTH_CLAMP_MIN, p.change_7d),
  );
  const factor = Math.min(
    MODEL.GROWTH_FACTOR_MAX,
    Math.max(
      MODEL.GROWTH_FACTOR_MIN,
      1 + MODEL.GROWTH_WEIGHT * clamped,
    ),
  );
  return { factor, clamped };
}

export function ageFactor(age: number): number {
  const base =
    MODEL.AGE_FLOOR +
    (1 - MODEL.AGE_FLOOR) * (1 - Math.exp(-age / MODEL.AGE_TAU_DAYS));
  if (age <= MODEL.AGE_SATURATION_DAYS) return base;
  const discount =
    1 -
    MODEL.AGE_DISCOUNT_MAX *
      Math.min(
        1,
        (age - MODEL.AGE_SATURATION_DAYS) / MODEL.AGE_DISCOUNT_SPAN_DAYS,
      );
  return base * discount;
}

export function chainFactor(p: Protocol): number {
  return Math.min(
    MODEL.CHAIN_CAP,
    1 + MODEL.CHAIN_STEP * Math.max(0, p.chains.length - 1),
  );
}

/**
 * Category shares over the strict-rankable pool, computed from the
 * snapshot at run time. The category factor is then a pure function of
 * that share — no category is ever given a hand-written multiplier.
 */
export function categoryShares(protocols: Protocol[]): Map<string, number> {
  const counts = new Map<string, number>();
  let total = 0;
  for (const p of protocols) {
    if (!isStrictRankable(p)) continue;
    const key = p.category ?? "Unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }
  const shares = new Map<string, number>();
  for (const [key, n] of counts) shares.set(key, total === 0 ? 0 : n / total);
  return shares;
}

export function categoryFactor(
  p: Protocol,
  shares: Map<string, number>,
): number {
  const share = shares.get(p.category ?? "Unknown") ?? 0;
  return Math.min(
    MODEL.CATEGORY_MAX,
    Math.max(
      MODEL.CATEGORY_MIN,
      MODEL.CATEGORY_BASE - MODEL.CATEGORY_SLOPE * share,
    ),
  );
}

// ------------------------------------------------------------ implied value

/**
 * Implied value of a protocol's eventual token, in whole dollars, with
 * the per-component breakdown for the dashboard's detail view.
 * `shares` should come from categoryShares(snapshot.protocols) so the
 * category factor matches the board; when omitted the category is
 * treated as unseen (share 0 -> factor 1.06).
 */
export function impliedValue(
  p: Protocol,
  asOf: string,
  shares: Map<string, number> = new Map(),
): ImpliedResult {
  const tvlPow = Math.pow(Math.max(0, p.tvl_usd), MODEL.TVL_EXPONENT);
  const tvlBase = MODEL.K * tvlPow;
  const g = growthFactor(p);
  const age = ageDays(p, asOf);
  const ageUsed = age ?? MODEL.AGE_DEFAULT_DAYS;
  const breakdown: Breakdown = {
    tvl_base_usd: tvlBase,
    tvl_pow: tvlPow,
    growth_factor: g.factor,
    age_factor: ageFactor(ageUsed),
    chain_factor: chainFactor(p),
    category_factor: categoryFactor(p, shares),
    change_7d_clamped: g.clamped,
    age_days: ageUsed,
    age_unknown: age === null,
  };
  const value =
    tvlBase *
    breakdown.growth_factor *
    breakdown.age_factor *
    breakdown.chain_factor *
    breakdown.category_factor;
  return { value_usd: Math.max(1, Math.round(value)), breakdown };
}

// ------------------------------------------------------------ live rows

/** Live-token protocols, top by market cap, for the dashboard's live table. */
export function liveRows(snapshot: Snapshot, limit: number = MODEL.LIVE_COUNT): LiveRow[] {
  return snapshot.protocols
    .filter(isLiveToken)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, limit)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: [...p.chains],
      mcap_usd: p.mcap_usd as number,
      tvl_usd: p.tvl_usd,
      mcap_tvl_ratio: (p.mcap_usd as number) / Math.max(1, p.tvl_usd),
    }));
}

// ------------------------------------------------------------ farm steps

const GAS_TEXT: Record<string, string> = {
  Ethereum: "$5–25 per transaction in gas",
  Solana: "under $0.10 in fees",
  Arbitrum: "under $1 in gas",
  Optimism: "under $1 in gas",
  Base: "under $1 in gas",
  Polygon: "under $1 in gas",
  Monad: "under $0.10 in fees",
  Bitcoin: "a few dollars in network fees",
};

function gasText(chain: string): string {
  return GAS_TEXT[chain] ?? "a few dollars in network fees";
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(n / 1_000)}K`;
}

/** The core on-protocol action, chosen by category — never by protocol name. */
function coreAction(p: Protocol, chain: string, amount: string): string {
  const name = p.name;
  switch (p.category) {
    case "Risk Curators":
      return (
        `Allocate ${amount} into a curated vault on ${name} on ${chain} and leave it ` +
        `deployed for at least 4 weeks — curators earn fees per vault, and a steady ` +
        `allocation is what a future points snapshot is most likely to reward.`
      );
    case "RWA":
      return (
        `Buy or mint ${amount} of tokenised real-world assets on ${name} on ${chain}, ` +
        `check the underlying asset documents first, and hold the position for at least ` +
        `4 weeks — RWA points usually track holding time, not trade count.`
      );
    case "Lending":
      return (
        `Supply ${amount} as collateral on ${name} on ${chain}, then borrow 30–40% of ` +
        `its value in a stablecoin and repay it within 2 weeks — one full supply-and-` +
        `borrow cycle, about 20 minutes, plus the borrow interest for those 2 weeks.`
      );
    case "Dexs":
      return (
        `Swap ${amount} through ${name} on ${chain}, then add half of it as liquidity ` +
        `to its largest pool for at least 2 weeks — one swap costs ${gasText(chain)}, ` +
        `and the LP position earns fees while it sits.`
      );
    case "Yield":
    case "Yield Aggregator":
      return (
        `Deposit ${amount} into the highest-TVL yield vault on ${name} on ${chain} and ` +
        `leave it compounding for at least 4 weeks — check the vault's APY and fees ` +
        `before depositing, about 10 minutes of review.`
      );
    case "Restaking":
      return (
        `Restake ${amount} through ${name} on ${chain} and keep the position staked ` +
        `for at least 6 weeks — restaking points accrue per week staked, so an early ` +
        `deposit that stays put beats a larger late one.`
      );
    case "Basis Trading":
      return (
        `Open a ${amount} basis position on ${name} on ${chain}, hold it through one ` +
        `funding cycle (about 8 hours), then close it — about 15 minutes of active ` +
        `time plus the funding paid or earned over that cycle.`
      );
    case "Onchain Capital Allocator":
      return (
        `Allocate ${amount} to a strategy on ${name} on ${chain} and keep it invested ` +
        `for at least 4 weeks — allocators track capital deployed over time, so do not ` +
        `withdraw and re-deposit to chase a weekly snapshot.`
      );
    case "CeDeFi":
      return (
        `Deposit ${amount} into ${name} on ${chain} and use one of its CeFi-linked ` +
        `products for at least 2 weeks — read the custody terms first (10 minutes), ` +
        `then keep the deposit untouched for the full period.`
      );
    case "Insurance":
      return (
        `Buy ${amount} of cover on ${name} on ${chain} for a 30-day period — the ` +
        `premium is the cost, about 10 minutes to pick a cover, and the policy itself ` +
        `is the on-chain activity a launch snapshot would see.`
      );
    case "Payments":
      return (
        `Route ${amount} of real payments through ${name} on ${chain} over the next ` +
        `2 weeks — at least 3 separate payments of $30 or more, a few minutes each, ` +
        `instead of one large self-transfer.`
      );
    case "Chain":
      return (
        `Bridge ${amount} to the ${name} chain and use one of its native apps for at ` +
        `least 2 weeks — 3 or more transactions a week, a few minutes each, with ` +
        `${gasText(chain)} per transaction.`
      );
    case "CDP":
      return (
        `Lock ${amount} of collateral in a vault on ${name} on ${chain} and mint ` +
        `stablecoins worth 30–40% of it, then repay within 2 weeks — about 20 minutes ` +
        `to open the vault plus the stability fee for those 2 weeks.`
      );
    case "Collateral Markets":
      return (
        `Post ${amount} as collateral on ${name} on ${chain} and open one borrow ` +
        `against it for 2 weeks — about 20 minutes to set up, plus borrow interest, ` +
        `then repay in full before closing the position.`
      );
    case "Staking Pool":
      return (
        `Stake ${amount} in the staking pool on ${name} on ${chain} and leave it for ` +
        `at least 6 weeks — staking rewards accrue weekly, so check the pool once a ` +
        `week (5 minutes) rather than moving the stake.`
      );
    case "Stablecoin Wrapper":
      return (
        `Wrap ${amount} into the stablecoin on ${name} on ${chain} and hold the ` +
        `wrapped balance for at least 2 weeks — one wrap costs ${gasText(chain)}, ` +
        `and holding time is the signal, not the wrap itself.`
      );
    case "Governance Incentives":
      return (
        `Lock ${amount} in the governance vault on ${name} on ${chain} for the next ` +
        `voting round (about 2 weeks) and vote on at least one proposal — the lock ` +
        `plus one real vote, about 15 minutes total.`
      );
    case "Derivatives":
      return (
        `Open a ${amount} derivatives position on ${name} on ${chain}, hold it for at ` +
        `least 48 hours, then close it — about 15 minutes of active time plus funding ` +
        `and trading fees over the holding period.`
      );
    default:
      return (
        `Use the main ${p.category ?? "DeFi"} feature of ${name} on ${chain} with ` +
        `${amount} and keep the position open for at least 4 weeks — one real, ` +
        `held position beats many small in-and-out transactions.`
      );
  }
}

function clampStep(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 600 ? t.slice(0, 597).trimEnd() + "…" : t;
}

/**
 * Farm plan for one protocol, generated from its own data (category,
 * primary chain, TVL tier, age). 6 steps, 7 when the protocol is
 * multi-chain (an extra cross-chain step). Every step names a cost
 * and/or a duration; nothing here is a slogan.
 */
export function farmSteps(p: Protocol, asOf: string): string[] {
  const chain = p.chains[0] ?? "Ethereum";
  const secondChain = p.chains.length > 1 ? p.chains[1] : null;
  const amount =
    p.tvl_usd >= 500_000_000
      ? "$500–1,000"
      : p.tvl_usd >= 100_000_000
        ? "$200–500"
        : "$100–300";
  const age = ageDays(p, asOf);
  const ageText =
    age === null
      ? "tracked for an unknown length of time"
      : age < 90
        ? `only ${age} days old, so expect the interface and points rules to change`
        : age < 365
          ? `${Math.round(age / 30)} months old`
          : `${(age / 365).toFixed(1)} years old`;
  const steps: string[] = [
    `Set up a fresh wallet for ${p.name} on ${chain} and fund it with ${amount} plus gas ` +
      `— ${gasText(chain)}. About 15 minutes to create the wallet, back up the seed ` +
      `phrase offline, and send the first funds.`,
    `Open ${p.name} only from its official site or app (5 minutes, $0) and check the ` +
      `address matches the project's official links — never follow a link from a DM ` +
      `or a search ad, and reject any site that asks for your seed phrase.`,
    coreAction(p, chain, amount),
  ];
  if (secondChain !== null) {
    steps.push(
      `Repeat the same deposit on ${secondChain} with half the amount (${amount} split ` +
        `across chains) within the same week — bridging takes 10–30 minutes and $1–5 ` +
        `in bridge fees, and activity on a second chain is a separate signal.`,
    );
  }
  steps.push(
    `Return once a week for 4–8 weeks and repeat one real action on ${p.name} ` +
      `(10–15 minutes per visit: a small deposit, a swap, or a claim) — weekly ` +
      `activity over two months is worth more than a single large deposit.`,
    `Check ${p.name}'s points or activity page every week (5 minutes) and screenshot ` +
      `your balance and transaction history — if points stop accruing, you will see ` +
      `it within a week instead of at the end of a season.`,
    `Do not withdraw everything at once: ${p.name} holds ${fmtUsd(p.tvl_usd)} in TVL ` +
      `and is ${ageText}, so keep your main position open for at least 8 weeks and ` +
      `withdraw in stages if you need the funds back.`,
  );
  return steps.map(clampStep);
}

// ------------------------------------------------------------ build

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Build the whole radar from a snapshot (object or JSON string):
 * the 100-row board (40 watchlist + 60 early), the live-token rows,
 * and the statistics the dashboard shows beside them.
 */
export function buildRadar(input: unknown): RadarResult {
  const snapshot = parseSnapshot(input);
  const shares = categoryShares(snapshot.protocols);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));

  const score = (p: Protocol): { value: number; breakdown: Breakdown } => {
    const r = impliedValue(p, snapshot.as_of, shares);
    return { value: r.value_usd, breakdown: r.breakdown };
  };

  // --- watchlist: every slug, whatever its implied value.
  const missing: string[] = [];
  const watchlistRows: BoardRow[] = [];
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p === undefined) {
      missing.push(slug);
      continue;
    }
    const { value, breakdown } = score(p);
    watchlistRows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: value,
      is_early: false,
      section: "watchlist",
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: breakdown.age_days,
      age_unknown: breakdown.age_unknown,
      breakdown,
      farm_steps: farmSteps(p, snapshot.as_of),
    });
  }

  // --- early: strict-rankable, $10M <= TVL < floor, top 60 by implied.
  const earlyPool = snapshot.protocols
    .filter(
      (p) =>
        isStrictRankable(p) &&
        p.tvl_usd >= MODEL.EARLY_MIN_TVL_USD &&
        p.tvl_usd < snapshot.floor_usd,
    )
    .map((p) => ({ p, ...score(p) }))
    .sort(
      (a, b) =>
        b.value - a.value ||
        b.p.tvl_usd - a.p.tvl_usd ||
        a.p.slug.localeCompare(b.p.slug),
    );
  const earlyRows: BoardRow[] = earlyPool
    .slice(0, MODEL.EARLY_COUNT)
    .map(({ p, value, breakdown }) => ({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: value,
      is_early: true,
      section: "early" as const,
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: breakdown.age_days,
      age_unknown: breakdown.age_unknown,
      breakdown,
      farm_steps: farmSteps(p, snapshot.as_of),
    }));

  // --- one global ranking (gate: implied non-increasing with rank).
  const board = [...watchlistRows, ...earlyRows]
    .sort(
      (a, b) =>
        b.implied_value_usd - a.implied_value_usd ||
        b.tvl_usd - a.tvl_usd ||
        a.slug.localeCompare(b.slug),
    )
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const live = liveRows(snapshot);

  // Pool at the old $25M threshold, kept for comparability with the
  // 60-row board (33 candidates); early_pool is the pool actually used.
  const earlyPoolGe25m = snapshot.protocols.filter(
    (p) =>
      isStrictRankable(p) &&
      p.tvl_usd >= 25_000_000 &&
      p.tvl_usd < snapshot.floor_usd,
  ).length;

  const categoryCounts: Record<string, number> = {};
  for (const row of board) {
    const key = row.category ?? "Unknown";
    categoryCounts[key] = (categoryCounts[key] ?? 0) + 1;
  }

  const liveRatios = snapshot.protocols
    .filter(isLiveToken)
    .map((p) => (p.mcap_usd as number) / Math.max(1, p.tvl_usd));
  const anchorRatio = median(liveRatios);
  const medianWatchlistTvl = median(
    watchlistRows.map((r) => r.tvl_usd),
  ) ?? 0;

  const stats: RadarStats = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    total_protocols: snapshot.protocols.length,
    pre_token: snapshot.protocols.filter(isPreToken).length,
    live_token: snapshot.protocols.filter((p) => !isPreToken(p)).length,
    live_token_mcap_positive: liveRatios.length,
    strict_rankable: snapshot.protocols.filter(isStrictRankable).length,
    watchlist_total: snapshot.watchlist.length,
    watchlist_in_board: watchlistRows.length,
    watchlist_missing: missing,
    early_pool_ge_25m: earlyPoolGe25m,
    early_pool: earlyPool.length,
    early_min_tvl_usd: MODEL.EARLY_MIN_TVL_USD,
    early_in_board: earlyRows.length,
    board_total: board.length,
    board_total_implied_usd: board.reduce(
      (s, r) => s + r.implied_value_usd,
      0,
    ),
    board_median_implied_usd: Math.round(
      median(board.map((r) => r.implied_value_usd)) ?? 0,
    ),
    watchlist_median_implied_usd: Math.round(
      median(watchlistRows.map((r) => r.implied_value_usd)) ?? 0,
    ),
    watchlist_top_implied_usd: watchlistRows.reduce(
      (m, r) => Math.max(m, r.implied_value_usd),
      0,
    ),
    watchlist_bottom_implied_usd: watchlistRows.reduce(
      (m, r) => Math.min(m, r.implied_value_usd),
      Number.POSITIVE_INFINITY,
    ),
    early_top_implied_usd: earlyRows.reduce(
      (m, r) => Math.max(m, r.implied_value_usd),
      0,
    ),
    early_bottom_implied_usd: earlyRows.reduce(
      (m, r) => Math.min(m, r.implied_value_usd),
      Number.POSITIVE_INFINITY,
    ),
    board_category_counts: categoryCounts,
    live_median_mcap_tvl_ratio: anchorRatio,
    calibration: {
      k: MODEL.K,
      tvl_exponent: MODEL.TVL_EXPONENT,
      anchor_mcap_tvl_median: anchorRatio,
      anchor_target_median_implied_usd:
        anchorRatio === null
          ? null
          : Math.round(anchorRatio * medianWatchlistTvl),
      median_watchlist_tvl_usd: medianWatchlistTvl,
    },
  };

  return {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model: {
      formula:
        "implied = 4.11 * TVL^0.85 * growth * age * chain * category",
      k: MODEL.K,
      tvl_exponent: MODEL.TVL_EXPONENT,
      growth_weight: MODEL.GROWTH_WEIGHT,
      growth_clamp: [MODEL.GROWTH_CLAMP_MIN, MODEL.GROWTH_CLAMP_MAX],
      age_saturation_days: MODEL.AGE_SATURATION_DAYS,
      chain_cap: MODEL.CHAIN_CAP,
    },
    board,
    live,
    stats,
  };
}

// ------------------------------------------------------------ dashboard data

/**
 * The dashboard's data file: `window.RADAR = {...};` — board, live rows,
 * stats and model, as one JSON literal the page reads with no network.
 */
export function dataScript(result: RadarResult): string {
  return `window.RADAR = ${JSON.stringify(result)};\n`;
}
