"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, ExternalLink, Flame, BarChart3, X } from "lucide-react";
import { useAppStore } from "@/lib/store";

export type TrendingToken = {
  tokenMint: string;
  name: string;
  symbol: string;
  image: string;
  description?: string;
  status?: string;
  priceUsd?: number;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
  liquidity?: number;
  pairAddress?: string;
  dexId?: string;
};

interface TrendingTokenCardProps {
  token: TrendingToken;
  onTrade?: (token: TrendingToken) => void;
}

function formatPrice(p?: number): string {
  if (p == null || p <= 0) return "—";
  if (p >= 1) return `$${p.toFixed(4)}`;
  if (p >= 0.01) return `$${p.toFixed(5)}`;
  if (p >= 0.0001) return `$${p.toFixed(6)}`;
  // Very small numbers: use compact exponent notation
  return `$${p.toExponential(2)}`;
}

function formatCompact(n?: number): string {
  if (n == null || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function TrendingTokenCard({ token, onTrade }: TrendingTokenCardProps) {
  const [showChart, setShowChart] = useState(false);
  const theme = useAppStore((s) => s.theme);
  const change = token.priceChange24h;
  const isUp = (change ?? 0) >= 0;
  const hasChart = !!token.pairAddress;

  const kickstartUrl = `https://kickstart.easya.io/token/${token.tokenMint}`;
  const dexUrl = token.pairAddress
    ? `https://dexscreener.com/solana/${token.pairAddress}`
    : `https://dexscreener.com/solana/${token.tokenMint}`;
  const chartEmbedUrl = token.pairAddress
    ? `https://dexscreener.com/solana/${token.pairAddress}?embed=1&theme=${theme === "dark" ? "dark" : "light"}&trades=0&info=0`
    : null;

  return (
    <div className="relative bg-white border border-[#E2E8F0] rounded-2xl p-3 sm:p-4 hover:border-[#2563EB]/30 transition-all">
      {/* Sponsored-style label */}
      <div className="flex items-center gap-1.5 mb-2.5">
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#FEF3C7] border border-[#FCD34D]">
          <Flame className="w-3 h-3 text-[#D97706]" />
          <span className="text-[10px] font-bold text-[#92400E] uppercase tracking-wide">Trending on Kickstart</span>
        </div>
      </div>

      {/* Token row */}
      <div className="flex items-center gap-3">
        {token.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={token.image}
            alt={token.name}
            className="w-12 h-12 rounded-full object-cover flex-shrink-0 border border-[#E2E8F0]"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#2563EB] to-[#7C3AED] flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-white">{token.symbol?.[0] || "?"}</span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[#1A1A2E] text-[15px] truncate">{token.name}</span>
            <span className="text-xs text-[#94A3B8]">${token.symbol}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-sm font-mono font-semibold text-[#1A1A2E]">
              {formatPrice(token.priceUsd)}
            </span>
            {change != null && (
              <span className={`flex items-center gap-0.5 text-xs font-bold ${isUp ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {isUp ? "+" : ""}{change.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      {(token.marketCap || token.volume24h) && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          {token.marketCap != null && (
            <div className="bg-[#F8FAFC] rounded-lg px-2.5 py-1.5">
              <p className="text-[10px] text-[#94A3B8] uppercase font-medium">Market Cap</p>
              <p className="text-xs font-bold text-[#1A1A2E]">{formatCompact(token.marketCap)}</p>
            </div>
          )}
          {token.volume24h != null && (
            <div className="bg-[#F8FAFC] rounded-lg px-2.5 py-1.5">
              <p className="text-[10px] text-[#94A3B8] uppercase font-medium">24h Volume</p>
              <p className="text-xs font-bold text-[#1A1A2E]">{formatCompact(token.volume24h)}</p>
            </div>
          )}
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center gap-2 mt-3">
        {onTrade && (
          <button
            onClick={() => onTrade(token)}
            className="flex items-center justify-center py-2 px-3 bg-[#2563EB] text-white text-xs font-bold rounded-xl hover:bg-[#1D4ED8] transition"
          >
            Trade
          </button>
        )}
        <a
          href={kickstartUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gradient-to-r from-[#16A34A] to-[#15803D] text-white text-xs font-bold rounded-xl hover:opacity-90 transition"
        >
          Buy on Kickstart
          <ExternalLink className="w-3 h-3" />
        </a>
        {hasChart && (
          <button
            onClick={() => setShowChart((s) => !s)}
            className="flex items-center justify-center gap-1.5 py-2 px-3 bg-[#F1F5F9] text-[#1A1A2E] text-xs font-semibold rounded-xl hover:bg-[#E2E8F0] transition"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            {showChart ? "Hide" : "Chart"}
          </button>
        )}
        <a
          href={dexUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center py-2 px-3 bg-[#F1F5F9] text-[#1A1A2E] text-xs font-semibold rounded-xl hover:bg-[#E2E8F0] transition"
          title="View on DexScreener"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Chart embed (lazy) */}
      {showChart && chartEmbedUrl && (
        <div className="relative mt-3 rounded-xl overflow-hidden border border-[#E2E8F0] bg-white">
          <iframe
            src={chartEmbedUrl}
            className="w-full"
            style={{ height: 360, border: 0 }}
            title={`${token.symbol} chart`}
            loading="lazy"
          />
          <button
            onClick={() => setShowChart(false)}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 backdrop-blur border border-[#E2E8F0] flex items-center justify-center hover:bg-white transition"
            aria-label="Hide chart"
          >
            <X className="w-3.5 h-3.5 text-[#64748B]" />
          </button>
        </div>
      )}
    </div>
  );
}
