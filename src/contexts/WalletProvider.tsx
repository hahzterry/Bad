"use client";

import React from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { base } from "viem/chains";

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: true,
});

// RPC key is now hidden behind /api/rpc proxy — no key in the client bundle
const HELIUS_MAINNET = typeof window !== "undefined"
  ? `${window.location.origin}/api/rpc`
  : `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;

const WSS_URL = `wss://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE || "unused"}`;

const solanaRpcs = {
  "solana:mainnet": {
    rpc: createSolanaRpc(HELIUS_MAINNET),
    rpcSubscriptions: createSolanaRpcSubscriptions(WSS_URL),
    blockExplorerUrl: "https://explorer.solana.com",
  },
} as const;

export default function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId="cmn36w5d1008c0cjmqphxqth6"
      config={{
        // Base is the only EVM chain we support for now
        supportedChains: [base],
        appearance: {
          theme: "light",
          accentColor: "#2563EB",
          logo: "/favicon.svg",
          landingHeader: "Welcome to Shyft",
          loginMessage: "Sign in to Shyft — on-chain social",
          // Support both Solana and EVM wallets
          walletChainType: "ethereum-and-solana",
          walletList: [
            "phantom",
            "solflare",
            "backpack",
            "detected_solana_wallets",
            "metamask",
            "coinbase_wallet",
            "detected_ethereum_wallets",
          ],
        },
        loginMethods: ["email", "google", "twitter", "github", "wallet"],
        solana: {
          rpcs: solanaRpcs,
        },
        embeddedWallets: {
          ethereum: {
            // Create EVM wallet first (Privy requirement: EVM before Solana)
            createOnLogin: "users-without-wallets",
          },
          solana: {
            createOnLogin: "users-without-wallets",
          },
          showWalletUIs: false,
        },
        externalWallets: {
          solana: {
            connectors: solanaConnectors,
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
