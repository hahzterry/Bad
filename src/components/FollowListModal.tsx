"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Loader2,
  BadgeCheck,
  UserPlus,
  UserMinus,
  UserCheck,
  RefreshCw,
  Shield,
} from "lucide-react";
import { useProgram } from "@/hooks/useProgram";
import { useWallet } from "@/hooks/usePrivyWallet";
import { useAppStore } from "@/lib/store";
import { toast } from "@/components/Toast";
import { handleIpfsImgError } from "@/components/RichContent";
import { PublicKey } from "@solana/web3.js";
import { clearRpcCache } from "@/lib/program";

// Gold badge for OG / founder accounts
const GOLD_BADGE_USERNAMES = ["shaan", "shyft"];
// Profiles created before this Unix timestamp (May 12 2026) keep their blue badge
const BLUE_BADGE_CUTOFF_UNIX = 1778544000;

type Tab = "verified_followers" | "followers" | "following";

interface FollowListModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The wallet address whose followers/following to show */
  targetAddress: string;
  /** The display name shown in the modal header */
  displayName: string;
  /** Which tab to open initially */
  initialTab: Tab;
  /** Callback when follow counts change (so parent can update) */
  onFollowCountChange?: () => void;
}

interface UserRow {
  address: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  isVerified: boolean; // has an on-chain profile
  isGoldBadge: boolean;
  isOGUser: boolean; // joined before the blue badge cutoff date
}

