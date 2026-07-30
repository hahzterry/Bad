import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { Program, AnchorProvider, Idl, BN } from "@coral-xyz/anchor";
import idl from "@/lib/idl.json";
import {
  DELEGATION_PROGRAM_ID,
  MAGIC_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
} from "@magicblock-labs/ephemeral-rollups-sdk";

// MagicBlock TEE validator (mainnet, private ER).
const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");

/**
 * /api/build-tx — Server builds the ENTIRE transaction from action + params.
 *
 * Flow:
 *   Client sends { action, params, walletAddress }
 *   → Server builds the Anchor instruction (using IDL + accounts)
 *   → Server sets fresh blockhash
 *   → Treasury signs as fee payer
 *   → Returns partially-signed tx to client
 *   → Client co-signs with user wallet + sends to Solana
 *
 * The client NEVER builds instructions — the server controls what goes in the tx.
 */

const PROGRAM_ID = new PublicKey("EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ");
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;

// ========== PDA Seeds ==========
const PROFILE_SEED = Buffer.from("profile");
const POST_SEED = Buffer.from("post");
const CHAT_SEED = Buffer.from("chat");
const MESSAGE_SEED = Buffer.from("message");
const FOLLOW_SEED = Buffer.from("follow");
const COMMENT_SEED = Buffer.from("comment");
const REACTION_SEED = Buffer.from("reaction");
const COMMUNITY_SEED = Buffer.from("community");
const MEMBERSHIP_SEED = Buffer.from("membership");
const POLL_SEED = Buffer.from("poll");
const POLL_VOTE_SEED = Buffer.from("poll_vote");
const LIKE_SEED = Buffer.from("like");
const USERNAME_SEED = Buffer.from("username");
const LISTING_SEED = Buffer.from("listing");
// Official $SHYFT mint — usernames are priced in this token.
const SHYFT_MINT = new PublicKey("7tnB2Dn61NkxWrpkESkUvfoKo6TcoecsazYemptEASY");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
function getUsernamePda(name: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([USERNAME_SEED, Buffer.from(name)], PROGRAM_ID);
}
function getListingPda(name: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([LISTING_SEED, Buffer.from(name)], PROGRAM_ID);
}
function getAta(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), SHYFT_MINT.toBuffer()],
    ATA_PROGRAM,
  )[0];
}
/** Never trust the client's price. Must be a positive integer of $SHYFT base
 * units (6 dp), within u64, no decimals/negatives/junk. */
function parsePrice(raw: any): BN {
  const s = String(raw ?? "").trim();
  if (!/^[0-9]+$/.test(s)) throw new Error("Invalid price");
  const bn = new BN(s);
  if (bn.lten(0)) throw new Error("Price must be greater than 0");
  if (bn.bitLength() > 64) throw new Error("Price too large");
  return bn;
}
/** `createIdempotent` for a $SHYFT ATA. `payer` funds the rent (must be the
 * buyer for marketplace buys, never the treasury — see the rent-drain rule). */
function createAtaIdempotentIx(payer: PublicKey, ata: PublicKey, owner: PublicKey) {
  return {
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: SHYFT_MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // 1 = CreateIdempotent
  };
}

function toLEBytes(num: number): Uint8Array {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(num), true);
  return new Uint8Array(buffer);
}

// ========== PDA Derivation ==========
function getProfilePda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PROFILE_SEED, owner.toBuffer()], PROGRAM_ID);
}
function getPostPda(author: PublicKey, postId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([POST_SEED, author.toBuffer(), toLEBytes(postId)], PROGRAM_ID);
}
function getLikeRecordPda(postPda: PublicKey, liker: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([LIKE_SEED, postPda.toBuffer(), liker.toBuffer()], PROGRAM_ID);
}
function getChatPda(chatId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CHAT_SEED, toLEBytes(chatId)], PROGRAM_ID);
}
function getInboxPda(chatId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("inbox"), toLEBytes(chatId)], PROGRAM_ID);
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

// ========== Treasury ==========
function getTreasuryKeypair(): Keypair {
  const secret = process.env.TREASURY_PRIVATE_KEY;
  if (!secret) throw new Error("TREASURY_PRIVATE_KEY not set");
  if (secret.trimStart().startsWith("[")) {
    const bytes = JSON.parse(secret) as number[];
    return Keypair.fromSecretKey(new Uint8Array(bytes));
  }
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const str = secret.trim();
  const bytes: number[] = [0];
  for (const char of str) {
    let carry = ALPHABET.indexOf(char);
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let i = 0; i < str.length && str[i] === "1"; i++) bytes.push(0);
  return Keypair.fromSecretKey(new Uint8Array(bytes.reverse()));
}

