import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { BorshCoder } from "@coral-xyz/anchor";
import idl from "./src/lib/idl.json";
// @ts-ignore
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const PROGRAM_ID = new PublicKey("EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ");
const RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;

async function main() {
  const treasury = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.TREASURY_PRIVATE_KEY!)));
  const conn = new Connection(RPC, "confirmed");
  console.log("Treasury:", treasury.publicKey.toBase58(), "Balance:", (await conn.getBalance(treasury.publicKey)) / 1e9, "SOL");

  const allAccounts = await conn.getProgramAccounts(PROGRAM_ID);
  console.log(`${allAccounts.length} total program accounts`);

  const coder = new BorshCoder(idl as any);
  const toClose: PublicKey[] = [];

  for (const { pubkey, account } of allAccounts) {
    try { const d = coder.accounts.decode("Chat", account.data); if (d) { toClose.push(pubkey); console.log(`  Chat: ${pubkey.toBase58()}`); continue; } } catch {}
    try { const d = coder.accounts.decode("Message", account.data); if (d) { toClose.push(pubkey); console.log(`  Msg:  ${pubkey.toBase58()} ${((d as any).content || "").slice(0,30)}`); continue; } } catch {}
  }

  if (!toClose.length) { console.log("No chat/message accounts to close!"); return; }
  console.log(`\nClosing ${toClose.length} accounts...`);

  const { sha256 } = await import("@noble/hashes/sha256");
  const disc = sha256(new TextEncoder().encode("global:admin_force_close")).slice(0, 8);

  let closed = 0;
  for (let i = 0; i < toClose.length; i += 5) {
    const batch = toClose.slice(i, i + 5);
    const tx = new Transaction();
    for (const t of batch) {
      tx.add(new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [{ pubkey: t, isSigner: false, isWritable: true }, { pubkey: treasury.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.from(disc),
      }));
    }
    try {
      const sig = await conn.sendTransaction(tx, [treasury]);
      await conn.confirmTransaction(sig, "confirmed");
      closed += batch.length;
      console.log(`  ✅ Batch ${Math.floor(i/5)+1}: ${batch.length} closed`);
    } catch (e: any) {
      console.error(`  ❌ Batch failed:`, e?.message?.slice(0, 80));
    }
  }
  console.log(`\n🧹 Done! Closed ${closed}/${toClose.length} accounts.`);
}
main().catch(console.error);
