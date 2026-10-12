import { NextRequest, NextResponse } from "next/server";
import { XSTOCKS } from "@/lib/stocks";

/**
 * /api/stocks — price feed for xStocks (tokenized equities on Solana).
 *
 * Trading is handled entirely via the existing /api/bags quote+swap actions
 * (Jupiter-routed, works for any SPL mint pair) — this route only proxies
 * live price data from Jupiter's Price API.
 */

export const revalidate = 30; // cache 30 seconds

const JUPITER_PRICE_URL = "https://lite-api.jup.ag/price/v3";

// Allowed origins — only shyft.lol can call this API
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

export interface StockPriceInfo {
  usdPrice: number;
  change24h: number;
}

export async function GET(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
  }

  try {
    const ids = XSTOCKS.map((s) => s.mint).join(",");
    const res = await fetch(`${JUPITER_PRICE_URL}?ids=${ids}`);
    if (!res.ok) throw new Error(`Jupiter price API returned ${res.status}`);
    const data = await res.json();

    const prices: Record<string, StockPriceInfo> = {};
    for (const stock of XSTOCKS) {
      const entry = data[stock.mint];
      if (entry) {
        prices[stock.mint] = {
          usdPrice: entry.usdPrice,
          change24h: entry.priceChange24h,
        };
      }
    }

    return NextResponse.json({ success: true, response: prices });
  } catch (err: any) {
    console.error("Stock price fetch error:", err);
    return NextResponse.json({ success: false, error: err.message || "Failed to fetch prices" }, { status: 500 });
  }
}
