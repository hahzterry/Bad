import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
  const { messages } = await req.json();

  const XAI_API_KEY = process.env.XAI_API_KEY;
  if (!XAI_API_KEY) {
    return new Response(JSON.stringify({ error: "XAI_API_KEY not set" }), { status: 502 });
  }

  const systemPrompt = `You are Shyft AI — a helpful assistant built into Shyft, an on-chain social network on the Solana blockchain.

Key facts about Shyft:
- Posts, profiles, reactions, follows, and communities are stored on Solana mainnet via an Anchor smart contract
- All transactions are gasless — Shyft sponsors all SOL fees for users
- Direct messages are end-to-end encrypted using NaCl (X25519 + XSalsa20-Poly1305)
- Users can launch creator tokens via the Bags.fm protocol
- The Shyft program ID is EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ
- Website: shyft.lol

You are knowledgeable about Solana, crypto, DeFi, NFTs, and web3 in general.
Be concise, helpful, and friendly. Keep responses focused and not too long.
IMPORTANT: Never mention "Grok", "xAI", or "X.AI" — you are Shyft AI, built by the Shyft team.`;

  let res: Response;
  try {
    res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-3-mini",
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
      }),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: "AI fetch failed: " + msg }), { status: 502 });
  }

  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => "");
    return new Response(JSON.stringify({ error: err || "AI unavailable" }), { status: 502 });
  }

  // Forward SSE stream, extracting just the text content
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") { controller.close(); return; }
            try {
              const json = JSON.parse(data);
              const content = json.choices?.[0]?.delta?.content;
              if (content) controller.enqueue(encoder.encode(content));
            } catch {}
          }
        }
      } catch (e) {
        controller.error(e);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: "Internal error: " + msg }), { status: 500 });
  }
}
