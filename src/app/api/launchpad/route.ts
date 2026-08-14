import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  DynamicBondingCurveClient,
  deriveDbcPoolAddress,
  deriveDammV2PoolAddress,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { migratePool } from "@/lib/launchpadMigrate";

// Migration sends two transactions, so a request that triggers one needs room.
export const maxDuration = 60;

/**
 * /api/launchpad — Shyft's own token launchpad.
 *
 * Tokens are launched directly onto Meteora's Dynamic Bonding Curve against a
 * config Shyft owns, so the full 2% trading fee is split 50/50 between the
 * creator and the Shyft treasury with no third-party launchpad taking a cut.
 *
 * Who pays what — the launchpad is deliberately NOT gasless, unlike Shyft's
 * social actions. Users fund their own launchpad activity:
 *   - LAUNCH    — the creator (~0.0245 SOL of account rent).
 *   - TRADES    — the trader (network fee + their own token account rent).
 *   - CLAIMS    — whoever is claiming, out of what they're claiming.
 *   - MIGRATION — the TREASURY, via /api/launchpad/cron. This is the only
 *                 launchpad cost Shyft absorbs, and it's what guarantees a
 *                 graduated token stays tradable instead of waiting on a bot.
 *
 * Trading fees themselves are collected to the config's feeClaimer — the Shyft
 * treasury — and swept in by the cron.
 */

