import { NextRequest, NextResponse } from "next/server";
import { runSocialTally } from "@/lib/quests-engine";

/**
 * /api/quests/cron — tallies new on-chain social actions into season points.
 *
 * Runs on Vercel cron (see vercel.json) and is also invoked lazily by
 * GET /api/quests when state is stale, so points stay fresh between ticks.
 *
 * Auth: `authorization: Bearer ${CRON_SECRET}` or `?secret=` — same
 * pattern as push/cron.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorised(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // unset = open in dev
  const headerSecret = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return headerSecret === expected || querySecret === expected;
}

export async function GET(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runSocialTally();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("quests/cron error:", err);
    return NextResponse.json({ error: err?.message || "internal error" }, { status: 500 });
  }
}

export const POST = GET;
