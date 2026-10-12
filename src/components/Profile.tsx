"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ArrowLeft,
  Calendar,
  Link as LinkIcon,
  MapPin,
  MoreHorizontal,
  Shield,
  ExternalLink,
  Heart,
  MessageCircle,
  Repeat2,
  Share,
  BadgeCheck,
  Settings,
  Copy,
  Check,
  Globe,
  Camera,
  Pencil,
  X,
  Loader2,
  Key,
  Wallet,
  ArrowDownToLine,
  QrCode,
  RefreshCw,
  Send,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useProgram } from "@/hooks/useProgram";
import { useWallet, useConnection } from "@/hooks/usePrivyWallet";
import { usePrivy } from "@privy-io/react-auth";
import { useExportWallet } from "@privy-io/react-auth/solana";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { toast } from "@/components/Toast";
import { RichContent } from "@/components/RichContent";
import { uploadImage, handleIpfsImgError } from "@/components/RichContent";
import { ShyftClient, clearRpcCache } from "@/lib/program";
import FollowListModal from "@/components/FollowListModal";

/* ───────── Types ───────── */
interface OnChainPost {
  publicKey: string;
  author: string;
  postId: string;
  content: string;
  likes: string;
  commentCount: string;
  createdAt: string;
  isPrivate: boolean;
}

/* ───────── Helpers ───────── */

// Gold badge for OG / founder accounts (module-level so all components can use it)
const GOLD_BADGE_USERNAMES = ["shaan", "shyft"];
// Profiles created before this Unix timestamp (May 12 2026) keep their blue badge
const BLUE_BADGE_CUTOFF_UNIX = 1778544000;

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  return `${mo}mo`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function shortKey(key: string): string {
  return key.slice(0, 4) + "..." + key.slice(-4);
}

/* ───────── Reactions ───────── */
const REACTIONS = [
  { emoji: "❤️", label: "Love" },
  { emoji: "🔥", label: "Fire" },
  { emoji: "🚀", label: "Rocket" },
  { emoji: "😂", label: "Laugh" },
  { emoji: "👏", label: "Clap" },
  { emoji: "💡", label: "Insightful" },
];

/* ═══════════════════════════════════════════════════════════════
   Profile Component — X/Twitter-inspired
   ═══════════════════════════════════════════════════════════════ */

