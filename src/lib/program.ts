import { Program, AnchorProvider, Idl, BorshCoder } from "@coral-xyz/anchor";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import idl from "./idl.json";
import { pollConfirmation } from "@/hooks/usePrivyWallet";
import {
  encryptMessage as naclEncrypt,
  decryptMessage as naclDecrypt,
  formatPubkeyMessage,
  parsePubkeyMessage,
  isEncryptedMessage,
  isPubkeyMessage,
} from "./encryption";
import { checkUsername } from "./reserved-usernames";

const PROGRAM_ID = new PublicKey("EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ");

// ========== IPFS URL Helpers ==========
// On-chain fields are limited to 128 bytes. Full IPFS URLs can be 130+ chars.
// We store only the CID on-chain and reconstruct the full URL client-side.
// Use the dedicated Pinata gateway (paid, no shared rate limits). The shared
// gateway.pinata.cloud is aggressively rate-limited (429s) so media fails to
// load for some users under load.
const IPFS_GATEWAY =
  process.env.NEXT_PUBLIC_PINATA_GATEWAY || "amethyst-secondary-orca-737.mypinata.cloud";
const IPFS_CID_REGEX = /\/ipfs\/([a-zA-Z0-9]+)(\/[^?#]*)?(\?.*)?$/;

/** Strip a full IPFS URL down to just the CID (for on-chain storage). */
function compressIpfsUrl(url: string): string {
  if (!url) return url;
  const match = url.match(IPFS_CID_REGEX);
  if (match) return match[1]; // just the CID
  return url; // not an IPFS URL — store as-is
}

/** Expand a bare CID back to a full IPFS gateway URL. */
function expandIpfsUrl(stored: string): string {
  if (!stored) return stored;
  // Already a full URL — rewrite all gateways to ipfs.io
  if (stored.startsWith("http")) {
    const cidMatch = stored.match(IPFS_CID_REGEX);
    if (cidMatch) {
      const cid = cidMatch[1];
      const path = cidMatch[2] || "";
      return `https://${IPFS_GATEWAY}/ipfs/${cid}${path}`;
    }
    return stored;
  }
  // Looks like a bare CID (bafkrei... or Qm...)
  if (stored.startsWith("baf") || stored.startsWith("Qm")) {
    return `https://${IPFS_GATEWAY}/ipfs/${stored}`;
  }
  return stored;
}

const PROFILE_SEED = Buffer.from("profile");
const POST_SEED = Buffer.from("post");
const USERNAME_SEED = Buffer.from("username");
const LISTING_SEED = Buffer.from("listing");
const CHAT_SEED = Buffer.from("chat");
const MESSAGE_SEED = Buffer.from("message");
const FOLLOW_SEED = Buffer.from("follow");
const COMMENT_SEED = Buffer.from("comment");
const REACTION_SEED = Buffer.from("reaction");
const COMMUNITY_SEED = Buffer.from("community");
const MEMBERSHIP_SEED = Buffer.from("membership");
const POLL_SEED = Buffer.from("poll");
const POLL_VOTE_SEED = Buffer.from("poll_vote");

// ========== Simple In-Memory Cache ==========

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

class RpcCache {
  private cache = new Map<string, CacheEntry<any>>();
  private defaultTTL: number; // ms

  constructor(ttlMs = 30_000) {
    this.defaultTTL = ttlMs;
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + (ttlMs ?? this.defaultTTL),
    });
  }

  invalidate(keyPrefix?: string): void {
    if (!keyPrefix) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(keyPrefix)) this.cache.delete(key);
    }
  }
}

/** Shared cache — 10s TTL. Cleared on write operations. */
const rpcCache = new RpcCache(10_000);

/** Clear all cached RPC data (call after tab switch, refresh, etc.) */
export function clearRpcCache(): void {
  rpcCache.invalidate();
}

// ========== Treasury Sponsorship ==========

/** Cached treasury public key (fetched once from /api/build-tx) */
let _treasuryPubkey: PublicKey | null = null;

/** Get the platform treasury public key (fee payer for sponsored txs) */
export async function getTreasuryPubkey(): Promise<PublicKey> {
  if (_treasuryPubkey) return _treasuryPubkey;
  const res = await fetch("/api/build-tx");
  const data = await res.json();
  if (!data.treasuryPubkey) throw new Error("Could not fetch treasury pubkey");
  _treasuryPubkey = new PublicKey(data.treasuryPubkey);
  return _treasuryPubkey;
}

/**
 * Server-build-tx pattern:
 * 1. Client sends action name + params to /api/build-tx
 * 2. Server builds the ENTIRE instruction, sets blockhash, treasury signs
 * 3. Client deserializes, user co-signs, sends directly to Solana
 *
 * The client NEVER builds instructions — only the server does.
 * Treasury signature locks the exact bytes — any tampering invalidates the tx.
 */
export async function requestServerTx(
  action: string,
  params: Record<string, any>,
  wallet: { signTransaction(tx: Transaction): Promise<Transaction>; publicKey: PublicKey },
  connection: Connection
): Promise<string> {
  const walletAddress = wallet.publicKey.toBase58();
  if (BATCHABLE_ACTIONS.has(action)) {
    return enqueueBatchedSocialTx(action, params, walletAddress, wallet, connection);
  }
  return buildSignAndSendTx({ action, params, walletAddress }, wallet, connection, action);
}

const BATCHABLE_ACTIONS = new Set(["likePost", "reactToPost", "followUser", "unfollowUser"]);
const SOCIAL_BATCH_WINDOW_MS = 600;
const SOCIAL_BATCH_MAX_ACTIONS = 4;

type PendingSocialItem = {
  action: string;
  params: Record<string, any>;
  resolve: (signature: string) => void;
  reject: (error: Error) => void;
};

type PendingSocialBatch = {
  walletAddress: string;
  wallet: { signTransaction(tx: Transaction): Promise<Transaction>; publicKey: PublicKey };
  connection: Connection;
  items: PendingSocialItem[];
  timer: ReturnType<typeof setTimeout> | null;
};

const pendingSocialBatches = new Map<string, PendingSocialBatch>();

async function buildSignAndSendTx(
  payload: Record<string, any>,
  wallet: { signTransaction(tx: Transaction): Promise<Transaction>; publicKey: PublicKey },
  connection: Connection,
  debugLabel: string
): Promise<string> {
  const walletAddress = wallet.publicKey.toBase58();
  console.log(`📋 build-tx: action="${debugLabel}" wallet=${walletAddress.slice(0, 8)}..`);

  const res = await fetch("/api/build-tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.success) {
    console.error(`❌ build-tx failed for "${debugLabel}":`, data.error);
    throw new Error(data.error || "Build transaction failed");
  }

  const treasurySigned = Transaction.from(Buffer.from(data.transaction, "base64"));
  const fullySigned = await wallet.signTransaction(treasurySigned);
  const sig = await connection.sendRawTransaction(fullySigned.serialize());
  console.log(`✅ "${debugLabel}" sent to Solana:`, sig.slice(0, 16) + "...");
  return sig;
}

