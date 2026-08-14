/**
 * src/lib/launchpad.ts — Shyft's own launchpad.
 *
 * Tokens launch straight onto Meteora's Dynamic Bonding Curve using a config
 * Shyft owns (see scripts/create-launchpad-config.ts). There is no third-party
 * launchpad in the path, so the whole trading fee lands on the config Shyft
 * controls: 50% to the creator, 50% to the treasury.
 *
 * This module is imported by client components, so it deliberately holds only
 * constants, types and fetch helpers — the DBC SDK is server-side only, in
 * /api/launchpad, and is far too heavy to ship to the browser.
 */

/**
 * Which launchpad the UI should offer.
 *   "shyft" — our own Meteora DBC config; trading fees come to the treasury
 *   "easya" — EasyA Kickstart, where $SHYFT launched; fees go to EasyA
 *   "bags"  — the original Bags.fm path, kept for rollback
 */
export const LAUNCHPAD: "shyft" | "easya" | "bags" =
  (process.env.NEXT_PUBLIC_LAUNCHPAD as "shyft" | "easya" | "bags") || "shyft";

/** Shyft's DBC partner config. Set once, after running the setup script. */
export const LAUNCHPAD_CONFIG = process.env.NEXT_PUBLIC_LAUNCHPAD_CONFIG || "";

/** Meteora Dynamic Bonding Curve program. */
export const DBC_PROGRAM_ID = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";

/**
 * The economics baked into the config. Display-only — the on-chain config is
 * the source of truth — but this is what the launch screen promises, so keep
 * them in step if the config is ever rebuilt.
 *
 * On the split: the config's creatorTradingFeePercentage is 50, but that 50%
 * is of what remains AFTER Meteora takes a 20% protocol cut at the program
 * level (measured on both our devnet pool and EasyA's live mainnet pool, and
 * NOT visible in the config — poolFees.protocolFeePercent reads 0). So the
 * true share of each trade is 40% creator / 40% Shyft / 20% Meteora. Quoting
 * "50%" to creators would overstate what they actually receive.
 */
export const LAUNCHPAD_TERMS = {
  tradeFeePercent: 2,
  /** Share of the trading fee, after Meteora's protocol cut. */
  creatorFeeShare: 40,
  platformFeeShare: 40,
  protocolFeeShare: 20,
  /** What the creator actually earns, as a percentage of trade volume. */
  creatorPercentOfVolume: 0.8,
  graduationSol: 85.07,
  totalSupply: 1_000_000_000,
  decimals: 6,
  migratesTo: "DAMM v2",
} as const;

/**
 * What a launch costs the CREATOR in account rent (mint, pool, two vaults,
 * metadata), measured off real launches. Launches are not sponsored — only
 * trading is — so the creator needs at least this much SOL in their wallet.
 */
export const LAUNCH_RENT_SOL = 0.0245;

export interface LaunchResult {
  tokenMint: string;
  pool: string;
  signature: string;
  metadataUrl: string;
}

export interface PoolStats {
  pool: string;
  baseMint: string;
  priceSol: number;
  priceUsd: number | null;
  quoteReserveSol: number;
  graduationProgress: number; // 0..1
  isMigrated: boolean;
  creatorFeesSol: number;
  creator: string;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/launchpad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error || "Launchpad request failed");
  return json.response as T;
}

/** Pin the token's metadata JSON to IPFS and get back the URI the mint points at. */
export function uploadMetadata(params: {
  name: string;
  symbol: string;
  description?: string;
  imageUrl: string;
  twitter?: string;
  website?: string;
}): Promise<{ uri: string; cid: string }> {
  return call({ action: "upload-metadata", ...params });
}

/**
 * Build the launch transaction. The server picks the (vanity) mint and returns
 * a transaction already signed by the treasury and the mint keypair — the
 * caller only has to add the creator's signature.
 */
export function buildLaunchTx(params: {
  wallet: string;
  name: string;
  symbol: string;
  uri: string;
  /**
   * Optional dev buy, executed in the SAME transaction as the launch so no
   * sniper can take the first entry. Priced at the normal trading fee.
   */
  firstBuyLamports?: string;
}): Promise<{
  transaction: string;
  tokenMint: string;
  pool: string;
  vanity: boolean;
  firstBuyLamports: string;
  /** True if the requested first buy was larger than the curve and got reduced. */
  firstBuyCapped: boolean;
}> {
  return call({ action: "create-launch-tx", ...params });
}

/**
 * Ask whether a mint was launched through Shyft and where it currently trades.
 * Cheap — the pool address is derived from the mint, not searched for.
 */
export function resolvePool(mint: string): Promise<
  | { isShyftToken: false }
  | { isShyftToken: true; pool: string; decimals: number; graduated: boolean }
> {
  return call({ action: "resolve-pool", mint });
}

/** Quote a buy (SOL in) or sell (tokens in) against a bonding-curve pool. */
export function quote(params: {
  pool: string;
  amountIn: string;
  swapBaseForQuote: boolean;
  slippageBps?: number;
}): Promise<{
  amountOut: string;
  minimumAmountOut: string;
  feeSol: string;
  priceImpactPct: number;
  graduated: boolean;
  /** Set when a buy was larger than the curve's remaining room and got reduced. */
  cappedTo: string | null;
}> {
  return call({ action: "quote", ...params });
}

/**
 * Build a buy/sell. The trader is the fee payer — launchpad activity is not
 * sponsored. Automatically routed to the DAMM v2 pool once a token graduates.
 */
export function buildSwapTx(params: {
  wallet: string;
  pool: string;
  amountIn: string;
  minimumAmountOut: string;
  swapBaseForQuote: boolean;
}): Promise<{ transaction: string }> {
  return call({ action: "swap", ...params });
}

/** Build a tx letting a creator claim their 50% share of accrued trading fees. */
export function buildClaimFeesTx(params: {
  wallet: string;
  pool: string;
}): Promise<{ transaction: string; claimableSol: number }> {
  return call({ action: "claim-creator-fees", ...params });
}

/** Live pool state — price, graduation progress, unclaimed creator fees. */
export function getPoolStats(pool: string): Promise<PoolStats> {
  return call({ action: "pool-stats", pool });
}

/**
 * Launched tokens. With no `creator`, returns everything on Shyft's own config.
 * With one, returns everything that wallet launched on ANY config — which is
 * how launches routed through EasyA are found, since those live on EasyA's
 * config rather than ours.
 */
export function listLaunches(limit = 50, creator?: string): Promise<PoolStats[]> {
  return call({ action: "launches", limit, ...(creator ? { creator } : {}) });
}

/**
 * Pool stats for an explicit list of mints. Used for tokens launched through
 * Shyft onto EasyA's config — those can't be found by config, so the mints come
 * from our own launch record instead.
 */
export function listLaunchesByMints(mints: string[]): Promise<PoolStats[]> {
  return call({ action: "launches", mints });
}
