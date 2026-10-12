// Shyft — KV-style storage for push notification state.
//
// Backends, in order of preference:
//   1. Upstash Redis REST API   (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
//   2. Vercel KV                 (KV_REST_API_URL + KV_REST_API_TOKEN — same shape)
//   3. /tmp JSON file fallback  (works on Vercel ephemeral fs + local dev,
//                                drops on cold start — fine for first deploy)
//
// All callers use load/save by namespace. Backend auto-detected at module
// load time — no caller code changes when env vars are added.

import { promises as fs } from "fs";
import path from "path";

// ────────────────────────────────────────────────────────────────────────
// Backend selection
// ────────────────────────────────────────────────────────────────────────
const KV_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const KV_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
const USE_KV = !!(KV_URL && KV_TOKEN);

if (USE_KV) {
  console.log("📦 push-storage: using REST KV backend");
} else {
  console.log(
    "📦 push-storage: using /tmp JSON backend (set UPSTASH_REDIS_REST_URL+TOKEN for persistent)",
  );
}

const STORAGE_DIR = "/tmp";

function pathFor(namespace: string): string {
  const safe = namespace.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(STORAGE_DIR, `shyft-${safe}.json`);
}

function kvKey(namespace: string): string {
  return `shyft:${namespace}`;
}

async function kvGet<T>(namespace: string): Promise<T | null> {
  try {
    const resp = await fetch(
      `${KV_URL}/get/${encodeURIComponent(kvKey(namespace))}`,
      {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        cache: "no-store",
      },
    );
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => null);
    const raw = json?.result;
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function kvSet<T>(namespace: string, value: T): Promise<void> {
  try {
    await fetch(`${KV_URL}/set/${encodeURIComponent(kvKey(namespace))}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
    });
  } catch (err) {
    console.warn("kvSet failed:", err);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Public load / save
// ────────────────────────────────────────────────────────────────────────
export async function loadJson<T>(namespace: string, fallback: T): Promise<T> {
  if (USE_KV) {
    const v = await kvGet<T>(namespace);
    return v ?? fallback;
  }
  try {
    const raw = await fs.readFile(pathFor(namespace), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function saveJson<T>(namespace: string, data: T): Promise<void> {
  if (USE_KV) return kvSet(namespace, data);
  try {
    await fs.writeFile(pathFor(namespace), JSON.stringify(data), "utf8");
  } catch (err) {
    console.warn(`saveJson(${namespace}) failed:`, err);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Push token registry
// ────────────────────────────────────────────────────────────────────────
export type PushRegistration = {
  wallet: string;
  token: string;
  platform: string;
  updatedAt: number;
};

const TOKENS_NS = "push-tokens";

export async function loadAllRegistrations(): Promise<
  Record<string, PushRegistration>
> {
  return loadJson<Record<string, PushRegistration>>(TOKENS_NS, {});
}

export async function saveAllRegistrations(
  map: Record<string, PushRegistration>,
) {
  return saveJson(TOKENS_NS, map);
}

export async function setRegistration(reg: PushRegistration) {
  const all = await loadAllRegistrations();
  all[reg.wallet] = reg;
  await saveAllRegistrations(all);
}

export async function deleteRegistration(wallet: string) {
  const all = await loadAllRegistrations();
  if (!(wallet in all)) return;
  delete all[wallet];
  await saveAllRegistrations(all);
}

/** Drop all registrations whose token is in `invalidTokens`. Returns count removed. */
export async function deleteRegistrationsByTokens(
  invalidTokens: string[],
): Promise<number> {
  if (invalidTokens.length === 0) return 0;
  const bad = new Set(invalidTokens);
  const all = await loadAllRegistrations();
  let removed = 0;
  for (const [wallet, reg] of Object.entries(all)) {
    if (bad.has(reg.token)) {
      delete all[wallet];
      removed++;
    }
  }
  if (removed > 0) await saveAllRegistrations(all);
  return removed;
}

// ────────────────────────────────────────────────────────────────────────
// Cron worker "seen" state
// ────────────────────────────────────────────────────────────────────────
const SEEN_NS = "push-seen";

export type SeenState = {
  /** Cap at ~50k keys total to avoid bloat */
  keys: string[];
  /** When did the cron first seed — used to decide first-run skip */
  seededAt: number;
  lastRunAt: number;
};

export async function loadSeenState(): Promise<SeenState> {
  return loadJson<SeenState>(SEEN_NS, {
    keys: [],
    seededAt: 0,
    lastRunAt: 0,
  });
}

export async function saveSeenState(s: SeenState) {
  if (s.keys.length > 50_000) {
    s.keys = s.keys.slice(-50_000);
  }
  return saveJson(SEEN_NS, s);
}
