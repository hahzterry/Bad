"use client";

import { useState, useEffect, useCallback } from "react";
import { Shield, MessageCircle, Wallet, Lock, Users, ArrowRight, Zap, ChevronRight, Sparkles, Sun, Moon, Activity, Smartphone, Globe } from "lucide-react";
import { useWallet } from "@/hooks/usePrivyWallet";
import { useAppStore } from "@/lib/store";
import ChainSelector, { type ChainPreference, setChainPreference } from "@/components/ChainSelector";

const features = [
  {
    icon: Shield,
    title: "On-Chain Posts",
    description: "Your posts live on Solana — permanent, censorship-resistant, and fully owned by you.",
    color: "#2563EB",
    bgColor: "#EFF6FF",
    preview: {
      type: "post",
      author: "You",
      content: "Just shipped a new feature! Posted permanently on Solana...",
      badge: "On-Chain",
    },
  },
  {
    icon: MessageCircle,
    title: "Encrypted Chat",
    description: "End-to-end encrypted with NaCl Box. Not even the app can read your conversations.",
    color: "#16A34A",
    bgColor: "#F0FDF4",
    preview: {
      type: "chat",
      messages: [
        { sender: "Alice", text: "Hey, check out this alpha..." },
        { sender: "You", text: "This is incredible, sending you 5 USDC" },
        { sender: "system", text: "\u{1F4B8} 5 USDC sent privately" },
      ],
    },
  },
  {
    icon: Wallet,
    title: "Instant Payments",
    description: "Send SOL directly to friends on Solana. Fast, cheap, and recorded on-chain.",
    color: "#2563EB",
    bgColor: "#EFF6FF",
    preview: {
      type: "payment",
      steps: ["Enter recipient & amount", "Sign the transaction", "SOL arrives instantly"],
    },
  },
  {
    icon: Users,
    title: "Follow Network",
    description: "Follow anyone on-chain. Build your social graph stored directly on Solana.",
    color: "#16A34A",
    bgColor: "#F0FDF4",
    preview: {
      type: "follows",
      count: "Your network. Your graph.",
    },
  },
];

