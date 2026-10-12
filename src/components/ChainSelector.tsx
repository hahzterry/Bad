"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

export type ChainPreference = "solana" | "base";

const STORAGE_KEY = "shyft_chain_preference";

export function getChainPreference(): ChainPreference | null {
  if (typeof window === "undefined") return null;
  return (localStorage.getItem(STORAGE_KEY) as ChainPreference) || null;
}

export function setChainPreference(chain: ChainPreference) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, chain);
  }
}

interface Props {
  onSelect: (chain: ChainPreference) => void;
  onClose: () => void;
}

export default function ChainSelector({ onSelect, onClose }: Props) {
  const [hovered, setHovered] = useState<ChainPreference | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 animate-fade-in">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center mb-7">
          <div className="flex justify-center mb-3">
            <img src="/shyftlogo.png" alt="Shyft" className="shyft-logo w-12 h-12" />
          </div>
          <h2 className="text-2xl font-bold text-[#1A1A2E]">Choose your chain</h2>
          <p className="text-sm text-[#64748B] mt-1.5">
            Pick how you want to connect to Shyft
          </p>
        </div>

        <div className="space-y-3">
          {/* Solana option */}
          <button
            onClick={() => onSelect("solana")}
            onMouseEnter={() => setHovered("solana")}
            onMouseLeave={() => setHovered(null)}
            className="w-full rounded-2xl border-2 transition-all duration-200 p-5 text-left group"
            style={{
              borderColor: hovered === "solana" ? "#9945FF" : "#E2E8F0",
              background: hovered === "solana"
                ? "linear-gradient(135deg, #faf5ff 0%, #ede9fe 100%)"
                : "#F8FAFC",
            }}
          >
            <div className="flex items-center gap-4">
              {/* Solana logo */}
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #9945FF, #14F195)" }}
              >
                <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white">
                  <path d="M4.07 15.47a.74.74 0 0 1 .52-.21h15.31a.37.37 0 0 1 .26.63l-3.07 3.07a.74.74 0 0 1-.52.21H1.26a.37.37 0 0 1-.26-.63l3.07-3.07zm0-10.36A.74.74 0 0 1 4.59 4.9h15.31a.37.37 0 0 1 .26.63L17.09 8.6a.74.74 0 0 1-.52.21H1.26A.37.37 0 0 1 1 8.18l3.07-3.07zm13.17 5.17a.74.74 0 0 1-.52.21H1.26A.37.37 0 0 1 1 9.86l3.07-3.07" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-base font-bold text-[#1A1A2E]">Solana</p>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Recommended</span>
                </div>
                <p className="text-xs text-[#64748B]">Phantom, Backpack, Solflare, or email. Full Shyft experience — posts, tips, tokens.</p>
              </div>
              <div
                className="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
                style={{
                  borderColor: hovered === "solana" ? "#9945FF" : "#CBD5E1",
                  background: hovered === "solana" ? "#9945FF" : "transparent",
                }}
              >
                {hovered === "solana" && (
                  <div className="w-2.5 h-2.5 rounded-full bg-white" />
                )}
              </div>
            </div>
          </button>

          {/* Base option */}
          <button
            onClick={() => onSelect("base")}
            onMouseEnter={() => setHovered("base")}
            onMouseLeave={() => setHovered(null)}
            className="w-full rounded-2xl border-2 transition-all duration-200 p-5 text-left group"
            style={{
              borderColor: hovered === "base" ? "#0052FF" : "#E2E8F0",
              background: hovered === "base"
                ? "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)"
                : "#F8FAFC",
            }}
          >
            <div className="flex items-center gap-4">
              {/* Base logo */}
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "#0052FF" }}
              >
                <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white">
                  <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10c5.522 0 10-4.477 10-10S17.522 2 12 2zm.55 15.4v-2.47h-1.1v2.47A7.005 7.005 0 0 1 5 12c0-3.866 3.134-7 7-7a6.995 6.995 0 0 1 6.95 6.27H16.5a4.5 4.5 0 1 0-4.5 4.5c.188 0 .373-.012.55-.37z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-base font-bold text-[#1A1A2E]">Base</p>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">New</span>
                </div>
                <p className="text-xs text-[#64748B]">MetaMask, Coinbase Wallet, or embedded Base wallet. ETH-native login.</p>
              </div>
              <div
                className="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
                style={{
                  borderColor: hovered === "base" ? "#0052FF" : "#CBD5E1",
                  background: hovered === "base" ? "#0052FF" : "transparent",
                }}
              >
                {hovered === "base" && (
                  <div className="w-2.5 h-2.5 rounded-full bg-white" />
                )}
              </div>
            </div>
          </button>
        </div>

        <p className="text-[11px] text-center text-[#94A3B8] mt-5">
          Powered by Privy · Your keys, your data, any chain
        </p>
      </div>
    </div>
  );
}
