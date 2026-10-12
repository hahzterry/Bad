import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { Program, AnchorProvider, Idl, Wallet } from "@coral-xyz/anchor";

import idl from "@/lib/idl.json";
import {
  loadAllRegistrations,
  loadSeenState,
  saveSeenState,
  type SeenState,
} from "@/lib/push-storage";
import { pushToWallets } from "@/lib/expo-push";

/**
 * Server-side push cron worker.
 *
 * Runs on a Vercel cron (see vercel.json) every minute. Polls on-chain for new
 * activity affecting any wallet that has registered a push token, then sends
 * Expo push notifications. This is what makes notifications work even when
 * the app is FORCE-QUIT (the in-app `useNotifications` hook only runs while
 * the app process is alive).
 *
 * Auth: requires header `authorization: Bearer ${CRON_SECRET}` OR `?secret=...`.
 *       Vercel automatically injects `Authorization: Bearer ${CRON_SECRET}` for
 *       its built-in cron, so this works out of the box.
 *
 * Cold-start safety: the FIRST run after state is empty just SEEDS existing
 * on-chain keys as "seen" without firing pushes — same pattern as the mobile
 * client. Prevents historical-event flooding.
 */

export const runtime = "nodejs";
export const maxDuration = 60; // seconds — cron should finish well under this

const PROGRAM_ID = new PublicKey("EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ");
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;
const REACTIONS_EMOJI = ["❤️", "🔥", "🚀", "😂", "👏", "💡"];

// Notifications-per-wallet cap per cron tick (avoid spam after long downtime)
const PER_WALLET_PUSH_CAP = 5;

// ────────────────────────────────────────────────────────────────────────
// Auth
// ────────────────────────────────────────────────────────────────────────
function isAuthorised(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // unset = open in dev
  const headerSecret = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return headerSecret === expected || querySecret === expected;
}

// ────────────────────────────────────────────────────────────────────────
// Anchor program (read-only — uses a throwaway keypair as wallet)
// ────────────────────────────────────────────────────────────────────────
function getReadOnlyProgram(): Program {
  const conn = new Connection(RPC_URL, "confirmed");
  const dummy = Keypair.generate();
  const wallet: Wallet = {
    publicKey: dummy.publicKey,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any) => txs,
    payer: dummy,
  };
  const provider = new AnchorProvider(conn, wallet, { commitment: "confirmed" });
  return new Program(idl as Idl, provider);
}

