"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CircleDollarSign,
  Plus,
  TrendingUp,
  ExternalLink,
  Loader2,
  RefreshCw,
  DollarSign,
  Wallet,
  ChevronRight,
  Star,
  BarChart3,
  Shield,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useWallet, pollConfirmation, getSharedConnection } from "@/hooks/usePrivyWallet";
import { toast } from "@/components/Toast";
import TokenLaunch from "@/components/TokenLaunch";
import TokenTrade from "@/components/TokenTrade";
import TokenChat from "@/components/TokenChat";
import { formatSOL } from "@/lib/bags";
import { buildClaimFeesTx, listLaunchesByMints } from "@/lib/launchpad";
import { listShyftLaunches } from "@/lib/easya";
import { VersionedTransaction, Transaction } from "@solana/web3.js";

interface TokenItem {
  name: string;
  symbol: string;
  description: string;
  image: string;
  tokenMint: string;
  status: string;
  twitter?: string;
  website?: string;
  launchWallet?: string;
  /** Shyft launches only — the bonding-curve pool and the creator's unclaimed fees. */
  pool?: string;
  creatorFeesSol?: number;
}

interface ClaimablePosition {
  baseMint: string;
  totalClaimableLamportsUserShare?: string;
  virtualPoolClaimableAmount?: string;
  dammPoolClaimableAmount?: string;
  symbol?: string;
  image?: string;
  pool?: string;
}

