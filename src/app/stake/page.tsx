"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useAppStore } from "@/lib/store";
import { useWallet } from "@/hooks/usePrivyWallet";
import {
  Sun, Moon, Lock, Coins, TrendingUp, Wallet, Layers, Clock, Zap, ChevronRight,
} from "lucide-react";

/* ───────── Config (matches scripts/create-staking-pool.ts) ───────── */
const BASE_APY = 25; // Season 1 base APY (7-day, 1.0x)
const SOL_USD = 78;
const SHYFT_USD = 0.0000572;
const SEASON_BUDGET_SOL = 50;

const TIERS = [
  { days: 7, mult: 1.0, label: "7 days" },
  { days: 30, mult: 1.3, label: "30 days" },
  { days: 90, mult: 2.0, label: "90 days" },
  { days: 180, mult: 3.0, label: "180 days" },
];

function fmt(n: number, d = 2) {
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

export default function StakePage() {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const { connected } = useWallet();

  const [amount, setAmount] = useState("");
  const [tierIdx, setTierIdx] = useState(3); // default 180d

  const tier = TIERS[tierIdx];
  const effectiveApy = BASE_APY * tier.mult;

  const calc = useMemo(() => {
    const tokens = parseFloat(amount) || 0;
    const stakeUsd = tokens * SHYFT_USD;
    const rewardPct = (effectiveApy / 100) * (tier.days / 365); // over the lock
    const rewardUsd = stakeUsd * rewardPct;
    const rewardSol = rewardUsd / SOL_USD;
    return { tokens, stakeUsd, rewardUsd, rewardSol };
  }, [amount, effectiveApy, tier.days]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#FAFBFC]">
      {/* Nav */}
      <nav className="flex-none flex items-center justify-between px-4 sm:px-6 md:px-8 py-3 border-b border-[#E2E8F0] bg-white/90 backdrop-blur-lg">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="text-4xl sm:text-5xl font-black text-[#1F2937] group-hover:text-[#2563EB] transition-colors" style={{ fontFamily: "Georgia, serif", fontWeight: 900, lineHeight: 1 }}>S</div>
          <div>
            <h1 className="text-base font-bold text-[#1A1A2E]">Stake $SHYFT</h1>
            <p className="text-[9px] text-[#64748B] -mt-0.5">Earn SOL</p>
          </div>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={toggleTheme} aria-label="Toggle theme" className="p-2 rounded-lg hover:bg-[#F1F5F9] text-[#64748B] transition-colors">
            {theme === "dark" ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
          </button>
          <Link href="/tokenomics" className="hidden sm:block text-xs text-[#64748B] hover:text-[#2563EB] transition-colors">Tokenomics</Link>
          <Link href="/" className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-lg transition-colors">Open App</Link>
        </div>
      </nav>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-20 pt-8">
          {/* Preview banner */}
          <div className="mb-5 flex items-center gap-2 rounded-xl border border-[#FED7AA] bg-[#FFF7ED] px-4 py-2.5">
            <Clock className="w-4 h-4 text-orange-500 flex-shrink-0" />
            <p className="text-xs font-medium text-orange-700">Preview — staking pool goes live soon. Numbers below are illustrative.</p>
          </div>

          {/* Hero */}
          <div className="text-center mb-8">
            <h1 className="text-3xl sm:text-4xl font-black text-[#1A1A2E] tracking-tight text-balance">Lock $SHYFT. Earn <span className="text-[#16A34A]">real SOL.</span></h1>
            <p className="mt-3 text-[#64748B] text-sm sm:text-base max-w-lg mx-auto">Stake your $SHYFT and earn a share of platform trading fees, paid in SOL. Lock longer, earn more. Powered by Streamflow — non-custodial.</p>
          </div>

          {/* Cockpit */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { icon: Layers, label: "Total staked", value: "—", sub: "at launch" },
              { icon: Wallet, label: "Stakers", value: "—", sub: "wallets" },
              { icon: Coins, label: "Season 1 budget", value: `${SEASON_BUDGET_SOL} SOL`, sub: "reward pool" },
              { icon: TrendingUp, label: "Up to APY", value: `${fmt(BASE_APY * 3)}%`, sub: "180-day lock" },
            ].map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={i} className="rounded-xl border border-[#E2E8F0] bg-white p-4">
                  <div className="flex items-center gap-1.5 text-[#64748B] mb-2"><Icon className="w-3.5 h-3.5" /><span className="text-[11px] font-medium">{s.label}</span></div>
                  <div className="text-lg font-black text-[#1A1A2E] tabular-nums">{s.value}</div>
                  <div className="text-[10px] text-[#94A3B8]">{s.sub}</div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            {/* Stake panel */}
            <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5">
              <div className="flex items-center gap-2 mb-4"><Lock className="w-4 h-4 text-[#16A34A]" /><h2 className="font-bold text-[#1A1A2E]">Stake</h2></div>

              {/* Amount */}
              <label className="text-xs font-medium text-[#64748B] mb-1.5 block">Amount ($SHYFT)</label>
              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 mb-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full bg-transparent text-2xl font-bold text-[#1A1A2E] focus:outline-none placeholder:text-[#CBD5E1]"
                />
                <div className="text-xs text-[#94A3B8] mt-0.5">≈ ${fmt(calc.stakeUsd)} USD</div>
              </div>
              <div className="flex gap-2 mb-5">
                {["1000000", "10000000", "100000000"].map((v) => (
                  <button key={v} onClick={() => setAmount(v)} className="flex-1 py-1.5 text-xs font-semibold text-[#475569] bg-[#F1F5F9] hover:bg-[#E2E8F0] rounded-lg transition-colors">
                    {parseInt(v) >= 1e6 ? `${parseInt(v) / 1e6}M` : v}
                  </button>
                ))}
              </div>

              {/* Lock duration */}
              <label className="text-xs font-medium text-[#64748B] mb-2 block">Lock duration</label>
              <div className="space-y-2 mb-5">
                {TIERS.map((t, i) => (
                  <button
                    key={t.days}
                    onClick={() => setTierIdx(i)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                      tierIdx === i ? "border-[#16A34A] bg-[#F0FDF4]" : "border-[#E2E8F0] bg-white hover:border-[#CBD5E1]"
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${tierIdx === i ? "border-[#16A34A]" : "border-[#CBD5E1]"}`}>
                        {tierIdx === i && <span className="w-2 h-2 rounded-full bg-[#16A34A]" />}
                      </span>
                      <span className="text-sm font-semibold text-[#1A1A2E]">{t.label}</span>
                    </span>
                    <span className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded-md ${tierIdx === i ? "bg-[#16A34A] text-white" : "text-[#94A3B8]"}`}>{t.mult.toFixed(1)}×</span>
                  </button>
                ))}
              </div>

              {/* Effective APY row */}
              <div className="flex items-center justify-between rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 mb-4">
                <span className="text-xs text-[#64748B]">Effective APY</span>
                <span className="text-lg font-black text-[#16A34A] tabular-nums">{fmt(effectiveApy)}%</span>
                <span className="text-xs text-[#64748B]">Multiplier</span>
                <span className="text-sm font-bold text-[#1A1A2E] tabular-nums">{tier.mult.toFixed(1)}×</span>
              </div>

              <button
                disabled
                title="Staking pool not live yet"
                className="w-full py-3 rounded-xl bg-[#E2E8F0] text-[#94A3B8] font-bold text-sm cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Clock className="w-4 h-4" /> {connected ? "Staking launches soon" : "Connect wallet — coming soon"}
              </button>
            </div>

            {/* Estimate + My stakes */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-[#BBF7D0] bg-[#F0FDF4] p-5">
                <div className="flex items-center gap-2 mb-3"><Zap className="w-4 h-4 text-[#16A34A]" /><h3 className="font-bold text-[#1A1A2E] text-sm">You'd earn</h3></div>
                <div className="text-3xl font-black text-[#15803D] tabular-nums">{fmt(calc.rewardSol, 4)} SOL</div>
                <div className="text-sm text-[#16A34A] font-semibold">≈ ${fmt(calc.rewardUsd)}</div>
                <p className="text-[11px] text-[#475569] mt-2 leading-relaxed">over {tier.days} days, on top of your {calc.tokens ? fmt(calc.tokens, 0) : "—"} $SHYFT (returned at unlock).</p>
              </div>

              <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5">
                <div className="flex items-center gap-2 mb-3"><Layers className="w-4 h-4 text-[#2563EB]" /><h3 className="font-bold text-[#1A1A2E] text-sm">My stakes</h3></div>
                <div className="text-center py-6">
                  <p className="text-xs text-[#94A3B8]">{connected ? "No active stakes yet." : "Connect your wallet to view stakes."}</p>
                </div>
              </div>
            </div>
          </div>

          {/* How it works */}
          <div className="mt-8 rounded-2xl border border-[#E2E8F0] bg-white p-5">
            <h3 className="font-bold text-[#1A1A2E] mb-3">How it works</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { n: "1", t: "Lock $SHYFT", d: "Stake your tokens for 7–180 days. Longer lock = bigger multiplier = bigger share." },
                { n: "2", t: "Earn SOL", d: "You earn a share of the reward pool, paid in real SOL — not more tokens, no dilution." },
                { n: "3", t: "Claim & unlock", d: "Claim your SOL anytime. Get your $SHYFT back when your lock ends. Non-custodial via Streamflow." },
              ].map((s) => (
                <div key={s.n}>
                  <div className="w-7 h-7 rounded-lg bg-[#EFF6FF] text-[#2563EB] font-bold text-sm flex items-center justify-center mb-2">{s.n}</div>
                  <div className="font-semibold text-[#1A1A2E] text-sm mb-1">{s.t}</div>
                  <p className="text-xs text-[#64748B] leading-relaxed">{s.d}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-center text-[11px] text-[#94A3B8] mt-6">
            Rewards are paid from a capped {SEASON_BUDGET_SOL} SOL Season-1 pool and vary with how much is staked. APY is illustrative and not guaranteed.
          </p>
        </main>
      </div>
    </div>
  );
}
