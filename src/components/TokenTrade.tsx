"use client";

import { useState, useEffect } from "react";
import {
  ArrowUpDown,
  Loader2,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  ChevronDown,
  DollarSign,
  Info,
} from "lucide-react";
import { useWallet, pollConfirmation, getSharedConnection } from "@/hooks/usePrivyWallet";
import { toast } from "@/components/Toast";
import { VersionedTransaction } from "@solana/web3.js";
import { SOL_MINT, formatSOL } from "@/lib/bags";

interface TokenTradeProps {
  tokenMint: string;
  tokenSymbol: string;
  tokenImage?: string;
  onClose?: () => void;
  compact?: boolean;
  /** Decimals of the non-SOL token (default 9, e.g. Bags tokens). xStocks use 8, pump.fun use 6. */
  decimals?: number;
  /** Show Bags.fm links/attribution. Set false for non-Bags tokens (e.g. xStocks). */
  showBagsLinks?: boolean;
  /**
   * Which router to quote/swap through. Defaults to auto: pump.fun mints
   * (ending in "pump") route via Jupiter since Bags can't price them;
   * everything else goes through Bags.
   */
  provider?: "bags" | "jupiter" | "auto";
}

function friendlyError(msg: string): string {
  if (!msg) return "Something went wrong";
  const lower = msg.toLowerCase();
  if (lower.includes("insufficient lamports") || lower.includes("insufficient funds") || lower.includes("0x1"))
    return "Insufficient SOL balance. Please top up your wallet.";
  if (lower.includes("user rejected") || lower.includes("user denied"))
    return "Transaction cancelled.";
  if (lower.includes("blockhash") || lower.includes("expired"))
    return "Transaction expired. Please try again.";
  if (lower.includes("slippage"))
    return "Price moved too much. Try increasing slippage.";
  if (msg.length > 100) return msg.slice(0, 80) + "…";
  return msg;
}

