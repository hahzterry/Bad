/**
 * src/lib/easya.ts — EasyA Kickstart launches.
 *
 * $SHYFT itself launched on Kickstart, so tokens created this way sit in the
 * same ecosystem and show up on kickstart.easya.io.
 *
 * Their API builds a partially-signed LEGACY transaction, the user adds the fee
 * payer signature, and EasyA broadcasts it. Two rules from their docs that will
 * silently break the launch if ignored:
 *
 *   1. Never rebuild the transaction from its instructions — that drops the
 *      signatures it already carries. Sign the deserialized object as-is, and
 *      don't add compute-budget or tip instructions: any change to the compiled
 *      message invalidates their signature.
 *   2. Serialize with requireAllSignatures:false, or it throws instead of
 *      returning the transaction.
 *
 * The blockhash is set when the build call responds and expires in about a
 * minute, so sign and broadcast promptly rather than holding it.
 */

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/easya", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error || "Kickstart request failed");
  return json.response as T;
}

/** Step 1 — Kickstart pins the metadata and returns a partially-signed tx. */
export function buildKickstartLaunch(params: {
  wallet: string;
  name: string;
  symbol: string;
  imageUrl: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  /** Dev buy in SOL, executed in the same transaction as the launch. */
  initialBuySol?: number;
}): Promise<{ transaction: string; tokenMint: string; metadataUrl: string }> {
  return call({ action: "build", ...params });
}

/** Step 3 — Kickstart broadcasts and confirms; returns the signature. */
export function sendKickstartLaunch(params: {
  signedTransaction: string;
  mint: string;
  /** Recorded server-side as proof this launch came from Shyft, not kickstart.easya.io. */
  wallet?: string;
}): Promise<{ signature: string }> {
  return call({ action: "send", ...params });
}

/** Was this mint launched through Shyft? On-chain it's indistinguishable, so we ask our own record. */
export function checkLaunchedViaShyft(
  mint: string,
): Promise<{ launchedViaShyft: boolean; wallet?: string; launchedAt?: string; signature?: string }> {
  return call({ action: "provenance", mint });
}

/** Every Shyft-originated Kickstart launch, oldest first. */
export function listShyftLaunches(): Promise<
  Array<{ mint: string; wallet: string; signature: string; launchedAt: string }>
> {
  return call({ action: "launch-log" });
}
