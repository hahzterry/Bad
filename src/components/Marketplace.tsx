"use client";

import { useCallback, useEffect, useState } from "react";
import { Tag, ShoppingBag, RefreshCw, X, Check, Loader2 } from "lucide-react";
import { useProgram } from "@/hooks/useProgram";
import { useWallet } from "@/hooks/usePrivyWallet";

type Listing = { name: string; seller: string; priceShyft: number; createdAt: number };

export default function Marketplace() {
  const program = useProgram();
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58();

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  // "List a name" form
  const [showList, setShowList] = useState(false);
  const [listName, setListName] = useState("");
  const [listPrice, setListPrice] = useState("");

  // "Claim a name" form
  const [claimName, setClaimName] = useState("");

  const load = useCallback(async () => {
    if (!program) return;
    setLoading(true);
    try {
      const rows = await program.getListings();
      rows.sort((a, b) => b.createdAt - a.createdAt);
      setListings(rows);
    } catch (e: any) {
      setNotice({ kind: "err", msg: e?.message || "Failed to load listings" });
    } finally {
      setLoading(false);
    }
  }, [program]);

  useEffect(() => { load(); }, [load]);

  const buy = async (l: Listing) => {
    if (!program) return;
    setBusy(l.name); setNotice(null);
    try {
      await program.buyUsername(l.name);
      setNotice({ kind: "ok", msg: `You bought @${l.name}!` });
      await load();
    } catch (e: any) {
      setNotice({ kind: "err", msg: e?.message || "Purchase failed" });
    } finally {
      setBusy(null);
    }
  };

  const delist = async (l: Listing) => {
    if (!program) return;
    setBusy(l.name); setNotice(null);
    try {
      await program.delistUsername(l.name);
      setNotice({ kind: "ok", msg: `@${l.name} removed from sale` });
      await load();
    } catch (e: any) {
      setNotice({ kind: "err", msg: e?.message || "Delist failed" });
    } finally {
      setBusy(null);
    }
  };

  const submitClaim = async () => {
    if (!program) return;
    const name = claimName.trim().toLowerCase();
    if (!name) { setNotice({ kind: "err", msg: "Type a name to claim" }); return; }
    setBusy("__claim"); setNotice(null);
    try {
      await program.claimUsername(name);
      setNotice({ kind: "ok", msg: `You now own @${name} — it's also your display name. You can list your other names now.` });
      setClaimName("");
    } catch (e: any) {
      const m = e?.message || "Claim failed";
      setNotice({ kind: "err", msg: m.includes("already") || m.includes("0x0") ? `@${name} is already taken` : m });
    } finally {
      setBusy(null);
    }
  };

  const submitList = async () => {
    if (!program) return;
    const name = listName.trim().toLowerCase();
    const price = parseFloat(listPrice);
    if (!name || !(price > 0)) {
      setNotice({ kind: "err", msg: "Enter a name you own and a price above 0" });
      return;
    }
    setBusy("__list"); setNotice(null);
    try {
      await program.listUsername(name, price);
      setNotice({ kind: "ok", msg: `@${name} listed for ${price} $SHYFT` });
      setShowList(false); setListName(""); setListPrice("");
      await load();
    } catch (e: any) {
      setNotice({ kind: "err", msg: e?.message || "Listing failed" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A] flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-[#6366F1]" /> Username Market
          </h1>
          <p className="text-xs text-[#64748B] mt-0.5">Buy and sell usernames, priced in $SHYFT.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} aria-label="Refresh" className="p-2 rounded-lg hover:bg-[#F1F5F9]">
            <RefreshCw className={`w-4 h-4 text-[#64748B] ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={() => setShowList((v) => !v)} className="flex items-center gap-1.5 bg-[#6366F1] text-white text-sm font-semibold px-3 py-2 rounded-lg hover:bg-[#4F46E5]">
            <Tag className="w-4 h-4" /> List a name
          </button>
        </div>
      </div>

      {notice && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-sm flex items-center justify-between ${notice.kind === "ok" ? "bg-[#F0FDF4] text-[#16A34A]" : "bg-[#FEF2F2] text-[#DC2626]"}`}>
          <span className="flex items-center gap-1.5">{notice.kind === "ok" ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}{notice.msg}</span>
          <button onClick={() => setNotice(null)}><X className="w-3.5 h-3.5 opacity-60" /></button>
        </div>
      )}

      {/* Claim a name — always visible, this is how you get a new/second name */}
      <div className="mb-4 rounded-xl border border-[#E2E8F0] bg-white p-4">
        <p className="text-sm font-semibold text-[#0F172A] mb-1">Claim a username</p>
        <p className="text-xs text-[#64748B] mb-3">
          Grab a new name (it becomes your display name). Claim a spare one first if you want to sell the name you currently use.
        </p>
        <div className="flex gap-2">
          <div className="flex items-center gap-1 flex-1 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2">
            <span className="text-[#94A3B8] text-sm">@</span>
            <input
              value={claimName}
              onChange={(e) => setClaimName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              placeholder="yourname"
              maxLength={16}
              className="flex-1 bg-transparent text-sm focus:outline-none"
            />
          </div>
          <button disabled={busy === "__claim"} onClick={submitClaim} className="flex items-center gap-1.5 bg-[#0F172A] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
            {busy === "__claim" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Claim
          </button>
        </div>
      </div>

      {/* List form */}
      {showList && (
        <div className="mb-4 rounded-xl border border-[#E2E8F0] bg-white p-4 space-y-3">
          <p className="text-sm font-semibold text-[#0F172A]">List a username you own</p>
          <p className="text-xs text-[#64748B]">
            You must be displaying a <em>different</em> name before listing this one — switch handles first if needed.
            Listing is free — no SOL needed.
          </p>
          <div className="flex gap-2">
            <div className="flex items-center gap-1 flex-1 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2">
              <span className="text-[#94A3B8] text-sm">@</span>
              <input value={listName} onChange={(e) => setListName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="name" maxLength={16} className="flex-1 bg-transparent text-sm focus:outline-none" />
            </div>
            <div className="flex items-center gap-1 w-40 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2">
              <input value={listPrice} onChange={(e) => setListPrice(e.target.value)} type="number" placeholder="price" className="flex-1 bg-transparent text-sm focus:outline-none w-full" />
              <span className="text-xs text-[#64748B]">$SHYFT</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button disabled={busy === "__list"} onClick={submitList} className="flex items-center gap-1.5 bg-[#6366F1] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
              {busy === "__list" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tag className="w-4 h-4" />} List for sale
            </button>
            <button onClick={() => setShowList(false)} className="text-sm text-[#64748B] px-3">Cancel</button>
          </div>
        </div>
      )}

      {/* Listings */}
      {loading && listings.length === 0 ? (
        <div className="text-center text-[#94A3B8] py-16 text-sm">Loading listings…</div>
      ) : listings.length === 0 ? (
        <div className="text-center py-16">
          <ShoppingBag className="w-10 h-10 text-[#CBD5E1] mx-auto mb-2" />
          <p className="text-sm text-[#64748B]">No usernames for sale yet. Be the first to list one.</p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {listings.map((l) => {
            const mine = me && l.seller === me;
            const isBusy = busy === l.name;
            return (
              <div key={l.name} className="rounded-xl border border-[#E2E8F0] bg-white p-4 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-bold text-[#0F172A] truncate">@{l.name}</p>
                  <p className="text-xs text-[#64748B] mt-0.5">{l.priceShyft.toLocaleString()} $SHYFT</p>
                  {mine ? <span className="text-[10px] text-[#6366F1] font-semibold">Your listing</span> : null}
                </div>
                {mine ? (
                  <button disabled={isBusy} onClick={() => delist(l)} className="text-sm font-semibold text-[#DC2626] border border-[#FECACA] px-3 py-1.5 rounded-lg disabled:opacity-60">
                    {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delist"}
                  </button>
                ) : (
                  <button disabled={isBusy} onClick={() => buy(l)} className="flex items-center gap-1.5 bg-[#0F172A] text-white text-sm font-semibold px-4 py-1.5 rounded-lg disabled:opacity-60">
                    {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Buy"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
