import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { BagsSDK } from "@bagsfm/bags-sdk";

/**
 * /api/bags — Bags API proxy for token launch, trading, fees, and analytics.
 *
 * All Bags SDK calls happen server-side (API key is secret).
 * Frontend calls these routes and handles wallet signing.
 */

const BAGS_API_KEY = (process.env.BAGS_API_KEY || "").trim();
// Bags operates on Solana mainnet — use Helius mainnet RPC
const BAGS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;
// Bags partner config — read from env vars (server-side only)
const BAGS_PARTNER_WALLET = (process.env.BAGS_PARTNER_WALLET || "").trim();
const BAGS_PARTNER_CONFIG_PDA = (process.env.BAGS_PARTNER_CONFIG_PDA || "").trim();

function getSDK() {
  const connection = new Connection(BAGS_RPC_URL, "confirmed");
  return new BagsSDK(BAGS_API_KEY, connection, "confirmed");
}

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
  // NO FALLBACK — deny if both origin and referer are missing
  return false;
}

// ─── GET /api/bags?action=feed|creators|fees ───

export async function GET(req: NextRequest) {
  if (!isAllowedOrigin(req)) return err("Unauthorized", 403);
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  try {
    const sdk = getSDK();

    switch (action) {
      case "feed": {
        const feed = await sdk.bagsApiClient.get("/token-launch/feed");
        return ok(feed);
      }

      case "creators": {
        const mint = searchParams.get("mint");
        if (!mint) return err("Missing mint parameter");
        const creators = await sdk.state.getTokenCreators(new PublicKey(mint));
        return ok(
          creators.map((c: any) => ({
            wallet: c.wallet?.toString?.() || c.wallet,
            provider: c.provider,
            username: c.username,
            providerUsername: c.providerUsername,
            pfp: c.pfp,
            royaltyBps: c.royaltyBps,
            isCreator: c.isCreator,
            twitterUsername: c.twitterUsername,
            bagsUsername: c.bagsUsername,
          }))
        );
      }

      case "fees": {
        const wallet = searchParams.get("wallet");
        if (!wallet) return err("Missing wallet parameter");
        const positions = await sdk.fee.getAllClaimablePositions(new PublicKey(wallet));
        return ok(
          positions.map((p: any) => ({
            baseMint: p.baseMint,
            virtualPoolAddress: p.virtualPoolAddress,
            virtualPoolClaimableAmount: p.virtualPoolClaimableAmount?.toString(),
            dammPoolClaimableAmount: p.dammPoolClaimableAmount?.toString(),
            isCustomFeeVault: p.isCustomFeeVault,
            customFeeVaultBalance: p.customFeeVaultBalance?.toString(),
            customFeeVaultBps: p.customFeeVaultBps,
            customFeeVaultClaimerSide: p.customFeeVaultClaimerSide,
            totalClaimableLamportsUserShare: p.totalClaimableLamportsUserShare?.toString(),
            isMigrated: p.isMigrated,
          }))
        );
      }

      case "lifetime-fees": {
        const mint = searchParams.get("mint");
        if (!mint) return err("Missing mint parameter");
        const fees = await sdk.state.getTokenLifetimeFees(new PublicKey(mint));
        return ok({ lifetimeFees: fees });
      }

      case "top-tokens": {
        const tokens = await sdk.state.getTopTokensByLifetimeFees();
        return ok(tokens);
      }

      case "token-meta": {
        // Metadata (name/symbol/image/description) for a single mint.
        // Primary source is the Bags launch feed — the same data the Tokens page
        // shows — so a freshly launched coin resolves correctly. Falls back to
        // Helius DAS on-chain metadata if the token isn't in the feed.
        const mint = searchParams.get("mint");
        if (!mint) return err("Missing mint parameter");

        // 1) Bags launch feed (authoritative for Bags-launched tokens).
        try {
          const feed: any[] = await sdk.bagsApiClient.get("/token-launch/feed");
          if (Array.isArray(feed)) {
            const t = feed.find((x) => x?.tokenMint === mint);
            if (t && (t.name || t.symbol || t.image)) {
              return ok({
                tokenMint: mint,
                name: t.name || "",
                symbol: (t.symbol || "").replace(/^\$/, ""),
                description: t.description || "",
                image: t.image || "",
              });
            }
          }
        } catch (e) {
          console.warn("[token-meta] feed lookup failed:", e);
        }

        // 2) Fall back to Helius DAS on-chain metadata.
        try {
          const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;
          const dasRes = await fetch(heliusUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "getAsset",
              params: { id: mint },
            }),
          });
          const dasData = await dasRes.json();
          const content = dasData?.result?.content || {};
          const metadata = content?.metadata || {};
          const image = content?.links?.image || content?.files?.[0]?.uri || "";
          return ok({
            tokenMint: mint,
            name: metadata.name || "",
            symbol: (metadata.symbol || "").replace(/^\$/, ""),
            description: metadata.description || "",
            image,
          });
        } catch (e: any) {
          return err(e?.message || "Failed to load token metadata", 500);
        }
      }

      case "user-tokens": {
        const wallet = searchParams.get("wallet");
        if (!wallet) return err("Missing wallet parameter");

        // Strategy: combine multiple sources to find all tokens by this wallet
        const walletPk = new PublicKey(wallet);
        const tokenMap = new Map<string, any>();

        // 1) Get token mints where user is fee-share admin (= created via Bags)
        try {
          const adminMints: string[] = await sdk.feeShareAdmin.getAdminTokenMints(walletPk);
          for (const mint of adminMints) {
            tokenMap.set(mint, { tokenMint: mint });
          }
        } catch (e) {
          console.warn("[user-tokens] getAdminTokenMints failed:", e);
        }

        // 2) Also get claimable positions (covers tokens even if admin query fails)
        try {
          const positions = await sdk.fee.getAllClaimablePositions(walletPk);
          for (const p of positions) {
            if (p.baseMint && !tokenMap.has(p.baseMint)) {
              tokenMap.set(p.baseMint, { tokenMint: p.baseMint });
            }
          }
        } catch (e) {
          console.warn("[user-tokens] getAllClaimablePositions failed:", e);
        }

        // 3) Fetch the global feed and match by launchWallet
        try {
          const feed: any[] = await sdk.bagsApiClient.get("/token-launch/feed");
          if (Array.isArray(feed)) {
            for (const token of feed) {
              // Match tokens where launchWallet equals user's wallet
              if (token.launchWallet === wallet) {
                tokenMap.set(token.tokenMint, token);
              }
              // Also enrich any mints we already found from fee queries
              if (tokenMap.has(token.tokenMint)) {
                tokenMap.set(token.tokenMint, { ...tokenMap.get(token.tokenMint), ...token });
              }
            }
          }
        } catch (e) {
          console.warn("[user-tokens] feed fetch failed:", e);
        }

        // 4) For any mints that are still bare (not in feed), enrich via Helius DAS API
        const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;
        const results = Array.from(tokenMap.values());
        const enriched = await Promise.all(
          results.map(async (token) => {
            if (token.name) return token; // Already has feed data
            try {
              const dasRes = await fetch(heliusUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  method: "getAsset",
                  params: { id: token.tokenMint },
                }),
              });
              const dasData = await dasRes.json();
              const content = dasData?.result?.content || {};
              const metadata = content?.metadata || {};
              const image = content?.links?.image || content?.files?.[0]?.uri || "";
              return {
                ...token,
                name: metadata.name || token.tokenMint.slice(0, 8),
                symbol: metadata.symbol || "",
                description: metadata.description || "",
                image,
                status: "PRE_GRAD",
              };
            } catch {
              return token; // Return bare mint if DAS lookup fails
            }
          })
        );

        return ok(enriched);
      }

      default:
        return err("Unknown action. Use: feed, creators, fees, lifetime-fees, top-tokens, user-tokens, token-meta");
    }
  } catch (error: any) {
    console.error("[Bags GET]", error);
    return err(error.message || "Internal error", 500);
  }
}

