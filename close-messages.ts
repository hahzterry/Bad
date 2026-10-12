/**
 * MESSAGES-ONLY cleanup (mainnet).
 * Closes ONLY message accounts (589-byte, dataSize filter) via admin_force_close.
 * Chats / profiles / posts are NOT touched. Rent → admin wallet (8wf9jJ…).
 */
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as os from "os";
import idl from "./src/lib/idl.json";

const PROGRAM_ID = new PublicKey("EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ");
const RPC = "https://mainnet.helius-rpc.com/?api-key=7d359733-8771-4d20-af8c-54f756c96bb1";
const MESSAGE_SIZE = 589;       // 8 + Message::LEN — ONLY messages
const BATCH = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/mainnet.json`, "utf8"))));
  const program = new Program(idl as any, new AnchorProvider(conn, new Wallet(admin), { commitment: "confirmed" }));
  console.log(`Admin: ${admin.publicKey.toBase58()}`);

  // fetch ONLY message accounts (size filter)
  const msgs = await conn.getProgramAccounts(PROGRAM_ID, { filters: [{ dataSize: MESSAGE_SIZE }], dataSlice: { offset: 0, length: 0 } });
  const rentTotal = msgs.reduce((s, a) => s + a.account.lamports, 0);
  console.log(`Message accounts to close: ${msgs.length}  (rent ${(rentTotal / LAMPORTS_PER_SOL).toFixed(5)} SOL)`);
  if (msgs.length === 0) { console.log("nothing to close."); return; }

  const before = await conn.getBalance(admin.publicKey);
  let closed = 0, failed = 0;

  for (let i = 0; i < msgs.length; i += BATCH) {
    const batch = msgs.slice(i, i + BATCH);
    try {
      const ixs = await Promise.all(batch.map((m) =>
        program.methods.adminForceClose()
          .accounts({ targetAccount: m.pubkey, authority: admin.publicKey })
          .instruction()
      ));
      const bh = (await conn.getLatestBlockhash()).blockhash;
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: admin.publicKey, recentBlockhash: bh, instructions: ixs }).compileToV0Message());
      tx.sign([admin]);
      const sig = await conn.sendTransaction(tx, { skipPreflight: false });
      await conn.confirmTransaction(sig, "confirmed");
      closed += batch.length;
      console.log(`  closed ${closed}/${msgs.length}  (${sig.slice(0, 8)}…)`);
    } catch (e: any) {
      failed += batch.length;
      console.log(`  batch failed: ${(e.message || "").slice(0, 80)}`);
    }
    await sleep(400);
  }

  const after = await conn.getBalance(admin.publicKey);
  console.log(`\nDone. closed=${closed} failed=${failed}`);
  console.log(`Admin balance: ${(before / LAMPORTS_PER_SOL).toFixed(5)} → ${(after / LAMPORTS_PER_SOL).toFixed(5)} SOL  (+${((after - before) / LAMPORTS_PER_SOL).toFixed(5)} reclaimed, minus fees)`);
}
main().catch((e) => { console.error("❌", e.message || e); process.exit(1); });
