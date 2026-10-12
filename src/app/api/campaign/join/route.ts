// POST /api/campaign/join  { wallet, deviceId }
//
// Reserves one of the 100 slots. Idempotent per device — a retry or a
// double-tap returns the existing slot rather than consuming another.

import { NextRequest, NextResponse } from "next/server";
import {
  reserveSlot,
  getSlotByWallet,
  checkNetwork,
  clientIp,
  CampaignConfigError,
} from "@/lib/campaign";
import {
  queryDeviceBits,
  isDeviceCheckConfigured,
  markDeviceHoldsSlot,
} from "@/lib/devicecheck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      wallet?: string;
      deviceId?: string;
      deviceToken?: string;
    };
    const wallet = (body.wallet ?? "").trim();
    const deviceId = (body.deviceId ?? "").trim();
    const deviceToken = (body.deviceToken ?? "").trim();

    if (!wallet || !deviceId) {
      return NextResponse.json(
        { ok: false, error: "wallet and deviceId are required" },
        { status: 400 },
      );
    }

    // One slot per wallet, mirroring the one-per-device rule. Without this a
    // single device could re-join under a fresh wallet after its slot lapsed.
    const existing = await getSlotByWallet(wallet);
    if (existing && existing.deviceId !== deviceId) {
      return NextResponse.json(
        { ok: false, error: "wallet_already_joined" },
        { status: 409 },
      );
    }

    // DeviceCheck is the only thing that makes "one reward per person" true —
    // IDFV resets on reinstall, an Apple-held bit does not. When a token is
    // supplied, a device already marked rewarded is refused outright.
    if (deviceToken && isDeviceCheckConfigured()) {
      const check = await queryDeviceBits(deviceToken);
      if (check.state === "ok" && check.bits.bit0) {
        return NextResponse.json(
          { ok: false, error: "device_already_rewarded" },
          { status: 403 },
        );
      }
      // bit1 = this physical iPhone already holds a slot. Checked because a
      // reinstall gives a fresh IDFV and a brand new embedded wallet, so
      // neither the device id nor the wallet can catch a repeat entry — only
      // Apple's device-bound bit survives that.
      if (check.state === "ok" && check.bits.bit1) {
        return NextResponse.json(
          { ok: false, error: "device_already_joined" },
          { status: 403 },
        );
      }
      if (check.state === "invalid_token") {
        console.warn("campaign/join: invalid DeviceCheck token", check.detail);
        return NextResponse.json(
          { ok: false, error: "device_verification_failed" },
          { status: 403 },
        );
      }
      // "unset" is the normal first-time case; transient errors fall through
      // rather than locking out real users when Apple is unreachable.
    }

    const ip = clientIp(req);
    const net = await checkNetwork(ip);
    if (!net.ok) {
      return NextResponse.json(
        { ok: false, error: "network_rejected", reason: net.reason },
        { status: 403 },
      );
    }

    const { result, slot } = await reserveSlot(deviceId, wallet, {
      ip,
      asn: net.asn,
      deviceToken: deviceToken || undefined,
    });

    if (result === "full") {
      return NextResponse.json(
        { ok: false, error: "campaign_full" },
        { status: 410 },
      );
    }

    // Claim the device only once the slot is actually held, so a failed
    // reservation can't leave a device permanently locked out.
    if (result === "claimed" && deviceToken && isDeviceCheckConfigured()) {
      const marked = await markDeviceHoldsSlot(deviceToken);
      if (!marked.ok) console.warn("campaign/join: bit1 not set —", marked.detail);
    }

    return NextResponse.json({ ok: true, result, slot });
  } catch (err) {
    if (err instanceof CampaignConfigError) {
      console.error("campaign/join:", err.message);
      return NextResponse.json(
        { ok: false, error: "unconfigured" },
        { status: 503 },
      );
    }
    console.error("campaign/join:", err);
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 500 });
  }
}
