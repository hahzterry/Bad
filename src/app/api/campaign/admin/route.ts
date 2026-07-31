// Campaign admin — the manual review pass before anyone gets paid.
//
//   GET  /api/campaign/admin            list every slot with review signals
//   POST /api/campaign/admin            { deviceId, action, reason?, tx? }
//                                       action = approve | reject | paid
//
// Auth reuses the CRON_SECRET pattern already used by /api/quests/cron:
//   authorization: Bearer <CRON_SECRET>   (or ?secret=)
//
// At 100 participants the review is meant to be done by eye. The listing is
// sorted so shared networks sit adjacent, because clustering is the signal a
// scoring function would only approximate.

import { NextRequest, NextResponse } from "next/server";
import {
  listSlots,
  reviewSlot,
  getProgress,
  payoutReleasedAt,
  PAYOUT_HOLD_HOURS,
  CampaignConfigError,
} from "@/lib/campaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const query = req.nextUrl.searchParams.get("secret");
  return header === expected || query === expected;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const slots = await listSlots();
    const now = Date.now();

    // Group by network so clusters are obvious at a glance.
    const byIp = new Map<string, number>();
    for (const s of slots) {
      if (s.ip) byIp.set(s.ip, (byIp.get(s.ip) ?? 0) + 1);
    }

    const rows = slots.map((s) => {
      const releasesAt = payoutReleasedAt(s);
      return {
        ...s,
        sharedIpCount: s.ip ? byIp.get(s.ip) ?? 1 : 1,
        payoutReleasesAt: releasesAt,
        payable:
          s.status === "qualified" && !!releasesAt && now >= releasesAt,
      };
    });

    return NextResponse.json({
      total: rows.length,
      holdHours: PAYOUT_HOLD_HOURS,
      counts: {
        active: rows.filter((r) => r.status === "active").length,
        qualified: rows.filter((r) => r.status === "qualified").length,
        paid: rows.filter((r) => r.status === "paid").length,
        rejected: rows.filter((r) => r.status === "rejected").length,
        payableNow: rows.filter((r) => r.payable).length,
      },
      slots: rows,
    });
  } catch (err) {
    if (err instanceof CampaignConfigError) {
      return NextResponse.json({ error: "unconfigured" }, { status: 503 });
    }
    console.error("campaign/admin GET:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      deviceId?: string;
      action?: "approve" | "reject" | "paid";
      reason?: string;
      tx?: string;
      force?: boolean;
    };
    const { deviceId, action } = body;

    if (!deviceId || !action || !["approve", "reject", "paid"].includes(action)) {
      return NextResponse.json(
        { error: "deviceId and action (approve|reject|paid) are required" },
        { status: 400 },
      );
    }

    // Paying out is the irreversible step — it consumes the device's
    // DeviceCheck bit — so both guards take an explicit override to bypass.
    if (action === "paid" && !body.force) {
      const slots = await listSlots();
      const slot = slots.find((s) => s.deviceId === deviceId);

      if (slot && slot.status !== "qualified") {
        return NextResponse.json(
          {
            error: "not_qualified",
            status: slot.status,
            hint: "pass force:true to pay a slot that has not qualified",
          },
          { status: 409 },
        );
      }

      const releasesAt = slot ? payoutReleasedAt(slot) : null;
      if (releasesAt && Date.now() < releasesAt) {
        return NextResponse.json(
          {
            error: "hold_active",
            releasesAt,
            hint: "pass force:true to pay before the review hold ends",
          },
          { status: 409 },
        );
      }
    }

    const result = await reviewSlot(deviceId, {
      action,
      reason: body.reason,
      tx: body.tx,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, slot: result.slot });
  } catch (err) {
    if (err instanceof CampaignConfigError) {
      return NextResponse.json({ error: "unconfigured" }, { status: 503 });
    }
    console.error("campaign/admin POST:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }
}
