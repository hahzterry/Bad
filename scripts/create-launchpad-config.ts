/**
 * scripts/create-launchpad-config.ts
 *
 * ONE-TIME setup for the Shyft launchpad.
 *
 * Creates Shyft's own Meteora DBC partner config. Every token launched from
 * Shyft points at this config, which is what decides the trading fee, how the
 * fee is split, when the token graduates, and where Shyft's cut lands.
 *
 * The curve/economics are CLONED from EasyA Kickstart's live config
 * (72JMqxS3By9FGsWSxgheZ97GKs5ky4wsHcu66KxPb6yW) so the numbers are known-good
 * — the only things changed are `feeClaimer` and `leftoverReceiver`, which are
 * repointed at the Shyft treasury.
 *
 *   Trade fee   2%          Creator 50% / Shyft 50%
 *   Supply      1B, fixed   Graduates at ~85.07 SOL into DAMM v2
 *
 * Usage:
 *   npx tsx scripts/create-launchpad-config.ts                      # dry run — prints the diff
 *   npx tsx scripts/create-launchpad-config.ts --execute            # sends the tx
 *   NET=devnet npx tsx scripts/create-launchpad-config.ts --execute # same config, on devnet
 *
 * The template is always read from MAINNET (it only exists there); NET only
 * decides where the new config is written and which key pays.
 *
 * Writes the resulting config pubkey to stdout. Put it in .env.local as
 * NEXT_PUBLIC_LAUNCHPAD_CONFIG.
 */

import fs from "fs";
import os from "os";
import path from "path";
import BN from "bn.js";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";

/** The config we're cloning the economics from. */
const TEMPLATE_CONFIG = new PublicKey("72JMqxS3By9FGsWSxgheZ97GKs5ky4wsHcu66KxPb6yW");

const EXECUTE = process.argv.includes("--execute");
const NET = (process.env.NET || "mainnet").toLowerCase();
const IS_DEVNET = NET === "devnet";

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

/** Treasury keypair — same source the API uses, falling back to a CLI keyfile. */
function loadTreasury(env: Record<string, string>): Keypair {
  // On devnet an explicit keyfile is the norm, since the real treasury key
  // has no business being loaded for a throwaway test.
  const keyfile = process.env.TREASURY_KEYFILE;
  if (keyfile) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(keyfile, "utf8"))));
  }
  const secret = process.env.TREASURY_PRIVATE_KEY || env.TREASURY_PRIVATE_KEY;
  if (secret?.trimStart().startsWith("[")) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(secret)));
  }
  const file = path.join(os.homedir(), ".config/solana/mainnet-treasury.json");
  if (fs.existsSync(file)) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(file, "utf8"))));
  }
  throw new Error("No treasury key — set TREASURY_KEYFILE, TREASURY_PRIVATE_KEY, or add ~/.config/solana/mainnet-treasury.json");
}

