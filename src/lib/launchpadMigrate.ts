import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

/**
 * Graduating a token from its bonding curve to a DAMM v2 pool.
 *
 * SERVER ONLY — this signs with the treasury key.
 *
 * Migration is permissionless and nobody is obliged to do it, so Shyft does it
 * for its own tokens. Crucially it has to happen FAST: once the curve is full
 * every buy reverts, so a token is untradable in the window between selling out
 * and migrating — the busiest moment in its life. That's why this is called
 * on-demand from /api/launchpad the instant a trade meets a full curve, with
 * the 10-minute cron only as a backstop.
 *
 * Safe to race: if a sniper bot migrates first the transaction simply fails as
 * already-migrated, which `isAlreadyMigrated` treats as success.
 */

/** A bot beat us to it, or it was already done — not a failure. */
export function isAlreadyMigrated(message: string): boolean {
  return /already|0x1770|NotPermit|custom program error: 0x1771/i.test(message);
}

export interface MigrateResult {
  migrated: boolean;
  signature?: string;
  /** Set when we didn't migrate and it wasn't simply already done. */
  error?: string;
}

/**
 * Migrate one pool. Assumes the caller has already checked the curve is full;
 * migrating early fails with NotPermitToDoThisAction.
 */
export async function migratePool(
  connection: Connection,
  client: DynamicBondingCurveClient,
  treasury: Keypair,
  pool: PublicKey,
  config: PublicKey,
  migrationFeeOption: number,
): Promise<MigrateResult> {
  try {
    // Step 1 — bookkeeping account the DBC program requires before handover.
    // Harmless if it already exists, so failures here are not fatal on their own.
    try {
      const meta = await client.migration.createDammV2MigrationMetadata({
        payer: treasury.publicKey,
        virtualPool: pool,
        config,
      });
      await sendAndConfirmTransaction(connection, meta, [treasury], { commitment: "confirmed" });
    } catch (e: any) {
      if (!/already|in use/i.test(e?.message || "")) throw e;
    }

    // Step 2 — move liquidity into DAMM v2. The two position NFTs are minted
    // here; the program routes them to the creator and the config's feeClaimer
    // regardless of who pays, so it's safe for anyone to run.
    const res = await client.migration.migrateToDammV2({
      payer: treasury.publicKey,
      virtualPool: pool,
      dammConfig: DAMM_V2_MIGRATION_FEE_ADDRESS[migrationFeeOption],
    });
    const signature = await sendAndConfirmTransaction(
      connection,
      res.transaction,
      [treasury, res.firstPositionNftKeypair, res.secondPositionNftKeypair],
      { commitment: "confirmed" },
    );
    return { migrated: true, signature };
  } catch (e: any) {
    const message = e?.message || String(e);
    if (isAlreadyMigrated(message)) return { migrated: true };
    return { migrated: false, error: message };
  }
}
