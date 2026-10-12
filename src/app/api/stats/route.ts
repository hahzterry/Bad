import { NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  type ConfirmedSignatureInfo,
} from "@solana/web3.js";

/**
 * /api/stats — Returns live on-chain stats for the landing page.
 * - Account counts: getProgramAccounts with discriminator filters
 * - Transaction count: paginated getSignaturesForAddress (all-time total)
 * Cached for 60 seconds to avoid hammering RPC.
 */

const PROGRAM_ID = new PublicKey("EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ");
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;
const BAGS_API_KEY = (process.env.BAGS_API_KEY || "").trim();
const BAGS_PARTNER_WALLET = (process.env.BAGS_PARTNER_WALLET || "").trim();

// Anchor account discriminators as base58 (first 8 bytes of SHA256("account:<Name>"))
const DISCRIMINATORS: Record<string, string> = {
  Profile:  "XqtBdGS7oVD",
  Post:     "2SCFvsZq1W5",
  Follow:   "WDkFKLBZQjJ",   // account:FollowAccount
  Reaction: "eqoxdQG2hzA",
  Comment:  "SBKTEqMLuVa",
  Chat:     "VSNktsnZqf6",
  Message:  "KVs5m1Nqcgc",
};

interface StatsCache {
  data: Record<string, number>;
  fetchedAt: number;
}

let cache: StatsCache | null = null;
let cachedTxCount: { value: number; fetchedAt: number } | null = null;
const CACHE_TTL = 10 * 60_000;      // 10 minutes — account counts
const TX_CACHE_TTL = 60 * 60_000;   // 1 hour   — tx count (expensive paginated query)

/**
 * Paginate through ALL transaction signatures for the program.
 * getSignaturesForAddress returns max 1000 per call, so we loop
 * using `before` cursor until we've fetched them all.
 */
async function getTotalTransactions(connection: Connection): Promise<number> {
  let total = 0;
  let before: string | undefined = undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const opts: { limit: number; before?: string } = { limit: 1000 };
    if (before) opts.before = before;

    const sigs: ConfirmedSignatureInfo[] =
      await connection.getSignaturesForAddress(PROGRAM_ID, opts);

    total += sigs.length;

    if (sigs.length < 1000) break;
    before = sigs[sigs.length - 1].signature;
  }

  return total;
}

async function fetchStats(): Promise<Record<string, number>> {
  // Return cache if fresh
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return cache.data;
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const stats: Record<string, number> = {};

  const entries = Object.entries(DISCRIMINATORS);

  // Fetch tokens launched via Shyft's partner config (on-chain feeShareConfigHeader accounts)
  const BAGS_PARTNER_CONFIG_PDA = (process.env.BAGS_PARTNER_CONFIG_PDA || "B94bGwVuX7tWX8VkkyBZLmQESJ537URMcJcVkF8tdi5T").trim();
  const getBagsTokenCount = async (): Promise<number> => {
    try {
      if (!BAGS_API_KEY) return 0;
      const { Connection: Conn } = await import("@solana/web3.js");
      const { BagsSDK } = await import("@bagsfm/bags-sdk");
      const conn = new Conn(RPC_URL, "confirmed");
      const sdk = new BagsSDK(BAGS_API_KEY, conn, "confirmed");
      const feeShareProg = sdk.state.getBagsFeeShareV2Program();
      // Layout: discriminator(8) + baseMint(32) + quoteMint(32) + partner(32) + partnerConfig(32) → offset 104
      const accounts = await (feeShareProg.account as any).feeShareConfigHeader.all([
        { memcmp: { offset: 104, bytes: BAGS_PARTNER_CONFIG_PDA } },
      ]);
      return accounts.length;
    } catch { return 0; }
  };

  const [accountResults, txCount, bagsTokenCount] = await Promise.all([
    // 1) Account counts by type
    Promise.allSettled(
      entries.map(([name, disc]) =>
        connection.getProgramAccounts(PROGRAM_ID, {
          filters: [{ memcmp: { offset: 0, bytes: disc } }],
          dataSlice: { offset: 0, length: 0 },
        }).then(accounts => ({ name, count: accounts.length }))
      )
    ),
    // 2) Total transaction count — cached separately for 1 hour (paginated, expensive)
    (async () => {
      if (cachedTxCount && Date.now() - cachedTxCount.fetchedAt < TX_CACHE_TTL) {
        return cachedTxCount.value;
      }
      try {
        const count = await getTotalTransactions(connection);
        cachedTxCount = { value: count, fetchedAt: Date.now() };
        return count;
      } catch (err: any) {
        console.error("Failed to fetch tx count:", err?.message || err);
        return cachedTxCount?.value || cache?.data.Transactions || 0;
      }
    })(),
    getBagsTokenCount(),
  ]);

  for (const result of accountResults) {
    if (result.status === "fulfilled") {
      stats[result.value.name] = result.value.count;
    } else {
      const name = entries[accountResults.indexOf(result)][0];
      console.error(`Stats fetch failed for ${name}:`, result.reason?.message || result.reason);
      stats[name] = cache?.data[name] || 0;
    }
  }

  stats.Transactions = txCount;
  stats.BagsTokens = bagsTokenCount;

  cache = { data: stats, fetchedAt: Date.now() };
  return stats;
}

export async function GET() {
  try {
    const stats = await fetchStats();

    return NextResponse.json({
      profiles: stats.Profile || 0,
      posts: stats.Post || 0,
      follows: stats.Follow || 0,
      reactions: stats.Reaction || 0,
      comments: stats.Comment || 0,
      chats: stats.Chat || 0,
      messages: stats.Message || 0,
      transactions: stats.Transactions || 0,
      tokens_launched: stats.BagsTokens || 0,
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200",
      },
    });
  } catch (err: any) {
    console.error("Stats error:", err);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
