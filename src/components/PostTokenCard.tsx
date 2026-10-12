"use client";

import { useState, useEffect } from "react";
import { Coins, TrendingUp, TrendingDown, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import TokenTrade from "@/components/TokenTrade";

/**
 * Compact token card rendered inside a post that has launched a coin.
 * Shows live price/metadata (DexScreener) and an inline buy/sell panel so
 * anyone scrolling the feed can trade the post's token.
 */

type Info = {
  name?: string;
  symbol?: string;
  image?: string;
  priceUsd?: number;
  priceChange24h?: number;
  marketCap?: number;
};

function fmtPrice(p?: number): string {
  if (p == null || p <= 0) return "—";
  if (p >= 1) return `$${p.toFixed(4)}`;
  if (p >= 0.0001) return `$${p.toFixed(6)}`;
  return `$${p.toExponential(2)}`;
}

function fmtCompact(n?: number): string {
  if (n == null || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function PostTokenCard({ mint, fallbackImage }: { mint: string; fallbackImage?: string }) {
  const [info, setInfo] = useState<Info>({});
  const [open, setOpen] = useState(false);

  // On-chain metadata (name/symbol/image) — available the instant a token launches.
  // Fetched once; DexScreener (below) only fills in price once liquidity is indexed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/bags?action=token-meta&mint=${mint}`);
        const data = await res.json();
        if (cancelled || !data?.success) return;
        const m = data.response || {};
        setInfo((prev) => ({
          ...prev,
          name: prev.name || m.name || undefined,
          symbol: prev.symbol || m.symbol || undefined,
          image: prev.image || m.image || undefined,
        }));
      } catch {
        /* keep fallbacks */
      }
    })();
    return () => { cancelled = true; };
  }, [mint]);

  // Live price/market data from DexScreener (available once the token is indexed).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
        const data = await res.json();
        const pairs: any[] = Array.isArray(data?.pairs) ? data.pairs : [];
        if (!pairs.length) return;
        const best = pairs.sort((a, b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0))[0];
        if (cancelled || !best) return;
        setInfo((prev) => ({
          ...prev,
          // Prefer richer DexScreener name/symbol/image when present, else keep on-chain meta.
          name: best?.baseToken?.name || prev.name,
          symbol: best?.baseToken?.symbol || prev.symbol,
          image: best?.info?.imageUrl || prev.image,
          priceUsd: best?.priceUsd ? Number(best.priceUsd) : undefined,
          priceChange24h: best?.priceChange?.h24 != null ? Number(best.priceChange.h24) : undefined,
          marketCap: best?.marketCap != null ? Number(best.marketCap) : (best?.fdv != null ? Number(best.fdv) : undefined),
        }));
      } catch {
        /* keep fallbacks */
      }
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [mint]);

  const symbol = info.symbol || mint.slice(0, 4).toUpperCase();
  const name = info.name || "Post Coin";
  const image = info.image || fallbackImage;
  const change = info.priceChange24h;
  const isUp = (change ?? 0) >= 0;

  return (
    <div className="mt-1 mb-3 sm:ml-14 rounded-xl border border-amber-300/60 dark:border-amber-500/25 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-[#241c10] dark:to-[#1a1305] overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 pt-2">
        <Coins className="w-3 h-3 text-amber-600" />
        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
          This post has a coin
        </span>
      </div>

      <div className="px-3 pb-3 pt-1.5">
        <div className="flex items-center gap-2.5">
          {image ? (
            <img src={image} alt={symbol} className="w-9 h-9 rounded-full object-cover ring-1 ring-amber-200 dark:ring-amber-500/30" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <span className="text-sm font-bold text-white">{symbol[0]}</span>
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm text-[#1A1A2E] dark:text-white truncate">{name}</span>
              <span className="text-[11px] font-semibold text-[#64748B]">${symbol}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#1A1A2E] dark:text-white">{fmtPrice(info.priceUsd)}</span>
              {change != null && (
                <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${isUp ? "text-emerald-600" : "text-red-500"}`}>
                  {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                  {isUp ? "+" : ""}{change.toFixed(1)}%
                </span>
              )}
              {info.marketCap != null && (
                <span className="text-[10px] text-[#94A3B8]">MC {fmtCompact(info.marketCap)}</span>
              )}
            </div>
          </div>

          <button
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-xs font-bold flex items-center gap-1 transition"
          >
            Trade {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {open && (
          <div className="mt-2.5">
            <TokenTrade
              tokenMint={mint}
              tokenSymbol={symbol}
              tokenImage={image}
              showBagsLinks={false}
              compact
            />
            <a
              href={`https://dexscreener.com/solana/${mint}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 flex items-center justify-center gap-1 text-[10px] text-[#94A3B8] hover:text-amber-600"
            >
              View chart <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
