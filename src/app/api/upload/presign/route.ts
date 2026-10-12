import { NextRequest, NextResponse } from "next/server";
import { PinataSDK } from "pinata";

export const maxDuration = 30;

function getPinataClient(): PinataSDK {
  const pinataJwt = (process.env.PINATA_JWT || "").trim();
  if (!pinataJwt) {
    throw new Error("PINATA_JWT not configured");
  }
  return new PinataSDK({
    pinataJwt,
    pinataGateway: (process.env.PINATA_GATEWAY || "gateway.pinata.cloud").trim(),
  });
}

const ALLOWED_ORIGINS = new Set([
  "https://www.shyft.lol",
  "https://shyft.lol",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function isTrustedMobileClient(request: NextRequest): boolean {
  const client = (request.headers.get("x-shyft-client") || "").toLowerCase();
  return client === "mobile" || client === "ios" || client === "android";
}

// Rate limit: 10 presigns per IP per minute
const timestamps = new Map<string, number[]>();
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const ts = (timestamps.get(ip) || []).filter((t) => now - t < 60_000);
  if (ts.length >= 10) { timestamps.set(ip, ts); return true; }
  ts.push(now);
  timestamps.set(ip, ts);
  return false;
}

/**
 * GET /api/upload/presign?type=video/quicktime&name=post.mov
 * Returns a Pinata signed upload URL so the mobile client can upload
 * large files directly to Pinata, bypassing Vercel's 4.5MB body limit.
 */
export async function GET(request: NextRequest) {
  try {
    const pinata = getPinataClient();

    const origin = request.headers.get("origin") || "";
    const referer = request.headers.get("referer") || "";
    const allowed =
      (origin && ALLOWED_ORIGINS.has(origin)) ||
      [...ALLOWED_ORIGINS].some((o) => referer.startsWith(o)) ||
      isTrustedMobileClient(request);
    if (!allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const mimeType = searchParams.get("type") || "video/mp4";
    const fileName = searchParams.get("name") || "upload.mp4";

    const imageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const videoTypes = ["video/mp4", "video/webm", "video/quicktime"];
    if (![...imageTypes, ...videoTypes].includes(mimeType)) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }

    // Generate a signed upload URL valid for 5 minutes
    const uploadUrl: string = await pinata.upload.public.createSignedURL({
      expires: 300,
      name: fileName.replace(/[^a-zA-Z0-9._-]/g, "_"),
    });

    const gateway = (process.env.PINATA_GATEWAY || "gateway.pinata.cloud").trim();

    return NextResponse.json({
      uploadUrl,
      gateway,
    });
  } catch (err: any) {
    console.error("Presign error:", err);
    return NextResponse.json({ error: err.message || "Failed to create upload URL" }, { status: 500 });
  }
}
