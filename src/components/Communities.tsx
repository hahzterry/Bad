"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, Plus, LogIn, LogOut, RefreshCw, Crown, Search, X, Image as ImageIcon, Send, Globe, Trash2, Edit3, Upload, Loader2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { toast } from "@/components/Toast";
import { useProgram } from "@/hooks/useProgram";
import { useWallet } from "@/hooks/usePrivyWallet";
import { uploadImage, handleIpfsImgError } from "@/components/RichContent";
import { clearRpcCache } from "@/lib/program";
import { OnChainPostCard, parseCommunityPost } from "@/components/Feed";
import type { ShyftClient } from "@/lib/program";

interface CommunityData {
  pubkey: string;
  creator: string;
  communityId: number;
  name: string;
  description: string;
  avatarUrl: string;
  memberCount: number;
  createdAt: number;
}

interface MembershipData {
  community: string; // community PDA pubkey
  member: string;
  joinedAt: number;
}

export default function Communities() {
  const { isConnected } = useAppStore();
  const program = useProgram();
  const { publicKey } = useWallet();

  const [communities, setCommunities] = useState<CommunityData[]>([]);
  const [memberships, setMemberships] = useState<MembershipData[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState<number | null>(null);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCommunity, setSelectedCommunity] = useState<CommunityData | null>(null);

  // Create form
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAvatarUrl, setNewAvatarUrl] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Edit form
  const [showEdit, setShowEdit] = useState(false);
  const [editDescription, setEditDescription] = useState("");
  const [editAvatarUrl, setEditAvatarUrl] = useState("");
  const [editingCommunity, setEditingCommunity] = useState<CommunityData | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingEditAvatar, setUploadingEditAvatar] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const walletAddr = publicKey?.toBase58() || "";

  const fetchData = useCallback(async () => {
    if (!program) return;
    setLoading(true);
    clearRpcCache();
    try {
      const [comms, membs, profiles] = await Promise.all([
        program.getAllCommunities(),
        program.getAllMemberships(),
        program.getAllProfiles(),
      ]);
      setCommunities(comms);
      setMemberships(membs);
      const pMap: Record<string, any> = {};
      for (const p of profiles) {
        pMap[p.owner] = p;
      }
      setProfileMap(pMap);
    } catch (err) {
      console.error("Failed to fetch communities:", err);
    }
    setLoading(false);
  }, [program]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const myMemberships = memberships.filter((m) => m.member === walletAddr);
  const isMemberOf = (communityPubkey: string) => myMemberships.some((m) => m.community === communityPubkey);
  const isCreatorOf = (community: CommunityData) => community.creator === walletAddr;

  const getMembersOf = (communityPubkey: string) =>
    memberships.filter((m) => m.community === communityPubkey);

  const filteredCommunities = communities.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = async () => {
    if (!program || !newName.trim()) return;
    setCreating(true);
    try {
      const communityId = Date.now();
      await program.createCommunity(communityId, newName.trim(), newDescription.trim(), newAvatarUrl.trim());
      toast("success", `Community "${newName}" created!`);
      setNewName("");
      setNewDescription("");
      setNewAvatarUrl("");
      setShowCreate(false);
      await fetchData();
    } catch (err: any) {
      console.error("Create community error:", err);
      toast("error", err?.message?.includes("rejected") ? "Transaction rejected" : "Failed to create community");
    }
    setCreating(false);
  };

  const handleJoin = async (community: CommunityData) => {
    if (!program) return;
    setJoining(community.communityId);
    try {
      await program.joinCommunity(community.communityId);
      toast("success", `Joined "${community.name}"!`);
      await fetchData();
    } catch (err: any) {
      console.error("Join error:", err);
      if (err?.message?.includes("already in use")) {
        toast("error", "Already a member!");
      } else {
        toast("error", err?.message?.includes("rejected") ? "Transaction rejected" : "Failed to join");
      }
    }
    setJoining(null);
  };

  const handleLeave = async (community: CommunityData) => {
    if (!program) return;
    setLeaving(community.communityId);
    try {
      await program.leaveCommunity(community.communityId);
      toast("success", `Left "${community.name}"`);
      if (selectedCommunity?.communityId === community.communityId) {
        setSelectedCommunity(null);
      }
      await fetchData();
    } catch (err: any) {
      console.error("Leave error:", err);
      toast("error", err?.message?.includes("rejected") ? "Transaction rejected" : "Failed to leave");
    }
    setLeaving(null);
  };

  const handleUploadAvatar = async (file: File, setUrl: (url: string) => void, setUploading: (v: boolean) => void) => {
    if (!file.type.startsWith("image/")) {
      toast("error", "Please select an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast("error", "Image must be under 5MB");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadImage(file);
      setUrl(url);
      toast("success", "Image uploaded!");
    } catch (err: any) {
      console.error("Upload error:", err);
      toast("error", "Failed to upload image");
    }
    setUploading(false);
  };

  const openEdit = (community: CommunityData) => {
    setEditingCommunity(community);
    setEditDescription(community.description || "");
    setEditAvatarUrl(community.avatarUrl || "");
    setConfirmDelete(false);
    setShowEdit(true);
  };

  const handleSaveEdit = async () => {
    if (!program || !editingCommunity) return;
    setSaving(true);
    try {
      await program.updateCommunity(editingCommunity.communityId, editDescription.trim(), editAvatarUrl.trim());
      toast("success", "Community updated!");
      setShowEdit(false);
      setEditingCommunity(null);
      // Update selectedCommunity if we're editing the currently viewed one
      if (selectedCommunity?.communityId === editingCommunity.communityId) {
        setSelectedCommunity({ ...selectedCommunity, description: editDescription.trim(), avatarUrl: editAvatarUrl.trim() });
      }
      await fetchData();
    } catch (err: any) {
      console.error("Update community error:", err);
      toast("error", err?.message?.includes("rejected") ? "Transaction rejected" : "Failed to update community");
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!program || !editingCommunity) return;
    setDeleting(true);
    try {
      await program.closeCommunity(editingCommunity.communityId);
      toast("success", `Community "${editingCommunity.name}" deleted`);
      setShowEdit(false);
      setEditingCommunity(null);
      setConfirmDelete(false);
      if (selectedCommunity?.communityId === editingCommunity.communityId) {
        setSelectedCommunity(null);
      }
      await fetchData();
    } catch (err: any) {
      console.error("Delete community error:", err);
      toast("error", err?.message?.includes("rejected") ? "Transaction rejected" : "Failed to delete community");
    }
    setDeleting(false);
  };

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // ========== Detail View ==========
  if (selectedCommunity) {
    const members = getMembersOf(selectedCommunity.pubkey);
    const isMember = isMemberOf(selectedCommunity.pubkey);
    const isCreator = isCreatorOf(selectedCommunity);

    return (
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Back button */}
        <button
          onClick={() => setSelectedCommunity(null)}
          className="text-sm text-[#64748B] hover:text-[#1A1A2E] flex items-center gap-1 transition-colors"
        >
          ← Back to Communities
        </button>

        {/* Community Header */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#2563EB] to-[#7C3AED] flex items-center justify-center text-white text-2xl font-bold overflow-hidden shrink-0">
              {selectedCommunity.avatarUrl ? (
                <img src={selectedCommunity.avatarUrl} onError={handleIpfsImgError} alt="" className="w-full h-full object-cover" />
              ) : (
                selectedCommunity.name.charAt(0).toUpperCase()
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-[#1A1A2E] truncate">{selectedCommunity.name}</h2>
                {isCreator && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-[#FEF3C7] text-[#B45309] px-2 py-0.5 rounded-full">
                    <Crown className="w-3 h-3" /> Creator
                  </span>
                )}
              </div>
              <p className="text-sm text-[#64748B] mt-1">{selectedCommunity.description || "No description"}</p>
              <div className="flex items-center gap-4 mt-3 text-xs text-[#94A3B8]">
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {selectedCommunity.memberCount} member{selectedCommunity.memberCount !== 1 ? "s" : ""}</span>
                <span>Created {timeAgo(selectedCommunity.createdAt)}</span>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              {isCreator && (
                <button
                  onClick={() => openEdit(selectedCommunity)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-[#F1F5F9] text-[#64748B] rounded-xl hover:bg-[#E2E8F0] transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5" /> Edit
                </button>
              )}
              {isMember ? (
                <button
                  onClick={() => handleLeave(selectedCommunity)}
                  disabled={leaving === selectedCommunity.communityId || isCreator}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#FEE2E2] text-[#DC2626] rounded-xl hover:bg-[#FECACA] transition-colors disabled:opacity-50"
                  title={isCreator ? "Creator cannot leave" : "Leave community"}
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {leaving === selectedCommunity.communityId ? "Leaving..." : "Leave"}
                </button>
              ) : (
                <button
                  onClick={() => handleJoin(selectedCommunity)}
                  disabled={joining === selectedCommunity.communityId}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#2563EB] text-white rounded-xl hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  {joining === selectedCommunity.communityId ? "Joining..." : "Join"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Community Feed — only for members */}
        {isMember ? (
          <CommunityFeed
            community={selectedCommunity}
            program={program}
            profileMap={profileMap}
            walletAddr={walletAddr}
          />
        ) : (
          <div className="text-center py-12 bg-white rounded-2xl border border-[#E2E8F0]">
            <Users className="w-10 h-10 text-[#94A3B8] mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#1A1A2E]">Members Only</p>
            <p className="text-xs text-[#94A3B8] mt-1">Join this community to see posts and start posting</p>
          </div>
        )}

        {/* Members List */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4">
          <h3 className="text-sm font-semibold text-[#1A1A2E] mb-3">Members ({members.length})</h3>
          {members.length === 0 ? (
            <p className="text-sm text-[#94A3B8] text-center py-4">No members yet</p>
          ) : (
            <div className="space-y-2">
              {members.map((m) => {
                const profile = profileMap[m.member];
                const isOwner = m.member === selectedCommunity.creator;
                return (
                  <div key={m.member} className="flex items-center gap-3 p-2 rounded-xl hover:bg-[#F8FAFC] transition-colors">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#2563EB] to-[#16A34A] flex items-center justify-center text-white text-xs font-bold overflow-hidden">
                      {profile?.avatarUrl ? (
                        <img src={profile.avatarUrl} onError={handleIpfsImgError} alt="" className="w-full h-full object-cover" />
                      ) : (
                        (profile?.username || m.member.slice(0, 2)).charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-[#1A1A2E] truncate">
                          {profile?.displayName || profile?.username || m.member.slice(0, 8) + "..."}
                        </span>
                        {isOwner && <Crown className="w-3.5 h-3.5 text-[#F59E0B]" />}
                      </div>
                      <span className="text-xs text-[#94A3B8]">
                        @{profile?.username || m.member.slice(0, 8)}
                      </span>
                    </div>
                    <span className="text-[10px] text-[#94A3B8]">{timeAgo(m.joinedAt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Edit Community Modal (rendered in detail view) */}
        {showEdit && editingCommunity && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={() => { setShowEdit(false); setConfirmDelete(false); }}>
            <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-[#1A1A2E]">Edit Community</h3>
                <button onClick={() => { setShowEdit(false); setConfirmDelete(false); }} className="p-1 rounded-lg hover:bg-[#F1F5F9]">
                  <X className="w-5 h-5 text-[#64748B]" />
                </button>
              </div>

              <div className="flex items-center gap-3 p-3 bg-[#F8FAFC] rounded-xl">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#2563EB] to-[#7C3AED] flex items-center justify-center text-white font-bold overflow-hidden shrink-0">
                  {editAvatarUrl ? <img src={editAvatarUrl} alt="" className="w-full h-full object-cover" /> : editingCommunity.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-bold text-[#1A1A2E]">{editingCommunity.name}</p>
                  <p className="text-[10px] text-[#94A3B8]">ID: {editingCommunity.communityId}</p>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#64748B] mb-1 block">Description</label>
                <textarea
                  placeholder="What's this community about?"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value.slice(0, 128))}
                  rows={3}
                  className="w-full px-4 py-2.5 text-sm bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] text-[#1A1A2E] placeholder-[#94A3B8] resize-none"
                />
                <p className="text-[10px] text-[#94A3B8] mt-1">{editDescription.length}/128</p>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#64748B] mb-1 block">Community Avatar</label>
                <div className="flex items-center gap-3">
                  {editAvatarUrl ? (
                    <div className="w-14 h-14 rounded-xl overflow-hidden border border-[#E2E8F0] shrink-0">
                      <img src={editAvatarUrl} alt="" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-[#F1F5F9] border border-dashed border-[#CBD5E1] flex items-center justify-center shrink-0">
                      <ImageIcon className="w-5 h-5 text-[#94A3B8]" />
                    </div>
                  )}
                  <div className="flex-1 space-y-1.5">
                    <label className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl hover:bg-[#F1F5F9] transition-colors cursor-pointer">
                      {uploadingEditAvatar ? (
                        <><Loader2 className="w-4 h-4 text-[#2563EB] animate-spin" /> Uploading...</>
                      ) : (
                        <><Upload className="w-4 h-4 text-[#64748B]" /> {editAvatarUrl ? "Change image" : "Upload image"}</>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingEditAvatar}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadAvatar(file, setEditAvatarUrl, setUploadingEditAvatar);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {editAvatarUrl && (
                      <button onClick={() => setEditAvatarUrl("")} className="text-[10px] text-[#DC2626] hover:underline">Remove</button>
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="w-full py-3 text-sm font-semibold bg-[#2563EB] text-white rounded-xl hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>

              {/* Delete Section */}
              <div className="border-t border-[#E2E8F0] pt-4">
                {confirmDelete ? (
                  <div className="space-y-2">
                    <p className="text-xs text-[#DC2626] font-semibold">Are you sure? This will permanently delete the community and return rent to treasury.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleDelete}
                        disabled={deleting}
                        className="flex-1 py-2.5 text-sm font-semibold bg-[#DC2626] text-white rounded-xl hover:bg-[#B91C1C] transition-colors disabled:opacity-50"
                      >
                        {deleting ? "Deleting..." : "Yes, Delete"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 py-2.5 text-sm font-semibold bg-[#F1F5F9] text-[#64748B] rounded-xl hover:bg-[#E2E8F0] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-[#DC2626] bg-[#FEF2F2] rounded-xl hover:bg-[#FEE2E2] transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> Delete Community
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ========== Main List View ==========
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[#1A1A2E]">Communities</h2>
          <p className="text-xs text-[#94A3B8]">On-chain communities — max 100 members each</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-xl text-[#64748B] hover:bg-[#F1F5F9] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#2563EB] text-white rounded-xl hover:bg-[#1D4ED8] transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" /> Create
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
        <input
          type="text"
          placeholder="Search communities..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] text-[#1A1A2E] placeholder-[#94A3B8]"
        />
      </div>

      {/* My Communities */}
      {myMemberships.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#94A3B8] mb-2">My Communities</p>
          <div className="space-y-2">
            {communities
              .filter((c) => isMemberOf(c.pubkey))
              .map((c) => (
                <CommunityCard
                  key={c.communityId}
                  community={c}
                  isMember={true}
                  isCreator={isCreatorOf(c)}
                  joining={joining === c.communityId}
                  leaving={leaving === c.communityId}
                  onJoin={() => handleJoin(c)}
                  onLeave={() => handleLeave(c)}
                  onClick={() => setSelectedCommunity(c)}
                  creatorProfile={profileMap[c.creator]}
                />
              ))}
          </div>
        </div>
      )}

      {/* All Communities */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#94A3B8] mb-2">
          {myMemberships.length > 0 ? "Discover" : "All Communities"}
        </p>
        {loading ? (
          <div className="text-center py-12">
            <RefreshCw className="w-6 h-6 text-[#94A3B8] animate-spin mx-auto mb-2" />
            <p className="text-sm text-[#94A3B8]">Loading communities...</p>
          </div>
        ) : filteredCommunities.filter((c) => !isMemberOf(c.pubkey)).length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-[#E2E8F0]">
            <Users className="w-10 h-10 text-[#94A3B8] mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#1A1A2E]">
              {searchQuery ? "No communities found" : communities.length === 0 ? "No communities yet" : "You've joined them all!"}
            </p>
            <p className="text-xs text-[#94A3B8] mt-1">
              {searchQuery ? "Try a different search" : communities.length === 0 ? "Be the first to create one!" : "Create a new one?"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredCommunities
              .filter((c) => !isMemberOf(c.pubkey))
              .map((c) => (
                <CommunityCard
                  key={c.communityId}
                  community={c}
                  isMember={false}
                  isCreator={false}
                  joining={joining === c.communityId}
                  leaving={leaving === c.communityId}
                  onJoin={() => handleJoin(c)}
                  onLeave={() => handleLeave(c)}
                  onClick={() => setSelectedCommunity(c)}
                  creatorProfile={profileMap[c.creator]}
                />
              ))}
          </div>
        )}
      </div>

      {/* Edit Community Modal */}
      {showEdit && editingCommunity && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={() => { setShowEdit(false); setConfirmDelete(false); }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[#1A1A2E]">Edit Community</h3>
              <button onClick={() => { setShowEdit(false); setConfirmDelete(false); }} className="p-1 rounded-lg hover:bg-[#F1F5F9]">
                <X className="w-5 h-5 text-[#64748B]" />
              </button>
            </div>

            <div className="flex items-center gap-3 p-3 bg-[#F8FAFC] rounded-xl">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#2563EB] to-[#7C3AED] flex items-center justify-center text-white font-bold overflow-hidden shrink-0">
                {editAvatarUrl ? <img src={editAvatarUrl} alt="" className="w-full h-full object-cover" /> : editingCommunity.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-bold text-[#1A1A2E]">{editingCommunity.name}</p>
                <p className="text-[10px] text-[#94A3B8]">ID: {editingCommunity.communityId}</p>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#64748B] mb-1 block">Description</label>
              <textarea
                placeholder="What's this community about?"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value.slice(0, 128))}
                rows={3}
                className="w-full px-4 py-2.5 text-sm bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] text-[#1A1A2E] placeholder-[#94A3B8] resize-none"
              />
              <p className="text-[10px] text-[#94A3B8] mt-1">{editDescription.length}/128</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#64748B] mb-1 block">Community Avatar</label>
              <div className="flex items-center gap-3">
                {editAvatarUrl ? (
                  <div className="w-14 h-14 rounded-xl overflow-hidden border border-[#E2E8F0] shrink-0">
                    <img src={editAvatarUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-[#F1F5F9] border border-dashed border-[#CBD5E1] flex items-center justify-center shrink-0">
                    <ImageIcon className="w-5 h-5 text-[#94A3B8]" />
                  </div>
                )}
                <div className="flex-1 space-y-1.5">
                  <label className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl hover:bg-[#F1F5F9] transition-colors cursor-pointer">
                    {uploadingEditAvatar ? (
                      <><Loader2 className="w-4 h-4 text-[#2563EB] animate-spin" /> Uploading...</>
                    ) : (
                      <><Upload className="w-4 h-4 text-[#64748B]" /> {editAvatarUrl ? "Change image" : "Upload image"}</>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingEditAvatar}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadAvatar(file, setEditAvatarUrl, setUploadingEditAvatar);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {editAvatarUrl && (
                    <button onClick={() => setEditAvatarUrl("")} className="text-[10px] text-[#DC2626] hover:underline">Remove</button>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={handleSaveEdit}
              disabled={saving}
              className="w-full py-3 text-sm font-semibold bg-[#2563EB] text-white rounded-xl hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>

            {/* Delete Section */}
            <div className="border-t border-[#E2E8F0] pt-4">
              {confirmDelete ? (
                <div className="space-y-2">
                  <p className="text-xs text-[#DC2626] font-semibold">Are you sure? This will permanently delete the community and return rent to treasury.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex-1 py-2.5 text-sm font-semibold bg-[#DC2626] text-white rounded-xl hover:bg-[#B91C1C] transition-colors disabled:opacity-50"
                    >
                      {deleting ? "Deleting..." : "Yes, Delete"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="flex-1 py-2.5 text-sm font-semibold bg-[#F1F5F9] text-[#64748B] rounded-xl hover:bg-[#E2E8F0] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-[#DC2626] bg-[#FEF2F2] rounded-xl hover:bg-[#FEE2E2] transition-colors"
                >
                  <Trash2 className="w-4 h-4" /> Delete Community
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[#1A1A2E]">Create Community</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded-lg hover:bg-[#F1F5F9]">
                <X className="w-5 h-5 text-[#64748B]" />
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#64748B] mb-1 block">Name *</label>
              <input
                type="text"
                placeholder="e.g. Solana Builders"
                value={newName}
                onChange={(e) => setNewName(e.target.value.slice(0, 32))}
                className="w-full px-4 py-2.5 text-sm bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] text-[#1A1A2E] placeholder-[#94A3B8]"
              />
              <p className="text-[10px] text-[#94A3B8] mt-1">{newName.length}/32</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#64748B] mb-1 block">Description</label>
              <textarea
                placeholder="What's this community about?"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value.slice(0, 128))}
                rows={3}
                className="w-full px-4 py-2.5 text-sm bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] text-[#1A1A2E] placeholder-[#94A3B8] resize-none"
              />
              <p className="text-[10px] text-[#94A3B8] mt-1">{newDescription.length}/128</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#64748B] mb-1 block">Community Avatar (optional)</label>
              <div className="flex items-center gap-3">
                {newAvatarUrl ? (
                  <div className="w-14 h-14 rounded-xl overflow-hidden border border-[#E2E8F0] shrink-0">
                    <img src={newAvatarUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-[#F1F5F9] border border-dashed border-[#CBD5E1] flex items-center justify-center shrink-0">
                    <ImageIcon className="w-5 h-5 text-[#94A3B8]" />
                  </div>
                )}
                <div className="flex-1 space-y-1.5">
                  <label className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl hover:bg-[#F1F5F9] transition-colors cursor-pointer">
                    {uploadingAvatar ? (
                      <><Loader2 className="w-4 h-4 text-[#2563EB] animate-spin" /> Uploading...</>
                    ) : (
                      <><Upload className="w-4 h-4 text-[#64748B]" /> {newAvatarUrl ? "Change image" : "Upload image"}</>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingAvatar}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadAvatar(file, setNewAvatarUrl, setUploadingAvatar);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {newAvatarUrl && (
                    <button onClick={() => setNewAvatarUrl("")} className="text-[10px] text-[#DC2626] hover:underline">Remove</button>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl p-3">
              <p className="text-xs text-[#16A34A] font-medium">✨ Free to create — sponsored by Shyft</p>
              <p className="text-[10px] text-[#64748B] mt-0.5">Max 100 members per community. You&apos;ll auto-join as the first member.</p>
            </div>

            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="w-full py-3 text-sm font-semibold bg-[#2563EB] text-white rounded-xl hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? "Creating..." : "Create Community"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ========== Community Feed (posts within a community) ==========

function CommunityFeed({
  community,
  program,
  profileMap,
  walletAddr,
}: {
  community: CommunityData;
  program: ShyftClient | null;
  profileMap: Record<string, any>;
  walletAddr: string;
}) {
  const [posts, setPosts] = useState<any[]>([]);
  const [allComments, setAllComments] = useState<any[]>([]);
  const [allReactions, setAllReactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [newPost, setNewPost] = useState("");
  const [posting, setPosting] = useState(false);

  const fetchPosts = useCallback(async () => {
    if (!program) return;
    setLoading(true);
    try {
      clearRpcCache();
      const [allPosts, comments, reactions] = await Promise.all([
        program.getAllPosts(),
        program.getAllComments(),
        program.getAllReactions(),
      ]);
      setAllComments(comments);
      setAllReactions(reactions);

      // Filter to only this community's posts
      const communityPosts = allPosts.filter((p: any) => {
        const parsed = parseCommunityPost(p.content);
        return parsed.isCommunity && parsed.communityId === community.communityId;
      });

      setPosts(communityPosts.sort((a: any, b: any) => Number(b.createdAt) - Number(a.createdAt)));
    } catch (err) {
      console.error("Failed to fetch community posts:", err);
    }
    setLoading(false);
  }, [program, community.communityId]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Auto-refresh every 8s
  useEffect(() => {
    if (!program) return;
    const interval = setInterval(fetchPosts, 8_000);
    return () => clearInterval(interval);
  }, [program, fetchPosts]);

  const handlePost = async () => {
    if (!newPost.trim() || posting || !program) return;
    setPosting(true);
    try {
      const postId = Date.now();
      // Prefix with COMM|communityId| so it's tagged to this community
      const content = `COMM|${community.communityId}|${newPost.trim()}`;
      await program.createPost(postId, content, false);
      toast("success", "Posted to community!");
      setNewPost("");
      setTimeout(() => fetchPosts(), 1500);
    } catch (err: any) {
      console.error("Community post error:", err);
      toast("error", err?.message?.includes("rejected") ? "Transaction rejected" : "Failed to post");
    }
    setPosting(false);
  };

  return (
    <div className="space-y-3">
      {/* Composer */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4">
        <div className="flex items-center gap-2 mb-2">
          <Globe className="w-4 h-4 text-[#7C3AED]" />
          <span className="text-xs font-semibold text-[#7C3AED]">Post to {community.name}</span>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            placeholder={`What's happening in ${community.name}?`}
            value={newPost}
            onChange={(e) => setNewPost(e.target.value.slice(0, 480))}
            rows={2}
            className="flex-1 px-3 py-2 text-sm bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20 focus:border-[#7C3AED] text-[#1A1A2E] placeholder-[#94A3B8] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handlePost();
              }
            }}
          />
          <button
            onClick={handlePost}
            disabled={posting || !newPost.trim()}
            className="px-4 py-2 text-sm font-semibold bg-[#7C3AED] text-white rounded-xl hover:bg-[#6D28D9] transition-colors disabled:opacity-50 shrink-0"
          >
            {posting ? "..." : <Send className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-[10px] text-[#94A3B8] mt-1 text-right">{newPost.length}/480</p>
      </div>

      {/* Posts */}
      {loading && posts.length === 0 ? (
        <div className="text-center py-8">
          <RefreshCw className="w-5 h-5 text-[#94A3B8] animate-spin mx-auto mb-2" />
          <p className="text-xs text-[#94A3B8]">Loading posts...</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-8 bg-white rounded-2xl border border-[#E2E8F0]">
          <p className="text-sm font-semibold text-[#1A1A2E]">No posts yet</p>
          <p className="text-xs text-[#94A3B8] mt-1">Be the first to post in {community.name}!</p>
        </div>
      ) : (
        posts.map((post: any) => {
          // Strip the COMM|id| prefix for display
          const { actualContent } = parseCommunityPost(post.content);
          const displayPost = { ...post, content: actualContent };
          const profile = profileMap[post.author];
          const isMe = post.author === walletAddr;

          return (
            <div key={post.publicKey} className="relative">
              {/* Community badge */}
              <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-[#7C3AED]/10 text-[#7C3AED] px-2 py-0.5 rounded-full">
                <Globe className="w-3 h-3" />
                <span className="text-[10px] font-semibold">{community.name}</span>
              </div>
              <OnChainPostCard
                post={displayPost}
                profile={profile}
                isMe={isMe}
                program={program}
                allComments={allComments}
                allReactions={allReactions}
                profileMap={profileMap}
                onCommentAdded={fetchPosts}
                onReactionAdded={fetchPosts}
                onRepost={() => {}}
                onDelete={fetchPosts}
              />
            </div>
          );
        })
      )}
    </div>
  );
}

// ========== Community Card Component ==========

function CommunityCard({
  community,
  isMember,
  isCreator,
  joining,
  leaving,
  onJoin,
  onLeave,
  onClick,
  creatorProfile,
}: {
  community: CommunityData;
  isMember: boolean;
  isCreator: boolean;
  joining: boolean;
  leaving: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onClick: () => void;
  creatorProfile?: any;
}) {
  return (
    <div
      className="bg-white rounded-2xl border border-[#E2E8F0] p-4 hover:border-[#2563EB]/30 hover:shadow-sm transition-all cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#2563EB] to-[#7C3AED] flex items-center justify-center text-white text-lg font-bold overflow-hidden shrink-0">
          {community.avatarUrl ? (
            <img src={community.avatarUrl} onError={handleIpfsImgError} alt="" className="w-full h-full object-cover" />
          ) : (
            community.name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-bold text-[#1A1A2E] truncate">{community.name}</h3>
            {isCreator && <Crown className="w-3.5 h-3.5 text-[#F59E0B]" />}
          </div>
          <p className="text-xs text-[#64748B] truncate">{community.description || "No description"}</p>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-[#94A3B8]">
            <span className="flex items-center gap-0.5"><Users className="w-3 h-3" /> {community.memberCount}/100</span>
            <span>by @{creatorProfile?.username || community.creator.slice(0, 8)}</span>
          </div>
        </div>
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          {isMember ? (
            <button
              onClick={onLeave}
              disabled={leaving || isCreator}
              className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold bg-[#F1F5F9] text-[#64748B] rounded-lg hover:bg-[#FEE2E2] hover:text-[#DC2626] transition-colors disabled:opacity-50"
              title={isCreator ? "Creator cannot leave" : "Leave"}
            >
              {leaving ? "..." : "Joined ✓"}
            </button>
          ) : (
            <button
              onClick={onJoin}
              disabled={joining || community.memberCount >= 100}
              className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
            >
              {joining ? "..." : community.memberCount >= 100 ? "Full" : "Join"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
