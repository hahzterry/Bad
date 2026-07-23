// Shyft Quests — server-side award engine.
//
// Two KV namespaces (see push-storage.ts for the backend):
//   quests-s{N}-social — written ONLY by the tally (cron / lazy refresh)
//   quests-s{N}-trades — written ONLY by /api/quests/trade
// Readers merge both, so the two writers never race each other.
//
// Social points are derived from on-chain program accounts (same read
// pattern as push/cron): every new account key is diffed against seenKeys
// and awarded to the ACTOR (author/liker/follower/…), respecting daily
// caps. Accounts with a created_at land in their true UTC day; the few
// without a timestamp (Reaction, FollowAccount) count on first-seen day.
//
// First tally run SEEDS existing keys without awarding — the season
// starts at seeding, history doesn't count.

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Idl, Wallet } from "@coral-xyz/anchor";

import idl from "@/lib/idl.json";
import { loadJson, saveJson } from "@/lib/push-storage";
import {
  SEASON_ID,
  SOCIAL_ACTIONS,
  computeStreak,
  dayKey,
  streakMultiplier,
} from "@/lib/quests";

const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;

const SOCIAL_NS = `quests-s${SEASON_ID}-social`;
const TRADES_NS = `quests-s${SEASON_ID}-trades`;

const SEEN_KEYS_CAP = 100_000;
const SIGS_CAP = 20_000;
const ACTIVE_DAYS_CAP = 180;
const DAY_COUNTS_KEEP_DAYS = 45;
/** Ignore timestamped actions older than this — pre-season / pre-outage noise. */
const MAX_ACTION_AGE_DAYS = 7;

// ────────────────────────────────────────────────────────────────────────
// State shapes
// ────────────────────────────────────────────────────────────────────────
export type SocialWallet = {
  points: number;
  activeDays: string[];
  /** day -> action -> count already awarded (for daily caps) */
  dayCounts: Record<string, Record<string, number>>;
};

export type SocialState = {
  seededAt: number;
  lastRunAt: number;
  seenKeys: string[];
  wallets: Record<string, SocialWallet>;
  /** wallet -> display handle, refreshed each tally (for the leaderboard) */
  names: Record<string, string>;
};

export type TradeDay = {
  count: number;
  mints: string[];
  volUsd: number;
  multiBonusPaid: boolean;
};

export type TradeWallet = {
  points: number;
  volumeUsd: number;
  activeDays: string[];
  days: Record<string, TradeDay>;
};

export type TradesState = {
  sigs: string[];
  wallets: Record<string, TradeWallet>;
};

const EMPTY_SOCIAL: SocialState = {
  seededAt: 0,
  lastRunAt: 0,
  seenKeys: [],
  wallets: {},
  names: {},
};
const EMPTY_TRADES: TradesState = { sigs: [], wallets: {} };

export async function loadSocial(): Promise<SocialState> {
  const s = await loadJson<SocialState>(SOCIAL_NS, EMPTY_SOCIAL);
  return { ...EMPTY_SOCIAL, ...s };
}
export async function saveSocial(s: SocialState) {
  if (s.seenKeys.length > SEEN_KEYS_CAP) s.seenKeys = s.seenKeys.slice(-SEEN_KEYS_CAP);
  return saveJson(SOCIAL_NS, s);
}
export async function loadTrades(): Promise<TradesState> {
  const s = await loadJson<TradesState>(TRADES_NS, EMPTY_TRADES);
  return { ...EMPTY_TRADES, ...s };
}
export async function saveTrades(s: TradesState) {
  if (s.sigs.length > SIGS_CAP) s.sigs = s.sigs.slice(-SIGS_CAP);
  return saveJson(TRADES_NS, s);
}

export function emptySocialWallet(): SocialWallet {
  return { points: 0, activeDays: [], dayCounts: {} };
}
export function emptyTradeWallet(): TradeWallet {
  return { points: 0, volumeUsd: 0, activeDays: [], days: {} };
}

function pushActiveDay(days: string[], day: string) {
  if (!days.includes(day)) {
    days.push(day);
    if (days.length > ACTIVE_DAYS_CAP) days.splice(0, days.length - ACTIVE_DAYS_CAP);
  }
}

function pruneDayCounts(w: SocialWallet, nowMs: number) {
  const cutoff = dayKey(nowMs - DAY_COUNTS_KEEP_DAYS * 86_400_000);
  for (const d of Object.keys(w.dayCounts)) {
    if (d < cutoff) delete w.dayCounts[d];
  }
}

