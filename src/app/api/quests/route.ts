import { NextRequest, NextResponse } from "next/server";
import {
  loadSocial,
  loadTrades,
  mergedStreak,
  runSocialTally,
  type SocialState,
  type TradesState,
} from "@/lib/quests-engine";
import {
  SEASON_ID,
  SOCIAL_ACTIONS,
  FIRST_TRADE_BONUS,
  MULTI_TOKEN_BONUS,
  MULTI_TOKEN_COUNT,
  dayKey,
  streakMultiplier,
} from "@/lib/quests";

/**
 * GET /api/quests?wallet=<address>
 *
 * Season points status: the wallet's points / streak / today's quest
 * progress, plus the top-20 leaderboard. Social + trade states are
 * merged here (they're written by different endpoints).
 *
 * If the social tally is stale (cron hasn't run recently) it's refreshed
 * inline so the numbers users see stay fresh.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const STALE_AFTER_MS = 60_000;
const LEADERBOARD_SIZE = 20;

// Short-lived response cache — leaderboard math over every wallet on
// every request would hammer KV for nothing.
let cache: { states: [SocialState, TradesState]; fetchedAt: number } | null = null;
const CACHE_TTL = 10_000;

async function getStates(): Promise<[SocialState, TradesState]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.states;

  let social = await loadSocial();
  if (Date.now() - social.lastRunAt > STALE_AFTER_MS) {
    try {
      await runSocialTally();
      social = await loadSocial();
    } catch (err) {
      console.warn("quests lazy tally failed:", err);
    }
  }
  const trades = await loadTrades();
  cache = { states: [social, trades], fetchedAt: Date.now() };
  return cache.states;
}

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") || "";

  try {
    const [social, trades] = await getStates();
    const now = Date.now();
    const today = dayKey(now);

    // ── Leaderboard: total points across both states
    const totals = new Map<string, number>();
    for (const [addr, w] of Object.entries(social.wallets)) totals.set(addr, w.points);
    for (const [addr, w] of Object.entries(trades.wallets))
      totals.set(addr, (totals.get(addr) || 0) + w.points);

    const leaderboard = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, LEADERBOARD_SIZE)
      .map(([addr, points], i) => ({
        rank: i + 1,
        wallet: addr,
        name: social.names[addr] || "",
        points,
      }));

    // ── This wallet
    const sw = social.wallets[wallet];
    const tw = trades.wallets[wallet];
    const points = (sw?.points || 0) + (tw?.points || 0);
    const streak = mergedStreak(sw, tw, now);
    const rank = wallet
      ? [...totals.entries()].filter(([, p]) => p > points).length + 1
      : 0;

    const todayCounts = sw?.dayCounts[today] || {};
    const quests = Object.entries(SOCIAL_ACTIONS).map(([action, cfg]) => ({
      action,
      label: cfg.label,
      points: cfg.points,
      done: Math.min(todayCounts[action] || 0, cfg.dailyCap),
      cap: cfg.dailyCap,
    }));

    const tradeDay = tw?.days[today];
    return NextResponse.json({
      season: { id: SEASON_ID, startedAt: social.seededAt, lastTallyAt: social.lastRunAt },
      user: wallet
        ? {
            wallet,
            points,
            rank: totals.has(wallet) ? rank : 0,
            streak,
            multiplier: streakMultiplier(streak),
            quests,
            trading: {
              tradesToday: tradeDay?.count || 0,
              volumeTodayUsd: Math.round((tradeDay?.volUsd || 0) * 100) / 100,
              volumeSeasonUsd: Math.round((tw?.volumeUsd || 0) * 100) / 100,
              distinctTokensToday: tradeDay?.mints.length || 0,
              firstTradeBonus: FIRST_TRADE_BONUS,
              firstTradeDone: (tradeDay?.count || 0) > 0,
              multiTokenBonus: MULTI_TOKEN_BONUS,
              multiTokenCount: MULTI_TOKEN_COUNT,
              multiTokenDone: !!tradeDay?.multiBonusPaid,
            },
          }
        : null,
      leaderboard,
    });
  } catch (err: any) {
    console.error("quests error:", err);
    return NextResponse.json({ error: err?.message || "internal error" }, { status: 500 });
  }
}
