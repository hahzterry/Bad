"use client";

import { Shield, Newspaper, MessageCircle, Wallet, User, Lock, BarChart3, Users, Sun, Moon, Coins, Globe, CandlestickChart, Flame, ShoppingBag } from "lucide-react";
import { useAppStore } from "@/lib/store";

const navItems = [
  { id: "feed", label: "Feed", icon: Newspaper },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "friends", label: "People", icon: Users },
  { id: "tokens", label: "Tokens", icon: Coins },
  { id: "stocks", label: "Stocks", icon: CandlestickChart },
  { id: "communities", label: "Communities", icon: Globe },
  { id: "quests", label: "Quests", icon: Flame },
  { id: "payments", label: "Payments", icon: Wallet },
  { id: "market", label: "Market", icon: ShoppingBag },
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "profile", label: "Profile", icon: User },
];

export default function Sidebar() {
  const { activeTab, setActiveTab, setViewingProfile, conversations, theme, toggleTheme } = useAppStore();
  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  const handleNavClick = (tabId: string) => {
    if (tabId === "profile") setViewingProfile(null); // always show own profile from nav
    setActiveTab(tabId);
  };

  return (
    <aside className="hidden md:flex flex-col w-64 h-screen bg-white border-r border-[#E2E8F0] fixed left-0 top-0 z-30">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-[#E2E8F0]">
        <img src="/shyftlogo.png" alt="Shyft" className="shyft-logo w-16 h-16" />
        <div>
          <h1 className="text-lg font-bold text-[#1A1A2E]">Shyft</h1>
          <p className="text-xs text-[#475569]">On-Chain Social</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? "bg-[#2563EB] text-white shadow-md shadow-blue-200"
                  : "text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
              {item.id === "chat" && totalUnread > 0 && (
                <span className="ml-auto bg-[#16A34A] text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                  {totalUnread}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Theme Toggle */}
      <div className="px-4 py-2 border-t border-[#E2E8F0]">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-all duration-200"
        >
          {theme === "light" ? (
            <><Moon className="w-5 h-5" /><span>Night Mode</span></>
          ) : (
            <><Sun className="w-5 h-5 text-[#F59E0B]" /><span>Day Mode</span></>
          )}
        </button>
      </div>

      {/* X / Twitter & GitHub */}
      <div className="px-4 py-2 border-t border-[#E2E8F0] space-y-1">
        <a
          href="https://x.com/Shyft_lol"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-all duration-200"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          <span>Follow on X</span>
        </a>
        <a
          href="https://github.com/chandm1213/Shyft.lol"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-all duration-200"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          <span>GitHub</span>
        </a>
      </div>

      {/* Privacy status */}
      <div className="px-4 py-4 border-t border-[#E2E8F0]">
        <div className="flex items-center gap-3 px-4 py-3 bg-[#F0FDF4] rounded-xl">
          <div className="w-2.5 h-2.5 rounded-full bg-[#16A34A] animate-pulse-green" />
          <div>
            <p className="text-xs font-semibold text-[#15803D]">On-Chain Social</p>
            <p className="text-[10px] text-[#16A34A]">Solana Mainnet</p>
          </div>
          <Lock className="w-3.5 h-3.5 text-[#16A34A] ml-auto" />
        </div>
      </div>
    </aside>
  );
}