/** Merged streak across social + trade activity. */
export function mergedStreak(
  sw: SocialWallet | undefined,
  tw: TradeWallet | undefined,
  nowMs = Date.now(),
): number {
  const days = new Set<string>([
    ...(sw?.activeDays ?? []),
    ...(tw?.activeDays ?? []),
  ]);
  return computeStreak(days, nowMs);
}

/**
 * Award one social action to a wallet. Returns points granted
 * (0 when the daily cap for that action is already hit).
 */
export function awardSocial(
  w: SocialWallet,
  action: string,
  day: string,
  multiplier: number,
): number {
  const cfg = SOCIAL_ACTIONS[action];
  if (!cfg) return 0;
  const counts = (w.dayCounts[day] ||= {});
  const used = counts[action] || 0;
  if (used >= cfg.dailyCap) return 0;
  counts[action] = used + 1;
  const pts = Math.round(cfg.points * multiplier);
  w.points += pts;
  pushActiveDay(w.activeDays, day);
  return pts;
}

// ────────────────────────────────────────────────────────────────────────
// On-chain tally
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

type RawAction = {
  key: string;      // stable dedupe key
  wallet: string;   // the actor who earns
  action: keyof typeof SOCIAL_ACTIONS | string;
  /** ms timestamp, 0 = unknown (attribute to "now") */
  ts: number;
};

const secs = (v: any): number => (Number(v || 0) || 0) * 1000;

export async function runSocialTally(): Promise<{
  seeded: boolean;
  newActions: number;
  pointsAwarded: number;
  wallets: number;
  durationMs: number;
}> {
  const t0 = Date.now();
  const state = await loadSocial();
  const trades = await loadTrades(); // read-only, for streak calc
  const seen = new Set(state.seenKeys);
  const isSeeding = state.seededAt === 0;

  const program = getReadOnlyProgram();
  const accounts: any = program.account;
  const [posts, comments, likeRecords, reactions, follows, votes, memberships, profiles] =
    await Promise.all([
      accounts.post.all().catch(() => [] as any[]),
      accounts.comment.all().catch(() => [] as any[]),
      accounts.likeRecord.all().catch(() => [] as any[]),
      accounts.reaction.all().catch(() => [] as any[]),
      accounts.followAccount.all().catch(() => [] as any[]),
      accounts.pollVote.all().catch(() => [] as any[]),
      accounts.membership.all().catch(() => [] as any[]),
      accounts.profile.all().catch(() => [] as any[]),
    ]);

  // Refresh leaderboard name map every run
  const names: Record<string, string> = {};
  for (const p of profiles) {
    const owner = p.account.owner.toBase58();
    const label =
      (p.account.displayName && p.account.displayName !== "Anonymous" && p.account.displayName) ||
      (p.account.username && p.account.username !== "anon" && `@${p.account.username}`) ||
      "";
    if (label) names[owner] = label;
  }
  state.names = names;

  const raw: RawAction[] = [];
  for (const a of posts)
    raw.push({ key: `post:${a.publicKey.toBase58()}`, wallet: a.account.author.toBase58(), action: "post", ts: secs(a.account.createdAt) });
  for (const a of comments)
    raw.push({ key: `comment:${a.publicKey.toBase58()}`, wallet: a.account.author.toBase58(), action: "comment", ts: secs(a.account.createdAt) });
  for (const a of likeRecords)
    raw.push({ key: `like:${a.publicKey.toBase58()}`, wallet: a.account.liker.toBase58(), action: "like", ts: secs(a.account.likedAt) });
  for (const a of reactions)
    raw.push({ key: `reaction:${a.publicKey.toBase58()}`, wallet: a.account.user.toBase58(), action: "like", ts: 0 });
  for (const a of follows)
    raw.push({ key: `follow:${a.publicKey.toBase58()}`, wallet: a.account.follower.toBase58(), action: "follow", ts: 0 });
  for (const a of votes)
    raw.push({ key: `vote:${a.publicKey.toBase58()}`, wallet: a.account.voter.toBase58(), action: "vote", ts: secs(a.account.votedAt) });
  for (const a of memberships)
    raw.push({ key: `join:${a.publicKey.toBase58()}`, wallet: a.account.member.toBase58(), action: "join", ts: secs(a.account.joinedAt) });

  const fresh = raw.filter((r) => !seen.has(r.key));
  const now = Date.now();

  if (isSeeding) {
    state.seenKeys.push(...fresh.map((r) => r.key));
    state.seededAt = now;
    state.lastRunAt = now;
    await saveSocial(state);
    return { seeded: true, newActions: fresh.length, pointsAwarded: 0, wallets: 0, durationMs: Date.now() - t0 };
  }

  // Oldest first so daily caps fill chronologically
  fresh.sort((a, b) => (a.ts || now) - (b.ts || now));

  const maxAge = MAX_ACTION_AGE_DAYS * 86_400_000;
  let pointsAwarded = 0;
  const touched = new Set<string>();
  // Streak multiplier snapshot per wallet, computed once per run
  const multCache = new Map<string, number>();

  for (const r of fresh) {
    state.seenKeys.push(r.key);
    const ts = r.ts && now - r.ts <= maxAge ? r.ts : r.ts === 0 ? now : 0;
    if (ts === 0) continue; // timestamped but too old — count as seen, no points
    const w = (state.wallets[r.wallet] ||= emptySocialWallet());
    let mult = multCache.get(r.wallet);
    if (mult === undefined) {
      mult = streakMultiplier(mergedStreak(w, trades.wallets[r.wallet], now));
      multCache.set(r.wallet, mult);
    }
    const pts = awardSocial(w, r.action, dayKey(ts), mult);
    if (pts > 0) {
      pointsAwarded += pts;
      touched.add(r.wallet);
    }
  }

  for (const wallet of touched) pruneDayCounts(state.wallets[wallet], now);
  state.lastRunAt = now;
  await saveSocial(state);

  return { seeded: false, newActions: fresh.length, pointsAwarded, wallets: touched.size, durationMs: Date.now() - t0 };
}

