import { NextRequest, NextResponse } from "next/server";
import { Transaction } from "@solana/web3.js";

/**
 * /api/easya — proxy for EasyA Kickstart's Launch API.
 *
 * Kickstart is the launchpad $SHYFT itself launched on, so tokens created this
 * way land in EasyA's ecosystem and appear on kickstart.easya.io. Their flow is
 * three steps: they build a partially-signed transaction, the user signs it,
 * they broadcast it.
 *
 * Trade-off, deliberately accepted: these launches use EasyA's own DBC config,
 * so the partner share of trading fees goes to EasyA rather than the Shyft
 * treasury. Creators still earn their share. Use NEXT_PUBLIC_LAUNCHPAD=shyft
 * for launches that pay Shyft instead.
 *
 * Proxied server-side rather than called from the browser so the origin
 * allow-list applies and their API never sees our users' IPs.
 *
 * Docs: https://kickstart.easya.io/api-docs  (marked "unstable" by EasyA)
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const EASYA_BASE = "https://kickstart.easya.io";

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
  for (const allowed of ALLOWED_ORIGINS) {
    if (referer.startsWith(allowed)) return true;
  }
  return false;
}

// ─── Provenance ───
//
// A launch routed through Shyft is INDISTINGUISHABLE on-chain from one made
// directly on kickstart.easya.io: both carry EasyA's `easya-kickstart` memo and
// their attestation signature, and we cannot add a marker of our own because
// modifying their transaction invalidates the signature they already attached.
//
// So the only way to prove a token came from Shyft is to record it ourselves at
// the moment we broadcast it. Needed for things like "first Shyft launch to
// reach $100k" — without it, anyone could launch on EasyA directly and claim.

const KV_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
const LAUNCH_SET = "shyft:easya:launches";

/**
 * Upstash REST: the whole command goes as a JSON array to the base URL. Same
 * shape src/lib/campaign.ts uses — path-style URLs mangle values containing
 * slashes or JSON, and fail silently.
 */
async function redis<T = unknown>(...cmd: (string | number)[]): Promise<T> {
  const resp = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd.map(String)),
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`redis ${cmd[0]} failed: ${resp.status}`);
  const json = (await resp.json()) as { result?: T; error?: string };
  if (json.error) throw new Error(`redis ${cmd[0]}: ${json.error}`);
  return json.result as T;
}

/** Record a confirmed Shyft-originated launch. Never blocks the launch itself. */
async function recordLaunch(entry: { mint: string; wallet: string; signature: string }) {
  if (!KV_URL || !KV_TOKEN) {
    console.warn("⚠️ launch provenance NOT recorded — KV not configured:", entry.mint);
    return;
  }
  const record = JSON.stringify({ ...entry, launchedAt: new Date().toISOString(), via: "shyft" });
  try {
    // Hash keyed by mint answers "was this launched via Shyft?"; the list keeps
    // launch order, so "first to reach X" can be settled.
    await redis("HSET", LAUNCH_SET, entry.mint, record);
    await redis("RPUSH", `${LAUNCH_SET}:log`, record);
    console.log(`📝 recorded Shyft launch ${entry.mint}`);
  } catch (e: any) {
    console.error("Failed to record launch provenance:", e?.message || e);
  }
}

function ok(data: unknown) {
  return NextResponse.json({ success: true, response: data });
}
function err(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/**
 * Their API only accepts the logo as a base64 data URL — a plain http(s) URL is
 * rejected with "Failed to upload image". Our upload flow produces an IPFS URL,
 * so fetch it back and re-encode.
 */
async function toDataUrl(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith("data:")) return imageUrl;

  // Launch-as-coin reuses whatever image the post already had, and Shyft's
  // dedicated Pinata gateway 403s on CIDs it no longer has pinned. Falling back
  // to public gateways keeps an old post launchable instead of failing with an
  // opaque "couldn't read the image".
  const cid = imageUrl.match(/\/ipfs\/([A-Za-z0-9]+)/)?.[1];
  const candidates = [imageUrl];
  if (cid) {
    const tail = imageUrl.split(`/ipfs/${cid}`)[1] || "";
    candidates.push(`https://gateway.pinata.cloud/ipfs/${cid}${tail}`);
    candidates.push(`https://ipfs.io/ipfs/${cid}${tail}`);
  }

  let lastStatus = 0;
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastStatus = res.status;
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) continue;
      // Their limit is a 10 MB JSON body and base64 inflates by ~33%.
      if (buf.length > 7 * 1024 * 1024) throw new Error("Image is too large — use one under 7MB");
      const type = res.headers.get("content-type") || "image/png";
      return `data:${type};base64,${buf.toString("base64")}`;
    } catch (e: any) {
      if (/too large/i.test(e?.message || "")) throw e;
    }
  }
  throw new Error(
    lastStatus === 403
      ? "That image is no longer available on our gateway — re-upload it and try again"
      : "Couldn't read the image for this token",
  );
}

