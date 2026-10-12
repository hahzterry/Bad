"use client";

import { Newspaper, MessageCircle, Wallet, User, BarChart3, Users, Coins, Globe, CandlestickChart, Flame } from "lucide-react";
import { useAppStore } from "@/lib/store";

const navItems = [
  { id: "feed", label: "Feed", icon: Newspaper },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "tokens", label: "Tokens", icon: Coins },
  { id: "stocks", label: "Stocks", icon: CandlestickChart },
  { id: "quests", label: "Quests", icon: Flame },
  { id: "profile", label: "Me", icon: User },
];

export default function MobileNav() {
  const { activeTab, setActiveTab, setViewingProfile, conversations } = useAppStore();
  const handleNavClick = (tabId: string) => {
    if (tabId === "profile") setViewingProfile(null);
    setActiveTab(tabId);
  };
  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-[#E2E8F0] z-40" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="flex items-center justify-around px-1">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`touch-active relative flex flex-col items-center justify-center gap-0.5 min-w-[54px] min-h-[52px] py-2 px-2 rounded-xl transition-all duration-200 ${
                isActive ? "text-[#2563EB]" : "text-[#94A3B8] active:text-[#64748B]"
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 transition-transform duration-200 ${isActive ? "scale-110" : ""}`} strokeWidth={isActive ? 2.5 : 2} />
                {item.id === "chat" && totalUnread > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-[#16A34A] text-white text-[8px] font-bold min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">
                    {totalUnread > 9 ? "9+" : totalUnread}
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-medium leading-tight ${isActive ? "font-semibold" : ""}`}>{item.label}</span>
              {isActive && (
                <div className="absolute -bottom-0 w-8 h-0.5 rounded-full bg-[#2563EB]" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
