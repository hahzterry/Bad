"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@/hooks/usePrivyWallet";
import Sidebar from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";
import Header from "@/components/Header";
import Feed from "@/components/Feed";
import Chat from "@/components/Chat";
import Payments from "@/components/Payments";
import Marketplace from "@/components/Marketplace";
import Profile from "@/components/Profile";
import CreatorDashboard from "@/components/CreatorDashboard";
import Friends from "@/components/Friends";
import Tokens from "@/components/Tokens";
import Stocks from "@/components/Stocks";
import Communities from "@/components/Communities";
import Quests from "@/components/Quests";
import TrendingSidebar from "@/components/TrendingSidebar";
import AI from "@/components/AI";
import FloatingAIButton from "@/components/FloatingAIButton";
import ToastContainer from "@/components/Toast";
import Landing from "@/components/Landing";
import OnboardingDemo from "@/components/OnboardingDemo";
import ProfileSetup from "@/components/ProfileSetup";
import { useAppStore } from "@/lib/store";
import { useProgram } from "@/hooks/useProgram";

export default function Home() {
  const { activeTab, currentUser } = useAppStore();
  const { connected, publicKey } = useWallet();
  const program = useProgram();
  const [mounted, setMounted] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hasSeenDemo, setHasSeenDemo] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [checkingProfile, setCheckingProfile] = useState(false);

  useEffect(() => {
    setMounted(true);
    const hasSeenDemo = localStorage.getItem("shyft_onboarding_seen");
    setHasSeenDemo(!!hasSeenDemo);
    if (!hasSeenDemo && connected) {
      setShowOnboarding(true);
    }
  }, [connected]);

  // Check if user has an on-chain profile after connecting
  useEffect(() => {
    if (!connected || !program || !publicKey || showOnboarding) return;
    // If we already have a currentUser in store, no need to check
    if (currentUser) {
      setNeedsProfile(false);
      return;
    }
    let cancelled = false;
    const checkProfile = async () => {
      setCheckingProfile(true);
      try {
        const profile = await program.getProfile(publicKey);
        if (!cancelled) {
          setNeedsProfile(!profile);
        }
      } catch {
        if (!cancelled) setNeedsProfile(true);
      }
      if (!cancelled) setCheckingProfile(false);
    };
    checkProfile();
    return () => { cancelled = true; };
  }, [connected, program, publicKey, showOnboarding, currentUser]);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-[#FAFBFC] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#2563EB] to-[#16A34A] flex items-center justify-center mx-auto mb-3 animate-pulse">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          </div>
          <p className="text-sm text-[#64748B]">Loading Shyft...</p>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-[#FAFBFC]">
        <ToastContainer />
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <Landing />
        </div>
      </div>
    );
  }

  const handleOnboardingComplete = () => {
    localStorage.setItem("shyft_onboarding_seen", "true");
    setShowOnboarding(false);
  };

  return (
    <>
      <ToastContainer />
      {showOnboarding && <OnboardingDemo onComplete={handleOnboardingComplete} />}
      {needsProfile && !showOnboarding && (
        <ProfileSetup onComplete={() => setNeedsProfile(false)} />
      )}
      <Sidebar />
      <div className="md:ml-64 h-screen flex flex-col bg-[#FAFBFC] overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4 md:p-6 pb-[80px] md:pb-6 pt-0">
          {activeTab === "feed" && (
            <div className="flex gap-6 max-w-5xl mx-auto">
              <div className="flex-1 min-w-0">
                <Feed />
              </div>
              <div className="hidden lg:block sticky top-0 self-start pt-0">
                <TrendingSidebar />
              </div>
            </div>
          )}
          {activeTab === "chat" && <Chat />}
          {activeTab === "friends" && <Friends />}
          {activeTab === "tokens" && <Tokens />}
          {activeTab === "stocks" && <Stocks />}
          {activeTab === "communities" && <Communities />}
          {activeTab === "quests" && <Quests />}
          {activeTab === "payments" && <Payments />}
          {activeTab === "market" && <Marketplace />}
          {activeTab === "dashboard" && <CreatorDashboard />}
          {activeTab === "ai" && <AI />}
          {activeTab === "profile" && <Profile />}
        </main>
      </div>
      <MobileNav />
      <FloatingAIButton />
    </>
  );
}
