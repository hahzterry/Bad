import { NextRequest, NextResponse } from "next/server";

/**
 * /api/kickstart/trending
 *
 * Returns trending EasyA Kickstart launches enriched with live price data
 * from DexScreener (free public API). Used by the Feed to inject launch
 * cards between posts (replaces the old Bags trending source).
 *
 * Kickstart doesn't expose a public coins list, so we derive the live set
 * from its `/api/recent-buys` activity feed (the mints people are actively
 * buying) and enrich each with DexScreener metadata + price.
 *
 * Cached in-memory for 60s to stay well under DexScreener rate limits.
 */

const KICKSTART_BUYS_URL = "https://kickstart.easya.io/api/recent-buys";

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
  // Allow Vercel preview deployments (*.vercel.app) so preview builds render cards
  const hostMatches = (val: string) => {
    try {
      return new URL(val).hostname.endsWith(".vercel.app");
    } catch {
      return false;
    }
  };
  if (hostMatches(origin) || hostMatches(referer)) return true;
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

type RecentBuy = { mint?: string; timestamp?: string; solAmount?: number; usdAmount?: number };

/**
 * Pull the mints Kickstart users are actively buying, ordered by most recent
 * activity. Returns unique mints (first seen = most recent) plus a buy count
 * per mint so we can rank the hottest launches.
 */
async function fetchKickstartMints(): Promise<{ mints: string[]; buyCount: Record<string, number> }> {
  const res = await fetch(KICKSTART_BUYS_URL, {
    cache: "no-store",
    headers: { "user-agent": "ShyftFeed/1.0 (+https://shyft.lol)" },
  });
  if (!res.ok) throw new Error(`recent-buys ${res.status}`);
  const json = await res.json();
  const buys: RecentBuy[] = Array.isArray(json?.buys) ? json.buys : [];

  const buyCount: Record<string, number> = {};
  const order: string[] = [];
  for (const b of buys) {
    const mint = (b?.mint || "").trim();
    if (!mint) continue;
    if (!(mint in buyCount)) order.push(mint);
    buyCount[mint] = (buyCount[mint] || 0) + 1;
  }
  return { mints: order.slice(0, 100), buyCount };
}

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
      console.warn("[kickstart trending] DexScreener batch failed:", e);
    }
  }
  return result;
}

type TokenMeta = { name?: string; symbol?: string; image?: string };

/**
 * Name/symbol/image straight from the mint's metadata via Helius DAS, for
 * launches too new to have a DEX pair. Best-effort: any failure just leaves
 * the placeholder in place rather than failing the whole response.
 */
async function fetchOnChainMetadata(
  mints: string[],
): Promise<Record<string, TokenMeta>> {
  const key = process.env.HELIUS_API_KEY_PRIVATE || process.env.HELIUS_API_KEY;
  if (!key) return {};
  try {
    const resp = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "kickstart-meta",
        method: "getAssetBatch",
        params: { ids: mints.slice(0, 100) },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return {};
    const json = await resp.json();
    const out: Record<string, TokenMeta> = {};
    for (const asset of json?.result ?? []) {
      if (!asset?.id) continue;
      const md = asset.content?.metadata ?? {};
      out[asset.id] = {
        name: md.name || undefined,
        symbol: md.symbol || undefined,
        image:
          asset.content?.links?.image ||
          asset.content?.files?.[0]?.uri ||
          undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
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
    const { mints, buyCount } = await fetchKickstartMints();
    if (mints.length === 0) {
      return NextResponse.json({ success: true, response: [] });
    }

    const dex = await fetchDexScreener(mints);

    // Fresh launches usually have no DEX pair yet, so DexScreener knows
    // nothing about them and every one would render as "Unknown". Their
    // on-chain metadata exists from mint, so fall back to that for names.
    const unlisted = mints.filter((m) => !dex[m]);
    const meta = unlisted.length ? await fetchOnChainMetadata(unlisted) : {};

    const enriched: TrendingToken[] = mints.map((mint) => {
      const p = dex[mint];
      const m = meta[mint];
      return {
        tokenMint: mint,
        name: p?.baseToken?.name || p?.baseToken?.symbol || m?.name || "Unknown",
        symbol: p?.baseToken?.symbol || m?.symbol || "?",
        image: p?.info?.imageUrl || p?.info?.openGraph || m?.image || "",
        status: undefined,
        priceUsd: p?.priceUsd ? Number(p.priceUsd) : undefined,
        priceChange24h: p?.priceChange?.h24 != null ? Number(p.priceChange.h24) : undefined,
        volume24h: p?.volume?.h24 != null ? Number(p.volume.h24) : undefined,
        marketCap: p?.marketCap != null ? Number(p.marketCap) : (p?.fdv != null ? Number(p.fdv) : undefined),
        liquidity: p?.liquidity?.usd != null ? Number(p.liquidity.usd) : undefined,
        pairAddress: p?.pairAddress,
        dexId: p?.dexId,
      };
    });

    // Prefer launches that actually have price data, keep the rest as fallback
    const withPrice = enriched.filter((t) => t.priceUsd != null && t.priceUsd > 0);
    const withoutPrice = enriched.filter((t) => t.priceUsd == null || t.priceUsd <= 0);

    // Rank priced launches by 24h volume, then by how many recent buys they had
    withPrice.sort((a, b) => {
      const vol = (b.volume24h || 0) - (a.volume24h || 0);
      if (vol !== 0) return vol;
      return (buyCount[b.tokenMint] || 0) - (buyCount[a.tokenMint] || 0);
    });

    // Dedupe by symbol+name (a launch can have multiple pools/relaunches —
    // keep only the highest-volume one per ticker)
    const seen = new Set<string>();
    const dedupe = (list: TrendingToken[]) =>
      list.filter((t) => {
        const symbol = (t.symbol || "").toLowerCase().trim();
        const name = (t.name || "").toLowerCase().trim();
        // Launches with no metadata all share the placeholder symbol/name, so
        // keying on those collapses every unidentified launch into one row.
        // Fall back to the mint, which is unique by definition.
        const identified = symbol && symbol !== "?" && name && name !== "unknown";
        const key = identified ? `${symbol}|${name}` : t.tokenMint;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const final = [...dedupe(withPrice), ...dedupe(withoutPrice)].slice(0, 20);

    cache = { ts: Date.now(), data: final };
    return NextResponse.json({ success: true, response: final, cached: false });
  } catch (error: any) {
    console.error("[kickstart trending GET]", error);
    // If we have stale cache, serve it on error
    if (cache) {
      return NextResponse.json({ success: true, response: cache.data, cached: true, stale: true });
    }
    return NextResponse.json({ success: false, error: error?.message || "Internal error" }, { status: 500 });
  }
}
