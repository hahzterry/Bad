// Apple DeviceCheck — two bits of per-device storage held on Apple's servers.
//
// Why this exists: the campaign promises one reward per person. IDFV resets
// when the app is deleted, so it cannot enforce that. A DeviceCheck bit
// survives app deletion, a new Apple ID, and a factory reset, which makes
// each physical iPhone worth exactly one reward and kills reinstall farming.
//
// bit0 = "this device has been rewarded". bit1 is left free.
//
// The bit is CHECKED when a slot is claimed and SET when a reward is paid —
// not at join, or a user who abandoned their run would burn the device
// forever without ever being paid.
//
// Setup (one-time, in the Apple Developer portal):
//   Certificates → Keys → new key with DeviceCheck enabled → download .p8
//   APPLE_DEVICECHECK_KEY_ID   — the 10-char key id
//   APPLE_TEAM_ID              — the 10-char team id
//   APPLE_DEVICECHECK_KEY      — contents of the .p8 (newlines may be \n)
//   APPLE_DEVICECHECK_ENV      — "development" while testing, else production
//
// Every function degrades to a no-op when unconfigured, so the campaign keeps
// working (with weaker device binding) until the key exists.

import crypto from "crypto";

const KEY_ID = process.env.APPLE_DEVICECHECK_KEY_ID || "";
const TEAM_ID = process.env.APPLE_TEAM_ID || "";
const PRIVATE_KEY = (process.env.APPLE_DEVICECHECK_KEY || "").replace(/\\n/g, "\n");
const USE_DEV = process.env.APPLE_DEVICECHECK_ENV === "development";

const HOST = USE_DEV
  ? "https://api.development.devicecheck.apple.com"
  : "https://api.devicecheck.apple.com";

export function isDeviceCheckConfigured(): boolean {
  return !!(KEY_ID && TEAM_ID && PRIVATE_KEY);
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * ES256 JWT. Apple requires the raw r||s signature form, so the signer is
 * told to use ieee-p1363 rather than the DER encoding node defaults to.
 */
function appleJwt(): string {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) }),
  );
  const signature = crypto.sign(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    { key: PRIVATE_KEY, dsaEncoding: "ieee-p1363" },
  );
  return `${header}.${payload}.${b64url(signature)}`;
}

async function call(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; text: string }> {
  const resp = await fetch(`${HOST}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appleJwt()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transaction_id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...body,
    }),
    signal: AbortSignal.timeout(8000),
  });
  return { ok: resp.ok, status: resp.status, text: await resp.text() };
}

export type DeviceBits = { bit0: boolean; bit1: boolean };

export type DeviceCheckResult =
  | { state: "unconfigured" }
  | { state: "invalid_token"; detail: string }
  | { state: "error"; detail: string }
  /** Apple has no bits stored for this device — a first-time device. */
  | { state: "unset" }
  | { state: "ok"; bits: DeviceBits };

/** Read the stored bits for a device token produced by DCDevice.generateToken(). */
export async function queryDeviceBits(
  deviceToken: string,
): Promise<DeviceCheckResult> {
  if (!isDeviceCheckConfigured()) return { state: "unconfigured" };
  try {
    const { ok, status, text } = await call("/v1/query_two_bits", {
      device_token: deviceToken,
    });

    // A device Apple has never seen comes back 200 with a plain-text body
    // rather than JSON — that's a first-time device, not a failure.
    if (ok) {
      try {
        const json = JSON.parse(text) as { bit0?: boolean; bit1?: boolean };
        if (typeof json.bit0 === "boolean") {
          return { state: "ok", bits: { bit0: !!json.bit0, bit1: !!json.bit1 } };
        }
      } catch {
        /* not JSON — falls through to "unset" */
      }
      return { state: "unset" };
    }

    // 400 means the token itself didn't validate: wrong environment, a token
    // minted by a different team, or a forgery.
    if (status === 400) return { state: "invalid_token", detail: text };
    return { state: "error", detail: `${status} ${text}` };
  } catch (err) {
    return { state: "error", detail: (err as Error).message };
  }
}

/**
 * Write both bits.
 *
 * Apple has no partial update — one call sets bit0 and bit1 together — so
 * callers pass the full intended state, never just the bit they care about.
 *
 *   bit0 = device has been rewarded (permanent, survives factory reset)
 *   bit1 = device currently holds a campaign slot
 */
export async function setDeviceBits(
  deviceToken: string,
  bit0: boolean,
  bit1: boolean,
): Promise<{ ok: boolean; detail?: string }> {
  if (!isDeviceCheckConfigured()) return { ok: false, detail: "unconfigured" };
  try {
    const { ok, status, text } = await call("/v1/update_two_bits", {
      device_token: deviceToken,
      bit0,
      bit1,
    });
    return ok ? { ok: true } : { ok: false, detail: `${status} ${text}` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

/** Mark a device rewarded and release its slot. Only after a payout is sent. */
export async function markDeviceRewarded(deviceToken: string) {
  return setDeviceBits(deviceToken, true, false);
}

/** Claim the device for an active slot. This is what blocks re-joining. */
export async function markDeviceHoldsSlot(deviceToken: string) {
  return setDeviceBits(deviceToken, false, true);
}

/** Free the device without rewarding it — rejection or admin cleanup. */
export async function releaseDeviceSlot(deviceToken: string) {
  return setDeviceBits(deviceToken, false, false);
}
