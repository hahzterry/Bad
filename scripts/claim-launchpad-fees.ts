/**
 * scripts/claim-launchpad-fees.ts
 *
 * Sweeps Shyft's share of launchpad trading fees into the treasury.
 *
 * Every token launched through Shyft's DBC config accrues fees into three
 * buckets: creator, partner (Shyft) and Meteora's protocol cut. The creator
 * claims theirs in-app; this script claims the partner side, which otherwise
 * just sits in the pools unclaimed.
 *
 * It is an admin operation, not a user-facing one — the treasury is the config's
 * feeClaimer, so only the treasury key can run it.
 *
 * Usage:
 *   npx tsx scripts/claim-launchpad-fees.ts                       # dry run
 *   npx tsx scripts/claim-launchpad-fees.ts --execute             # claim
 *   NET=devnet TREASURY_KEYFILE=... npx tsx ... --execute         # devnet
 *
 *   --min=0.01   skip pools with less than this much unclaimed (default 0.001)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  deriveDammV2PoolAddress,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";

const DBC_PROGRAM_ID = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");

const EXECUTE = process.argv.includes("--execute");
const NET = (process.env.NET || "mainnet").toLowerCase();
const MIN_SOL = Number(process.argv.find((a) => a.startsWith("--min="))?.split("=")[1] ?? 0.001);

function loadEnv(): Record<string, string> {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

function loadTreasury(env: Record<string, string>): Keypair {
  const keyfile = process.env.TREASURY_KEYFILE;
  if (keyfile) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(keyfile, "utf8"))));
  const secret = process.env.TREASURY_PRIVATE_KEY || env.TREASURY_PRIVATE_KEY;
  if (secret?.trimStart().startsWith("[")) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(secret)));
  }
  const file = path.join(os.homedir(), ".config/solana/mainnet-treasury.json");
  if (fs.existsSync(file)) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(file, "utf8"))));
  }
  throw new Error("No treasury key — set TREASURY_KEYFILE or TREASURY_PRIVATE_KEY");
}

async function main() {
  const env = loadEnv();
  const apiKey = process.env.HELIUS_API_KEY_PRIVATE || env.HELIUS_API_KEY_PRIVATE;
  if (!apiKey) throw new Error("HELIUS_API_KEY_PRIVATE not set");

  const configKey = (process.env.NEXT_PUBLIC_LAUNCHPAD_CONFIG || env.NEXT_PUBLIC_LAUNCHPAD_CONFIG || "").trim();
  if (!configKey) throw new Error("NEXT_PUBLIC_LAUNCHPAD_CONFIG not set");

  const connection = new Connection(`https://${NET}.helius-rpc.com/?api-key=${apiKey}`, "confirmed");
  const client = new DynamicBondingCurveClient(connection, "confirmed");
  const treasury = loadTreasury(env);
  const config = new PublicKey(configKey);

  console.log(`network   ${NET}`);
  console.log(`config    ${config.toBase58()}`);
  console.log(`treasury  ${treasury.publicKey.toBase58()}`);

  // Same memcmp the API uses: the pool stores its config at byte 72.
  const accounts = await connection.getProgramAccounts(DBC_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 72, bytes: config.toBase58() } }],
    dataSlice: { offset: 0, length: 0 },
  });
  console.log(`pools     ${accounts.length}\n`);

  const before = await connection.getBalance(treasury.publicKey);
  const cpAmm = new CpAmm(connection);
  const wsol = new PublicKey("So11111111111111111111111111111111111111112");
  let claimed = 0;
  let totalSol = 0;

  for (const { pubkey } of accounts) {
    const state = await client.state.getPool(pubkey);
    if (!state) continue;

    // ── 1. Bonding-curve fees. These stay claimable even AFTER the token has
    // graduated — a migrated pool keeps its unclaimed partner bucket.
    const sol = Number(state.partnerQuoteFee.toString()) / 1e9;
    if (sol >= MIN_SOL) {
      totalSol += sol;
      console.log(`  ${pubkey.toBase58()}  curve ${sol.toFixed(9)} SOL`);
      if (EXECUTE) {
        try {
          const tx = await client.partner.claimPartnerTradingFee({
            feeClaimer: treasury.publicKey,
            payer: treasury.publicKey,
            pool: pubkey,
            maxBaseAmount: state.partnerBaseFee,
            maxQuoteAmount: state.partnerQuoteFee,
          });
          const sig = await sendAndConfirmTransaction(connection, tx, [treasury], { commitment: "confirmed" });
          console.log(`    ✅ curve ${sig}`);
          claimed++;
        } catch (e: any) {
          console.log(`    ❌ curve ${e?.message || e}`);
        }
      }
    }

    // ── 2. Graduated tokens trade on DAMM v2, and those fees accrue to a
    // permanently-locked LP position whose NFT the migration hands to the
    // feeClaimer. Different program, different claim — without this the
    // post-graduation half of the revenue is never collected.
    if (!state.isMigrated) continue;

    // migrationFeeOption lives on the CONFIG, not the pool — reading it off the
    // pool silently derives the wrong DAMM v2 address and finds nothing.
    const poolCfg = await client.state.getPoolConfig(state.config);
    const v2Pool = deriveDammV2PoolAddress(
      DAMM_V2_MIGRATION_FEE_ADDRESS[poolCfg.migrationFeeOption],
      state.baseMint,
      wsol,
    );
    if (!(await connection.getAccountInfo(v2Pool))) continue;

    let positions;
    try {
      positions = await cpAmm.getUserPositionByPool(v2Pool, treasury.publicKey);
    } catch {
      continue;
    }
    if (!positions?.length) continue;

    const v2State = await cpAmm.fetchPoolState(v2Pool);
    for (const { position, positionNftAccount, positionState } of positions) {
      // NOTE: feeBPending on the stored position is a CHECKPOINT — it stays 0
      // until the position is touched, even when fees are owed. So it can't be
      // used to decide whether to claim; verified on devnet, where a fresh
      // trade left it reading 0 while real fees were claimable. We attempt the
      // claim unconditionally for migrated pools (a few thousand lamports of
      // signature fee) rather than silently skip real revenue.
      const checkpoint = Number((positionState.feeBPending ?? 0).toString()) / 1e9;
      console.log(
        `  ${pubkey.toBase58()}  dammv2 position ${position.toBase58().slice(0, 8)}.. (checkpoint ${checkpoint.toFixed(9)} SOL, claiming anyway)`,
      );
      if (!EXECUTE) continue;

      try {
        // cp-amm's TxBuilder is just Promise<Transaction> — awaiting it IS the tx.
        const tx: Transaction = await cpAmm.claimPositionFee({
          owner: treasury.publicKey,
          position,
          pool: v2Pool,
          positionNftAccount,
          tokenAMint: v2State.tokenAMint,
          tokenBMint: v2State.tokenBMint,
          tokenAVault: v2State.tokenAVault,
          tokenBVault: v2State.tokenBVault,
          tokenAProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
          tokenBProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        });
        const sig = await sendAndConfirmTransaction(connection, tx, [treasury], { commitment: "confirmed" });
        console.log(`    ✅ dammv2 ${sig}`);
        claimed++;
      } catch (e: any) {
        console.log(`    ❌ dammv2 ${e?.message || e}`);
      }
    }
  }

  console.log(`\nunclaimed across pools: ${totalSol.toFixed(9)} SOL`);
  if (!EXECUTE) {
    console.log("DRY RUN — re-run with --execute to claim.");
    return;
  }
  const after = await connection.getBalance(treasury.publicKey);
  console.log(`claimed from ${claimed} pool(s)`);
  console.log(`treasury ${(before / 1e9).toFixed(9)} -> ${(after / 1e9).toFixed(9)} SOL  (${((after - before) / 1e9).toFixed(9)})`);
}

main().catch((e) => {
  console.error("❌", e?.message || e);
  process.exit(1);
});
