"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CandlestickChart,
  TrendingUp,
  TrendingDown,
  Loader2,
  RefreshCw,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { XSTOCKS, STOCK_DECIMALS, formatStockPrice, stockLogoUrl, type StockToken } from "@/lib/stocks";
import { useAppStore } from "@/lib/store";
import TokenTrade from "@/components/TokenTrade";

const DISCLAIMER_KEY = "shyft_xstocks_disclaimer_ack";

interface PriceInfo {
  usdPrice: number;
  change24h: number;
}

/** Official xStock logo with a graceful fallback to a gradient letter avatar. */
function StockAvatar({ stock, className }: { stock: StockToken; className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={`${className} rounded-full bg-gradient-to-br from-[#16A34A] to-[#2563EB] flex items-center justify-center flex-shrink-0`}>
        <span className="font-bold text-white">{stock.symbol[0]}</span>
      </div>
    );
  }
  return (
    <img
      src={stockLogoUrl(stock.symbol)}
      alt={stock.symbol}
      onError={() => setFailed(true)}
      className={`${className} rounded-full object-cover bg-white flex-shrink-0`}
    />
  );
}

export default function Stocks() {
  const { setActiveTab } = useAppStore();
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({});
  const [loading, setLoading] = useState(true);
  const [selectedStock, setSelectedStock] = useState<StockToken | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  useEffect(() => {
    setShowDisclaimer(!localStorage.getItem(DISCLAIMER_KEY));
  }, []);

  const fetchPrices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stocks?action=prices");
      const data = await res.json();
      if (data.success && data.response) {
        setPrices(data.response);
      }
    } catch (err) {
      console.error("Failed to fetch stock prices:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPrices(); }, [fetchPrices]);

  const acceptDisclaimer = () => {
    localStorage.setItem(DISCLAIMER_KEY, "true");
    setShowDisclaimer(false);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0F172A] to-[#1E293B] flex items-center justify-center ring-1 ring-white/10">
            <CandlestickChart className="w-5 h-5 text-[#22C55E]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#1A1A2E]">Stocks</h1>
            <p className="text-xs text-[#64748B]">Tokenized equities — powered by xStocks &amp; Jupiter</p>
          </div>
        </div>
        <button onClick={fetchPrices} className="p-1.5 hover:bg-[#F1F5F9] rounded-lg transition">
          <RefreshCw className={`w-4 h-4 text-[#94A3B8] ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Stock List */}
      {loading && Object.keys(prices).length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-[#2563EB] animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {XSTOCKS.map((stock) => {
            const price = prices[stock.mint];
            const change = price?.change24h;
            const isUp = (change ?? 0) >= 0;
            return (
              <button
                key={stock.mint}
                onClick={() => setSelectedStock(stock)}
                className="w-full flex items-center gap-3 p-3 bg-white rounded-2xl border border-[#E2E8F0] hover:border-[#2563EB]/30 hover:shadow-sm transition text-left"
              >
                <StockAvatar stock={stock} className="w-9 h-9 text-xs" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-[#1A1A2E] truncate">{stock.name}</span>
                    <span className="text-xs text-[#94A3B8]">${stock.symbol}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <p className="text-sm font-mono font-semibold text-[#1A1A2E]">
                      {formatStockPrice(price?.usdPrice)}
                    </p>
                    {change != null && (
                      <p className={`flex items-center justify-end gap-0.5 text-xs font-bold ${isUp ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                        {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {isUp ? "+" : ""}{change.toFixed(2)}%
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#CBD5E1]" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Disclosure footer */}
      <p className="text-[10px] text-[#94A3B8] text-center py-2 px-4">
        xStocks are tokenized representations of real shares (issued by Backed Finance), not direct equity ownership —
        no voting rights, dividends auto-reinvested into token value. Not available to US persons. Trading is routed via Jupiter
        and subject to market/liquidity risk.
      </p>

      {/* Trade Modal */}
      {selectedStock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto">
            <div className="p-5 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-3">
                <StockAvatar stock={selectedStock} className="w-12 h-12 text-lg" />
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold text-[#1A1A2E]">{selectedStock.name}</h2>
                  <span className="text-sm text-[#64748B]">${selectedStock.symbol}</span>
                </div>
                <button onClick={() => setSelectedStock(null)} className="p-2 hover:bg-[#F1F5F9] rounded-lg">✕</button>
              </div>
            </div>
            <div className="p-4">
              <TokenTrade
                tokenMint={selectedStock.mint}
                tokenSymbol={selectedStock.symbol}
                tokenImage={stockLogoUrl(selectedStock.symbol)}
                decimals={STOCK_DECIMALS}
                showBagsLinks={false}
                compact
              />
            </div>
          </div>
        </div>
      )}

      {/* One-time Disclaimer */}
      {showDisclaimer && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-6">
            <div className="w-12 h-12 rounded-2xl bg-[#FFFBEB] flex items-center justify-center mb-4">
              <ShieldAlert className="w-6 h-6 text-[#D97706]" />
            </div>
            <h2 className="text-lg font-bold text-[#1A1A2E] mb-2">Before you trade xStocks</h2>
            <ul className="text-sm text-[#475569] space-y-2 mb-5 list-disc pl-5">
              <li>
                xStocks are tokenized representations of real shares, issued by Backed Finance and held 1:1 in
                custody — not direct equity ownership. They carry no voting rights, and dividends are
                automatically reinvested into the token&apos;s value.
              </li>
              <li>
                <strong>xStocks are not available to US persons.</strong> By continuing, you confirm you are not
                a US person or resident.
              </li>
              <li>
                Trades are routed through Jupiter and are subject to market and liquidity risk.
              </li>
            </ul>
            <div className="flex flex-col gap-2">
              <button
                onClick={acceptDisclaimer}
                className="w-full py-2.5 px-4 rounded-xl font-semibold text-sm bg-[#2563EB] hover:bg-[#1D4ED8] text-white transition"
              >
                I Understand &amp; Agree
              </button>
              <button
                onClick={() => setActiveTab("feed")}
                className="w-full py-2.5 px-4 rounded-xl font-medium text-sm text-[#64748B] hover:bg-[#F1F5F9] transition"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