// Mainnet by default. LAUNCHPAD_RPC_URL points the whole launchpad at devnet so
// the real route — not a reimplementation of it — can be exercised end to end.
const RPC_URL =
  (process.env.LAUNCHPAD_RPC_URL || "").trim() ||
  `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;
const LAUNCHPAD_CONFIG = (process.env.NEXT_PUBLIC_LAUNCHPAD_CONFIG || "").trim();
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const DBC_PROGRAM_ID = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

/** Stamped on every launch so the feed can identify Shyft's own launches. */
const LAUNCH_MEMO = "shyft-launch";

/**
 * Vanity suffix for new mints. Matched case-insensitively — an exact-case match
 * on a 4-char suffix needs ~11M keypairs (~20 min single-threaded), whereas
 * case-insensitive "shy" lands in a couple of seconds. To use a prettier suffix,
 * pre-grind keys offline with `solana-keygen grind --ends-with SHYFT:20`.
 */
const VANITY_SUFFIX = (process.env.LAUNCHPAD_VANITY_SUFFIX ?? "shy").toLowerCase();
const VANITY_BUDGET_MS = Number(process.env.LAUNCHPAD_VANITY_BUDGET_MS ?? 8000);

/**
 * Roughly what a launch costs in account rent (mint, pool, two vaults,
 * metadata), measured off real launches. The creator pays this, so it's
 * checked up front rather than letting the transaction fail on them.
 */
const LAUNCH_COST_LAMPORTS = 26_000_000; // ~0.026 SOL

function ok(data: unknown) {
  return NextResponse.json({ success: true, response: data });
}
function err(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

// ─── Origin allow-list (mirrors /api/bags) ───

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

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

// ─── Rate limiting ───
//
// Launches are creator-funded, so they no longer drain the treasury — but they
// still create on-chain accounts and stamp Shyft's attestation memo, so the
// caps stay to stop the feed being flooded with junk tokens.

const launchIpTimestamps = new Map<string, number[]>();
const launchWalletTimestamps = new Map<string, number[]>();
const tradeWalletTimestamps = new Map<string, number[]>();

const LAUNCH_IP_WINDOW_MS = 3_600_000; // 1 hour
const LAUNCH_IP_MAX = 3;
const LAUNCH_WALLET_WINDOW_MS = 86_400_000; // 24 hours
const LAUNCH_WALLET_MAX = 3;
const TRADE_WINDOW_MS = 60_000;
const TRADE_MAX_PER_MIN = 30;

function isRateLimited(key: string, store: Map<string, number[]>, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (store.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    store.set(key, hits);
    return true;
  }
  hits.push(now);
  store.set(key, hits);
  return false;
}

/** Drop expired buckets so the maps don't grow without bound. */
function sweep() {
  const now = Date.now();
  for (const [store, windowMs] of [
    [launchIpTimestamps, LAUNCH_IP_WINDOW_MS],
    [launchWalletTimestamps, LAUNCH_WALLET_WINDOW_MS],
    [tradeWalletTimestamps, TRADE_WINDOW_MS],
  ] as const) {
    for (const [k, v] of store) {
      const kept = v.filter((t) => now - t < windowMs);
      if (kept.length) store.set(k, kept);
      else store.delete(k);
    }
  }
}

// ─── Treasury ───

function getTreasuryKeypair(): Keypair {
  const secret = process.env.TREASURY_PRIVATE_KEY;
  if (!secret) throw new Error("TREASURY_PRIVATE_KEY not set");
  if (secret.trimStart().startsWith("[")) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(secret) as number[]));
  }
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const str = secret.trim();
  const bytes: number[] = [0];
  for (const char of str) {
    let carry = ALPHABET.indexOf(char);
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < str.length && str[i] === "1"; i++) bytes.push(0);
  return Keypair.fromSecretKey(new Uint8Array(bytes.reverse()));
}

/**
 * Grind a mint keypair whose address ends in the vanity suffix. Gives up after
 * the time budget and returns a plain keypair — a launch is worth more than a
 * pretty address, so this never blocks the user.
 */
function grindMint(): { keypair: Keypair; vanity: boolean } {
  if (!VANITY_SUFFIX) return { keypair: Keypair.generate(), vanity: false };
  const deadline = Date.now() + VANITY_BUDGET_MS;
  while (Date.now() < deadline) {
    const kp = Keypair.generate();
    if (kp.publicKey.toBase58().toLowerCase().endsWith(VANITY_SUFFIX)) {
      return { keypair: kp, vanity: true };
    }
  }
  return { keypair: Keypair.generate(), vanity: false };
}

function getClient(connection: Connection) {
  return new DynamicBondingCurveClient(connection, "confirmed");
}

/**
 * DBC prices activity either by slot or by wall-clock, depending on the
 * config's activationType. Quotes need whichever one the config uses.
 */
async function currentPoint(connection: Connection, activationType: number): Promise<BN> {
  if (activationType === 0) return new BN(await connection.getSlot());
  return new BN(Math.floor(Date.now() / 1000));
}

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/**
 * A token lives on the bonding curve until it graduates, then trades on a DAMM
 * v2 pool instead. Every quote and swap has to follow it across, or trading
 * silently breaks the moment a token succeeds — the curve is full, so DBC swaps
 * revert and buyers just see failures.
 */
/**
 * A full-but-unmigrated curve rejects every buy, so don't wait for the cron —
 * graduate it here and now, then carry on with the trade. Returns true if the
 * pool is migrated by the time we're done (including if a bot got there first).
 */
async function migrateNow(
  connection: Connection,
  client: DynamicBondingCurveClient,
  pool: PublicKey,
  config: PublicKey,
  migrationFeeOption: number,
): Promise<boolean> {
  try {
    const treasury = getTreasuryKeypair();
    const res = await migratePool(connection, client, treasury, pool, config, migrationFeeOption);
    if (res.signature) console.log(`🎓 on-demand migration ${pool.toBase58()} ${res.signature}`);
    if (res.error) console.error(`on-demand migration failed ${pool.toBase58()}: ${res.error}`);
    return res.migrated;
  } catch (e: any) {
    console.error("on-demand migration error:", e?.message || e);
    return false;
  }
}

async function resolveVenue(
  client: DynamicBondingCurveClient,
  connection: Connection,
  poolPk: PublicKey,
) {
  const virtualPool = await client.state.getPool(poolPk);
  if (!virtualPool) return null;
  const poolConfig = await client.state.getPoolConfig(virtualPool.config);
  if (!virtualPool.isMigrated) {
    return { migrated: false as const, virtualPool, poolConfig, dammPool: null };
  }
  const dammPool = deriveDammV2PoolAddress(
    DAMM_V2_MIGRATION_FEE_ADDRESS[poolConfig.migrationFeeOption],
    virtualPool.baseMint,
    WSOL_MINT,
  );
  const exists = await connection.getAccountInfo(dammPool);
  return { migrated: true as const, virtualPool, poolConfig, dammPool: exists ? dammPool : null };
}

/**
 * How much quote token the curve can still absorb before it graduates.
 *
 * The curve accepts a fixed total, and the trading fee is taken off the input
 * BEFORE it reaches the reserve — so the largest possible buy is the remaining
 * reserve room grossed up by the fee. Exceeding it doesn't get capped by the
 * program, it REVERTS (InsufficientLiquidity), which would otherwise hit the
 * last buyer before graduation: the busiest moment in a token's life.
 */
function remainingCurveCapacity(virtualPool: { quoteReserve: BN }, poolConfig: any): BN {
  const room = poolConfig.migrationQuoteThreshold.sub(virtualPool.quoteReserve);
  if (room.lten(0)) return new BN(0);
  const feeNumerator = poolConfig.poolFees.baseFee.cliffFeeNumerator; // out of 1e9
  const denom = new BN(1_000_000_000).sub(feeNumerator);
  if (denom.lten(0)) return room;
  // Round UP. Flooring strands a token one lamport short of graduation forever:
  // the cap comes out at 1 lamport, that whole lamport is eaten by the fee, the
  // reserve never moves, so `capacity <= 0` never becomes true and neither the
  // on-demand path nor the cron (which needs reserve >= threshold) ever fires.
  // Rounding up costs at most one extra lamport and the curve accepts it.
  const numerator = room.mul(new BN(1_000_000_000));
  return numerator.add(denom).subn(1).div(denom);
}

function serialize(tx: Transaction): string {
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

/**
 * Attach compute budget + blockhash + signatures to a built tx.
 *
 * `feePayer` decides who funds the transaction. On the launchpad that is always
 * the user — creators fund their launch, traders fund their trades. The treasury
 * still SIGNS a launch, to stamp the attestation memo, without paying for it:
 * a transaction's fee payer may differ from its instruction signers.
 */
async function finalize(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  feePayer: PublicKey,
): Promise<Transaction> {
  const out = new Transaction();
  out.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  for (const ix of tx.instructions) out.add(ix);
  out.feePayer = feePayer;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  out.recentBlockhash = blockhash;
  if (signers.length) out.partialSign(...signers);
  return out;
}

export async function POST(req: NextRequest) {
  if (!isAllowedOrigin(req)) return err("Unauthorized", 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON");
  }

  const action = body?.action;
  if (typeof action !== "string") return err("Missing action");

  if (!LAUNCHPAD_CONFIG) {
    return err("Launchpad not configured — run scripts/create-launchpad-config.ts", 503);
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const client = getClient(connection);
  const config = new PublicKey(LAUNCHPAD_CONFIG);
  const ip = getClientIp(req);
  sweep();

  try {
    switch (action) {
      // ── Pin the token's metadata JSON, Metaplex-style ──
      case "upload-metadata": {
        const { name, symbol, description, imageUrl, twitter, website } = body;
        if (!name || !symbol || !imageUrl) return err("name, symbol and imageUrl are required");

        const jwt = (process.env.PINATA_JWT || "").trim();
        if (!jwt) return err("PINATA_JWT not configured", 503);

        const metadata: Record<string, unknown> = {
          name,
          symbol,
          description: description || "",
          image: imageUrl,
          showName: true,
          createdOn: "https://shyft.lol",
        };
        if (twitter) metadata.twitter = twitter;
        if (website) metadata.website = website;

        const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({
            pinataContent: metadata,
            pinataMetadata: { name: `${symbol}-metadata.json` },
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.IpfsHash) return err(json?.error?.details || "Failed to pin metadata", 502);

        const gateway = (process.env.PINATA_GATEWAY || "gateway.pinata.cloud").trim();
        return ok({ uri: `https://${gateway}/ipfs/${json.IpfsHash}`, cid: json.IpfsHash });
      }

      // ── Launch a token ──
      case "create-launch-tx": {
        const { wallet, name, symbol, uri, firstBuyLamports } = body;
        if (!wallet || !name || !symbol || !uri) return err("wallet, name, symbol and uri are required");
        if (typeof name !== "string" || name.length > 32) return err("Name must be 32 characters or fewer");
        if (typeof symbol !== "string" || symbol.length > 10) return err("Symbol must be 10 characters or fewer");
        if (typeof uri !== "string" || uri.length > 200) return err("Metadata URI is too long");

        let creator: PublicKey;
        try {
          creator = new PublicKey(wallet);
        } catch {
          return err("Invalid wallet");
        }

        const treasury = getTreasuryKeypair();
        // The treasury co-signs launches; if it were also the "user" the tx
        // would be fully signed server-side and anyone could replay it.
        if (creator.equals(treasury.publicKey)) return err("Invalid wallet", 403);

        if (isRateLimited(ip, launchIpTimestamps, LAUNCH_IP_MAX, LAUNCH_IP_WINDOW_MS)) {
          return err("Too many launches from this network. Try again later.", 429);
        }
        if (isRateLimited(wallet, launchWalletTimestamps, LAUNCH_WALLET_MAX, LAUNCH_WALLET_WINDOW_MS)) {
          return err("You've hit the daily launch limit. Try again tomorrow.", 429);
        }

        // Optional dev buy, executed in the SAME transaction as the launch.
        let firstBuy = new BN(0);
        if (firstBuyLamports !== undefined && firstBuyLamports !== null && String(firstBuyLamports) !== "0") {
          try {
            firstBuy = new BN(String(firstBuyLamports));
          } catch {
            return err("Invalid firstBuyLamports");
          }
          if (firstBuy.isNeg()) return err("Invalid firstBuyLamports");
        }

        // A bonding curve only holds so much. An uncapped first buy larger than
        // the curve reverts (InsufficientLiquidity), so clamp it the same way
        // ordinary buys are clamped — before the balance check, so the creator
        // is told what they'll actually spend. Buying the whole curve is
        // allowed: the token simply graduates immediately.
        let firstBuyCapped = false;
        if (!firstBuy.isZero()) {
          const cfgState = await client.state.getPoolConfig(config);
          const maxFirstBuy = remainingCurveCapacity(
            { quoteReserve: new BN(0) },
            cfgState,
          );
          if (maxFirstBuy.gtn(0) && firstBuy.gt(maxFirstBuy)) {
            firstBuy = maxFirstBuy;
            firstBuyCapped = true;
          }
        }

        // The creator funds their own launch, so make sure they can actually
        // afford it before handing back a transaction that would just fail.
        const needed = LAUNCH_COST_LAMPORTS + Number(firstBuy.toString());
        const creatorBalance = await connection.getBalance(creator);
        if (creatorBalance < needed) {
          return err(
            firstBuy.isZero()
              ? `Launching costs about ${(LAUNCH_COST_LAMPORTS / LAMPORTS_PER_SOL).toFixed(3)} SOL in network rent. Add some SOL to your wallet and try again.`
              : `You need about ${(needed / LAMPORTS_PER_SOL).toFixed(3)} SOL — ${(LAUNCH_COST_LAMPORTS / LAMPORTS_PER_SOL).toFixed(3)} of network rent plus your ${(Number(firstBuy.toString()) / LAMPORTS_PER_SOL).toFixed(3)} SOL first buy.`,
            400,
          );
        }

        const { keypair: mint, vanity } = grindMint();

        const createPoolParam = {
          config,
          payer: creator, // the creator funds their own launch rent
          poolCreator: creator, // creator owns the pool and its fee share
          baseMint: mint.publicKey,
          name,
          symbol,
          uri,
        };

        let built: Transaction;
        if (firstBuy.isZero()) {
          built = await client.pool.createPool(createPoolParam);
        } else {
          // Create + buy MERGED INTO ONE TRANSACTION. The SDK hands these back
          // as two separate transactions, but sending them separately would let
          // a sniper land between them and take the first entry. Atomic means
          // nothing can get in front of the creator's own buy — and because it
          // executes at the launch price, no special fee treatment is needed.
          const { createPoolTx, swapBuyTx } = await client.pool.createPoolWithFirstBuy({
            createPoolParam,
            firstBuyParam: {
              buyer: creator,
              buyAmount: firstBuy,
              minimumAmountOut: new BN(0),
              referralTokenAccount: null,
            },
          });
          built = new Transaction();
          for (const ix of createPoolTx.instructions) built.add(ix);
          if (swapBuyTx) for (const ix of swapBuyTx.instructions) built.add(ix);
        }

        // Attestation memo, signed by the treasury (already a signer), so the
        // feed can find Shyft launches without maintaining a separate index.
        built.add(
          new TransactionInstruction({
            keys: [{ pubkey: treasury.publicKey, isSigner: true, isWritable: false }],
            programId: MEMO_PROGRAM_ID,
            data: Buffer.from(LAUNCH_MEMO, "utf8"),
          }),
        );

        // Creator pays; treasury signs only to stamp the attestation memo.
        const tx = await finalize(connection, built, [treasury, mint], creator);
        const pool = deriveDbcPoolAddress(WSOL_MINT, mint.publicKey, config);

        console.log(
          `🚀 launch tx built ${symbol} ${mint.publicKey.toBase58().slice(0, 8)}..${vanity ? " (vanity)" : ""} for ${wallet.slice(0, 8)}..`,
        );

        return ok({
          transaction: serialize(tx),
          tokenMint: mint.publicKey.toBase58(),
          pool: pool.toBase58(),
          vanity,
          firstBuyLamports: firstBuy.toString(),
          /** True if the requested first buy exceeded the curve and was reduced. */
          firstBuyCapped,
        });
      }

      // ── Is this mint one of ours, and where does it trade? ──
      case "resolve-pool": {
        const { mint } = body;
        if (!mint) return err("mint is required");
        let mintPk: PublicKey;
        try {
          mintPk = new PublicKey(mint);
        } catch {
          return err("Invalid mint");
        }
        // A Shyft token's pool is deterministic from its mint and our config,
        // so one PDA derivation answers "is this ours?" without any indexing.
        const poolPk = deriveDbcPoolAddress(WSOL_MINT, mintPk, config);
        const venue = await resolveVenue(client, connection, poolPk);
        if (!venue) return ok({ isShyftToken: false });
        return ok({
          isShyftToken: true,
          pool: poolPk.toBase58(),
          decimals: venue.poolConfig.tokenDecimal,
          graduated: venue.migrated,
        });
      }

      // ── Price a trade ──
      case "quote": {
        const { pool, amountIn, swapBaseForQuote, slippageBps = 100 } = body;
        if (!pool || !amountIn) return err("pool and amountIn are required");

        const poolPk = new PublicKey(pool);
        let venue = await resolveVenue(client, connection, poolPk);
        if (!venue) return err("Pool not found", 404);

        const isSell = Boolean(swapBaseForQuote);
        let requested = new BN(String(amountIn));

        // A sold-out curve rejects every buy, so graduate it here rather than
        // leaving the token untradable until the cron ticks, then quote against
        // the pool it just moved to.
        if (
          !venue.migrated &&
          !isSell &&
          remainingCurveCapacity(venue.virtualPool, venue.poolConfig).lten(0)
        ) {
          const done = await migrateNow(
            connection,
            client,
            poolPk,
            venue.virtualPool.config,
            venue.poolConfig.migrationFeeOption,
          );
          if (!done) {
            return err("This token just sold out its bonding curve and is graduating. Try again in a moment.", 409);
          }
          venue = (await resolveVenue(client, connection, poolPk)) ?? venue;
        }

        // ── Graduated: quote against the DAMM v2 pool ──
        if (venue.migrated) {
          if (!venue.dammPool) {
            return err("This token has graduated but its new pool isn't live yet. Try again shortly.", 503);
          }
          const cpAmm = new CpAmm(connection);
          const state = await cpAmm.fetchPoolState(venue.dammPool);
          const q = cpAmm.getQuote({
            inAmount: requested,
            inputTokenMint: isSell ? venue.virtualPool.baseMint : WSOL_MINT,
            slippage: Number(slippageBps) / 100,
            poolState: state,
            currentTime: Math.floor(Date.now() / 1000),
            currentSlot: await connection.getSlot(),
          });
          return ok({
            amountOut: q.swapOutAmount.toString(),
            minimumAmountOut: q.minSwapOutAmount.toString(),
            feeSol: q.totalFee.toString(),
            priceImpactPct: Number(q.priceImpact ?? 0),
            graduated: true,
            cappedTo: null,
          });
        }

        // ── Still on the curve: cap buys at what the curve can still take ──
        let cappedTo: string | null = null;
        if (!isSell) {
          const capacity = remainingCurveCapacity(venue.virtualPool, venue.poolConfig);
          if (requested.gt(capacity)) {
            requested = capacity;
            cappedTo = capacity.toString();
          }
        }

        const result = await client.pool.swapQuote({
          virtualPool: venue.virtualPool,
          config: venue.poolConfig,
          swapBaseForQuote: isSell,
          amountIn: requested,
          slippageBps: Number(slippageBps),
          hasReferral: false,
          currentPoint: await currentPoint(connection, venue.poolConfig.activationType),
        });

        // The quote reports prices, not impact — derive it from how far the
        // trade moves the curve.
        const before = Number(result.price.beforeSwap.toString());
        const after = Number(result.price.afterSwap.toString());
        const priceImpactPct = before > 0 ? Math.abs((after - before) / before) * 100 : 0;

        return ok({
          amountOut: result.amountOut.toString(),
          minimumAmountOut: result.minimumAmountOut.toString(),
          feeSol: result.fee.trading.toString(),
          priceImpactPct,
          graduated: false,
          // Set when the requested size exceeded the curve's remaining room, so
          // the UI can tell the user "only X SOL left" instead of failing.
          cappedTo,
        });
      }

      // ── Buy / sell on the curve ──
      case "swap": {
        const { wallet, pool, amountIn, minimumAmountOut, swapBaseForQuote } = body;
        if (!wallet || !pool || !amountIn || minimumAmountOut === undefined) {
          return err("wallet, pool, amountIn and minimumAmountOut are required");
        }

        const treasury = getTreasuryKeypair();
        const owner = new PublicKey(wallet);
        if (owner.equals(treasury.publicKey)) return err("Invalid wallet", 403);

        if (isRateLimited(wallet, tradeWalletTimestamps, TRADE_MAX_PER_MIN, TRADE_WINDOW_MS)) {
          return err("Rate limited", 429);
        }

        const poolPk = new PublicKey(pool);
        const venue = await resolveVenue(client, connection, poolPk);
        if (!venue) return err("Pool not found", 404);

        const isSell = Boolean(swapBaseForQuote);
        let requested = new BN(String(amountIn));
        let built: Transaction;

        if (venue.migrated) {
          // Graduated — trade on DAMM v2. Without this branch every buy after
          // graduation reverts, because the bonding curve is full.
          if (!venue.dammPool) {
            return err("This token has graduated but its new pool isn't live yet. Try again shortly.", 503);
          }
          const cpAmm = new CpAmm(connection);
          const state = await cpAmm.fetchPoolState(venue.dammPool);
          // cp-amm has no separate owner field — `payer` IS the trader, and its
          // token accounts are derived from it, so it must be the user.
          built = await cpAmm.swap({
            payer: owner,
            pool: venue.dammPool,
            inputTokenMint: isSell ? venue.virtualPool.baseMint : WSOL_MINT,
            outputTokenMint: isSell ? WSOL_MINT : venue.virtualPool.baseMint,
            amountIn: requested,
            minimumAmountOut: new BN(String(minimumAmountOut)),
            tokenAMint: state.tokenAMint,
            tokenBMint: state.tokenBMint,
            tokenAVault: state.tokenAVault,
            tokenBVault: state.tokenBVault,
            tokenAProgram: TOKEN_PROGRAM,
            tokenBProgram: TOKEN_PROGRAM,
            referralTokenAccount: null,
          } as any);
        } else {
          // Still bonding — never send more than the curve can absorb.
          if (!isSell) {
            const capacity = remainingCurveCapacity(venue.virtualPool, venue.poolConfig);
            if (capacity.lten(0)) {
              await migrateNow(
                connection,
                client,
                poolPk,
                venue.virtualPool.config,
                venue.poolConfig.migrationFeeOption,
              );
              return err("This token just graduated — re-quote and try again.", 409);
            }
            if (requested.gt(capacity)) requested = capacity;
          }
          built = await client.pool.swap({
            owner,
            payer: owner, // the trader pays their own gas and account rent
            pool: poolPk,
            amountIn: requested,
            minimumAmountOut: new BN(String(minimumAmountOut)),
            swapBaseForQuote: isSell,
            referralTokenAccount: null,
          });
        }

        // Traders pay their own network fee — the treasury only funds migration.
        const tx = await finalize(connection, built, [], owner);
        return ok({ transaction: serialize(tx), amountIn: requested.toString(), graduated: venue.migrated });
      }

      // ── Creator claims their 50% of trading fees ──
      case "claim-creator-fees": {
        const { wallet, pool } = body;
        if (!wallet || !pool) return err("wallet and pool are required");

        const treasury = getTreasuryKeypair();
        const creator = new PublicKey(wallet);
        if (creator.equals(treasury.publicKey)) return err("Invalid wallet", 403);

        const poolPk = new PublicKey(pool);
        const state = await client.state.getPool(poolPk);
        if (!state) return err("Pool not found", 404);
        if (!state.creator.equals(creator)) return err("Only the pool creator can claim these fees", 403);

        const claimableSol = Number(state.creatorQuoteFee.toString()) / LAMPORTS_PER_SOL;
        if (claimableSol <= 0) return err("No fees to claim yet");

        const built = await client.creator.claimCreatorTradingFee({
          creator,
          payer: creator, // creators pay for their own claim out of what they're claiming
          pool: poolPk,
          maxBaseAmount: state.creatorBaseFee,
          maxQuoteAmount: state.creatorQuoteFee,
        });

        const tx = await finalize(connection, built, [], creator);
        return ok({ transaction: serialize(tx), claimableSol });
      }

      // ── Live pool state ──
      case "pool-stats": {
        const { pool } = body;
        if (!pool) return err("pool is required");
        const stats = await poolStats(client, new PublicKey(pool));
        if (!stats) return err("Pool not found", 404);
        return ok(stats);
      }

      // ── Everything launched through Shyft's config ──
      case "launches": {
        const limit = Math.min(Number(body.limit) || 50, 100);
        // Two ways to look up launches:
        //   by config  (byte 72)  — every token on Shyft's own launchpad
        //   by creator (byte 104) — every token this wallet launched, on ANY
        //                           config. Needed because launches routed
        //                           through EasyA land on THEIR config, so a
        //                           config filter would never find them.
        // Explicit mint list — used to show tokens launched through Shyft onto
        // EasyA's config, which no config filter can find. The caller supplies
        // the mints from our own launch record.
        if (Array.isArray(body.mints) && body.mints.length) {
          const wsol = WSOL_MINT;
          const pools: PublicKey[] = [];
          for (const m of body.mints.slice(0, 50)) {
            try {
              // A DBC pool address is derived from (quoteMint, baseMint, config),
              // and we don't know EasyA's config per token — so look the pool up
              // by base mint instead.
              const found = await connection.getProgramAccounts(new PublicKey(DBC_PROGRAM_ID), {
                filters: [{ memcmp: { offset: 136, bytes: String(m) } }],
                dataSlice: { offset: 0, length: 0 },
              });
              if (found[0]) pools.push(found[0].pubkey);
            } catch {
              /* skip anything that doesn't resolve */
            }
          }
          const stats = (await Promise.all(pools.map((p) => poolStats(client, p).catch(() => null)))).filter(
            Boolean,
          ) as Awaited<ReturnType<typeof poolStats>>[];
          const meta = await fetchTokenMetadata(stats.map((p) => p!.baseMint));
          void wsol;
          return ok(
            stats.map((p) => ({
              ...p,
              ...(meta[p!.baseMint] || { name: "", symbol: "", image: "", description: "" }),
              tokenMint: p!.baseMint,
              launchWallet: p!.creator,
              status: p!.isMigrated ? "GRADUATED" : "PRE_GRAD",
            })),
          );
        }

        const creator = typeof body.creator === "string" ? body.creator : null;
        let creatorPk: PublicKey | null = null;
        if (creator) {
          try {
            creatorPk = new PublicKey(creator);
          } catch {
            return err("Invalid creator");
          }
        }
        const accounts = await connection.getProgramAccounts(new PublicKey(DBC_PROGRAM_ID), {
          filters: [
            creatorPk
              ? { memcmp: { offset: 104, bytes: creatorPk.toBase58() } }
              : { memcmp: { offset: 72, bytes: config.toBase58() } },
          ],
        });

        const pools = accounts.slice(0, limit).map((a) => a.pubkey);
        const settled = (await Promise.all(pools.map((p) => poolStats(client, p).catch(() => null)))).filter(
          Boolean,
        ) as Awaited<ReturnType<typeof poolStats>>[];

        // Stats alone can't be rendered — the token list needs a name, symbol
        // and image. One DAS batch call covers every mint at once.
        const meta = await fetchTokenMetadata(settled.map((p) => p!.baseMint));
        return ok(
          settled.map((p) => ({
            ...p,
            ...(meta[p!.baseMint] || { name: "", symbol: "", image: "", description: "" }),
            tokenMint: p!.baseMint,
            launchWallet: p!.creator,
            status: p!.isMigrated ? "GRADUATED" : "PRE_GRAD",
          })),
        );
      }

      default:
        return err(
          "Unknown action. Use: create-launch-tx, quote, swap, claim-creator-fees, pool-stats, launches",
        );
    }
  } catch (e: any) {
    console.error(`Launchpad "${action}" failed:`, e?.message || e);
    return err(e?.message || "Internal error", 500);
  }
}