export default function Tokens() {
  const { publicKey, signTransaction } = useWallet();
  const { isConnected } = useAppStore();
  const [tab, setTab] = useState<"discover" | "my-tokens" | "earnings">("discover");
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [myTokens, setMyTokens] = useState<TokenItem[]>([]);
  const [claimable, setClaimable] = useState<ClaimablePosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMyTokens, setLoadingMyTokens] = useState(false);
  const [loadingFees, setLoadingFees] = useState(false);
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [selectedToken, setSelectedToken] = useState<TokenItem | null>(null);
  const [modalTab, setModalTab] = useState<"trade" | "chat">("trade");
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());

  /**
   * Tokens launched on Shyft's own launchpad. Bags has never heard of these, so
   * they have to be fetched separately or a creator's own token is invisible to
   * them. Newest first — getProgramAccounts returns no meaningful order, but
   * later launches have had less time to accrue reserve, so leave as-is and let
   * the caller merge them ahead of the Bags feed.
   */
  const fetchShyftLaunches = useCallback(async (creator?: string): Promise<TokenItem[]> => {
    try {
      const res = await fetch("/api/launchpad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "launches", limit: 50, ...(creator ? { creator } : {}) }),
      });
      const data = await res.json();
      if (!data.success || !Array.isArray(data.response)) return [];
      return data.response.map((t: any) => ({
        name: t.name || t.symbol || t.tokenMint.slice(0, 8),
        symbol: t.symbol || "",
        description: t.description || "",
        image: t.image || "",
        tokenMint: t.tokenMint,
        status: t.status,
        launchWallet: t.launchWallet,
        pool: t.pool,
        creatorFeesSol: t.creatorFeesSol,
      })) as TokenItem[];
    } catch (err) {
      console.error("Failed to fetch Shyft launches:", err);
      return [];
    }
  }, []);

  /**
   * Tokens launched through Shyft onto EasyA's config. They can't be found by
   * config filter (that's EasyA's config, full of launches that aren't ours),
   * so the mints come from the launch record we write when we broadcast.
   */
  const fetchKickstartLaunches = useCallback(async (): Promise<TokenItem[]> => {
    try {
      const log = await listShyftLaunches();
      if (!log.length) return [];
      const stats = await listLaunchesByMints(log.map((l) => l.mint).slice(-50));
      return stats.map((t: any) => ({
        name: t.name || t.symbol || String(t.tokenMint).slice(0, 8),
        symbol: t.symbol || "",
        description: t.description || "",
        image: t.image || "",
        tokenMint: t.tokenMint,
        status: t.status,
        launchWallet: t.launchWallet,
        pool: t.pool,
        creatorFeesSol: t.creatorFeesSol,
      })) as TokenItem[];
    } catch (err) {
      console.error("Failed to fetch Kickstart launches:", err);
      return [];
    }
  }, []);

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      // Everything launched through Shyft, on either launchpad — our own DBC
      // config, and Kickstart launches identified from our launch record.
      const [own, kickstart] = await Promise.all([fetchShyftLaunches(), fetchKickstartLaunches()]);
      const seen = new Set(kickstart.map((t) => t.tokenMint));
      setTokens([...kickstart, ...own.filter((t) => !seen.has(t.tokenMint))]);
    } catch (err) {
      console.error("Failed to fetch token feed:", err);
    }
    setLoading(false);
  }, [fetchShyftLaunches, fetchKickstartLaunches]);

  /**
   * Claimable creator fees on Shyft-launched tokens. Fees accrue inside each
   * bonding-curve pool and only reach the creator's wallet when claimed, so
   * this reads the pool's unclaimed balance rather than any wallet balance.
   */
  const fetchClaimable = useCallback(async () => {
    if (!publicKey) return;
    setLoadingFees(true);
    try {
      const walletStr = publicKey.toBase58();
      const mine = await fetchShyftLaunches(walletStr);
      setClaimable(
        mine
          .filter((t) => (t.creatorFeesSol ?? 0) > 0)
          .map((t) => ({
            baseMint: t.tokenMint,
            symbol: t.symbol,
            image: t.image,
            pool: t.pool,
            // The panel works in lamports throughout.
            totalClaimableLamportsUserShare: String(Math.round((t.creatorFeesSol ?? 0) * 1e9)),
          })),
      );
    } catch (err) {
      console.error("Failed to fetch claimable:", err);
    }
    setLoadingFees(false);
  }, [publicKey, fetchShyftLaunches]);

  // Fetch user's tokens via dedicated endpoint (fee-admin mints + feed launchWallet match)
  const fetchMyTokens = useCallback(async () => {
    if (!publicKey) return;
    setLoadingMyTokens(true);
    try {
      // By creator, not by config — otherwise tokens launched through EasyA
      // are invisible here, since they live on EasyA's config.
      setMyTokens(await fetchShyftLaunches(publicKey.toBase58()));
    } catch (err) {
      console.error("Failed to fetch my tokens:", err);
    }
    setLoadingMyTokens(false);
  }, [publicKey, fetchShyftLaunches]);

  useEffect(() => { fetchTokens(); }, [fetchTokens]);

  useEffect(() => {
    if (tab === "earnings" && publicKey) fetchClaimable();
  }, [tab, publicKey, fetchClaimable]);

  useEffect(() => {
    if (tab === "my-tokens" && publicKey) fetchMyTokens();
  }, [tab, publicKey, fetchMyTokens]);

  useEffect(() => {
    if (!publicKey) return;
    const saved = localStorage.getItem(`watchlist_${publicKey.toBase58()}`);
    if (saved) {
      try { setWatchlist(new Set(JSON.parse(saved))); } catch {}
    }
  }, [publicKey]);

  const toggleWatchlist = useCallback((mint: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!publicKey) return;
    setWatchlist(prev => {
      const next = new Set(prev);
      if (next.has(mint)) next.delete(mint); else next.add(mint);
      localStorage.setItem(`watchlist_${publicKey.toBase58()}`, JSON.stringify([...next]));
      return next;
    });
  }, [publicKey]);

  const safeImg = (url: string) =>
    url?.startsWith("http://") ? `/api/proxy-image?url=${encodeURIComponent(url)}` : url;

  const totalClaimableSOL = claimable.reduce((sum, p) => {
    const amount = Number(p.totalClaimableLamportsUserShare || p.virtualPoolClaimableAmount || 0)
      + Number(p.dammPoolClaimableAmount || 0);
    return sum + amount;
  }, 0);

  const handleClaim = async (tokenMint: string) => {
    if (!publicKey || !signTransaction) return;
    const position = claimable.find((p) => p.baseMint === tokenMint);
    if (!position?.pool) {
      toast("error", "Couldn't find that token's pool");
      return;
    }
    try {
      toast("info", "Creating claim transaction...");
      const { transaction } = await buildClaimFeesTx({
        wallet: publicKey.toBase58(),
        pool: position.pool,
      });
      const connection = getSharedConnection();
      const signed = await signTransaction(Transaction.from(Buffer.from(transaction, "base64")));
      const sig = await connection.sendRawTransaction(signed.serialize());
      await pollConfirmation(connection, sig);

      toast("success", "Fees claimed — sent to your wallet");
      fetchClaimable();
    } catch (err: any) {
      console.error("Claim error:", err);
      toast("error", err.message || "Failed to claim fees");
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#2563EB] to-[#7C3AED] flex items-center justify-center">
            <CircleDollarSign className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#1A1A2E]">Creator Tokens</h1>
            <p className="text-xs text-[#64748B]">Launch, trade &amp; earn on Shyft</p>
          </div>
        </div>
        <button
          onClick={() => setShowLaunchModal(true)}
          className="flex items-center gap-1.5 py-2 px-4 bg-gradient-to-r from-[#2563EB] to-[#7C3AED] text-white rounded-xl font-medium text-sm hover:opacity-90 transition"
        >
          <Plus className="w-4 h-4" />
          Launch Token
        </button>
      </div>

      {/* Tabs */}
      <div className="flex bg-[#F1F5F9] rounded-xl p-1">
        {([
          { id: "discover" as const, label: "Discover", icon: TrendingUp },
          { id: "my-tokens" as const, label: "My Tokens", icon: Wallet },
          { id: "earnings" as const, label: "Earnings", icon: DollarSign },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg transition ${
              tab === id ? "bg-white text-[#1A1A2E] shadow-sm" : "text-[#64748B] hover:text-[#475569]"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Discover Tab */}
      {tab === "discover" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[#475569]">Trending Tokens</h2>
            <button onClick={fetchTokens} className="p-1.5 hover:bg-[#F1F5F9] rounded-lg transition">
              <RefreshCw className={`w-4 h-4 text-[#94A3B8] ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-[#2563EB] animate-spin" />
            </div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-14 h-14 rounded-2xl bg-[#F1F5F9] flex items-center justify-center mx-auto mb-3">
                <CircleDollarSign className="w-7 h-7 text-[#94A3B8]" />
              </div>
              <p className="text-sm font-medium text-[#475569]">No tokens found</p>
              <p className="text-xs text-[#94A3B8] mt-1">Be the first to launch a creator token!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...tokens].sort((a, b) => {
                const aW = watchlist.has(a.tokenMint) ? 0 : 1;
                const bW = watchlist.has(b.tokenMint) ? 0 : 1;
                return aW - bW;
              }).slice(0, 20).map((token, i) => (
                <button
                  key={token.tokenMint}
                  onClick={() => { setSelectedToken(token); setModalTab("trade"); }}
                  className="w-full flex items-center gap-3 p-3 bg-white rounded-2xl border border-[#E2E8F0] hover:border-[#2563EB]/30 hover:shadow-sm transition text-left"
                >
                  <span className="text-xs font-medium text-[#94A3B8] w-5">{i + 1}</span>
                  {token.image ? (
                    <img
                      src={safeImg(token.image)}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover"
                      onError={(e) => {
                        const el = e.currentTarget;
                        el.style.display = "none";
                        const fallback = el.nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                  ) : null}
                  <div className={`w-9 h-9 rounded-full bg-gradient-to-br from-[#2563EB] to-[#7C3AED] items-center justify-center ${token.image ? "hidden" : "flex"}`}>
                    <span className="text-xs font-bold text-white">{token.symbol?.[0] || "?"}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-[#1A1A2E] truncate">{token.name}</span>
                      <span className="text-xs text-[#94A3B8]">${token.symbol}</span>
                    </div>
                    <p className="text-xs text-[#64748B] truncate">{token.description}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                      token.status === "MIGRATED" ? "bg-[#F0FDF4] text-[#16A34A]"
                        : token.status === "PRE_GRAD" ? "bg-[#FFFBEB] text-[#D97706]"
                        : "bg-[#F1F5F9] text-[#64748B]"
                    }`}>
                      {token.status === "MIGRATED" ? "Live" : token.status === "PRE_GRAD" ? "Pre-Grad" : token.status}
                    </span>
                    <button onClick={(e) => toggleWatchlist(token.tokenMint, e)} className="p-1 rounded-lg hover:bg-[#F1F5F9] transition">
                      <Star className={`w-4 h-4 ${watchlist.has(token.tokenMint) ? "fill-[#F59E0B] text-[#F59E0B]" : "text-[#CBD5E1]"}`} />
                    </button>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* My Tokens Tab */}
      {tab === "my-tokens" && (
        <div>
          {!isConnected ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-[#EFF6FF] flex items-center justify-center mx-auto mb-3">
                  <Wallet className="w-7 h-7 text-[#2563EB]" />
                </div>
                <p className="text-sm font-medium text-[#475569]">Connect your wallet</p>
                <p className="text-xs text-[#94A3B8] mt-1">to see your tokens</p>
              </div>
            </div>
          ) : (
            <div>
              {/* Launch CTA */}
              <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-5 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-xl bg-[#EFF6FF] flex items-center justify-center">
                    <Star className="w-4 h-4 text-[#2563EB]" />
                  </div>
                  <span className="text-sm font-semibold text-[#1A1A2E]">Launch Your Token</span>
                </div>
                <p className="text-xs text-[#64748B] mb-3">
                  Create your own token and earn fees every time someone trades it.
                </p>
                <button
                  onClick={() => setShowLaunchModal(true)}
                  className="flex items-center gap-1.5 py-2 px-4 bg-[#2563EB] text-white rounded-xl font-medium text-xs hover:bg-[#1D4ED8] transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Launch Token
                </button>
              </div>

              {/* User's Tokens List */}
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[#475569]">Your Tokens</h2>
                <button onClick={fetchMyTokens} className="p-1.5 hover:bg-[#F1F5F9] rounded-lg transition">
                  <RefreshCw className={`w-4 h-4 text-[#94A3B8] ${loadingMyTokens ? "animate-spin" : ""}`} />
                </button>
              </div>

              {loadingMyTokens ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-[#2563EB] animate-spin" />
                </div>
              ) : myTokens.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-2xl bg-[#F1F5F9] flex items-center justify-center mx-auto mb-3">
                    <CircleDollarSign className="w-6 h-6 text-[#94A3B8]" />
                  </div>
                  <p className="text-sm font-medium text-[#475569]">No tokens yet</p>
                  <p className="text-xs text-[#94A3B8] mt-1">Launch a token or trade to see it here</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {myTokens.map((token) => (
                    <button
                      key={token.tokenMint}
                      onClick={() => { setSelectedToken(token); setModalTab("trade"); }}
                      className="w-full flex items-center gap-3 p-3 bg-white rounded-2xl border border-[#E2E8F0] hover:border-[#2563EB]/30 hover:shadow-sm transition text-left"
                    >
                      {token.image ? (
                        <img
                          src={safeImg(token.image)}
                          alt=""
                          className="w-9 h-9 rounded-full object-cover"
                          onError={(e) => {
                            const el = e.currentTarget;
                            el.style.display = "none";
                            const fallback = el.nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = "flex";
                          }}
                        />
                      ) : null}
                      <div className={`w-9 h-9 rounded-full bg-gradient-to-br from-[#2563EB] to-[#7C3AED] items-center justify-center ${token.image ? "hidden" : "flex"}`}>
                        <span className="text-xs font-bold text-white">{token.symbol?.[0] || "?"}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold text-[#1A1A2E] truncate">{token.name}</span>
                          <span className="text-xs text-[#94A3B8]">${token.symbol}</span>
                        </div>
                        {token.description && (
                          <p className="text-xs text-[#64748B] truncate">{token.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          token.status === "MIGRATED" ? "bg-[#F0FDF4] text-[#16A34A]"
                            : token.status === "PRE_GRAD" ? "bg-[#FFFBEB] text-[#D97706]"
                            : "bg-[#F1F5F9] text-[#64748B]"
                        }`}>
                          {token.status === "MIGRATED" ? "Live" : token.status === "PRE_GRAD" ? "Pre-Grad" : token.status}
                        </span>
                        <button onClick={(e) => toggleWatchlist(token.tokenMint, e)} className="p-1 rounded-lg hover:bg-[#F1F5F9] transition">
                          <Star className={`w-4 h-4 ${watchlist.has(token.tokenMint) ? "fill-[#F59E0B] text-[#F59E0B]" : "text-[#CBD5E1]"}`} />
                        </button>
                        <ChevronRight className="w-4 h-4 text-[#CBD5E1]" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

            </div>
          )}
        </div>
      )}

      {/* Earnings Tab */}
      {tab === "earnings" && (
        <div>
          {!isConnected ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-[#F0FDF4] flex items-center justify-center mx-auto mb-3">
                  <DollarSign className="w-7 h-7 text-[#16A34A]" />
                </div>
                <p className="text-sm font-medium text-[#475569]">Connect your wallet</p>
                <p className="text-xs text-[#94A3B8] mt-1">to see your earnings</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-5 mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-xl bg-[#F0FDF4] flex items-center justify-center">
                        <DollarSign className="w-4 h-4 text-[#16A34A]" />
                      </div>
                      <span className="text-xs font-medium text-[#64748B]">Total Claimable</span>
                    </div>
                    <p className="text-2xl font-bold text-[#1A1A2E]">
                      {formatSOL(totalClaimableSOL)} <span className="text-sm font-medium text-[#64748B]">SOL</span>
                    </p>
                    <p className="text-[10px] text-[#16A34A] flex items-center gap-1 mt-1">
                      <Shield className="w-2.5 h-2.5" /> Fee earnings from token trading
                    </p>
                  </div>
                  <button onClick={fetchClaimable} className="p-2 hover:bg-[#F1F5F9] rounded-lg transition">
                    <RefreshCw className={`w-4 h-4 text-[#94A3B8] ${loadingFees ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>

              {loadingFees ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-[#2563EB] animate-spin" />
                </div>
              ) : claimable.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-2xl bg-[#F1F5F9] flex items-center justify-center mx-auto mb-3">
                    <BarChart3 className="w-6 h-6 text-[#94A3B8]" />
                  </div>
                  <p className="text-sm font-medium text-[#475569]">No claimable fees yet</p>
                  <p className="text-xs text-[#94A3B8] mt-1">Launch a token and get trading volume to earn fees</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {claimable.map((position) => {
                    const claimableAmount = Number(
                      position.totalClaimableLamportsUserShare || position.virtualPoolClaimableAmount || 0
                    ) + Number(position.dammPoolClaimableAmount || 0);
                    return (
                      <div key={position.baseMint} className="flex items-center justify-between p-3 bg-white rounded-2xl border border-[#E2E8F0]">
                        <div className="flex items-center gap-2 min-w-0">
                          {position.image ? (
                            <img src={position.image} alt={position.symbol || ""} className="w-8 h-8 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#2563EB] to-[#7C3AED] shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#1A1A2E] truncate">
                              {position.symbol ? `$${position.symbol}` : `${position.baseMint.slice(0, 8)}…`}
                            </p>
                            <p className="text-sm font-semibold text-[#16A34A]">{formatSOL(claimableAmount)} SOL</p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleClaim(position.baseMint)}
                          disabled={claimableAmount <= 0}
                          className="py-1.5 px-3 bg-[#16A34A] text-white rounded-xl text-xs font-medium hover:bg-[#15803D] transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Claim
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Token Detail / Trade Modal */}
      {selectedToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto">
            <div className="p-5 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-3">
                {selectedToken.image ? (
                  <img src={safeImg(selectedToken.image)} alt="" className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#2563EB] to-[#7C3AED] flex items-center justify-center">
                    <span className="text-lg font-bold text-white">{selectedToken.symbol?.[0]}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold text-[#1A1A2E]">{selectedToken.name}</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#64748B]">${selectedToken.symbol}</span>
                    <a href={`https://dexscreener.com/solana/${selectedToken.tokenMint}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#2563EB] hover:underline flex items-center gap-0.5">
                      Chart <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
                <button onClick={() => setSelectedToken(null)} className="p-2 hover:bg-[#F1F5F9] rounded-lg">✕</button>
              </div>
              {selectedToken.description && <p className="text-xs text-[#64748B] mt-2">{selectedToken.description}</p>}
              <div className="flex bg-[#F1F5F9] rounded-lg p-0.5 mt-3">
                <button
                  onClick={() => setModalTab("trade")}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${modalTab === "trade" ? "bg-white text-[#1A1A2E] shadow-sm" : "text-[#64748B] hover:text-[#475569]"}`}
                >
                  Trade
                </button>
                <button
                  onClick={() => setModalTab("chat")}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${modalTab === "chat" ? "bg-white text-[#1A1A2E] shadow-sm" : "text-[#64748B] hover:text-[#475569]"}`}
                >
                  Holders Chat
                </button>
              </div>
            </div>
            <div className="p-4">
              {modalTab === "trade" ? (
                <TokenTrade tokenMint={selectedToken.tokenMint} tokenSymbol={selectedToken.symbol} tokenImage={selectedToken.image} compact />
              ) : (
                <TokenChat mint={selectedToken.tokenMint} symbol={selectedToken.symbol} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Launch Modal */}
      {showLaunchModal && (
        <TokenLaunch
          onClose={() => setShowLaunchModal(false)}
          onSuccess={(mint) => { setShowLaunchModal(false); fetchTokens(); toast("success", "Your token is live!"); }}
          username={useAppStore.getState().currentUser?.username}
        />
      )}
    </div>
  );
}