// ========== Rate Limiting ==========
const ipTimestamps = new Map<string, number[]>();
const walletTimestamps = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const MIN_TREASURY_RESERVE = 100_000_000; // 0.1 SOL

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isRateLimited(key: string, store: Map<string, number[]>): boolean {
  const now = Date.now();
  const timestamps = (store.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  store.set(key, timestamps);
  if (timestamps.length >= RATE_LIMIT_MAX) return true;
  timestamps.push(now);
  store.set(key, timestamps);
  return false;
}

const ALLOWED_ORIGINS = new Set([
  "https://www.shyft.lol",
  "https://shyft.lol",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3099",
]);

function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin") || "";
  const referer = request.headers.get("referer") || "";
  if (origin && ALLOWED_ORIGINS.has(origin)) return true;
  for (const allowed of ALLOWED_ORIGINS) {
    if (referer.startsWith(allowed)) return true;
  }
  return false;
}

// ========== Anchor Setup ==========
/** Dummy wallet for server-side Anchor Provider (treasury signs, not this) */
class ServerWallet {
  constructor(public payer: Keypair) {}
  get publicKey() { return this.payer.publicKey; }
  async signTransaction<T extends Transaction>(tx: T): Promise<T> {
    (tx as any).partialSign(this.payer);
    return tx;
  }
  async signAllTransactions<T extends Transaction>(txs: T[]): Promise<T[]> {
    return txs.map((tx) => { (tx as any).partialSign(this.payer); return tx; });
  }
}

function getProgram(connection: Connection, treasury: Keypair): Program {
  const wallet = new ServerWallet(treasury);
  const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
  return new Program(idl as Idl, provider);
}

// ========== Action Handlers ==========
// Each handler takes params + user pubkey + program, returns an instruction

type ActionHandler = (
  params: any,
  user: PublicKey,
  treasury: PublicKey,
  program: Program
) => Promise<any>;

