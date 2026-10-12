import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { Program, AnchorProvider, Idl, BN } from "@coral-xyz/anchor";
import idl from "@/lib/idl.json";

/**
 * /api/actions/post — Solana Actions (Blinks) endpoint for Shyft posts.
 *
 * GET  ?author=<pubkey>&postId=<number>  → Action metadata (title, icon, buttons)
 * POST ?author=<pubkey>&postId=<number>&action=like|tip&amount=<sol>  → Partially-signed tx
 *
 * Allows anyone with Phantom / Backpack to like or tip a Shyft post
 * directly from Twitter, Discord, or any Blink-compatible client.
 */

const PROGRAM_ID = new PublicKey("EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ");
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;

// ── PDA helpers ──
const PROFILE_SEED = Buffer.from("profile");
const POST_SEED = Buffer.from("post");
const REACTION_SEED = Buffer.from("reaction");
const LIKE_SEED = Buffer.from("like");

function toLEBytes(num: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, BigInt(num), true);
  return new Uint8Array(buf);
}

function getProfilePda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PROFILE_SEED, owner.toBuffer()], PROGRAM_ID);
}
function getPostPda(author: PublicKey, postId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([POST_SEED, author.toBuffer(), toLEBytes(postId)], PROGRAM_ID);
}
function getReactionPda(postPda: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([REACTION_SEED, postPda.toBuffer(), user.toBuffer()], PROGRAM_ID);
}
function getLikeRecordPda(postPda: PublicKey, liker: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([LIKE_SEED, postPda.toBuffer(), liker.toBuffer()], PROGRAM_ID);
}

// ── Treasury ──
function getTreasuryKeypair(): Keypair {
  const secret = process.env.TREASURY_PRIVATE_KEY;
  if (!secret) throw new Error("TREASURY_PRIVATE_KEY not set");
  if (secret.trimStart().startsWith("[")) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(secret)));
  }
  // Base58 decode
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes: number[] = [0];
  for (const char of secret.trim()) {
    let carry = ALPHABET.indexOf(char);
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let i = 0; i < secret.trim().length && secret.trim()[i] === "1"; i++) bytes.push(0);
  return Keypair.fromSecretKey(new Uint8Array(bytes.reverse()));
}

function getProgram(connection: Connection, payer: Keypair): Program {
  const provider = new AnchorProvider(
    connection,
    { publicKey: payer.publicKey, signTransaction: async (tx: any) => tx, signAllTransactions: async (txs: any) => txs } as any,
    { commitment: "confirmed" }
  );
  return new Program(idl as Idl, provider);
}

// ── CORS headers required by Solana Actions spec ──
const ACTION_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Content-Encoding, Accept-Encoding",
  "Content-Type": "application/json",
};

// ── Expand IPFS CID to full URL (same as client-side logic) ──
const IPFS_GATEWAY =
  (process.env.PINATA_GATEWAY || process.env.NEXT_PUBLIC_PINATA_GATEWAY || "amethyst-secondary-orca-737.mypinata.cloud").trim();
function expandIpfs(content: string): string {
  if (!content) return "";
  return content.replace(
    /\b(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-zA-Z0-9]{50,})\b/g,
    (cid) => `https://${IPFS_GATEWAY}/ipfs/${cid}`
  );
}

// ── Fetch post data from chain ──
async function fetchPost(connection: Connection, authorPk: PublicKey, postId: number) {
  const [postPda] = getPostPda(authorPk, postId);
  const program = getProgram(connection, getTreasuryKeypair());
  try {
    const post = await (program.account as any).post.fetch(postPda);
    return { pda: postPda, data: post };
  } catch {
    return null;
  }
}

// ── Fetch profile for display name ──
async function fetchProfile(connection: Connection, owner: PublicKey) {
  const [profilePda] = getProfilePda(owner);
  const program = getProgram(connection, getTreasuryKeypair());
  try {
    const profile = await (program.account as any).profile.fetch(profilePda);
    return profile;
  } catch {
    return null;
  }
}

// ========== OPTIONS — CORS preflight ==========
export async function OPTIONS() {
  return new NextResponse(null, { headers: ACTION_HEADERS });
}

