// Shyft — Activation Campaign.
//
// 100 slots. Each user reserves one, then has a 7-day window to complete
// the tasks. Slots that go stale are released back to the pool so a wave
// of tyre-kickers on day one can't lock the campaign shut.
//
// Everything here is server-authoritative on purpose: the client is told
// whether the campaign is open, never trusted to decide it.

import { SOCIAL_ACTIONS, dayKey } from "./quests";
import { loadSocial, runSocialTally, type SocialWallet } from "./quests-engine";
import {
  markDeviceRewarded,
  releaseDeviceSlot,
  queryDeviceBits,
} from "./devicecheck";

// ────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────

export const CAMPAIGN_ID = "activation-s1";

/** Hard cap on rewards paid. The banner disappears once these are gone. */
export const TOTAL_SLOTS = 100;

/** Reward per qualified user. */
export const REWARD = { amount: 5, currency: "USD", paidIn: "SHYFT" } as const;

/** Days a reserved slot stays alive before it's released back to the pool. */
export const WINDOW_DAYS = 7;
export const SLOT_TTL_DAYS = 14;

/** Days that must be fully complete (not necessarily consecutive). */
export const REQUIRED_COMPLETE_DAYS = 5;

/**
 * Daily tasks — reset at 00:00 UTC, same day boundary the quests engine
 * uses. Targets sit at or under each action's `dailyCap` in quests.ts so
 * a completed day always maxes the available points too.
 */
export const DAILY_TASKS = [
  { action: "post", target: 2, label: "Post", icon: "create-outline" },
  { action: "like", target: 5, label: "Like posts", icon: "heart-outline" },
  { action: "comment", target: 5, label: "Comment", icon: "chatbubble-outline" },
] as const;

/** One-time tasks — tick once and stay ticked for the rest of the campaign. */
export const FOLLOW_TARGET = 10;

export type TaskState = {
  key: string;
  label: string;
  icon: string;
  done: number;
  target: number;
  complete: boolean;
};

export type CampaignProgress = {
  slot: SlotRecord | null;
  /** Day index within the window, 1-based. 0 when no slot is held. */
  currentDay: number;
  windowDays: number;
  oneTime: TaskState[];
  daily: TaskState[];
  /** One entry per window day, oldest first — drives the dot strip. */
  dayHistory: { day: string; complete: boolean; isToday: boolean; isFuture: boolean }[];
  completeDays: number;
  requiredDays: number;
  /** Profile + username registry record both present. Enforced, not displayed. */
  eligible: boolean;
  qualified: boolean;
  /** When the review hold ends and payout can be sent. Null until qualified. */
  payoutReleasesAt: number | null;
  /** ms until the daily tasks reset. */
  resetsInMs: number;
};

/** Hours a qualified run is held before it can be paid, so review has time. */
export const PAYOUT_HOLD_HOURS = 72;

export type SlotStatus = "active" | "qualified" | "paid" | "rejected";

export type SlotRecord = {
  deviceId: string;
  wallet: string;
  startedAt: number;
  ip?: string;
  asn?: string;
  status: SlotStatus;
  /** Apple DeviceCheck token, kept so the bit can be set at payout time. */
  deviceToken?: string;
  qualifiedAt?: number;
  paidAt?: number;
  payoutTx?: string;
  rejectedReason?: string;
  reviewNote?: string;
};

// ────────────────────────────────────────────────────────────────────────
// Redis (Upstash REST)
//
// Unlike push-storage.ts, there is deliberately NO /tmp fallback here. That
// fallback is per-instance and ephemeral on Vercel, which would let the
// 100-slot cap be exceeded silently — the one failure mode that costs real
// money. Missing config is a hard error instead.
// ────────────────────────────────────────────────────────────────────────

const KV_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const KV_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

export const KV_CONFIGURED = !!(KV_URL && KV_TOKEN);

/**
 * Local-development backend, so the app can be run end-to-end without an
 * Upstash instance. Explicitly impossible in production — Vercel sets
 * NODE_ENV=production for both production and preview deploys, so a missing
 * config there still throws rather than silently uncapping the slots.
 */
const DEV_MEMORY = !KV_CONFIGURED && process.env.NODE_ENV !== "production";

// Held on globalThis: Next's dev server gives each route its own instance of
// this module and re-evaluates it on hot reload, so a module-level Map would
// leave every route with a different (and short-lived) store.
const devGlobal = globalThis as typeof globalThis & {
  __shyftCampaignMem?: { slots: Set<string>; kv: Map<string, string> };
};
const mem = (devGlobal.__shyftCampaignMem ??= {
  slots: new Set<string>(),
  kv: new Map<string, string>(),
});

