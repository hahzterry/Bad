// GET /api/campaign/progress?wallet=<address>
//
// The full task board for one wallet: one-time ticks, today's daily
// counters, and the per-day history strip. Profile/username are read from
// chain; the action counts come from the quests engine tally.

import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getProgress, CampaignConfigError } from "@/lib/campaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Can trigger a full on-chain tally when the cached one is stale.
export const maxDuration = 60;

const PROGRAM_ID = new PublicKey("EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ");

function rpcUrl(): string {
  const key = process.env.HELIUS_API_KEY;
  return key
    ? `https://mainnet.helius-rpc.com/?api-key=${key}`
    : process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

/**
 * Profile layout (from the IDL): 8-byte discriminator, owner pubkey, then
 * `username` as a Borsh string. That's a fixed prefix, so the name can be
 * read without decoding the rest of the account.
 */
function decodeUsername(data: Buffer): string {
  const at = 8 + 32;
  if (data.length < at + 4) return "";
  const len = data.readUInt32LE(at);
  if (len === 0 || len > 64 || data.length < at + 4 + len) return "";
  return data.subarray(at + 4, at + 4 + len).toString("utf8");
}

async function onChainState(wallet: string) {
  try {
    const owner = new PublicKey(wallet);
    const conn = new Connection(rpcUrl(), "confirmed");

    const [profilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("profile"), owner.toBuffer()],
      PROGRAM_ID,
    );
    const profile = await conn.getAccountInfo(profilePda);
    if (!profile) return { hasProfile: false, hasUsername: false };

    const name = decodeUsername(profile.data);
    if (!name) return { hasProfile: true, hasUsername: false };

    // A name on the profile isn't proof of ownership — the registry record
    // is what the marketplace treats as the deed, so check that it exists
    // and that this profile is the one displaying it.
    const [recordPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("username"), Buffer.from(name)],
      PROGRAM_ID,
    );
    const record = await conn.getAccountInfo(recordPda);
    if (!record) return { hasProfile: true, hasUsername: false };

    const recordOwner = new PublicKey(record.data.subarray(8, 40));
    return { hasProfile: true, hasUsername: recordOwner.equals(owner) };
  } catch (err) {
    console.warn("campaign/progress chain read failed:", err);
    return { hasProfile: false, hasUsername: false };
  }
}

export async function GET(req: NextRequest) {
  const wallet = (req.nextUrl.searchParams.get("wallet") ?? "").trim();
  if (!wallet) {
    return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  }

  try {
    const chain = await onChainState(wallet);
    const progress = await getProgress(wallet, chain);
    return NextResponse.json(progress, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof CampaignConfigError) {
      console.error("campaign/progress:", err.message);
      return NextResponse.json({ error: "unconfigured" }, { status: 503 });
    }
    console.error("campaign/progress:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }
}
