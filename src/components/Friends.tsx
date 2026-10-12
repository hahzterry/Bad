"use client";

import { useState, useEffect } from "react";
import { Search, UserPlus, UserMinus, UserCheck, Users, RefreshCw, Globe } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { handleIpfsImgError } from "@/components/RichContent";
import { toast } from "@/components/Toast";
import { useProgram } from "@/hooks/useProgram";
import { useWallet } from "@/hooks/usePrivyWallet";
import { PublicKey } from "@solana/web3.js";
import { clearRpcCache } from "@/lib/program";

interface SearchResult {
  owner: string;
  username: string;
  displayName: string;
}

export default function Friends() {
  const { isConnected, navigateToProfile } = useAppStore();
  const program = useProgram();
  const { publicKey } = useWallet();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [following, setFollowing] = useState<string[]>([]);
  const [followers, setFollowers] = useState<string[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [followingUser, setFollowingUser] = useState<string | null>(null);
  const [unfollowingUser, setUnfollowingUser] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"search" | "following" | "followers">("search");

  // Fetch follow data
  const fetchFollowData = async () => {
    if (!program || !publicKey) return;
    setLoading(true);
    clearRpcCache();
    try {
      const [followingList, followersList, profiles] = await Promise.all([
        program.getFollowing(publicKey),
        program.getFollowers(publicKey),
        program.getAllProfiles(),
      ]);

      setFollowing(followingList);
      setFollowers(followersList);

      const map: Record<string, any> = {};
      profiles.forEach((p: any) => { map[p.owner] = p; });
      setProfileMap(map);
    } catch (err) {
      console.error("Failed to fetch follow data:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchFollowData();
  }, [program, publicKey]);

  // Search by username
  const handleSearch = async () => {
    if (!searchQuery.trim() || !program) return;
    setSearching(true);
    try {
      const results = await program.searchByUsername(searchQuery.trim());
      const myAddr = publicKey?.toBase58() || "";
      setSearchResults(results.filter((r) => r.owner !== myAddr));
    } catch (err) {
      console.error("Search error:", err);
    }
    setSearching(false);
  };

  useEffect(() => {
    if (searchQuery.length >= 2) {
      const timer = setTimeout(handleSearch, 400);
      return () => clearTimeout(timer);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, program]);

  // Follow user
  const handleFollow = async (targetAddress: string) => {
    if (!program || followingUser) return;
    setFollowingUser(targetAddress);
    try {
      const targetPubkey = new PublicKey(targetAddress);
      await program.followUser(targetPubkey);
      toast("success", "Following! 🎉", "You're now following this user");
      setSearchQuery("");
      setSearchResults([]);
      await fetchFollowData();
    } catch (err: any) {
      console.error("Follow error:", err);
      if (err?.message?.includes("User rejected")) {
        toast("error", "Cancelled", "You rejected the transaction");
      } else if (err?.message?.includes("already in use") || err?.message?.includes("AlreadyFollowing")) {
        toast("error", "Already following", "You're already following this user");
      } else {
        toast("error", "Failed to follow", err?.message?.slice(0, 80) || "Please try again");
      }
    }
    setFollowingUser(null);
  };

  // Unfollow user
  const handleUnfollow = async (targetAddress: string) => {
    if (!program || unfollowingUser) return;
    setUnfollowingUser(targetAddress);
    try {
      const targetPubkey = new PublicKey(targetAddress);
      await program.unfollowUser(targetPubkey);
      toast("success", "Unfollowed", "You've unfollowed this user");
      await fetchFollowData();
    } catch (err: any) {
      console.error("Unfollow error:", err);
      if (err?.message?.includes("User rejected")) {
        toast("error", "Cancelled", "You rejected the transaction");
      } else {
        toast("error", "Failed to unfollow", err?.message?.slice(0, 80) || "Please try again");
      }
    }
    setUnfollowingUser(null);
  };

  // Helper: get follow status of a search result
  const getFollowStatus = (ownerAddr: string): "none" | "following" | "follows_you" | "mutual" => {
    const iFollow = following.includes(ownerAddr);
    const theyFollow = followers.includes(ownerAddr);
    if (iFollow && theyFollow) return "mutual";
    if (iFollow) return "following";
    if (theyFollow) return "follows_you";
    return "none";
  };

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-gradient-to-br from-[#EFF6FF] to-[#F0FDF4] rounded-2xl p-8 text-center border border-[#E2E8F0]">
          <div className="w-16 h-16 rounded-2xl bg-white shadow-sm flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-[#2563EB]" />
          </div>
          <h3 className="text-lg font-bold text-[#1A1A2E] mb-2">Find People</h3>
          <p className="text-sm text-[#64748B] max-w-sm mx-auto">Connect your wallet to discover people and follow them on-chain.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Section Tabs */}
      <div className="flex gap-1 bg-[#F1F5F9] rounded-xl p-1">
        {[
          { id: "search" as const, label: "Discover", icon: Search, count: 0 },
          { id: "following" as const, label: "Following", icon: UserPlus, count: following.length },
          { id: "followers" as const, label: "Followers", icon: Users, count: followers.length },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSection(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
              activeSection === tab.id
                ? "bg-white text-[#2563EB] shadow-sm"
                : "text-[#64748B] hover:text-[#1A1A2E]"
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full ${
                activeSection === tab.id ? "bg-[#2563EB] text-white" : "bg-[#E2E8F0] text-[#64748B]"
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search / Discover Section */}
      {activeSection === "search" && (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4">
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by username or display name..."
                  className="w-full pl-10 pr-4 py-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                />
              </div>
            </div>

            {searching && (
              <div className="flex items-center justify-center py-6">
                <RefreshCw className="w-4 h-4 animate-spin text-[#2563EB] mr-2" />
                <span className="text-sm text-[#64748B]">Searching on-chain profiles...</span>
              </div>
            )}

            {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
              <div className="text-center py-6">
                <p className="text-sm text-[#94A3B8]">No users found for &ldquo;{searchQuery}&rdquo;</p>
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="mt-3 space-y-2">
                {searchResults.map((result) => {
                  const status = getFollowStatus(result.owner);
                  return (
                    <div key={result.owner} className="flex items-center gap-3 p-3 rounded-xl bg-[#F8FAFC] hover:bg-[#F1F5F9] transition-colors">
                      <button type="button" onClick={() => navigateToProfile(result.owner)} className="flex-shrink-0 cursor-pointer">
                      {profileMap[result.owner]?.avatarUrl ? (
                        <img src={profileMap[result.owner].avatarUrl} onError={handleIpfsImgError} alt="" className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-sm flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#EBF4FF] to-[#E0F2FE] flex items-center justify-center text-sm font-semibold text-[#2563EB] border-2 border-white shadow-sm flex-shrink-0">
                          {(result.displayName || result.username || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <button type="button" onClick={() => navigateToProfile(result.owner)} className="font-semibold text-[#1A1A2E] text-sm truncate hover:text-[#2563EB] transition-colors cursor-pointer">{result.displayName || result.username}</button>
                          {status === "mutual" && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#F0FDF4] text-[#16A34A] font-medium">Mutual</span>
                          )}
                        </div>
                        <span className="text-xs text-[#94A3B8]">@{result.username}</span>
                      </div>
                      <div className="flex-shrink-0">
                        {(status === "following" || status === "mutual") ? (
                          <button
                            onClick={() => handleUnfollow(result.owner)}
                            disabled={unfollowingUser === result.owner}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#64748B] bg-[#F1F5F9] hover:text-[#DC2626] hover:bg-[#FEF2F2] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {unfollowingUser === result.owner ? (
                              <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Unfollowing...</>
                            ) : (
                              <><UserCheck className="w-3.5 h-3.5" /> Following</>
                            )}
                          </button>
                        ) : status === "follows_you" ? (
                          <button
                            onClick={() => handleFollow(result.owner)}
                            disabled={followingUser === result.owner}
                            className="inline-flex items-center gap-1 text-xs font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {followingUser === result.owner ? (
                              <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Following...</>
                            ) : (
                              <><UserPlus className="w-3.5 h-3.5" /> Follow Back</>
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleFollow(result.owner)}
                            disabled={followingUser === result.owner}
                            className="inline-flex items-center gap-1 text-xs font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {followingUser === result.owner ? (
                              <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Following...</>
                            ) : (
                              <><UserPlus className="w-3.5 h-3.5" /> Follow</>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {searchQuery.length < 2 && !searching && (
            <div className="bg-[#F8FAFC] rounded-xl p-6 text-center border border-[#E2E8F0]">
              <Search className="w-8 h-8 text-[#94A3B8] mx-auto mb-2" />
              <p className="text-sm text-[#94A3B8]">Discover people by their username or display name</p>
              <p className="text-xs text-[#CBD5E1] mt-1">Type at least 2 characters to start searching</p>
            </div>
          )}
        </div>
      )}

      {/* Following Section */}
      {activeSection === "following" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#1A1A2E]">Following</h3>
            <button
              onClick={fetchFollowData}
              disabled={loading}
              className="flex items-center gap-1 text-xs text-[#2563EB] hover:text-[#1D4ED8] disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {following.length === 0 ? (
            <div className="bg-[#F8FAFC] rounded-xl p-6 text-center border border-[#E2E8F0]">
              <UserPlus className="w-8 h-8 text-[#94A3B8] mx-auto mb-2" />
              <p className="text-sm text-[#94A3B8]">Not following anyone yet</p>
              <p className="text-xs text-[#CBD5E1] mt-1">Search for people to follow!</p>
            </div>
          ) : (
            following.map((addr) => {
              const profile = profileMap[addr];
              const name = profile?.displayName || addr.slice(0, 4) + "..." + addr.slice(-4);
              const username = profile?.username || addr.slice(0, 8);
              const theyFollowBack = followers.includes(addr);
              return (
                <div key={addr} className="bg-white rounded-2xl border border-[#E2E8F0] p-4 animate-fade-in">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => navigateToProfile(addr)} className="flex-shrink-0 cursor-pointer">
                    {profile?.avatarUrl ? (
                      <img src={profile.avatarUrl} onError={handleIpfsImgError} alt="" className="w-11 h-11 rounded-full object-cover border-2 border-white shadow-sm flex-shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#EBF4FF] to-[#E0F2FE] flex items-center justify-center text-sm font-semibold text-[#2563EB] border-2 border-white shadow-sm flex-shrink-0">
                        {name.charAt(0)?.toUpperCase() || "?"}
                      </div>
                    )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => navigateToProfile(addr)} className="font-semibold text-[#1A1A2E] text-sm truncate hover:text-[#2563EB] transition-colors cursor-pointer">{name}</button>
                        <span className="text-xs text-[#94A3B8]">@{username}</span>
                        {theyFollowBack && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#F0FDF4] text-[#16A34A] font-medium">Mutual</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-[#2563EB] bg-[#EFF6FF] px-1.5 py-0.5 rounded-full">
                          <Globe className="w-2 h-2" /> on-chain
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnfollow(addr)}
                      disabled={unfollowingUser === addr}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#64748B] bg-[#F1F5F9] hover:text-[#DC2626] hover:bg-[#FEF2F2] px-3 py-2 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                      {unfollowingUser === addr ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <UserMinus className="w-3.5 h-3.5" />
                      )}
                      {unfollowingUser === addr ? "Unfollowing..." : "Unfollow"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Followers Section */}
      {activeSection === "followers" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#1A1A2E]">Followers</h3>
            <button
              onClick={fetchFollowData}
              disabled={loading}
              className="flex items-center gap-1 text-xs text-[#2563EB] hover:text-[#1D4ED8] disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {followers.length === 0 ? (
            <div className="bg-[#F8FAFC] rounded-xl p-6 text-center border border-[#E2E8F0]">
              <Users className="w-8 h-8 text-[#94A3B8] mx-auto mb-2" />
              <p className="text-sm text-[#94A3B8]">No followers yet</p>
              <p className="text-xs text-[#CBD5E1] mt-1">When someone follows you, they&apos;ll appear here</p>
            </div>
          ) : (
            followers.map((addr) => {
              const profile = profileMap[addr];
              const name = profile?.displayName || addr.slice(0, 4) + "..." + addr.slice(-4);
              const username = profile?.username || addr.slice(0, 8);
              const iFollowThem = following.includes(addr);
              return (
                <div key={addr} className="bg-white rounded-2xl border border-[#E2E8F0] p-4 animate-fade-in">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => navigateToProfile(addr)} className="flex-shrink-0 cursor-pointer">
                    {profile?.avatarUrl ? (
                      <img src={profile.avatarUrl} onError={handleIpfsImgError} alt="" className="w-11 h-11 rounded-full object-cover border-2 border-white shadow-sm flex-shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#F0FDF4] to-[#DCFCE7] flex items-center justify-center text-sm font-semibold text-[#16A34A] border-2 border-white shadow-sm flex-shrink-0">
                        {name.charAt(0)?.toUpperCase() || "?"}
                      </div>
                    )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => navigateToProfile(addr)} className="font-semibold text-[#1A1A2E] text-sm truncate hover:text-[#2563EB] transition-colors cursor-pointer">{name}</button>
                        <span className="text-xs text-[#94A3B8]">@{username}</span>
                        {iFollowThem && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#F0FDF4] text-[#16A34A] font-medium">Mutual</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-[#94A3B8]">Follows you</span>
                      </div>
                    </div>
                    {iFollowThem ? (
                      <button
                        onClick={() => handleUnfollow(addr)}
                        disabled={unfollowingUser === addr}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#64748B] bg-[#F1F5F9] hover:text-[#DC2626] hover:bg-[#FEF2F2] px-3 py-2 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                      >
                        {unfollowingUser === addr ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <UserCheck className="w-3.5 h-3.5" />
                        )}
                        {unfollowingUser === addr ? "..." : "Following"}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleFollow(addr)}
                        disabled={followingUser === addr}
                        className="inline-flex items-center gap-1 text-xs font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] px-3 py-2 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                      >
                        {followingUser === addr ? (
                          <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Following...</>
                        ) : (
                          <><UserPlus className="w-3.5 h-3.5" /> Follow Back</>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
