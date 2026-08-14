"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ReactElement } from "react";
import { Heart, MessageCircle, Share2, Repeat2, Globe, Send, Shield, RefreshCw, Image as ImageIcon, X, BadgeCheck, Trash2, Lock, Unlock, DollarSign, Loader2, Coins, TrendingUp, BarChart3, Clock, CheckCircle2, Pencil, ListPlus, Plus, ChevronDown, ChevronUp } from "lucide-react";

// Gold badge for OG / founder accounts
const GOLD_BADGE_USERNAMES = ["shaan", "shyft"];
// Profiles created before this Unix timestamp (May 12 2026) keep their blue badge
const BLUE_BADGE_CUTOFF_UNIX = 1778544000;
import { useAppStore } from "@/lib/store";
import { toast } from "@/components/Toast";
import { RichContent, MediaBar, uploadMedia, isVideoFile, handleIpfsImgError } from "@/components/RichContent";
import { useProgram } from "@/hooks/useProgram";
import { useWallet, useConnection, pollConfirmation } from "@/hooks/usePrivyWallet";
import { useX402Payment } from "@/hooks/useX402Payment";
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ShyftClient, clearRpcCache } from "@/lib/program";
import ProfileHoverCard from "@/components/ProfileHoverCard";
import TrendingTokenCard, { type TrendingToken } from "@/components/TrendingTokenCard";
import TokenTrade from "@/components/TokenTrade";
import FeaturedToken from "@/components/FeaturedToken";
import TokenLaunch from "@/components/TokenLaunch";
import PostTokenCard from "@/components/PostTokenCard";

/** A post that launched a coin is tagged on-chain with "COIN:<mint>" (hidden from display). */
const COIN_MARKER_RE = /\n?COIN:([1-9A-HJ-NP-Za-km-z]{32,44})/;
export function extractCoinMint(content: string): string {
  return content?.match(COIN_MARKER_RE)?.[1] || "";
}
export function stripCoinMarker(content: string): string {
  return (content || "").replace(COIN_MARKER_RE, "").trimEnd();
}

