"use client";

/**
 * Compatibility hook: bridges Privy wallets → same interface as @solana/wallet-adapter-react.
 * All components import from here instead of wallet-adapter.
 */

import { useMemo } from "react";
import { usePrivy, useWallets as useAllWallets } from "@privy-io/react-auth";
import { useWallets as usePrivyWallets } from "@privy-io/react-auth/solana";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { type ChainPreference, getChainPreference } from "@/components/ChainSelector";

/** RPC endpoint — proxied through our API to keep the key hidden */
const RPC_PROXY = typeof window !== "undefined"
  ? `${window.location.origin}/api/rpc`
  : (process.env.HELIUS_API_KEY_PRIVATE
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`
      : `https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`);
export const HELIUS_MAINNET_RPC = RPC_PROXY;

/** @deprecated kept for any old references */
export const HELIUS_DEVNET_RPC = HELIUS_MAINNET_RPC;

/**
 * Poll-based transaction confirmation — NO WebSocket needed.
 * confirmTransaction() in @solana/web3.js always opens a WSS connection
 * which fails on Vercel. This uses pure HTTP getSignatureStatuses instead.
 */
export async function pollConfirmation(
  connection: Connection,
  signature: string,
  maxAttempts = 30,
  intervalMs = 2000,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await connection.getSignatureStatuses([signature]);
      const status = resp?.value?.[0];
      if (status) {
        if (status.err) return false; // tx failed
        if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
          return true;
        }
      }
    } catch (_) { /* RPC hiccup, keep trying */ }
    if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/** Shared connection (mainnet — for Shadowspace program via Anchor) */
let _sharedConnection: Connection | null = null;
export function getSharedConnection(): Connection {
  if (!_sharedConnection) {
    _sharedConnection = new Connection(HELIUS_MAINNET_RPC, {
      commitment: "confirmed",
      wsEndpoint: undefined,
      disableRetryOnRateLimit: false,
    });
  }
  return _sharedConnection;
}

/**
 * Drop-in replacement for `useWallet()` from @solana/wallet-adapter-react.
 * Returns { publicKey, connected, signTransaction, signAllTransactions, wallet }
 */
export function useWallet() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = usePrivyWallets();
  const { wallets: allWallets } = useAllWallets();

  // Pick the first Solana wallet (embedded or external)
  const solanaWallet = wallets.length > 0 ? wallets[0] : null;

  // Pick the first EVM wallet (embedded Base wallet or external MetaMask/Coinbase)
  const evmWallet = allWallets.find(w => w.type === "ethereum") ?? null;
  const evmAddress = evmWallet?.address ?? null;

  // Which chain the user chose to connect with (stored in localStorage)
  const activeChain: ChainPreference = getChainPreference() ?? "solana";

  const publicKey = useMemo(() => {
    if (!solanaWallet?.address) return null;
    try {
      return new PublicKey(solanaWallet.address);
    } catch {
      return null;
    }
  }, [solanaWallet?.address]);

  const connected = ready && authenticated && !!publicKey;

  const signTransaction = useMemo(() => {
    if (!solanaWallet) return undefined;
    return async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      let serialized: Uint8Array;
      if (tx instanceof Transaction) {
        serialized = new Uint8Array(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
      } else {
        serialized = new Uint8Array(tx.serialize());
      }
      const result = await solanaWallet.signTransaction!({
        transaction: serialized,
      });
      // Deserialize back
      if (tx instanceof Transaction) {
        return Transaction.from(Buffer.from(result.signedTransaction)) as T;
      }
      return VersionedTransaction.deserialize(Buffer.from(result.signedTransaction)) as T;
    };
  }, [solanaWallet]);

  const signAllTransactions = useMemo(() => {
    if (!solanaWallet) return undefined;
    return async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
      // Privy supports batch signing — sign all at once for single prompt
      const inputs = txs.map((tx) => {
        let serialized: Uint8Array;
        if (tx instanceof Transaction) {
          serialized = new Uint8Array(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
        } else {
          serialized = new Uint8Array(tx.serialize());
        }
        return { transaction: serialized };
      });

      const results = await (solanaWallet.signTransaction as any)(...inputs);
      // Handle both single and array return
      const resultsArray = Array.isArray(results) ? results : [results];

      return resultsArray.map((result: any, i: number) => {
        if (txs[i] instanceof Transaction) {
          return Transaction.from(Buffer.from(result.signedTransaction)) as T;
        }
        return VersionedTransaction.deserialize(Buffer.from(result.signedTransaction)) as T;
      });
    };
  }, [solanaWallet]);

  return {
    publicKey,
    connected,
    signTransaction,
    signAllTransactions,
    wallet: solanaWallet,
    evmWallet,
    evmAddress,
    activeChain,
    login,
    logout,
    ready,
    authenticated,
    user,
  };
}

/**
 * Drop-in replacement for `useConnection()` from @solana/wallet-adapter-react.
 */
export function useConnection() {
  const connection = useMemo(() => getSharedConnection(), []);
  return { connection };
}

/**
 * Drop-in replacement for `useAnchorWallet()` from @solana/wallet-adapter-react.
 * Returns a wallet object compatible with Anchor's `AnchorProvider`.
 */
export function useAnchorWallet() {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();

  return useMemo(() => {
    if (!publicKey || !signTransaction || !signAllTransactions) return null;
    return {
      publicKey,
      signTransaction,
      signAllTransactions,
    };
  }, [publicKey, signTransaction, signAllTransactions]);
}
