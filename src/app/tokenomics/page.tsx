"use client";

import Link from "next/link";
import { useAppStore } from "@/lib/store";
import {
  Sun,
  Moon,
  ArrowLeft,
  Repeat,
  Coins,
  Server,
  TrendingUp,
  Wallet,
  Building2,
  Sparkles,
  CheckCircle2,
  CircleDot,
  Circle,
} from "lucide-react";

/* ────────────────────────────────────────────
   Fee split: the 1% breakdown
   ──────────────────────────────────────────── */

const SPLIT = [
  {
    key: "buyback",
    label: "Buyback",
    pct: 30,
    color: "#2563EB",
    icon: Repeat,
    desc: "Buys $SHYFT back off the open market for constant supply pressure. The platform itself is a buyer.",
  },
  {
    key: "revshare",
    label: "Rev-share",
    pct: 25,
    color: "#16A34A",
    icon: Coins,
    desc: "Paid straight to holders who stake. Real yield in SOL/USDC, from real usage. Not emissions.",
  },
  {
    key: "infra",
    label: "Infrastructure",
    pct: 45,
    color: "#EA580C",
    icon: Server,
    desc: "Keeps Shyft 100% free: sponsored gas & rent, AI, RPC nodes, storage, wallets, real-time.",
  },
];

const WHY = [
  {
    icon: TrendingUp,
    title: "Exposure to every trade",
    body: (
      <>The token captures <b className="text-[#1A1A2E]">1% of all trading volume</b>: every creator-token trade on Shyft, not a single coin.</>
    ),
  },
  {
    icon: Coins,
    title: "Real yield, not printing",
    body: (
      <><b className="text-[#1A1A2E]">25% of fees</b> are shared with stakers in SOL/USDC. Income from actual usage, with zero dilution.</>
    ),
  },
  {
    icon: Repeat,
    title: "Non-stop buy pressure",
    body: (
      <><b className="text-[#1A1A2E]">30% of fees</b> buy back $SHYFT continuously. More volume, more buybacks, tighter supply.</>
    ),
  },
  {
    icon: Wallet,
    title: "You own the growth engine",
    body: (
      <><b className="text-[#1A1A2E]">45% funds the free experience</b>: gasless, AI, infra. What keeps users coming is what you hold.</>
    ),
  },
  {
    icon: Building2,
    title: "A real company behind it",
    body: (
      <>Shyft is incorporating as an <b className="text-[#1A1A2E]">LLC</b>, a real, accountable business, not an anonymous coin. Live on web, iOS &amp; Android.</>
    ),
  },
  {
    icon: Sparkles,
    title: "The flywheel pays you",
    body: (
      <>More users → more volume → more fees. Buybacks and rev-share reward you <b className="text-[#1A1A2E]">as the network grows</b>.</>
    ),
  },
];

const ROADMAP = [
  {
    status: "Shipped",
    when: "Now live",
    title: "Foundation",
    pillClass: "text-[#16A34A] bg-[#F0FDF4] border-[#BBF7D0]",
    icon: CheckCircle2,
    items: [
      "$SHYFT token live and trading",
      "Web (shyft.lol) + iOS & Android apps live",
      "Fully gasless: embedded wallets, no seed phrase, no SOL",
      "On-chain social + end-to-end encrypted chat",
      "Creator tokens with in-app trading & fee sharing",
      "1% fee capture on all trading volume",
    ],
  },
  {
    status: "Now",
    when: "In progress",
    title: "Sharpen the apps",
    pillClass: "text-[#2563EB] bg-[#EFF6FF] border-[#BFDBFE]",
    icon: CircleDot,
    items: [
      "Make the iOS app faster and friendlier with smoother onboarding and cleaner UX",
      "Launch on Solana Seeker with dApp store listing + Seed Vault support",
      "Polish mobile end to end: gestures, push notifications, performance",
      "Cut first-time friction so anyone can start in seconds",
    ],
  },
  {
    status: "Next",
    when: "Coming",
    title: "Activate the split & go legit",
    pillClass: "text-[#EA580C] bg-[#FFF7ED] border-[#FED7AA]",
    icon: Circle,
    items: [
      "Route the 1% into 30% buyback / 25% rev-share / 45% infra",
      "Start buybacks, with every buy posted publicly",
      "Ship a live dashboard: volume, fees, buybacks, treasury",
      "Incorporate Shyft as an LLC, a real, accountable company",
    ],
  },
  {
    status: "Next",
    when: "Coming",
    title: "Rev-share & staking",
    pillClass: "text-[#EA580C] bg-[#FFF7ED] border-[#FED7AA]",
    icon: Circle,
    items: [
      "Stake $SHYFT to earn the 25% rev-share (SOL/USDC)",
      "Staking perks: boosted creator fee-share, lower fees, premium features",
    ],
  },
  {
    status: "Later",
    when: "On the horizon",
    title: "Scale & decentralize",
    pillClass: "text-[#64748B] bg-[#F8FAFC] border-[#E2E8F0]",
    icon: Circle,
    items: [
      "Infra costs stay flat as volume grows, so surplus compounds into buybacks & rev-share",
      "Governance: holders vote on fee splits & treasury use",
      "Group chat, discovery, richer creator tools",
    ],
  },
];