function enqueueBatchedSocialTx(
  action: string,
  params: Record<string, any>,
  walletAddress: string,
  wallet: { signTransaction(tx: Transaction): Promise<Transaction>; publicKey: PublicKey },
  connection: Connection
): Promise<string> {
  return new Promise((resolve, reject) => {
    let batch = pendingSocialBatches.get(walletAddress);
    if (!batch) {
      batch = {
        walletAddress,
        wallet,
        connection,
        items: [],
        timer: null,
      };
      pendingSocialBatches.set(walletAddress, batch);
    }

    batch.items.push({ action, params, resolve, reject });

    if (batch.items.length >= SOCIAL_BATCH_MAX_ACTIONS) {
      if (batch.timer) {
        clearTimeout(batch.timer);
        batch.timer = null;
      }
      void flushBatchedSocialTx(walletAddress);
      return;
    }

    if (!batch.timer) {
      batch.timer = setTimeout(() => {
        void flushBatchedSocialTx(walletAddress);
      }, SOCIAL_BATCH_WINDOW_MS);
    }
  });
}

async function flushBatchedSocialTx(walletAddress: string): Promise<void> {
  const batch = pendingSocialBatches.get(walletAddress);
  if (!batch) return;

  pendingSocialBatches.delete(walletAddress);
  if (batch.timer) {
    clearTimeout(batch.timer);
    batch.timer = null;
  }

  const items = batch.items;
  if (items.length === 0) return;

  try {
    const signature = items.length === 1
      ? await buildSignAndSendTx(
          { action: items[0].action, params: items[0].params, walletAddress },
          batch.wallet,
          batch.connection,
          items[0].action
        )
      : await buildSignAndSendTx(
          {
            walletAddress,
            actions: items.map((item) => ({ action: item.action, params: item.params })),
          },
          batch.wallet,
          batch.connection,
          `batch:${items.map((item) => item.action).join(",")}`
        );

    for (const item of items) item.resolve(signature);
  } catch (err: any) {
    const error = err instanceof Error ? err : new Error(err?.message || "Batched transaction failed");
    for (const item of items) item.reject(error);
  }
}

// ========== Helpers ==========

/** Convert u64 to little-endian 8 bytes (matches Rust's to_le_bytes()) */
function toLEBytes(num: number): Uint8Array {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  // Write as little-endian u64
  view.setBigUint64(0, BigInt(num), true);
  return new Uint8Array(buffer);
}

/** Browser-safe u64 to big-endian 8 bytes (alternative encoding) */
function toBEBytes(num: number): Uint8Array {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  // Write as big-endian u64
  view.setBigUint64(0, BigInt(num), false);
  return new Uint8Array(buffer);
}

// ========== PDA Derivation Helpers ==========

function getProfilePda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PROFILE_SEED, owner.toBuffer()], PROGRAM_ID);
}
function getUsernamePda(name: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([USERNAME_SEED, Buffer.from(name)], PROGRAM_ID);
}
function getListingPda(name: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([LISTING_SEED, Buffer.from(name)], PROGRAM_ID);
}

function getPostPda(author: PublicKey, postId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([POST_SEED, author.toBuffer(), toLEBytes(postId)], PROGRAM_ID);
}

function getChatPda(chatId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CHAT_SEED, toLEBytes(chatId)], PROGRAM_ID);
}

function getMessagePda(chatId: number, messageIndex: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([MESSAGE_SEED, toLEBytes(chatId), toLEBytes(messageIndex)], PROGRAM_ID);
}

function getFollowPda(follower: PublicKey, following: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([FOLLOW_SEED, follower.toBuffer(), following.toBuffer()], PROGRAM_ID);
}

function getCommentPda(postPda: PublicKey, commentIndex: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([COMMENT_SEED, postPda.toBuffer(), toLEBytes(commentIndex)], PROGRAM_ID);
}

function getReactionPda(postPda: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([REACTION_SEED, postPda.toBuffer(), user.toBuffer()], PROGRAM_ID);
}

function getCommunityPda(communityId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([COMMUNITY_SEED, toLEBytes(communityId)], PROGRAM_ID);
}

function getMembershipPda(communityPda: PublicKey, member: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([MEMBERSHIP_SEED, communityPda.toBuffer(), member.toBuffer()], PROGRAM_ID);
}

function getPollPda(creator: PublicKey, pollId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([POLL_SEED, creator.toBuffer(), toLEBytes(pollId)], PROGRAM_ID);
}

function getPollVotePda(pollPda: PublicKey, voter: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([POLL_VOTE_SEED, pollPda.toBuffer(), voter.toBuffer()], PROGRAM_ID);
}

export class ShyftClient {
  program: Program;
  provider: AnchorProvider;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.program = new Program(idl as Idl, provider);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get accounts(): any {
    return this.program.account;
  }

  // ========== PROFILE ==========

  async createProfile(username: string, displayName: string, bio: string, inviteCode?: string): Promise<string> {
    const user = this.provider.wallet.publicKey;
    const [profilePda] = getProfilePda(user);

    // Block reserved/squatted usernames
    const reserved = checkUsername(username, inviteCode);
    if (reserved.blocked) {
      throw new Error(reserved.reason || "This username is reserved");
    }

    // Try to migrate first if existing profile is undersized
    try {
      const acctInfo = await this.provider.connection.getAccountInfo(profilePda);
      if (acctInfo && acctInfo.data.length < 8 + 307) {
        // Account exists but is too small for new schema — migrate it
        console.log("🔄 Existing profile needs migration, resizing...");
        await this.migrateProfile();
        console.log("✅ Profile migrated to new schema");
        return "migrated";
      }
    } catch (e) {
      // ignore — account may not exist yet
    }

    // Two on-chain steps (the program no longer lets create_profile set a name
    // directly — that was the impersonation hole). First create the profile
    // nameless, then claim the username through the registry, which enforces
    // uniqueness. Callers pass the username exactly as before; this hides the
    // split.
    const sig = await requestServerTx("createProfile", { displayName, bio }, this.provider.wallet, this.provider.connection);
    if (username && username.trim()) {
      // CRITICAL: requestServerTx returns after SENDING, not confirming. The
      // claim needs the profile account to already exist on-chain, so wait for
      // it to actually land before claiming — otherwise the claim races the
      // creation and fails with AccountNotInitialized.
      const [profilePda2] = getProfilePda(user);
      let exists = false;
      for (let i = 0; i < 30; i++) {
        const info = await this.provider.connection.getAccountInfo(profilePda2, "confirmed");
        if (info) { exists = true; break; }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!exists) throw new Error("Profile is still confirming — try claiming your name again in a moment.");
      try {
        await this.claimUsername(username.trim());
      } catch (e: any) {
        // Profile exists but the name didn't stick (e.g. taken in the moment).
        // Surface it so the user can pick another — they aren't blocked from
        // claiming later.
        throw new Error(`Profile created, but @${username.trim()} could not be claimed: ${e?.message || e}. Pick another name.`);
      }
    }
    return sig;
  }

  async migrateProfile(): Promise<string> {
    const sig = await requestServerTx("migrateProfile", {}, this.provider.wallet, this.provider.connection);
    return sig;
  }

  // ── USERNAMES / MARKETPLACE ──

  /** Claim a fresh username (registry-enforced uniqueness). Also displays it. */
  async claimUsername(name: string): Promise<string> {
    const lower = name.trim().toLowerCase().replace(/[^a-z0-9_]/g,"");
    const reserved = checkUsername(lower);
    if (reserved.blocked) throw new Error(reserved.reason || "This username is reserved");
    return requestServerTx("claimUsername", { name: lower }, this.provider.wallet, this.provider.connection);
  }

