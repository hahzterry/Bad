"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { BadgeCheck } from "lucide-react";
import { handleIpfsImgError } from "@/components/RichContent";
import { useAppStore } from "@/lib/store";

const GOLD_BADGE_USERNAMES = ["shaan", "shyft"];
// Profiles created before this Unix timestamp (May 12 2026) keep their blue badge
const BLUE_BADGE_CUTOFF_UNIX = 1778544000;

/** Delay (ms) before the hover card appears / disappears */
const SHOW_DELAY = 400;
const HIDE_DELAY = 300;

interface ProfileHoverCardProps {
  /** Wallet address of the user */
  walletAddress: string;
  /** Profile data from profileMap */
  profile: {
    displayName?: string;
    username?: string;
    bio?: string;
    avatarUrl?: string;
    followerCount?: number;
    followingCount?: number;
    postCount?: number;
    createdAt?: string | number;
  } | null | undefined;
  /** Children to wrap (the trigger element) */
  children: React.ReactNode;
  /** Optional wrapper className override (default: inline-flex) */
  wrapperClassName?: string;
}

export default function ProfileHoverCard({ walletAddress, profile, children, wrapperClassName }: ProfileHoverCardProps) {
  const [show, setShow] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { navigateToProfile } = useAppStore();

  const clearTimers = useCallback(() => {
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; }
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearTimers();
    showTimer.current = setTimeout(() => setShow(true), SHOW_DELAY);
  }, [clearTimers]);

  const handleMouseLeave = useCallback(() => {
    clearTimers();
    hideTimer.current = setTimeout(() => setShow(false), HIDE_DELAY);
  }, [clearTimers]);

  // Cleanup timers on unmount
  useEffect(() => () => clearTimers(), [clearTimers]);

  if (!profile) {
    // No profile data — just render children without hover card
    return <>{children}</>;
  }

  const displayName = profile.displayName && profile.displayName !== "Anonymous"
    ? profile.displayName
    : walletAddress.slice(0, 4) + "..." + walletAddress.slice(-4);
  const username = profile.username && profile.username !== "anon"
    ? profile.username
    : walletAddress.slice(0, 8);
  const realUsername = profile.username || "";
  const isGold = GOLD_BADGE_USERNAMES.includes(realUsername.toLowerCase());
  const profileCreatedAt = parseInt(String(profile.createdAt || 0), 10);
  const isOGUser = !isGold && profileCreatedAt > 0 && profileCreatedAt < BLUE_BADGE_CUTOFF_UNIX;
  const bio = profile.bio || "";
  const followers = Number(profile.followerCount || 0);
  const following = Number(profile.followingCount || 0);
  const posts = Number(profile.postCount || 0);

  return (
    <div
      ref={containerRef}
      className={`relative ${wrapperClassName || "inline-flex"}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}

      {/* Hover Card */}
      {show && (
        <div
          className="absolute z-[100] left-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-xl border border-[#E2E8F0] p-4 animate-fade-in"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Top row: Avatar + Follow button */}
          <div className="flex items-start justify-between mb-3">
            <button
              type="button"
              onClick={() => navigateToProfile(walletAddress)}
              className="cursor-pointer"
            >
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  onError={handleIpfsImgError}
                  alt={displayName}
                  className="w-14 h-14 rounded-full object-cover border-2 border-white shadow-sm hover:ring-2 hover:ring-[#2563EB]/30 transition-all"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#F0FDF4] to-[#DCFCE7] flex items-center justify-center text-2xl font-bold text-[#16A34A] border-2 border-white shadow-sm hover:ring-2 hover:ring-[#2563EB]/30 transition-all">
                  {displayName.charAt(0)?.toUpperCase() || "?"}
                </div>
              )}
            </button>
          </div>

          {/* Name + username */}
          <button
            type="button"
            onClick={() => navigateToProfile(walletAddress)}
            className="text-left cursor-pointer block"
          >
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-[#1A1A2E] text-[15px] hover:underline">{displayName}</span>
              {isGold ? (
                <BadgeCheck className="w-4 h-4 flex-shrink-0 text-[#F59E0B]" />
              ) : isOGUser ? (
                <BadgeCheck className="w-4 h-4 flex-shrink-0 text-[#2563EB]" />
              ) : null}
            </div>
            <span className="text-sm text-[#94A3B8] block -mt-0.5">@{username}</span>
          </button>

          {/* Bio */}
          {bio && (
            <p className="text-sm text-[#475569] mt-2 leading-relaxed line-clamp-3">{bio}</p>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-4 mt-3">
            <span className="text-sm">
              <span className="font-bold text-[#1A1A2E]">{following}</span>{" "}
              <span className="text-[#94A3B8]">Following</span>
            </span>
            <span className="text-sm">
              <span className="font-bold text-[#1A1A2E]">{followers}</span>{" "}
              <span className="text-[#94A3B8]">Followers</span>
            </span>
          </div>

          {/* Posts count */}
          <div className="mt-2">
            <span className="text-xs text-[#94A3B8]">{posts} post{posts !== 1 ? "s" : ""} on-chain</span>
          </div>
        </div>
      )}
    </div>
  );
}