async function main() {
  const env = loadEnv();
  const apiKey = process.env.HELIUS_API_KEY_PRIVATE || env.HELIUS_API_KEY_PRIVATE || env.HELIUS_API_KEY;
  if (!apiKey) throw new Error("HELIUS_API_KEY_PRIVATE not set");

  // The template lives on mainnet; the new config is written wherever NET says.
  const mainnet = new Connection(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, "confirmed");
  const connection = IS_DEVNET
    ? new Connection(`https://devnet.helius-rpc.com/?api-key=${apiKey}`, "confirmed")
    : mainnet;
  const client = new DynamicBondingCurveClient(connection, "confirmed");

  const treasury = loadTreasury(env);
  const balance = await connection.getBalance(treasury.publicKey);
  console.log(`network   ${NET}`);
  console.log(`treasury  ${treasury.publicKey.toBase58()}  (${(balance / 1e9).toFixed(4)} SOL)`);

  // ── Pull the template economics off-chain (always from mainnet) ──
  const t = await new DynamicBondingCurveClient(mainnet, "confirmed").state.getPoolConfig(TEMPLATE_CONFIG);

  // The config account stores resolved values; createConfig wants the same
  // numbers back as *parameters*. Everything below is copied verbatim except
  // the two recipient fields.
  const configParams: any = {
    poolFees: {
      baseFee: {
        cliffFeeNumerator: t.poolFees.baseFee.cliffFeeNumerator,
        firstFactor: t.poolFees.baseFee.firstFactor,
        secondFactor: t.poolFees.baseFee.secondFactor,
        thirdFactor: t.poolFees.baseFee.thirdFactor,
        baseFeeMode: t.poolFees.baseFee.baseFeeMode,
      },
      dynamicFee: t.poolFees.dynamicFee.initialized
        ? {
            binStep: t.poolFees.dynamicFee.binStep,
            binStepU128: t.poolFees.dynamicFee.binStepU128,
            filterPeriod: t.poolFees.dynamicFee.filterPeriod,
            decayPeriod: t.poolFees.dynamicFee.decayPeriod,
            reductionFactor: t.poolFees.dynamicFee.reductionFactor,
            maxVolatilityAccumulator: t.poolFees.dynamicFee.maxVolatilityAccumulator,
            variableFeeControl: t.poolFees.dynamicFee.variableFeeControl,
          }
        : null,
    },
    collectFeeMode: t.collectFeeMode,
    migrationOption: t.migrationOption,
    activationType: t.activationType,
    tokenType: t.tokenType,
    tokenDecimal: t.tokenDecimal,
    partnerLpPercentage: t.partnerLpPercentage,
    partnerLockedLpPercentage: t.partnerLockedLpPercentage,
    creatorLpPercentage: t.creatorLpPercentage,
    creatorLockedLpPercentage: t.creatorLockedLpPercentage,
    migrationQuoteThreshold: t.migrationQuoteThreshold,
    sqrtStartPrice: t.sqrtStartPrice,
    lockedVesting: {
      amountPerPeriod: t.lockedVestingConfig.amountPerPeriod,
      cliffDurationFromMigrationTime: t.lockedVestingConfig.cliffDurationFromMigrationTime,
      frequency: t.lockedVestingConfig.frequency,
      numberOfPeriod: t.lockedVestingConfig.numberOfPeriod,
      cliffUnlockAmount: t.lockedVestingConfig.cliffUnlockAmount,
    },
    migrationFeeOption: t.migrationFeeOption,
    tokenSupply: t.fixedTokenSupplyFlag
      ? {
          preMigrationTokenSupply: t.preMigrationTokenSupply,
          postMigrationTokenSupply: t.postMigrationTokenSupply,
        }
      : null,
    creatorTradingFeePercentage: t.creatorTradingFeePercentage,
    tokenUpdateAuthority: t.tokenUpdateAuthority,
    migrationFee: {
      feePercentage: t.migrationFeePercentage,
      creatorFeePercentage: t.creatorMigrationFeePercentage,
    },
    migratedPoolFee: {
      collectFeeMode: t.migratedCollectFeeMode,
      dynamicFee: t.migratedDynamicFee,
      poolFeeBps: t.migratedPoolFeeBps,
    },
    // Curve points are copied exactly — this is the price/liquidity shape.
    curve: t.curve
      .filter((p: any) => !p.sqrtPrice.isZero())
      .map((p: any) => ({ sqrtPrice: p.sqrtPrice, liquidity: p.liquidity })),
    // u64[7] — anchor needs BNs here, plain zeros fail to serialize.
    padding: new Array(7).fill(new BN(0)),
  };

  const feeBps = (Number(t.poolFees.baseFee.cliffFeeNumerator.toString()) / 1e9) * 10_000;
  console.log("\n── cloned economics ──");
  console.log(`  trade fee            ${feeBps / 100}%`);
  console.log(`  creator / partner    ${t.creatorTradingFeePercentage}% / ${100 - t.creatorTradingFeePercentage}%`);
  console.log(`  graduation           ${Number(t.migrationQuoteThreshold.toString()) / 1e9} SOL`);
  console.log(`  supply               ${Number(t.preMigrationTokenSupply.toString()) / 10 ** t.tokenDecimal}`);
  console.log(`  decimals             ${t.tokenDecimal}`);
  console.log(`  migration            ${t.migrationOption === 1 ? "DAMM v2" : "DAMM v1"}`);
  console.log(`  curve points         ${configParams.curve.length}`);
  console.log("\n── repointed ──");
  console.log(`  feeClaimer           ${t.feeClaimer.toBase58()}  ->  ${treasury.publicKey.toBase58()}`);
  console.log(`  leftoverReceiver     ${t.leftoverReceiver.toBase58()}  ->  ${treasury.publicKey.toBase58()}`);

  const configKeypair = Keypair.generate();

  if (!EXECUTE) {
    console.log(`\nDRY RUN — would create config ${configKeypair.publicKey.toBase58()}`);
    console.log("Re-run with --execute to send. (A fresh config key is generated each run.)");
    return;
  }

  const tx = await client.partner.createConfig({
    config: configKeypair.publicKey,
    feeClaimer: treasury.publicKey,
    leftoverReceiver: treasury.publicKey,
    quoteMint: t.quoteMint,
    payer: treasury.publicKey,
    ...configParams,
  });

  const sig = await sendAndConfirmTransaction(connection, tx, [treasury, configKeypair], {
    commitment: "confirmed",
  });

  console.log(`\n✅ config created`);
  console.log(`   ${configKeypair.publicKey.toBase58()}`);
  console.log(`   https://solscan.io/tx/${sig}`);
  console.log(`\nAdd to .env.local:`);
  console.log(`   NEXT_PUBLIC_LAUNCHPAD_CONFIG=${configKeypair.publicKey.toBase58()}`);
}

main().catch((e) => {
  console.error("❌", e?.message || e);
  process.exit(1);
});
