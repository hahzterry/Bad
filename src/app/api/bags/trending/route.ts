import { NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { BagsSDK } from "@bagsfm/bags-sdk";

/**
 * /api/bags/trending
 *
 * Returns trending Bags tokens enriched with live price data
 * from DexScreener (free public API). Used by the Feed to inject
 * token cards between posts.
 *
 * Cached in-memory for 60s to stay well under DexScreener rate limits.
 */

const BAGS_API_KEY = (process.env.BAGS_API_KEY || "").trim();
const BAGS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;

const ALLOWED_ORIGINS = new Set([
  "https://www.shyft.lol",
  "https://shyft.lol",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function isAllowedOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin") || "";
  const referer = req.headers.get("referer") || "";
  if (origin && ALLOWED_ORIGINS.has(origin)) return true;
  for (const allowed of ALLOWED_ORIGINS) {
    if (referer.startsWith(allowed)) return true;
  }
  return false;
}

export type TrendingToken = {
  tokenMint: string;
  name: string;
  symbol: string;
  image: string;
  description?: string;
  status?: string;
  // enriched (may be missing if no DEX listing yet):
  priceUsd?: number;
  priceChange24h?: number; // percent
  volume24h?: number;
  marketCap?: number;
  liquidity?: number;
  pairAddress?: string; // dexscreener pair (for chart embed)
  dexId?: string;
};

// ─── In-memory cache ───
let cache: { ts: number; data: TrendingToken[] } | null = null;
const CACHE_TTL_MS = 60_000;

async function fetchDexScreener(mints: string[]): Promise<Record<string, any>> {
  // DexScreener allows up to 30 mints per request (comma-separated)
  const result: Record<string, any> = {};
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${batch.join(",")}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const json = await res.json();
      const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
      // For each mint, keep the pair with highest liquidity
      for (const p of pairs) {
        if (p.chainId !== "solana") continue;
        const mint = p.baseToken?.address;
        if (!mint) continue;
        const liq = Number(p.liquidity?.usd || 0);
        const prev = result[mint];
        if (!prev || liq > Number(prev.liquidity?.usd || 0)) {
          result[mint] = p;
        }
      }
    } catch (e) {
      console.warn("[trending] DexScreener batch failed:", e);
    }
  }
  return result;
}

export async function GET(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
  }

  // Serve cache when fresh
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json({ success: true, response: cache.data, cached: true });
  }

  try {
    if (!BAGS_API_KEY) {
      return NextResponse.json({ success: false, error: "BAGS_API_KEY not configured" }, { status: 500 });
    }

    const connection = new Connection(BAGS_RPC_URL, "confirmed");
    const sdk = new BagsSDK(BAGS_API_KEY, connection, "confirmed");

    const feed: any[] = await sdk.bagsApiClient.get("/token-launch/feed");
    if (!Array.isArray(feed)) {
      return NextResponse.json({ success: true, response: [] });
    }

    // Take the first 100 tokens from Bags feed (already sorted by activity);
    // we pull a wider window so that after deduping near-identical relaunches
    // we still end up with a varied top-20.
    const top = feed.slice(0, 100).filter((t) => t?.tokenMint && t?.name && t?.symbol);
    const mints = top.map((t) => t.tokenMint);

    const dex = await fetchDexScreener(mints);

    const enriched: TrendingToken[] = top.map((t) => {
      const p = dex[t.tokenMint];
      return {
        tokenMint: t.tokenMint,
        name: t.name,
        symbol: t.symbol,
        image: t.image || "",
        description: t.description,
        status: t.status,
        priceUsd: p?.priceUsd ? Number(p.priceUsd) : undefined,
        priceChange24h: p?.priceChange?.h24 != null ? Number(p.priceChange.h24) : undefined,
        volume24h: p?.volume?.h24 != null ? Number(p.volume.h24) : undefined,
        marketCap: p?.marketCap != null ? Number(p.marketCap) : (p?.fdv != null ? Number(p.fdv) : undefined),
        liquidity: p?.liquidity?.usd != null ? Number(p.liquidity.usd) : undefined,
        pairAddress: p?.pairAddress,
        dexId: p?.dexId,
      };
    });

    // Prefer tokens that actually have price data, but keep the rest as fallback
    const withPrice = enriched.filter((t) => t.priceUsd != null && t.priceUsd > 0);
    const withoutPrice = enriched.filter((t) => t.priceUsd == null || t.priceUsd <= 0);

    // Sort priced ones by 24h volume desc, then by abs(% change) for "movers"
    withPrice.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));

    // Dedupe by symbol+name (Bags feed often has many copies of the same token
    // launched by different wallets — keep only the highest-volume one per ticker)
    const seen = new Set<string>();
    const dedupe = (list: TrendingToken[]) =>
      list.filter((t) => {
        const key = `${(t.symbol || "").toLowerCase().trim()}|${(t.name || "").toLowerCase().trim()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const final = [...dedupe(withPrice), ...dedupe(withoutPrice)].slice(0, 20);

    cache = { ts: Date.now(), data: final };
    return NextResponse.json({ success: true, response: final, cached: false });
  } catch (error: any) {
    console.error("[trending GET]", error);
    // If we have stale cache, serve it on error
    if (cache) {
      return NextResponse.json({ success: true, response: cache.data, cached: true, stale: true });
    }
    return NextResponse.json({ success: false, error: error?.message || "Internal error" }, { status: 500 });
  }
}
