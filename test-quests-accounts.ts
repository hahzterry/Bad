import { Connection, Keypair } from "@solana/web3.js";
import { Program, AnchorProvider, Idl, Wallet } from "@coral-xyz/anchor";
import idl from "./src/lib/idl.json";

const conn = new Connection("https://www.shyft.lol/api/rpc", { commitment: "confirmed", httpHeaders: { Origin: "https://www.shyft.lol", Referer: "https://www.shyft.lol/" } });
const dummy = Keypair.generate();
const wallet: Wallet = {
  publicKey: dummy.publicKey,
  signTransaction: async (tx: any) => tx,
  signAllTransactions: async (txs: any) => txs,
  payer: dummy,
};
const program = new Program(idl as Idl, new AnchorProvider(conn, wallet, { commitment: "confirmed" }));
const accounts: any = program.account;

async function main() {
  for (const name of ["post", "comment", "likeRecord", "reaction", "followAccount", "pollVote", "membership", "profile"]) {
    try {
      const all = await accounts[name].all();
      const sample = all[0]?.account;
      const fields = sample ? Object.keys(sample).join(",") : "(no accounts yet)";
      console.log(`${name}: ${all.length} — ${fields}`);
    } catch (e: any) {
      console.log(`${name}: ERROR ${e.message?.slice(0, 80)}`);
    }
  }
}
main();