export default function Profile() {
  const { currentUser, setCurrentUser, isConnected, viewingProfile, setViewingProfile, setActiveTab: setAppTab } = useAppStore();
  const program = useProgram();
  const { publicKey, evmAddress, activeChain } = useWallet();

  // Are we viewing someone else's profile?
  const isViewingOther = !!(viewingProfile && publicKey && viewingProfile !== publicKey.toBase58());
  const targetAddress = isViewingOther ? viewingProfile! : publicKey?.toBase58() || "";
  const targetPubkey = (() => { try { return targetAddress ? new PublicKey(targetAddress) : null; } catch { return null; } })();

  /* state */
  const [loading, setLoading] = useState(true);
  const [onChainProfile, setOnChainProfile] = useState<any>(null);
  const [myPosts, setMyPosts] = useState<OnChainPost[]>([]);
  const [allComments, setAllComments] = useState<any[]>([]);
  const [allReactions, setAllReactions] = useState<any[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, any>>({});
  const [activeTab, setActiveTab] = useState<"posts" | "likes">("posts");
  const [copied, setCopied] = useState(false);
  const [copiedEvm, setCopiedEvm] = useState(false);
  const [realFollowerCount, setRealFollowerCount] = useState(0);
  const [realFollowingCount, setRealFollowingCount] = useState(0);

  /* profile creation form */
  const [showSetup, setShowSetup] = useState(true);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [creating, setCreating] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameTaken, setUsernameTaken] = useState(false);
  const [usernameChecked, setUsernameChecked] = useState(false);
  const usernameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced username availability check
  useEffect(() => {
    if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
    setUsernameChecked(false);
    setUsernameTaken(false);
    if (!username.trim() || username.trim().length < 2 || !program) return;
    setCheckingUsername(true);
    usernameTimerRef.current = setTimeout(async () => {
      try {
        const taken = await program.isUsernameTaken(username.trim(), publicKey ?? undefined);
        setUsernameTaken(taken);
        setUsernameChecked(true);
      } catch {
        setUsernameChecked(false);
      }
      setCheckingUsername(false);
    }, 500);
    return () => { if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current); };
  }, [username, program, publicKey]);

  /* wallet management */
  const { connection } = useConnection();
  const { user: privyUser } = usePrivy();
  const { exportWallet: exportSolanaWallet } = useExportWallet();
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [ethBalance, setEthBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [showQR, setShowQR] = useState(false);

  // Detect if the user has a Privy embedded wallet
  // Log linked accounts for debugging
  useEffect(() => {
    if (privyUser?.linkedAccounts) {
      console.log("🔑 Privy linked accounts:", JSON.stringify(privyUser.linkedAccounts.map((a: any) => ({
        type: a.type, chainType: a.chainType, walletClientType: a.walletClientType, address: a.address?.slice(0, 8)
      })), null, 2));
    }
  }, [privyUser]);

  const embeddedSolanaWallet = privyUser?.linkedAccounts?.find(
    (a: any) => a.type === 'wallet' && (a.walletClientType === 'privy' || a.walletClientType === 'privy-v2')
  ) as any;
  // If no embedded wallet found in linkedAccounts, check if the connected wallet address matches any embedded wallet
  const isEmbeddedWallet = !!embeddedSolanaWallet;
  const walletClientName = isEmbeddedWallet ? 'Privy Embedded' : 'External';

  /* edit mode */
  const [editing, setEditing] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editAvatarUrl, setEditAvatarUrl] = useState("");
  const [editBannerUrl, setEditBannerUrl] = useState("");
  const [editWebsiteUrl, setEditWebsiteUrl] = useState("");
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null);
  const [editBannerPreview, setEditBannerPreview] = useState<string | null>(null);
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null);
  const [editBannerFile, setEditBannerFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  /* ── fetch everything ── */
  useEffect(() => {
    if (!program || !publicKey) {
      setLoading(false);
      return;
    }
    fetchProfile();
  }, [program, publicKey, viewingProfile]);

  // Fetch wallet SOL balance
  const fetchBalance = useCallback(async () => {
    if (!publicKey || !connection) return;
    setLoadingBalance(true);
    try {
      const bal = await connection.getBalance(publicKey);
      setWalletBalance(bal / LAMPORTS_PER_SOL);
    } catch (err) {
      console.error("Balance fetch error:", err);
    }
    setLoadingBalance(false);
  }, [publicKey, connection]);

  useEffect(() => {
    fetchBalance();
    // Auto-refresh balance every 30s
    const interval = setInterval(fetchBalance, 30_000);
    return () => clearInterval(interval);
  }, [fetchBalance]);

  // Fetch ETH balance on Base for the EVM wallet
  useEffect(() => {
    if (!evmAddress) return;
    const fetchEth = async () => {
      try {
        const res = await fetch("https://mainnet.base.org", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [evmAddress, "latest"] }),
        });
        const data = await res.json();
        if (data.result) setEthBalance(parseInt(data.result, 16) / 1e18);
      } catch {}
    };
    fetchEth();
    const interval = setInterval(fetchEth, 30_000);
    return () => clearInterval(interval);
  }, [evmAddress]);

  async function handleExportWallet() {
    if (!publicKey) {
      toast("error", "No wallet", "Connect a wallet first.");
      return;
    }
    
    // Try to find the embedded wallet address to pass to Privy
    const walletAddress = embeddedSolanaWallet?.address || publicKey.toBase58();
    console.log("🔑 Exporting wallet:", { walletAddress, isEmbeddedWallet, embeddedSolanaWallet: !!embeddedSolanaWallet });
    
    if (!isEmbeddedWallet) {
      toast("error", "External wallet", `Your wallet is managed by ${walletClientName}. Open ${walletClientName} to view your private key.`);
      return;
    }
    try {
      // Use Solana-specific export hook (the EVM one from usePrivy validates Ethereum addresses)
      await exportSolanaWallet({ address: walletAddress });
    } catch (err: any) {
      console.error("Export wallet error:", err);
      toast("error", "Export failed", err?.message?.slice(0, 80) || "Could not export wallet");
    }
  }

  async function fetchProfile() {
    if (!program || !targetPubkey) return;
    setLoading(true);
    try {
      const p = await program.getProfile(targetPubkey);
      setOnChainProfile(p);
      // Fetch real follower/following counts from FollowAccount PDAs (source of truth)
      const [followers, following] = await Promise.all([
        program.getFollowers(targetPubkey),
        program.getFollowing(targetPubkey),
      ]);
      setRealFollowerCount(followers.length);
      setRealFollowingCount(following.length);

      if (p && !isViewingOther) {
        // Only update currentUser when viewing own profile
        // Validate createdAt — must be after 2020 (1577836800) to be real
        const rawTs = Number(p.createdAt);
        const validTs = rawTs > 1577836800 ? rawTs * 1000 : Date.now();
        setCurrentUser({
          publicKey: publicKey!.toBase58(),
          username: p.username,
          displayName: p.displayName,
          avatar: p.avatarUrl || "",
          bio: p.bio,
          isPrivate: p.isPrivate,
          followerCount: followers.length,
          followingCount: following.length,
          createdAt: validTs,
          avatarUrl: p.avatarUrl || "",
          bannerUrl: p.bannerUrl || "",
        });
      }
      // fetch posts
      const posts = await program.getAllPosts();
      const mine = posts
        .filter((x) => x.author === targetAddress)
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
      setMyPosts(mine);

      // fetch comments, reactions, and profiles
      const [comments, reactions, profiles] = await Promise.all([
        program.getAllComments(),
        program.getAllReactions(),
        program.getAllProfiles(),
      ]);
      setAllComments(comments);
      setAllReactions(reactions);
      const pMap: Record<string, any> = {};
      for (const p of profiles) pMap[p.owner || p.publicKey] = p;
      setProfileMap(pMap);
    } catch (err) {
      console.error("Profile fetch error:", err);
    }
    setLoading(false);
  }

  /* ── create profile ── */
  async function handleCreate() {
    if (!program || !username.trim() || !displayName.trim()) return;
    if (usernameTaken) {
      toast("error", "Username taken", "Try a different username");
      return;
    }
    setCreating(true);
    try {
      await program.createProfile(username.trim(), displayName.trim(), bio.trim());
      toast("success", "Profile created!", "Welcome to Shyft 🎉");
      clearRpcCache();
      setShowSetup(false);
      await fetchProfile();
    } catch (err: any) {
      console.error("Create profile error:", err);
      toast("error", "Failed to create profile", err?.message?.slice(0, 80) || "");
    }
    setCreating(false);
  }

  /* ── copy wallet ── */
  function copyWallet() {
    if (!publicKey) return;
    navigator.clipboard.writeText(publicKey.toBase58());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  /* ── open edit modal ── */
  function openEditModal() {
    setEditDisplayName(profileName);
    setEditBio(profileBio);
    setEditAvatarUrl(onChainProfile?.avatarUrl || currentUser?.avatarUrl || "");
    setEditBannerUrl(onChainProfile?.bannerUrl || currentUser?.bannerUrl || "");
    setEditWebsiteUrl(onChainProfile?.websiteUrl || "");
    setEditAvatarPreview(null);
    setEditBannerPreview(null);
    setEditAvatarFile(null);
    setEditBannerFile(null);
    setEditing(true);
  }

  /* ── pick image for avatar or banner ── */
  function pickImage(target: "avatar" | "banner") {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/gif,image/webp";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        toast("error", "Too large", "Image must be under 10MB");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        if (target === "avatar") {
          setEditAvatarPreview(reader.result as string);
          setEditAvatarFile(file);
        } else {
          setEditBannerPreview(reader.result as string);
          setEditBannerFile(file);
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  /* ── save profile ── */
  async function handleSaveProfile() {
    if (!program || saving) return;
    setSaving(true);
    try {
      let avatarUrl = editAvatarUrl;
      let bannerUrl = editBannerUrl;

      // Upload avatar if changed
      if (editAvatarFile) {
        toast("privacy", "Uploading avatar...", "");
        avatarUrl = await uploadImage(editAvatarFile);
      }
      // Upload banner if changed
      if (editBannerFile) {
        toast("privacy", "Uploading banner...", "");
        bannerUrl = await uploadImage(editBannerFile);
      }

      toast("privacy", "Saving profile...", "Writing to Solana");
      await program.updateProfile(
        editDisplayName.trim() || profileName,
        editBio.trim(),
        avatarUrl,
        bannerUrl,
        editWebsiteUrl.trim(),
      );
      toast("success", "Profile updated!", "Changes saved on-chain");
      clearRpcCache();
      setEditing(false);
      await fetchProfile();
    } catch (err: any) {
      console.error("Save profile error:", err);
      toast("error", "Failed to save", err?.message?.slice(0, 80) || "");
    }
    setSaving(false);
  }

  /* derived — use real PDA-based counts, not on-chain counters (which may be corrupt for migrated profiles) */
  const followerCount = realFollowerCount;
  const followingCount = realFollowingCount;
  const postCount = myPosts.length;
  const rawCreatedAt = Number(onChainProfile?.createdAt || 0);
  const joinDate = rawCreatedAt > 1577836800
    ? formatDate(rawCreatedAt * 1000)
    : !isViewingOther && currentUser?.createdAt && currentUser.createdAt > 1577836800000
    ? formatDate(currentUser.createdAt)
    : formatDate(Date.now());
  const profileName = isViewingOther
    ? (onChainProfile?.displayName || "Anonymous")
    : (onChainProfile?.displayName || currentUser?.displayName || "Anonymous");
  const profileUsername = isViewingOther
    ? (onChainProfile?.username || "")
    : (onChainProfile?.username || currentUser?.username || "");
  const profileBio = isViewingOther
    ? (onChainProfile?.bio || "")
    : (onChainProfile?.bio || currentUser?.bio || "");
  const avatarUrl = isViewingOther
    ? (onChainProfile?.avatarUrl || "")
    : (onChainProfile?.avatarUrl || currentUser?.avatarUrl || "");
  const bannerUrl = isViewingOther
    ? (onChainProfile?.bannerUrl || "")
    : (onChainProfile?.bannerUrl || currentUser?.bannerUrl || "");
  const websiteUrl = onChainProfile?.websiteUrl || "";

  /* ── Follow state for viewing other profiles ── */
  const [isFollowingUser, setIsFollowingUser] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  /* ── Follow list modal ── */
  const [showFollowList, setShowFollowList] = useState(false);
  const [followListTab, setFollowListTab] = useState<"verified_followers" | "followers" | "following">("followers");

  useEffect(() => {
    if (!isViewingOther || !program || !targetPubkey) return;
    program.isFollowing(targetPubkey).then(setIsFollowingUser).catch(() => {});
  }, [isViewingOther, program, targetAddress]);

  const handleFollowToggle = async () => {
    if (!program || !targetPubkey || followLoading) return;
    setFollowLoading(true);
    try {
      if (isFollowingUser) {
        await program.unfollowUser(targetPubkey);
        toast("success", "Unfollowed", `You unfollowed @${profileUsername}`);
        setIsFollowingUser(false);
        setRealFollowerCount((c) => Math.max(0, c - 1));
      } else {
        await program.followUser(targetPubkey);
        toast("success", "Following!", `You are now following @${profileUsername}`);
        setIsFollowingUser(true);
        setRealFollowerCount((c) => c + 1);
      }
    } catch (err: any) {
      console.error("Follow error:", err);
      toast("error", "Failed", err?.message?.slice(0, 80) || "Try again");
    }
    setFollowLoading(false);
  };

  const handleBackToFeed = () => {
    setViewingProfile(null);
    setAppTab("feed");
  };

  // Gold badge for OG / founder accounts
  const isGoldBadge = GOLD_BADGE_USERNAMES.includes(profileUsername.toLowerCase());
  const isOGUser = !isGoldBadge && rawCreatedAt > 0 && rawCreatedAt < BLUE_BADGE_CUTOFF_UNIX;
  const badgeBg = isGoldBadge ? "bg-gradient-to-br from-[#F59E0B] to-[#D97706]" : "bg-[#2563EB]";
  const badgeTextColor = isGoldBadge ? "text-[#F59E0B]" : "text-[#2563EB]";

  /* ════════════ NOT CONNECTED ════════════ */
  if (!isConnected || !publicKey) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-[#F1F5F9] flex items-center justify-center">
            <Shield className="w-10 h-10 text-[#94A3B8]" />
          </div>
          <h2 className="text-xl font-bold text-[#1A1A2E] mb-2">Connect your wallet</h2>
          <p className="text-[#64748B] text-sm">Connect to view your on-chain profile</p>
        </div>
      </div>
    );
  }

  /* ════════════ LOADING ════════════ */
  if (loading) {
    return (
      <div className="max-w-[600px] mx-auto animate-pulse">
        {/* Banner skeleton */}
        <div className="h-[200px] bg-[#E2E8F0] rounded-b-none" />
        <div className="px-4 pb-4 bg-white border-x border-b border-[#E2E8F0]">
          <div className="relative -mt-[42px] mb-3">
            <div className="w-[84px] h-[84px] rounded-full bg-[#E2E8F0] border-4 border-white" />
          </div>
          <div className="h-5 bg-[#E2E8F0] rounded w-32 mb-2" />
          <div className="h-4 bg-[#E2E8F0] rounded w-24 mb-4" />
          <div className="h-4 bg-[#E2E8F0] rounded w-full mb-2" />
          <div className="h-4 bg-[#E2E8F0] rounded w-3/4" />
        </div>
      </div>
    );
  }

  /* ════════════ NO PROFILE — SETUP ════════════ */
  if (!onChainProfile && !currentUser) {
    return (
      <div className="max-w-[600px] mx-auto">
        {/* Banner */}
        <div className="h-[200px] bg-gradient-to-r from-[#2563EB] via-[#3B82F6] to-[#60A5FA]" />
        <div className="bg-white border-x border-b border-[#E2E8F0] px-4 pb-6">
          <div className="relative -mt-[42px] mb-4">
            <div className="w-[84px] h-[84px] rounded-full bg-[#F1F5F9] border-4 border-white flex items-center justify-center text-3xl shadow-sm">
              👤
            </div>
          </div>

          {!showSetup ? (
            <div>
              <h2 className="text-xl font-extrabold text-[#1A1A2E] mb-1">Set up your profile</h2>
              <p className="text-[#64748B] text-[15px] mb-1">
                {shortKey(publicKey.toBase58())}
              </p>
              <p className="text-[#64748B] text-sm mt-3 mb-4">
                Create your on-chain profile to start posting and connecting with others.
              </p>
              <button
                onClick={() => setShowSetup(true)}
                className="px-5 py-2.5 bg-[#1A1A2E] text-white font-bold text-sm rounded-full hover:bg-[#2A2A3E] transition-colors"
              >
                Create Profile
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <h2 className="text-xl font-extrabold text-[#1A1A2E]">Create your profile</h2>

              {/* Username */}
              <div>
                <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Username</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8] text-sm">@</span>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                    placeholder="username"
                    maxLength={16}
                    className={`w-full pl-8 pr-3 py-2.5 bg-[#F8FAFC] border rounded-xl text-sm text-[#1A1A2E] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 transition-all ${
                      usernameChecked && !checkingUsername
                        ? usernameTaken
                          ? "border-red-400 focus:ring-red-200 focus:border-red-400"
                          : "border-green-400 focus:ring-green-200 focus:border-green-400"
                        : "border-[#E2E8F0] focus:border-[#2563EB] focus:ring-[#2563EB]/10"
                    }`}
                  />
                </div>
                {username.trim().length >= 2 && (
                  <div className="flex items-center gap-1 mt-1">
                    {checkingUsername ? (
                      <span className="text-[11px] text-[#94A3B8]">Checking...</span>
                    ) : usernameChecked ? (
                      usernameTaken ? (
                        <span className="text-[11px] text-red-500 flex items-center gap-1">
                          <XCircle className="w-3 h-3" /> Username taken
                        </span>
                      ) : (
                        <span className="text-[11px] text-green-600 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Available
                        </span>
                      )
                    ) : null}
                  </div>
                )}
              </div>

              {/* Display Name */}
              <div>
                <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Display Name</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  maxLength={24}
                  className="w-full px-3 py-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-sm text-[#1A1A2E] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10 transition-all"
                />
              </div>

              {/* Bio */}
              <div>
                <label className="block text-[13px] font-medium text-[#64748B] mb-1.5">Bio</label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell the world about yourself"
                  maxLength={64}
                  rows={2}
                  className="w-full px-3 py-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-sm text-[#1A1A2E] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10 transition-all resize-none"
                />
                <p className="text-[11px] text-[#94A3B8] mt-1 text-right">{bio.length}/64</p>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowSetup(false)}
                  className="px-5 py-2.5 text-[#1A1A2E] font-bold text-sm rounded-full border border-[#E2E8F0] hover:bg-[#F1F5F9] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!username.trim() || !displayName.trim() || creating || usernameTaken || checkingUsername}
                  className="px-5 py-2.5 bg-[#1A1A2E] text-white font-bold text-sm rounded-full hover:bg-[#2A2A3E] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {creating ? "Creating..." : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════
     MAIN PROFILE VIEW — X-style
     ═══════════════════════════════════════ */
  return (
    <div className="max-w-[600px] mx-auto min-h-screen">
      {/* ── Top bar ── */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-[#E2E8F0] px-4 py-2.5 flex items-center gap-4">
        {isViewingOther && (
          <button
            onClick={handleBackToFeed}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[#F1F5F9] transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-[#1A1A2E]" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-extrabold text-[#1A1A2E] truncate leading-tight">
            {profileName}
          </h1>
          <p className="text-[13px] text-[#64748B] leading-tight">
            {postCount} post{postCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* ── Banner ── */}
      <div className="h-[200px] relative overflow-hidden">
        {bannerUrl ? (
          <img src={bannerUrl} alt="Banner" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#2563EB] via-[#3B82F6] to-[#60A5FA]">
            <div className="absolute inset-0 opacity-10" style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }} />
          </div>
        )}
      </div>

      {/* ── Profile Info Section ── */}
      <div className="bg-white border-x border-[#E2E8F0] px-4 pb-4">
        {/* Avatar + Edit/Follow button row */}
        <div className="flex justify-between items-start">
          <div className="relative -mt-[42px]">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                onError={handleIpfsImgError}
                alt={profileName}
                className="w-[84px] h-[84px] rounded-full border-4 border-white object-cover shadow-lg"
              />
            ) : (
              <div className="w-[84px] h-[84px] rounded-full bg-gradient-to-br from-[#EBF4FF] to-[#DBEAFE] border-4 border-white flex items-center justify-center text-4xl shadow-lg font-bold text-[#2563EB]">
                {profileName.charAt(0).toUpperCase()}
              </div>
            )}
            {/* verified badge — gold for OGs, blue for existing users before cutoff */}
            {(isGoldBadge || isOGUser) && (
              <div className={`absolute -bottom-0.5 -right-0.5 w-6 h-6 ${badgeBg} rounded-full flex items-center justify-center border-2 border-white`}>
                <BadgeCheck className="w-3.5 h-3.5 text-white" />
              </div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            {isViewingOther ? (
              <>
                <button
                  onClick={handleFollowToggle}
                  disabled={followLoading}
                  className={`px-5 py-1.5 rounded-full text-sm font-bold transition-colors disabled:opacity-50 ${
                    isFollowingUser
                      ? "border border-[#E2E8F0] text-[#1A1A2E] hover:border-red-300 hover:text-red-500 hover:bg-red-50"
                      : "bg-[#1A1A2E] text-white hover:bg-[#2A2A3E]"
                  }`}
                >
                  {followLoading ? "..." : isFollowingUser ? "Following" : "Follow"}
                </button>
                <a
                  href={`https://explorer.solana.com/address/${targetAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full border border-[#E2E8F0] flex items-center justify-center hover:bg-[#F1F5F9] transition-colors"
                  title="View on Solana Explorer"
                >
                  <ExternalLink className="w-4 h-4 text-[#64748B]" />
                </a>
              </>
            ) : (
              <>
                <button
                  onClick={openEditModal}
                  className="px-4 py-1.5 rounded-full border border-[#E2E8F0] text-sm font-bold text-[#1A1A2E] hover:bg-[#F1F5F9] transition-colors"
                >
                  Edit profile
                </button>
                <button
                  onClick={copyWallet}
                  className="w-9 h-9 rounded-full border border-[#E2E8F0] flex items-center justify-center hover:bg-[#F1F5F9] transition-colors"
                  title="Copy wallet address"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-[#16A34A]" />
                  ) : (
                    <Copy className="w-4 h-4 text-[#64748B]" />
                  )}
                </button>
                <a
                  href={`https://explorer.solana.com/address/${publicKey?.toBase58()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full border border-[#E2E8F0] flex items-center justify-center hover:bg-[#F1F5F9] transition-colors"
                  title="View on Solana Explorer"
                >
                  <ExternalLink className="w-4 h-4 text-[#64748B]" />
                </a>
              </>
            )}
          </div>
        </div>

        {/* Name & handle */}
        <div className="mt-2">
          <div className="flex items-center gap-1.5">
            <h2 className="text-xl font-extrabold text-[#1A1A2E]">{profileName}</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <p className="text-[15px] text-[#64748B]">@{profileUsername}</p>
            {isGoldBadge && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-[#F59E0B] to-[#D97706] text-white">OG</span>}
          </div>
        </div>

        {/* Bio */}
        {profileBio && (
          <p className="mt-3 text-[15px] text-[#1A1A2E] leading-relaxed whitespace-pre-wrap">
            {profileBio}
          </p>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3">
          {websiteUrl && (
            <a
              href={websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[13px] text-[#2563EB] hover:underline"
            >
              <LinkIcon className="w-3.5 h-3.5" />
              {websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          )}
          <span className="flex items-center gap-1 text-[13px] text-[#64748B]">
            <Calendar className="w-3.5 h-3.5" />
            Joined {joinDate}
          </span>
          <span className="flex items-center gap-1 text-[13px] text-[#64748B]">
            <Shield className="w-3.5 h-3.5" />
            {shortKey(targetAddress)}
          </span>
        </div>

        {/* Following / Followers */}
        <div className="flex gap-4 mt-3">
          <button
            onClick={() => { setFollowListTab("following"); setShowFollowList(true); }}
            className="group flex items-center gap-1 hover:underline decoration-[#1A1A2E]"
          >
            <span className="text-sm font-bold text-[#1A1A2E]">{followingCount}</span>
            <span className="text-sm text-[#64748B] group-hover:text-[#1A1A2E] transition-colors">Following</span>
          </button>
          <button
            onClick={() => { setFollowListTab("followers"); setShowFollowList(true); }}
            className="group flex items-center gap-1 hover:underline decoration-[#1A1A2E]"
          >
            <span className="text-sm font-bold text-[#1A1A2E]">{followerCount}</span>
            <span className="text-sm text-[#64748B] group-hover:text-[#1A1A2E] transition-colors">
              Follower{followerCount !== 1 ? "s" : ""}
            </span>
          </button>
        </div>

        {/* Follow List Modal */}
        <FollowListModal
          isOpen={showFollowList}
          onClose={() => setShowFollowList(false)}
          targetAddress={targetAddress}
          displayName={profileName}
          initialTab={followListTab}
          onFollowCountChange={() => { clearRpcCache(); fetchProfile(); }}
        />
      </div>

      {/* ── Wallet Management (own profile only) ── */}
      {!isViewingOther && (
      <div className="bg-white border-x border-[#E2E8F0] px-4 py-4 border-b">
        <div className="bg-gradient-to-br from-[#F8FAFC] to-[#EFF6FF] rounded-2xl border border-[#E2E8F0] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#2563EB]/10 flex items-center justify-center">
                <Wallet className="w-4 h-4 text-[#2563EB]" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#1A1A2E]">Wallet</h3>
                <p className="text-[11px] text-[#64748B]">Solana Mainnet · {isEmbeddedWallet ? 'Embedded' : walletClientName}</p>
              </div>
            </div>
            <button
              onClick={fetchBalance}
              disabled={loadingBalance}
              className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/80 transition-colors"
              title="Refresh balance"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#64748B] ${loadingBalance ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Balance */}
          <div className="mb-4">
            <p className="text-[11px] text-[#64748B] mb-0.5">Balance</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold text-[#1A1A2E]">
                {walletBalance !== null ? walletBalance.toFixed(4) : "..."}
              </span>
              <span className="text-sm font-medium text-[#64748B]">SOL</span>
            </div>
            {walletBalance !== null && walletBalance < 0.01 && (
              <p className="text-[11px] text-amber-600 mt-1">⚠️ Low balance — SOL needed for token trading & payments</p>
            )}
          </div>

          {/* Wallet address with copy */}
          <div className="mb-4 bg-white rounded-xl border border-[#E2E8F0] px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] text-[#94A3B8] mb-0.5">Wallet Address</p>
              <p className="text-xs font-mono text-[#1A1A2E] truncate">{publicKey?.toBase58()}</p>
            </div>
            <button
              onClick={copyWallet}
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#F1F5F9] transition-colors"
              title="Copy address"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#16A34A]" /> : <Copy className="w-3.5 h-3.5 text-[#64748B]" />}
            </button>
          </div>

          {/* QR Code (togglable) */}
          {showQR && publicKey && (
            <div className="mb-4 flex flex-col items-center bg-white rounded-xl border border-[#E2E8F0] p-4">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${publicKey.toBase58()}`}
                alt="Wallet QR Code"
                className="w-[180px] h-[180px] rounded-lg"
              />
              <p className="text-[11px] text-[#64748B] mt-2">Scan to send SOL to this wallet</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="grid grid-cols-3 gap-2">
            {isEmbeddedWallet ? (
              <button
                onClick={handleExportWallet}
                className="flex flex-col items-center gap-1.5 py-3 px-2 bg-white rounded-xl border border-[#E2E8F0] hover:bg-[#F8FAFC] hover:border-[#2563EB]/30 transition-all group"
              >
                <Key className="w-4 h-4 text-[#64748B] group-hover:text-[#2563EB] transition-colors" />
                <span className="text-[11px] font-medium text-[#64748B] group-hover:text-[#1A1A2E] transition-colors">Export Key</span>
              </button>
            ) : (
              <div
                className="flex flex-col items-center gap-1.5 py-3 px-2 bg-white rounded-xl border border-[#E2E8F0] opacity-60"
                title={`Managed by ${walletClientName}`}
              >
                <Key className="w-4 h-4 text-[#94A3B8]" />
                <span className="text-[11px] font-medium text-[#94A3B8]">{walletClientName}</span>
              </div>
            )}
            <button
              onClick={() => setShowQR(!showQR)}
              className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all group ${
                showQR
                  ? "bg-[#EFF6FF] border-[#2563EB]/30 text-[#2563EB]"
                  : "bg-white border-[#E2E8F0] hover:bg-[#F8FAFC] hover:border-[#2563EB]/30"
              }`}
            >
              <QrCode className={`w-4 h-4 ${showQR ? "text-[#2563EB]" : "text-[#64748B] group-hover:text-[#2563EB]"} transition-colors`} />
              <span className={`text-[11px] font-medium ${showQR ? "text-[#2563EB]" : "text-[#64748B] group-hover:text-[#1A1A2E]"} transition-colors`}>
                {showQR ? "Hide QR" : "Receive"}
              </span>
            </button>
            <a
              href={`https://explorer.solana.com/address/${publicKey?.toBase58()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-1.5 py-3 px-2 bg-white rounded-xl border border-[#E2E8F0] hover:bg-[#F8FAFC] hover:border-[#2563EB]/30 transition-all group"
            >
              <ExternalLink className="w-4 h-4 text-[#64748B] group-hover:text-[#2563EB] transition-colors" />
              <span className="text-[11px] font-medium text-[#64748B] group-hover:text-[#1A1A2E] transition-colors">Explorer</span>
            </a>
          </div>
        </div>

        {/* Base wallet card — shown when user has an EVM wallet */}
        {evmAddress && (
          <div className="mt-3 bg-gradient-to-br from-[#EFF6FF] to-[#DBEAFE] rounded-2xl border border-[#BFDBFE] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#0052FF" }}>
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white">
                    <circle cx="12" cy="12" r="10" />
                    <path fill="#0052FF" d="M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zm.55 11.4v-2.47h-1.1v2.47A4.5 4.5 0 0 1 7.5 12a4.5 4.5 0 0 1 4.5-4.5 4.5 4.5 0 0 1 4.45 3.9H14a2 2 0 1 0-2 2c.188 0 .372-.025.55-.1z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#1A1A2E]">Base Wallet</h3>
                  <p className="text-[11px] text-[#3B82F6]">Base Mainnet · {activeChain === "base" ? "Active" : "Embedded"}</p>
                </div>
              </div>
              {activeChain === "base" && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#0052FF] text-white">Primary</span>
              )}
            </div>

            {/* ETH balance */}
            <div className="mb-4">
              <p className="text-[11px] text-[#3B82F6] mb-0.5">Balance</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold text-[#1A1A2E]">
                  {ethBalance !== null ? ethBalance.toFixed(4) : "..."}
                </span>
                <span className="text-sm font-medium text-[#3B82F6]">ETH</span>
              </div>
            </div>

            {/* Base address */}
            <div className="mb-4 bg-white rounded-xl border border-[#BFDBFE] px-3 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] text-[#93C5FD] mb-0.5">Base Address</p>
                <p className="text-xs font-mono text-[#1A1A2E] truncate">{evmAddress}</p>
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(evmAddress); setCopiedEvm(true); setTimeout(() => setCopiedEvm(false), 2000); }}
                className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#EFF6FF] transition-colors"
                title="Copy Base address"
              >
                {copiedEvm ? <Check className="w-3.5 h-3.5 text-[#16A34A]" /> : <Copy className="w-3.5 h-3.5 text-[#3B82F6]" />}
              </button>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { navigator.clipboard.writeText(evmAddress); setCopiedEvm(true); setTimeout(() => setCopiedEvm(false), 2000); }}
                className="flex flex-col items-center gap-1.5 py-3 px-2 bg-white rounded-xl border border-[#BFDBFE] hover:bg-[#EFF6FF] hover:border-[#0052FF]/30 transition-all group"
              >
                <Copy className="w-4 h-4 text-[#3B82F6]" />
                <span className="text-[11px] font-medium text-[#3B82F6]">Copy Address</span>
              </button>
              <a
                href={`https://basescan.org/address/${evmAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-1.5 py-3 px-2 bg-white rounded-xl border border-[#BFDBFE] hover:bg-[#EFF6FF] hover:border-[#0052FF]/30 transition-all group"
              >
                <ExternalLink className="w-4 h-4 text-[#3B82F6]" />
                <span className="text-[11px] font-medium text-[#3B82F6]">Basescan</span>
              </a>
            </div>
          </div>
        )}
      </div>
      )}

      {/* ── Tabs ── */}
      <div className="bg-white border-x border-[#E2E8F0] flex">
        {(["posts", "likes"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3.5 text-sm font-semibold text-center relative transition-colors ${
              activeTab === tab
                ? "text-[#1A1A2E]"
                : "text-[#64748B] hover:text-[#1A1A2E] hover:bg-[#F8FAFC]"
            }`}
          >
            {tab === "posts" ? "Posts" : "Likes"}
            {activeTab === tab && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-14 h-[3px] bg-[#2563EB] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* ── Divider ── */}
      <div className="border-b border-[#E2E8F0]" />

      {/* ── Posts Feed ── */}
      <div className="bg-white border-x border-[#E2E8F0]">
        {activeTab === "posts" && (
          <>
            {myPosts.length === 0 ? (
              <div className="py-12 text-center">
                <div className="text-4xl mb-3">✍️</div>
                <h3 className="text-[15px] font-bold text-[#1A1A2E] mb-1">No posts yet</h3>
                <p className="text-sm text-[#64748B]">
                  When you post, they&apos;ll show up here.
                </p>
              </div>
            ) : (
              myPosts.map((post) => (
                <ProfilePostCard
                  key={post.publicKey}
                  post={post}
                  profileName={profileName}
                  profileUsername={profileUsername}
                  avatarUrl={avatarUrl}
                  comments={allComments.filter((c) => c.post === post.publicKey)}
                  reactions={allReactions.filter((r) => r.post === post.publicKey)}
                  program={program}
                  profileMap={profileMap}
                  publicKey={publicKey}
                  onInteraction={() => fetchProfile()}
                />
              ))
            )}
          </>
        )}
        {activeTab === "likes" && (
          <div className="py-12 text-center">
            <div className="text-4xl mb-3">❤️</div>
            <h3 className="text-[15px] font-bold text-[#1A1A2E] mb-1">Coming soon</h3>
            <p className="text-sm text-[#64748B]">
              Your liked posts will appear here.
            </p>
          </div>
        )}
      </div>

      {/* ── Bottom border ── */}
      <div className="bg-white border-x border-b border-[#E2E8F0] rounded-b-xl h-4" />

      {/* ═══ Edit Profile Modal ═══ */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 sm:pt-16">
          <div className="absolute inset-0 bg-black/50" onClick={() => !saving && setEditing(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-[600px] mx-4 max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in">
            {/* Modal header */}
            <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm flex items-center justify-between px-4 py-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => !saving && setEditing(false)}
                  className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[#F1F5F9] transition-colors"
                >
                  <X className="w-5 h-5 text-[#1A1A2E]" />
                </button>
                <h2 className="text-lg font-bold text-[#1A1A2E]">Edit profile</h2>
              </div>
              <button
                onClick={handleSaveProfile}
                disabled={saving}
                className="px-4 py-1.5 bg-[#1A1A2E] text-white font-bold text-sm rounded-full hover:bg-[#2A2A3E] transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </button>
            </div>

            {/* Banner edit */}
            <div className="h-[200px] relative overflow-hidden group cursor-pointer" onClick={() => pickImage("banner")}>
              {editBannerPreview || editBannerUrl ? (
                <img
                  src={editBannerPreview || editBannerUrl}
                  alt="Banner"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#2563EB] via-[#3B82F6] to-[#60A5FA]" />
              )}
              <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 flex items-center justify-center gap-3 transition-all">
                <button
                  onClick={(e) => { e.stopPropagation(); pickImage("banner"); }}
                  className="w-11 h-11 bg-black/50 group-hover:bg-black/70 rounded-full flex items-center justify-center transition-colors"
                >
                  <Camera className="w-5 h-5 text-white" />
                </button>
                {(editBannerPreview || editBannerUrl) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditBannerPreview(null); setEditBannerFile(null); setEditBannerUrl(""); }}
                    className="w-11 h-11 bg-black/50 group-hover:bg-black/70 rounded-full flex items-center justify-center transition-colors"
                  >
                    <X className="w-5 h-5 text-white" />
                  </button>
                )}
              </div>
            </div>

            {/* Avatar edit */}
            <div className="px-4 -mt-[42px] mb-4 relative">
              <div className="relative w-[84px] h-[84px] group">
                {editAvatarPreview || editAvatarUrl ? (
                  <img
                    src={editAvatarPreview || editAvatarUrl}
                    alt="Avatar"
                    className="w-[84px] h-[84px] rounded-full border-4 border-white object-cover"
                  />
                ) : (
                  <div className="w-[84px] h-[84px] rounded-full bg-gradient-to-br from-[#EBF4FF] to-[#DBEAFE] border-4 border-white flex items-center justify-center text-4xl font-bold text-[#2563EB]">
                    {editDisplayName.charAt(0)?.toUpperCase() || "?"}
                  </div>
                )}
                <button
                  onClick={() => pickImage("avatar")}
                  className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Camera className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>

            {/* Form fields */}
            <div className="px-4 pb-6 space-y-5">
              {/* Display Name */}
              <div className="relative">
                <label className="absolute left-3 top-2 text-[11px] text-[#64748B]">Name</label>
                <input
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  maxLength={24}
                  className="w-full px-3 pt-6 pb-2 bg-transparent border border-[#E2E8F0] rounded-lg text-[15px] text-[#1A1A2E] focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10 transition-all"
                />
                <span className="absolute right-3 top-2 text-[11px] text-[#94A3B8]">{editDisplayName.length}/24</span>
              </div>

              {/* Bio */}
              <div className="relative">
                <label className="absolute left-3 top-2 text-[11px] text-[#64748B]">Bio</label>
                <textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  maxLength={64}
                  rows={2}
                  className="w-full px-3 pt-6 pb-2 bg-transparent border border-[#E2E8F0] rounded-lg text-[15px] text-[#1A1A2E] focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10 transition-all resize-none"
                />
                <span className="absolute right-3 top-2 text-[11px] text-[#94A3B8]">{editBio.length}/64</span>
              </div>

              {/* Website URL */}
              <div className="relative">
                <label className="absolute left-3 top-2 text-[11px] text-[#64748B]">Website</label>
                <div className="absolute left-3 top-[26px] text-[#94A3B8]">
                  <LinkIcon className="w-4 h-4" />
                </div>
                <input
                  value={editWebsiteUrl}
                  onChange={(e) => setEditWebsiteUrl(e.target.value)}
                  placeholder="yoursite.com"
                  maxLength={64}
                  className="w-full pl-8 pr-3 pt-6 pb-2 bg-transparent border border-[#E2E8F0] rounded-lg text-[15px] text-[#1A1A2E] focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10 transition-all"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   X-style Post Card for Profile
   ═══════════════════════════════════════ */
function ProfilePostCard({
  post,
  profileName,
  profileUsername,
  avatarUrl,
  comments,
  reactions,
  program,
  profileMap,
  publicKey,
  onInteraction,
}: {
  post: OnChainPost;
  profileName: string;
  profileUsername: string;
  avatarUrl?: string;
  comments: any[];
  reactions: any[];
  program: ShyftClient | null;
  profileMap: Record<string, any>;
  publicKey: PublicKey | null;
  onInteraction: () => void;
}) {
  const { likedPosts, addLikedPost, isConnected } = useAppStore();
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [liking, setLiking] = useState(false);
  const [localLikeBoost, setLocalLikeBoost] = useState(0);
  const [reposting, setReposting] = useState(false);
  const ts = Number(post.createdAt) * 1000;
  const hasLiked = likedPosts.includes(post.publicKey);
  const likeCount = Number(post.likes || 0) + localLikeBoost;
  const commentCount = comments.length;

  // Group reactions
  const reactionCounts: Record<number, number> = {};
  for (const r of reactions) {
    reactionCounts[r.reactionType] = (reactionCounts[r.reactionType] || 0) + 1;
  }
  const totalReactions = reactions.length;

  const handleLike = async () => {
    if (!program || !isConnected || hasLiked || liking) return;
    setLiking(true);
    try {
      const authorPubkey = new PublicKey(post.author);
      const postId = Number(post.postId);
      await program.likePost(authorPubkey, postId);
      addLikedPost(post.publicKey);
      setLocalLikeBoost((prev) => prev + 1);
      toast("success", "Liked! ❤️", "Recorded on-chain");
    } catch (err: any) {
      console.error("Like error:", err);
      toast("error", "Like failed", err?.message?.slice(0, 80) || "Please try again");
    }
    setLiking(false);
  };

  const handleComment = async () => {
    if (!commentText.trim() || !program || !publicKey || commenting) return;
    setCommenting(true);
    try {
      const authorPubkey = new PublicKey(post.author);
      const postId = Number(post.postId);
      const commentIndex = Date.now();
      await program.createComment(authorPubkey, postId, commentIndex, commentText.trim());
      setCommentText("");
      toast("success", "Comment posted! 💬", "On-chain");
      onInteraction();
    } catch (err: any) {
      console.error("Comment error:", err);
      toast("error", "Comment failed", err?.message?.slice(0, 80) || "Please try again");
    }
    setCommenting(false);
  };

  const handleShare = async () => {
    const authorName = profileUsername ? `@${profileUsername}` : post.author.slice(0, 8);
    const preview = post.content.length > 80 ? post.content.slice(0, 80) + "..." : post.content;
    const shareUrl = `https://baddie.stream`;
    const shareText = `"${preview}" — ${authorName} on Shyft\n\n${shareUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${authorName} on Shyft`, text: `"${preview}"`, url: shareUrl });
      } catch {}
    } else {
      await navigator.clipboard.writeText(shareText);
      toast("success", "Link copied! 🔗", "Share it with your friends");
    }
  };

  const handleRepost = async () => {
    if (reposting || !program || !publicKey) return;
    setReposting(true);
    try {
      const authorName = profileUsername ? `@${profileUsername}` : post.author.slice(0, 8);
      const preview = post.content.length > 120 ? post.content.slice(0, 120) + "..." : post.content;
      const repostContent = `RT|${authorName}|${preview}`;
      const postId = Date.now();
      await program.createPost(postId, repostContent, false);
      toast("success", "Reposted! 🔁", "Published on-chain");
      onInteraction();
    } catch (err: any) {
      console.error("Repost error:", err);
      toast("error", "Repost failed", err?.message?.slice(0, 80) || "Please try again");
    }
    setReposting(false);
  };

  const resolveAuthor = (addr: string) => {
    const p = profileMap[addr];
    if (p?.displayName) return p.displayName;
    if (p?.username) return `@${p.username}`;
    return shortKey(addr);
  };

  return (
    <div className="border-b border-[#E2E8F0] px-4 py-3 hover:bg-[#F8FAFC]/50 transition-colors">
      <div className="flex gap-3">
        {/* Avatar */}
        {avatarUrl ? (
          <img src={avatarUrl} onError={handleIpfsImgError} alt={profileName} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#EBF4FF] to-[#DBEAFE] flex items-center justify-center text-lg font-bold text-[#2563EB] flex-shrink-0">
            {profileName.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Author line */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-[15px] text-[#1A1A2E] truncate">{profileName}</span>
            {GOLD_BADGE_USERNAMES.includes(profileUsername.toLowerCase()) ? (
              <BadgeCheck className="w-4 h-4 flex-shrink-0 text-[#F59E0B]" />
            ) : (() => { const owner = Object.keys(profileMap).find(k => profileMap[k]?.username?.toLowerCase() === profileUsername.toLowerCase()); const ts = parseInt(String(profileMap[owner || ""]?.createdAt || 0), 10); return ts > 0 && ts < BLUE_BADGE_CUTOFF_UNIX; })() ? (
              <BadgeCheck className="w-4 h-4 flex-shrink-0 text-[#2563EB]" />
            ) : null}
            <span className="text-[15px] text-[#64748B] truncate">@{profileUsername}</span>
            <span className="text-[#64748B]">·</span>
            <span className="text-[13px] text-[#64748B] flex-shrink-0">{timeAgo(ts)}</span>
          </div>

          {/* Content */}
          <div className="mt-1">
            {(() => {
              if (post.content.startsWith("RT|")) {
                const parts = post.content.split("|");
                const rtAuthor = parts[1] || "";
                const rtContent = parts.slice(2).join("|");
                return (
                  <div>
                    <div className="flex items-center gap-1.5 text-[13px] text-[#64748B] mb-2">
                      <Repeat2 className="w-3.5 h-3.5" />
                      <span>Reposted from <span className="font-semibold text-[#1A1A2E]">{rtAuthor}</span></span>
                    </div>
                    <div className="border border-[#E2E8F0] rounded-xl px-4 py-3 bg-[#F8FAFC]">
                      <RichContent content={rtContent} />
                    </div>
                  </div>
                );
              }
              const legacyMatch = post.content.match(/^\u{1F501}\s*Repost from (@\w+):\s*[\\n]*\s*"?([\s\S]*?)"?\s*$/u);
              if (legacyMatch) {
                const rtAuthor = legacyMatch[1];
                const rtContent = legacyMatch[2].replace(/\\n/g, '').replace(/^"|"$/g, '').trim();
                return (
                  <div>
                    <div className="flex items-center gap-1.5 text-[13px] text-[#64748B] mb-2">
                      <Repeat2 className="w-3.5 h-3.5" />
                      <span>Reposted from <span className="font-semibold text-[#1A1A2E]">{rtAuthor}</span></span>
                    </div>
                    <div className="border border-[#E2E8F0] rounded-xl px-4 py-3 bg-[#F8FAFC]">
                      <RichContent content={rtContent} />
                    </div>
                  </div>
                );
              }
              return <RichContent content={post.content} />;
            })()}
          </div>

          {/* Reaction chips */}
          {totalReactions > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {Object.entries(reactionCounts).map(([type, count]) => (
                <span
                  key={type}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F1F5F9] text-xs"
                >
                  {REACTIONS[Number(type)]?.emoji} {count}
                </span>
              ))}
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center justify-between mt-2 max-w-[380px] -ml-2">
            {/* Comments */}
            <button
              onClick={() => setShowComments(!showComments)}
              className="group flex items-center gap-1.5 px-2 py-1.5 rounded-full hover:bg-[#EBF4FF] transition-colors"
            >
              <MessageCircle className="w-4 h-4 text-[#64748B] group-hover:text-[#2563EB] transition-colors" />
              <span className="text-[13px] text-[#64748B] group-hover:text-[#2563EB] transition-colors">
                {commentCount || ""}
              </span>
            </button>

            {/* Repost — creates on-chain repost */}
            <button
              onClick={handleRepost}
              disabled={reposting || !isConnected}
              className="group flex items-center gap-1.5 px-2 py-1.5 rounded-full hover:bg-[#F0FDF4] transition-colors disabled:opacity-40"
            >
              <Repeat2 className={`w-4 h-4 transition-colors ${reposting ? "text-[#16A34A] animate-spin" : "text-[#64748B] group-hover:text-[#16A34A]"}`} />
            </button>

            {/* Likes */}
            <button
              onClick={handleLike}
              disabled={hasLiked || liking}
              className="group flex items-center gap-1.5 px-2 py-1.5 rounded-full hover:bg-[#FEF2F2] transition-colors disabled:opacity-50"
            >
              <Heart className={`w-4 h-4 transition-colors ${hasLiked ? "text-[#EF4444] fill-[#EF4444]" : "text-[#64748B] group-hover:text-[#EF4444]"}`} />
              <span className={`text-[13px] transition-colors ${hasLiked ? "text-[#EF4444]" : "text-[#64748B] group-hover:text-[#EF4444]"}`}>
                {likeCount || ""}
              </span>
            </button>

            {/* Share */}
            <button
              onClick={handleShare}
              className="group flex items-center px-2 py-1.5 rounded-full hover:bg-[#EBF4FF] transition-colors"
            >
              <Share className="w-4 h-4 text-[#64748B] group-hover:text-[#2563EB] transition-colors" />
            </button>
          </div>

          {/* Comments section */}
          {showComments && (
            <div className="mt-2 border-l-2 border-[#E2E8F0] pl-3 ml-1">
              {comments.length > 0 && (
                <div className="space-y-2 mb-2">
                  {comments
                    .sort((a: any, b: any) => Number(a.createdAt) - Number(b.createdAt))
                    .map((c: any, i: number) => (
                      <div key={i} className="text-[13px]">
                        <span className="font-semibold text-[#1A1A2E]">
                          {resolveAuthor(c.author)}
                        </span>
                        <span className="text-[#64748B] ml-1.5">
                          {c.content}
                        </span>
                        <span className="text-[#94A3B8] ml-1.5">
                          · {timeAgo(Number(c.createdAt) * 1000)}
                        </span>
                      </div>
                    ))}
                </div>
              )}
              {comments.length === 0 && (
                <p className="text-xs text-[#94A3B8] mb-2">No comments yet.</p>
              )}
              {/* Comment input */}
              {isConnected && (
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleComment()}
                    maxLength={100}
                    placeholder={commenting ? "Posting..." : "Write a comment..."}
                    disabled={commenting}
                    className="flex-1 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#2563EB]/30 disabled:opacity-50"
                  />
                  <button
                    onClick={handleComment}
                    disabled={!commentText.trim() || commenting}
                    className="w-7 h-7 rounded-md bg-[#2563EB] text-white flex items-center justify-center hover:bg-[#1D4ED8] disabled:opacity-40 transition-colors flex-shrink-0"
                  >
                    <Send className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
