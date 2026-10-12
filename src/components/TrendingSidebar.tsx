"use client";

import { useState, useEffect } from "react";
import { TrendingUp, Heart, MessageCircle, Flame, Users } from "lucide-react";
import { useProgram } from "@/hooks/useProgram";
import { useWallet } from "@/hooks/usePrivyWallet";
import ProfileHoverCard from "@/components/ProfileHoverCard";
import { handleIpfsImgError } from "@/components/RichContent";
import { useAppStore } from "@/lib/store";

/** Parse paid post prefix */
function parsePaidContent(content: string): string {
  if (content.startsWith("PAID|")) {
    const secondPipe = content.indexOf("|", content.indexOf("|") + 1);
    if (secondPipe !== -1) return content.substring(secondPipe + 1);
  }
  return content;
}

/** Strip media URLs and clean up post text for preview */
function getPreviewText(content: string): string {
  let text = parsePaidContent(content);
  // Remove URLs
  text = text.replace(/https?:\/\/\S+/g, "").trim();
  // Remove REPOST| prefix
  if (text.startsWith("REPOST|")) {
    const pipe = text.indexOf("|", 7);
    text = pipe !== -1 ? "🔁 " + text.substring(pipe + 1) : text;
  }
  return text.slice(0, 80) + (text.length > 80 ? "…" : "");
}

interface TrendingPost {
  publicKey: string;
  author: string;
  content: string;
  likes: number;
  commentCount: number;
  createdAt: number;
  score: number;
}

export default function TrendingSidebar() {
  const program = useProgram();
  const { publicKey } = useWallet();
  const { navigateToProfile } = useAppStore();
  const [trending, setTrending] = useState<TrendingPost[]>([]);
  const [topCreators, setTopCreators] = useState<any[]>([]);
  const [stats, setStats] = useState({ posts: 0, users: 0, polls: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!program || !publicKey) return;
    let cancelled = false;

    const fetch = async () => {
      try {
        const [posts, profiles, polls] = await Promise.all([
          program.getAllPosts(),
          program.getAllProfiles(),
          program.getAllPolls(),
        ]);

        if (cancelled) return;

        // Filter out community posts
        const publicPosts = posts.filter(
          (p: any) => !p.content.startsWith("COMM|") && (!p.isPrivate || p.content.startsWith("PAID|"))
        );

        // Score posts: likes + comments*2
        const scored: TrendingPost[] = publicPosts.map((p: any) => {
          const likes = parseInt(p.likes) || 0;
          const comments = parseInt(p.commentCount) || 0;
          return {
            publicKey: p.publicKey,
            author: p.author,
            content: p.content,
            likes,
            commentCount: comments,
            createdAt: Number(p.createdAt),
            score: likes + comments * 2,
          };
        });

        // Top 5 by score (must have at least some engagement, or just top 5)
        const sorted = scored.sort((a, b) => b.score - a.score).slice(0, 5);
        setTrending(sorted);

        // Top creators by follower count
        const profileMap: Record<string, any> = {};
        profiles.forEach((p: any) => { profileMap[p.owner] = p; });

        const creators = profiles
          .filter((p: any) => p.owner !== publicKey?.toBase58())
          .sort((a: any, b: any) => (parseInt(b.followerCount || "0") || 0) - (parseInt(a.followerCount || "0") || 0))
          .slice(0, 5);
        setTopCreators(creators);

        setStats({
          posts: publicPosts.length,
          users: profiles.length,
          polls: polls.length,
        });
      } catch (err) {
        console.error("Trending fetch error:", err);
      }
      if (!cancelled) setLoading(false);
    };

    fetch();
    // Refresh every 60s
    const interval = setInterval(fetch, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [program, publicKey]);

  const scrollToPost = (postKey: string) => {
    const el = document.getElementById(`post-${postKey}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-[#2563EB]", "ring-offset-2");
      setTimeout(() => el.classList.remove("ring-2", "ring-[#2563EB]", "ring-offset-2"), 2500);
    }
  };

  if (loading) {
    return (
      <div className="w-72 flex-shrink-0 space-y-4">
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 animate-pulse">
          <div className="h-5 bg-[#F1F5F9] rounded w-32 mb-4" />
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 bg-[#F1F5F9] rounded w-full" />
                <div className="h-3 bg-[#F1F5F9] rounded w-2/3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-72 flex-shrink-0 space-y-4">
      {/* Trending Posts */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#F1F5F9] bg-gradient-to-r from-orange-50 to-amber-50">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-bold text-[#1A1A2E]">Trending</span>
          </div>
        </div>
        <div className="divide-y divide-[#F1F5F9]">
          {trending.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-[#94A3B8]">No trending posts yet</p>
            </div>
          ) : (
            trending.map((post, idx) => {
              const preview = getPreviewText(post.content);
              if (!preview) return null;
              return (
                <button
                  key={post.publicKey}
                  onClick={() => scrollToPost(post.publicKey)}
                  className="w-full text-left px-4 py-3 hover:bg-[#F8FAFC] transition-colors group"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-xs font-bold text-[#94A3B8] mt-0.5 w-4 flex-shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-[#1A1A2E] leading-snug line-clamp-2 group-hover:text-[#2563EB] transition-colors">
                        {preview}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="flex items-center gap-1 text-[11px] text-[#94A3B8]">
                          <Heart className="w-3 h-3" />
                          {post.likes}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-[#94A3B8]">
                          <MessageCircle className="w-3 h-3" />
                          {post.commentCount}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Who to Follow */}
      {topCreators.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#F1F5F9] bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#2563EB]" />
              <span className="text-sm font-bold text-[#1A1A2E]">Who to Follow</span>
            </div>
          </div>
          <div className="divide-y divide-[#F1F5F9]">
            {topCreators.slice(0, 4).map((creator: any) => (
              <ProfileHoverCard
                key={creator.owner}
                walletAddress={creator.owner}
                profile={creator}
                wrapperClassName="block w-full"
              >
                <div
                  onClick={() => navigateToProfile(creator.owner)}
                  className="px-4 py-2.5 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    {creator.avatarUrl ? (
                      <img src={creator.avatarUrl} onError={handleIpfsImgError} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#EBF4FF] to-[#DBEAFE] flex items-center justify-center text-xs font-bold text-[#2563EB] flex-shrink-0">
                        {(creator.displayName || creator.username || "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-[#1A1A2E] truncate">
                        {creator.displayName || creator.username}
                      </p>
                      <p className="text-[11px] text-[#94A3B8] truncate">
                        @{creator.username}
                      </p>
                    </div>
                    <span className="text-[10px] text-[#94A3B8] flex-shrink-0">
                      {parseInt(creator.followerCount || "0") || 0} followers
                    </span>
                  </div>
                </div>
              </ProfileHoverCard>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
