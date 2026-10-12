import { NextRequest, NextResponse } from "next/server";
import { PinataSDK } from "pinata";

/**
 * Returns a temporary signed upload URL from Pinata.
 * The client uploads directly to Pinata — bypasses Vercel's 4.5MB body limit.
 * GET /api/upload/signed-url
 */

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
  "https://baddie.stream",
  "https://shyft.lol",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function isTrustedMobileClient(request: NextRequest): boolean {
  const client = (request.headers.get("x-shyft-client") || "").toLowerCase();
  return client === "mobile" || client === "ios" || client === "android";
}

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

    // Create a temporary upload URL valid for 120 seconds
    // createSignedURL returns the URL string directly
    const signedUrl = await pinata.upload.public.createSignedURL({
      expires: 120,
    });

    const gateway = (process.env.PINATA_GATEWAY || "gateway.pinata.cloud").trim();

    return NextResponse.json({ signedUrl, gateway });
  } catch (err: any) {
    console.error("Signed URL error:", err);
    return NextResponse.json({ error: err.message || "Failed to get upload URL" }, { status: 500 });
  }
}
