/**
 * Bags SDK integration — Creator tokens, trading, and fee sharing
 *
 * Bags API lets Shyft creators launch tokens, trade them, and earn fees.
 * The Shyft partner key earns 25% of all trading fees from tokens launched via Shyft.
 */

// ─── Constants ───
export const BAGS_REF_CODE = "shyftlol";
export const BAGS_PARTNER_FEE_BPS = 2500; // 25%
// Partner wallet + config PDA are server-side only (in .env.local & Vercel env vars)

// Base URL for Bags API (proxied through our API routes)
const API_BASE = "/api/bags";

// ─── Types ───

export interface BagsTokenInfo {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  tokenMint: string;
  status: string;
  twitter?: string;
  website?: string;
}

export interface BagsQuote {
  requestId: string;
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: Array<{
    venue: string;
    inAmount: string;
    outAmount: string;
    inputMint: string;
    outputMint: string;
  }>;
  platformFee?: {
    amount: string;
    feeBps: number;
    feeAccount: string;
  };
}

export interface BagsClaimablePosition {
  baseMint: string;
  virtualPoolAddress: string;
  virtualPoolClaimableAmount?: string;
  dammPoolClaimableAmount?: string;
  isCustomFeeVault: boolean;
  customFeeVaultBalance?: string;
  customFeeVaultBps?: number;
  customFeeVaultClaimerSide?: string;
  totalClaimableLamportsUserShare?: string;
  isMigrated?: boolean;
}

export interface BagsTokenCreator {
  wallet: string;
  provider?: string;
  username?: string;
  providerUsername?: string;
  pfp?: string;
  royaltyBps: number;
  isCreator: boolean;
  twitterUsername?: string;
  bagsUsername?: string;
}

export interface TokenLaunchParams {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  twitterUrl?: string;
  websiteUrl?: string;
  initialBuyLamports?: number;
  feeClaimers?: Array<{
    provider: string;
    username: string;
    bps: number;
  }>;
}

// ─── Client-side API helpers (call our Next.js API routes) ───

/**
 * Launch a new creator token via Bags
 */
export async function launchCreatorToken(params: TokenLaunchParams): Promise<{
  tokenMint: string;
  metadataUrl: string;
  unsignedTxBase64: string;
  configKey: string;
}> {
  const res = await fetch(`${API_BASE}/launch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Token launch failed");
  return data.response;
}

/** Social platforms that can be resolved to a fee-share wallet */
export type FeeProvider = "twitter" | "tiktok" | "kick" | "github";

export interface ResolvedFeeWallet {
  wallet: string;
  provider: string;
  platformData?: {
    id?: string;
    username?: string;
    display_name?: string;
    avatar_url?: string;
  };
}

/**
 * Resolve a social handle (twitter/tiktok/kick/github) to its Bags fee-share wallet.
 * Used when a creator wants to direct trading fees to another user.
 */
export async function resolveFeeWallet(
  username: string,
  provider: FeeProvider
): Promise<ResolvedFeeWallet> {
  const res = await fetch(`${API_BASE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "resolve-fee-wallet", username, provider }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Could not find a wallet for that handle");
  return data.response;
}

/**
 * Get a trade quote for swapping tokens
 */
export async function getTradeQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageMode?: "auto" | "manual";
  slippageBps?: number;
}): Promise<BagsQuote> {
  const res = await fetch(`${API_BASE}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to get quote");
  return data.response;
}

/**
 * Create a swap transaction
 */
export async function createSwapTransaction(params: {
  quoteRequestId: string;
  userPublicKey: string;
}): Promise<{
  unsignedTxBase64: string;
  computeUnitLimit: number;
  prioritizationFeeLamports: number;
}> {
  const res = await fetch(`${API_BASE}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to create swap tx");
  return data.response;
}

/**
 * Get claimable fee positions for a wallet
 */
export async function getClaimablePositions(walletAddress: string): Promise<BagsClaimablePosition[]> {
  const res = await fetch(`${API_BASE}/fees?wallet=${walletAddress}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to get claimable positions");
  return data.response;
}

/**
 * Create claim fee transaction
 */
export async function createClaimTransaction(params: {
  walletAddress: string;
  tokenMint: string;
}): Promise<{ unsignedTxBase64: string }[]> {
  const res = await fetch(`${API_BASE}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to create claim tx");
  return data.response;
}

/**
 * Get token creators info
 */
export async function getTokenCreators(tokenMint: string): Promise<BagsTokenCreator[]> {
  const res = await fetch(`${API_BASE}/creators?mint=${tokenMint}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to get token creators");
  return data.response;
}

/**
 * Get the token launch feed
 */
export async function getTokenFeed(): Promise<BagsTokenInfo[]> {
  const res = await fetch(`${API_BASE}/feed`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to get token feed");
  return data.response;
}

/**
 * SOL native mint address (for buy/sell with SOL)
 */
export const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Format lamports to SOL display string
 */
export function formatSOL(lamports: number | string): string {
  const sol = Number(lamports) / 1e9;
  if (sol < 0.001) return "<0.001";
  if (sol < 1) return sol.toFixed(4);
  if (sol < 100) return sol.toFixed(3);
  return sol.toFixed(2);
}

/**
 * Format a token amount with the right decimals
 */
export function formatTokenAmount(amount: string | number, decimals: number = 6): string {
  const num = Number(amount) / Math.pow(10, decimals);
  if (num < 0.01) return "<0.01";
  if (num < 1) return num.toFixed(4);
  if (num < 1000) return num.toFixed(2);
  if (num < 1_000_000) return (num / 1000).toFixed(1) + "K";
  return (num / 1_000_000).toFixed(1) + "M";
}