/** Pull the first image URL out of a post's content for use as a token image. */
function firstImageUrl(content: string): string {
  const urls = content.match(/https?:\/\/[^\s<]+/gi) || [];
  for (const u of urls) {
    if (/\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(u) || /\/ipfs\//i.test(u)) return u;
  }
  return "";
}

/** Strip Shyft content prefixes (PAID|, COMM|, RT|, THREAD|) and URLs to get clean text. */
function cleanPostText(content: string): string {
  let t = stripCoinMarker(content || "");
  if (t.startsWith("THREAD|")) t = t.split("|").slice(4).join("|");
  if (t.startsWith("PAID|")) t = t.split("|").slice(2).join("|");
  else if (t.startsWith("COMM|")) t = t.split("|").slice(2).join("|");
  else if (t.startsWith("RT|")) t = t.split("|").slice(2).join("|");
  return t.replace(/https?:\/\/[^\s]+/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Parse a thread post: content starts with THREAD|<rootId>|<index>|<total>|<text>
 * Threads are chained client-side (no on-chain schema change) — each segment is a
 * normal post tagged with its shared rootId and position, then grouped on render.
 */
export function parseThreadPost(content: string): { isThread: boolean; rootId: string; index: number; total: number; actualContent: string } {
  if (content && content.startsWith("THREAD|")) {
    const parts = content.split("|");
    if (parts.length >= 5) {
      const rootId = parts[1];
      const index = parseInt(parts[2], 10);
      const total = parseInt(parts[3], 10);
      const actualContent = parts.slice(4).join("|");
      if (rootId && !isNaN(index) && !isNaN(total) && total > 1) {
        return { isThread: true, rootId, index, total, actualContent };
      }
    }
  }
  return { isThread: false, rootId: "", index: 0, total: 1, actualContent: content };
}

/**
 * Renders a grouped thread with a collapse/expand toggle. Collapsed shows only
 * the first post + a "Show N more" button so long threads don't flood the feed.
 * Threads longer than 3 posts start collapsed.
 */
function ThreadGroup({
  members,
  renderMember,
}: {
  members: { post: any; actualContent: string }[];
  renderMember: (m: { post: any; actualContent: string }, index: number) => React.ReactNode;
}) {
  const total = members.length;
  const [collapsed, setCollapsed] = useState(total > 3);
  const visible = collapsed ? members.slice(0, 1) : members;

  return (
    <div className="rounded-2xl">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-1.5 mb-1 pl-1 w-full text-[11px] font-bold uppercase tracking-wide text-[#2563EB] hover:opacity-80 transition-opacity"
      >
        <ListPlus className="w-3.5 h-3.5" /> Thread · {total} posts
        <span className="ml-auto flex items-center gap-1 text-[#94A3B8] normal-case tracking-normal font-medium">
          {collapsed ? <>Expand <ChevronDown className="w-3.5 h-3.5" /></> : <>Collapse <ChevronUp className="w-3.5 h-3.5" /></>}
        </span>
      </button>
      <div className="space-y-2 border-l-2 border-[#2563EB]/20 pl-2">
        {visible.map((m, mi) => (
          <div key={m.post.publicKey}>
            <div className="text-[10px] font-bold text-[#94A3B8] pl-1 mb-0.5 tabular-nums">{mi + 1}/{total}</div>
            {renderMember(m, mi)}
          </div>
        ))}
        {collapsed && total > 1 && (
          <button
            onClick={() => setCollapsed(false)}
            className="text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8] pl-1 py-1.5 flex items-center gap-1"
          >
            Show {total - 1} more {total - 1 === 1 ? "post" : "posts"} <ChevronDown className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Parse a paid post: content starts with PAID|<price>|<actual content> */
function parsePaidPost(content: string): { isPaid: boolean; price: number; actualContent: string } {
  if (content.startsWith("PAID|")) {
    const firstPipe = content.indexOf("|");
    const secondPipe = content.indexOf("|", firstPipe + 1);
    if (secondPipe !== -1) {
      const price = parseFloat(content.substring(firstPipe + 1, secondPipe));
      const actualContent = content.substring(secondPipe + 1);
      if (!isNaN(price) && price > 0) {
        return { isPaid: true, price, actualContent };
      }
    }
  }
  return { isPaid: false, price: 0, actualContent: content };
}

/** Parse a community post: content starts with COMM|<communityId>|<actual content> */
export function parseCommunityPost(content: string): { isCommunity: boolean; communityId: number; actualContent: string } {
  if (content.startsWith("COMM|")) {
    const firstPipe = content.indexOf("|");
    const secondPipe = content.indexOf("|", firstPipe + 1);
    if (secondPipe !== -1) {
      const communityId = parseInt(content.substring(firstPipe + 1, secondPipe));
      const actualContent = content.substring(secondPipe + 1);
      if (!isNaN(communityId)) {
        return { isCommunity: true, communityId, actualContent };
      }
    }
  }
  return { isCommunity: false, communityId: 0, actualContent: content };
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}


/** Reaction emoji map: type index → emoji + label + colors */
const REACTIONS = [
  { emoji: "❤️", label: "Love", bg: "bg-red-50", text: "text-red-500", activeBg: "bg-red-100" },
  { emoji: "🔥", label: "Fire", bg: "bg-orange-50", text: "text-orange-500", activeBg: "bg-orange-100" },
  { emoji: "🚀", label: "Rocket", bg: "bg-blue-50", text: "text-blue-500", activeBg: "bg-blue-100" },
  { emoji: "😂", label: "Laugh", bg: "bg-yellow-50", text: "text-yellow-600", activeBg: "bg-yellow-100" },
  { emoji: "👏", label: "Clap", bg: "bg-purple-50", text: "text-purple-500", activeBg: "bg-purple-100" },
  { emoji: "💡", label: "Insightful", bg: "bg-teal-50", text: "text-teal-500", activeBg: "bg-teal-100" },
];

/** Reusable on-chain post card with on-chain likes, comments & reactions */
export function OnChainPostCard({
  post,
  profile,
  isMe,
  program,
  allComments,
  allReactions,
  profileMap,
  onCommentAdded,
  onReactionAdded,
  onRepost,
  onDelete,
  defaultShowComments = false,
}: {
  post: any;
  profile: any;
  isMe: boolean;
  program: ShyftClient | null;
  allComments: { publicKey: string; post: string; author: string; commentIndex: string; content: string; createdAt: string }[];
  allReactions: { publicKey: string; post: string; user: string; reactionType: number }[];
  profileMap: Record<string, any>;
  onCommentAdded: () => void;
  onReactionAdded: () => void;
  onRepost: (content: string) => void;
  onDelete: () => void;
  defaultShowComments?: boolean;
}) {
  const { likedPosts, addLikedPost, isConnected, currentUser, navigateToProfile, unlockedPosts, addUnlockedPost, postReceipts, addPostReceipt, addPayment, postTips, addPostTip } = useAppStore();
  const { publicKey: walletKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { unlockPost } = useX402Payment();
  const [showComments, setShowComments] = useState(defaultShowComments);
  const [showReactions, setShowReactions] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [liking, setLiking] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [localLikeBoost, setLocalLikeBoost] = useState(0);
  const [reposting, setReposting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [localContent, setLocalContent] = useState<string | null>(null);
  // If this post launched a coin, its mint is tagged on-chain in the content.
  const coinMint = extractCoinMint(localContent ?? post.content);
  const [unlocking, setUnlocking] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [showLaunch, setShowLaunch] = useState(false);
  const [tipping, setTipping] = useState(false);
  const [tipAmount, setTipAmount] = useState("");
  const [flexing, setFlexing] = useState(false);

  // Paid post detection
  const { isPaid, price: postPrice, actualContent } = parsePaidPost(post.content);
  const isUnlocked = unlockedPosts.includes(post.publicKey) || isMe;

  const hasLiked = likedPosts.includes(post.publicKey);
  const postComments = allComments.filter((c) => c.post === post.publicKey)
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  const postReactions = allReactions.filter((r) => r.post === post.publicKey);
  const totalLikes = Number(post.likes || 0) + localLikeBoost;
  const totalComments = postComments.length;

  /** Unlock a paid post via x402 — quote → pay (creator + 0.1% DNA fee) → finalize → receipt */
  const handleUnlock = async () => {
    if (!walletKey || !signTransaction || !connection || unlocking) return;
    setUnlocking(true);
    try {
      toast("privacy", "Unlocking...", `Processing payment via x402`);

      const { sig, receiptId, totalSOL } = await unlockPost(
        post.publicKey,
        post.author,
        postPrice,
      );

      // Poll for confirmation via HTTP — no WebSocket needed
      const confirmed = await pollConfirmation(connection, sig);

      addUnlockedPost(post.publicKey);
      if (receiptId) addPostReceipt(post.publicKey, receiptId);

      addPayment({
        id: sig,
        sender: "me",
        recipient: post.author,
        amount: totalSOL,
        token: "SOL",
        status: "completed",
        isPrivate: false,
        timestamp: Date.now(),
        txSignature: sig,
      });

      if (confirmed) {
        toast("success", "Post unlocked! 🔓", receiptId ? `Receipt: ${receiptId.slice(0, 12)}...` : `TX: ${sig.slice(0, 8)}...`);
      } else {
        toast("success", "Post unlocked! 🔓", `Payment sent — TX: ${sig.slice(0, 8)}...`);
      }
    } catch (err: any) {
      console.error("Unlock error:", err);
      if (err?.message?.includes("User rejected") || err?.message?.includes("rejected the request") || err?.message?.includes("User exited")) {
        toast("error", "Unlock cancelled", "You rejected the transaction");
      } else {
        toast("error", "Unlock failed", err?.message?.slice(0, 80) || "Please try again");
      }
    }
    setUnlocking(false);
  };

  const handleTip = async (amount: number) => {
    if (!walletKey || !signTransaction || !connection || tipping || isMe) return;
    if (amount <= 0 || isNaN(amount)) { toast("error", "Invalid tip", "Enter a valid SOL amount"); return; }
    setTipping(true);
    setShowTip(false);
    try {
      const creatorPubkey = new PublicKey(post.author);
      const lamports = Math.round(amount * LAMPORTS_PER_SOL);

      const balance = await connection.getBalance(walletKey);
      if (balance < lamports + 10000) {
        toast("error", "Insufficient SOL", `You need at least ${amount} SOL to send this tip.`);
        setTipping(false);
        return;
      }

      toast("privacy", "Sending tip...", `${amount} SOL → creator`);

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: walletKey,
          toPubkey: creatorPubkey,
          lamports,
        })
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = walletKey;

      const signedTx = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: false });

      // Poll for confirmation via HTTP — no WebSocket needed
      const tipConfirmed = await pollConfirmation(connection, sig);

      addPostTip(post.publicKey, amount);
      addPayment({
        id: sig,
        sender: "me",
        recipient: post.author,
        amount,
        token: "SOL",
        status: "completed",
        isPrivate: false,
        timestamp: Date.now(),
        txSignature: sig,
      });

      const authorName = profile?.username ? `@${profile.username}` : post.author.slice(0, 8);
      if (tipConfirmed) {
        toast("success", `Tipped ${amount} SOL! 💸`, `Sent to ${authorName} — TX: ${sig.slice(0, 8)}...`);
      } else {
        toast("success", `Tip sent! 💸`, `TX: ${sig.slice(0, 8)}... — confirming...`);
      }
      setTipAmount("");
    } catch (err: any) {
      console.error("Tip error:", err);
      if (err?.message?.includes("User rejected") || err?.message?.includes("rejected the request") || err?.message?.includes("User exited")) {
        toast("error", "Tip cancelled", "You rejected the transaction");
      } else {
        toast("error", "Tip failed", err?.message?.slice(0, 80) || "Please try again");
      }
    }
    setTipping(false);
  };

  const tipInfo = postTips[post.publicKey];

  // Group reactions by type
  const reactionCounts: Record<number, number> = {};
  let myReactionType: number | null = null;
  const myAddr = walletKey?.toBase58() || "";
  for (const r of postReactions) {
    reactionCounts[r.reactionType] = (reactionCounts[r.reactionType] || 0) + 1;
    if (r.user === myAddr) myReactionType = r.reactionType;
  }

  const displayName = profile?.displayName && profile.displayName !== "Anonymous"
    ? profile.displayName
    : post.author.slice(0, 4) + "..." + post.author.slice(-4);
  const username = profile?.username && profile.username !== "anon"
    ? profile.username
    : post.author.slice(0, 8);
  // Use actual on-chain username for badge color
  const realUsername = profile?.username || "";

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
      const msg = err?.message || "";
      if (msg.includes("already in use") || msg.includes("0x0")) {
        // Already liked on-chain (e.g. liked from mobile) — silently mark as liked
        addLikedPost(post.publicKey);
      } else if (msg.includes("User rejected") || msg.includes("rejected the request")) {
        toast("error", "Like cancelled", "You rejected the transaction");
      } else if (msg.includes("insufficient") || msg.includes("0x1")) {
        toast("error", "Insufficient SOL", "Your wallet needs more SOL to interact.");
      } else {
        toast("error", "Like failed", msg.slice(0, 80) || "Please try again");
      }
    }
    setLiking(false);
  };

  const handleComment = async () => {
    if (!commentText.trim()) return;
    if (!program || !walletKey) {
      toast("error", "Not ready", "Wallet or program not loaded yet. Please wait...");
      return;
    }
    if (commenting) return;
    setCommenting(true);
    try {
      const authorPubkey = new PublicKey(post.author);
      const postId = Number(post.postId);
      const commentIndex = Date.now();
      await program.createComment(authorPubkey, postId, commentIndex, commentText.trim());
      setCommentText("");
      toast("success", "Comment posted! 💬", "Your comment is on-chain");
      onCommentAdded();
    } catch (err: any) {
      console.error("Comment error:", err);
      if (err?.message?.includes("User rejected") || err?.message?.includes("rejected the request")) {
        toast("error", "Comment cancelled", "You rejected the transaction");
      } else if (err?.message?.includes("insufficient") || err?.message?.includes("0x1")) {
        toast("error", "Insufficient SOL", "Please try again.");
      } else {
        toast("error", "Comment failed", err?.message?.slice(0, 80) || "Please try again");
      }
    }
    setCommenting(false);
  };

  const handleReaction = async (reactionType: number) => {
    if (!program || !isConnected || reacting) return;
    setReacting(true);
    try {
      const authorPubkey = new PublicKey(post.author);
      const postId = Number(post.postId);
      await program.reactToPost(authorPubkey, postId, reactionType);
      setShowReactions(false);
      toast("success", `Reacted ${REACTIONS[reactionType].emoji}`, "Your reaction is on-chain!");
      onReactionAdded();
    } catch (err: any) {
      console.error("Reaction error:", err);
      if (err?.message?.includes("User rejected") || err?.message?.includes("rejected the request")) {
        toast("error", "Reaction cancelled", "You rejected the transaction");
      } else if (err?.message?.includes("insufficient") || err?.message?.includes("0x1")) {
        toast("error", "Insufficient SOL", "Your wallet needs more SOL to react.");
      } else {
        toast("error", "Reaction failed", err?.message?.slice(0, 80) || "Please try again");
      }
    }
    setReacting(false);
  };

  const handleRemoveReaction = async () => {
    if (!program || !isConnected || reacting || myReactionType === null) return;
    setReacting(true);
    try {
      const authorPubkey = new PublicKey(post.author);
      const postId = Number(post.postId);
      await program.removeReaction(authorPubkey, postId);
      toast("success", "Reaction removed", "Your reaction has been undone");
      onReactionAdded();
    } catch (err: any) {
      console.error("Remove reaction error:", err);
      if (err?.message?.includes("User rejected") || err?.message?.includes("rejected the request")) {
        toast("error", "Cancelled", "You rejected the transaction");
      } else {
        toast("error", "Failed to remove reaction", err?.message?.slice(0, 80) || "Please try again");
      }
    }
    setReacting(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] p-3.5 sm:p-5 mb-3 sm:mb-4 animate-fade-in hover:shadow-md transition-shadow duration-300">
      {/* Author */}
      <div className="flex items-center gap-2.5 sm:gap-3 mb-3">
        <ProfileHoverCard walletAddress={post.author} profile={profile}>
        <button
          type="button"
          onClick={() => navigateToProfile(post.author)}
          className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0 text-left group cursor-pointer"
        >
        {profile?.avatarUrl ? (
          <img src={profile.avatarUrl} onError={handleIpfsImgError} alt={displayName} className="w-10 h-10 sm:w-11 sm:h-11 rounded-full object-cover border-2 border-white shadow-sm flex-shrink-0 group-hover:ring-2 group-hover:ring-[#2563EB]/30 transition-all" />
        ) : (
          <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-lg sm:text-xl border-2 border-white shadow-sm flex-shrink-0 group-hover:ring-2 group-hover:ring-[#2563EB]/30 transition-all ${
            isMe
              ? "bg-gradient-to-br from-[#EBF4FF] to-[#E0F2FE]"
              : "bg-gradient-to-br from-[#F0FDF4] to-[#DCFCE7]"
          }`}>
            {displayName.charAt(0)?.toUpperCase() || "?"}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <span className="font-semibold text-[#1A1A2E] text-sm truncate group-hover:text-[#2563EB] transition-colors">{displayName}</span>
            {GOLD_BADGE_USERNAMES.includes(realUsername.toLowerCase()) ? (
              <BadgeCheck className="w-3.5 h-3.5 flex-shrink-0 text-[#F59E0B]" />
            ) : (() => { const ts = parseInt(String(profile?.createdAt || 0), 10); return ts > 0 && ts < BLUE_BADGE_CUTOFF_UNIX; })() ? (
              <BadgeCheck className="w-3.5 h-3.5 flex-shrink-0 text-[#2563EB]" />
            ) : null}
            <span className="text-xs text-[#94A3B8] truncate group-hover:text-[#2563EB]/70 transition-colors">@{username}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-[#94A3B8]">
              {post.createdAt !== "0" ? timeAgo(Number(post.createdAt) * 1000) : "recently"}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#2563EB] bg-[#EFF6FF] px-2 py-0.5 rounded-full">
              <Globe className="w-2.5 h-2.5" /> On-Chain
            </span>
            {isPaid && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                <Lock className="w-2.5 h-2.5" /> {postPrice} SOL
              </span>
            )}
          </div>
        </div>
        </button>
        </ProfileHoverCard>
      </div>

      {/* Inline edit modal */}
      {editing && (
        <div className="mb-3 pl-0 sm:pl-14">
          <textarea
            autoFocus
            value={editText}
            onChange={e => setEditText(e.target.value)}
            maxLength={500}
            rows={4}
            className="w-full rounded-xl border border-[#2563EB] bg-[#F8FAFC] dark:bg-[#1E293B] text-[#0F172A] dark:text-white text-sm p-3 resize-none focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-[#94A3B8]">{editText.length}/500</span>
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#64748B] hover:bg-[#F1F5F9] transition-all"
              >Cancel</button>
              <button
                disabled={savingEdit || !editText.trim() || editText.trim() === (localContent ?? post.content)}
                onClick={async () => {
                  if (!program || !editText.trim()) return;
                  setSavingEdit(true);
                  try {
                    await program.editPost(Number(post.postId), editText.trim());
                    setLocalContent(editText.trim());
                    setEditing(false);
                    toast("success", "Post updated ✏️", "Edit saved on-chain");
                  } catch (err: any) {
                    if (err?.message?.includes("User rejected") || err?.message?.includes("rejected the request")) {
                      toast("error", "Edit cancelled", "You rejected the transaction");
                    } else {
                      toast("error", "Edit failed", err?.message?.slice(0, 80) || "Please try again");
                    }
                  }
                  setSavingEdit(false);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
              >
                {savingEdit ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="mb-3 pl-0 sm:pl-14">
        {(() => {
          // Determine the content to render (use localContent if edited, actualContent for paid posts that are unlocked)
          // Strip the hidden COIN:<mint> tag — it's surfaced as a token card below instead.
          const renderContent = stripCoinMarker(localContent ?? (isPaid && isUnlocked ? actualContent : post.content));

          // Paid post — locked state
          if (isPaid && !isUnlocked) {
            const previewText = actualContent.slice(0, 40).replace(/\n/g, " ");
            return (
              <div className="relative">
                {/* Blurred preview */}
                <div className="select-none pointer-events-none" style={{ filter: "blur(8px)", WebkitFilter: "blur(8px)" }}>
                  <p className="text-[15px] text-[#475569] leading-relaxed">
                    {previewText}{actualContent.length > 40 ? "..." : ""}
                  </p>
                </div>
                {/* Unlock overlay */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-[#1E1E2E] dark:to-[#1A1A2E] border border-amber-200 dark:border-white/10 rounded-2xl px-5 py-4 text-center shadow-lg max-w-[280px]">
                    <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-2">
                      <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <p className="text-sm font-semibold text-[#1A1A2E] dark:text-white mb-1">Paid Content</p>
                    <p className="text-xs text-[#64748B] dark:text-[#94A3B8] mb-3">
                      Unlock this post for <span className="font-bold text-amber-600">{postPrice} SOL</span>
                    </p>
                    <button
                      onClick={handleUnlock}
                      disabled={unlocking || !isConnected}
                      className="touch-active w-full px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold rounded-xl hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center gap-2"
                    >
                      {unlocking ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Paying...
                        </>
                      ) : (
                        <>
                          <Unlock className="w-4 h-4" />
                          Unlock for {postPrice} SOL
                        </>
                      )}
                    </button>
                    <p className="text-[10px] text-[#94A3B8] mt-2">Secured by x402 · payment goes directly to creator</p>
                  </div>
                </div>
                {/* Spacer so the card has enough height */}
                <div className="h-20" />
              </div>
            );
          }

          // Paid post — unlocked (show badge + content)
          if (isPaid && isUnlocked) {
            const receipt = postReceipts[post.publicKey];
            return (
              <div>
                {!isMe && (
                  <div className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400 px-2 py-0.5 rounded-full mb-2" title={receipt ? `x402 receipt: ${receipt}` : undefined}>
                    <Unlock className="w-2.5 h-2.5" /> Unlocked{receipt ? " · x402" : ""}
                  </div>
                )}
                {isMe && (
                  <div className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full mb-2">
                    <DollarSign className="w-2.5 h-2.5" /> Paid Post · {postPrice} SOL
                  </div>
                )}
                <RichContent content={actualContent} />
              </div>
            );
          }

          // New format: RT|@author|content
          if (renderContent.startsWith("RT|")) {
            const parts = renderContent.split("|");
            const rtAuthor = parts[1] || "";
            const rtContent = parts.slice(2).join("|");
            // Find the wallet address for the repost author so we can navigate to their profile
            const rtUsername = rtAuthor.replace(/^@/, "").toLowerCase();
            const rtWallet = Object.entries(profileMap).find(([, p]) => p?.username?.toLowerCase() === rtUsername)?.[0];
            return (
              <div>
                <div className="flex items-center gap-1.5 text-[13px] text-[#64748B] mb-2">
                  <Repeat2 className="w-3.5 h-3.5" />
                  <span>Reposted from {rtWallet ? (
                    <button type="button" onClick={() => navigateToProfile(rtWallet)} className="font-semibold text-[#1A1A2E] hover:text-[#2563EB] transition-colors cursor-pointer">{rtAuthor}</button>
                  ) : (
                    <span className="font-semibold text-[#1A1A2E]">{rtAuthor}</span>
                  )}</span>
                </div>
                <div className="border border-[#E2E8F0] rounded-xl px-4 py-3 bg-[#F8FAFC]">
                  <RichContent content={rtContent} />
                </div>
              </div>
            );
          }
          // Legacy format: 🔁 Repost from @user:\n\n"content"
          const legacyMatch = renderContent.match(/^\u{1F501}\s*Repost from (@\w+):\s*[\\n]*\s*"?([\s\S]*?)"?\s*$/u);
          if (legacyMatch) {
            const rtAuthor = legacyMatch[1];
            const rtContent = legacyMatch[2].replace(/\\n/g, '').replace(/^"|"$/g, '').trim();
            const rtUsername = rtAuthor.replace(/^@/, "").toLowerCase();
            const rtWallet = Object.entries(profileMap).find(([, p]) => p?.username?.toLowerCase() === rtUsername)?.[0];
            return (
              <div>
                <div className="flex items-center gap-1.5 text-[13px] text-[#64748B] mb-2">
                  <Repeat2 className="w-3.5 h-3.5" />
                  <span>Reposted from {rtWallet ? (
                    <button type="button" onClick={() => navigateToProfile(rtWallet)} className="font-semibold text-[#1A1A2E] hover:text-[#2563EB] transition-colors cursor-pointer">{rtAuthor}</button>
                  ) : (
                    <span className="font-semibold text-[#1A1A2E]">{rtAuthor}</span>
                  )}</span>
                </div>
                <div className="border border-[#E2E8F0] rounded-xl px-4 py-3 bg-[#F8FAFC]">
                  <RichContent content={rtContent} />
                </div>
              </div>
            );
          }
          return <RichContent content={renderContent} />;
        })()}
      </div>

      {/* Token card — shown when this post has launched a coin */}
      {coinMint && (
        <PostTokenCard mint={coinMint} fallbackImage={firstImageUrl(localContent ?? post.content)} />
      )}

      {/* Reaction pills (show aggregated reactions) */}
      {postReactions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-0 sm:pl-14 mb-3">
          {Object.entries(reactionCounts).map(([typeStr, count]) => {
            const typeIdx = Number(typeStr);
            const r = REACTIONS[typeIdx];
            if (!r) return null;
            const isMyReaction = myReactionType === typeIdx;
            return (
              <span
                key={typeIdx}
                className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border transition-all ${
                  isMyReaction
                    ? `${r.activeBg} ${r.text} border-current`
                    : `${r.bg} ${r.text} border-transparent`
                }`}
              >
                {r.emoji} {count}
              </span>
            );
          })}
        </div>
      )}

      {/* Actions — hidden behind paywall for locked paid posts */}
      {isPaid && !isUnlocked ? (
        <div className="flex items-center gap-2 pl-0 sm:pl-14 border-t border-[#F1F5F9] pt-3">
          <Lock className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs text-[#94A3B8]">Unlock this post to like, comment & share</span>
        </div>
      ) : (
      <div className="flex items-center gap-0.5 sm:gap-1 pl-0 sm:pl-14 border-t border-[#F1F5F9] pt-3">
        <button
          onClick={handleLike}
          disabled={!isConnected || hasLiked || liking}
          className={`touch-active flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition-all ${
            hasLiked
              ? "text-red-500 bg-red-50"
              : liking
                ? "text-red-400 bg-red-50 opacity-60"
                : "text-[#94A3B8] hover:text-red-500 hover:bg-red-50 active:bg-red-50"
          } disabled:cursor-not-allowed`}
        >
          <Heart className={`w-4 h-4 ${hasLiked ? "fill-red-500" : ""} ${liking ? "animate-pulse" : ""}`} />
          {totalLikes}
        </button>
        <button
          onClick={() => setShowComments(!showComments)}
          className={`touch-active flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition-all ${
            showComments
              ? "text-[#2563EB] bg-[#EFF6FF]"
              : "text-[#94A3B8] hover:text-[#2563EB] hover:bg-[#EFF6FF] active:bg-[#EFF6FF]"
          }`}
        >
          <MessageCircle className="w-4 h-4" />
          {totalComments}
        </button>

        {/* Reaction button */}
        <div className="relative">
          <button
            onClick={() => myReactionType !== null ? handleRemoveReaction() : setShowReactions(!showReactions)}
            disabled={!isConnected || reacting}
            className={`touch-active flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition-all ${
              myReactionType !== null
                ? `${REACTIONS[myReactionType]?.text || "text-[#94A3B8]"} ${REACTIONS[myReactionType]?.bg || "bg-[#F1F5F9]"} hover:opacity-70`
                : showReactions
                  ? "text-[#EA580C] bg-orange-50"
                  : "text-[#94A3B8] hover:text-[#EA580C] hover:bg-orange-50 active:bg-orange-50"
            } disabled:cursor-not-allowed`}
            title={myReactionType !== null ? "Click to remove reaction" : "React"}
          >
            {myReactionType !== null ? REACTIONS[myReactionType]?.emoji : "😀"}
            {postReactions.length > 0 && <span>{postReactions.length}</span>}
          </button>

          {/* Reaction picker popup */}
          {showReactions && !reacting && myReactionType === null && (
            <div className="absolute bottom-full left-0 mb-2 flex gap-1 bg-white rounded-2xl shadow-lg border border-[#E2E8F0] p-2 z-50 animate-fade-in">
              {REACTIONS.map((r, idx) => (
                <button
                  key={idx}
                  onClick={() => handleReaction(idx)}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg hover:${r.activeBg} hover:scale-110 active:scale-95 transition-all`}
                  title={r.label}
                >
                  {r.emoji}
                </button>
              ))}
            </div>
          )}
          {reacting && (
            <div className="absolute bottom-full left-0 mb-2 bg-white rounded-2xl shadow-lg border border-[#E2E8F0] px-4 py-2 z-50">
              <span className="text-xs text-[#64748B] animate-pulse">{myReactionType !== null ? "Removing..." : "Sending..."}</span>
            </div>
          )}
        </div>

        {/* Tip button — hidden on own posts */}
        {!isMe && (
          <div className="relative">
            <button
              onClick={() => setShowTip(!showTip)}
              disabled={!isConnected || tipping}
              className={`touch-active flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition-all ${
                tipping
                  ? "text-emerald-400 bg-emerald-50 opacity-60"
                  : showTip
                    ? "text-emerald-600 bg-emerald-50"
                    : tipInfo?.myTip
                      ? "text-emerald-500 bg-emerald-50"
                      : "text-[#94A3B8] hover:text-emerald-600 hover:bg-emerald-50 active:bg-emerald-50"
              } disabled:cursor-not-allowed`}
              title="Tip this creator"
            >
              <Coins className={`w-4 h-4 ${tipping ? "animate-pulse" : ""}`} />
              {tipInfo ? `${tipInfo.totalAmount.toFixed(2)}` : "Tip"}
            </button>

            {/* Tip picker popup */}
            {showTip && !tipping && (
              <div className="absolute bottom-full left-0 mb-2 bg-white rounded-2xl shadow-lg border border-[#E2E8F0] p-3 z-50 animate-fade-in min-w-[200px]">
                <p className="text-xs font-semibold text-[#1E293B] mb-2">Send a tip 💸</p>
                <div className="flex gap-1.5 mb-2">
                  {[0.01, 0.05, 0.1, 0.5].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => handleTip(amt)}
                      className="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 active:bg-emerald-200 transition-all"
                    >
                      {amt} SOL
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    step="0.01"
                    min="0.001"
                    placeholder="Custom"
                    value={tipAmount}
                    onChange={(e) => setTipAmount(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 rounded-lg text-xs border border-[#E2E8F0] bg-[#F8FAFC] focus:outline-none focus:ring-1 focus:ring-emerald-300"
                    onKeyDown={(e) => { if (e.key === "Enter" && tipAmount) handleTip(parseFloat(tipAmount)); }}
                  />
                  <button
                    onClick={() => tipAmount && handleTip(parseFloat(tipAmount))}
                    disabled={!tipAmount}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 active:bg-emerald-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Repost — blocked for paid posts */}
        {isPaid ? (
          <button
            disabled
            className="touch-active flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium text-[#94A3B8] opacity-30 cursor-not-allowed"
            title="Paid posts cannot be reposted"
          >
            <Repeat2 className="w-4 h-4" />
          </button>
        ) : (
        <button
          disabled={reposting || !isConnected}
          onClick={async () => {
            if (reposting || !program || !walletKey) return;
            setReposting(true);
            try {
              const authorName = profile?.username ? `@${profile.username}` : post.author.slice(0, 8);
              const cleanForRepost = stripCoinMarker(post.content);
              const preview = cleanForRepost.length > 200 ? cleanForRepost.slice(0, 200) + "..." : cleanForRepost;
              const repostContent = `RT|${authorName}|${preview}`;
              onRepost(repostContent);
              toast("success", "Reposted! 🔁", "Creating on-chain repost...");
            } catch (err: any) {
              toast("error", "Repost failed", err?.message?.slice(0, 80) || "Try again");
            }
            setReposting(false);
          }}
          className="touch-active flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium text-[#94A3B8] hover:text-[#16A34A] hover:bg-[#F0FDF4] active:bg-[#F0FDF4] transition-all disabled:opacity-40"
        >
          <Repeat2 className="w-4 h-4" />
        </button>
        )}

        {/* Share — Blink-enabled sharing with Solana Actions */}
        <button
          onClick={async (e) => {
            e.stopPropagation();
            const authorName = profile?.username ? `@${profile.username}` : post.author.slice(0, 8);
            const postUrl = `https://www.shyft.lol/post/${post.author}-${post.postId}`;
            // Clean share text: strip IPFS hashes, URLs, and protocol prefixes for tweet-friendly text
            let rawText = stripCoinMarker(post.content || "");
            // Strip PAID|, COMM|, RT| prefixes
            if (rawText.startsWith("PAID|")) rawText = "🔒 Paid post";
            else if (rawText.startsWith("COMM|")) rawText = rawText.split("|").slice(2).join("|");
            else if (rawText.startsWith("RT|")) rawText = rawText.split("|").slice(2).join("|");
            // Remove URLs, IPFS CIDs, and extra whitespace
            const cleanText = rawText
              .replace(/https?:\/\/[^\s]+/g, "")
              .replace(/\b(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-zA-Z0-9]{50,})\b/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 100);
            const caption = cleanText
              ? `"${cleanText}" — ${authorName} on @Shyft_lol ⚡\n\n`
              : `Check out ${authorName}'s post on @Shyft_lol ⚡\n\n`;
            const shareText = `${caption}${postUrl}`;
            if (navigator.share) {
              try {
                await navigator.share({ title: `${authorName} on Shyft`, text: caption.trim(), url: postUrl });
              } catch {}
            } else {
              await navigator.clipboard.writeText(shareText);
              toast("success", "Post link copied! ⚡", "Phantom users will see interactive Blink buttons");
            }
          }}
          className="touch-active flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium text-[#94A3B8] hover:text-[#2563EB] hover:bg-[#EBF4FF] active:bg-[#EBF4FF] transition-all"
          title="Share as Solana Blink"
        >
          <Share2 className="w-4 h-4" />
        </button>

        {/* Edit (own posts only) */}
        {isMe && !isPaid && (
          <button
            onClick={() => {
              setEditText(localContent ?? post.content);
              setEditing(true);
            }}
            className="touch-active flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium text-[#94A3B8] hover:text-[#2563EB] hover:bg-[#EBF4FF] active:bg-[#EBF4FF] transition-all"
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}

        {/* Launch as coin (own posts only) — turn the post into a tradeable token.
            The post owner pays the launch fee (NOT sponsored, unlike posting).
            Hidden once the post already has a coin. */}
        {isMe && !isPaid && !coinMint && (
          <button
            onClick={() => setShowLaunch(true)}
            title="Launch this post as a coin"
            className="touch-active flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium text-[#94A3B8] hover:text-[#D97706] hover:bg-[#FFFBEB] active:bg-[#FFFBEB] transition-all"
          >
            <Coins className="w-4 h-4" />
          </button>
        )}

        {/* Delete (own posts only) */}
        {isMe && (
          <button
            disabled={deleting}
            onClick={async () => {
              if (deleting || !program || !walletKey) return;
              if (!confirm("Delete this post? This is permanent and on-chain.")) return;
              setDeleting(true);
              try {
                const postId = Number(post.postId);
                await program.deletePost(postId);
                toast("success", "Post deleted 🗑️", "Removed from chain, rent refunded");
                onDelete();
              } catch (err: any) {
                console.error("Delete error:", err);
                if (err?.message?.includes("User rejected") || err?.message?.includes("rejected the request")) {
                  toast("error", "Delete cancelled", "You rejected the transaction");
                } else {
                  toast("error", "Delete failed", err?.message?.slice(0, 80) || "Please try again");
                }
              }
              setDeleting(false);
            }}
            className={`touch-active flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition-all ${
              deleting
                ? "text-red-400 bg-red-50 opacity-60"
                : "text-[#94A3B8] hover:text-red-500 hover:bg-red-50 active:bg-red-50"
            } disabled:cursor-not-allowed`}
          >
            <Trash2 className={`w-4 h-4 ${deleting ? "animate-pulse" : ""}`} />
          </button>
        )}

        {/* Flex Earnings — auto-fetches total received SOL */}
        {isMe && (
          <button
            disabled={flexing}
            onClick={async () => {
              if (flexing || !walletKey) return;
              setFlexing(true);
              try {
                const res = await fetch(`/api/tips-received?wallet=${walletKey.toBase58()}`);
                const data = await res.json();
                if (!res.ok || !data.totalSol) {
                  toast("error", "Couldn't fetch earnings", data.error || "Try again");
                  setFlexing(false);
                  return;
                }
                const myName = currentUser?.username || profile?.username || "someone";
                const amt = data.totalSol;
                const count = data.tipCount;
                const flexUrl = `https://www.shyft.lol/tip?user=${encodeURIComponent(myName)}&amount=${amt}&tips=${count}`;
                const flexText = `💸 @${myName} earned ${amt} SOL in tips on Shyft!\n\nGet tipped for your posts →\n\n${flexUrl}`;
                if (navigator.share) {
                  try {
                    await navigator.share({ title: `💸 @${myName} earned ${amt} SOL on Shyft`, text: flexText });
                  } catch {}
                } else {
                  await navigator.clipboard.writeText(flexText);
                  toast("success", "Copied to clipboard! 💸", "Paste on X to flex");
                }
              } catch (err: any) {
                toast("error", "Flex failed", err?.message?.slice(0, 60) || "Try again");
              }
              setFlexing(false);
            }}
            className={`touch-active flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-semibold transition-all ${
              flexing
                ? "text-emerald-400 bg-emerald-50 opacity-60"
                : "text-emerald-600 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200"
            }`}
            title="Share your tip earnings"
          >
            <TrendingUp className={`w-4 h-4 ${flexing ? "animate-pulse" : ""}`} />
            {flexing ? "Loading..." : "Flex"}
          </button>
        )}

        <a
          href={`https://explorer.solana.com/address/${post.publicKey}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`ml-auto text-[10px] hover:underline text-[#2563EB]`}
        >
          View on Explorer
        </a>
      </div>
      )}

      {/* On-chain comments section — hidden for locked paid posts */}
      {showComments && !(isPaid && !isUnlocked) && (
        <div className="mt-3 pl-0 sm:pl-14 space-y-3">
          {postComments.length === 0 && !commenting && (
            <p className="text-xs text-[#94A3B8] text-center py-2">No comments yet. Be the first to comment on-chain!</p>
          )}
          {postComments.map((comment) => {
            const commenterProfile = profileMap[comment.author];
            const commenterName = commenterProfile?.displayName || comment.author.slice(0, 4) + "..." + comment.author.slice(-4);
            const isMyComment = comment.author === myAddr;
            return (
              <div key={comment.publicKey} className="flex gap-2 animate-fade-in">
                <ProfileHoverCard walletAddress={comment.author} profile={commenterProfile}>
                <button type="button" onClick={() => navigateToProfile(comment.author)} className="flex-shrink-0 group cursor-pointer">
                {commenterProfile?.avatarUrl ? (
                  <img src={commenterProfile.avatarUrl} onError={handleIpfsImgError} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0 group-hover:ring-2 group-hover:ring-[#2563EB]/30 transition-all" />
                ) : (
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 group-hover:ring-2 group-hover:ring-[#2563EB]/30 transition-all ${
                    isMyComment ? "bg-[#EFF6FF] text-[#2563EB]" : "bg-[#F1F5F9] text-[#64748B]"
                  }`}>
                    {commenterName.charAt(0)?.toUpperCase() || "?"}
                  </div>
                )}
                </button>
                </ProfileHoverCard>
                <div className="flex-1 bg-[#F8FAFC] rounded-xl px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => navigateToProfile(comment.author)} className="text-xs font-semibold text-[#1A1A2E] hover:text-[#2563EB] transition-colors cursor-pointer">{isMyComment ? "You" : commenterName}</button>
                    <span className="text-[10px] text-[#94A3B8]">
                      {Number(comment.createdAt) > 0 ? timeAgo(Number(comment.createdAt) * 1000) : "recently"}
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-[8px] font-medium text-[#2563EB] bg-[#EFF6FF] px-1.5 py-0.5 rounded-full">
                      <Globe className="w-2 h-2" /> on-chain
                    </span>
                    {isMyComment && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!program || !walletKey) return;
                          if (!confirm("Delete this comment?")) return;
                          try {
                            const postAuthor = new PublicKey(post.author);
                            const postId = Number(post.postId);
                            const commentIdx = Number(comment.commentIndex);
                            await program.deleteComment(postAuthor, postId, commentIdx);
                            toast("success", "Comment deleted 🗑️", "Removed from chain");
                            onCommentAdded();
                          } catch (err: any) {
                            console.error("Delete comment error:", err);
                            toast("error", "Delete failed", err?.message?.slice(0, 80) || "Try again");
                          }
                        }}
                        className="ml-auto text-[#CBD5E1] hover:text-red-500 transition-colors"
                        title="Delete comment"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-[#475569] mt-0.5"><RichContent content={comment.content} className="[&_p]:text-xs [&_p]:leading-normal" /></div>
                </div>
              </div>
            );
          })}
          {isConnected && (
            <div className="flex gap-2 items-center">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleComment()}
                  maxLength={100}
                  placeholder={commenting ? "Posting on-chain..." : "Write a comment..."}
                  disabled={commenting}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] disabled:opacity-50"
                />
                {commentText.length > 80 && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#94A3B8]">{100 - commentText.length}</span>}
              </div>
              <button
                onClick={handleComment}
                disabled={!commentText.trim() || commenting}
                className="touch-active w-9 h-9 rounded-lg bg-[#2563EB] text-white flex items-center justify-center hover:bg-[#1D4ED8] disabled:opacity-40 transition-colors flex-shrink-0"
              >
                {commenting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Launch-as-coin modal (own posts). Pre-filled from the post; owner pays the fee. */}
      {showLaunch && (
        <TokenLaunch
          username={profile?.username}
          prefill={{
            name: profile?.username ? `${profile.username}` : undefined,
            description: cleanPostText(localContent ?? post.content) || undefined,
            imageUrl: firstImageUrl(localContent ?? post.content) || profile?.avatarUrl || undefined,
            twitter: profile?.twitter || undefined,
          }}
          onClose={() => setShowLaunch(false)}
          onSuccess={async (mint) => {
            setShowLaunch(false);
            toast("success", "Your post is now a coin", "Live on Solana");
            // Tag the post on-chain with the mint so the token card shows for everyone.
            try {
              const base = localContent ?? post.content;
              if (program && mint && !extractCoinMint(base)) {
                const tagged = `${base}\nCOIN:${mint}`;
                setLocalContent(tagged); // optimistic — card appears immediately
                await program.editPost(Number(post.postId), tagged);
              }
            } catch (err) {
              // Token still launched; tagging is best-effort (e.g. content length limit).
              console.warn("Failed to tag post with coin mint:", err);
            }
          }}
        />
      )}
    </div>
  );
}

/** On-chain Poll Card with vote buttons, progress bars, countdown */
function PollCard({
  poll,
  profile,
  isMe,
  program,
  myVote,
  onVoted,
}: {
  poll: any;
  profile: any;
  isMe: boolean;
  program: ShyftClient | null;
  myVote: { voted: boolean; choice?: number } | null;
  onVoted: () => void;
}) {
  const { isConnected, navigateToProfile } = useAppStore();
  const [voting, setVoting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [localVote, setLocalVote] = useState<number | null>(null);

  const now = Date.now();
  const hasEnded = poll.isClosed || now >= poll.endsAt;
  const hasVoted = myVote?.voted || localVote !== null;
  const votedChoice = localVote ?? myVote?.choice;
  const showResults = hasVoted || hasEnded;

  const options = [
    { label: poll.optionA, votes: poll.votesA },
    { label: poll.optionB, votes: poll.votesB },
    ...(poll.numOptions >= 3 ? [{ label: poll.optionC, votes: poll.votesC }] : []),
    ...(poll.numOptions >= 4 ? [{ label: poll.optionD, votes: poll.votesD }] : []),
  ];

  const totalVotes = (localVote !== null ? poll.totalVotes + 1 : poll.totalVotes) || 0;

  // Countdown
  const timeLeft = poll.endsAt - now;
  const formatTimeLeft = () => {
    if (timeLeft <= 0) return "Ended";
    const hrs = Math.floor(timeLeft / 3_600_000);
    const mins = Math.floor((timeLeft % 3_600_000) / 60_000);
    if (hrs > 24) return `${Math.floor(hrs / 24)}d ${hrs % 24}h left`;
    if (hrs > 0) return `${hrs}h ${mins}m left`;
    return `${mins}m left`;
  };

  const handleVote = async (choice: number) => {
    if (!program || voting || hasVoted || hasEnded) return;
    setVoting(true);
    try {
      const creatorPk = new PublicKey(poll.creator);
      await program.votePoll(creatorPk, poll.pollId, choice);
      setLocalVote(choice);
      toast("success", "Vote recorded on-chain! 🗳️");
      setTimeout(() => onVoted(), 1500);
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("User rejected") || msg.includes("rejected the request")) {
        // silent
      } else if (msg.includes("already ended") || msg.includes("PollAlreadyEnded")) {
        toast("error", "Poll has ended");
      } else if (msg.includes("AlreadyInitialized")) {
        toast("error", "You already voted on this poll");
        setLocalVote(0); // show results
      } else {
        toast("error", "Vote failed", msg.slice(0, 100));
      }
    }
    setVoting(false);
  };

  const handleClose = async () => {
    if (!program || closing) return;
    setClosing(true);
    try {
      await program.closePoll(poll.pollId);
      toast("success", "Poll closed");
      setTimeout(() => onVoted(), 1500);
    } catch (err: any) {
      toast("error", "Close failed", err?.message?.slice(0, 80));
    }
    setClosing(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-5 mb-3 hover:shadow-sm transition-shadow">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        {profile?.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            onError={handleIpfsImgError}
            alt=""
            className="w-10 h-10 rounded-full object-cover cursor-pointer border-2 border-white shadow-sm"
            onClick={() => navigateToProfile(poll.creator)}
          />
        ) : (
          <div
            className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center text-lg font-bold text-purple-600 cursor-pointer"
            onClick={() => navigateToProfile(poll.creator)}
          >
            {(profile?.displayName || "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="font-bold text-[15px] text-[#1A1A2E] truncate cursor-pointer hover:underline"
              onClick={() => navigateToProfile(poll.creator)}
            >
              {profile?.displayName || poll.creator.slice(0, 8)}
            </span>
            <BarChart3 className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
            <span className="text-xs font-medium text-purple-500">Poll</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#64748B]">
            <span>{timeAgo(poll.createdAt)}</span>
            <span>·</span>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span className={hasEnded ? "text-red-400 font-medium" : "text-emerald-500 font-medium"}>
                {formatTimeLeft()}
              </span>
            </div>
          </div>
        </div>
        {isMe && !poll.isClosed && (
          <button
            onClick={handleClose}
            disabled={closing}
            className="text-xs text-[#64748B] hover:text-red-500 transition-colors px-2 py-1"
          >
            {closing ? "Closing..." : "End Poll"}
          </button>
        )}
      </div>

      {/* Question */}
      <p className="text-[15px] font-semibold text-[#1A1A2E] mb-3 leading-snug">{poll.question}</p>

      {/* Options */}
      <div className="space-y-2">
        {options.map((opt, i) => {
          const optVotes = (localVote === i ? opt.votes + 1 : opt.votes) || 0;
          const pct = totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0;
          const isMyVote = votedChoice === i;
          const isWinner = showResults && optVotes === Math.max(...options.map((o, j) => (localVote === j ? o.votes + 1 : o.votes) || 0));

          return (
            <button
              key={i}
              onClick={() => handleVote(i)}
              disabled={showResults || voting || !isConnected}
              className={`relative w-full text-left rounded-xl border transition-all overflow-hidden ${
                showResults
                  ? isMyVote
                    ? "border-purple-300 bg-purple-50/50"
                    : "border-[#E2E8F0] bg-[#F8FAFC]"
                  : "border-[#E2E8F0] hover:border-purple-300 hover:bg-purple-50/30 active:scale-[0.99] cursor-pointer"
              }`}
            >
              {/* Progress bar bg */}
              {showResults && (
                <div
                  className={`absolute inset-0 rounded-xl transition-all duration-700 ease-out ${
                    isWinner ? "bg-purple-100/80" : "bg-[#F1F5F9]/80"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              )}
              <div className="relative flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  {showResults && isMyVote && (
                    <CheckCircle2 className="w-4 h-4 text-purple-500 flex-shrink-0" />
                  )}
                  <span className={`text-sm font-medium truncate ${
                    showResults && isWinner ? "text-purple-700" : "text-[#334155]"
                  }`}>
                    {opt.label}
                  </span>
                </div>
                {showResults && (
                  <span className={`text-sm font-bold flex-shrink-0 ml-2 ${
                    isWinner ? "text-purple-600" : "text-[#475569]"
                  }`}>
                    {pct}%
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-[#F1F5F9]">
        <span className="text-xs text-[#64748B]">
          {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
        </span>
        {voting && (
          <span className="text-xs text-purple-500 animate-pulse flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Voting...
          </span>
        )}
      </div>
    </div>
  );
}

export default function Feed() {
  const { isConnected, currentUser, focusPostKey, setFocusPostKey, navigateToProfile } = useAppStore();
  const [newPost, setNewPost] = useState("");
  const program = useProgram();
  const { publicKey } = useWallet();
  const [onchainPosts, setOnchainPosts] = useState<any[]>([]);
  const [loadingOnchain, setLoadingOnchain] = useState(false);
  const [profileMap, setProfileMap] = useState<Record<string, any>>({});
  const [allComments, setAllComments] = useState<any[]>([]);
  const [allReactions, setAllReactions] = useState<any[]>([]);
  const [trendingTokens, setTrendingTokens] = useState<TrendingToken[]>([]);
  const [selectedTrendingToken, setSelectedTrendingToken] = useState<TrendingToken | null>(null);

  const [posting, setPosting] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaIsVideo, setMediaIsVideo] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isPaidPost, setIsPaidPost] = useState(false);
  const [paidPrice, setPaidPrice] = useState("0.01");

  // Thread composer state — extra segments beyond the main `newPost` box
  const [threadMode, setThreadMode] = useState(false);
  const [threadSegments, setThreadSegments] = useState<string[]>([]);

  // Poll creation state
  const [isPollMode, setIsPollMode] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [pollDuration, setPollDuration] = useState("24"); // hours
  const [creatingPoll, setCreatingPoll] = useState(false);

  // Poll display state
  const [allPolls, setAllPolls] = useState<any[]>([]);
  const [myVotes, setMyVotes] = useState<Record<string, { voted: boolean; choice?: number }>>({});

  // @mention click handler — resolves username → wallet and navigates to profile
  useEffect(() => {
    (window as any).__shyftMentionClick = (username: string) => {
      const lower = username.toLowerCase();
      const entry = Object.entries(profileMap).find(([, p]) => p?.username?.toLowerCase() === lower);
      if (entry) {
        navigateToProfile(entry[0]);
      } else {
        toast("error", `User @${username} not found`);
      }
    };
    return () => { delete (window as any).__shyftMentionClick; };
  }, [profileMap, navigateToProfile]);

  // $TICKER click handler — opens trade modal for the tapped token
  useEffect(() => {
    (window as any).__shyftTickerClick = (symbol: string, tickerData: any) => {
      const found = trendingTokens.find((t) => t.symbol.toUpperCase() === symbol.toUpperCase());
      if (found) {
        setSelectedTrendingToken(found);
        return;
      }
      // Token not in trending list — build from DexScreener data
      setSelectedTrendingToken({
        tokenMint: tickerData.mint,
        name: tickerData.name || symbol,
        symbol: symbol.toUpperCase(),
        image: tickerData.image || "",
        priceUsd: tickerData.price,
        priceChange24h: tickerData.change24h,
      });
    };
    return () => { delete (window as any).__shyftTickerClick; };
  }, [trendingTokens, setSelectedTrendingToken]);

  // Focus post from notification click — scroll to post and open comments
  useEffect(() => {
    if (!focusPostKey || onchainPosts.length === 0) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`post-${focusPostKey}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-[#2563EB]", "ring-offset-2");
        setTimeout(() => el.classList.remove("ring-2", "ring-[#2563EB]", "ring-offset-2"), 3000);
      }
      setFocusPostKey(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [focusPostKey, onchainPosts, setFocusPostKey]);

  // Fetch all public posts from Solana
  const fetchOnchainPosts = async () => {
    if (!program || !publicKey) return;
    setLoadingOnchain(true);
    try {
      const [allMapped, profiles, comments, reactions, polls, myLikedPosts] = await Promise.all([
        program.getAllPosts(),
        program.getAllProfiles(),
        program.getAllComments(),
        program.getAllReactions(),
        program.getAllPolls(),
        program.getLikedPostsByUser(publicKey),
      ]);

      // Seed the liked posts store from on-chain data (catches cross-device likes e.g. from mobile)
      useAppStore.getState().setLikedPosts(myLikedPosts);

      setAllComments(comments);
      setAllReactions(reactions);
      setAllPolls(polls);

      // Show all posts: free (public) + paid (private with PAID| prefix), exclude community posts
      const visiblePosts = allMapped.filter((p: any) => !p.content.startsWith("COMM|") && (!p.isPrivate || p.content.startsWith("PAID|")));

      setOnchainPosts(visiblePosts.sort((a: any, b: any) => Number(b.createdAt) - Number(a.createdAt)));
      
      const map: Record<string, any> = {};
      profiles.forEach((p: any) => { map[p.owner] = p; });
      setProfileMap(map);

      // Check user's votes on all polls
      if (polls.length > 0) {
        const voteMap: Record<string, { voted: boolean; choice?: number }> = {};
        for (const poll of polls) {
          try {
            const result = await program.hasVoted(new PublicKey(poll.pubkey), publicKey);
            voteMap[poll.pubkey] = result;
          } catch {
            voteMap[poll.pubkey] = { voted: false };
          }
        }
        setMyVotes(voteMap);
      }
    } catch (err) {
      console.error("Failed to fetch on-chain posts:", err);
    }
    setLoadingOnchain(false);
  };

  useEffect(() => {
    fetchOnchainPosts();
  }, [program, publicKey]);

  // Fetch trending Kickstart launches for inline feed cards (refresh every 2 min)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/kickstart/trending");
        const data = await res.json();
        if (!cancelled && data?.success && Array.isArray(data.response)) {
          setTrendingTokens(data.response);
        }
      } catch (err) {
        console.warn("trending tokens fetch failed:", err);
      }
    };
    load();
    const interval = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Auto-refresh feed every 30s — posts (like counts), comments, reactions
  useEffect(() => {
    if (!program || !publicKey) return;
    const interval = setInterval(() => {
      refreshFeed();
    }, 30_000);
    return () => clearInterval(interval);
  }, [program, publicKey]);

  // Refresh posts + comments + reactions (updates like counts, new posts, etc.)
  const refreshFeed = async () => {
    if (!program) return;
    try {
      const [allMapped, comments, reactions, polls] = await Promise.all([
        program.getAllPosts(),
        program.getAllComments(),
        program.getAllReactions(),
        program.getAllPolls(),
      ]);
      setAllComments(comments);
      setAllReactions(reactions);
      setAllPolls(polls);
      const visiblePosts = allMapped.filter((p: any) => !p.content.startsWith("COMM|") && (!p.isPrivate || p.content.startsWith("PAID|")));
      setOnchainPosts(visiblePosts.sort((a: any, b: any) => Number(b.createdAt) - Number(a.createdAt)));
    } catch (err) {
      console.error("Failed to refresh feed:", err);
    }
  };

  // Legacy alias for components that call refreshInteractions
  const refreshInteractions = refreshFeed;

  // Publish a thread: each segment becomes its own on-chain post, tagged with a
  // shared rootId + position so they group together on render. Posts are created
  // sequentially (each is a separate tx).
  const handlePostThread = async () => {
    if (posting) return;
    const segments = [newPost, ...threadSegments].map((s) => s.trim()).filter(Boolean);
    if (segments.length < 2) {
      toast("error", "Thread needs 2+ posts", "Add at least one more post, or turn off thread mode");
      return;
    }
    if (!program || !publicKey) {
      toast("error", "Wallet not connected", "Please connect your wallet to post");
      return;
    }

    setPosting(true);
    try {
      const profile = await program.getProfile(publicKey);
      if (!profile) throw new Error("You need to create a profile first. Go to the Profile tab to set up your account.");

      const rootId = Date.now();
      const total = segments.length;
      for (let i = 0; i < total; i++) {
        toast("privacy", `Posting thread ${i + 1}/${total}...`, "Publishing to Solana");
        const content = `THREAD|${rootId}|${i}|${total}|${segments[i]}`;
        // Unique, ordered postId per segment.
        await program.createPost(rootId + i, content, false);
      }
      toast("success", `Thread published! 🧵 ${total} posts`, "Live on Solana");
      setNewPost("");
      setThreadSegments([]);
      setThreadMode(false);
      setTimeout(() => fetchOnchainPosts(), 1500);
    } catch (err: any) {
      const msg = err?.message?.slice(0, 150) || "Unknown error";
      if (msg.includes("User rejected") || msg.includes("rejected the request")) {
        toast("error", "Thread cancelled", "You rejected a transaction");
      } else if (msg.includes("need to create a profile")) {
        toast("error", "Profile required", msg);
      } else if (msg.toLowerCase().includes("insufficient")) {
        toast("error", "Insufficient SOL", "Fund your wallet from the Profile tab and try again.");
      } else {
        toast("error", "Thread post failed", msg);
      }
    } finally {
      setPosting(false);
    }
  };

  const handlePost = async () => {
    if (threadMode) { await handlePostThread(); return; }
    if ((!newPost.trim() && !mediaFile) || posting) return;
    if (!program || !publicKey) {
      toast("error", "Wallet not connected", "Please connect your wallet to post");
      return;
    }

    const postId = Date.now();
    let content = newPost;

    setPosting(true);
    setNewPost("");

    try {
      // Upload media first if attached
      if (mediaFile) {
        const label = mediaIsVideo ? "video" : "image";
        toast("privacy", `Uploading ${label}...`, `Hosting your ${label} on IPFS`);
        try {
          const mediaUrl = await uploadMedia(mediaFile);
          content = content.trim() ? `${content.trim()}\n${mediaUrl}` : mediaUrl;
          setMediaPreview(null);
          setMediaFile(null);
          setMediaIsVideo(false);
        } catch (err: any) {
          toast("error", `${mediaIsVideo ? "Video" : "Image"} upload failed`, err.message || "Try again");
          setPosting(false);
          setNewPost(content);
          return;
        }
      }

      toast("privacy", "Posting...", "Publishing to your feed");

      if (!publicKey || program.provider.wallet.publicKey?.toBase58() !== publicKey.toBase58()) {
        throw new Error("Wallet disconnected during post creation");
      }

      const profile = await program.getProfile(publicKey);
      if (!profile) {
        throw new Error("You need to create a profile first. Go to the Profile tab to set up your account.");
      }

      // Prepend PAID| prefix for paid posts
      if (isPaidPost) {
        const price = parseFloat(paidPrice);
        if (isNaN(price) || price <= 0) {
          toast("error", "Invalid price", "Please enter a valid price greater than 0");
          setPosting(false);
          setNewPost(content);
          return;
        }
        content = `PAID|${price}|${content}`;
      }

      const sig = await program.createPost(postId, content, isPaidPost);
      toast("success", isPaidPost ? `Paid post live! 🔒 ${paidPrice} SOL` : "Post confirmed on Solana", `TX: ${sig.slice(0, 8)}...`);

      // Reset paid post state
      setIsPaidPost(false);
      setPaidPrice("0.01");

      setTimeout(() => fetchOnchainPosts(), 1500);
    } catch (err: any) {
      console.error("On-chain post error:", err);
      const errorMsg = err?.message?.slice(0, 150) || "Unknown error";

      setNewPost(content);
      
      if (errorMsg.includes("User rejected") || errorMsg.includes("rejected the request")) {
        toast("error", "Post cancelled", "You rejected the transaction");
      } else if (errorMsg.includes("need to create a profile")) {
        toast("error", "Profile required", errorMsg);
      } else if (errorMsg.includes("Provided seeds")) {
        toast("error", "Account error", "Account setup issue - make sure your profile is created and try again");
      } else if (errorMsg.includes("insufficient funds") || errorMsg.includes("insufficient") || errorMsg.includes("for rent")) {
        toast("error", "Insufficient SOL", "Your wallet needs more SOL to pay for this transaction. Fund your wallet from the Profile tab.");
      } else if (errorMsg.includes("simulation failed")) {
        toast("error", "Transaction failed", errorMsg.includes("Provided seeds") ? "PDA derivation issue - reconnect wallet" : "Please try again or check your wallet connection");
      } else {
        toast("error", "On-chain post failed", errorMsg);
      }
    } finally {
      setPosting(false);
    }
  };

  const handleCreatePoll = async () => {
    if (!program || !publicKey || creatingPoll) return;
    const filledOptions = pollOptions.filter(o => o.trim());
    if (!pollQuestion.trim()) { toast("error", "Enter a question"); return; }
    if (filledOptions.length < 2) { toast("error", "Need at least 2 options"); return; }

    setCreatingPoll(true);
    try {
      const profile = await program.getProfile(publicKey);
      if (!profile) { toast("error", "Profile required", "Create a profile first"); setCreatingPoll(false); return; }

      const pollId = Date.now();
      const durationHours = parseFloat(pollDuration) || 24;
      const endsAt = Math.floor(Date.now() / 1000) + Math.round(durationHours * 3600);

      toast("privacy", "Creating poll...", "Publishing to Solana");
      await program.createPoll(pollId, pollQuestion.trim(), filledOptions.map(o => o.trim()), endsAt);
      toast("success", "Poll live on-chain! 📊");

      // Reset
      setIsPollMode(false);
      setPollQuestion("");
      setPollOptions(["", ""]);
      setPollDuration("24");
      setTimeout(() => fetchOnchainPosts(), 1500);
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("User rejected") || msg.includes("rejected the request")) {
        // silent
      } else {
        toast("error", "Poll creation failed", msg.slice(0, 100));
      }
    }
    setCreatingPoll(false);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-3 sm:space-y-4">
      {/* Compose */}
      {isConnected && (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-3.5 sm:p-5">
          <div className="flex gap-3">
            {(() => {
              const myAvatar = (publicKey && profileMap[publicKey.toBase58()]?.avatarUrl) || currentUser?.avatarUrl;
              const myName = (publicKey && profileMap[publicKey.toBase58()]?.displayName) || currentUser?.displayName;
              if (myAvatar) return <img src={myAvatar} onError={handleIpfsImgError} alt="" className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-sm flex-shrink-0" />;
              if (myName) return <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#EBF4FF] to-[#DBEAFE] flex items-center justify-center text-lg font-bold text-[#2563EB] flex-shrink-0">{myName.charAt(0).toUpperCase()}</div>;
              return <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#EBF4FF] to-[#DBEAFE] animate-pulse flex-shrink-0" />;
            })()}
            <div className="flex-1 min-w-0">
              <textarea
                value={newPost}
                onChange={(e) => setNewPost(e.target.value)}
                maxLength={200}
                placeholder="What's happening?"
                className="w-full resize-none bg-transparent text-[15px] focus:outline-none placeholder:text-[#94A3B8] min-h-[60px] sm:min-h-[80px] leading-relaxed"
              />
              {/* Media preview (image or video) */}
              {mediaPreview && (
                <div className="relative mt-2 rounded-2xl overflow-hidden border border-[#E2E8F0] inline-block">
                  {mediaIsVideo ? (
                    <video src={mediaPreview} className="max-h-[200px] max-w-full object-cover rounded-2xl" controls muted />
                  ) : (
                    <img src={mediaPreview} alt="Preview" className="max-h-[200px] max-w-full object-cover rounded-2xl" />
                  )}
                  <button
                    onClick={() => { setMediaPreview(null); setMediaFile(null); setMediaIsVideo(false); }}
                    className="absolute top-2 right-2 w-7 h-7 bg-black/60 rounded-full flex items-center justify-center hover:bg-black/80 transition-colors"
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>
              )}
            </div>
          </div>
          {/* Thread segments (posts 2..N) */}
          {threadMode && (
            <div className="mt-1 space-y-2">
              {threadSegments.map((seg, i) => (
                <div key={i} className="flex items-start gap-2 pl-3 border-l-2 border-[#2563EB]/25">
                  <span className="mt-2.5 text-[10px] font-bold text-[#94A3B8] w-8 flex-shrink-0 tabular-nums">{i + 2}/{threadSegments.length + 1}</span>
                  <textarea
                    value={seg}
                    onChange={(e) => { const next = [...threadSegments]; next[i] = e.target.value; setThreadSegments(next); }}
                    maxLength={200}
                    placeholder="Add to thread…"
                    className="flex-1 resize-none bg-transparent text-[15px] focus:outline-none placeholder:text-[#94A3B8] min-h-[44px] leading-relaxed"
                  />
                  <button
                    type="button"
                    onClick={() => setThreadSegments(threadSegments.filter((_, j) => j !== i))}
                    className="mt-2 text-[#94A3B8] hover:text-red-400 transition-colors"
                    title="Remove post"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setThreadSegments([...threadSegments, ""])}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8] transition-colors pl-3"
              >
                <Plus className="w-3.5 h-3.5" /> Add another post
              </button>
            </div>
          )}
          {newPost.length > 160 && (
            <div className="flex justify-end mt-1">
              <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${
                newPost.length > 180 ? "border-red-400 text-red-500" : "border-[#E2E8F0] text-[#94A3B8]"
              }`}>
                {200 - newPost.length}
              </div>
            </div>
          )}
          {/* Paid post banner */}
          {isPaidPost && (
            <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl animate-fade-in">
              <Lock className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span className="text-xs font-medium text-amber-700">Paid post — viewers pay to unlock</span>
              <div className="ml-auto flex items-center gap-1.5">
                <input
                  type="number"
                  value={paidPrice}
                  onChange={(e) => setPaidPrice(e.target.value)}
                  min="0.001"
                  step="0.01"
                  className="w-20 text-xs font-bold text-amber-700 bg-white border border-amber-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-amber-300"
                  placeholder="0.01"
                />
                <span className="text-xs font-bold text-amber-600">SOL</span>
              </div>
            </div>
          )}
          {/* Poll creation panel */}
          {isPollMode && (
            <div className="mt-3 p-3 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl space-y-2.5 animate-fade-in">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="w-4 h-4 text-purple-600" />
                <span className="text-xs font-semibold text-purple-700">Create Poll</span>
              </div>
              <input
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                maxLength={200}
                placeholder="Ask a question..."
                className="w-full px-3 py-2 text-sm bg-white border border-purple-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 placeholder:text-[#94A3B8]"
              />
              {pollOptions.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-purple-400 w-5">{String.fromCharCode(65 + i)}</span>
                  <input
                    value={opt}
                    onChange={(e) => {
                      const next = [...pollOptions];
                      next[i] = e.target.value;
                      setPollOptions(next);
                    }}
                    maxLength={50}
                    placeholder={`Option ${String.fromCharCode(65 + i)}`}
                    className="flex-1 px-3 py-1.5 text-sm bg-white border border-purple-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 placeholder:text-[#94A3B8]"
                  />
                  {i >= 2 && (
                    <button
                      onClick={() => setPollOptions(pollOptions.filter((_, j) => j !== i))}
                      className="text-purple-300 hover:text-red-400 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between">
                {pollOptions.length < 4 && (
                  <button
                    onClick={() => setPollOptions([...pollOptions, ""])}
                    className="text-xs font-medium text-purple-500 hover:text-purple-700 transition-colors"
                  >
                    + Add option
                  </button>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  <Clock className="w-3.5 h-3.5 text-purple-400" />
                  <select
                    value={pollDuration}
                    onChange={(e) => setPollDuration(e.target.value)}
                    className="text-xs font-medium text-purple-600 bg-white border border-purple-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-300"
                  >
                    <option value="1">1 hour</option>
                    <option value="6">6 hours</option>
                    <option value="12">12 hours</option>
                    <option value="24">1 day</option>
                    <option value="72">3 days</option>
                    <option value="168">7 days</option>
                  </select>
                </div>
              </div>
              <button
                onClick={handleCreatePoll}
                disabled={creatingPoll || !pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2}
                className="w-full py-2 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white text-sm font-bold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-purple-200"
              >
                {creatingPoll ? (
                  <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Creating poll...</span>
                ) : (
                  "Create Poll 📊"
                )}
              </button>
            </div>
          )}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#F1F5F9] gap-3">
            <div className="flex items-center gap-1">
              <MediaBar
                onMediaSelected={(url, file) => {
                  setMediaPreview(url);
                  if (file) {
                    setMediaFile(file);
                    setMediaIsVideo(isVideoFile(file));
                  }
                }}
                disabled={posting || uploading}
              />
              {/* Paid post toggle */}
              <button
                type="button"
                onClick={() => { setIsPaidPost(!isPaidPost); if (!isPaidPost) setIsPollMode(false); }}
                className={`touch-active flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isPaidPost
                    ? "text-amber-600 bg-amber-50 border border-amber-200"
                    : "text-[#94A3B8] hover:text-amber-600 hover:bg-amber-50"
                }`}
                title={isPaidPost ? "Make post free" : "Make post paid"}
              >
                {isPaidPost ? <Lock className="w-3.5 h-3.5" /> : <DollarSign className="w-3.5 h-3.5" />}
              </button>
              {/* Poll toggle */}
              <button
                type="button"
                onClick={() => { setIsPollMode(!isPollMode); if (!isPollMode) setIsPaidPost(false); }}
                className={`touch-active flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isPollMode
                    ? "text-purple-600 bg-purple-50 border border-purple-200"
                    : "text-[#94A3B8] hover:text-purple-600 hover:bg-purple-50"
                }`}
                title="Create a poll"
              >
                <BarChart3 className="w-3.5 h-3.5" />
              </button>
              {/* Thread toggle */}
              <button
                type="button"
                onClick={() => {
                  const next = !threadMode;
                  setThreadMode(next);
                  if (next) { setIsPaidPost(false); setIsPollMode(false); if (threadSegments.length === 0) setThreadSegments([""]); }
                }}
                className={`touch-active flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  threadMode
                    ? "text-[#2563EB] bg-[#EFF6FF] border border-[#BFDBFE]"
                    : "text-[#94A3B8] hover:text-[#2563EB] hover:bg-[#EFF6FF]"
                }`}
                title={threadMode ? "Turn off thread" : "Create a thread"}
              >
                <ListPlus className="w-3.5 h-3.5" />
              </button>
            </div>
            {uploading && (
              <span className="text-xs text-[#2563EB] animate-pulse">Uploading...</span>
            )}
            <button
              onClick={handlePost}
              disabled={
                posting ||
                (threadMode
                  ? !(newPost.trim() && [newPost, ...threadSegments].map((s) => s.trim()).filter(Boolean).length >= 2)
                  : (!newPost.trim() && !mediaFile))
              }
              className={`touch-active px-5 py-2 text-white text-[15px] font-bold rounded-full disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm ${
                isPaidPost
                  ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-amber-200"
                  : "bg-[#2563EB] hover:bg-[#1D4ED8] shadow-blue-200"
              }`}
            >
              {posting ? "Posting..." : threadMode ? `Post thread 🧵 ${[newPost, ...threadSegments].map((s) => s.trim()).filter(Boolean).length}` : isPaidPost ? `Post · ${paidPrice} SOL` : "Post"}
            </button>
          </div>
        </div>
      )}

      {/* Posts */}
      {!isConnected && (
        <div className="bg-gradient-to-br from-[#EFF6FF] to-[#F0FDF4] rounded-2xl p-8 text-center border border-[#E2E8F0]">
          <div className="w-16 h-16 rounded-2xl bg-white shadow-sm flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-[#2563EB]" />
          </div>
          <h3 className="text-lg font-bold text-[#1A1A2E] mb-2">Welcome to Shyft</h3>
          <p className="text-sm text-[#64748B] max-w-sm mx-auto">Connect your wallet to start posting, chatting, and sending private payments on Solana.</p>
        </div>
      )}

      {/* On-chain public posts from all users */}
      {isConnected && (
        <div className="mt-2">
          {/* Pinned featured token — spotlighted at the top of the feed */}
          <FeaturedToken />

          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#2563EB]" />
              <span className="text-xs font-semibold text-[#64748B]">Public Feed — On-Chain Posts</span>
            </div>
            <button
              onClick={fetchOnchainPosts}
              disabled={loadingOnchain}
              className="flex items-center gap-1 text-xs text-[#2563EB] hover:text-[#1D4ED8] disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loadingOnchain ? "animate-spin" : ""}`} />
              {loadingOnchain ? "Loading..." : "Refresh"}
            </button>
          </div>

          {onchainPosts.length === 0 && allPolls.length === 0 && !loadingOnchain && (
            <div className="bg-[#F8FAFC] rounded-xl p-6 text-center border border-[#E2E8F0]">
              <p className="text-sm text-[#94A3B8]">No public posts on-chain yet. Be the first!</p>
            </div>
          )}

          {/* Merge posts and polls into a single timeline sorted by createdAt */}
          {(() => {
            const feedItems: { type: "post" | "poll"; data: any; createdAt: number }[] = [
              // posts: createdAt is unix seconds on-chain → convert to ms
              ...onchainPosts.map(p => ({ type: "post" as const, data: p, createdAt: Number(p.createdAt) * 1000 })),
              // polls: createdAt already converted to ms in getAllPolls()
              ...allPolls.map(p => ({ type: "poll" as const, data: p, createdAt: Number(p.createdAt) })),
            ].sort((a, b) => b.createdAt - a.createdAt);

            // Inject one trending token card after every TOKEN_INJECT_EVERY items.
            // Walk tokens in order (already sorted by 24h volume server-side) so
            // every render shows the same sequence and we don't repeat the same token.
            const TOKEN_INJECT_EVERY = 6;
            const rendered: ReactElement[] = [];
            let tokenCursor = 0;

            // ── Thread grouping: posts sharing a THREAD rootId render as one unit ──
            const threadGroups = new Map<string, { post: any; index: number; total: number; actualContent: string }[]>();
            for (const it of feedItems) {
              if (it.type !== "post") continue;
              const ti = parseThreadPost(it.data.content);
              if (ti.isThread) {
                const arr = threadGroups.get(ti.rootId) || [];
                arr.push({ post: it.data, index: ti.index, total: ti.total, actualContent: ti.actualContent });
                threadGroups.set(ti.rootId, arr);
              }
            }
            threadGroups.forEach((arr) => arr.sort((a, b) => a.index - b.index));
            const renderedThreadRoots = new Set<string>();

            // Shared post card (used by both normal and threaded posts).
            const makePostCard = (p: any, profile: any, isMe: boolean) => (
              <OnChainPostCard
                post={p}
                profile={profile}
                isMe={isMe}
                program={program}
                allComments={allComments}
                allReactions={allReactions}
                profileMap={profileMap}
                onCommentAdded={refreshInteractions}
                onReactionAdded={refreshInteractions}
                defaultShowComments={focusPostKey === p.publicKey}
                onRepost={async (content: string) => {
                  if (!program || !publicKey) return;
                  const postId = Date.now();
                  try {
                    await program.createPost(postId, content, false);
                    toast("success", "Repost published! 🔁", "On-chain");
                    setTimeout(() => fetchOnchainPosts(), 1500);
                  } catch (err: any) {
                    toast("error", "Repost failed", err?.message?.slice(0, 80) || "Try again");
                  }
                }}
                onDelete={() => { setTimeout(() => fetchOnchainPosts(), 1500); }}
              />
            );

            feedItems.forEach((item, idx) => {
              if (item.type === "poll") {
                const poll = item.data;
                const profile = profileMap[poll.creator];
                const isMe = publicKey ? poll.creator === publicKey.toBase58() : false;
                rendered.push(
                  <PollCard
                    key={`poll-${poll.pubkey}`}
                    poll={poll}
                    profile={profile}
                    isMe={isMe}
                    program={program}
                    myVote={myVotes[poll.pubkey] || null}
                    onVoted={() => {
                      setTimeout(() => fetchOnchainPosts(), 1500);
                    }}
                  />
                );
              } else {
                const post = item.data;
                const profile = profileMap[post.author];
                const isMe = publicKey ? post.author === publicKey.toBase58() : false;
                const ti = parseThreadPost(post.content);

                if (ti.isThread) {
                  // Render the entire thread once, at its first-seen member's slot.
                  if (renderedThreadRoots.has(ti.rootId)) return;
                  renderedThreadRoots.add(ti.rootId);
                  const members = threadGroups.get(ti.rootId) || [];
                  rendered.push(
                    <div key={`thread-${ti.rootId}`} id={`post-${post.publicKey}`}>
                      <ThreadGroup
                        members={members}
                        renderMember={(m) => makePostCard({ ...m.post, content: m.actualContent }, profile, isMe)}
                      />
                    </div>
                  );
                } else {
                  rendered.push(
                    <div key={post.publicKey} id={`post-${post.publicKey}`} className="transition-all duration-300 rounded-2xl">
                      {makePostCard(post, profile, isMe)}
                    </div>
                  );
                }
              }

              // After every Nth item, inject a trending token card (if we have tokens left)
              const isInjectionPoint = (idx + 1) % TOKEN_INJECT_EVERY === 0 && idx !== feedItems.length - 1;
              if (isInjectionPoint && trendingTokens.length > 0) {
                const token = trendingTokens[tokenCursor % trendingTokens.length];
                tokenCursor++;
                rendered.push(
                  <TrendingTokenCard
                    key={`trend-${token.tokenMint}-${idx}`}
                    token={token}
                    onTrade={(picked) => setSelectedTrendingToken(picked)}
                  />
                );
              }
            });

            return rendered;
          })()}
        </div>
      )}

      {selectedTrendingToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto">
            <div className="p-5 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-3">
                {selectedTrendingToken.image ? (
                  <img src={selectedTrendingToken.image} alt="" className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#2563EB] to-[#7C3AED] flex items-center justify-center">
                    <span className="text-lg font-bold text-white">{selectedTrendingToken.symbol?.[0] || "?"}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold text-[#1A1A2E] truncate">{selectedTrendingToken.name}</h2>
                  <span className="text-sm text-[#64748B]">${selectedTrendingToken.symbol}</span>
                </div>
                <button onClick={() => setSelectedTrendingToken(null)} className="p-2 hover:bg-[#F1F5F9] rounded-lg">✕</button>
              </div>
              {selectedTrendingToken.description && (
                <p className="text-xs text-[#64748B] mt-2">{selectedTrendingToken.description}</p>
              )}
            </div>
            <div className="p-4">
              <TokenTrade
                tokenMint={selectedTrendingToken.tokenMint}
                tokenSymbol={selectedTrendingToken.symbol}
                tokenImage={selectedTrendingToken.image}
                compact
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
