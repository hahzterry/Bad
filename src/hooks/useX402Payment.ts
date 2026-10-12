"use client";

import { useWallet, useConnection } from "@/hooks/usePrivyWallet";
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";

const X402_BASE = "https://parad0xlabs.com/x402";

function makeCommitment(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type FeeLine = {
  id: string;
  kind: string;
  amount: string;
  recipient?: string;
  requiredForFinalize?: boolean;
};

type QuoteResponse = {
  quoteId: string;
  feeWaterfallV2?: {
    lines: FeeLine[];
    grossAmount?: string;
    totalBuyerCost?: string;
  };
};

export type X402UnlockResult = {
  sig: string;
  receiptId?: string;
  totalSOL: number;
};

export function useX402Payment() {
  const { publicKey: walletKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const unlockPost = async (
    postPublicKey: string,
    creatorAddress: string,
    priceSOL: number,
  ): Promise<X402UnlockResult> => {
    if (!walletKey || !signTransaction) throw new Error("Wallet not connected");

    const lamports = Math.round(priceSOL * LAMPORTS_PER_SOL);

    // ── Step 1: Quote ──────────────────────────────────────────────────────
    let quote: QuoteResponse | null = null;
    let lines: FeeLine[] = [];

    try {
      const qRes = await fetch(
        `${X402_BASE}/quote?` +
          new URLSearchParams({
            resource: postPublicKey,
            amountAtomic: lamports.toString(),
            privacyPath: "normal",
            builderFeeBps: "0",
          }),
      );
      if (qRes.ok) {
        quote = (await qRes.json()) as QuoteResponse;
        lines = quote?.feeWaterfallV2?.lines ?? [];
        console.log("[x402] quote →", JSON.stringify(quote, null, 2));
      } else {
        console.warn("[x402] quote failed", qRes.status, await qRes.text());
      }
    } catch (e) {
      console.warn("[x402] quote error — falling back to direct transfer", e);
    }

    // ── Step 2: Commit ─────────────────────────────────────────────────────
    let commitId: string | null = null;
    if (quote?.quoteId) {
      try {
        const commitment = makeCommitment();
        const cRes = await fetch(`${X402_BASE}/commit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quoteId: quote.quoteId, payerCommitment32B: commitment }),
        });
        if (cRes.ok) {
          const cData = await cRes.json();
          commitId = cData.commitId ?? null;
          console.log("[x402] commit →", cData);
        } else {
          console.warn("[x402] commit failed", cRes.status, await cRes.text());
        }
      } catch (e) {
        console.warn("[x402] commit error", e);
      }
    }

    // ── Step 3: Build transaction ──────────────────────────────────────────
    const tx = new Transaction();

    // Creator payment — use fee waterfall if x402 returned one, otherwise direct
    const providerLine = lines.find((l) => l.kind === "PROVIDER_AMOUNT");
    const creatorLamports = providerLine ? Number(providerLine.amount) : lamports;
    const creatorPubkey = new PublicKey(
      providerLine?.recipient ?? creatorAddress,
    );

    tx.add(
      SystemProgram.transfer({
        fromPubkey: walletKey,
        toPubkey: creatorPubkey,
        lamports: creatorLamports,
      }),
    );

    // DNA platform fee (0.1%) — only if x402 returned a required line with a recipient
    const dnaLine = lines.find(
      (l) =>
        l.kind === "DNA_PLATFORM_FEE" &&
        l.requiredForFinalize &&
        l.recipient &&
        Number(l.amount) > 0,
    );
    if (dnaLine) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: walletKey,
          toPubkey: new PublicKey(dnaLine.recipient!),
          lamports: Number(dnaLine.amount),
        }),
      );
    }

    // Balance check against actual total
    const totalLamports = creatorLamports + (dnaLine ? Number(dnaLine.amount) : 0);
    const balance = await connection.getBalance(walletKey);
    if (balance < totalLamports + 10_000) {
      const needed = (totalLamports / LAMPORTS_PER_SOL).toFixed(4);
      throw new Error(`Insufficient SOL — need at least ${needed} SOL to unlock.`);
    }

    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = walletKey;

    const signedTx = await signTransaction(tx);
    const sig = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: false,
    });

    // ── Step 4: Finalize ───────────────────────────────────────────────────
    let receiptId: string | undefined;
    if (commitId) {
      try {
        const fRes = await fetch(`${X402_BASE}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commitId,
            paymentProof: {
              settlement: "transfer",
              txSignature: sig,
              amountAtomic: lamports.toString(),
              network: "solana",
            },
          }),
        });
        if (fRes.ok) {
          const fData = await fRes.json();
          receiptId = fData.receiptId;
          console.log("[x402] finalize →", fData);
        } else {
          console.warn("[x402] finalize failed", fRes.status, await fRes.text());
        }
      } catch (e) {
        console.warn("[x402] finalize error", e);
      }
    }

    return { sig, receiptId, totalSOL: totalLamports / LAMPORTS_PER_SOL };
  };

  return { unlockPost };
}
