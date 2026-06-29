import { NextRequest, NextResponse } from "next/server";

/**
 * /api/jup — Jupiter swap proxy for tokens Bags can't route (e.g. pump.fun).
 *
 * Bags' trade API only knows about Bags-launched tokens, so for arbitrary SPL
 * mints (pump.fun, Raydium, etc.) we route through Jupiter's public aggregator.
 *
 * The response shapes are normalized to match what `/api/bags` returns for the
 * `quote` and `swap` actions, so <TokenTrade> can consume either provider with
 * no changes. The raw Jupiter quote is preserved under `_jupQuote` because the
 * swap endpoint requires the exact original quote object.
 */

// Jupiter free "lite" tier — no API key required.
const JUP_BASE = (process.env.JUPITER_API_BASE || "https://lite-api.jup.ag/swap/v1").trim();

// Default slippage for pump.fun-style volatile tokens (3%).
const DEFAULT_SLIPPAGE_BPS = 300;

function ok(data: any) {
  return NextResponse.json({ success: true, response: data });
}

function err(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

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

export async function POST(req: NextRequest) {
  if (!isAllowedOrigin(req)) return err("Unauthorized", 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body");
  }

  const action = body?.action;

  try {
    switch (action) {
      // ──── Get a trade quote ────
      case "quote": {
        const { inputMint, outputMint, amount, slippageBps } = body;
        if (!inputMint || !outputMint || !amount) {
          return err("Missing required fields: inputMint, outputMint, amount");
        }

        const params = new URLSearchParams({
          inputMint,
          outputMint,
          amount: String(Math.floor(Number(amount))),
          slippageBps: String(slippageBps ? Number(slippageBps) : DEFAULT_SLIPPAGE_BPS),
        });

        const res = await fetch(`${JUP_BASE}/quote?${params.toString()}`);
        const q = await res.json();
        if (!res.ok || !q || q.error) {
          return err(q?.error || "No route found for this token", 400);
        }

        // Normalize to the Bags quote shape consumed by <TokenTrade>.
        return ok({
          outAmount: q.outAmount,
          priceImpactPct: q.priceImpactPct,
          minOutAmount: q.otherAmountThreshold,
          routePlan: (q.routePlan || []).map((r: any) => ({
            venue: r?.swapInfo?.label || "Jupiter",
          })),
          // Preserve the untouched Jupiter quote for the swap call.
          _jupQuote: q,
        });
      }

      // ──── Build the swap transaction ────
      case "swap": {
        const { quoteResponse, userPublicKey } = body;
        if (!quoteResponse || !userPublicKey) {
          return err("Missing quoteResponse or userPublicKey");
        }

        // Jupiter needs the original quote object, not our normalized version.
        const jupQuote = quoteResponse._jupQuote || quoteResponse;

        const res = await fetch(`${JUP_BASE}/swap`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quoteResponse: jupQuote,
            userPublicKey,
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: {
              priorityLevelWithMaxLamports: {
                maxLamports: 1_000_000,
                priorityLevel: "high",
              },
            },
          }),
        });
        const data = await res.json();
        if (!res.ok || !data?.swapTransaction) {
          return err(data?.error || "Failed to build swap transaction", 400);
        }

        return ok({
          unsignedTxBase64: data.swapTransaction,
          lastValidBlockHeight: data.lastValidBlockHeight,
          prioritizationFeeLamports: data.prioritizationFeeLamports,
        });
      }

      default:
        return err(`Unknown action: ${action}`);
    }
  } catch (e: any) {
    console.error("[/api/jup] error:", e);
    return err(e?.message || "Jupiter request failed", 500);
  }
}
