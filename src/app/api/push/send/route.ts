import { NextRequest, NextResponse } from "next/server";
import { pushToWallets } from "@/lib/expo-push";

/**
 * Server-side push send endpoint — for ad-hoc / admin sends.
 *
 * The cron worker (/api/push/cron) handles the automated chain-event flow,
 * but this endpoint lets you fire one-off broadcasts (announcements, etc.).
 *
 * Auth: shared secret PUSH_API_SECRET (header `x-push-secret` or body.secret).
 *
 * POST body: {
 *   wallet?: string, wallets?: string[],
 *   title: string, body: string,
 *   data?: object, channelId?: string,
 *   sound?: "default" | null, badge?: number,
 *   secret?: string
 * }
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      wallet,
      wallets,
      title,
      body: msgBody,
      data,
      channelId,
      sound,
      badge,
      secret,
    } = body || {};

    const expected = process.env.PUSH_API_SECRET;
    const providedSecret = secret || req.headers.get("x-push-secret");
    if (expected && providedSecret !== expected) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    if (!title || !msgBody) {
      return NextResponse.json(
        { error: "title + body required" },
        { status: 400 },
      );
    }

    const targetWallets: string[] = Array.isArray(wallets)
      ? wallets
      : wallet
        ? [wallet]
        : [];
    if (targetWallets.length === 0) {
      return NextResponse.json(
        { error: "wallet or wallets required" },
        { status: 400 },
      );
    }

    const result = await pushToWallets(targetWallets, {
      title,
      body: msgBody,
      data,
      channelId,
      sound,
      badge,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error("push/send error:", err);
    return NextResponse.json(
      { error: err?.message || "internal error" },
      { status: 500 },
    );
  }
}
