// GET /api/campaign/status
//
// The switch the mobile banner reads. Returns whether slots remain and the
// task config, so the app never hardcodes the cap — closing the campaign is
// a server-side change, no App Store review.

import { NextResponse } from "next/server";
import { campaignStatus, CampaignConfigError } from "@/lib/campaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await campaignStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof CampaignConfigError) {
      console.error("campaign/status:", err.message);
      // Fail closed: if the slot store is unreachable we cannot prove slots
      // remain, so the campaign shows as closed rather than overselling it.
      return NextResponse.json(
        { open: false, error: "unconfigured" },
        { status: 503 },
      );
    }
    console.error("campaign/status:", err);
    return NextResponse.json({ open: false, error: "unavailable" }, { status: 500 });
  }
}