// ────────────────────────────────────────────────────────────────────────
// Mention regex builder
// ────────────────────────────────────────────────────────────────────────
function buildMentionRegex(username: string): RegExp {
  const safe = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${safe}\\b`, "i");
}

// ────────────────────────────────────────────────────────────────────────
// Notification builder helpers
// ────────────────────────────────────────────────────────────────────────
function actorLabel(addr: string, profileMap: Record<string, any>): string {
  const p = profileMap[addr];
  if (p?.displayName && p.displayName !== "Anonymous") return p.displayName;
  if (p?.username && p.username !== "anon") return `@${p.username}`;
  if (!addr) return "Someone";
  return addr.slice(0, 4) + "…" + addr.slice(-4);
}

function trim(s: string | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ────────────────────────────────────────────────────────────────────────
// Core cron handler
// ────────────────────────────────────────────────────────────────────────
async function runCron(): Promise<{
  ok: true;
  durationMs: number;
  registeredWallets: number;
  newKeys: number;
  pushedNotifications: number;
  pushedWallets: number;
  seeded?: boolean;
  reason?: string;
}> {
  const t0 = Date.now();

  // 1. Who do we even need to push for?
  const registry = await loadAllRegistrations();
  const registeredWallets = new Set(Object.keys(registry));
  if (registeredWallets.size === 0) {
    return {
      ok: true,
      durationMs: Date.now() - t0,
      registeredWallets: 0,
      newKeys: 0,
      pushedNotifications: 0,
      pushedWallets: 0,
      reason: "no registered wallets",
    };
  }

  // 2. Load seen state
  const state: SeenState = await loadSeenState();
  const seen = new Set(state.keys);
  const isSeeding = state.seededAt === 0;

  // 3. Fetch all relevant on-chain accounts in parallel
  const program = getReadOnlyProgram();
  const accounts: any = program.account;
  const [comments, reactions, follows, posts, profiles] = await Promise.all([
    accounts.comment.all().catch(() => [] as any[]),
    accounts.reaction.all().catch(() => [] as any[]),
    accounts.followAccount.all().catch(() => [] as any[]),
    accounts.post.all().catch(() => [] as any[]),
    accounts.profile.all().catch(() => [] as any[]),
  ]);

  // 4. Build lookup maps
  const profileMap: Record<string, any> = {};
  const usernameToWallet: Record<string, string> = {};
  for (const p of profiles) {
    const owner = p.account.owner.toBase58();
    profileMap[owner] = {
      owner,
      username: p.account.username,
      displayName: p.account.displayName,
    };
    if (p.account.username) {
      usernameToWallet[p.account.username.toLowerCase()] = owner;
    }
  }

  // post pubkey -> { author, content }
  const postMap: Record<string, { author: string; content: string; likes: number }> = {};
  for (const p of posts) {
    postMap[p.publicKey.toBase58()] = {
      author: p.account.author.toBase58(),
      content: p.account.content || "",
      likes: Number(p.account.likes || 0),
    };
  }

  // 5. Build event list, filter to events where the *recipient* is registered
  type Event = {
    /** Wallet who SHOULD get pushed */
    recipient: string;
    /** Stable on-chain dedupe key */
    key: string;
    title: string;
    body: string;
    data: Record<string, any>;
    /** For interleaved capping per wallet */
    timestamp: number;
  };

  const events: Event[] = [];

  // ── Comments on posts owned by registered users
  for (const c of comments) {
    const postKey = c.account.post.toBase58();
    const post = postMap[postKey];
    if (!post) continue;
    const recipient = post.author;
    const author = c.account.author.toBase58();
    if (author === recipient) continue;
    if (!registeredWallets.has(recipient)) continue;
    const key = `comment:${c.publicKey.toBase58()}`;
    if (seen.has(key)) continue;
    events.push({
      recipient,
      key,
      title: "💬 New comment",
      body: `${actorLabel(author, profileMap)}: ${trim(c.account.content, 100)}`,
      data: { type: "comment", postKey, actorAddress: author },
      timestamp: Number(c.account.createdAt || 0) * 1000 || Date.now(),
    });
  }

  // ── Reactions on posts owned by registered users
  for (const r of reactions) {
    const postKey = r.account.post.toBase58();
    const post = postMap[postKey];
    if (!post) continue;
    const recipient = post.author;
    const user = r.account.user.toBase58();
    if (user === recipient) continue;
    if (!registeredWallets.has(recipient)) continue;
    const key = `reaction:${r.publicKey.toBase58()}`;
    if (seen.has(key)) continue;
    const emoji = REACTIONS_EMOJI[Number(r.account.reactionType) || 0] || "👍";
    events.push({
      recipient,
      key,
      title: `${emoji} New reaction`,
      body: `${actorLabel(user, profileMap)} reacted to "${trim(post.content, 40)}"`,
      data: { type: "reaction", postKey, actorAddress: user },
      timestamp: Date.now(),
    });
  }

  // ── New follows of registered users
  for (const f of follows) {
    const recipient = f.account.following.toBase58();
    const follower = f.account.follower.toBase58();
    if (follower === recipient) continue;
    if (!registeredWallets.has(recipient)) continue;
    const key = `follow:${f.publicKey.toBase58()}`;
    if (seen.has(key)) continue;
    events.push({
      recipient,
      key,
      title: "➕ New follower",
      body: `${actorLabel(follower, profileMap)} started following you`,
      data: { type: "follow", actorAddress: follower },
      timestamp: Date.now(),
    });
  }

  // ── Mentions + reposts in posts (scan for @username matches)
  for (const p of posts) {
    const author = p.account.author.toBase58();
    const content: string = p.account.content || "";
    if (!content) continue;

    // Mention scan — only against registered wallets' usernames
    // (cheaper than running every regex against every post)
    const lower = content.toLowerCase();

    for (const recipient of registeredWallets) {
      if (recipient === author) continue;
      const username = profileMap[recipient]?.username?.toLowerCase();
      if (!username) continue;

      const isNewRepost = lower.startsWith(`rt|@${username}|`);
      const mentionRegex = buildMentionRegex(username);
      const isMention = mentionRegex.test(content);
      if (!isMention && !isNewRepost) continue;

      if (isNewRepost) {
        const key = `repost:${p.publicKey.toBase58()}:${recipient}`;
        if (seen.has(key)) continue;
        events.push({
          recipient,
          key,
          title: "🔁 New repost",
          body: `${actorLabel(author, profileMap)} reposted your post`,
          data: {
            type: "repost",
            postKey: p.publicKey.toBase58(),
            actorAddress: author,
          },
          timestamp: Number(p.account.createdAt || 0) * 1000 || Date.now(),
        });
      } else {
        const key = `mention:post:${p.publicKey.toBase58()}:${recipient}`;
        if (seen.has(key)) continue;
        events.push({
          recipient,
          key,
          title: "@ You were mentioned",
          body: `${actorLabel(author, profileMap)}: ${trim(content, 100)}`,
          data: {
            type: "mention",
            postKey: p.publicKey.toBase58(),
            actorAddress: author,
          },
          timestamp: Number(p.account.createdAt || 0) * 1000 || Date.now(),
        });
      }
    }
  }

  // ── Mentions in comments
  for (const c of comments) {
    const author = c.account.author.toBase58();
    const content: string = c.account.content || "";
    if (!content) continue;

    for (const recipient of registeredWallets) {
      if (recipient === author) continue;
      const username = profileMap[recipient]?.username?.toLowerCase();
      if (!username) continue;
      const mentionRegex = buildMentionRegex(username);
      if (!mentionRegex.test(content)) continue;
      const key = `mention:comment:${c.publicKey.toBase58()}:${recipient}`;
      if (seen.has(key)) continue;
      events.push({
        recipient,
        key,
        title: "@ You were mentioned",
        body: `${actorLabel(author, profileMap)}: ${trim(content, 100)}`,
        data: {
          type: "mention",
          postKey: c.account.post.toBase58(),
          actorAddress: author,
        },
        timestamp: Number(c.account.createdAt || 0) * 1000 || Date.now(),
      });
    }
  }

  // 6. Persist newly-seen keys regardless of seeding mode
  const newKeys = events.map((e) => e.key);

  // 7. If seeding, just record keys + don't push
  if (isSeeding) {
    state.keys = [...state.keys, ...newKeys];
    state.seededAt = Date.now();
    state.lastRunAt = Date.now();
    await saveSeenState(state);
    return {
      ok: true,
      durationMs: Date.now() - t0,
      registeredWallets: registeredWallets.size,
      newKeys: newKeys.length,
      pushedNotifications: 0,
      pushedWallets: 0,
      seeded: true,
    };
  }

  // 8. Group events by recipient + cap per-wallet
  const byRecipient: Record<string, Event[]> = {};
  for (const ev of events) {
    (byRecipient[ev.recipient] ||= []).push(ev);
  }

  // For each recipient, sort newest first, take top N, send batched into a
  // single grouped push if more than 1 (avoid notification floods).
  let totalPushed = 0;
  let walletsPushed = 0;

  for (const [recipient, evs] of Object.entries(byRecipient)) {
    evs.sort((a, b) => b.timestamp - a.timestamp);
    const slice = evs.slice(0, PER_WALLET_PUSH_CAP);
    if (slice.length === 0) continue;

    walletsPushed++;

    if (slice.length === 1) {
      const ev = slice[0];
      await pushToWallets(
        [recipient],
        {
          title: ev.title,
          body: ev.body,
          data: ev.data,
          channelId: "default",
          sound: "default",
        },
        registry,
      );
      totalPushed += 1;
    } else {
      // Send each as its own banner so they stack — up to cap
      for (const ev of slice) {
        // eslint-disable-next-line no-await-in-loop
        await pushToWallets(
          [recipient],
          {
            title: ev.title,
            body: ev.body,
            data: ev.data,
            channelId: "default",
            sound: "default",
          },
          registry,
        );
        totalPushed += 1;
      }
      // If more were truncated, send a "+N more" summary
      if (evs.length > PER_WALLET_PUSH_CAP) {
        const extra = evs.length - PER_WALLET_PUSH_CAP;
        // eslint-disable-next-line no-await-in-loop
        await pushToWallets(
          [recipient],
          {
            title: "Shyft",
            body: `+${extra} more new activities`,
            data: { type: "summary" },
            channelId: "default",
            sound: "default",
          },
          registry,
        );
        totalPushed += 1;
      }
    }
  }

  // 9. Persist seen keys
  state.keys = [...state.keys, ...newKeys];
  state.lastRunAt = Date.now();
  await saveSeenState(state);

  return {
    ok: true,
    durationMs: Date.now() - t0,
    registeredWallets: registeredWallets.size,
    newKeys: newKeys.length,
    pushedNotifications: totalPushed,
    pushedWallets: walletsPushed,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Route handlers
// ────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runCron();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("push/cron error:", err);
    return NextResponse.json(
      { error: err?.message || "internal error" },
      { status: 500 },
    );
  }
}

export const POST = GET;