// ────────────────────────────────────────────────────────────────────────
// SOL price (for trade volume → USD), cached 5 min
// ────────────────────────────────────────────────────────────────────────
const SOL_MINT = "So11111111111111111111111111111111111111112";
const PRICE_TTL = 5 * 60_000;
const PRICE_FALLBACK = 150;
let priceCache: { usd: number; fetchedAt: number } | null = null;

export async function getSolPriceUsd(): Promise<number> {
  if (priceCache && Date.now() - priceCache.fetchedAt < PRICE_TTL) return priceCache.usd;
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`, {
      cache: "no-store",
    });
    const json = await res.json();
    const usd = Number(json?.[SOL_MINT]?.usdPrice || json?.data?.[SOL_MINT]?.price || 0);
    if (usd > 0) {
      priceCache = { usd, fetchedAt: Date.now() };
      return usd;
    }
  } catch {
    /* fall through */
  }
  return priceCache?.usd ?? PRICE_FALLBACK;
}

// ────────────────────────────────────────────────────────────────────────
// Trade verification — the caller reports a confirmed swap signature;
// we verify it on-chain (wallet signed it, it succeeded, it's recent)
// and derive volume from the wallet's SOL balance delta.
// ────────────────────────────────────────────────────────────────────────
/** Reject reported trades older than this (no farming old history). */
const MAX_TRADE_AGE_MS = 6 * 60 * 60 * 1000;

export type VerifiedTrade = {
  volumeSol: number;
  mints: string[];
  blockTimeMs: number;
};

export async function verifyTradeOnChain(
  wallet: string,
  signature: string,
): Promise<VerifiedTrade | { error: string }> {
  const conn = new Connection(RPC_URL, "confirmed");
  const tx = await conn
    .getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    })
    .catch(() => null);

  if (!tx) return { error: "transaction not found" };
  if (tx.meta?.err) return { error: "transaction failed" };

  const blockTimeMs = (tx.blockTime || 0) * 1000;
  if (!blockTimeMs || Date.now() - blockTimeMs > MAX_TRADE_AGE_MS)
    return { error: "transaction too old" };

  const keys = tx.transaction.message.accountKeys;
  const idx = keys.findIndex((k) => k.pubkey.toBase58() === wallet);
  if (idx === -1 || !keys[idx].signer) return { error: "wallet did not sign this transaction" };

  const pre = tx.meta?.preBalances?.[idx] ?? 0;
  const post = tx.meta?.postBalances?.[idx] ?? 0;
  const volumeSol = Math.abs(post - pre) / 1e9;
  if (volumeSol <= 0) return { error: "no volume detected" };

  // Distinct mints the wallet's token accounts touched (for the 3-token bonus)
  const mints = new Set<string>();
  for (const tb of [...(tx.meta?.preTokenBalances || []), ...(tx.meta?.postTokenBalances || [])]) {
    if (tb.owner === wallet && tb.mint && tb.mint !== SOL_MINT) mints.add(tb.mint);
  }

  return { volumeSol, mints: [...mints], blockTimeMs };
}