/* ════════════════════════════════════════════
   TOKEN PAGE
   ════════════════════════════════════════════ */

export default function TokenPage() {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#FAFBFC]">
      {/* ── Top Nav ── */}
      <nav className="flex-none flex items-center justify-between px-4 sm:px-6 md:px-8 py-3 border-b border-[#E2E8F0] bg-white/90 backdrop-blur-lg">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div
            className="text-4xl sm:text-5xl font-black text-[#1F2937] group-hover:text-[#2563EB] transition-colors"
            style={{ fontFamily: "Georgia, serif", fontWeight: 900, lineHeight: 1 }}
          >
            S
          </div>
          <div>
            <h1 className="text-base font-bold text-[#1A1A2E]">$SHYFT</h1>
            <p className="text-[9px] text-[#64748B] -mt-0.5">Tokenomics</p>
          </div>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="p-2 rounded-lg hover:bg-[#F1F5F9] text-[#64748B] transition-colors"
          >
            {theme === "dark" ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
          </button>
          <Link href="/docs" className="hidden sm:block text-xs text-[#64748B] hover:text-[#2563EB] transition-colors">
            Docs
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-lg transition-colors"
          >
            Open App
          </Link>
        </div>
      </nav>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-20">
        {/* ── Hero ── */}
        <section className="pt-16 sm:pt-24 pb-12 text-center">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-[#64748B] border border-[#E2E8F0] rounded-full px-3 py-1.5 mb-7 bg-white">
            <span className="w-2 h-2 rounded-full bg-[#16A34A] animate-pulse-green" />
            $SHYFT · Live on Solana
          </div>
          <h1 className="text-4xl sm:text-6xl font-black text-[#1A1A2E] leading-[1.05] tracking-tight text-balance">
            Every trade on Shyft pays{" "}
            <span className="text-[#2563EB]">1%</span> to the protocol.
          </h1>
          <p className="mt-5 text-base sm:text-lg text-[#64748B] max-w-md mx-auto">
            And that fee does real work. It keeps the app free for everyone, and rewards the people who hold.
          </p>
        </section>

        {/* ── Fee split ── */}
        <section className="pt-8">
          <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-[#2563EB] mb-3">Tokenomics</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#1A1A2E] tracking-tight">Where the 1% goes</h2>
          <p className="mt-3 text-[#64748B] text-sm sm:text-base max-w-xl">
            No black box. Every unit of trading volume routes 1% to the protocol, split three ways, on-chain and transparent.
          </p>

          {/* Split bar */}
          <div className="mt-8 flex items-end gap-3">
            <span className="text-5xl sm:text-6xl font-black text-[#1A1A2E] tracking-tight leading-none">1%</span>
            <span className="text-sm text-[#64748B] pb-1.5">of all trading volume, split:</span>
          </div>
          <div className="mt-5 flex w-full h-16 rounded-xl overflow-hidden gap-0.5" role="img" aria-label="Fee split: 30% buyback, 25% rev-share, 45% infrastructure">
            {SPLIT.map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-center text-white font-semibold text-sm tabular-nums"
                style={{ flexGrow: s.pct, backgroundColor: s.color }}
              >
                {s.pct}%
              </div>
            ))}
          </div>

          {/* Legend cards */}
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {SPLIT.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.key} className="rounded-xl border border-[#E2E8F0] bg-white p-5">
                  <div className="flex items-center gap-2.5 mb-3">
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${s.color}1A`, color: s.color }}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="font-semibold text-[#1A1A2E]">{s.label}</span>
                    <span className="ml-auto text-2xl font-black text-[#1A1A2E] tabular-nums">{s.pct}%</span>
                  </div>
                  <p className="text-[13px] text-[#475569] leading-relaxed">{s.desc}</p>
                </div>
              );
            })}
          </div>

          {/* Holder callout */}
          <div className="mt-6 flex items-center gap-4 flex-wrap rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] px-5 py-4">
            <span className="text-3xl font-black text-[#15803D] tabular-nums">55%</span>
            <span className="text-sm text-[#475569] leading-relaxed flex-1 min-w-[220px]">
              of the fee works directly for holders through <b className="text-[#15803D]">30% buybacks + 25% rev-share</b>, while the rest keeps the app free. That&apos;s <b className="text-[#15803D]">0.55% of all volume</b> flowing to holder value.
            </span>
          </div>
        </section>

        {/* ── Why hold ── */}
        <section className="pt-16">
          <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-[#2563EB] mb-3">The case</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#1A1A2E] tracking-tight">Why hold $SHYFT</h2>
          <p className="mt-3 text-[#64748B] text-sm sm:text-base max-w-xl">
            You&apos;re not betting on one creator. You own a slice of the whole platform&apos;s activity.
          </p>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {WHY.map((w, i) => {
              const Icon = w.icon;
              return (
                <div key={i} className="rounded-xl border border-[#E2E8F0] bg-white p-5 hover:border-[#2563EB]/30 transition-colors">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <span className="w-9 h-9 rounded-lg bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4.5 h-4.5" />
                    </span>
                    <h3 className="font-bold text-[#1A1A2E] text-[15px]">{w.title}</h3>
                  </div>
                  <p className="text-[13px] text-[#475569] leading-relaxed">{w.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Roadmap ── */}
        <section className="pt-16">
          <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-[#2563EB] mb-3">Roadmap</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#1A1A2E] tracking-tight">Where we are, where we&apos;re headed</h2>
          <p className="mt-3 text-[#64748B] text-sm sm:text-base max-w-xl">
            The token is live. Here&apos;s what&apos;s shipped and what&apos;s next.
          </p>
          <div className="mt-8 space-y-0">
            {ROADMAP.map((p, i) => {
              const Icon = p.icon;
              return (
                <div key={i} className={`grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 sm:gap-6 py-6 ${i > 0 ? "border-t border-[#E2E8F0]" : ""}`}>
                  <div className="flex flex-col gap-2">
                    <span className={`inline-flex items-center gap-1.5 self-start text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full border ${p.pillClass}`}>
                      <Icon className="w-3 h-3" /> {p.status}
                    </span>
                    <span className="text-xs text-[#94A3B8] pl-1">{p.when}</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-[#1A1A2E] text-base mb-3">{p.title}</h3>
                    <ul className="space-y-2">
                      {p.items.map((it, j) => (
                        <li key={j} className="flex gap-2.5 text-[13px] text-[#475569] leading-relaxed">
                          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#2563EB] flex-shrink-0" />
                          {it}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Final quote ── */}
        <section className="pt-20 pb-8 text-center">
          <blockquote className="text-xl sm:text-2xl font-bold text-[#1A1A2E] leading-snug tracking-tight max-w-xl mx-auto text-balance">
            1% of volume to the protocol. <span className="text-[#2563EB]">Half works for holders</span> through buybacks and rev-share. The other half keeps Shyft free. The token funds the free app <span className="text-[#2563EB]">and</span> rewards the people who hold it.
          </blockquote>
        </section>

        {/* ── Footer ── */}
        <footer className="pt-10 border-t border-[#E2E8F0] flex items-center justify-center gap-4 text-xs text-[#94A3B8]">
          <Link href="/" className="hover:text-[#2563EB] transition-colors flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to app
          </Link>
          <span>·</span>
          <a href="https://x.com/Shyft_lol" target="_blank" rel="noopener noreferrer" className="hover:text-[#2563EB] transition-colors">
            @Shyft_lol
          </a>
        </footer>
      </main>
      </div>
    </div>
  );
}
