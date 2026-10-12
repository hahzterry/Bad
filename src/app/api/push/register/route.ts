import { NextRequest, NextResponse } from "next/server";
import {
  loadAllRegistrations,
  setRegistration,
  deleteRegistration,
} from "@/lib/push-storage";

/**
 * Push token registration endpoint.
 *
 * The mobile app calls this once it has an Expo push token, mapping
 * `wallet -> token`. The cron worker (/api/push/cron) uses these tokens
 * to send notifications via the Expo Push API when the app is closed.
 *
 * POST body: { wallet: string, token: string, platform: "ios" | "android" }
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { wallet, token, platform } = body || {};

    if (!wallet || typeof wallet !== "string") {
      return NextResponse.json({ error: "wallet required" }, { status: 400 });
    }
    if (
      !token ||
      typeof token !== "string" ||
      !token.startsWith("ExponentPushToken")
    ) {
      return NextResponse.json(
        { error: "valid expo push token required" },
        { status: 400 },
      );
    }

    await setRegistration({
      wallet,
      token,
      platform: typeof platform === "string" ? platform : "unknown",
      updatedAt: Date.now(),
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("push/register error:", err);
    return NextResponse.json(
      { error: err?.message || "internal error" },
      { status: 500 },
    );
  }
}

/** GET /api/push/register?wallet=... — debug helper */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  const all = await loadAllRegistrations();
  if (wallet) {
    return NextResponse.json({ registration: all[wallet] || null });
  }
  return NextResponse.json({ count: Object.keys(all).length });
}

/** DELETE /api/push/register?wallet=... — unregister on logout */
export async function DELETE(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ error: "wallet required" }, { status: 400 });
  }
  await deleteRegistration(wallet);
  return NextResponse.json({ success: true });
}