const actions: Record<string, ActionHandler> = {

  // ── PROFILE ──
  async createProfile(params, user, treasury, program) {
    // Username is now claimed separately (registry-enforced uniqueness). The
    // program rejects a non-empty username here, so profiles start nameless and
    // the client follows with `claimUsername`.
    const { displayName, bio } = params;
    const [profilePda] = getProfilePda(user);
    return program.methods
      .createProfile("", displayName || "", bio || "")
      .accounts({ profile: profilePda, user, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  // ── USERNAMES / MARKETPLACE ──
  async claimUsername(params, user, treasury, program) {
    const name = String(params.name || "").toLowerCase();
    if (!name) throw new Error("Missing name");
    const [profilePda] = getProfilePda(user);
    const [recordPda] = getUsernamePda(name);
    return program.methods
      .claimUsername(name)
      .accounts({ usernameRecord: recordPda, profile: profilePda, user, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  async setDisplayUsername(params, user, treasury, program) {
    const name = String(params.name || "").toLowerCase();
    const [profilePda] = getProfilePda(user);
    const [recordPda] = getUsernamePda(name);
    return program.methods
      .setDisplayUsername(name)
      .accounts({ usernameRecord: recordPda, profile: profilePda, user })
      .instruction();
  },

  async listUsername(params, user, treasury, program) {
    const name = String(params.name || "").toLowerCase();
    if (!name) throw new Error("Missing name");
    const price = parsePrice(params.price); // validated $SHYFT base units
    const [listingPda] = getListingPda(name);
    const [recordPda] = getUsernamePda(name);
    const [profilePda] = getProfilePda(user);
    // Treasury funds the listing rent (gasless — users hold no SOL). This is
    // SAFE from the old rent-drain because the Listing stores rent_payer =
    // treasury and buy/delist refund ONLY to rent_payer, so a list→delist loop
    // just cycles the treasury's own rent back (net zero), never to the user.
    return program.methods
      .listUsername(name, price)
      .accounts({ listing: listingPda, usernameRecord: recordPda, sellerProfile: profilePda, seller: user, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  async updatePrice(params, user, treasury, program) {
    const name = String(params.name || "").toLowerCase();
    if (!name) throw new Error("Missing name");
    const price = parsePrice(params.price);
    const [listingPda] = getListingPda(name);
    return program.methods
      .updatePrice(name, price)
      .accounts({ listing: listingPda, seller: user })
      .instruction();
  },

  async delistUsername(params, user, treasury, program) {
    const name = String(params.name || "").toLowerCase();
    const [listingPda] = getListingPda(name);
    const [recordPda] = getUsernamePda(name);
    const listing: any = await (program.account as any).listing.fetch(listingPda);
    return program.methods
      .delistUsername(name)
      .accounts({ listing: listingPda, rentPayer: listing.rentPayer, usernameRecord: recordPda, seller: user })
      .instruction();
  },

  // Buyer (`user`) signs and pays. Returns [ensure-seller-ATA, buy].
  async buyUsername(params, user, treasury, program) {
    const name = String(params.name || "").toLowerCase();
    if (!name) throw new Error("Missing name");
    const [listingPda] = getListingPda(name);
    const [recordPda] = getUsernamePda(name);
    const [buyerProfile] = getProfilePda(user);

    // Read the listing to learn the seller (the buyer signs alone).
    const listing: any = await (program.account as any).listing.fetch(listingPda);
    const seller: PublicKey = listing.seller;
    const rentPayer: PublicKey = listing.rentPayer; // must match on-chain (has_one)

    const buyerAta = getAta(user);
    const sellerAta = getAta(seller);
    const treasuryAta = getAta(treasury);

    // Create the seller's $SHYFT account if missing — funded by the BUYER, never
    // the treasury (a treasury-funded, user-owned ATA is a rent-drain loop).
    const createSellerAta = createAtaIdempotentIx(user, sellerAta, seller);

    const buyIx = await program.methods
      .buyUsername(name)
      .accounts({
        listing: listingPda,
        rentPayer, // must equal listing.rent_payer (the seller who funded it)
        usernameRecord: recordPda,
        buyerProfile,
        buyer: user,
        seller,
        buyerToken: buyerAta,
        sellerToken: sellerAta,
        treasuryToken: treasuryAta, // ignored while fee is 0, but the account is still in the layout
        tokenProgram: TOKEN_PROGRAM,
      })
      .instruction();

    return [createSellerAta, buyIx];
  },

  async migrateProfile(params, user, treasury, program) {
    const [profilePda] = getProfilePda(user);
    return program.methods
      .migrateProfile()
      .accounts({ profile: profilePda, user, systemProgram: SystemProgram.programId })
      .instruction();
  },

  async updateProfile(params, user, treasury, program) {
    const { displayName, bio, avatarUrl, bannerUrl, websiteUrl } = params;
    const [profilePda] = getProfilePda(user);
    return program.methods
      .updateProfile(displayName || "", bio || "", avatarUrl || "", bannerUrl || "", websiteUrl || "")
      .accounts({ profile: profilePda, user, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  async closeProfile(params, user, treasury, program) {
    const [profilePda] = getProfilePda(user);
    return program.methods
      .closeProfile()
      .accounts({ profile: profilePda, user, treasury })
      .instruction();
  },

  // ── POSTS ──
  async createPost(params, user, treasury, program) {
    const { postId, content, isPrivate } = params;
    if (postId === undefined) throw new Error("Missing postId");
    if (!content) throw new Error("Missing content");
    const [profilePda] = getProfilePda(user);
    const [postPda] = getPostPda(user, postId);
    return program.methods
      .createPost(new BN(postId), content, !!isPrivate)
      .accountsPartial({ post: postPda, profile: profilePda, author: user, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  async editPost(params, user, treasury, program) {
    const { postId, content } = params;
    if (postId === undefined) throw new Error("Missing postId");
    if (!content) throw new Error("Missing content");
    const [postPda] = getPostPda(user, postId);
    return program.methods
      .editPost(new BN(postId), content)
      .accountsPartial({ post: postPda, author: user })
      .instruction();
  },

  async closePost(params, user, treasury, program) {
    const { postId } = params;
    if (postId === undefined) throw new Error("Missing postId");
    const [profilePda] = getProfilePda(user);
    const [postPda] = getPostPda(user, postId);
    return program.methods
      .closePost(new BN(postId))
      .accountsPartial({ post: postPda, profile: profilePda, user, treasury })
      .instruction();
  },

  async likePost(params, user, treasury, program) {
    const { author, postId } = params;
    if (!author || postId === undefined) throw new Error("Missing author or postId");
    const authorPk = new PublicKey(author);
    const [postPda] = getPostPda(authorPk, postId);
    const [profilePda] = getProfilePda(user);
    const [likeRecordPda] = getLikeRecordPda(postPda, user);
    return program.methods
      .likePost(new BN(postId))
      .accountsPartial({ post: postPda, profile: profilePda, likeRecord: likeRecordPda, user, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  // ── COMMENTS ──
  async createComment(params, user, treasury, program) {
    const { author, postId, commentIndex, content } = params;
    if (!author || postId === undefined || commentIndex === undefined || !content) throw new Error("Missing params");
    const authorPk = new PublicKey(author);
    const [postPda] = getPostPda(authorPk, postId);
    const [commentPda] = getCommentPda(postPda, commentIndex);
    const [commenterProfilePda] = getProfilePda(user);
    return program.methods
      .createComment(new BN(postId), new BN(commentIndex), content)
      .accountsPartial({ comment: commentPda, post: postPda, commenterProfile: commenterProfilePda, author: user, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  async closeComment(params, user, treasury, program) {
    const { postAuthor, postId, commentIndex } = params;
    if (!postAuthor || postId === undefined || commentIndex === undefined) throw new Error("Missing params");
    const postAuthorPk = new PublicKey(postAuthor);
    const [postPda] = getPostPda(postAuthorPk, postId);
    const [commentPda] = getCommentPda(postPda, commentIndex);
    return program.methods
      .closeComment(new BN(postId), new BN(commentIndex))
      .accountsPartial({ comment: commentPda, post: postPda, user, treasury })
      .instruction();
  },

  // ── REACTIONS ──
  async reactToPost(params, user, treasury, program) {
    const { author, postId, reactionType } = params;
    if (!author || postId === undefined || reactionType === undefined) throw new Error("Missing params");
    const authorPk = new PublicKey(author);
    const [postPda] = getPostPda(authorPk, postId);
    const [reactionPda] = getReactionPda(postPda, user);
    const [reactorProfilePda] = getProfilePda(user);
    return program.methods
      .reactToPost(new BN(postId), reactionType)
      .accountsPartial({ reaction: reactionPda, post: postPda, reactorProfile: reactorProfilePda, user, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  async closeReaction(params, user, treasury, program) {
    const { author, postId } = params;
    if (!author || postId === undefined) throw new Error("Missing params");
    const authorPk = new PublicKey(author);
    const [postPda] = getPostPda(authorPk, postId);
    const [reactionPda] = getReactionPda(postPda, user);
    return program.methods
      .closeReaction(new BN(postId))
      .accountsPartial({ reaction: reactionPda, post: postPda, user, treasury })
      .instruction();
  },

  // ── CHAT ──
  async createChat(params, user, treasury, program) {
    const { chatId, user2 } = params;
    if (chatId === undefined || !user2) throw new Error("Missing chatId or user2");
    const [chatPda] = getChatPda(chatId);
    return program.methods
      .createChat(new BN(chatId))
      .accounts({ chat: chatPda, user1: user, user2: new PublicKey(user2), payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  async sendMessage(params, user, treasury, program) {
    const { chatId, messageIndex, content, isPayment, paymentAmount } = params;
    if (chatId === undefined || messageIndex === undefined || !content) throw new Error("Missing params");
    const [messagePda] = getMessagePda(chatId, messageIndex);
    const [chatPda] = getChatPda(chatId);
    return program.methods
      .sendMessage(new BN(chatId), new BN(messageIndex), content, !!isPayment, new BN(paymentAmount || 0))
      .accounts({ message: messagePda, chat: chatPda, sender: user, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  // ── Private chat (MagicBlock TEE), base-layer legs — treasury-sponsored ──
  // INBOX model: create_private_inbox → delegate_private_inbox (base, treasury-
  // sponsored). init permission + append/read happen on the ER, client-side.
  async createPrivateInbox(params, user, treasury, program) {
    const { chatId } = params;
    if (chatId === undefined) throw new Error("Missing chatId");
    const [inboxPda] = getInboxPda(chatId);
    return program.methods
      .createPrivateInbox(new BN(chatId))
      .accounts({ inbox: inboxPda, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  async delegatePrivateInbox(params, user, treasury, program) {
    const { chatId } = params;
    if (chatId === undefined) throw new Error("Missing chatId");
    const [inboxPda] = getInboxPda(chatId);
    return program.methods
      .delegatePrivateInbox(new BN(chatId))
      .accounts({
        bufferPda: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(inboxPda, PROGRAM_ID),
        delegationRecordPda: delegationRecordPdaFromDelegatedAccount(inboxPda),
        delegationMetadataPda: delegationMetadataPdaFromDelegatedAccount(inboxPda),
        pda: inboxPda,
        payer: treasury,
        ownerProgram: PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([{ pubkey: TEE_VALIDATOR, isSigner: false, isWritable: false }])
      .instruction();
  },

  async undelegatePrivateInbox(params, user, treasury, program) {
    const { chatId } = params;
    if (chatId === undefined) throw new Error("Missing chatId");
    const [inboxPda] = getInboxPda(chatId);
    return program.methods
      .undelegatePrivateInbox()
      .accounts({ payer: treasury, inbox: inboxPda, magicProgram: MAGIC_PROGRAM_ID, magicContext: MAGIC_CONTEXT_ID })
      .instruction();
  },

  // Close an UNDELEGATED inbox and refund its rent to the treasury. Must run only
  // after undelegation has returned the account to the base chain.
  async closePrivateInbox(params, user, treasury, program) {
    const { chatId } = params;
    if (chatId === undefined) throw new Error("Missing chatId");
    const [inboxPda] = getInboxPda(chatId);
    return program.methods
      .closePrivateInbox(new BN(chatId))
      .accounts({ inbox: inboxPda, treasury, payer: treasury })
      .instruction();
  },

  async closeChat(params, user, treasury, program) {
    const { chatId } = params;
    if (chatId === undefined) throw new Error("Missing chatId");
    const [chatPda] = getChatPda(chatId);
    return program.methods
      .closeChat(new BN(chatId))
      .accounts({ chat: chatPda, user, treasury })
      .instruction();
  },

  async closeMessage(params, user, treasury, program) {
    const { chatId, messageIndex } = params;
    if (chatId === undefined || messageIndex === undefined) throw new Error("Missing params");
    const [messagePda] = getMessagePda(chatId, messageIndex);
    return program.methods
      .closeMessage(new BN(chatId), new BN(messageIndex))
      .accounts({ message: messagePda, user, treasury })
      .instruction();
  },

  // ── FOLLOW ──
  async followUser(params, user, treasury, program) {
    const { target } = params;
    if (!target) throw new Error("Missing target");
    const targetPk = new PublicKey(target);
    const [followerProfilePda] = getProfilePda(user);
    const [followingProfilePda] = getProfilePda(targetPk);
    const [followPda] = getFollowPda(user, targetPk);
    return program.methods
      .followUser()
      .accounts({ followAccount: followPda, followerProfile: followerProfilePda, followingProfile: followingProfilePda, user, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  async unfollowUser(params, user, treasury, program) {
    const { target } = params;
    if (!target) throw new Error("Missing target");
    const targetPk = new PublicKey(target);
    const [followerProfilePda] = getProfilePda(user);
    const [followingProfilePda] = getProfilePda(targetPk);
    const [followPda] = getFollowPda(user, targetPk);
    return program.methods
      .unfollowUser()
      .accounts({ followAccount: followPda, followerProfile: followerProfilePda, followingProfile: followingProfilePda, user, treasury })
      .instruction();
  },

  // ── COMMUNITIES ──
  async createCommunity(params, user, treasury, program) {
    const { communityId, name, description, avatarUrl } = params;
    if (communityId === undefined || !name) throw new Error("Missing params");
    const [communityPda] = getCommunityPda(communityId);
    const [creatorProfilePda] = getProfilePda(user);
    return program.methods
      .createCommunity(new BN(communityId), name, description || "", avatarUrl || "")
      .accounts({ community: communityPda, creatorProfile: creatorProfilePda, user, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  async joinCommunity(params, user, treasury, program) {
    const { communityId } = params;
    if (communityId === undefined) throw new Error("Missing communityId");
    const [communityPda] = getCommunityPda(communityId);
    const [memberProfilePda] = getProfilePda(user);
    const [membershipPda] = getMembershipPda(communityPda, user);
    return program.methods
      .joinCommunity(new BN(communityId))
      .accounts({ membership: membershipPda, community: communityPda, memberProfile: memberProfilePda, user, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  async leaveCommunity(params, user, treasury, program) {
    const { communityId } = params;
    if (communityId === undefined) throw new Error("Missing communityId");
    const [communityPda] = getCommunityPda(communityId);
    const [memberProfilePda] = getProfilePda(user);
    const [membershipPda] = getMembershipPda(communityPda, user);
    return program.methods
      .leaveCommunity(new BN(communityId))
      .accounts({ membership: membershipPda, community: communityPda, memberProfile: memberProfilePda, user, treasury })
      .instruction();
  },

  async closeCommunity(params, user, treasury, program) {
    const { communityId } = params;
    if (communityId === undefined) throw new Error("Missing communityId");
    const [communityPda] = getCommunityPda(communityId);
    return program.methods
      .closeCommunity(new BN(communityId))
      .accounts({ community: communityPda, user, treasury })
      .instruction();
  },

  async updateCommunity(params, user, treasury, program) {
    const { communityId, description, avatarUrl } = params;
    if (communityId === undefined) throw new Error("Missing communityId");
    const [communityPda] = getCommunityPda(communityId);
    return program.methods
      .updateCommunity(new BN(communityId), description || "", avatarUrl || "")
      .accounts({ community: communityPda, user })
      .instruction();
  },

  // ── POLLS ──
  async createPoll(params, user, treasury, program) {
    const { pollId, question, optionA, optionB, optionC, optionD, numOptions, endsAt } = params;
    if (pollId === undefined || !question || numOptions === undefined || endsAt === undefined) throw new Error("Missing params");
    // Server-side validation to avoid wasting treasury SOL on txs the program will reject
    const n = Number(numOptions);
    if (!Number.isInteger(n) || n < 2 || n > 4) throw new Error("numOptions must be 2-4");
    if (typeof question !== "string" || question.length > 200) throw new Error("Question too long (max 200)");
    if ((optionA || "").length > 50 || (optionB || "").length > 50 || (optionC || "").length > 50 || (optionD || "").length > 50) throw new Error("Option too long (max 50)");
    const now = Math.floor(Date.now() / 1000);
    const ea = Number(endsAt);
    if (!Number.isFinite(ea) || ea <= now) throw new Error("endsAt must be in the future");
    if (ea > now + 30 * 24 * 60 * 60) throw new Error("Poll cannot last more than 30 days");
    const [profilePda] = getProfilePda(user);
    const [pollPda] = getPollPda(user, pollId);
    return program.methods
      .createPoll(new BN(pollId), question, optionA || "", optionB || "", optionC || "", optionD || "", numOptions, new BN(endsAt))
      .accountsPartial({ poll: pollPda, profile: profilePda, user, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  async votePoll(params, user, treasury, program) {
    const { pollCreator, pollId, choice } = params;
    if (!pollCreator || pollId === undefined || choice === undefined) throw new Error("Missing params");
    const c = Number(choice);
    if (!Number.isInteger(c) || c < 0 || c > 3) throw new Error("Invalid choice (must be 0-3)");
    const creatorPk = new PublicKey(pollCreator);
    const [pollPda] = getPollPda(creatorPk, pollId);
    const [pollVotePda] = getPollVotePda(pollPda, user);
    const [voterProfilePda] = getProfilePda(user);
    return program.methods
      .votePoll(new BN(pollId), choice)
      .accountsPartial({ poll: pollPda, pollVote: pollVotePda, voterProfile: voterProfilePda, user, payer: treasury, systemProgram: SystemProgram.programId })
      .instruction();
  },

  async closePoll(params, user, treasury, program) {
    const { pollId } = params;
    if (pollId === undefined) throw new Error("Missing pollId");
    const [pollPda] = getPollPda(user, pollId);
    return program.methods
      .closePoll(new BN(pollId))
      .accountsPartial({ poll: pollPda, user })
      .instruction();
  },
};

// ========== GET — returns treasury pubkey ==========
let cachedTreasuryPubkey: string | null = null;

export async function GET() {
  try {
    if (!cachedTreasuryPubkey) {
      cachedTreasuryPubkey = getTreasuryKeypair().publicKey.toBase58();
    }
    return NextResponse.json({ treasuryPubkey: cachedTreasuryPubkey });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

// ========== POST — build + treasury-sign tx ==========
export async function POST(request: NextRequest) {
  try {
    // ── 1. ORIGIN CHECK ──
    if (!isAllowedOrigin(request)) {
      console.error(`🚨 BLOCKED origin: ${request.headers.get("origin")} | ref: ${request.headers.get("referer")}`);
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const { action, params, walletAddress, actions: batchActions } = body;

    if (!walletAddress) {
      return NextResponse.json({ error: "Missing walletAddress" }, { status: 400 });
    }

    const requestedActions = Array.isArray(batchActions)
      ? batchActions
      : [{ action, params }];

    if (!requestedActions.length) {
      return NextResponse.json({ error: "No actions provided" }, { status: 400 });
    }

    if (requestedActions.length > 5) {
      return NextResponse.json({ error: "Too many actions in one batch" }, { status: 400 });
    }

    for (const requested of requestedActions) {
      if (!requested?.action || typeof requested.action !== "string") {
        return NextResponse.json({ error: "Invalid action payload" }, { status: 400 });
      }
      if (!actions[requested.action]) {
        console.error(`🚨 BLOCKED: Unknown action "${requested.action}" from ${walletAddress}`);
        return NextResponse.json({ error: `Unknown action: ${requested.action}` }, { status: 400 });
      }
    }

    let userPubkey: PublicKey;
    try {
      userPubkey = new PublicKey(walletAddress);
    } catch {
      return NextResponse.json({ error: "Invalid walletAddress" }, { status: 400 });
    }

    // ── 2b. BLOCK TREASURY AS USER ──
    // CRITICAL: If walletAddress == treasury, the tx is fully signed by treasury alone
    // (treasury signs as fee payer AND user signer). Anyone could submit it.
    const treasuryPk = getTreasuryKeypair().publicKey;
    if (userPubkey.equals(treasuryPk)) {
      console.error(`🚨 BLOCKED: walletAddress is treasury! from IP ${getClientIp(request)}`);
      return NextResponse.json({ error: "Invalid walletAddress" }, { status: 403 });
    }

    // ── 3. RATE LIMIT ──
    const clientIp = getClientIp(request);
    if (isRateLimited(clientIp, ipTimestamps)) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    }
    if (isRateLimited(walletAddress, walletTimestamps)) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    }

    const connection = new Connection(RPC_URL, "confirmed");
    const treasury = getTreasuryKeypair();

    // ── 4. TREASURY BALANCE CHECK ──
    const treasuryBalance = await connection.getBalance(treasury.publicKey);
    if (treasuryBalance < MIN_TREASURY_RESERVE) {
      console.error("⚠️ Treasury low:", treasuryBalance / 1e9, "SOL");
      return NextResponse.json({ error: "Platform treasury low" }, { status: 503 });
    }

    // ── 5. BUILD INSTRUCTION(S) — server controls everything ──
    const program = getProgram(connection, treasury);
    const ixs: any[] = [];
    for (const requested of requestedActions) {
      const handler = actions[requested.action];
      try {
        const ix = await handler(requested.params || {}, userPubkey, treasury.publicKey, program);
        // A handler may return one instruction or several (e.g. buyUsername
        // prepends a buyer-funded ATA creation for the seller).
        if (Array.isArray(ix)) ixs.push(...ix);
        else ixs.push(ix);
      } catch (err: any) {
        console.error(`❌ Build failed for action "${requested.action}":`, err?.message);
        return NextResponse.json({ error: err?.message || `Failed to build instruction: ${requested.action}` }, { status: 400 });
      }
    }

    // ── 6. BUILD TX ──
    const tx = new Transaction();
    // Give the program the max heap (256KB). The program's memory footprint grew
    // after the private-messaging upgrade; the default 32KB heap OOMs on some
    // instructions (e.g. likePost). This restores them with no program redeploy.
    tx.add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }));
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
    for (const ix of ixs) tx.add(ix);
    tx.feePayer = treasury.publicKey;

    // ── 7. FRESH BLOCKHASH ──
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;

    // ── 8. TREASURY SIGNS — locks the exact bytes ──
    tx.partialSign(treasury);

    // ── 9. RETURN partially-signed tx ──
    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

    const actionSummary = requestedActions.map((requested: any) => requested.action).join(",");
    console.log(`🔨 Built "${actionSummary}" for ${walletAddress.slice(0, 8)}.. | IP: ${clientIp}`);
    return NextResponse.json({
      success: true,
      transaction: serialized.toString("base64"),
    });
  } catch (err: any) {
    console.error("Build tx error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