// ========== GET — Return Action metadata ==========
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const author = searchParams.get("author");
    const postIdStr = searchParams.get("postId");

    if (!author || postIdStr === null) {
      return NextResponse.json(
        { error: { message: "Missing author or postId" } },
        { status: 400, headers: ACTION_HEADERS }
      );
    }

    const authorPk = new PublicKey(author);
    const postId = parseInt(postIdStr);
    const connection = new Connection(RPC_URL, "confirmed");

    // Fetch post + profile
    const postResult = await fetchPost(connection, authorPk, postId);
    if (!postResult) {
      return NextResponse.json(
        { error: { message: "Post not found" } },
        { status: 404, headers: ACTION_HEADERS }
      );
    }

    const profile = await fetchProfile(connection, authorPk);
    const username = profile?.username || author.slice(0, 8);
    const displayName = profile?.displayName || username;
    const avatarUrl = profile?.avatarUrl
      ? expandIpfs(profile.avatarUrl)
      : `https://api.dicebear.com/7.x/bottts/png?seed=${author}`;

    // Parse post content
    let rawContent = postResult.data.content || "";
    const isPaid = rawContent.startsWith("PAID|");
    const isComm = rawContent.startsWith("COMM|");
    const isRepost = rawContent.startsWith("RT|");

    let displayContent = rawContent;
    if (isPaid) {
      displayContent = "🔒 Paid post — unlock on Shyft to view";
    } else if (isComm) {
      const parts = rawContent.split("|");
      displayContent = parts.slice(2).join("|") || rawContent;
    } else if (isRepost) {
      const parts = rawContent.split("|");
      displayContent = `🔁 Repost from ${parts[1]}: ${parts.slice(2).join("|")}`;
    }

    // Expand IPFS URLs
    displayContent = expandIpfs(displayContent);

    // Extract first image for the icon (if any)
    const imgMatch = displayContent.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/i);
    const postImage = imgMatch ? imgMatch[0] : null;

    // Clean text (remove URLs for description)
    const cleanText = displayContent
      .replace(/https?:\/\/[^\s]+/g, "")
      .trim()
      .slice(0, 200);

    const likes = Number(postResult.data.likes || 0);
    const comments = Number(postResult.data.commentCount || 0);

    const baseUrl = `https://baddie.stream/api/actions/post`;

    const response = {
      type: "action" as const,
      icon: postImage || avatarUrl,
      title: `@${username} on Shyft`,
      description: `${cleanText || `Post by @${username}`}  ·  ❤️ ${likes} likes  ·  💬 ${comments} comments`,
      label: "Tip",
      links: {
        actions: [
          {
            type: "transaction" as const,
            label: "💸 Tip 0.01 SOL",
            href: `${baseUrl}?author=${author}&postId=${postId}&action=tip&amount=0.01`,
          },
          {
            type: "transaction" as const,
            label: "💸 Tip 0.05 SOL",
            href: `${baseUrl}?author=${author}&postId=${postId}&action=tip&amount=0.05`,
          },
          {
            type: "transaction" as const,
            label: "💸 Tip 0.1 SOL",
            href: `${baseUrl}?author=${author}&postId=${postId}&action=tip&amount=0.1`,
          },
          {
            type: "transaction" as const,
            label: "💸 Custom Tip",
            href: `${baseUrl}?author=${author}&postId=${postId}&action=tip&amount={amount}`,
            parameters: [
              {
                name: "amount",
                label: "SOL amount",
                type: "number" as const,
                required: true,
                min: 0.001,
                max: 10,
                patternDescription: "Enter an amount between 0.001 and 10 SOL",
              },
            ],
          },
        ],
      },
    };

    return NextResponse.json(response, { headers: ACTION_HEADERS });
  } catch (err: any) {
    console.error("Actions GET error:", err);
    return NextResponse.json(
      { error: { message: err?.message || "Internal error" } },
      { status: 500, headers: ACTION_HEADERS }
    );
  }
}

