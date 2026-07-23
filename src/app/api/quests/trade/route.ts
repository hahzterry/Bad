import { NextRequest, NextResponse } from "next/server";
import {
  loadSocial,
  loadTrades,
  saveTrades,
  emptyTradeWallet,
  mergedStreak,
  getSolPriceUsd,
  verifyTradeOnChain,
} from "@/lib/quests-engine";
import {
  TRADE_POINTS_PER_USD,
  FIRST_TRADE_BONUS,
  MULTI_TOKEN_BONUS,
  MULTI_TOKEN_COUNT,
  dayKey,
  streakMultiplier,
} from "@/lib/quests";

/**
 * POST /api/quests/trade — { wallet, signature }
 *
 * Called fire-and-forget by the client after a confirmed swap. Nothing is
 * trusted from the request: the signature is fetched from the chain and
 * points are only awarded when the tx succeeded, the wallet actually
 * signed it, and it's recent. Volume = the wallet's SOL balance delta.
 * Signatures are deduped so a trade can never be claimed twice.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

// Same origin policy as /api/jup — only the app may report trades.
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
  if (referer) {
    try {
      return ALLOWED_ORIGINS.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  // Mobile app requests carry no origin/referer
  return !origin;
}

export async function POST(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const wallet = String(body?.wallet || "");
  const signature = String(body?.signature || "");
  if (!wallet || !signature || signature.length > 120) {
    return NextResponse.json({ error: "wallet and signature required" }, { status: 400 });
  }

  try {
    const trades = await loadTrades();
    if (trades.sigs.includes(signature)) {
      return NextResponse.json({ ok: true, awarded: 0, reason: "already counted" });
    }

    const verified = await verifyTradeOnChain(wallet, signature);
    if ("error" in verified) {
      return NextResponse.json({ ok: false, error: verified.error }, { status: 422 });
    }

    const [solUsd, social] = await Promise.all([getSolPriceUsd(), loadSocial()]);
    const volUsd = verified.volumeSol * solUsd;
    const day = dayKey(verified.blockTimeMs);

    const w = (trades.wallets[wallet] ||= emptyTradeWallet());
    const mult = streakMultiplier(mergedStreak(social.wallets[wallet], w));
    const d = (w.days[day] ||= { count: 0, mints: [], volUsd: 0, multiBonusPaid: false });

    let base = Math.max(1, Math.floor(volUsd * TRADE_POINTS_PER_USD));
    if (d.count === 0) base += FIRST_TRADE_BONUS;

    for (const m of verified.mints) if (!d.mints.includes(m)) d.mints.push(m);
    if (!d.multiBonusPaid && d.mints.length >= MULTI_TOKEN_COUNT) {
      base += MULTI_TOKEN_BONUS;
      d.multiBonusPaid = true;
    }

    const pts = Math.round(base * mult);
    d.count += 1;
    d.volUsd += volUsd;
    w.points += pts;
    w.volumeUsd += volUsd;
    if (!w.activeDays.includes(day)) w.activeDays.push(day);
    trades.sigs.push(signature);
    await saveTrades(trades);

    return NextResponse.json({
      ok: true,
      awarded: pts,
      volumeUsd: Math.round(volUsd * 100) / 100,
      multiplier: mult,
    });
  } catch (err: any) {
    console.error("quests/trade error:", err);
    return NextResponse.json({ error: err?.message || "internal error" }, { status: 500 });
  }
}
