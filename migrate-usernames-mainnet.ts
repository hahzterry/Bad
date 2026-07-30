#!/usr/bin/env npx tsx
/**
 * MAINNET migration: give every existing profile the on-chain registry record
 * for the username it already displays. Ordered ACTIVE-FIRST so that on the two
 * duplicate names (shaan, tommy) the real/active account wins the race — the
 * empty duplicate's backfill then fails (name already taken), which is correct.
 *
 * Signed by ADMIN_AUTHORITY (mainnet.json / 8wf9jJ…). Idempotent: a name that's
 * already backfilled is skipped.
 */

import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import bs58 from "bs58";
import * as fs from "fs";
import idl from "./target/idl/shadowspace.json";

const RPC = "https://mainnet.helius-rpc.com/?api-key=7d359733-8771-4d20-af8c-54f756c96bb1";
const PROGRAM_ID = new PublicKey(idl.address);
const PROFILE_DISC = Buffer.from([184, 101, 165, 188, 95, 63, 127, 188]);
const profilePda = (o: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("profile"), o.toBuffer()], PROGRAM_ID)[0];
const usernamePda = (n: string) => PublicKey.findProgramAddressSync([Buffer.from("username"), Buffer.from(n)], PROGRAM_ID)[0];
const ok = (n: string) => /^[a-z0-9_]+$/.test(n) && n.length <= 16;

(async () => {
  const connection = new Connection(RPC, "confirmed");
  const genesis = await connection.getGenesisHash();
  if (genesis !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") throw new Error(`Refusing: not mainnet (genesis ${genesis})`);
  console.log("🌐 MAINNET verified\n");

  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/mainnet.json`, "utf-8"))));
  console.log("admin (ADMIN_AUTHORITY):", admin.publicKey.toBase58());
  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" });
  const program = new Program(idl as Idl, provider) as any;

  console.log("scanning profiles…");
  const accts = await connection.getProgramAccounts(PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: bs58.encode(PROFILE_DISC) } }] });
  const rows: { owner: PublicKey; name: string; score: number }[] = [];
  for (const { account } of accts) {
    const d = account.data;
    const owner = new PublicKey(d.subarray(8, 40));
    const ul = d.readUInt32LE(40);
    if (ul === 0 || ul > 64) continue;
    let o = 44; const name = d.subarray(o, o + ul).toString("utf8"); o += ul;
    const dl = d.readUInt32LE(o); o += 4 + dl;
    const bl = d.readUInt32LE(o); o += 4 + bl; o += 1;
    const posts = d.readUInt32LE(o); o += 4;
    const followers = d.readUInt32LE(o); o += 4;
    if (!ok(name.toLowerCase())) { console.log(`  skip invalid name "${name}"`); continue; }
    rows.push({ owner, name: name.toLowerCase(), score: followers * 10 + posts });
  }
  rows.sort((a, b) => b.score - a.score); // active first
  console.log(`${rows.length} named profiles to migrate (active-first)\n`);

  let done = 0, skipped = 0, collided = 0, failed = 0;
  for (const r of rows) {
    const recPda = usernamePda(r.name);
    if (await connection.getAccountInfo(recPda)) { skipped++; continue; } // already has a record
    try {
      await program.methods.adminBackfillUsername(r.name)
        .accounts({ usernameRecord: recPda, profile: profilePda(r.owner), authority: admin.publicKey, systemProgram: PublicKey.default })
        .rpc();
      done++;
      if (done % 20 === 0) console.log(`  …${done} done`);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("already in use") || msg.includes("0x0")) { collided++; console.log(`  ⚠️  "${r.name}" already taken (duplicate) — ${r.owner.toBase58().slice(0, 8)} loses`); }
      else { failed++; console.log(`  ❌ "${r.name}" (${r.owner.toBase58().slice(0, 8)}): ${msg.split("\n")[0].slice(0, 90)}`); }
    }
  }

  console.log(`\n${"─".repeat(52)}`);
  console.log(`migrated: ${done} | already had record: ${skipped} | duplicates lost: ${collided} | failed: ${failed}`);
  // Verify a couple of the important ones
  for (const n of ["shaan", "tommy"]) {
    const rec = await (program.account as any).usernameRecord.fetch(usernamePda(n)).catch(() => null);
    if (rec) console.log(`  @${n} → owner ${rec.owner.toBase58()}`);
  }
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error("💥", e?.message ?? e); process.exit(1); });