if (DEV_MEMORY) {
  console.log("🎯 campaign: in-memory dev backend (state resets on restart)");
}

class CampaignConfigError extends Error {}

async function redis<T = unknown>(...cmd: (string | number)[]): Promise<T> {
  if (!KV_CONFIGURED) {
    throw new CampaignConfigError(
      "Campaign requires UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN. " +
        "Refusing to fall back to ephemeral storage — the slot cap would not hold.",
    );
  }
  const resp = await fetch(KV_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd.map(String)),
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`redis ${cmd[0]} failed: ${resp.status}`);
  const json = (await resp.json()) as { result?: T; error?: string };
  if (json.error) throw new Error(`redis ${cmd[0]}: ${json.error}`);
  return json.result as T;
}

const kSlots = () => `shyft:campaign:${CAMPAIGN_ID}:slots`;
const kSlot = (deviceId: string) =>
  `shyft:campaign:${CAMPAIGN_ID}:slot:${deviceId}`;
const kWallet = (wallet: string) =>
  `shyft:campaign:${CAMPAIGN_ID}:wallet:${wallet}`;

// ────────────────────────────────────────────────────────────────────────
// Slots
// ────────────────────────────────────────────────────────────────────────

/**
 * Claim a slot atomically.
 *
 * A SET keyed by device (rather than an INCR counter) makes this idempotent:
 * a double-tap or a retry re-reads as already-a-member instead of burning a
 * second slot. The check-and-add runs inside one Lua script so a rush can't
 * interleave SCARD and SADD and overshoot the cap.
 *
 * Returns "claimed" | "already" | "full".
 */
const RESERVE_LUA = `
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then return 'already' end
if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 'full' end
redis.call('SADD', KEYS[1], ARGV[1])
return 'claimed'
`;

async function claim(deviceId: string): Promise<"claimed" | "already" | "full"> {
  if (DEV_MEMORY) {
    if (mem.slots.has(deviceId)) return "already";
    if (mem.slots.size >= TOTAL_SLOTS) return "full";
    mem.slots.add(deviceId);
    return "claimed";
  }
  return redis<"claimed" | "already" | "full">(
    "EVAL",
    RESERVE_LUA,
    1,
    kSlots(),
    deviceId,
    TOTAL_SLOTS,
  );
}

async function putStr(key: string, value: string, ttlSec: number) {
  if (DEV_MEMORY) {
    mem.kv.set(key, value);
    return;
  }
  await redis("SET", key, value, "EX", ttlSec);
}

async function getStr(key: string): Promise<string | null> {
  if (DEV_MEMORY) return mem.kv.get(key) ?? null;
  return redis<string | null>("GET", key);
}

export async function reserveSlot(
  deviceId: string,
  wallet: string,
  meta: { ip?: string; asn?: string; deviceToken?: string } = {},
): Promise<{ result: "claimed" | "already" | "full"; slot: SlotRecord | null }> {
  const result = await claim(deviceId);

  if (result === "full") return { result, slot: null };

  if (result === "claimed") {
    const slot: SlotRecord = {
      deviceId,
      wallet,
      startedAt: Date.now(),
      ...meta,
      status: "active",
    };
    const ttl = SLOT_TTL_DAYS * 86400;
    await putStr(kSlot(deviceId), JSON.stringify(slot), ttl);
    await putStr(kWallet(wallet), deviceId, ttl);
    return { result, slot };
  }

  return { result, slot: await getSlot(deviceId) };
}