// ─── POST /api/bags ───

export async function POST(req: NextRequest) {
  if (!isAllowedOrigin(req)) return err("Unauthorized", 403);
  try {
    const body = await req.json();
    const { action } = body;
    const sdk = getSDK();

    switch (action) {
      // ──── Create token metadata + get info ────
      case "create-token-info": {
        const { name, symbol, description, imageUrl, twitter, website } = body;
        if (!name || !symbol || !description || !imageUrl) {
          return err("Missing required fields: name, symbol, description, imageUrl");
        }

        const result = await sdk.tokenLaunch.createTokenInfoAndMetadata({
          imageUrl,
          name,
          description,
          symbol: symbol.toUpperCase().replace("$", ""),
          twitter: twitter || undefined,
          website: website || undefined,
        });

        return ok({
          tokenMint: result.tokenMint,
          metadataUrl: result.tokenMetadata,
          tokenLaunch: result.tokenLaunch,
        });
      }

      // ──── Create launch transaction (unsigned, for frontend signing) ────
      case "create-launch-tx": {
        const { metadataUrl, tokenMint, launchWallet, initialBuyLamports, configKey } = body;
        if (!metadataUrl || !tokenMint || !launchWallet) {
          return err("Missing required fields");
        }

        const tx = await sdk.tokenLaunch.createLaunchTransaction({
          metadataUrl,
          tokenMint: new PublicKey(tokenMint),
          launchWallet: new PublicKey(launchWallet),
          initialBuyLamports: initialBuyLamports || 0,
          configKey: new PublicKey(configKey),
        });

        // Serialize the unsigned transaction for the frontend to sign
        const serialized = Buffer.from(tx.serialize()).toString("base64");
        return ok({ unsignedTxBase64: serialized });
      }

      // ──── Get trade quote ────
      case "quote": {
        const { inputMint, outputMint, amount, slippageMode, slippageBps } = body;
        if (!inputMint || !outputMint || !amount) {
          return err("Missing required fields: inputMint, outputMint, amount");
        }

        const quote = await sdk.trade.getQuote({
          inputMint: new PublicKey(inputMint),
          outputMint: new PublicKey(outputMint),
          amount: Number(amount),
          slippageMode: slippageMode || "auto",
          slippageBps: slippageBps ? Number(slippageBps) : undefined,
        });

        return ok(quote);
      }

      // ──── Create swap transaction ────
      case "swap": {
        const { quoteResponse, userPublicKey } = body;
        if (!quoteResponse || !userPublicKey) {
          return err("Missing quoteResponse or userPublicKey");
        }

        const result = await sdk.trade.createSwapTransaction({
          quoteResponse,
          userPublicKey: new PublicKey(userPublicKey),
        });

        const serialized = Buffer.from(result.transaction.serialize()).toString("base64");
        return ok({
          unsignedTxBase64: serialized,
          computeUnitLimit: result.computeUnitLimit,
          lastValidBlockHeight: result.lastValidBlockHeight,
          prioritizationFeeLamports: result.prioritizationFeeLamports,
        });
      }

      // ──── Create fee claim transactions ────
      case "claim": {
        const { walletAddress, tokenMint } = body;
        if (!walletAddress || !tokenMint) {
          return err("Missing walletAddress or tokenMint");
        }

        const txs = await sdk.fee.getClaimTransactions(
          new PublicKey(walletAddress),
          new PublicKey(tokenMint)
        );

        const serialized = txs.map((tx: any) => ({
          unsignedTxBase64: Buffer.from(
            tx.serialize({ requireAllSignatures: false, verifySignatures: false })
          ).toString("base64"),
        }));
        return ok(serialized);
      }

      // ──── Resolve a social handle → fee-share wallet ────
      case "resolve-fee-wallet": {
        const { username, provider } = body;
        const SUPPORTED = ["twitter", "tiktok", "kick", "github"];
        if (!username || !provider) return err("Missing username or provider");
        if (!SUPPORTED.includes(provider)) {
          return err(`Unsupported provider. Use one of: ${SUPPORTED.join(", ")}`);
        }

        const cleanUsername = String(username).replace(/^@/, "").trim();
        if (!cleanUsername) return err("Missing username");

        const result = await sdk.state.getLaunchWalletV2(cleanUsername, provider);
        return ok({
          wallet: result.wallet.toString(),
          provider: result.provider,
          platformData: result.platformData,
        });
      }

      // ──── Get or create fee share config ────
      case "create-config": {
        const { payerWallet, tokenMint, feeClaimers } = body;
        if (!payerWallet || !tokenMint) {
          return err("Missing payerWallet or tokenMint");
        }

        // Include Shyft partner config so 25% of trading fees route to Shyft
        const configResult = await sdk.config.createBagsFeeShareConfig({
          payer: new PublicKey(payerWallet),
          baseMint: new PublicKey(tokenMint),
          feeClaimers: (feeClaimers || []).map((fc: any) => ({
            user: new PublicKey(fc.wallet),
            userBps: fc.bps,
          })),
          partner: new PublicKey(BAGS_PARTNER_WALLET),
          partnerConfig: new PublicKey(BAGS_PARTNER_CONFIG_PDA),
        });

        const transactions = (configResult.transactions || []).map((tx: any) =>
          Buffer.from(tx.serialize()).toString("base64")
        );
        const bundles = (configResult.bundles || []).map((bundle: any) =>
          bundle.map((tx: any) => Buffer.from(tx.serialize()).toString("base64"))
        );

        return ok({
          configKey: configResult.meteoraConfigKey?.toString(),
          transactions,
          bundles,
        });
      }

      default:
        return err("Unknown action");
    }
  } catch (error: any) {
    console.error("[Bags POST]", error);
    return err(error.message || "Internal error", 500);
  }
}