  /** Switch your displayed name to another one you own. */
  async setDisplayUsername(name: string): Promise<string> {
    return requestServerTx("setDisplayUsername", { name: name.trim().toLowerCase().replace(/[^a-z0-9_]/g,"") }, this.provider.wallet, this.provider.connection);
  }

  /** List a name for sale. `price` is whole $SHYFT (converted to 6-dp base units). */
  async listUsername(name: string, priceShyft: number): Promise<string> {
    const base = Math.round(priceShyft * 1_000_000).toString();
    return requestServerTx("listUsername", { name: name.trim().toLowerCase().replace(/[^a-z0-9_]/g,""), price: base }, this.provider.wallet, this.provider.connection);
  }

  async updatePrice(name: string, priceShyft: number): Promise<string> {
    const base = Math.round(priceShyft * 1_000_000).toString();
    return requestServerTx("updatePrice", { name: name.trim().toLowerCase().replace(/[^a-z0-9_]/g,""), price: base }, this.provider.wallet, this.provider.connection);
  }

  async delistUsername(name: string): Promise<string> {
    return requestServerTx("delistUsername", { name: name.trim().toLowerCase().replace(/[^a-z0-9_]/g,"") }, this.provider.wallet, this.provider.connection);
  }

  async buyUsername(name: string): Promise<string> {
    return requestServerTx("buyUsername", { name: name.trim().toLowerCase().replace(/[^a-z0-9_]/g,"") }, this.provider.wallet, this.provider.connection);
  }

  /** Fetch a username record (owner, transfer count) or null if unclaimed. */
  async getUsernameRecord(name: string): Promise<any | null> {
    const [pda] = getUsernamePda(name.trim().toLowerCase().replace(/[^a-z0-9_]/g,""));
    try { return await (this.program.account as any).usernameRecord.fetch(pda); }
    catch { return null; }
  }

  /** All open marketplace listings. */
  async getListings(): Promise<{ name: string; seller: string; priceShyft: number; createdAt: number }[]> {
    const all = await (this.program.account as any).listing.all();
    return all.map((l: any) => ({
      name: l.account.name,
      seller: l.account.seller.toBase58(),
      priceShyft: Number(l.account.price) / 1_000_000,
      createdAt: Number(l.account.createdAt),
    }));
  }

  async getProfile(owner: PublicKey): Promise<any> {
    const [profilePda] = getProfilePda(owner);
    try {
      const profile = await this.accounts.profile.fetch(profilePda);
      // Expand bare CIDs back to full IPFS gateway URLs
      if (profile) {
        profile.avatarUrl = expandIpfsUrl(profile.avatarUrl || "");
        profile.bannerUrl = expandIpfsUrl(profile.bannerUrl || "");
      }
      return profile;
    } catch (err: any) {
      // Check if account exists but can't be deserialized (size mismatch)
      try {
        const acctInfo = await this.provider.connection.getAccountInfo(profilePda);
        if (acctInfo && acctInfo.data.length > 0) {
          // If this is OUR profile, auto-migrate
          const wallet = this.provider.wallet.publicKey;
          if (wallet && owner.equals(wallet)) {
            console.log("🔄 Profile account exists but schema mismatch — auto-migrating...");
            await this.migrateProfile();
            return await this.accounts.profile.fetch(profilePda);
          }
          console.warn("⚠️ Profile for", owner.toBase58().slice(0, 8), "needs migration (old schema)");
          return null;
        }
      } catch {
        // Account truly doesn't exist
      }
      return null;
    }
  }

  /** Check if a username is already taken by any profile on-chain */
  async isUsernameTaken(username: string, excludeOwner?: PublicKey): Promise<boolean> {
    const profiles = await this.getAllProfiles();
    const lower = username.toLowerCase();
    return profiles.some(
      (p: any) =>
        p.username?.toLowerCase() === lower &&
        (!excludeOwner || p.owner !== excludeOwner.toBase58())
    );
  }

  async updateProfile(displayName: string, bio: string, avatarUrl: string, bannerUrl: string, websiteUrl: string = ""): Promise<string> {
    const user = this.provider.wallet.publicKey;
    const [profilePda] = getProfilePda(user);

    // Auto-migrate profile if account is undersized (e.g. new fields added)
    try {
      const acctInfo = await this.provider.connection.getAccountInfo(profilePda);
      const expectedSize = 8 + 32 + (4+16) + (4+24) + (4+64) + 1 + 4 + 4 + 4 + 2 + 8 + (4+128) + (4+128) + (4+64); // 8 + Profile::LEN
      if (acctInfo && acctInfo.data.length < expectedSize) {
        console.log(`Profile account undersized (${acctInfo.data.length} < ${expectedSize}), migrating...`);
        await this.migrateProfile();
      }
    } catch (e) {
      console.warn("Migration check failed, continuing:", e);
    }

    // Compress IPFS URLs to bare CIDs for on-chain storage (128 byte limit)
    const compressedAvatar = compressIpfsUrl(avatarUrl);
    const compressedBanner = compressIpfsUrl(bannerUrl);

    const sig = await requestServerTx("updateProfile", { displayName, bio, avatarUrl: compressedAvatar, bannerUrl: compressedBanner, websiteUrl }, this.provider.wallet, this.provider.connection);

    rpcCache.invalidate("profile_" + user.toBase58());
    return sig;
  }

  // ========== POSTS ==========

  async createPost(postId: number, content: string, isPrivate: boolean): Promise<string> {
    const wallet = this.provider.wallet.publicKey;
    if (!wallet) {
      throw new Error("Wallet not connected - no public key available");
    }

    console.log("=== Creating Post ===");
    console.log("Author:", wallet.toBase58());
    console.log("Post ID:", postId);

    try {
      const sig = await requestServerTx("createPost", { postId, content, isPrivate }, this.provider.wallet, this.provider.connection);

      console.log("Post created (treasury sponsored):", sig);
      rpcCache.invalidate("allPosts");
      return sig;
    } catch (err: any) {
      console.error("Create post error:", err);
      throw err;
    }
  }

  async getPost(author: PublicKey, postId: number): Promise<any> {
    const [postPda] = getPostPda(author, postId);
    try {
      return await this.accounts.post.fetch(postPda);
    } catch {
      return null;
    }
  }

  async editPost(postId: number, content: string): Promise<string> {
    const wallet = this.provider.wallet.publicKey;
    if (!wallet) throw new Error("Wallet not connected");
    try {
      const sig = await requestServerTx("editPost", { postId, content }, this.provider.wallet, this.provider.connection);
      rpcCache.invalidate("allPosts");
      return sig;
    } catch (err: any) {
      console.error("Edit post error:", err);
      throw err;
    }
  }

  async deletePost(postId: number): Promise<string> {
    const wallet = this.provider.wallet.publicKey;
    if (!wallet) throw new Error("Wallet not connected");

    console.log("=== Deleting Post ===");
    console.log("Author:", wallet.toBase58());
    console.log("Post ID:", postId);

    try {
      const sig = await requestServerTx("closePost", { postId }, this.provider.wallet, this.provider.connection);

      console.log("Post deleted (rent refunded to treasury on-chain):", sig);
      rpcCache.invalidate("allPosts");
      return sig;
    } catch (err: any) {
      console.error("Delete post error:", err);
      throw err;
    }
  }