export default function TokenTrade({
  tokenMint,
  tokenSymbol,
  tokenImage,
  onClose,
  compact = false,
  decimals: decimalsProp,
  showBagsLinks = true,
  provider = "auto",
}: TokenTradeProps) {
  const { publicKey, signTransaction } = useWallet();

  // pump.fun tokens use 6 decimals and can't be priced by Bags — route via Jupiter.
  const isPumpToken = tokenMint.endsWith("pump");
  const useJupiter = provider === "jupiter" || (provider === "auto" && isPumpToken);
  const tradeApi = useJupiter ? "/api/jup" : "/api/bags";
  // Decimals must match the mint exactly — a wrong guess mis-scales both the
  // quote amount and the displayed output by orders of magnitude. Start from
  // an explicit prop or a heuristic, then resolve the real value on-chain below.
  const fallbackDecimals = decimalsProp ?? (isPumpToken ? 6 : 9);
  const [decimals, setDecimals] = useState<number>(fallbackDecimals);
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [quote, setQuote] = useState<any>(null);
  const [error, setError] = useState("");
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  // Resolve the mint's real decimals on-chain so quotes/displays are exact.
  // An explicit decimalsProp always wins (caller knows better, e.g. xStocks).
  useEffect(() => {
    if (decimalsProp != null) {
      setDecimals(decimalsProp);
      return;
    }
    let cancelled = false;
    // Reset to the heuristic while the real value loads so we never carry a
    // previous token's decimals into a new mint.
    setDecimals(isPumpToken ? 6 : 9);
    (async () => {
      try {
        const res = await fetch("/api/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [tokenMint] }),
        });
        const data = await res.json();
        const dec = data?.result?.value?.decimals;
        if (!cancelled && typeof dec === "number") setDecimals(dec);
      } catch (e) {
        console.warn("Failed to resolve token decimals, using fallback:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [tokenMint, decimalsProp, isPumpToken]);

  // Fetch token balance when switching to sell mode
  useEffect(() => {
    if (mode !== "sell" || !publicKey) {
      setTokenBalance(null);
      return;
    }
    const fetchBalance = async () => {
      setLoadingBalance(true);
      try {
        const rpcUrl = "/api/rpc";
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTokenAccountsByOwner",
            params: [
              publicKey.toBase58(),
              { mint: tokenMint },
              { encoding: "jsonParsed" },
            ],
          }),
        });
        const data = await res.json();
        const accounts = data?.result?.value || [];
        let total = 0;
        for (const acct of accounts) {
          const info = acct.account?.data?.parsed?.info;
          if (info?.tokenAmount?.uiAmount) {
            total += info.tokenAmount.uiAmount;
          }
        }
        setTokenBalance(total);
      } catch (e) {
        console.error("Failed to fetch token balance:", e);
        setTokenBalance(null);
      }
      setLoadingBalance(false);
    };
    fetchBalance();
  }, [mode, publicKey, tokenMint]);

  // Get a quote when amount changes
  useEffect(() => {
    if (!amount || Number(amount) <= 0) {
      setQuote(null);
      return;
    }

    const timer = setTimeout(async () => {
      setQuoting(true);
      setError("");
      try {
        const inputMint = mode === "buy" ? SOL_MINT : tokenMint;
        const outputMint = mode === "buy" ? tokenMint : SOL_MINT;
        // Buy-side input is always SOL (9 decimals); sell-side input is the token
        const inputDecimals = mode === "buy" ? 9 : decimals;
        const amountSmallest = Math.floor(Number(amount) * Math.pow(10, inputDecimals));

        const res = await fetch(tradeApi, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "quote", inputMint, outputMint, amount: amountSmallest }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        setQuote(data.response);
      } catch (err: any) {
        setError(err.message || "Failed to get quote");
        setQuote(null);
      }
      setQuoting(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [amount, mode, tokenMint, decimals]);

  const handleTrade = async () => {
    if (!publicKey || !signTransaction || !quote) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch(tradeApi, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "swap", quoteResponse: quote, userPublicKey: publicKey.toBase58() }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const tx = VersionedTransaction.deserialize(
        Buffer.from(data.response.unsignedTxBase64, "base64")
      );
      const signed = await signTransaction(tx);

      const connection = getSharedConnection();
      const sig = await connection.sendRawTransaction(signed.serialize());
      await pollConfirmation(connection, sig);

      // Report the confirmed swap for season quest points (fire-and-forget —
      // the server verifies the signature on-chain, nothing here is trusted)
      fetch("/api/quests/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58(), signature: sig }),
      }).catch(() => {});

      toast("success", `${mode === "buy" ? "Bought" : "Sold"} ${tokenSymbol} successfully! 🎉`);
      setAmount("");
      setQuote(null);
    } catch (err: any) {
      console.error("Trade error:", err);
      const msg = friendlyError(err.message);
      setError(msg);
      toast("error", msg);
    }
    setLoading(false);
  };

  const containerClass = compact
    ? "bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4"
    : "bg-white rounded-2xl shadow-lg border border-[#E2E8F0] p-5";

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {tokenImage && (
            <img src={tokenImage} alt={tokenSymbol} className="w-6 h-6 rounded-full" />
          )}
          <span className="font-bold text-sm text-[#1A1A2E]">
            {mode === "buy" ? "Buy" : "Sell"} ${tokenSymbol}
          </span>
        </div>
        {!useJupiter && showBagsLinks && (
          <a
            href={`https://kickstart.easya.io/token/${tokenMint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#94A3B8] hover:text-[#2563EB] flex items-center gap-1"
          >
            Kickstart <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Buy/Sell Toggle */}
      <div className="flex bg-[#F1F5F9] rounded-lg p-0.5 mb-3">
        <button
          onClick={() => { setMode("buy"); setAmount(""); setQuote(null); }}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${
            mode === "buy" ? "bg-[#16A34A] text-white shadow-sm" : "text-[#64748B] hover:text-[#475569]"
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => { setMode("sell"); setAmount(""); setQuote(null); }}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${
            mode === "sell" ? "bg-[#DC2626] text-white shadow-sm" : "text-[#64748B] hover:text-[#475569]"
          }`}
        >
          Sell
        </button>
      </div>

      {/* Amount Input */}
      <div className="mb-3">
        <label className="block text-xs text-[#64748B] mb-1">
          {mode === "buy" ? "Amount (SOL)" : `Amount (${tokenSymbol})`}
        </label>
        <div className="flex items-center gap-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2.5">
          <DollarSign className="w-4 h-4 text-[#94A3B8]" />
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            step={mode === "buy" ? "0.01" : "1"}
            className="flex-1 bg-transparent text-sm text-[#1A1A2E] focus:outline-none"
          />
          <span className="text-xs font-medium text-[#64748B]">
            {mode === "buy" ? "SOL" : tokenSymbol}
          </span>
        </div>
        {mode === "buy" && (
          <div className="flex gap-1.5 mt-1.5">
            {["0.1", "0.5", "1", "5"].map((val) => (
              <button
                key={val}
                onClick={() => setAmount(val)}
                className="flex-1 py-1 text-[10px] font-medium bg-[#F1F5F9] rounded-lg text-[#64748B] hover:bg-[#EFF6FF] hover:text-[#2563EB] transition"
              >
                {val} SOL
              </button>
            ))}
          </div>
        )}
        {mode === "sell" && (
          <div className="mt-1.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#64748B]">Balance:</span>
              <span className="text-[10px] font-semibold text-[#1A1A2E]">
                {loadingBalance ? "Loading..." : tokenBalance !== null ? `${tokenBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${tokenSymbol}` : "--"}
              </span>
            </div>
            <div className="flex gap-1.5">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  onClick={() => {
                    if (tokenBalance && tokenBalance > 0) {
                      // 100% sells the full balance; otherwise take the fraction.
                      const val = pct === 100 ? tokenBalance : (tokenBalance * pct) / 100;
                      // Keep fractional amounts (tokens/xStocks can be < 1); trim to the
                      // token's decimals via floor so we never exceed the balance.
                      const factor = Math.pow(10, decimals);
                      const trimmed = Math.floor(val * factor) / factor;
                      setAmount(trimmed.toString());
                    }
                  }}
                  disabled={!tokenBalance || tokenBalance <= 0}
                  className="flex-1 py-1 text-[10px] font-medium bg-[#F1F5F9] rounded-lg text-[#64748B] hover:bg-[#FEF2F2] hover:text-[#DC2626] transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quote Details */}
      {quoting && (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="w-4 h-4 text-[#2563EB] animate-spin" />
          <span className="text-xs text-[#94A3B8] ml-2">Getting quote...</span>
        </div>
      )}

      {quote && !quoting && (
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 mb-3 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-[#64748B]">You {mode === "buy" ? "receive" : "get back"}</span>
            <span className="font-medium text-[#1A1A2E]">
              {mode === "buy"
                ? `${(Number(quote.outAmount) / Math.pow(10, decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokenSymbol}`
                : `${formatSOL(quote.outAmount)} SOL`}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[#64748B]">Price Impact</span>
            <span className={`font-medium ${Number(quote.priceImpactPct) > 3 ? "text-[#DC2626]" : "text-[#16A34A]"}`}>
              {Number(quote.priceImpactPct).toFixed(2)}%
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[#64748B]">Min. received</span>
            <span className="text-[#475569]">
              {mode === "buy"
                ? `${(Number(quote.minOutAmount) / Math.pow(10, decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokenSymbol}`
                : `${formatSOL(quote.minOutAmount)} SOL`}
            </span>
          </div>
          {quote.routePlan?.length > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-[#64748B]">Route</span>
              <span className="text-[#475569]">
                {quote.routePlan.map((leg: any) => leg.venue).join(" → ")}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {/* Trade Button */}
      <button
        onClick={handleTrade}
        disabled={!quote || loading || !publicKey || quoting}
        className={`w-full py-2.5 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed ${
          mode === "buy"
            ? "bg-[#16A34A] hover:bg-[#15803D] text-white"
            : "bg-[#DC2626] hover:bg-[#B91C1C] text-white"
        }`}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {mode === "buy" ? "Buying..." : "Selling..."}
          </>
        ) : (
          <>
            {mode === "buy" ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {mode === "buy" ? `Buy $${tokenSymbol}` : `Sell $${tokenSymbol}`}
          </>
        )}
      </button>

      {/* Attribution */}
      <p className="text-center text-[10px] text-[#94A3B8] mt-2">
        {!useJupiter && showBagsLinks ? (
          <>
            Trading powered by{" "}
            <a href="https://kickstart.easya.io" target="_blank" rel="noopener noreferrer" className="text-[#2563EB] hover:underline">
              Kickstart
            </a>
          </>
        ) : (
          <>
            Trading routed via{" "}
            <a href="https://jup.ag" target="_blank" rel="noopener noreferrer" className="text-[#2563EB] hover:underline">
              Jupiter
            </a>
          </>
        )}
      </p>
    </div>
  );
}