export async function POST(req: NextRequest) {
  if (!isAllowedOrigin(req)) return err("Unauthorized", 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON");
  }

  try {
    switch (body?.action) {
      // ── Step 1: they build the launch transaction ──
      case "build": {
        const { name, symbol, imageUrl, wallet, description, website, twitter, telegram, initialBuySol } = body;
        if (!name || !symbol || !imageUrl || !wallet) {
          return err("name, symbol, imageUrl and wallet are required");
        }

        const payload: Record<string, unknown> = {
          tokenName: name,
          tokenSymbol: symbol,
          tokenLogo: await toDataUrl(imageUrl),
          userWallet: wallet,
        };
        if (description) payload.description = description;
        if (website) payload.website = website;
        if (twitter) payload.twitter = twitter;
        if (telegram) payload.telegram = telegram;
        if (initialBuySol && Number(initialBuySol) > 0) payload.initialBuyAmount = Number(initialBuySol);

        const res = await fetch(`${EASYA_BASE}/api/upload`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) {
          // Kickstart rejects anything containing their brand words, but its
          // message ("Choose a different idea name.") doesn't say why — which
          // reads as a bug rather than a naming rule. Spell it out.
          const raw = String(json?.error || "");
          const friendly = /different idea name/i.test(raw)
            ? "Kickstart doesn't allow that name — it can't contain \"EasyA\", \"Easy\" or \"Kickstart\". Try another."
            : /different ticker/i.test(raw)
              ? "Kickstart doesn't allow that ticker — it can't contain \"EasyA\", \"Easy\" or \"Kickstart\". Try another."
              : /different website/i.test(raw)
                ? "That website URL points at Kickstart's own domain. Use a different one."
                : /different X profile/i.test(raw)
                  ? "That X handle collides with one of Kickstart's accounts. Use a different one."
                  : raw || "Kickstart couldn't build the launch";
          return err(friendly, res.status === 400 ? 400 : 502);
        }

        console.log(`🚀 Kickstart launch built ${symbol} ${String(json.mint).slice(0, 8)}.. for ${String(wallet).slice(0, 8)}..`);
        return ok({
          transaction: json.poolTx,
          tokenMint: json.mint,
          metadataUrl: json.metadataUri,
        });
      }

      // ── Step 3: they broadcast the signed transaction ──
      case "send": {
        const { signedTransaction, mint } = body;
        if (!signedTransaction || !mint) return err("signedTransaction and mint are required");

        const res = await fetch(`${EASYA_BASE}/api/send-transaction`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ signedTransaction, mint }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) {
          return err(json?.error || "Kickstart couldn't broadcast the launch", 502);
        }

        // Confirmed on-chain by this point — record that it came from Shyft.
        //
        // The launching wallet is read from the transaction's fee payer rather
        // than taken from the request: it can't be spoofed, and it doesn't
        // silently record "" when an older cached client omits the field.
        let wallet = "";
        try {
          wallet = Transaction.from(Buffer.from(signedTransaction, "base64")).feePayer?.toBase58() || "";
        } catch {
          wallet = String(body.wallet || "");
        }
        if (!wallet) wallet = String(body.wallet || "");

        await recordLaunch({
          mint: String(mint),
          wallet,
          signature: String(json.signature),
        });

        return ok({ signature: json.signature });
      }

      // ── Was this mint launched through Shyft? ──
      case "provenance": {
        const { mint } = body;
        if (!mint) return err("mint is required");
        if (!KV_URL || !KV_TOKEN) return err("Launch records not configured", 503);
        const raw = await redis<string | null>("HGET", LAUNCH_SET, String(mint));
        if (!raw) return ok({ launchedViaShyft: false });
        let parsed: any = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* stored value isn't JSON — still proves it was recorded */
        }
        return ok({ launchedViaShyft: true, ...(parsed || {}) });
      }

      // ── Every Shyft-originated launch, oldest first ──
      case "launch-log": {
        if (!KV_URL || !KV_TOKEN) return err("Launch records not configured", 503);
        const rows = (await redis<string[]>("LRANGE", `${LAUNCH_SET}:log`, 0, -1)) || [];
        return ok(
          rows.map((r) => {
            try {
              return JSON.parse(r);
            } catch {
              return { raw: r };
            }
          }),
        );
      }

      default:
        return err("Unknown action. Use: build, send, provenance, launch-log");
    }
  } catch (e: any) {
    console.error("EasyA proxy failed:", e?.message || e);
    return err(e?.message || "Kickstart request failed", 502);
  }
}
