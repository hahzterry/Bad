"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MessageCircle, Send, Lock, Loader2 } from "lucide-react";
import { useWallet } from "@/hooks/usePrivyWallet";
import { useAppStore } from "@/lib/store";

interface Comment {
  id: string;
  wallet: string;
  username?: string;
  text: string;
  timestamp: number;
}

export default function TokenChat({ mint, symbol }: { mint: string; symbol: string }) {
  const { publicKey } = useWallet();
  const { currentUser } = useAppStore();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [text, setText] = useState("");
  const [locked, setLocked] = useState(false);
  const [userBalance, setUserBalance] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchComments = useCallback(async () => {
    if (!publicKey) { setLocked(true); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/token-chat?mint=${mint}&wallet=${publicKey.toBase58()}`);
      const data = await res.json();
      if (res.status === 403) {
        setLocked(true);
        setUserBalance(data.balance || 0);
      } else if (data.success) {
        setComments(data.comments);
        setLocked(false);
      }
    } catch (e) {
      console.error("[TokenChat]", e);
    }
    setLoading(false);
  }, [mint, publicKey]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  const handlePost = async () => {
    if (!publicKey || !text.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch("/api/token-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mint,
          wallet: publicKey.toBase58(),
          username: currentUser?.username,
          text: text.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setComments((prev) => [...prev, data.comment]);
        setText("");
      }
    } catch (e) {
      console.error("[TokenChat post]", e);
    }
    setPosting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 text-[#2563EB] animate-spin" />
      </div>
    );
  }

  if (!publicKey) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Lock className="w-8 h-8 text-[#94A3B8] mb-3" />
        <p className="text-sm font-medium text-[#475569]">Connect your wallet</p>
        <p className="text-xs text-[#94A3B8] mt-1">to join the holders chat</p>
      </div>
    );
  }

  if (locked) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#FFFBEB] flex items-center justify-center mx-auto mb-3">
          <Lock className="w-7 h-7 text-[#D97706]" />
        </div>
        <p className="text-sm font-semibold text-[#1A1A2E]">Holders Only</p>
        <p className="text-xs text-[#64748B] mt-2">
          Hold at least{" "}
          <span className="font-semibold text-[#D97706]">100,000 ${symbol}</span>{" "}
          to join this chat
        </p>
        {userBalance > 0 && (
          <p className="text-xs text-[#94A3B8] mt-1">
            Your balance: {userBalance.toLocaleString()} ${symbol}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: "320px" }}>
      <div className="flex-1 overflow-y-auto space-y-3 mb-3 pr-1">
        {comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <MessageCircle className="w-8 h-8 text-[#CBD5E1] mb-2" />
            <p className="text-xs text-[#94A3B8]">No messages yet. Be the first!</p>
          </div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex gap-2 items-start">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#2563EB] to-[#7C3AED] flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-bold text-white">
                  {(c.username || c.wallet)[0].toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-semibold text-[#1A1A2E]">
                    {c.username || `${c.wallet.slice(0, 4)}...${c.wallet.slice(-4)}`}
                  </span>
                  <span className="text-[10px] text-[#94A3B8]">
                    {new Date(c.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="text-xs text-[#475569] break-words">{c.text}</p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 items-center border-t border-[#E2E8F0] pt-3">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
          placeholder={`Message $${symbol} holders...`}
          maxLength={280}
          className="flex-1 text-xs bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2563EB] text-[#1A1A2E] placeholder-[#94A3B8]"
        />
        <button
          onClick={handlePost}
          disabled={!text.trim() || posting}
          className="p-2 bg-[#2563EB] text-white rounded-xl hover:bg-[#1D4ED8] transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