// ========== POST — Build and return transaction ==========
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const author = searchParams.get("author");
    const postIdStr = searchParams.get("postId");
    const actionType = searchParams.get("action"); // "like" or "tip"
    const amountStr = searchParams.get("amount"); // SOL amount for tips

    if (!author || postIdStr === null || !actionType) {
      return NextResponse.json(
        { error: { message: "Missing required parameters" } },
        { status: 400, headers: ACTION_HEADERS }
      );
    }

    // Parse request body — Solana Actions spec sends { account: "<base58 pubkey>" }
    const body = await request.json();
    const userAccount = body.account;
    if (!userAccount) {
      return NextResponse.json(
        { error: { message: "Missing account in request body" } },
        { status: 400, headers: ACTION_HEADERS }
      );
    }

    const userPk = new PublicKey(userAccount);
    const authorPk = new PublicKey(author);
    const postId = parseInt(postIdStr);
    const connection = new Connection(RPC_URL, "confirmed");
    const treasury = getTreasuryKeypair();

    // Block treasury as user
    if (userPk.equals(treasury.publicKey)) {
      return NextResponse.json(
        { error: { message: "Invalid account" } },
        { status: 403, headers: ACTION_HEADERS }
      );
    }

    // Verify post exists
    const postResult = await fetchPost(connection, authorPk, postId);
    if (!postResult) {
      return NextResponse.json(
        { error: { message: "Post not found on-chain" } },
        { status: 404, headers: ACTION_HEADERS }
      );
    }

    const profile = await fetchProfile(connection, authorPk);
    const username = profile?.username || author.slice(0, 8);

    const tx = new Transaction();
    let message = "";

    if (actionType === "like") {
      // ── LIKE: requires user to have a Shyft profile ──
      const [profilePda] = getProfilePda(userPk);

      // Check if user has a profile
      const program = getProgram(connection, treasury);
      let hasProfile = false;
      try {
        await (program.account as any).profile.fetch(profilePda);
        hasProfile = true;
      } catch {}

      if (!hasProfile) {
        // Can't like without a profile — return a helpful error
        return NextResponse.json(
          {
            error: {
              message: "You need a Shyft profile to like posts. Visit shyft.lol to sign up!",
            },
          },
          { status: 422, headers: ACTION_HEADERS }
        );
      }

      const [postPda] = getPostPda(authorPk, postId);
      const [likeRecordPda] = getLikeRecordPda(postPda, userPk);
      const ix = await program.methods
        .likePost(new BN(postId))
        .accountsPartial({ post: postPda, profile: profilePda, likeRecord: likeRecordPda, user: userPk, payer: treasury.publicKey, systemProgram: SystemProgram.programId })
        .instruction();

      tx.add(ix);
      message = `❤️ Liked @${username}'s post on Shyft!`;

    } else if (actionType === "tip") {
      // ── TIP: simple SOL transfer — no profile needed! ──
      const amount = parseFloat(amountStr || "0.01");
      if (amount <= 0 || amount > 10) {
        return NextResponse.json(
          { error: { message: "Tip amount must be between 0.001 and 10 SOL" } },
          { status: 400, headers: ACTION_HEADERS }
        );
      }

      // Transfer SOL directly from user → post author
      const transferIx = SystemProgram.transfer({
        fromPubkey: userPk,
        toPubkey: authorPk,
        lamports: Math.round(amount * LAMPORTS_PER_SOL),
      });

      tx.add(transferIx);
      message = `💸 Tipped @${username} ${amount} SOL on Shyft!`;

    } else if (actionType === "react") {
      // ── REACT: emoji reaction (heart by default) ──
      const reactionType = parseInt(searchParams.get("reactionType") || "0");
      const [profilePda] = getProfilePda(userPk);
      const [postPda] = getPostPda(authorPk, postId);
      const [reactionPda] = getReactionPda(postPda, userPk);
      const program = getProgram(connection, treasury);

      // Check profile exists
      let hasProfile = false;
      try {
        await (program.account as any).profile.fetch(profilePda);
        hasProfile = true;
      } catch {}

      if (!hasProfile) {
        return NextResponse.json(
          { error: { message: "You need a Shyft profile to react. Visit shyft.lol to sign up!" } },
          { status: 422, headers: ACTION_HEADERS }
        );
      }

      const ix = await program.methods
        .reactToPost(new BN(postId), reactionType)
        .accountsPartial({
          reaction: reactionPda,
          post: postPda,
          reactorProfile: profilePda,
          user: userPk,
          payer: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      tx.add(ix);
      const emojis = ["❤️", "🔥", "🚀", "😂", "👏", "💡"];
      message = `${emojis[reactionType] || "❤️"} Reacted to @${username}'s post on Shyft!`;

    } else {
      return NextResponse.json(
        { error: { message: `Unknown action: ${actionType}` } },
        { status: 400, headers: ACTION_HEADERS }
      );
    }

    // For tips, the user is the fee payer (they're sending SOL anyway)
    // For likes/reacts, treasury pays fees (gasless UX)
    if (actionType === "tip") {
      tx.feePayer = userPk;
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      // No treasury signature needed — user pays and signs
    } else {
      tx.feePayer = treasury.publicKey;
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.partialSign(treasury);
    }

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    console.log(`⚡ Blink: ${actionType} on post by @${username} from ${userAccount.slice(0, 8)}`);

    return NextResponse.json(
      {
        transaction: serialized.toString("base64"),
        message,
      },
      { headers: ACTION_HEADERS }
    );
  } catch (err: any) {
    console.error("Actions POST error:", err);
    return NextResponse.json(
      { error: { message: err?.message || "Failed to build transaction" } },
      { status: 500, headers: ACTION_HEADERS }
    );
  }
}
