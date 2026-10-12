/**
 * Private chat (MagicBlock TEE) — INBOX model.
 *
 * Messages append to a delegated PrivateInbox ring-buffer (mutating a delegated
 * account works in the ER; creating a new account per message does NOT). Content
 * is still yours to encrypt; the TEE permission restricts read/write to the 2
 * members.
 *
 * Base-layer legs (treasury-sponsored via /api/build-tx):
 *   createPrivateInbox → delegatePrivateInbox   (see ShyftClient.enablePrivateInbox)
 * ER legs (this module): initInboxPermission, appendPrivateMessage, readInbox.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, BN, Idl } from "@coral-xyz/anchor";
import {
  PERMISSION_PROGRAM_ID, MAGIC_PROGRAM_ID, EPHEMERAL_VAULT_ID,
  permissionPdaFromAccount, getAuthToken,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import idl from "@/lib/idl.json";

const PROGRAM_ID = new PublicKey("EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ");
const INBOX_SEED = Buffer.from("inbox");
export const TEE_RPC = "https://mainnet-tee.magicblock.app";
const FULL_MEMBER_FLAGS = 15;

function u64le(n: number): Buffer { return new BN(n).toArrayLike(Buffer, "le", 8); }
export function getInboxPda(chatId: number): PublicKey {
  return PublicKey.findProgramAddressSync([INBOX_SEED, u64le(chatId)], PROGRAM_ID)[0];
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
export async function getTeeToken(publicKey: PublicKey, signMessage: (m: Uint8Array) => Promise<Uint8Array>): Promise<string> {
  const k = publicKey.toBase58();
  const c = tokenCache.get(k);
  if (c && c.expiresAt > Date.now() + 30_000) return c.token;
  const res = await getAuthToken(TEE_RPC, publicKey, signMessage);
  tokenCache.set(k, res);
  return res.token;
}

function erProgram(token: string, wallet: any): Program {
  const conn = new Connection(`${TEE_RPC}?token=${token}`, { commitment: "confirmed" });
  return new Program(idl as Idl, new AnchorProvider(conn, wallet, { commitment: "confirmed", skipPreflight: true }));
}

/** (ER) Create the inbox permission — members-only = private. Call after delegate confirms. */
export async function initInboxPermission(
  chatId: number, members: PublicKey[],
  wallet: { publicKey: PublicKey; signTransaction: (tx: any) => Promise<any> },
  signMessage: (m: Uint8Array) => Promise<Uint8Array>
): Promise<string> {
  const token = await getTeeToken(wallet.publicKey, signMessage);
  const program = erProgram(token, wallet);
  const inbox = getInboxPda(chatId);
  return program.methods
    .initInboxPermission(new BN(chatId), members.map((pubkey) => ({ flags: FULL_MEMBER_FLAGS, pubkey })))
    .accounts({
      authority: wallet.publicKey, inbox, permission: permissionPdaFromAccount(inbox),
      permissionProgram: PERMISSION_PROGRAM_ID, ephemeralVault: EPHEMERAL_VAULT_ID, magicProgram: MAGIC_PROGRAM_ID,
    }).rpc();
}

/** (ER) Append a message inside the TEE. Content should already be E2E-encrypted if desired. */
export async function appendPrivateMessage(
  chatId: number, content: string,
  wallet: { publicKey: PublicKey; signTransaction: (tx: any) => Promise<any> },
  signMessage: (m: Uint8Array) => Promise<Uint8Array>
): Promise<string> {
  const token = await getTeeToken(wallet.publicKey, signMessage);
  const program = erProgram(token, wallet);
  return program.methods
    .appendPrivateMessage(new BN(chatId), content)
    .accounts({ inbox: getInboxPda(chatId), sender: wallet.publicKey }).rpc();
}

const MAGIC_PROGRAM_ID_PK = new PublicKey("Magic11111111111111111111111111111111111111");
const MAGIC_CONTEXT_ID = new PublicKey("MagicContext1111111111111111111111111111111");

/** (ER) Undelegate the inbox — commits final state + returns the account to the
 *  base chain so it can be closed. Signed by a member (the logged-in user). */
export async function undelegateInbox(
  chatId: number,
  wallet: { publicKey: PublicKey; signTransaction: (tx: any) => Promise<any> },
  signMessage: (m: Uint8Array) => Promise<Uint8Array>
): Promise<string> {
  const token = await getTeeToken(wallet.publicKey, signMessage);
  const program = erProgram(token, wallet);
  return program.methods
    .undelegatePrivateInbox()
    .accounts({
      payer: wallet.publicKey, inbox: getInboxPda(chatId),
      magicProgram: MAGIC_PROGRAM_ID_PK, magicContext: MAGIC_CONTEXT_ID,
    }).rpc();
}

/** Poll the base chain until the inbox is owned by our program again (undelegation
 *  landed) — up to ~40s. Returns true once ownership is back. */
export async function waitForUndelegation(chatId: number, baseConn: Connection): Promise<boolean> {
  const inbox = getInboxPda(chatId);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const info = await baseConn.getAccountInfo(inbox);
    if (info && info.owner.equals(PROGRAM_ID)) return true;
    if (!info) return true; // already gone
  }
  return false;
}

export type PrivateMsg = { sender: string; content: string; timestamp: string };

/** (ER) Read the whole inbox in ONE account fetch (no rate-limit loop). */
export async function readInbox(
  chatId: number, publicKey: PublicKey, signMessage: (m: Uint8Array) => Promise<Uint8Array>
): Promise<PrivateMsg[]> {
  const token = await getTeeToken(publicKey, signMessage);
  const conn = new Connection(`${TEE_RPC}?token=${token}`, { commitment: "confirmed" });
  const program = new Program(idl as Idl, new AnchorProvider(conn, { publicKey } as any, { commitment: "confirmed" }));
  try {
    const acct: any = await (program.account as any).privateInbox.fetch(getInboxPda(chatId));
    return (acct.messages || []).map((m: any) => ({ sender: m.sender.toBase58(), content: m.content, timestamp: m.ts.toString() }));
  } catch {
    return [];
  }
}

