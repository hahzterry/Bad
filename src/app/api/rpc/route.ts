import { NextRequest, NextResponse } from "next/server";

/**
 * /api/rpc — Server-side RPC proxy.
 * Forwards JSON-RPC requests to Helius without exposing the API key to the browser.
 *
 * SECURITY: The API key is stored in a server-only env var (HELIUS_API_KEY_PRIVATE),
 * never sent to the client.
 */

// Use Helius if key is set, otherwise fall back to public mainnet RPC
const HELIUS_RPC_URL = process.env.HELIUS_API_KEY_PRIVATE
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`
  : "https://api.mainnet-beta.solana.com";

// Simple rate limiting — 600 requests per IP per minute
const ipTimestamps = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 600;

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = (ipTimestamps.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (timestamps.length >= MAX_REQUESTS) {
    ipTimestamps.set(ip, timestamps);
    return true;
  }
  timestamps.push(now);
  ipTimestamps.set(ip, timestamps);
  return false;
}

// Allowed origins
const ALLOWED_ORIGINS = new Set([
  "https://baddie.stream",
  "https://shyft.lol",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3099",
  "http://localhost:8081",
  "http://localhost:8082",
  "http://192.168.1.1:8081",
]);

export async function POST(request: NextRequest) {
  // Origin check
  const origin = request.headers.get("origin") || "";
  const referer = request.headers.get("referer") || "";
  const originOk = ALLOWED_ORIGINS.has(origin) || [...ALLOWED_ORIGINS].some((a) => referer.startsWith(a));
  if (!originOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Rate limit
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    const body = await request.text();

    const resp = await fetch(HELIUS_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const data = await resp.text();

    return new NextResponse(data, {
      status: resp.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin || "*",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "RPC proxy error" },
      { status: 502 }
    );
  }
}

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin") || "";
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
