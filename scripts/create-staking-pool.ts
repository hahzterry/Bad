/**
 * Shyft $SHYFT Staking — one-time pool setup (Streamflow Staking SDK)
 * ------------------------------------------------------------------
 * Creates the stake pool, a wSOL reward pool, and funds Season 1.
 *
 * ⚠️  Run with a DEDICATED ADMIN WALLET — never the gas treasury.
 *     The admin wallet needs: SOL for tx fees + the reward budget
 *     (which this script wraps to wSOL and deposits into the pool).
 *
 * Test on DEVNET first, then re-run with --mainnet.
 *
 *   ADMIN_SECRET=<base58 secret key>  npx tsx scripts/create-staking-pool.ts            # devnet
 *   ADMIN_SECRET=<base58 secret key>  npx tsx scripts/create-staking-pool.ts --mainnet  # LIVE
 */
import {
  Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram,
  Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction, NATIVE_MINT,
} from "@solana/spl-token";
import { SolanaStakingClient, constants } from "@streamflow/staking";
import { ICluster } from "@streamflow/stream";
import BN from "bn.js";
import bs58 from "bs58";

// ── CONFIG (tune these) ───────────────────────────────────────────
const SHYFT_MINT = "7tnB2Dn61NkxWrpkESkUvfoKo6TcoecsazYemptEASY";
const DAY = 86_400;
const MIN_DURATION = new BN(7 * DAY);          // 7-day min lock  → 1×
const MAX_DURATION = new BN(180 * DAY);        // 180-day max lock → maxWeight
const MAX_WEIGHT = new BN(3).mul(constants.SCALE_PRECISION_FACTOR_BN); // 3× at max lock
const SEASON_1_BUDGET_SOL = 50;                // total reward cap for Season 1
const SEASON_DAYS = 90;                         // reward distribution window
const STAKE_POOL_NONCE = 0;
const REWARD_POOL_NONCE = 0;
// ──────────────────────────────────────────────────────────────────

const isMainnet = process.argv.includes("--mainnet");
const RPC = isMainnet
  ? (process.env.RPC || "https://api.mainnet-beta.solana.com")
  : "https://api.devnet.solana.com";

function loadAdmin(): Keypair {
  const s = process.env.ADMIN_SECRET;
  if (!s) throw new Error("Set ADMIN_SECRET (base58 secret key of the admin wallet).");
  return Keypair.fromSecretKey(bs58.decode(s.trim()));
}

/** Wrap SOL → wSOL in the admin's ATA so it can fund the reward pool. */
async function wrapSol(conn: Connection, admin: Keypair, lamports: number) {
  const ata = getAssociatedTokenAddressSync(NATIVE_MINT, admin.publicKey);
  const tx = new Transaction();
  if (!(await conn.getAccountInfo(ata))) {
    tx.add(createAssociatedTokenAccountInstruction(admin.publicKey, ata, admin.publicKey, NATIVE_MINT));
  }
  tx.add(
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: ata, lamports }),
    createSyncNativeInstruction(ata),
  );
  const sig = await sendAndConfirmTransaction(conn, tx, [admin]);
  console.log(`  wrapped ${lamports / LAMPORTS_PER_SOL} SOL → wSOL (${sig.slice(0, 8)}…)`);
  return ata;
}

async function main() {
  const admin = loadAdmin();
  const conn = new Connection(RPC, "confirmed");
  console.log(`\nNetwork : ${isMainnet ? "🔴 MAINNET" : "🟢 devnet"}`);
  console.log(`Admin   : ${admin.publicKey.toBase58()}`);

  const bal = await conn.getBalance(admin.publicKey);
  console.log(`Balance : ${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  const budgetLamports = SEASON_1_BUDGET_SOL * LAMPORTS_PER_SOL;
  if (bal < budgetLamports + 0.1 * LAMPORTS_PER_SOL) {
    throw new Error(`Admin needs at least ${SEASON_1_BUDGET_SOL + 0.1} SOL (budget + fees).`);
  }

  const client = new SolanaStakingClient({
    clusterUrl: RPC,
    cluster: isMainnet ? ICluster.Mainnet : ICluster.Devnet,
  });
  const invoker = admin; // signer

  // 1) Create the stake pool ------------------------------------------------
  console.log(`\n1) Creating stake pool for $SHYFT…`);
  const { metadataId, txId: c1 } = await client.createStakePool(
    {
      mint: SHYFT_MINT,
      nonce: STAKE_POOL_NONCE,
      maxWeight: MAX_WEIGHT,
      minDuration: MIN_DURATION,
      maxDuration: MAX_DURATION,
      permissionless: true,
    },
    { invoker },
  );
  const stakePool = metadataId.toBase58();
  console.log(`   ✅ stakePool: ${stakePool}  (${c1.slice(0, 8)}…)`);

  // 2) Wrap the reward budget to wSOL --------------------------------------
  console.log(`\n2) Wrapping ${SEASON_1_BUDGET_SOL} SOL → wSOL for rewards…`);
  await wrapSol(conn, admin, budgetLamports);

  // 3) Create the wSOL reward pool -----------------------------------------
  //    rewardAmount/rewardPeriod set the drip rate. VERIFY on devnet that the
  //    resulting APY matches your target before going mainnet.
  console.log(`\n3) Creating wSOL reward pool…`);
  const { txId: c2 } = await client.createRewardPool(
    {
      stakePoolNonce: STAKE_POOL_NONCE,
      rewardMint: NATIVE_MINT.toBase58(),        // wSOL
      nonce: REWARD_POOL_NONCE,
      rewardAmount: new BN(budgetLamports).div(new BN(SEASON_DAYS)), // ~per-day drip
      rewardPeriod: new BN(DAY),                 // accrual period = 1 day
      permissionless: true,
      lastClaimPeriodOpt: null,
    },
    { invoker },
  );
  console.log(`   ✅ reward pool created (${c2.slice(0, 8)}…)`);

  // 4) Fund the reward pool with the wSOL budget ---------------------------
  console.log(`\n4) Funding reward pool with ${SEASON_1_BUDGET_SOL} wSOL…`);
  const { txId: c3 } = await client.fundPool(
    {
      stakePool: stakePool,
      rewardMint: NATIVE_MINT.toBase58(),
      nonce: REWARD_POOL_NONCE,
      amount: new BN(budgetLamports),
      feeValue: null,
    },
    { invoker },
  );
  console.log(`   ✅ funded (${c3.slice(0, 8)}…)`);

  console.log(`\n🎉 Done. Wire this into the /stake page:`);
  console.log(`   STAKE_POOL = ${stakePool}`);
  console.log(`   REWARD_MINT = ${NATIVE_MINT.toBase58()} (wSOL)`);
}

main().catch((e) => { console.error("\n❌", e.message || e); process.exit(1); });