  async getAllPublicPosts(): Promise<any[]> {
    try {
      const allPosts = await this.accounts.post.all();
      return allPosts
        .map((p: any) => ({
          publicKey: p.publicKey.toBase58(),
          ...p.account,
          author: p.account.author.toBase58(),
          postId: p.account.postId?.toString(),
          likes: p.account.likes?.toString() || "0",
          commentCount: p.account.commentCount?.toString() || "0",
          createdAt: p.account.createdAt?.toString() || "0",
        }))
        .filter((p: any) => !p.isPrivate)
        .sort((a: any, b: any) => Number(b.createdAt) - Number(a.createdAt));
    } catch {
      return [];
    }
  }

  async getPostsByAuthor(author: PublicKey): Promise<any[]> {
    try {
      const allPosts = await this.accounts.post.all();
      const authorStr = author.toBase58();
      return allPosts
        .map((p: any) => ({
          publicKey: p.publicKey.toBase58(),
          ...p.account,
          author: p.account.author.toBase58(),
          postId: p.account.postId?.toString(),
          likes: p.account.likes?.toString() || "0",
          commentCount: p.account.commentCount?.toString() || "0",
          createdAt: p.account.createdAt?.toString() || "0",
        }))
        .filter((p: any) => p.author === authorStr)
        .sort((a: any, b: any) => Number(b.createdAt) - Number(a.createdAt));
    } catch {
      return [];
    }
  }

  /** Fetch ALL posts from on-chain */
  async getAllPosts(): Promise<{ publicKey: string; author: string; postId: string; content: string; isPrivate: boolean; likes: string; commentCount: string; createdAt: string }[]> {
    const cacheKey = "allPosts";
    const cached = rpcCache.get<any[]>(cacheKey);
    if (cached) return cached;

    const regularPosts = await this.accounts.post.all();
    const mapped = regularPosts.map((p: any) => ({
      publicKey: p.publicKey.toBase58(),
      author: p.account.author.toBase58(),
      postId: p.account.postId?.toString() || "0",
      content: p.account.content || "",
      isPrivate: p.account.isPrivate,
      likes: p.account.likes?.toString() || "0",
      commentCount: p.account.commentCount?.toString() || "0",
      createdAt: p.account.createdAt?.toString() || "0",
    }));

    rpcCache.set(cacheKey, mapped);
    return mapped;
  }

  async getAllProfiles(): Promise<any[]> {
    const cacheKey = "allProfiles";
    const cached = rpcCache.get<any[]>(cacheKey);
    if (cached) return cached;

    try {
      // Fetch all profiles
      let result: any[] = [];
      try {
        const allProfiles = await this.accounts.profile.all();
        result = allProfiles.map((p: any) => ({
          publicKey: p.publicKey.toBase58(),
          ...p.account,
          owner: p.account.owner.toBase58(),
          avatarUrl: expandIpfsUrl(p.account.avatarUrl || ""),
          bannerUrl: expandIpfsUrl(p.account.bannerUrl || ""),
        }));
      } catch {
        console.warn("⚠️ getAllProfiles via Anchor failed, using raw fetch");
      }

      rpcCache.set(cacheKey, result);
      return result;
    } catch {
      return [];
    }
  }

  async likePost(author: PublicKey, postId: number): Promise<string> {
    const sig = await requestServerTx("likePost", { author: author.toBase58(), postId }, this.provider.wallet, this.provider.connection);
    rpcCache.invalidate("allReactions");
    const userWallet = this.provider.wallet.publicKey;
    if (userWallet) rpcCache.invalidate(`likedBy_${userWallet.toBase58()}`);
    return sig;
  }

  async getLikedPostsByUser(userWallet: PublicKey): Promise<string[]> {
    const cacheKey = `likedBy_${userWallet.toBase58()}`;
    const cached = rpcCache.get<string[]>(cacheKey);
    if (cached) return cached;
    try {
      const all = await this.accounts.likeRecord.all([
        { memcmp: { offset: 8 + 32, bytes: userWallet.toBase58() } }
      ]);
      const result = all.map((r: any) => r.account.post.toBase58());
      rpcCache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.error("getLikedPostsByUser error:", err);
      return [];
    }
  }

  async createComment(author: PublicKey, postId: number, commentIndex: number, content: string): Promise<string> {
    const sig = await requestServerTx("createComment", { author: author.toBase58(), postId, commentIndex, content }, this.provider.wallet, this.provider.connection);
    rpcCache.invalidate("allComments");
    rpcCache.invalidate("allPosts");
    return sig;
  }

  async deleteComment(postAuthor: PublicKey, postId: number, commentIndex: number): Promise<string> {
    const sig = await requestServerTx("closeComment", { postAuthor: postAuthor.toBase58(), postId, commentIndex }, this.provider.wallet, this.provider.connection);
    console.log("Comment deleted (rent refunded to treasury on-chain):", sig);
    rpcCache.invalidate("allComments");
    rpcCache.invalidate("allPosts");
    return sig;
  }

  async getAllComments(): Promise<{ publicKey: string; post: string; author: string; commentIndex: string; content: string; createdAt: string }[]> {
    const cacheKey = "allComments";
    const cached = rpcCache.get<any[]>(cacheKey);
    if (cached) return cached;

    try {
      const allComments = await this.accounts.comment.all();
      const result = allComments.map((c: any) => ({
        publicKey: c.publicKey.toBase58(),
        post: c.account.post.toBase58(),
        author: c.account.author.toBase58(),
        commentIndex: c.account.commentIndex?.toString() || "0",
        content: c.account.content || "",
        createdAt: c.account.createdAt?.toString() || "0",
      }));
      rpcCache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.error("getAllComments error:", err);
      return [];
    }
  }

  async getCommentsForPost(postPublicKey: string): Promise<{ publicKey: string; post: string; author: string; commentIndex: string; content: string; createdAt: string }[]> {
    const all = await this.getAllComments();
    return all
      .filter((c) => c.post === postPublicKey)
      .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  }

  // ========== REACTIONS ==========

  async reactToPost(author: PublicKey, postId: number, reactionType: number): Promise<string> {
    const sig = await requestServerTx("reactToPost", { author: author.toBase58(), postId, reactionType }, this.provider.wallet, this.provider.connection);
    rpcCache.invalidate("allReactions");
    return sig;
  }

  async removeReaction(author: PublicKey, postId: number): Promise<string> {
    const sig = await requestServerTx("closeReaction", { author: author.toBase58(), postId }, this.provider.wallet, this.provider.connection);
    console.log("Reaction removed (rent refunded to treasury on-chain):", sig);
    rpcCache.invalidate("allReactions");
    return sig;
  }

  async getAllReactions(): Promise<{ publicKey: string; post: string; user: string; reactionType: number }[]> {
    const cacheKey = "allReactions";
    const cached = rpcCache.get<any[]>(cacheKey);
    if (cached) return cached;

    try {
      const allReactions = await this.accounts.reaction.all();
      const result = allReactions.map((r: any) => ({
        publicKey: r.publicKey.toBase58(),
        post: r.account.post.toBase58(),
        user: r.account.user.toBase58(),
        reactionType: r.account.reactionType,
      }));
      rpcCache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.error("getAllReactions error:", err);
      return [];
    }
  }

  async getReactionsForPost(postPublicKey: string): Promise<{ publicKey: string; post: string; user: string; reactionType: number }[]> {
    const all = await this.getAllReactions();
    return all.filter((r) => r.post === postPublicKey);
  }