export default function FollowListModal({
  isOpen,
  onClose,
  targetAddress,
  displayName,
  initialTab,
  onFollowCountChange,
}: FollowListModalProps) {
  const program = useProgram();
  const { publicKey } = useWallet();
  const { setViewingProfile, setActiveTab: setAppTab } = useAppStore();

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [followers, setFollowers] = useState<string[]>([]);
  const [following, setFollowing] = useState<string[]>([]);
  const [myFollowing, setMyFollowing] = useState<string[]>([]); // who the current user follows
  const [profileMap, setProfileMap] = useState<Record<string, any>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Update tab when initialTab prop changes
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!program || !targetAddress) return;
    setLoading(true);
    try {
      const targetPubkey = new PublicKey(targetAddress);
      const [followersList, followingList, profiles] = await Promise.all([
        program.getFollowers(targetPubkey),
        program.getFollowing(targetPubkey),
        program.getAllProfiles(),
      ]);

      setFollowers(followersList);
      setFollowing(followingList);

      // Build profile map
      const map: Record<string, any> = {};
      profiles.forEach((p: any) => {
        map[p.owner] = p;
      });
      setProfileMap(map);

      // Get current user's following list (for follow/unfollow buttons)
      if (publicKey) {
        const myFollowingList = await program.getFollowing(publicKey);
        setMyFollowing(myFollowingList);
      }
    } catch (err) {
      console.error("Failed to fetch follow data:", err);
    }
    setLoading(false);
  }, [program, targetAddress, publicKey]);

  useEffect(() => {
    if (isOpen) fetchData();
  }, [isOpen, fetchData]);

  // Build user rows from address list
  const buildUserRows = (addresses: string[]): UserRow[] => {
    return addresses.map((addr) => {
      const profile = profileMap[addr];
      return {
        address: addr,
        username: profile?.username || "",
        displayName: profile?.displayName || addr.slice(0, 4) + "..." + addr.slice(-4),
        avatarUrl: profile?.avatarUrl || "",
        bio: profile?.bio || "",
        isVerified: !!profile?.username, // has a real on-chain profile
        isGoldBadge: GOLD_BADGE_USERNAMES.includes((profile?.username || "").toLowerCase()),
        isOGUser: !GOLD_BADGE_USERNAMES.includes((profile?.username || "").toLowerCase()) && (() => { const ts = parseInt(String(profile?.createdAt || 0), 10); return ts > 0 && ts < BLUE_BADGE_CUTOFF_UNIX; })(),
      };
    });
  };

  // Verified followers = followers who have an on-chain profile
  const followerRows = buildUserRows(followers);
  const verifiedFollowerRows = followerRows.filter((u) => u.isVerified);
  const followingRows = buildUserRows(following);

  const handleFollow = async (addr: string) => {
    if (!program || actionLoading) return;
    setActionLoading(addr);
    try {
      await program.followUser(new PublicKey(addr));
      toast("success", "Following!", "You're now following this user");
      clearRpcCache();
      setMyFollowing((prev) => [...prev, addr]);
      onFollowCountChange?.();
    } catch (err: any) {
      console.error("Follow error:", err);
      if (err?.message?.includes("User rejected")) {
        toast("error", "Cancelled");
      } else {
        toast("error", "Failed to follow", err?.message?.slice(0, 80) || "");
      }
    }
    setActionLoading(null);
  };

  const handleUnfollow = async (addr: string) => {
    if (!program || actionLoading) return;
    setActionLoading(addr);
    try {
      await program.unfollowUser(new PublicKey(addr));
      toast("success", "Unfollowed");
      clearRpcCache();
      setMyFollowing((prev) => prev.filter((a) => a !== addr));
      onFollowCountChange?.();
    } catch (err: any) {
      console.error("Unfollow error:", err);
      if (err?.message?.includes("User rejected")) {
        toast("error", "Cancelled");
      } else {
        toast("error", "Failed to unfollow", err?.message?.slice(0, 80) || "");
      }
    }
    setActionLoading(null);
  };

  const navigateToProfile = (addr: string) => {
    onClose();
    setViewingProfile(addr);
    setAppTab("profile");
  };

  const myAddr = publicKey?.toBase58() || "";

  const getListForTab = (): UserRow[] => {
    switch (activeTab) {
      case "verified_followers":
        return verifiedFollowerRows;
      case "followers":
        return followerRows;
      case "following":
        return followingRows;
    }
  };

  const currentList = getListForTab();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg mt-12 rounded-2xl shadow-2xl max-h-[80vh] flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F0]">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#F1F5F9] transition"
            >
              <X className="w-5 h-5 text-[#1A1A2E]" />
            </button>
            <span className="font-bold text-[#1A1A2E] text-lg">{displayName}</span>
          </div>
        </div>

        {/* Tabs — X-style */}
        <div className="flex border-b border-[#E2E8F0]">
          {([
            { id: "verified_followers" as Tab, label: "Verified Followers" },
            { id: "followers" as Tab, label: "Followers" },
            { id: "following" as Tab, label: "Following" },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
                activeTab === tab.id
                  ? "text-[#1A1A2E] font-bold"
                  : "text-[#64748B] hover:text-[#1A1A2E] hover:bg-[#F8FAFC]"
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-14 h-1 bg-[#2563EB] rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-[#2563EB] animate-spin" />
            </div>
          ) : currentList.length === 0 ? (
            <div className="text-center py-16 px-4">
              <div className="w-14 h-14 rounded-full bg-[#F1F5F9] flex items-center justify-center mx-auto mb-3">
                {activeTab === "verified_followers" ? (
                  <Shield className="w-7 h-7 text-[#94A3B8]" />
                ) : activeTab === "followers" ? (
                  <UserCheck className="w-7 h-7 text-[#94A3B8]" />
                ) : (
                  <UserPlus className="w-7 h-7 text-[#94A3B8]" />
                )}
              </div>
              <p className="text-[15px] font-bold text-[#1A1A2E] mb-1">
                {activeTab === "verified_followers"
                  ? "No verified followers yet"
                  : activeTab === "followers"
                  ? "No followers yet"
                  : "Not following anyone yet"}
              </p>
              <p className="text-sm text-[#64748B]">
                {activeTab === "verified_followers"
                  ? "When verified people follow this account, they'll show up here."
                  : activeTab === "followers"
                  ? "When someone follows this account, they'll show up here."
                  : "When this account follows someone, they'll show up here."}
              </p>
            </div>
          ) : (
            <div>
              {currentList.map((user) => {
                const isSelf = user.address === myAddr;
                const iFollow = myFollowing.includes(user.address);
                const isLoading = actionLoading === user.address;

                return (
                  <div
                    key={user.address}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                  >
                    {/* Avatar */}
                    <button
                      onClick={() => navigateToProfile(user.address)}
                      className="flex-shrink-0"
                    >
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          onError={handleIpfsImgError}
                          alt=""
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#EBF4FF] to-[#E0F2FE] flex items-center justify-center text-lg">
                          👤
                        </div>
                      )}
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => navigateToProfile(user.address)}
                          className="text-left min-w-0 flex-1"
                        >
                          <div className="flex items-center gap-1">
                            <span className="font-bold text-[15px] text-[#1A1A2E] truncate hover:underline">
                              {user.displayName}
                            </span>
                            {user.isGoldBadge ? (
                              <BadgeCheck className="w-4 h-4 flex-shrink-0 text-[#F59E0B]" />
                            ) : user.isOGUser ? (
                              <BadgeCheck className="w-4 h-4 flex-shrink-0 text-[#2563EB]" />
                            ) : null}
                          </div>
                          {user.username && (
                            <span className="text-sm text-[#64748B]">@{user.username}</span>
                          )}
                        </button>

                        {/* Follow/Unfollow Button */}
                        {!isSelf && (
                          <div className="flex-shrink-0 ml-3">
                            {iFollow ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUnfollow(user.address);
                                }}
                                disabled={isLoading}
                                className="group px-4 py-1.5 rounded-full text-sm font-bold border border-[#E2E8F0] text-[#1A1A2E] hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-50"
                              >
                                {isLoading ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <span>
                                    <span className="group-hover:hidden">Following</span>
                                    <span className="hidden group-hover:inline">Unfollow</span>
                                  </span>
                                )}
                              </button>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleFollow(user.address);
                                }}
                                disabled={isLoading}
                                className="px-4 py-1.5 rounded-full text-sm font-bold bg-[#1A1A2E] text-white hover:bg-[#2A2A3E] transition-all disabled:opacity-50"
                              >
                                {isLoading ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  "Follow"
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Bio */}
                      {user.bio && (
                        <p className="text-sm text-[#1A1A2E] mt-1 line-clamp-2">{user.bio}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
