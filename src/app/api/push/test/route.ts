import { NextRequest, NextResponse } from "next/server";
import { pushToWallets } from "@/lib/expo-push";

/**
 * Manual test endpoint — fires a sample push notification to a single wallet.
 *
 *   GET /api/push/test?wallet=<base58>          → uses defaults
 *   GET /api/push/test?wallet=<base58>&title=Hi&body=Test
 *
 * No auth required (trivially abusable but only useful for testing your own
 * registered wallets — non-registered wallets just no-op). Disable in prod by
 * removing this file or setting PUSH_TEST_DISABLED=1.
 */

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (process.env.PUSH_TEST_DISABLED === "1") {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }

  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json(
      { error: "wallet query param required" },
      { status: 400 },
    );
  }

  const title = req.nextUrl.searchParams.get("title") || "🧪 Shyft test push";
  const body =
    req.nextUrl.searchParams.get("body") ||
    "If you can read this on your lock screen, push is working ✅";

  const result = await pushToWallets([wallet], {
    title,
    body,
    data: { type: "test" },
    sound: "default",
    badge: 1,
  });

  return NextResponse.json({ success: true, ...result });
}