export default function Landing() {
  const [activeFeature, setActiveFeature] = useState(0);
  const [showApp, setShowApp] = useState(false);
  const [showChainSelector, setShowChainSelector] = useState(false);
  const { login, ready } = useWallet();
  const { theme, toggleTheme } = useAppStore();

  const handleChainSelect = useCallback((chain: ChainPreference) => {
    setChainPreference(chain);
    setShowChainSelector(false);
    login();
  }, [login]);

  const openChainSelector = useCallback(() => {
    setShowChainSelector(true);
  }, []);
  const [stats, setStats] = useState<{
    profiles: number; posts: number; follows: number;
    reactions: number; comments: number; transactions: number;
    tokens_launched: number;
  } | null>(null);

  // Fetch live on-chain stats
  useEffect(() => {
    fetch("/api/stats")
      .then(r => r.json())
      .then(data => { if (!data.error) setStats(data); })
      .catch(() => {});
  }, []);

  // Auto-cycle features every 4 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % features.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#FAFBFC] flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-4 sm:px-6 md:px-12 py-3 sm:py-4 border-b border-[#E2E8F0] bg-white/80 backdrop-blur-lg sticky top-0 z-50">
        <div className="flex items-center gap-2 sm:gap-3">
          <img src="/shyftlogo.png" alt="Shyft" className="shyft-logo w-12 h-12 sm:w-14 sm:h-14" />
          <div>
            <h1 className="text-base sm:text-lg font-bold text-[#1A1A2E]">Shyft</h1>
            <p className="text-[9px] sm:text-[10px] text-[#64748B] -mt-0.5">On-Chain Social</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <a href="/docs" className="hidden sm:flex items-center gap-1 text-xs text-[#64748B] hover:text-[#2563EB] transition-colors">
            <Zap className="w-3 h-3" /> Docs
          </a>
          <a href="https://explorer.solana.com/address/EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ" target="_blank" rel="noopener noreferrer" className="hidden sm:flex items-center gap-1 text-xs text-[#64748B] hover:text-[#2563EB] transition-colors">
            <Zap className="w-3 h-3" /> On-Chain Program
          </a>
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] transition-all"
            title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "light" ? (
              <Moon className="w-4 h-4 text-[#64748B]" />
            ) : (
              <Sun className="w-4 h-4 text-[#F59E0B]" />
            )}
          </button>
          <button
            onClick={openChainSelector}
            disabled={!ready}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-lg transition-colors disabled:opacity-50"
          >
            Sign In
          </button>
        </div>
      </nav>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-10 sm:py-12 md:py-20">
        {/* Badge */}
        <div className="flex items-center gap-2 px-3 sm:px-4 py-1.5 bg-white border border-[#E2E8F0] rounded-full mb-5 sm:mb-6 shadow-sm">
          <div className="w-2 h-2 rounded-full bg-[#16A34A] animate-pulse" />
          <span className="text-[10px] sm:text-xs font-medium text-[#64748B]">Built on Solana · Base support live · Zero Gas Fees</span>
        </div>

        {/* Title */}
        <h2 className="text-3xl sm:text-4xl md:text-6xl font-bold text-center text-[#1A1A2E] max-w-3xl leading-tight">
          Social that&apos;s{" "}
          <span className="bg-gradient-to-r from-[#2563EB] to-[#16A34A] bg-clip-text text-transparent">
            fully on-chain
          </span>
        </h2>
        <p className="text-base sm:text-lg md:text-xl text-[#64748B] text-center max-w-xl mt-3 sm:mt-4 leading-relaxed px-2">
          Post, chat, and send payments — all on Solana. Own your data, your identity, and your social graph.
        </p>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 mt-6 sm:mt-8 w-full sm:w-auto">
          <div className="w-full sm:w-auto flex justify-center">
            <button
              onClick={openChainSelector}
              disabled={!ready}
              className="flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-xl transition-colors disabled:opacity-50 shadow-lg shadow-blue-200"
            >
              <Wallet className="w-4 h-4" /> Get Started
            </button>
          </div>
          <button
            onClick={() => {
              const el = document.getElementById("features");
              el?.scrollIntoView({ behavior: "smooth" });
            }}
            className="flex items-center gap-2 px-5 py-3 text-sm font-medium text-[#64748B] hover:text-[#1A1A2E] transition-colors"
          >
            See how it works <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Trust bar */}
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-3 sm:gap-6 mt-8 sm:mt-12 w-full sm:w-auto justify-center">
          <div className="flex items-center gap-2 text-[10px] sm:text-xs text-[#94A3B8] justify-center">
            <Lock className="w-3.5 h-3.5 text-[#16A34A] flex-shrink-0" />
            <span>E2E Encrypted Chat</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] sm:text-xs text-[#94A3B8] justify-center">
            <Shield className="w-3.5 h-3.5 text-[#2563EB] flex-shrink-0" />
            <span>On-Chain Posts & Profiles</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] sm:text-xs text-[#94A3B8] justify-center">
            <Wallet className="w-3.5 h-3.5 text-[#16A34A] flex-shrink-0" />
            <span>Zero Gas Fees for Users</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] sm:text-xs text-[#94A3B8] justify-center">
            <Zap className="w-3.5 h-3.5 text-[#2563EB] flex-shrink-0" />
            <span>Real-Time on Solana</span>
          </div>
        </div>
      </div>

      {/* Live On-Chain Stats — Terminal */}
      <div className="px-4 sm:px-6 md:px-12 py-10 sm:py-14 bg-white border-t border-[#E2E8F0]">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-6">
            <Activity className="w-4 h-4 text-[#16A34A]" />
            <p className="text-xs font-semibold uppercase tracking-widest text-[#94A3B8]">Live On-Chain Stats</p>
            <div className="w-2 h-2 rounded-full bg-[#16A34A] animate-pulse" />
          </div>

          {/* Terminal window */}
          <div className="rounded-2xl overflow-hidden border border-[#1E293B] shadow-2xl shadow-black/20">
            {/* Title bar */}
            <div className="flex items-center gap-2 px-4 py-3 bg-[#1E293B]">
              <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
              <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
              <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
              <span className="ml-3 text-[11px] text-[#64748B] font-mono">shyft@solana:~$</span>
              <span className="ml-1 text-[11px] text-[#94A3B8] font-mono">query program EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ</span>
            </div>

            {/* Terminal body */}
            <div className="bg-[#0F172A] px-5 py-5 font-mono text-sm space-y-2">
              <div className="text-[#64748B] text-xs mb-3">
                <span className="text-[#2563EB]">$</span> fetching on-chain data from Solana mainnet...
              </div>

              {stats ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                    {[
                      { key: "profiles",        label: "profiles",        value: stats.profiles,        color: "#60A5FA" },
                      { key: "transactions",    label: "transactions",     value: stats.transactions,    color: "#34D399" },
                      { key: "posts",           label: "posts",            value: stats.posts,           color: "#A78BFA" },
                      { key: "comments",        label: "comments",         value: stats.comments,        color: "#F472B6" },
                      { key: "follows",         label: "follows",          value: stats.follows,         color: "#FBBF24" },
                      { key: "reactions",       label: "reactions",        value: stats.reactions,       color: "#FB923C" },
                      { key: "tokens_launched", label: "tokens_launched",  value: stats.tokens_launched, color: "#22D3EE" },
                    ].map((s) => (
                      <div key={s.key} className="flex items-center gap-2">
                        <span className="text-[#475569] text-xs w-2">›</span>
                        <span className="text-[#94A3B8] text-xs w-36">{s.label}</span>
                        <span className="text-xs font-bold" style={{ color: s.color }}>
                          {s.value.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-[#1E293B] mt-4 pt-4 space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-[#475569]">›</span>
                      <span className="text-[#94A3B8]">program_id</span>
                      <span className="text-[#60A5FA] break-all">EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-[#475569]">›</span>
                      <span className="text-[#94A3B8]">network</span>
                      <span className="text-[#34D399]">mainnet-beta</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-[#475569]">›</span>
                      <span className="text-[#94A3B8]">status</span>
                      <span className="text-[#34D399] flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#34D399] animate-pulse" />
                        live
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-[#64748B] text-xs animate-pulse">loading chain data<span className="animate-ping">_</span></div>
              )}

              {/* Prompt line */}
              <div className="flex items-center gap-1 pt-3">
                <span className="text-[#2563EB] text-xs">$</span>
                <span className="w-2 h-4 bg-[#60A5FA] animate-pulse inline-block rounded-sm ml-1" />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 mt-4">
            <a
              href="https://solscan.io/account/EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] text-[#64748B] hover:text-[#2563EB] transition-colors"
            >
              <Zap className="w-3 h-3" /> View on Solscan ↗
            </a>
            <span className="text-[#CBD5E1]">·</span>
            <a
              href="https://explorer.solana.com/address/EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] text-[#64748B] hover:text-[#2563EB] transition-colors"
            >
              <Activity className="w-3 h-3" /> Solana Explorer ↗
            </a>
          </div>
        </div>
      </div>

      {/* Feature Preview Section */}
      <div id="features" className="px-4 sm:px-6 md:px-12 py-12 sm:py-16 md:py-24 bg-white border-t border-[#E2E8F0]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-8 sm:mb-12">
            <h3 className="text-xl sm:text-2xl md:text-3xl font-bold text-[#1A1A2E]">
              Everything you love about social.{" "}
              <span className="text-[#64748B]">Nothing you don&apos;t.</span>
            </h3>
            <p className="text-xs sm:text-sm text-[#94A3B8] mt-2 sm:mt-3">Every feature lives on Solana — your data, your rules</p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 sm:gap-8 items-start">
            {/* Feature tabs */}
            <div className="space-y-2 sm:space-y-3">
              {features.map((feature, i) => {
                const Icon = feature.icon;
                const isActive = i === activeFeature;
                return (
                  <button
                    key={i}
                    onClick={() => setActiveFeature(i)}
                    className={`touch-active w-full text-left p-3 sm:p-4 rounded-2xl border transition-all duration-300 ${
                      isActive
                        ? "bg-white border-[#2563EB]/20 shadow-lg shadow-blue-100"
                        : "bg-[#F8FAFC] border-[#E2E8F0] hover:bg-white active:bg-white"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: feature.bgColor }}
                      >
                        <Icon className="w-5 h-5" style={{ color: feature.color }} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[#1A1A2E]">{feature.title}</p>
                        <p className={`text-xs mt-1 transition-all duration-300 ${
                          isActive ? "text-[#64748B]" : "text-[#94A3B8]"
                        }`}>
                          {feature.description}
                        </p>
                      </div>
                    </div>
                    {isActive && (
                      <div className="mt-3 ml-13 h-1 bg-gradient-to-r from-[#2563EB] to-[#16A34A] rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Feature preview card */}
            <div className="bg-[#F8FAFC] rounded-2xl border border-[#E2E8F0] p-4 sm:p-6 min-h-[280px] sm:min-h-[360px] flex items-center justify-center">
              {features[activeFeature].preview.type === "post" && (
                <div className="w-full animate-fade-in">
                  <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-sm">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#EBF4FF] to-[#E0F2FE] flex items-center justify-center text-lg">{"\u{1F60E}"}</div>
                      <div>
                        <p className="text-sm font-semibold text-[#1A1A2E]">You</p>
                        <span className="text-[10px] font-medium text-[#2563EB] bg-[#EFF6FF] px-2 py-0.5 rounded-full">
                          On-Chain
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-[#1A1A2E]">{features[activeFeature].preview.content}</p>
                    <div className="mt-3 pt-3 border-t border-[#F1F5F9] flex items-center gap-3 text-xs text-[#94A3B8]">
                      <span>{"\u2764\uFE0F"} 12</span>
                      <span>{"\u{1F4AC}"} 3</span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 justify-center text-[10px] text-[#2563EB]">
                    <Shield className="w-3 h-3" />
                    <span>Stored permanently on Solana — owned by your wallet</span>
                  </div>
                </div>
              )}

              {features[activeFeature].preview.type === "chat" && (
                <div className="w-full space-y-3 animate-fade-in">
                  <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#F1F5F9] flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#EBF4FF] flex items-center justify-center text-sm">{"\u{1F469}"}</div>
                      <div>
                        <p className="text-xs font-semibold text-[#1A1A2E]">Alice</p>
                        <p className="text-[10px] text-[#16A34A] flex items-center gap-0.5"><Shield className="w-2 h-2" /> E2E Encrypted</p>
                      </div>
                    </div>
                    <div className="p-4 space-y-2.5">
                      {(features[activeFeature].preview as any).messages.map((msg: any, j: number) => (
                        <div key={j} className={`flex ${msg.sender === "You" ? "justify-end" : "justify-start"}`}>
                          {msg.sender === "system" ? (
                            <div className="bg-gradient-to-r from-[#16A34A] to-[#15803D] text-white px-3 py-2 rounded-xl text-xs font-medium">
                              {msg.text}
                            </div>
                          ) : (
                            <div className={`px-3 py-2 rounded-xl text-xs max-w-[220px] ${
                              msg.sender === "You"
                                ? "bg-[#2563EB] text-white"
                                : "bg-[#F1F5F9] text-[#1A1A2E]"
                            }`}>
                              {msg.text}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {features[activeFeature].preview.type === "payment" && (
                <div className="w-full animate-fade-in">
                  <div className="bg-white rounded-xl border border-[#E2E8F0] p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Wallet className="w-5 h-5 text-[#2563EB]" />
                      <p className="text-sm font-semibold text-[#1A1A2E]">Private Payment Flow</p>
                    </div>
                    <div className="space-y-3">
                      {(features[activeFeature].preview as any).steps.map((step: string, j: number) => (
                        <div key={j} className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                            j < 2 ? "bg-[#2563EB]" : "bg-[#16A34A]"
                          }`}>
                            {j + 1}
                          </div>
                          <div className="flex-1 bg-[#F8FAFC] rounded-lg px-3 py-2">
                            <p className="text-xs font-medium text-[#1A1A2E]">{step}</p>
                          </div>
                          {j < 2 && <Lock className="w-3 h-3 text-[#16A34A]" />}
                          {j === 2 && <Sparkles className="w-3 h-3 text-[#16A34A]" />}
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 bg-[#F0FDF4] rounded-lg p-3">
                      <p className="text-[10px] text-[#15803D]">
                        <strong>What observers see:</strong> Someone deposited. Someone withdrew. Cannot link them together.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {features[activeFeature].preview.type === "follows" && (
                <div className="w-full animate-fade-in">
                  <div className="bg-white rounded-xl border border-[#E2E8F0] p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Users className="w-5 h-5 text-[#16A34A]" />
                      <p className="text-sm font-semibold text-[#1A1A2E]">On-Chain Follow Network</p>
                    </div>
                    <div className="space-y-2.5">
                      {["Alice.sol", "Bob.sol", "Charlie.sol"].map((name, j) => (
                        <div key={j} className="flex items-center gap-3 p-2.5 bg-[#F8FAFC] rounded-xl">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#EBF4FF] to-[#E0F2FE] flex items-center justify-center text-sm">
                            {["\u{1F469}", "\u{1F468}", "\u{1F9D1}"][j]}
                          </div>
                          <div className="flex-1">
                            <p className="text-xs font-semibold text-[#1A1A2E]">{name}</p>
                            <p className="text-[10px] text-[#94A3B8]">{j === 0 ? "Follows you · Mutual" : j === 1 ? "Following" : "Follows you"}</p>
                          </div>
                          <div className={`w-2 h-2 rounded-full ${j === 0 ? "bg-[#16A34A]" : "bg-[#2563EB]"}`} />
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 text-center">
                      <p className="text-[10px] text-[#64748B]">Follow relationships stored on Solana — your social graph, your data</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile App Showcase */}
      <div className="px-4 sm:px-6 md:px-12 py-14 sm:py-20 border-t border-[#E2E8F0] bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-10 sm:gap-16 items-center">
            {/* Text side */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-full mb-5">
                <Smartphone className="w-3.5 h-3.5 text-purple-500" />
                <span className="text-[11px] font-medium text-purple-600">Native iOS App</span>
              </div>
              <h3 className="text-2xl sm:text-3xl md:text-4xl font-bold text-[#1A1A2E] leading-tight mb-4">
                Take your social<br />
                <span className="bg-gradient-to-r from-[#7C3AED] to-[#2563EB] bg-clip-text text-transparent">on the go</span>
              </h3>
              <p className="text-sm sm:text-base text-[#64748B] leading-relaxed mb-6">
                The full Shyft experience in a native iOS app. Post, chat, send payments — all from your phone with zero wallet popups. Embedded wallet signs silently in the background.
              </p>
              <div className="space-y-3 mb-8">
                {[
                  { icon: <Zap className="w-4 h-4 text-[#F59E0B]" />, bg: "bg-amber-50", text: "Silent transaction signing — no popups ever" },
                  { icon: <Lock className="w-4 h-4 text-[#16A34A]" />, bg: "bg-green-50", text: "Same E2E encryption as the web app" },
                  { icon: <Globe className="w-4 h-4 text-[#2563EB]" />, bg: "bg-blue-50", text: "Synced with web — one identity everywhere" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg ${item.bg} flex items-center justify-center flex-shrink-0`}>{item.icon}</div>
                    <p className="text-sm text-[#475569]">{item.text}</p>
                  </div>
                ))}
              </div>
              <a
                href="https://apps.apple.com/pk/app/shyft-web3-social/id6763483494"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-3 px-6 py-3.5 rounded-2xl bg-[#1A1A2E] hover:bg-[#2a2a3e] transition-all duration-200 shadow-lg hover:shadow-xl hover:-translate-y-0.5 group"
              >
                <svg className="w-7 h-7 text-white flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                </svg>
                <div className="text-left">
                  <div className="text-white/60 text-[10px] leading-none mb-0.5">Download on the</div>
                  <div className="text-white text-base font-semibold leading-none">App Store</div>
                </div>
              </a>
            </div>

            {/* Phone mockup */}
            <div className="flex items-center justify-center">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-purple-200/40 to-blue-200/40 blur-3xl rounded-full scale-150" />
                <div className="relative w-56 sm:w-64 bg-[#111] rounded-[3rem] border-2 border-[#333] shadow-2xl overflow-hidden" style={{ aspectRatio: '9/19.5' }}>
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 w-24 h-6 bg-[#111] rounded-full z-10 border border-[#333]" />
                  <div className="absolute inset-0 bg-[#0d0d0d] flex flex-col pt-10 overflow-hidden">
                    <div className="px-4 py-2.5 flex items-center justify-between border-b border-white/5">
                      <div className="flex items-center gap-2">
                        <img src="/shyftlogo.png" alt="" className="shyft-logo w-6 h-6 rounded-lg" style={{ filter: 'invert(1)' }} />
                        <span className="text-white text-xs font-bold">Shyft</span>
                      </div>
                      <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px]">✏️</div>
                    </div>
                    <div className="flex-1 overflow-hidden px-3 py-2 space-y-2">
                      {[
                        { avatar: "🧑‍💻", name: "dev.sol", time: "2m", text: "just deployed my first Solana program 🚀", likes: 24 },
                        { avatar: "👩‍🎨", name: "art3mis.sol", time: "8m", text: "new NFT drop live! check the link below 🎨", likes: 47 },
                        { avatar: "🤝", name: "vc.sol", time: "15m", text: "looking for founders building on Solana DM me", likes: 11 },
                      ].map((post, i) => (
                        <div key={i} className="rounded-xl p-2.5 border border-white/5">
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center text-xs">{post.avatar}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-semibold text-white truncate">{post.name}</span>
                                <div className="w-2 h-2 rounded-full bg-[#60A5FA] flex-shrink-0" />
                              </div>
                              <span className="text-[8px] text-white/30">{post.time} ago</span>
                            </div>
                          </div>
                          <p className="text-[10px] text-white/60 leading-snug">{post.text}</p>
                          <div className="mt-1.5 flex items-center gap-2 text-[8px] text-white/20">
                            <span>❤️ {post.likes}</span><span>💬</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 py-2 flex items-center justify-around border-t border-white/5">
                      {["🏠", "🔍", "➕", "💬", "👤"].map((icon, i) => (
                        <div key={i} className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm ${i === 0 ? "bg-white/10" : ""}`}>{icon}</div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="absolute -right-0.5 top-20 w-1 h-12 bg-[#333] rounded-r-full" />
                <div className="absolute -left-0.5 top-16 w-1 h-8 bg-[#333] rounded-l-full" />
                <div className="absolute -left-0.5 top-28 w-1 h-12 bg-[#333] rounded-l-full" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="px-4 sm:px-6 md:px-12 py-12 sm:py-16 bg-gradient-to-br from-[#EFF6FF] to-[#F0FDF4] border-t border-[#E2E8F0]">
        <div className="max-w-4xl mx-auto text-center">
          <h3 className="text-xl sm:text-2xl font-bold text-[#1A1A2E] mb-6 sm:mb-8">How Shyft works</h3>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
            <div className="bg-white rounded-2xl p-5 sm:p-6 border border-[#E2E8F0] shadow-sm">
              <div className="w-12 h-12 rounded-xl bg-[#EFF6FF] flex items-center justify-center mx-auto mb-4">
                <span className="text-xl font-bold text-[#2563EB]">1</span>
              </div>
              <h4 className="text-sm font-semibold text-[#1A1A2E] mb-2">Sign in — zero setup</h4>
              <p className="text-xs text-[#64748B]">Use email, Google, Twitter, or your wallet. We create a secure embedded wallet — no extensions, no SOL needed.</p>
            </div>
            <div className="bg-white rounded-2xl p-5 sm:p-6 border border-[#E2E8F0] shadow-sm">
              <div className="w-12 h-12 rounded-xl bg-[#F0FDF4] flex items-center justify-center mx-auto mb-4">
                <span className="text-xl font-bold text-[#16A34A]">2</span>
              </div>
              <h4 className="text-sm font-semibold text-[#1A1A2E] mb-2">Everything lives on Solana</h4>
              <p className="text-xs text-[#64748B]">Posts, profiles, follows, chats — all stored as on-chain accounts. Your data is permanent and owned by your wallet.</p>
            </div>
            <div className="bg-white rounded-2xl p-5 sm:p-6 border border-[#E2E8F0] shadow-sm">
              <div className="w-12 h-12 rounded-xl bg-[#EFF6FF] flex items-center justify-center mx-auto mb-4">
                <span className="text-xl font-bold text-[#2563EB]">3</span>
              </div>
              <h4 className="text-sm font-semibold text-[#1A1A2E] mb-2">Gas fees? We got you</h4>
              <p className="text-xs text-[#64748B]">The platform sponsors all transaction fees. Post, chat, and interact without ever needing SOL in your wallet.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Partners */}
      <div className="px-4 sm:px-6 md:px-12 py-10 sm:py-14 bg-white border-t border-[#E2E8F0]">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#94A3B8] mb-6 sm:mb-8">Our Partners</p>
          <div className="flex items-center justify-center gap-8 sm:gap-16">
            <a href="https://privy.io" target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 group">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden border border-[#E2E8F0] group-hover:border-[#2563EB]/30 transition-all group-hover:shadow-lg">
                <img src="/privy.jpg" alt="Privy" className="w-full h-full object-cover" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-[#1A1A2E]">Privy</p>
                <p className="text-[10px] text-[#94A3B8]">Wallet Infrastructure</p>
              </div>
            </a>
            <a href="https://bags.fm" target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 group">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden border border-[#E2E8F0] group-hover:border-[#16A34A]/30 transition-all group-hover:shadow-lg">
                <img src="/bags.jpg" alt="Bags.fm" className="w-full h-full object-cover" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-[#1A1A2E]">Bags.fm</p>
                <p className="text-[10px] text-[#94A3B8]">Token Launches</p>
              </div>
            </a>
            <a href="https://pinata.cloud" target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 group">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden border border-[#E2E8F0] group-hover:border-[#F7931A]/30 transition-all group-hover:shadow-lg">
                <img src="/pinata.jpg" alt="Pinata" className="w-full h-full object-cover" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-[#1A1A2E]">Pinata</p>
                <p className="text-[10px] text-[#94A3B8]">Media Infrastructure</p>
              </div>
            </a>
            <a href="https://magicblock.gg" target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 group">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden border border-[#E2E8F0] group-hover:border-[#7C3AED]/30 transition-all group-hover:shadow-lg">
                <img src="/magicblock.jpg" alt="MagicBlock" className="w-full h-full object-cover" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-[#1A1A2E]">MagicBlock</p>
                <p className="text-[10px] text-[#94A3B8]">Private Payments</p>
              </div>
            </a>
            <a href="https://oobe.io" target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 group">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden border border-[#E2E8F0] group-hover:border-[#0EA5E9]/30 transition-all group-hover:shadow-lg">
                <img src="/OOBE.jpg" alt="OOBE" className="w-full h-full object-cover" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-[#1A1A2E]">OOBE</p>
                <p className="text-[10px] text-[#94A3B8]">RPC Infrastructure</p>
              </div>
            </a>
          </div>
        </div>
      </div>

      {/* Final CTA */}
      <div className="px-4 sm:px-6 md:px-12 py-12 sm:py-16 text-center bg-white border-t border-[#E2E8F0]">
        <img src="/shyftlogo.png" alt="Shyft" className="shyft-logo w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-5 sm:mb-6" />
        <h3 className="text-xl sm:text-2xl md:text-3xl font-bold text-[#1A1A2E] mb-3">Ready to own your social?</h3>
        <p className="text-xs sm:text-sm text-[#64748B] mb-6 sm:mb-8 max-w-md mx-auto">Sign in with email, Google, Twitter, or your Solana wallet — and start using the first fully on-chain social platform.</p>
        <button
          onClick={openChainSelector}
          disabled={!ready}
          className="flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-xl transition-colors disabled:opacity-50 shadow-lg shadow-blue-200 mx-auto"
        >
          <Wallet className="w-4 h-4" /> Get Started — It&apos;s Free
        </button>
        <p className="text-[10px] text-[#94A3B8] mt-4">
          Program: EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ · Mainnet
        </p>
      </div>

      {/* Chain selector modal */}
      {showChainSelector && (
        <ChainSelector
          onSelect={handleChainSelect}
          onClose={() => setShowChainSelector(false)}
        />
      )}

      {/* Footer */}
      <footer className="px-4 sm:px-6 md:px-12 py-5 sm:py-6 border-t border-[#E2E8F0] bg-[#F8FAFC]">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 max-w-5xl mx-auto">
          <div className="flex items-center gap-2">
            <img src="/shyftlogo.png" alt="Shyft" className="shyft-logo w-6 h-6" />
            <span className="text-xs font-semibold text-[#64748B]">Shyft</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/docs" className="text-[#94A3B8] hover:text-[#1A1A2E] transition-colors text-xs font-medium">Docs</a>
            <a href="https://x.com/Shyft_lol" target="_blank" rel="noopener noreferrer" className="text-[#94A3B8] hover:text-[#1A1A2E] transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
            <a href="https://github.com/chandm1213/Shyft.lol" target="_blank" rel="noopener noreferrer" className="text-[#94A3B8] hover:text-[#1A1A2E] transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            </a>
            <p className="text-[9px] sm:text-[10px] text-[#94A3B8] text-center">Fully on-chain social built on Solana</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