  // ========== CHAT ==========

  async createChat(chatId: number, user2: PublicKey): Promise<string> {
    const sig = await requestServerTx("createChat", { chatId, user2: user2.toBase58() }, this.provider.wallet, this.provider.connection);
    return sig;
  }

  /**
   * Make an existing chat PRIVATE (MagicBlock TEE) — base-layer legs only.
   * Runs fund_chat_permission then delegate_chat_private (both treasury-sponsored).
   * After this confirms, call initChatPermission() (see src/lib/privateChat.ts)
   * to lock read/write to the two members on the ER.
   */
  async enablePrivateInbox(chatId: number): Promise<{ createSig: string; delegateSig: string }> {
    const createSig = await requestServerTx("createPrivateInbox", { chatId }, this.provider.wallet, this.provider.connection);
    const delegateSig = await requestServerTx("delegatePrivateInbox", { chatId }, this.provider.wallet, this.provider.connection);
    return { createSig, delegateSig };
  }

  /** Bring a private inbox's state back to Solana (treasury-sponsored). */
  async undelegatePrivateInbox(chatId: number): Promise<string> {
    return requestServerTx("undelegatePrivateInbox", { chatId }, this.provider.wallet, this.provider.connection);
  }

  /**
   * Delete a private (MagicBlock TEE) chat and refund its rent to the treasury.
   * Two steps: undelegate (ER-side, member-signed) → wait for base-layer return →
   * close (treasury-sponsored). Pass teeSign (wallet.signMessage) for the TEE auth.
   */
  async deletePrivateChat(
    chatId: number,
    teeSign: (m: Uint8Array) => Promise<Uint8Array>,
    onStep?: (s: string) => void
  ): Promise<{ closeSig: string }> {
    const { undelegateInbox, waitForUndelegation } = await import("@/lib/privateChat");
    onStep?.("Undelegating from the TEE…");
    await undelegateInbox(chatId, this.provider.wallet as any, teeSign);
    onStep?.("Returning to Solana…");
    const back = await waitForUndelegation(chatId, this.provider.connection);
    if (!back) throw new Error("Undelegation didn't land in time — try delete again in a moment");
    onStep?.("Closing & refunding rent…");
    const closeSig = await requestServerTx("closePrivateInbox", { chatId }, this.provider.wallet, this.provider.connection);
    return { closeSig };
  }

  async sendMessage(
    chatId: number,
    messageIndex: number,
    content: string,
    isPayment: boolean = false,
    paymentAmount: number = 0
  ): Promise<string> {
    const sig = await requestServerTx("sendMessage", { chatId, messageIndex, content, isPayment, paymentAmount }, this.provider.wallet, this.provider.connection);
    console.log("✅ Message sent on-chain (treasury sponsored):", sig);

    // Invalidate message caches after sending
    rpcCache.invalidate("messages:");
    rpcCache.invalidate("allMessages");

    return sig;
  }

  async getChat(chatId: number): Promise<any> {
    const [chatPda] = getChatPda(chatId);
    try {
      return await this.accounts.chat.fetch(chatPda);
    } catch {
      return null;
    }
  }

  async getMessage(chatId: number, messageIndex: number): Promise<any> {
    const [messagePda] = getMessagePda(chatId, messageIndex);
    try {
      return await this.accounts.message.fetch(messagePda);
    } catch {
      return null;
    }
  }

  /** Fetch all chats involving the current user. */
  async getAllChatsForUser(friendPubkeys: PublicKey[] = []): Promise<any[]> {
    const cacheKey = "allChatsForUser";
    const cached = rpcCache.get<any[]>(cacheKey);
    if (cached) return cached;

    const coder = new BorshCoder(idl as Idl);
    const user = this.provider.wallet.publicKey;
    const userStr = user.toBase58();

    // 1. Regular chats from our program
    const allChats = await this.accounts.chat.all();
    const mapped: any[] = allChats
      .map((c: any) => ({
        publicKey: c.publicKey.toBase58(),
        chatId: c.account.chatId?.toString() || "0",
        user1: c.account.user1?.toBase58() || "",
        user2: c.account.user2?.toBase58() || "",
        messageCount: Number(c.account.messageCount || 0),
        createdAt: c.account.createdAt?.toString() || "0",
      }))
      .filter((c: any) => c.user1 === userStr || c.user2 === userStr);

    // Deduplicate
    const seen = new Set<string>();
    const result = mapped.filter((c: any) => {
      if (seen.has(c.publicKey)) return false;
      seen.add(c.publicKey);
      return true;
    });
    rpcCache.set(cacheKey, result);
    return result;
  }

  /** Fetch all messages for a specific chat. */
  async getMessagesForChat(chatId: number): Promise<any[]> {
    const cacheKey = `messages:${chatId}`;
    const cached = rpcCache.get<any[]>(cacheKey);
    if (cached) return cached;

    const coder = new BorshCoder(idl as Idl);
    const chatIdStr = chatId.toString();

    // 1. Regular messages — fetch all and filter by chatId in JS
    // Use cached allMessages if available
    const allMessages = await this._getAllMessages();
    const mapped: any[] = allMessages
      .filter((m: any) => m.chatId === chatIdStr);

    // Deduplicate and sort by message index
    const seen = new Set<string>();
    const result = mapped
      .filter((m: any) => {
        if (seen.has(m.publicKey)) return false;
        seen.add(m.publicKey);
        return true;
      })
      .sort((a: any, b: any) => a.messageIndex - b.messageIndex);

    rpcCache.set(cacheKey, result, 15_000); // 15s cache for messages
    return result;
  }

  /** Cached fetch of all message accounts (raw mapped). */
  private async _getAllMessages(): Promise<any[]> {
    const cacheKey = "allMessages";
    const cached = rpcCache.get<any[]>(cacheKey);
    if (cached) return cached;

    try {
      const allMessages = await this.accounts.message.all();
      const mapped = allMessages.map((m: any) => ({
        publicKey: m.publicKey.toBase58(),
        chatId: m.account.chatId?.toString() || "0",
        messageIndex: Number(m.account.messageIndex || 0),
        sender: m.account.sender?.toBase58() || "",
        content: m.account.content || "",
        isPayment: m.account.isPayment || false,
        paymentAmount: Number(m.account.paymentAmount || 0),
        timestamp: m.account.timestamp?.toString() || "0",
      }));
      rpcCache.set(cacheKey, mapped);
      return mapped;
    } catch {
      return [];
    }
  }

