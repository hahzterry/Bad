// Shyft — Expo Push API helper.
// https://docs.expo.dev/push-notifications/sending-notifications/

import {
  loadAllRegistrations,
  deleteRegistrationsByTokens,
  type PushRegistration,
} from "./push-storage";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high";
};

export type PushResult = {
  sent: number;
  skipped: number;
  invalidTokens: string[];
  pruned: number;
  results: any[];
};

/**
 * Errors that mean the token is permanently invalid and should be deleted.
 * https://docs.expo.dev/push-notifications/sending-notifications/#individual-errors
 */
const INVALID_TOKEN_ERRORS = new Set([
  "DeviceNotRegistered",
  "InvalidCredentials",
]);

/** Send a batch of pre-built Expo push messages. Chunks at 100 per request. */
export async function sendExpoBatch(
  messages: ExpoMessage[],
): Promise<{ tickets: any[]; invalidTokens: string[] }> {
  const tickets: any[] = [];
  const invalidTokens: string[] = [];
  if (messages.length === 0) return { tickets, invalidTokens };

  const chunks: ExpoMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    try {
      const resp = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(chunk),
      });
      const json = await resp.json().catch(() => ({}));
      const data: any[] = Array.isArray(json?.data) ? json.data : [];
      tickets.push(...data);

      // Match tickets back to tokens by index — Expo guarantees same order
      data.forEach((ticket, idx) => {
        const errCode = ticket?.details?.error;
        if (
          ticket?.status === "error" &&
          errCode &&
          INVALID_TOKEN_ERRORS.has(errCode)
        ) {
          invalidTokens.push(chunk[idx].to);
        }
      });
    } catch (err) {
      console.warn("Expo push chunk failed:", err);
      tickets.push({ error: (err as Error).message });
    }
  }

  return { tickets, invalidTokens };
}

/**
 * Send a single notification to a list of wallets — looks up their tokens,
 * skips wallets without registrations, prunes invalid tokens automatically.
 */
export async function pushToWallets(
  wallets: string[],
  payload: {
    title: string;
    body: string;
    data?: Record<string, any>;
    channelId?: string;
    sound?: "default" | null;
    badge?: number;
  },
  registry?: Record<string, PushRegistration>,
): Promise<PushResult> {
  const reg = registry || (await loadAllRegistrations());

  const messages: ExpoMessage[] = wallets
    .map((w) => reg[w])
    .filter((r): r is PushRegistration => !!r?.token)
    .map((r) => ({
      to: r.token,
      title: payload.title,
      body: payload.body,
      data: { ...(payload.data || {}), wallet: r.wallet },
      sound: payload.sound === null ? undefined : payload.sound || "default",
      badge: payload.badge,
      channelId: payload.channelId || "default",
      priority: "high" as const,
    }));

  const { tickets, invalidTokens } = await sendExpoBatch(messages);

  // Auto-prune tokens that Expo says are dead
  const pruned = await deleteRegistrationsByTokens(invalidTokens);

  return {
    sent: messages.length,
    skipped: wallets.length - messages.length,
    invalidTokens,
    pruned,
    results: tickets,
  };
}
