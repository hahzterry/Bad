"use client";

import { useState, useEffect } from "react";
import { Flame, TrendingUp, TrendingDown, ExternalLink, ChevronDown, ChevronUp, Droplets, Globe, Twitter, Send as SendIcon } from "lucide-react";
import TokenTrade from "@/components/TokenTrade";

/**
 * Pinned "featured token" card at the very top of the feed.
 *
 * Used to spotlight a single token (currently the pump.fun "ANSEUM" coin) and
 * let users buy/sell it inline. Because it's a pump.fun mint, trading routes
 * through Jupiter (see <TokenTrade provider="jupiter" />), not Bags.
 *
 * Live price/metadata comes from DexScreener's free public API, which indexes
 * pump.fun tokens.
 */

// ─── Featured token config ───
export const FEATURED_TOKEN = {
  mint: "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump",
  // Fallbacks shown until DexScreener responds.
  symbol: "ANSEUM",
  name: "Anseum",
  decimals: 6, // pump.fun standard
};

type DexLink = { label: string; url: string; kind: "twitter" | "telegram" | "web" };

type DexInfo = {
  name?: string;
  symbol?: string;
  image?: string;
  header?: string;
  priceUsd?: number;
  priceChange24h?: number;
  marketCap?: number;
  volume24h?: number;
  liquidity?: number;
  buys24h?: number;
  sells24h?: number;
  pairAddress?: string;
  url?: string;
  links?: DexLink[];
};

function formatPrice(p?: number): string {
  if (p == null || p <= 0) return "—";
  if (p >= 1) return `$${p.toFixed(4)}`;
  if (p >= 0.0001) return `$${p.toFixed(6)}`;
  return `$${p.toExponential(2)}`;
}

