"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Flame,
  Trophy,
  Zap,
  CheckCircle2,
  Circle,
  TrendingUp,
  Loader2,
  Coins,
  RefreshCw,
} from "lucide-react";
import { useWallet } from "@/hooks/usePrivyWallet";
import { useAppStore } from "@/lib/store";

type Quest = { action: string; label: string; points: number; done: number; cap: number };
type Trading = {
  tradesToday: number;
  volumeTodayUsd: number;
  volumeSeasonUsd: number;
  distinctTokensToday: number;
  firstTradeBonus: number;
  firstTradeDone: boolean;
  multiTokenBonus: number;
  multiTokenCount: number;
  multiTokenDone: boolean;
};
type QuestsData = {
  season: { id: number; startedAt: number; lastTallyAt: number };
  user: {
    points: number;
    rank: number;
    streak: number;
    multiplier: number;
    quests: Quest[];
    trading: Trading;
  } | null;
  leaderboard: { rank: number; wallet: string; name: string; points: number }[];
};

function shortAddr(addr: string): string {
  return addr.slice(0, 4) + "…" + addr.slice(-4);
}

function fmtPts(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return (n / 1000).toFixed(1) + "k";
  return n.toLocaleString();
}

export default function Quests() {
  const { publicKey } = useWallet();
  const { navigateToProfile, setActiveTab } = useAppStore();
  const [data, setData] = useState<QuestsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const wallet = publicKey ? publicKey.toBase58() : "";
      const res = await fetch(`/api/quests?wallet=${wallet}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.error) setData(json);
    } catch (err) {
      console.error("quests load failed:", err);
    }
    setLoading(false);
    setRefreshing(false);
  }, [publicKey]);

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 text-[#2563EB] animate-spin" />
      </div>
    );
  }

  const user = data?.user;
  const streak = user?.streak || 0;
  const mult = user?.multiplier || 1;
  const trading = user?.trading;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
          <Zap className="w-5 h-5 text-[#2563EB] mx-auto mb-1" />
          <p className="text-xl font-bold text-[#1A1A2E]">{fmtPts(user?.points || 0)}</p>
          <p className="text-[11px] text-[#64748B]">Points</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
          <Flame className={`w-5 h-5 mx-auto mb-1 ${streak > 0 ? "text-[#F59E0B]" : "text-[#CBD5E1]"}`} />
          <p className="text-xl font-bold text-[#1A1A2E]">
            {streak}
            <span className="text-xs font-semibold text-[#F59E0B] ml-1">{mult > 1 ? `${mult}x` : ""}</span>
          </p>
          <p className="text-[11px] text-[#64748B]">Day streak</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
          <Trophy className="w-5 h-5 text-[#16A34A] mx-auto mb-1" />
          <p className="text-xl font-bold text-[#1A1A2E]">{user?.rank ? `#${user.rank}` : "—"}</p>
          <p className="text-[11px] text-[#64748B]">Rank</p>
        </div>
      </div>

      {/* Streak explainer */}
      <div className="bg-gradient-to-r from-[#FFF7ED] to-[#FEF3C7] border border-[#FDE68A] rounded-2xl px-4 py-3 flex items-center gap-3">
        <Flame className="w-5 h-5 text-[#F59E0B] shrink-0" />
        <p className="text-xs text-[#92400E]">
          Do at least one on-chain action a day to keep your streak.{" "}
          <span className="font-semibold">3 days → 1.2x · 7 days → 1.5x · 30 days → 2x</span> on every point you earn.
        </p>
      </div>

      {/* Daily quests */}
      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
        <h3 className="text-sm font-bold text-[#1A1A2E] mb-3">Daily quests</h3>
        <div className="space-y-2.5">
          {(user?.quests || []).map((q) => {
            const complete = q.done >= q.cap;
            return (
              <div key={q.action} className="flex items-center gap-3">
                {complete ? (
                  <CheckCircle2 className="w-5 h-5 text-[#16A34A] shrink-0" />
                ) : (
                  <Circle className="w-5 h-5 text-[#CBD5E1] shrink-0" />
                )}
                <span className={`text-sm flex-1 ${complete ? "text-[#94A3B8] line-through" : "text-[#334155]"}`}>
                  {q.label}
                </span>
                <span className="text-[11px] text-[#64748B] tabular-nums">
                  {q.done}/{q.cap}
                </span>
                <span className="text-[11px] font-semibold text-[#2563EB] w-14 text-right">
                  +{q.points} pts
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Trading quests — the big earners */}
      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-[#1A1A2E] flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#16A34A]" /> Trading
          </h3>
          <button
            onClick={() => setActiveTab("tokens")}
            className="text-[11px] font-semibold text-[#2563EB] hover:underline"
          >
            Trade now →
          </button>
        </div>
        <div className="space-y-2.5">
          <div className="flex items-center gap-3">
            <Coins className="w-5 h-5 text-[#F59E0B] shrink-0" />
            <span className="text-sm flex-1 text-[#334155]">Volume — every $1 traded</span>
            <span className="text-[11px] font-semibold text-[#2563EB]">+1 pt</span>
          </div>
          <div className="flex items-center gap-3">
            {trading?.firstTradeDone ? (
              <CheckCircle2 className="w-5 h-5 text-[#16A34A] shrink-0" />
            ) : (
              <Circle className="w-5 h-5 text-[#CBD5E1] shrink-0" />
            )}
            <span className={`text-sm flex-1 ${trading?.firstTradeDone ? "text-[#94A3B8] line-through" : "text-[#334155]"}`}>
              First trade of the day
            </span>
            <span className="text-[11px] font-semibold text-[#2563EB]">+{trading?.firstTradeBonus ?? 25} pts</span>
          </div>
          <div className="flex items-center gap-3">
            {trading?.multiTokenDone ? (
              <CheckCircle2 className="w-5 h-5 text-[#16A34A] shrink-0" />
            ) : (
              <Circle className="w-5 h-5 text-[#CBD5E1] shrink-0" />
            )}
            <span className={`text-sm flex-1 ${trading?.multiTokenDone ? "text-[#94A3B8] line-through" : "text-[#334155]"}`}>
              Trade {trading?.multiTokenCount ?? 3} different tokens today
              {trading && trading.distinctTokensToday > 0 && !trading.multiTokenDone && (
                <span className="text-[#64748B]"> ({trading.distinctTokensToday}/{trading.multiTokenCount})</span>
              )}
            </span>
            <span className="text-[11px] font-semibold text-[#2563EB]">+{trading?.multiTokenBonus ?? 50} pts</span>
          </div>
        </div>
        {trading && trading.volumeSeasonUsd > 0 && (
          <p className="text-[11px] text-[#64748B] mt-3 pt-3 border-t border-[#F1F5F9]">
            Today: ${trading.volumeTodayUsd.toLocaleString()} · Season: ${trading.volumeSeasonUsd.toLocaleString()} traded
          </p>
        )}
      </div>

      {/* Leaderboard */}
      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-[#1A1A2E] flex items-center gap-2">
            <Trophy className="w-4 h-4 text-[#F59E0B]" /> Season {data?.season.id ?? 1} leaderboard
          </h3>
          <button
            onClick={() => load(true)}
            className="text-[#94A3B8] hover:text-[#2563EB] transition"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
        {(data?.leaderboard || []).length === 0 ? (
          <p className="text-sm text-[#94A3B8] text-center py-6">
            No points yet this season — be the first on the board.
          </p>
        ) : (
          <div className="space-y-1">
            {data!.leaderboard.map((row) => {
              const isMe = publicKey && row.wallet === publicKey.toBase58();
              return (
                <button
                  key={row.wallet}
                  onClick={() => navigateToProfile(row.wallet)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition ${
                    isMe ? "bg-[#EFF6FF] border border-[#BFDBFE]" : "hover:bg-[#F8FAFC]"
                  }`}
                >
                  <span
                    className={`text-xs font-bold w-7 tabular-nums ${
                      row.rank === 1
                        ? "text-[#F59E0B]"
                        : row.rank <= 3
                        ? "text-[#64748B]"
                        : "text-[#94A3B8]"
                    }`}
                  >
                    #{row.rank}
                  </span>
                  <span className="text-sm font-medium text-[#1A1A2E] flex-1 truncate">
                    {row.name || shortAddr(row.wallet)}
                    {isMe && <span className="text-[#2563EB] text-[11px] ml-1.5">you</span>}
                  </span>
                  <span className="text-sm font-semibold text-[#2563EB] tabular-nums">
                    {fmtPts(row.points)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Season pool note */}
      <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-2xl px-4 py-3">
        <p className="text-xs text-[#15803D]">
          <span className="font-semibold">1% of every trade feeds the season pool.</span>{" "}
          At season end, points holders split a $SHYFT reward pool funded by protocol buybacks — pro-rata by points.
        </p>
      </div>
    </div>
  );
}
