import { NextRequest, NextResponse } from "next/server";
import { loadJson, saveJson } from "@/lib/push-storage";

const MIN_TOKENS = 100_000;
const MAX_COMMENTS = 200;

interface TokenComment {
  id: string;
  wallet: string;
  username?: string;
  text: string;
  timestamp: number;
}

async function getTokenBalance(wallet: string, mint: string): Promise<number> {
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [wallet, { mint }, { encoding: "jsonParsed" }],
    }),
  });
  const data = await res.json();
  const accounts = data?.result?.value || [];
  let total = 0;
  for (const acct of accounts) {
    const uiAmount = acct.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
    if (uiAmount) total += uiAmount;
  }
  return total;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mint = searchParams.get("mint");
  const wallet = searchParams.get("wallet");

  if (!mint || !wallet) {
    return NextResponse.json({ error: "Missing mint or wallet" }, { status: 400 });
  }

  const balance = await getTokenBalance(wallet, mint);
  if (balance < MIN_TOKENS) {
    return NextResponse.json({ error: "insufficient_tokens", required: MIN_TOKENS, balance }, { status: 403 });
  }

  const comments = await loadJson<TokenComment[]>(`token-chat:${mint}`, []);
  return NextResponse.json({ success: true, comments });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { mint, wallet, username, text } = body;

  if (!mint || !wallet || !text?.trim()) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (text.length > 280) {
    return NextResponse.json({ error: "Comment too long (max 280 chars)" }, { status: 400 });
  }

  const balance = await getTokenBalance(wallet, mint);
  if (balance < MIN_TOKENS) {
    return NextResponse.json({ error: "insufficient_tokens", required: MIN_TOKENS, balance }, { status: 403 });
  }

  const comments = await loadJson<TokenComment[]>(`token-chat:${mint}`, []);
  const newComment: TokenComment = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    wallet,
    username: username || undefined,
    text: text.trim(),
    timestamp: Date.now(),
  };
  comments.push(newComment);
  await saveJson(`token-chat:${mint}`, comments.slice(-MAX_COMMENTS));

  return NextResponse.json({ success: true, comment: newComment });
}
