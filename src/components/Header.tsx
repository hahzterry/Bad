"use client";

import { Shield, LogOut, Wallet, Bell, Sun, Moon } from "lucide-react";
import { useWallet } from "@/hooks/usePrivyWallet";
import { getChainPreference } from "@/components/ChainSelector";
import { useAppStore, AppNotification } from "@/lib/store";
import { useProgram } from "@/hooks/useProgram";
import { handleIpfsImgError } from "@/components/RichContent";
import { useEffect, useState, useRef } from "react";
import ProfileSetup from "@/components/ProfileSetup";
import { useNotifications } from "@/hooks/useNotifications";

const titles: Record<string, string> = {
  feed: "Feed",
  chat: "Chat",
  friends: "People",
  payments: "Payments",
  dashboard: "Creator Dashboard",
  profile: "Profile",
};

const subtitles: Record<string, string> = {
  feed: "Your encrypted feed",
  chat: "End-to-end encrypted",
  friends: "Follow & discover people",
  payments: "Private via PER",
  dashboard: "Your content analytics",
  profile: "On-chain identity",
};

export default function Header() {
  const { activeTab, setCurrentUser, setConnected, notifications, markAllNotificationsRead, setActiveTab, theme, toggleTheme, navigateToProfile, setFocusPostKey } = useAppStore();
  const { publicKey, connected, login, logout, ready, evmAddress, activeChain } = useWallet();
  const program = useProgram();
  const [showSetup, setShowSetup] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Start notification polling
  useNotifications();

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Sync connected state
  useEffect(() => {
    setConnected(connected);
  }, [connected, setConnected]);

  // Profile check — runs once when wallet + program are both ready
  useEffect(() => {
    // Reset when disconnected
    if (!connected || !publicKey) {
      setProfileLoaded(false);
      setShowSetup(false);
      setCurrentUser(null);
      return;
    }

    // Wait for program to be ready
    if (!program || !ready) return;

    // Already loaded for this session
    if (profileLoaded) return;

    let cancelled = false;
    setProfileLoaded(true); // Set immediately to prevent duplicate calls

    const loadProfile = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const profile = await program.getProfile(publicKey);
          if (cancelled) return;
          if (profile && profile.username && profile.displayName) {
            console.log("✅ Profile found on-chain:", profile.username);
            setCurrentUser({
              publicKey: publicKey.toBase58(),
              username: profile.username,
              displayName: profile.displayName,
              avatar: profile.avatarUrl || "🔒",
              bio: profile.bio || "",
              isPrivate: profile.isPrivate || false,
              followerCount: Number(profile.followerCount?.toString() || 0),
              followingCount: Number(profile.followingCount?.toString() || 0),
              createdAt: Number(profile.createdAt?.toString() || Date.now()),
              avatarUrl: profile.avatarUrl || "",
              bannerUrl: profile.bannerUrl || "",
            });
            setShowSetup(false);
            return;
          } else {
            console.log("📝 No profile found — showing setup");
            if (!cancelled) setShowSetup(true);
            return;
          }
        } catch (err: any) {
          console.warn(`Profile check attempt ${attempt + 1} failed:`, err?.message?.slice(0, 60));
          if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
        }
      }
      // All retries failed
      if (!cancelled) {
        console.warn("❌ Profile check failed after 3 attempts — showing setup");
        setShowSetup(true);
      }
    };

    loadProfile();
    return () => { cancelled = true; };
  }, [connected, publicKey, program, ready, profileLoaded, setCurrentUser]);

  // Close notification panel on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    if (showNotifications) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showNotifications]);

  const notifIcon = (type: string) => {
    switch (type) {
      case "like": return "❤️";
      case "comment": return "💬";
      case "reaction": return "😀";
      case "repost": return "🔁";
      case "follow": return "👤";
      case "mention": return "🏷️";
      case "tip": return "🔔";
      default: return "🔔";
    }
  };

  const notifMessage = (n: AppNotification) => {
    switch (n.type) {
      case "like": return <><strong>{n.actorName}</strong> liked your post</>;
      case "comment": return <><strong>{n.actorName}</strong> commented: &quot;{n.commentText}&quot;</>;
      case "reaction": return <><strong>{n.actorName}</strong> reacted {n.reactionEmoji} to your post</>;
      case "repost": return <><strong>{n.actorName}</strong> reposted your post</>;
      case "follow": return <><strong>{n.actorName}</strong> started following you</>;
      case "mention": return <><strong>{n.actorName}</strong> mentioned you{n.commentText ? `: "${n.commentText}"` : ""}</>;
      case "tip": return <><strong>💸 {n.postPreview}</strong> — someone tipped you!</>;
      default: return <><strong>{n.actorName}</strong> interacted with your content</>;
    }
  };

  const timeAgo = (ts: number) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };

  return (
    <>
      <header className="relative z-10 bg-white border-b border-[#E2E8F0]">
        <div className="flex items-center justify-between px-3 sm:px-4 md:px-8 py-2.5 sm:py-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <img src="/shyftlogo.png" alt="Shyft" className="shyft-logo md:hidden w-11 h-11 sm:w-12 sm:h-12 flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-[#1A1A2E] truncate">{titles[activeTab] || "Feed"}</h2>
              <p className="text-[10px] sm:text-xs text-[#64748B] truncate">
                <span className="sm:hidden">{subtitles[activeTab] || "Encrypted via PER"}</span>
                <span className="hidden sm:inline">On-chain social on Solana</span>
              </p>
            </div>
          </div>
          <div className="flex-shrink-0 ml-2 flex items-center gap-2">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] transition-all duration-300"
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              {theme === "light" ? (
                <Moon className="w-4 h-4 text-[#64748B]" />
              ) : (
                <Sun className="w-4 h-4 text-[#F59E0B]" />
              )}
            </button>

            {/* Notification Bell */}
            {connected && (
              <div className="relative" ref={notifRef}>
                <button
                  onClick={() => {
                    setShowNotifications(!showNotifications);
                    if (!showNotifications && unreadCount > 0) {
                      markAllNotificationsRead();
                    }
                  }}
                  className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] transition-colors"
                >
                  <Bell className="w-4 h-4 text-[#64748B]" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-[#EF4444] text-white text-[10px] font-bold flex items-center justify-center px-1 animate-pulse">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>

                {/* Notification Panel */}
                {showNotifications && (
                  <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-h-[70vh] bg-white rounded-xl shadow-xl border border-[#E2E8F0] z-50 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F0]">
                      <h3 className="font-bold text-[15px] text-[#1A1A2E]">Notifications</h3>
                      {notifications.length > 0 && (
                        <button
                          onClick={() => markAllNotificationsRead()}
                          className="text-xs text-[#2563EB] hover:underline"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="overflow-y-auto max-h-[60vh]">
                      {notifications.length === 0 ? (
                        <div className="py-12 text-center">
                          <div className="text-3xl mb-2">🔔</div>
                          <p className="text-sm text-[#94A3B8]">No notifications yet</p>
                          <p className="text-xs text-[#CBD5E1] mt-1">When someone likes, comments, or reposts your content, you&apos;ll see it here.</p>
                        </div>
                      ) : (
                        notifications.slice(0, 30).map((n) => (
                          <div
                            key={n.id}
                            className={`w-full flex items-start gap-3 px-4 py-3 hover:bg-[#F8FAFC] transition-colors text-left border-b border-[#F1F5F9] last:border-0 ${!n.read ? "bg-[#EFF6FF]" : ""}`}
                          >
                            {/* Actor avatar — clickable to profile */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (n.actorAddress && n.actorAddress !== "unknown" && n.actorAddress !== "") {
                                  navigateToProfile(n.actorAddress);
                                  setShowNotifications(false);
                                }
                              }}
                              className="flex-shrink-0 mt-0.5 cursor-pointer"
                            >
                              {n.actorAvatarUrl ? (
                                <img src={n.actorAvatarUrl} onError={handleIpfsImgError} alt="" className="w-9 h-9 rounded-full object-cover border border-[#E2E8F0]" />
                              ) : (
                                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#EBF4FF] to-[#E0F2FE] flex items-center justify-center text-sm border border-[#E2E8F0]">
                                  {n.type === "tip" ? "💸" : (n.actorName?.charAt(0)?.toUpperCase() || notifIcon(n.type))}
                                </div>
                              )}
                            </button>
                            {/* Notification content — click navigates to post */}
                            <button
                              type="button"
                              onClick={() => {
                                if (n.type === "follow" && n.actorAddress) {
                                  navigateToProfile(n.actorAddress);
                                } else if (n.postKey) {
                                  setFocusPostKey(n.postKey);
                                  setActiveTab("feed");
                                }
                                setShowNotifications(false);
                              }}
                              className="flex-1 min-w-0 text-left cursor-pointer"
                            >
                              <p className="text-[13px] text-[#334155] leading-snug">
                                {notifMessage(n)}
                              </p>
                              {n.postPreview && n.type !== "follow" && n.type !== "mention" && (
                                <p className="text-[11px] text-[#94A3B8] mt-0.5 truncate">
                                  {n.postPreview.startsWith("RT|") ? "Repost" : n.postPreview}
                                </p>
                              )}
                              <p className="text-[10px] text-[#CBD5E1] mt-0.5">{timeAgo(n.timestamp)}</p>
                            </button>
                            {!n.read && (
                              <span className="w-2 h-2 rounded-full bg-[#2563EB] flex-shrink-0 mt-2" />
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Chain badge + wallet button */}
            {connected ? (
              <div className="flex items-center gap-2">
                {/* Active chain indicator */}
                <div
                  className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold"
                  style={
                    activeChain === "base"
                      ? { background: "#EFF6FF", color: "#0052FF" }
                      : { background: "#faf5ff", color: "#9945FF" }
                  }
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: activeChain === "base" ? "#0052FF" : "#9945FF" }}
                  />
                  {activeChain === "base" ? "Base" : "Solana"}
                </div>
                <button
                  onClick={logout}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#64748B] rounded-lg transition-colors"
                >
                  <Wallet className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">
                    {activeChain === "base" && evmAddress
                      ? `${evmAddress.slice(0, 4)}...${evmAddress.slice(-4)}`
                      : `${publicKey?.toBase58().slice(0, 4)}...${publicKey?.toBase58().slice(-4)}`}
                  </span>
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={login}
                disabled={!ready}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-lg transition-colors disabled:opacity-50"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {showSetup && connected && (
        <ProfileSetup onComplete={() => setShowSetup(false)} />
      )}
    </>
  );
}
