/**
 * Scans all on-chain posts and profiles, extracts every IPFS CID,
 * and re-pins each one to the new Pinata account via the /pinByHash API.
 * Run with: npx ts-node --skip-project repin-all.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const JWT = process.env.PINATA_JWT!;
const IPFS_CID_REGEX = /\/ipfs\/([a-zA-Z0-9]{46,})/g;

// Pull all post content + profile URLs from the chain via the public RPC
// We'll scan via Helius getAssets API since program accounts scanning is slow
// Instead: just read all posts from the program directly

import { Connection, PublicKey } from "@solana/web3.js";

const RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;
const PROGRAM_ID = new PublicKey("EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ");

// Try multiple gateways to fetch the raw file content
const FETCH_GATEWAYS = [
  "https://apricot-electoral-swordtail-476.mypinata.cloud", // old account (may still work for reads)
  "https://amethyst-secondary-orca-737.mypinata.cloud",
  "https://gateway.pinata.cloud",
  "https://cloudflare-ipfs.com",
  "https://dweb.link",
];

async function fetchCidContent(cid: string, filename?: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const path = filename ? `/${filename}` : "";
  for (const gw of FETCH_GATEWAYS) {
    try {
      const url = `${gw}/ipfs/${cid}${path}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get("content-type") || "application/octet-stream";
        return { buffer, contentType };
      }
    } catch {}
  }
  return null;
}

async function repinCid(cid: string, filename?: string): Promise<boolean> {
  try {
    const content = await fetchCidContent(cid, filename);
    if (!content) {
      console.error(`  No gateway served ${cid}`);
      return false;
    }

    const fname = filename || `${cid.slice(0, 8)}.bin`;
    const formData = new FormData();
    formData.append("file", new Blob([content.buffer], { type: content.contentType }), fname);
    formData.append("network", "public");
    formData.append("name", fname);

    const res = await fetch("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${JWT}` },
      body: formData,
    });

    if (res.status === 200 || res.status === 201) return true;
    const text = await res.text();
    if (text.includes("already")) return true;
    console.error(`  Upload failed ${cid}: ${res.status} ${text.slice(0, 100)}`);
    return false;
  } catch (e: any) {
    console.error(`  Error ${cid}: ${e.message}`);
    return false;
  }
}

async function main() {
  const conn = new Connection(RPC, "confirmed");

  console.log("Fetching all program accounts...");
  const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
    dataSlice: { offset: 0, length: 0 }, // just get keys first
  });
  console.log(`Found ${accounts.length} accounts. Fetching data...`);

  // Fetch full data in batches
  const BATCH = 100;
  const cids = new Map<string, string | undefined>(); // cid → filename

  for (let i = 0; i < accounts.length; i += BATCH) {
    const batch = accounts.slice(i, i + BATCH);
    const infos = await conn.getMultipleAccountsInfo(batch.map((a) => a.pubkey));
    for (const info of infos) {
      if (!info?.data) continue;
      try {
        const text = info.data.toString("utf8");
        let m: RegExpExecArray | null;
        // capture CID and optional filename from full URLs
        const re = /\/ipfs\/([a-zA-Z0-9]{20,})(?:\/([^\s"']+))?/g;
        while ((m = re.exec(text)) !== null) cids.set(m[1], m[2] || undefined);
        // bare CIDs
        const re2 = /\b(baf[a-zA-Z0-9]{40,}|Qm[a-zA-Z0-9]{40,})\b/g;
        while ((m = re2.exec(text)) !== null) if (!cids.has(m[1])) cids.set(m[1], undefined);
      } catch {}
    }
    process.stdout.write(`\rScanned ${Math.min(i + BATCH, accounts.length)}/${accounts.length} accounts, ${cids.size} CIDs found`);
  }

  console.log(`\n\nFound ${cids.size} unique CIDs to re-pin.`);

  let ok = 0, fail = 0;
  const cidArr = [...cids.entries()];
  for (let i = 0; i < cidArr.length; i++) {
    const [cid, filename] = cidArr[i];
    process.stdout.write(`\r[${i + 1}/${cidArr.length}] Pinning ${cid.slice(0, 16)}...`);
    const success = await repinCid(cid, filename);
    if (success) ok++; else fail++;
    // Rate limit: ~10 req/s
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`\n\nDone. ✅ ${ok} pinned, ❌ ${fail} failed.`);
}

main().catch(console.error);