export async function getSlot(deviceId: string): Promise<SlotRecord | null> {
  const raw = await getStr(kSlot(deviceId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SlotRecord;
  } catch {
    return null;
  }
}

export async function getSlotByWallet(wallet: string): Promise<SlotRecord | null> {
  const deviceId = await getStr(kWallet(wallet));
  return deviceId ? getSlot(deviceId) : null;
}

export async function slotsTaken(): Promise<number> {
  if (DEV_MEMORY) return mem.slots.size;
  return (await redis<number>("SCARD", kSlots())) ?? 0;
}

export async function campaignStatus() {
  const taken = await slotsTaken();
  const remaining = Math.max(0, TOTAL_SLOTS - taken);
  return {
    campaignId: CAMPAIGN_ID,
    open: remaining > 0,
    total: TOTAL_SLOTS,
    taken,
    remaining,
    reward: REWARD,
    windowDays: WINDOW_DAYS,
    requiredDays: REQUIRED_COMPLETE_DAYS,
    followTarget: FOLLOW_TARGET,
    daily: DAILY_TASKS.map((t) => ({
      key: t.action,
      label: t.label,
      icon: t.icon,
      target: t.target,
    })),
  };
}

async function saveSlot(slot: SlotRecord): Promise<void> {
  await putStr(kSlot(slot.deviceId), JSON.stringify(slot), SLOT_TTL_DAYS * 86400);
}

/**
 * Move a slot to `qualified` and start the review hold. Idempotent — the
 * first qualifying read is the one that sets the clock, so a user refreshing
 * their screen can't keep pushing their own payout date back.
 */
export async function markQualified(slot: SlotRecord): Promise<SlotRecord> {
  if (slot.status !== "active") return slot;
  const updated: SlotRecord = {
    ...slot,
    status: "qualified",
    qualifiedAt: Date.now(),
  };
  await saveSlot(updated);
  return updated;
}

/** True once the review hold has elapsed and a payout may be sent. */
export function payoutReleasedAt(slot: SlotRecord): number | null {
  if (!slot.qualifiedAt) return null;
  return slot.qualifiedAt + PAYOUT_HOLD_HOURS * 3_600_000;
}

export async function reviewSlot(
  deviceId: string,
  decision: { action: "approve" | "reject" | "paid"; reason?: string; tx?: string },
): Promise<{ ok: boolean; slot?: SlotRecord; error?: string }> {
  const slot = await getSlot(deviceId);
  if (!slot) return { ok: false, error: "not_found" };

  if (decision.action === "reject") {
    // Free the device so a rejected user isn't locked out of a future
    // campaign — bit1 means "holds a slot", and they no longer do.
    if (slot.deviceToken) await releaseDeviceSlot(slot.deviceToken);
    const updated: SlotRecord = {
      ...slot,
      status: "rejected",
      rejectedReason: decision.reason || "failed review",
    };
    await saveSlot(updated);
    return { ok: true, slot: updated };
  }

  if (decision.action === "approve") {
    const updated: SlotRecord = { ...slot, reviewNote: decision.reason || "approved" };
    await saveSlot(updated);
    return { ok: true, slot: updated };
  }

  // Recording a payout is the point where the device is consumed, so the
  // DeviceCheck bit is set here rather than at join — an abandoned run must
  // not burn a device that was never rewarded.
  if (slot.status === "paid") return { ok: false, error: "already_paid" };
  if (slot.status === "rejected") return { ok: false, error: "rejected" };

  let deviceMarked: string | undefined;
  if (slot.deviceToken) {
    // Ask Apple whether this physical device was already rewarded. Slot
    // records can't answer that — a reinstall produces a new device id and a
    // new wallet, so two records may be the same phone.
    const bits = await queryDeviceBits(slot.deviceToken);
    if (bits.state === "ok" && bits.bits.bit0) {
      return { ok: false, error: "device_already_rewarded" };
    }
    const res = await markDeviceRewarded(slot.deviceToken);
    deviceMarked = res.ok ? undefined : `devicecheck: ${res.detail}`;
  }

  const updated: SlotRecord = {
    ...slot,
    status: "paid",
    paidAt: Date.now(),
    payoutTx: decision.tx,
    reviewNote: deviceMarked ?? slot.reviewNote,
  };
  await saveSlot(updated);
  return { ok: true, slot: updated };
}

/** Every slot, for the manual review pass. Sorted so IP/ASN clusters sit together. */
export async function listSlots(): Promise<SlotRecord[]> {
  const ids = DEV_MEMORY
    ? [...mem.slots]
    : ((await redis<string[]>("SMEMBERS", kSlots())) ?? []);
  const slots: SlotRecord[] = [];
  for (const id of ids) {
    const s = await getSlot(id);
    if (s) slots.push(s);
  }
  return slots.sort(
    (a, b) =>
      (a.asn ?? "").localeCompare(b.asn ?? "") ||
      (a.ip ?? "").localeCompare(b.ip ?? "") ||
      a.startedAt - b.startedAt,
  );
}

// ────────────────────────────────────────────────────────────────────────
// Progress
// ────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Matches /api/quests so both surfaces refresh on the same cadence. */
const TALLY_STALE_AFTER_MS = 60_000;

/** UTC day keys covering the window, oldest first. */
function windowDayKeys(startedAt: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) out.push(dayKey(startedAt + i * DAY_MS));
  return out;
}

function counted(w: SocialWallet | undefined, day: string, action: string): number {
  return w?.dayCounts?.[day]?.[action] ?? 0;
}

/** A day counts as complete only when every daily target is met. */
function dayComplete(w: SocialWallet | undefined, day: string): boolean {
  return DAILY_TASKS.every((t) => counted(w, day, t.action) >= t.target);
}

function msUntilUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return next - now;
}