function formatCompact(n?: number): string {
  if (n == null || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function FeaturedToken() {
  const [info, setInfo] = useState<DexInfo>({});
  const [showTrade, setShowTrade] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${FEATURED_TOKEN.mint}`
        );
        const data = await res.json();
        const pairs: any[] = Array.isArray(data?.pairs) ? data.pairs : [];
        if (!pairs.length) return;
        // Pick the deepest-liquidity pair for the most reliable price.
        const best = pairs.sort(
          (a, b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0)
        )[0];
        if (cancelled || !best) return;

        // Collect social/website links from DexScreener's enriched info.
        const links: DexLink[] = [];
        for (const w of (best?.info?.websites || [])) {
          if (w?.url) links.push({ label: w.label || "Website", url: w.url, kind: "web" });
        }
        for (const s of (best?.info?.socials || [])) {
          if (!s?.url) continue;
          const t = String(s.type || "").toLowerCase();
          links.push({
            label: s.type || "Link",
            url: s.url,
            kind: t.includes("twitter") || t.includes("x") ? "twitter" : t.includes("telegram") ? "telegram" : "web",
          });
        }

        setInfo({
          name: best?.baseToken?.name,
          symbol: best?.baseToken?.symbol,
          image: best?.info?.imageUrl,
          header: best?.info?.header,
          priceUsd: best?.priceUsd ? Number(best.priceUsd) : undefined,
          priceChange24h: best?.priceChange?.h24 != null ? Number(best.priceChange.h24) : undefined,
          marketCap: best?.marketCap != null ? Number(best.marketCap) : (best?.fdv != null ? Number(best.fdv) : undefined),
          volume24h: best?.volume?.h24 != null ? Number(best.volume.h24) : undefined,
          liquidity: best?.liquidity?.usd != null ? Number(best.liquidity.usd) : undefined,
          buys24h: best?.txns?.h24?.buys != null ? Number(best.txns.h24.buys) : undefined,
          sells24h: best?.txns?.h24?.sells != null ? Number(best.txns.h24.sells) : undefined,
          pairAddress: best?.pairAddress,
          url: best?.url,
          links,
        });
      } catch {
        // Silently keep fallbacks — card still renders & trades.
      }
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const symbol = info.symbol || FEATURED_TOKEN.symbol;
  const name = info.name || FEATURED_TOKEN.name;
  const change = info.priceChange24h;
  const isUp = (change ?? 0) >= 0;
  const dexUrl = info.url || `https://dexscreener.com/solana/${FEATURED_TOKEN.mint}`;

  return (
    <div className="mb-4 rounded-2xl border border-amber-300/70 dark:border-amber-500/30 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-[#241c10] dark:to-[#1a1305] shadow-sm overflow-hidden animate-fade-in">
      {/* Featured banner */}
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-1">
        <Flame className="w-3.5 h-3.5 text-orange-500" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-orange-600 dark:text-orange-400">
          Featured · Trending on Shyft
        </span>
      </div>

      <div className="px-4 pb-3">
        <div className="flex items-center gap-3">
          {info.image ? (
            <img src={info.image} alt={symbol} className="w-12 h-12 rounded-full object-cover ring-2 ring-amber-200 dark:ring-amber-500/30" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <span className="text-lg font-bold text-white">{symbol[0]}</span>
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#1A1A2E] dark:text-white truncate">{name}</span>
              <span className="text-xs font-semibold text-[#64748B]">${symbol}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm font-bold text-[#1A1A2E] dark:text-white">{formatPrice(info.priceUsd)}</span>
              {change != null && (
                <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${isUp ? "text-emerald-600" : "text-red-500"}`}>
                  {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {isUp ? "+" : ""}{change.toFixed(1)}%
                </span>
              )}
            </div>
          </div>

          <button
            onClick={() => setShowTrade((s) => !s)}
            className="shrink-0 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-sm font-bold flex items-center gap-1 shadow-sm transition"
          >
            Trade
            {showTrade ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-[#64748B]">
          <span>MC <b className="text-[#1A1A2E] dark:text-white">{formatCompact(info.marketCap)}</b></span>
          <span>Vol 24h <b className="text-[#1A1A2E] dark:text-white">{formatCompact(info.volume24h)}</b></span>
          <span className="inline-flex items-center gap-1">
            <Droplets className="w-3 h-3" /> Liq <b className="text-[#1A1A2E] dark:text-white">{formatCompact(info.liquidity)}</b>
          </span>
          {(info.buys24h != null || info.sells24h != null) && (
            <span>
              24h <b className="text-emerald-600">{info.buys24h ?? 0} buys</b>
              {" / "}
              <b className="text-red-500">{info.sells24h ?? 0} sells</b>
            </span>
          )}
          <a href={dexUrl} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 hover:text-amber-600">
            Chart <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Social / website links + contract */}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {(info.links || []).map((l, i) => {
            const Icon = l.kind === "twitter" ? Twitter : l.kind === "telegram" ? SendIcon : Globe;
            return (
              <a
                key={i}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/70 dark:bg-white/10 border border-amber-200/70 dark:border-amber-500/20 text-[10px] font-medium text-[#475569] dark:text-slate-300 hover:text-amber-600"
              >
                <Icon className="w-3 h-3" /> {l.label}
              </a>
            );
          })}
          <button
            onClick={() => { navigator.clipboard?.writeText(FEATURED_TOKEN.mint); }}
            title="Copy contract address"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/70 dark:bg-white/10 border border-amber-200/70 dark:border-amber-500/20 text-[10px] font-mono text-[#475569] dark:text-slate-300 hover:text-amber-600 ml-auto"
          >
            {FEATURED_TOKEN.mint.slice(0, 4)}…{FEATURED_TOKEN.mint.slice(-4)} ⧉
          </button>
        </div>

        {/* Inline buy/sell (routes via Jupiter for pump.fun) */}
        {showTrade && (
          <div className="mt-3">
            <TokenTrade
              tokenMint={FEATURED_TOKEN.mint}
              tokenSymbol={symbol}
              tokenImage={info.image}
              provider="jupiter"
              decimals={FEATURED_TOKEN.decimals}
              showBagsLinks={false}
              compact
            />
          </div>
        )}
      </div>
    </div>
  );
}