/**
 * Name / symbol / image for a set of mints, via one Helius DAS batch call.
 * Metadata lives off-chain at the mint's URI, so without this a launched token
 * has nothing to render in a list.
 */
/**
 * Browsers cannot render an ipfs:// URI in an <img>, and EasyA's metadata uses
 * exactly that — so a Kickstart token showed a blank placeholder instead of
 * its logo. Rewrite to an HTTP gateway. (Our own uploads already return https.)
 */
function toHttpImage(url: string): string {
  if (!url) return "";
  if (url.startsWith("ipfs://")) {
    const cid = url.slice(7).replace(/^ipfs\//, "");
    return `https://gateway.pinata.cloud/ipfs/${cid}`;
  }
  return url;
}

async function fetchTokenMetadata(
  mints: string[],
): Promise<Record<string, { name: string; symbol: string; image: string; description: string }>> {
  const out: Record<string, { name: string; symbol: string; image: string; description: string }> = {};
  if (!mints.length) return out;
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "launchpad-meta",
        method: "getAssetBatch",
        params: { ids: mints.slice(0, 100) },
      }),
    });
    const json = await res.json();
    for (const asset of json?.result || []) {
      if (!asset?.id) continue;
      const c = asset.content || {};
      out[asset.id] = {
        name: c.metadata?.name || "",
        symbol: c.metadata?.symbol || "",
        image: toHttpImage(c.links?.image || c.files?.[0]?.cdn_uri || c.files?.[0]?.uri || ""),
        description: c.metadata?.description || "",
      };
    }
  } catch (e: any) {
    console.error("launchpad metadata fetch failed:", e?.message || e);
  }
  return out;
}