export async function getProgress(
  wallet: string,
  opts: { hasProfile: boolean; hasUsername: boolean },
): Promise<CampaignProgress> {
  const slot = await getSlotByWallet(wallet);

  // The tally is what turns on-chain actions into counted progress, and it
  // only runs when something asks for it. Without this refresh a user could
  // like five posts and watch the counter sit at 0/5 until an unrelated
  // request to /api/quests happened to run it. Same staleness window as
  // that route, so the two never disagree.
  let social = await loadSocial();
  if (Date.now() - social.lastRunAt > TALLY_STALE_AFTER_MS) {
    try {
      await runSocialTally();
      social = await loadSocial();
    } catch (err) {
      console.warn("campaign: lazy tally failed:", err);
    }
  }
  const sw = social.wallets[wallet];

  const now = Date.now();
  const today = dayKey(now);

  // Follows accumulate across the whole window rather than resetting daily.
  const days = slot ? windowDayKeys(slot.startedAt) : [today];
  const follows = days.reduce((sum, d) => sum + counted(sw, d, "follow"), 0);

  // Profile and username are entry conditions, not tasks — nobody can reach
  // this screen without both, so rendering them as steps is just noise. They
  // are still verified server-side below and gate the payout.
  const eligible = opts.hasProfile && opts.hasUsername;

  const oneTime: TaskState[] = [
    {
      key: "follow",
      label: `Follow ${FOLLOW_TARGET} accounts`,
      icon: "people-outline",
      done: Math.min(follows, FOLLOW_TARGET),
      target: FOLLOW_TARGET,
      complete: follows >= FOLLOW_TARGET,
    },
  ];

  const daily: TaskState[] = DAILY_TASKS.map((t) => {
    const done = Math.min(counted(sw, today, t.action), t.target);
    return {
      key: t.action,
      label: t.label,
      icon: t.icon,
      done,
      target: t.target,
      complete: done >= t.target,
    };
  });

  const dayHistory = days.map((day) => ({
    day,
    complete: dayComplete(sw, day),
    isToday: day === today,
    isFuture: day > today,
  }));

  const completeDays = dayHistory.filter((d) => d.complete).length;
  const currentDay = slot
    ? Math.min(WINDOW_DAYS, Math.floor((now - slot.startedAt) / DAY_MS) + 1)
    : 0;

  const qualified =
    eligible &&
    oneTime.every((t) => t.complete) &&
    completeDays >= REQUIRED_COMPLETE_DAYS;

  // Latch qualification the first time it's observed, so the review hold
  // starts then rather than whenever an admin happens to look.
  let currentSlot = slot;
  if (qualified && slot && slot.status === "active") {
    currentSlot = await markQualified(slot);
  }

  return {
    slot: currentSlot,
    currentDay,
    windowDays: WINDOW_DAYS,
    oneTime,
    daily,
    dayHistory,
    completeDays,
    requiredDays: REQUIRED_COMPLETE_DAYS,
    eligible,
    qualified,
    payoutReleasesAt: currentSlot ? payoutReleasedAt(currentSlot) : null,
    resetsInMs: msUntilUtcMidnight(now),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Network checks
// ────────────────────────────────────────────────────────────────────────

/**
 * Datacenter and VPN ASNs are a clean reject — no real iPhone user browses
 * from AWS. Residential IPs are deliberately NOT clustered or banned here:
 * carrier-grade NAT puts thousands of legitimate mobile users behind one
 * address, so a shared-IP rule would disqualify exactly the users this
 * campaign is trying to reach. IP is recorded for the manual review pass
 * instead.
 */
export async function checkNetwork(
  ip: string,
): Promise<{ ok: boolean; asn?: string; reason?: string }> {
  if (!ip || ip === "127.0.0.1" || ip === "::1") return { ok: true };
  try {
    const resp = await fetch(`https://api.ipapi.is/?q=${encodeURIComponent(ip)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return { ok: true };
    const j = (await resp.json()) as {
      is_datacenter?: boolean;
      is_vpn?: boolean;
      is_proxy?: boolean;
      is_tor?: boolean;
      asn?: { asn?: number; org?: string };
    };
    const asn = j.asn?.asn ? `AS${j.asn.asn} ${j.asn.org ?? ""}`.trim() : undefined;
    if (j.is_datacenter || j.is_vpn || j.is_proxy || j.is_tor) {
      return { ok: false, asn, reason: "Datacenter, VPN or proxy connection" };
    }
    return { ok: true, asn };
  } catch {
    // Never block a real user because the lookup service is down.
    return { ok: true };
  }
}

export function clientIp(req: Request): string {
  const h = req.headers;
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") || "";
}

export { CampaignConfigError };