  /** Fetch all payment messages across all chats involving the current user. */
  async getAllPaymentsForUser(): Promise<any[]> {
    const coder = new BorshCoder(idl as Idl);
    const user = this.provider.wallet.publicKey;
    const userStr = user.toBase58();

    // 1. Get all chats involving this user
    const allChats = await this.accounts.chat.all();
    const userChats = allChats
      .map((c: any) => ({
        chatId: c.account.chatId?.toString() || "0",
        user1: c.account.user1?.toBase58() || "",
        user2: c.account.user2?.toBase58() || "",
      }))
      .filter((c: any) => c.user1 === userStr || c.user2 === userStr);

    const userChatIds = new Set(userChats.map((c: any) => c.chatId));

    // Build a map of chatId -> other participant
    const chatParticipant: Record<string, string> = {};
    for (const c of userChats) {
      chatParticipant[c.chatId] = c.user1 === userStr ? c.user2 : c.user1;
    }

    const payments: any[] = [];

    // 2. Use cached messages instead of fetching fresh
    const allMessages = await this._getAllMessages();
    for (const m of allMessages) {
      if (!userChatIds.has(m.chatId)) continue;
      if (!m.isPayment) continue;

      const isSent = m.sender === userStr;

      payments.push({
        id: m.publicKey,
        sender: isSent ? "me" : m.sender,
        recipient: isSent ? (chatParticipant[m.chatId] || "") : "me",
        amount: Number(m.paymentAmount || 0) / 1_000_000, // micro-SOL -> SOL
        token: "SOL",
        status: "completed" as const,
        isPrivate: true,
        timestamp: Number(m.timestamp || "0") * 1000,
        content: m.content || "",
      });
    }

    // Sort by timestamp descending (newest first)
    return payments.sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Create a chat (simple wrapper around createChat for backwards compatibility) */
  async createPrivateChatFull(
    chatId: number,
    user2: PublicKey
  ): Promise<{ createSig: string }> {
    const user1 = this.provider.wallet.publicKey;
    if (!user1) throw new Error("Wallet not connected");

    console.log("💬 Creating chat:", chatId, "Between:", user1.toBase58().slice(0, 8), "and", user2.toBase58().slice(0, 8));
    const createSig = await this.createChat(chatId, user2);
    console.log("✅ Chat created:", createSig);

    return { createSig };
  }

  // ========== E2E ENCRYPTED CHAT ==========

  /**
   * Create an E2E encrypted chat with another user.
   * 1. Creates the on-chain chat PDA
   * 2. Publishes sender's encryption public key as the first message
   */
  async createE2EChat(
    chatId: number,
    user2: PublicKey,
    myEncryptionPublicKey: Uint8Array
  ): Promise<{ chatSig: string; keySig: string }> {
    // Step 1: Create chat
    const chatSig = await this.createChat(chatId, user2);
    console.log("✅ E2E Chat created:", chatSig);

    // Step 2: Publish our encryption public key as message index 0
    const pubkeyContent = formatPubkeyMessage(myEncryptionPublicKey);
    const keySig = await this.sendMessageSimple(chatId, 0, pubkeyContent);
    console.log("✅ Encryption pubkey published:", keySig);

    return { chatSig, keySig };
  }

  /**
   * Send a message on-chain.
   * Used for key exchange messages and encrypted chat messages.
   */
  async sendMessageSimple(
    chatId: number,
    messageIndex: number,
    content: string,
    isPayment: boolean = false,
    paymentAmount: number = 0
  ): Promise<string> {
    const sig = await requestServerTx("sendMessage", { chatId, messageIndex, content, isPayment, paymentAmount }, this.provider.wallet, this.provider.connection);

    // Wait for confirmation via HTTP polling — no WebSocket needed
    await pollConfirmation(this.provider.connection, sig);

    // Invalidate caches
    rpcCache.invalidate("messages:");
    rpcCache.invalidate("allMessages");
    rpcCache.invalidate("allChatsForUser");

    return sig;
  }

  /**
   * Send an E2E encrypted message.
   * Encrypts the plaintext with NaCl box, then stores the ciphertext on-chain.
   */
  async sendE2EMessage(
    chatId: number,
    messageIndex: number,
    plaintext: string,
    mySecretKey: Uint8Array,
    theirPublicKey: Uint8Array,
    isPayment: boolean = false,
    paymentAmount: number = 0
  ): Promise<string> {
    const encryptedContent = naclEncrypt(plaintext, mySecretKey, theirPublicKey);
    return this.sendMessageSimple(chatId, messageIndex, encryptedContent, isPayment, paymentAmount);
  }

  /**
   * Get the next available message index by scanning PDAs directly.
   * Does NOT rely on chat.messageCount which can be stale.
   */
  async getNextMessageIndex(chatId: number): Promise<number> {
    for (let i = 0; i < 100; i++) {
      const [pda] = getMessagePda(chatId, i);
      const accInfo = await this.provider.connection.getAccountInfo(pda, "confirmed");
      if (!accInfo) return i;
    }
    return 100; // fallback
  }

  /**
   * Publish encryption public key in an existing chat (for the second participant).
   * Sends it as the next available message index.
   */
  async publishEncryptionKey(
    chatId: number,
    messageIndex: number,
    encryptionPublicKey: Uint8Array
  ): Promise<string> {
    const content = formatPubkeyMessage(encryptionPublicKey);
    return this.sendMessageSimple(chatId, messageIndex, content);
  }

  /**
   * Find the encryption public key of the OTHER participant in a chat.
   * Does DIRECT PDA lookups (no cache) to ensure fresh data.
   */
  private _peerKeyCache = new Map<string, Uint8Array>();

  /** Clear cached peer key for a chat — forces next findPeerEncryptionKey to re-scan */
  clearPeerKeyCache(chatId: number, myAddress: string): void {
    this._peerKeyCache.delete(`${chatId}:${myAddress}`);
  }

  async findPeerEncryptionKey(chatId: number, myAddress: string): Promise<Uint8Array | null> {
    // Use cache within a session to avoid hammering RPC with 60 calls per poll.
    // Cache is on the program instance (recreated on page reload), so it's safe.
    const cacheKey = `${chatId}:${myAddress}`;
    if (this._peerKeyCache.has(cacheKey)) {
      return this._peerKeyCache.get(cacheKey)!;
    }

    console.log(`findPeerEncryptionKey: chatId=${chatId}, myAddr=${myAddress.slice(0, 8)}...`);

    const coder = new BorshCoder(idl as Idl);
    let lastFoundKey: Uint8Array | null = null;
    let lastFoundIdx = -1;
    let consecutiveMisses = 0;

    // Scan up to 60 messages — high enough for active chats, returns the LATEST key found
    for (let i = 0; i < 60; i++) {
      try {
        const [pda] = getMessagePda(chatId, i);
        const accInfo = await this.provider.connection.getAccountInfo(pda, "confirmed");
        if (!accInfo) {
          consecutiveMisses++;
          if (consecutiveMisses >= 5) break; // 5 consecutive misses = end of chat
          continue;
        }
        consecutiveMisses = 0;
        const msg = coder.accounts.decode("Message", accInfo.data);
        const sender = msg.sender?.toBase58() || "";
        const content = (msg.content as string) || "";
        console.log(`  msg[${i}]: sender=${sender.slice(0, 8)}... content=${content.slice(0, 40)}`);
        if (sender === myAddress) continue;
        if (isPubkeyMessage(content)) {
          const key = parsePubkeyMessage(content);
          if (key && key.length === 32) {
            // Keep scanning — we want the MOST RECENT key, not the first
            lastFoundKey = key;
            lastFoundIdx = i;
          }
        }
      } catch (err) {
        console.log(`  msg[${i}]: fetch failed (${err})`);
      }
    }

    if (lastFoundKey) {
      console.log(`  ✅ Using peer key from msg[${lastFoundIdx}] (most recent)`);
      this._peerKeyCache.set(cacheKey, lastFoundKey);
      return lastFoundKey;
    }
    console.log("  ❌ No peer key found");
    return null;
  }

  /**
   * Find MY encryption public key in a chat (to check if already published).
   * Does DIRECT PDA lookups (no cache) to ensure fresh data.
   */
  async findMyEncryptionKey(chatId: number, myAddress: string): Promise<boolean> {
    // Scan message PDAs 0-9 directly — do NOT rely on chat.messageCount
    const coder = new BorshCoder(idl as Idl);
    let consecutiveMisses = 0;
    for (let i = 0; i < 10; i++) {
      try {
        const [pda] = getMessagePda(chatId, i);
        const accInfo = await this.provider.connection.getAccountInfo(pda, "confirmed");
        if (!accInfo) {
          consecutiveMisses++;
          if (consecutiveMisses >= 3) break;
          continue;
        }
        consecutiveMisses = 0;
        const msg = coder.accounts.decode("Message", accInfo.data);
        const sender = msg.sender?.toBase58() || "";
        const content = (msg.content as string) || "";
        if (sender === myAddress && isPubkeyMessage(content)) {
          return true;
        }
      } catch {
        // skip
      }
    }
    return false;
  }

  /**
   * Fetch and decrypt all messages for a chat.
   * Returns decrypted plaintext for encrypted messages,
   * or raw content for unencrypted / key-exchange messages.
   */
  async getDecryptedMessages(
    chatId: number,
    myAddress: string,
    mySecretKey: Uint8Array,
    peerPublicKey: Uint8Array
  ): Promise<{
    publicKey: string;
    chatId: string;
    messageIndex: number;
    sender: string;
    content: string;
    decrypted: string | null;
    isPayment: boolean;
    paymentAmount: number;
    timestamp: string;
    isKeyExchange: boolean;
    isEncrypted: boolean;
    isMe: boolean;
  }[]> {
    const rawMessages = await this.getMessagesForChat(chatId);

    console.log(`getDecryptedMessages: chatId=${chatId}, myAddr=${myAddress.slice(0,8)}..., msgs=${rawMessages.length}, peerKeyLen=${peerPublicKey.length}`);

    return rawMessages.map((msg: any) => {
      const isMe = msg.sender === myAddress;
      const isKeyEx = isPubkeyMessage(msg.content);
      const isEnc = isEncryptedMessage(msg.content);
      const isPlain = (msg.content as string).startsWith("PLAIN:");

      let decrypted: string | null = null;
      if (isPlain) {
        // Pre-key-exchange plaintext message
        decrypted = (msg.content as string).slice(6);
      } else if (isEnc) {
        // E2E encrypted — decrypt with peer's public + our secret
        decrypted = naclDecrypt(msg.content, peerPublicKey, mySecretKey);
        if (!decrypted) {
          console.warn(`  ❌ Decrypt FAILED for msg[${msg.messageIndex}] sender=${msg.sender?.toString().slice(0,8)}... isMe=${isMe}`);
        }
      }

      return {
        publicKey: msg.publicKey,
        chatId: msg.chatId,
        messageIndex: msg.messageIndex,
        sender: msg.sender,
        content: msg.content,
        decrypted,
        isPayment: msg.isPayment,
        paymentAmount: msg.paymentAmount,
        timestamp: msg.timestamp,
        isKeyExchange: isKeyEx,
        isEncrypted: isEnc || isPlain,
        isMe,
      };
    });
  }

  /**
   * Get or create a chat with another user.
   * If a chat already exists (either direction), returns it.
   * Otherwise creates a new one with key exchange.
   */
  async getOrCreateE2EChat(
    user2: PublicKey,
    myEncryptionPublicKey: Uint8Array
  ): Promise<{ chatId: number; isNew: boolean }> {
    const user1 = this.provider.wallet.publicKey;
    const chatId = deriveChatId(user1, user2);

    // Check if chat already exists
    const existing = await this.getChat(chatId);
    if (existing) {
      // Chat exists — check if we've published our key
      const myAddr = user1.toBase58();
      const hasMyKey = await this.findMyEncryptionKey(chatId, myAddr);
      if (!hasMyKey) {
        // Publish our key using direct PDA scan for next index
        const msgIndex = await this.getNextMessageIndex(chatId);
        await this.publishEncryptionKey(chatId, msgIndex, myEncryptionPublicKey);
      }
      return { chatId, isNew: false };
    }

    // Create new chat + publish key
    await this.createE2EChat(chatId, user2, myEncryptionPublicKey);
    return { chatId, isNew: true };
  }

  // ========== FOLLOW ==========

  async followUser(targetPubkey: PublicKey): Promise<string> {
    const sig = await requestServerTx("followUser", { target: targetPubkey.toBase58() }, this.provider.wallet, this.provider.connection);
    rpcCache.invalidate("allFollows");
    return sig;
  }

  async unfollowUser(targetPubkey: PublicKey): Promise<string> {
    const sig = await requestServerTx("unfollowUser", { target: targetPubkey.toBase58() }, this.provider.wallet, this.provider.connection);
    console.log("Unfollowed (rent refunded to treasury on-chain):", sig);
    rpcCache.invalidate("allFollows");
    return sig;
  }

  /** Check if current user follows a target user */
  async isFollowing(targetPubkey: PublicKey): Promise<boolean> {
    const user = this.provider.wallet.publicKey;
    const [followPda] = getFollowPda(user, targetPubkey);
    try {
      await this.accounts.followAccount.fetch(followPda);
      return true;
    } catch {
      return false;
    }
  }

  /** Get all follow accounts (for building follower/following lists) */
  async getAllFollows(): Promise<{ follower: string; following: string }[]> {
    const cacheKey = "allFollows";
    const cached = rpcCache.get<any[]>(cacheKey);
    if (cached) return cached;

    try {
      const all = await this.accounts.followAccount.all();
      const result = all.map((f: any) => ({
        follower: f.account.follower.toBase58(),
        following: f.account.following.toBase58(),
      }));
      rpcCache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.error("getAllFollows error:", err);
      return [];
    }
  }

  /** Get list of pubkeys that a user is following */
  async getFollowing(userPubkey: PublicKey): Promise<string[]> {
    const all = await this.getAllFollows();
    const addr = userPubkey.toBase58();
    return all.filter((f) => f.follower === addr).map((f) => f.following);
  }

  /** Get list of pubkeys that follow a user */
  async getFollowers(userPubkey: PublicKey): Promise<string[]> {
    const all = await this.getAllFollows();
    const addr = userPubkey.toBase58();
    return all.filter((f) => f.following === addr).map((f) => f.follower);
  }

  /** Search all profiles by username (partial match) */
  async searchByUsername(query: string): Promise<{ owner: string; username: string; displayName: string }[]> {
    const profiles = await this.getAllProfiles();
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return profiles
      .filter((p: any) => p.username?.toLowerCase().includes(q) || p.displayName?.toLowerCase().includes(q))
      .map((p: any) => ({
        owner: p.owner,
        username: p.username || "",
        displayName: p.displayName || "",
      }))
      .slice(0, 10); // max 10 results
  }

  // ========== COMMUNITIES ==========

  async createCommunity(communityId: number, name: string, description: string, avatarUrl: string): Promise<string> {
    const sig = await requestServerTx("createCommunity", { communityId, name, description, avatarUrl: compressIpfsUrl(avatarUrl) }, this.provider.wallet, this.provider.connection);
    rpcCache.invalidate("allCommunities");
    return sig;
  }

  async joinCommunity(communityId: number): Promise<string> {
    const sig = await requestServerTx("joinCommunity", { communityId }, this.provider.wallet, this.provider.connection);
    rpcCache.invalidate("allCommunities");
    rpcCache.invalidate("allMemberships");
    return sig;
  }

  async leaveCommunity(communityId: number): Promise<string> {
    const sig = await requestServerTx("leaveCommunity", { communityId }, this.provider.wallet, this.provider.connection);
    rpcCache.invalidate("allCommunities");
    rpcCache.invalidate("allMemberships");
    return sig;
  }

  async updateCommunity(communityId: number, description: string, avatarUrl: string): Promise<string> {
    const sig = await requestServerTx("updateCommunity", { communityId, description, avatarUrl: compressIpfsUrl(avatarUrl) }, this.provider.wallet, this.provider.connection);
    rpcCache.invalidate("allCommunities");
    return sig;
  }

  async closeCommunity(communityId: number): Promise<string> {
    const sig = await requestServerTx("closeCommunity", { communityId }, this.provider.wallet, this.provider.connection);
    rpcCache.invalidate("allCommunities");
    rpcCache.invalidate("allMemberships");
    return sig;
  }

  async getAllCommunities(): Promise<any[]> {
    const cacheKey = "allCommunities";
    const cached = rpcCache.get<any[]>(cacheKey);
    if (cached) return cached;
    try {
      const all = await this.accounts.community.all();
      const result = all.map((a: any) => ({
        pubkey: a.publicKey.toBase58(),
        creator: a.account.creator.toBase58(),
        communityId: Number(a.account.communityId),
        name: a.account.name,
        description: a.account.description,
        avatarUrl: expandIpfsUrl(a.account.avatarUrl),
        memberCount: a.account.memberCount,
        createdAt: Number(a.account.createdAt) * 1000,
      }));
      rpcCache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.error("getAllCommunities error:", err);
      return [];
    }
  }

  async getAllMemberships(): Promise<any[]> {
    const cacheKey = "allMemberships";
    const cached = rpcCache.get<any[]>(cacheKey);
    if (cached) return cached;
    try {
      const all = await this.accounts.membership.all();
      const result = all.map((a: any) => ({
        community: a.account.community.toBase58(),
        member: a.account.member.toBase58(),
        joinedAt: Number(a.account.joinedAt) * 1000,
      }));
      rpcCache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.error("getAllMemberships error:", err);
      return [];
    }
  }

  async isMember(communityId: number, userPubkey?: PublicKey): Promise<boolean> {
    const user = userPubkey || this.provider.wallet.publicKey;
    const [communityPda] = getCommunityPda(communityId);
    const [membershipPda] = getMembershipPda(communityPda, user);
    try {
      await this.accounts.membership.fetch(membershipPda);
      return true;
    } catch {
      return false;
    }
  }

  // ========== POLLS ==========

  async createPoll(
    pollId: number,
    question: string,
    options: string[],
    endsAt: number // unix timestamp (seconds)
  ): Promise<string> {
    if (options.length < 2 || options.length > 4) throw new Error("Polls must have 2-4 options");
    const optionA = options[0] || "";
    const optionB = options[1] || "";
    const optionC = options[2] || "";
    const optionD = options[3] || "";
    const sig = await requestServerTx(
      "createPoll",
      { pollId, question, optionA, optionB, optionC, optionD, numOptions: options.length, endsAt },
      this.provider.wallet,
      this.provider.connection
    );
    rpcCache.invalidate("allPolls");
    return sig;
  }

  async votePoll(pollCreator: PublicKey, pollId: number, choice: number): Promise<string> {
    const sig = await requestServerTx(
      "votePoll",
      { pollCreator: pollCreator.toBase58(), pollId, choice },
      this.provider.wallet,
      this.provider.connection
    );
    rpcCache.invalidate("allPolls");
    rpcCache.invalidate("allPollVotes");
    return sig;
  }

  async closePoll(pollId: number): Promise<string> {
    const sig = await requestServerTx(
      "closePoll",
      { pollId },
      this.provider.wallet,
      this.provider.connection
    );
    rpcCache.invalidate("allPolls");
    return sig;
  }

  async getAllPolls(): Promise<any[]> {
    const cacheKey = "allPolls";
    const cached = rpcCache.get<any[]>(cacheKey);
    if (cached) return cached;
    try {
      const all = await this.accounts.poll.all();
      const result = all.map((a: any) => ({
        pubkey: a.publicKey.toBase58(),
        creator: a.account.creator.toBase58(),
        pollId: Number(a.account.pollId),
        question: a.account.question,
        optionA: a.account.optionA,
        optionB: a.account.optionB,
        optionC: a.account.optionC,
        optionD: a.account.optionD,
        numOptions: a.account.numOptions,
        votesA: a.account.votesA,
        votesB: a.account.votesB,
        votesC: a.account.votesC,
        votesD: a.account.votesD,
        totalVotes: a.account.totalVotes,
        endsAt: Number(a.account.endsAt) * 1000,
        isClosed: a.account.isClosed,
        createdAt: Number(a.account.createdAt) * 1000,
      })).sort((a: any, b: any) => b.createdAt - a.createdAt);
      rpcCache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.error("getAllPolls error:", err);
      return [];
    }
  }

  async getPollVotes(pollPubkey?: PublicKey): Promise<any[]> {
    const cacheKey = pollPubkey ? `pollVotes_${pollPubkey.toBase58()}` : "allPollVotes";
    const cached = rpcCache.get<any[]>(cacheKey);
    if (cached) return cached;
    try {
      const all = await this.accounts.pollVote.all();
      let result = all.map((a: any) => ({
        poll: a.account.poll.toBase58(),
        voter: a.account.voter.toBase58(),
        choice: a.account.choice,
        votedAt: Number(a.account.votedAt) * 1000,
      }));
      if (pollPubkey) {
        result = result.filter((v: any) => v.poll === pollPubkey.toBase58());
      }
      rpcCache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.error("getPollVotes error:", err);
      return [];
    }
  }

  async hasVoted(pollPda: PublicKey, userPubkey?: PublicKey): Promise<{ voted: boolean; choice?: number }> {
    const user = userPubkey || this.provider.wallet.publicKey;
    const [votePda] = getPollVotePda(pollPda, user);
    try {
      const vote = await this.accounts.pollVote.fetch(votePda);
      return { voted: true, choice: vote.choice };
    } catch {
      return { voted: false };
    }
  }
}

/** Derive a deterministic chat ID from two public keys.
 *  Sorts the keys lexicographically so both users derive the same ID. */
export function deriveChatId(user1: PublicKey, user2: PublicKey): number {
  const sorted = [user1.toBase58(), user2.toBase58()].sort();
  // Hash the sorted pair into a u32-safe number (fits in BN / u64)
  let hash = 0;
  const str = sorted[0] + sorted[1];
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  // Make sure it's positive
  return Math.abs(hash);
}

// Export PDA helpers for use in components
export {
  getProfilePda,
  getPostPda,
  getChatPda,
  getMessagePda,
  getFollowPda,
  getCommunityPda,
  getMembershipPda,
  getPollPda,
  getPollVotePda,
  toLEBytes,
  PROGRAM_ID,
};

// Re-export encryption utilities for use in components
export {
  encryptMessage as naclEncryptMessage,
  decryptMessage as naclDecryptMessage,
  formatPubkeyMessage,
  parsePubkeyMessage,
  isEncryptedMessage,
  isPubkeyMessage,
} from "./encryption";
export { deriveEncryptionKeypair } from "./encryption";