/** Shared read used by both pool-stats and launches. */
async function poolStats(client: DynamicBondingCurveClient, poolPk: PublicKey) {
  const state = await client.state.getPool(poolPk);
  if (!state) return null;
  const cfg = await client.state.getPoolConfig(state.config);

  // sqrtPrice is Q64.64: price = (sqrtPrice / 2^64)^2, adjusted for decimals.
  const sqrt = Number(state.sqrtPrice.toString()) / 2 ** 64;
  const priceSol = sqrt * sqrt * 10 ** (cfg.tokenDecimal - 9);

  const quoteReserve = Number(state.quoteReserve.toString());
  const threshold = Number(cfg.migrationQuoteThreshold.toString());

  const isMigrated = Boolean(state.isMigrated);

  return {
    pool: poolPk.toBase58(),
    baseMint: state.baseMint.toBase58(),
    creator: state.creator.toBase58(),
    priceSol,
    priceUsd: null,
    quoteReserveSol: quoteReserve / LAMPORTS_PER_SOL,
    graduationProgress: isMigrated ? 1 : threshold > 0 ? Math.min(quoteReserve / threshold, 1) : 0,
    isMigrated,
    /** Where trading actually happens now — the UI should link here once graduated. */
    dammPool: isMigrated
      ? deriveDammV2PoolAddress(
          DAMM_V2_MIGRATION_FEE_ADDRESS[cfg.migrationFeeOption],
          state.baseMint,
          WSOL_MINT,
        ).toBase58()
      : null,
    /** SOL of curve capacity left before graduation; 0 once graduated. */
    remainingCapacitySol: isMigrated
      ? 0
      : Number(remainingCurveCapacity(state, cfg).toString()) / LAMPORTS_PER_SOL,
    creatorFeesSol: Number(state.creatorQuoteFee.toString()) / LAMPORTS_PER_SOL,
  };
}
