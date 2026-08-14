import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  deriveDammV2PoolAddress,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { migratePool } from "@/lib/launchpadMigrate";

/**
 * /api/launchpad/cron — keeps launched tokens healthy.
 *
 * Two jobs, both of which otherwise depend on luck:
 *
 *  1. MIGRATE tokens that have filled their bonding curve. This is a BACKSTOP:
 *     /api/launchpad also migrates on demand the instant a trade meets a full
 *     curve, so tokens normally graduate within seconds. This runs every minute
 *     and only catches tokens that sold out with nobody then trading at all.
 *
 *  2. SWEEP Shyft's share of trading fees into the treasury. Fees accrue in two
 *     places — the bonding curve, and (after graduation) a locked DAMM v2 LP
 *     position — and neither pays out on its own.
 *
 * Auth: `authorization: Bearer ${CRON_SECRET}` or `?secret=` — same pattern as
 * push/cron and quests/cron.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const RPC_URL =
  (process.env.LAUNCHPAD_RPC_URL || "").trim() ||
  `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;
const LAUNCHPAD_CONFIG = (process.env.NEXT_PUBLIC_LAUNCHPAD_CONFIG || "").trim();
const DBC_PROGRAM_ID = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** Don't spend a signature chasing dust. */
const MIN_CLAIM_LAMPORTS = 1_000_000; // 0.001 SOL

function isAuthorised(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // unset = open in dev
  const headerSecret = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return headerSecret === expected || querySecret === expected;
}

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

export async function GET(req: NextRequest) {
  if (!isAuthorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!LAUNCHPAD_CONFIG) return NextResponse.json({ error: "launchpad not configured" }, { status: 503 });

  const connection = new Connection(RPC_URL, "confirmed");
  const client = new DynamicBondingCurveClient(connection, "confirmed");
  const cpAmm = new CpAmm(connection);
  const treasury = getTreasuryKeypair();
  const config = new PublicKey(LAUNCHPAD_CONFIG);

  const migrated: string[] = [];
  const swept: string[] = [];
  const errors: string[] = [];
  const before = await connection.getBalance(treasury.publicKey);

  try {
    const accounts = await connection.getProgramAccounts(DBC_PROGRAM_ID, {
      filters: [{ memcmp: { offset: 72, bytes: config.toBase58() } }],
      dataSlice: { offset: 0, length: 0 },
    });

    for (const { pubkey } of accounts) {
      let state = await client.state.getPool(pubkey);
      if (!state) continue;
      const cfg = await client.state.getPoolConfig(state.config);

      // ── 1. Graduate anything that has filled its curve ──
      if (!state.isMigrated && state.quoteReserve.gte(cfg.migrationQuoteThreshold)) {
        const res = await migratePool(
          connection,
          client,
          treasury,
          pubkey,
          state.config,
          cfg.migrationFeeOption,
        );
        if (res.signature) {
          migrated.push(`${pubkey.toBase58()}:${res.signature}`);
          console.log(`🎓 migrated ${pubkey.toBase58()} ${res.signature}`);
        }
        if (res.error) errors.push(`migrate ${pubkey.toBase58()}: ${res.error.slice(0, 120)}`);
        if (res.migrated) state = (await client.state.getPool(pubkey)) ?? state;
      }

      // ── 2. Sweep bonding-curve fees (still claimable after graduation) ──
      if (state.partnerQuoteFee.gten(MIN_CLAIM_LAMPORTS)) {
        try {
          const tx = await client.partner.claimPartnerTradingFee({
            feeClaimer: treasury.publicKey,
            payer: treasury.publicKey,
            pool: pubkey,
            maxBaseAmount: state.partnerBaseFee,
            maxQuoteAmount: state.partnerQuoteFee,
          });
          const sig = await sendAndConfirmTransaction(connection, tx, [treasury], { commitment: "confirmed" });
          swept.push(`curve:${sig}`);
        } catch (e: any) {
          errors.push(`curve-claim ${pubkey.toBase58()}: ${(e?.message || e).slice(0, 120)}`);
        }
      }

      // ── 3. Sweep DAMM v2 LP fees for graduated tokens ──
      if (!state.isMigrated) continue;
      const dammPool = deriveDammV2PoolAddress(
        DAMM_V2_MIGRATION_FEE_ADDRESS[cfg.migrationFeeOption],
        state.baseMint,
        WSOL_MINT,
      );
      if (!(await connection.getAccountInfo(dammPool))) continue;

      try {
        const positions = await cpAmm.getUserPositionByPool(dammPool, treasury.publicKey);
        if (!positions?.length) continue;
        const v2State = await cpAmm.fetchPoolState(dammPool);
        for (const { position, positionNftAccount } of positions) {
          // feeBPending is a stale checkpoint and reads 0 even when fees are
          // owed, so it can't gate this — claim and let the program decide.
          const tx: Transaction = await cpAmm.claimPositionFee({
            owner: treasury.publicKey,
            position,
            pool: dammPool,
            positionNftAccount,
            tokenAMint: v2State.tokenAMint,
            tokenBMint: v2State.tokenBMint,
            tokenAVault: v2State.tokenAVault,
            tokenBVault: v2State.tokenBVault,
            tokenAProgram: TOKEN_PROGRAM,
            tokenBProgram: TOKEN_PROGRAM,
          });
          const sig = await sendAndConfirmTransaction(connection, tx, [treasury], { commitment: "confirmed" });
          swept.push(`dammv2:${sig}`);
        }
      } catch (e: any) {
        errors.push(`dammv2-claim ${pubkey.toBase58()}: ${(e?.message || e).slice(0, 120)}`);
      }
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "cron failed", migrated, swept, errors }, { status: 500 });
  }

  const after = await connection.getBalance(treasury.publicKey);
  return NextResponse.json({
    ok: true,
    migrated,
    swept,
    errors,
    treasuryDeltaSol: (after - before) / 1e9,
  });
}
