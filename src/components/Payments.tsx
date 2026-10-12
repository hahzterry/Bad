"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowUpRight, ArrowDownLeft, Shield, Lock, Send, DollarSign, ExternalLink, Eye, EyeOff, ChevronDown, Wallet, Check, RefreshCw, ToggleLeft, ToggleRight } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { usePrivatePayment } from "@/hooks/usePrivatePayment";
import { useMagicBlockPayment, type PaymentVisibility } from "@/hooks/useMagicBlockPayment";
import { useConnection, useWallet } from "@/hooks/usePrivyWallet";
import { PublicKey } from "@solana/web3.js";
import type { Payment } from "@/types";

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Payments() {
  const { payments: localPayments, isConnected } = useAppStore();
  const [showSendForm, setShowSendForm] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [paymentMode, setPaymentMode] = useState<"public" | "private">("public");
  const { sendPayment, step: paymentStep, error: paymentError, txSignature, reset: resetPayment } = usePrivatePayment();
  const { sendPrivatePayment, step: mbStep, error: mbError, txSignature: mbTxSignature, reset: resetMb } = useMagicBlockPayment();

  // Unified step/error/sig based on current mode
  const activeStep = paymentMode === "private" ? mbStep : paymentStep;
  const activeError = paymentMode === "private" ? mbError : paymentError;
  const activeTxSig = paymentMode === "private" ? mbTxSignature : txSignature;
  const activeReset = paymentMode === "private" ? resetMb : resetPayment;

  // Spendable balance for the selected mode. Without this the user only finds
  // out they have no USDC when the transaction fails.
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  const refreshBalances = useCallback(async () => {
    if (!publicKey || !connection) return;
    setLoadingBalance(true);
    try {
      const lamports = await connection.getBalance(publicKey);
      setSolBalance(lamports / 1e9);
      const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: USDC_MINT });
      const total = accounts.value.reduce(
        (sum, a) => sum + (a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0),
        0,
      );
      // No token account at all is a legitimate zero, not an error.
      setUsdcBalance(total);
    } catch {
      setSolBalance(null);
      setUsdcBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  }, [publicKey, connection]);

  useEffect(() => { refreshBalances(); }, [refreshBalances]);

  const activeBalance = paymentMode === "private" ? usdcBalance : solBalance;
  const activeSymbol = paymentMode === "private" ? "USDC" : "SOL";
  const insufficient =
    activeBalance !== null && amount !== "" && parseFloat(amount) > activeBalance;

  // Payment records from local state
  const [loadingOnChain, setLoadingOnChain] = useState(false);

  const loadOnChainPayments = useCallback(async () => {
    // Payments are tracked locally
    setLoadingOnChain(false);
  }, []);

  // Load on-chain payments on mount and when program becomes available
  useEffect(() => {
    if (isConnected) {
      loadOnChainPayments();
    }
  }, [isConnected, loadOnChainPayments]);

  // Reload after a payment is sent
  useEffect(() => {
    if (activeStep === "done") {
      const timer = setTimeout(() => loadOnChainPayments(), 3000);
      return () => clearTimeout(timer);
    }
  }, [activeStep, loadOnChainPayments]);

  // Use local payment records
  const allPayments = (() => {
    return [...localPayments].sort((a, b) => b.timestamp - a.timestamp);
  })();

  const totalSent = allPayments.filter((p) => p.sender === "me").reduce((sum, p) => sum + p.amount, 0);
  const totalReceived = allPayments.filter((p) => p.recipient === "me").reduce((sum, p) => sum + p.amount, 0);

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#EFF6FF] to-[#F0FDF4] flex items-center justify-center mx-auto mb-4">
            <Wallet className="w-8 h-8 text-[#2563EB]" />
          </div>
          <h3 className="text-lg font-bold text-[#1A1A2E] mb-2">Payments</h3>
          <p className="text-sm text-[#64748B]">Connect your wallet to send and receive payments</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-3 sm:space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-3.5 sm:p-5">
          <div className="flex items-center gap-2 mb-2 sm:mb-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#EFF6FF] flex items-center justify-center">
              <ArrowUpRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#2563EB]" />
            </div>
            <span className="text-[10px] sm:text-xs font-medium text-[#64748B]">Total Sent</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-[#1A1A2E]">{totalSent.toFixed(2)} <span className="text-xs sm:text-sm font-medium text-[#64748B]">SOL</span></p>
          <p className="text-[10px] text-[#16A34A] flex items-center gap-1 mt-1">
            <Shield className="w-2.5 h-2.5" /> On-chain transfers
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-3.5 sm:p-5">
          <div className="flex items-center gap-2 mb-2 sm:mb-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#F0FDF4] flex items-center justify-center">
              <ArrowDownLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#16A34A]" />
            </div>
            <span className="text-[10px] sm:text-xs font-medium text-[#64748B]">Received</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-[#1A1A2E]">{totalReceived.toFixed(2)} <span className="text-xs sm:text-sm font-medium text-[#64748B]">SOL</span></p>
          <p className="text-[10px] text-[#16A34A] flex items-center gap-1 mt-1">
            <Shield className="w-2.5 h-2.5" /> Received on-chain
          </p>
        </div>
      </div>

      {/* Send Payment */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
        <button
          onClick={() => setShowSendForm(!showSendForm)}
          className="touch-active w-full flex items-center justify-between px-4 sm:px-5 py-3.5 sm:py-4 hover:bg-[#F8FAFC] active:bg-[#F1F5F9] transition-colors"
        >
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-[#2563EB] to-[#16A34A] flex items-center justify-center flex-shrink-0">
              <Send className="w-4 h-4 text-white" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-[#1A1A2E]">Send Payment</p>
              <p className="text-[10px] sm:text-[11px] text-[#64748B]">Send SOL or private USDC to friends</p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-[#94A3B8] transition-transform flex-shrink-0 ${showSendForm ? "rotate-180" : ""}`} />
        </button>

        {showSendForm && (
          <div className="px-3.5 sm:px-5 pb-4 sm:pb-5 space-y-3 animate-fade-in border-t border-[#F1F5F9]">
            {/* Payment Mode Toggle */}
            <div className="pt-4">
              <label className="text-xs font-medium text-[#64748B] mb-2 block">Payment Mode</label>
              <div className="flex gap-2">
                <button
                  onClick={() => { setPaymentMode("public"); activeReset(); }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                    paymentMode === "public"
                      ? "bg-[#EFF6FF] border-[#2563EB] text-[#2563EB] shadow-sm"
                      : "bg-[#F8FAFC] border-[#E2E8F0] text-[#64748B] hover:bg-[#F1F5F9]"
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  Public (SOL)
                </button>
                <button
                  onClick={() => { setPaymentMode("private"); activeReset(); }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                    paymentMode === "private"
                      ? "bg-[#F0FDF4] border-[#16A34A] text-[#16A34A] shadow-sm"
                      : "bg-[#F8FAFC] border-[#E2E8F0] text-[#64748B] hover:bg-[#F1F5F9]"
                  }`}
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  Private (USDC)
                </button>
              </div>
              {paymentMode === "private" && (
                <p className="text-[10px] text-[#16A34A] mt-1.5 flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5" /> Powered by MagicBlock — privacy via ephemeral rollups
                </p>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-[#64748B] mb-1.5 block">Recipient Address</label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Enter Solana wallet address..."
                className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-[#64748B]">Amount</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[#64748B]">
                    {loadingBalance
                      ? "Loading…"
                      : activeBalance === null
                        ? "Balance unavailable"
                        : `Balance: ${activeBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${activeSymbol}`}
                  </span>
                  {activeBalance !== null && activeBalance > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmount(String(activeBalance))}
                      className="text-xs font-semibold text-[#2563EB] hover:underline"
                    >
                      Max
                    </button>
                  )}
                  <button type="button" onClick={refreshBalances} aria-label="Refresh balance">
                    <RefreshCw className={`w-3 h-3 text-[#94A3B8] ${loadingBalance ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>
              <div className={`flex items-center gap-2 bg-[#F8FAFC] border rounded-xl px-4 py-2.5 ${insufficient ? "border-[#DC2626]" : "border-[#E2E8F0]"}`}>
                <DollarSign className="w-4 h-4 text-[#94A3B8]" />
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-transparent text-sm focus:outline-none"
                />
                <span className="text-xs font-medium text-[#64748B]">{activeSymbol}</span>
              </div>
              {insufficient && (
                <p className="text-xs text-[#DC2626] mt-1.5">
                  Not enough {activeSymbol} — you have {activeBalance?.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </p>
              )}
              {paymentMode === "private" && usdcBalance === 0 && (
                <p className="text-xs text-[#64748B] mt-1.5">
                  No USDC in this wallet. Add USDC before sending a private payment.
                </p>
              )}
            </div>

            {/* Payment Flow visualization */}
            {paymentMode === "public" ? (
              <div className="bg-[#F8FAFC] rounded-xl p-4 space-y-2">
                <p className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">Payment Flow</p>
                <div className="flex items-center gap-2 text-xs text-[#475569]">
                  <span className="w-5 h-5 rounded-full bg-[#2563EB] text-white flex items-center justify-center text-[10px] font-bold">1</span>
                  <span>Send SOL directly on Solana</span>
                  <Lock className="w-3 h-3 text-[#16A34A] ml-auto" />
                </div>
                <div className="flex items-center gap-2 text-xs text-[#475569]">
                  <span className="w-5 h-5 rounded-full bg-[#7C3AED] text-white flex items-center justify-center text-[10px] font-bold">2</span>
                  <span>Record payment on-chain</span>
                  <Lock className="w-3 h-3 text-[#16A34A] ml-auto" />
                </div>
                <div className="flex items-center gap-2 text-xs text-[#475569]">
                  <span className="w-5 h-5 rounded-full bg-[#16A34A] text-white flex items-center justify-center text-[10px] font-bold">3</span>
                  <span>Confirmed on Solana</span>
                  <Shield className="w-3 h-3 text-[#16A34A] ml-auto" />
                </div>
              </div>
            ) : (
              <div className="bg-[#F0FDF4]/50 rounded-xl p-4 space-y-2 border border-[#16A34A]/10">
                <p className="text-[10px] font-semibold text-[#16A34A] uppercase tracking-wider flex items-center gap-1">
                  <EyeOff className="w-2.5 h-2.5" /> Private Payment Flow
                </p>
                <div className="flex items-center gap-2 text-xs text-[#475569]">
                  <span className="w-5 h-5 rounded-full bg-[#16A34A] text-white flex items-center justify-center text-[10px] font-bold">1</span>
                  <span>Build private tx via MagicBlock</span>
                  <Lock className="w-3 h-3 text-[#16A34A] ml-auto" />
                </div>
                <div className="flex items-center gap-2 text-xs text-[#475569]">
                  <span className="w-5 h-5 rounded-full bg-[#16A34A] text-white flex items-center justify-center text-[10px] font-bold">2</span>
                  <span>Sign &amp; send through ephemeral rollup</span>
                  <EyeOff className="w-3 h-3 text-[#16A34A] ml-auto" />
                </div>
                <div className="flex items-center gap-2 text-xs text-[#475569]">
                  <span className="w-5 h-5 rounded-full bg-[#16A34A] text-white flex items-center justify-center text-[10px] font-bold">3</span>
                  <span>USDC arrives — amount hidden on-chain</span>
                  <Shield className="w-3 h-3 text-[#16A34A] ml-auto" />
                </div>
              </div>
            )}

            {/* Payment Status */}
            {activeStep !== "idle" && activeStep !== "done" && activeStep !== "error" && (
              <div className={`rounded-xl p-4 space-y-2 animate-fade-in ${paymentMode === "private" ? "bg-[#F0FDF4]" : "bg-[#EFF6FF]"}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-4 h-4 border-2 border-t-transparent rounded-full animate-spin ${paymentMode === "private" ? "border-[#16A34A]" : "border-[#2563EB]"}`} />
                  <span className={`text-sm font-medium ${paymentMode === "private" ? "text-[#16A34A]" : "text-[#2563EB]"}`}>
                    {paymentMode === "private" ? (
                      <>
                        {activeStep === "building" && "Building private transaction..."}
                        {activeStep === "signing" && "Sign to approve private transfer..."}
                        {activeStep === "sending" && "Sending through MagicBlock..."}
                        {activeStep === "confirming" && "Confirming private transfer..."}
                      </>
                    ) : (
                      <>
                        {activeStep === "sending" && "Sending SOL payment..."}
                        {activeStep === "confirming" && "Confirming transaction..."}
                        {activeStep === "recording" && "Recording payment on-chain..."}
                        {activeStep === "finalizing" && "Finalizing..."}
                      </>
                    )}
                  </span>
                </div>
                <div className="flex gap-1">
                  {paymentMode === "private" ? (
                    <>
                      <div className={`h-1.5 flex-1 rounded-full ${["building", "signing", "sending", "confirming"].includes(activeStep) ? "bg-[#16A34A]" : "bg-[#E2E8F0]"}`} />
                      <div className={`h-1.5 flex-1 rounded-full ${["signing", "sending", "confirming"].includes(activeStep) ? "bg-[#16A34A]" : "bg-[#E2E8F0]"}`} />
                      <div className={`h-1.5 flex-1 rounded-full ${["sending", "confirming"].includes(activeStep) ? "bg-[#16A34A]" : "bg-[#E2E8F0]"}`} />
                      <div className={`h-1.5 flex-1 rounded-full ${activeStep === "confirming" ? "bg-[#16A34A]" : "bg-[#E2E8F0]"}`} />
                    </>
                  ) : (
                    <>
                      <div className={`h-1.5 flex-1 rounded-full ${["sending", "confirming", "recording", "finalizing"].includes(activeStep) ? "bg-[#2563EB]" : "bg-[#E2E8F0]"}`} />
                      <div className={`h-1.5 flex-1 rounded-full ${["confirming", "recording", "finalizing"].includes(activeStep) ? "bg-[#7C3AED]" : "bg-[#E2E8F0]"}`} />
                      <div className={`h-1.5 flex-1 rounded-full ${["recording", "finalizing"].includes(activeStep) ? "bg-[#7C3AED]" : "bg-[#E2E8F0]"}`} />
                      <div className={`h-1.5 flex-1 rounded-full ${activeStep === "finalizing" ? "bg-[#16A34A]" : "bg-[#E2E8F0]"}`} />
                    </>
                  )}
                </div>
              </div>
            )}

            {activeStep === "done" && activeTxSig && (
              <div className="bg-[#F0FDF4] rounded-xl p-4 animate-fade-in">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-full bg-[#16A34A] flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                  <span className="text-sm font-semibold text-[#15803D]">
                    {paymentMode === "private" ? "Private Payment Sent!" : "Payment Sent!"}
                  </span>
                  {paymentMode === "private" && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-[#16A34A] bg-[#DCFCE7] px-1.5 py-0.5 rounded-full">
                      <EyeOff className="w-2 h-2" /> Private
                    </span>
                  )}
                </div>
                <a
                  href={`https://explorer.solana.com/tx/${activeTxSig}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#2563EB] hover:underline flex items-center gap-1"
                >
                  View on Explorer <ExternalLink className="w-3 h-3" />
                </a>
                <button onClick={activeReset} className="mt-2 text-xs text-[#64748B] hover:text-[#1A1A2E]">
                  Send another payment
                </button>
              </div>
            )}

            {activeStep === "error" && activeError && (
              <div className="bg-red-50 rounded-xl p-4 animate-fade-in">
                <p className="text-sm text-red-600 font-medium">Payment failed</p>
                <p className="text-xs text-red-500 mt-1">{activeError}</p>
                <button onClick={activeReset} className="mt-2 text-xs text-[#2563EB] hover:underline">
                  Try again
                </button>
              </div>
            )}

            <button
              onClick={() => {
                if (paymentMode === "private") {
                  sendPrivatePayment(recipient, parseFloat(amount), "private");
                } else {
                  sendPayment(recipient, parseFloat(amount));
                }
              }}
              disabled={!recipient || !amount || !["idle", "done", "error"].includes(activeStep)}
              className={`w-full py-3 text-white text-sm font-semibold rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md ${
                paymentMode === "private"
                  ? "bg-gradient-to-r from-[#16A34A] to-[#059669]"
                  : "bg-gradient-to-r from-[#2563EB] to-[#16A34A]"
              }`}
            >
              {["building", "signing", "sending", "confirming", "recording", "finalizing"].includes(activeStep)
                ? paymentMode === "private"
                  ? activeStep === "building" ? "Building Private Tx..."
                    : activeStep === "signing" ? "Waiting for Signature..."
                    : activeStep === "confirming" ? "Confirming..."
                    : "Processing..."
                  : activeStep === "recording" ? "Recording on-chain..."
                    : activeStep === "finalizing" ? "Finalizing..."
                    : "Processing..."
                : paymentMode === "private"
                  ? `Send Private ${amount || "0"} USDC`
                  : "Send Payment"
              }
            </button>
            <p className="text-[10px] text-center text-[#94A3B8] flex items-center justify-center gap-1">
              {paymentMode === "private" ? (
                <><EyeOff className="w-2.5 h-2.5" /> Private USDC transfer via MagicBlock</>
              ) : (
                <><Shield className="w-2.5 h-2.5" /> Payment recorded on Solana</>
              )}
            </p>
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
        <button
          onClick={() => setShowHowItWorks(!showHowItWorks)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#F8FAFC] transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] flex items-center justify-center">
              <Eye className="w-4 h-4 text-[#2563EB]" />
            </div>
            <p className="text-sm font-semibold text-[#1A1A2E]">How Payments Work</p>
          </div>
          <ChevronDown className={`w-4 h-4 text-[#94A3B8] transition-transform ${showHowItWorks ? "rotate-180" : ""}`} />
        </button>

        {showHowItWorks && (
          <div className="px-5 pb-5 border-t border-[#F1F5F9] pt-4 animate-fade-in">
            <div className="space-y-4">
              {/* Public Payment */}
              <div className="mb-3">
                <p className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider mb-3 flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Public Payments (SOL)
                </p>
                <div className="space-y-3 pl-1">
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-[#2563EB]">1</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#1A1A2E]">Direct SOL Transfer</p>
                      <p className="text-xs text-[#64748B] mt-0.5">SOL is sent directly to your friend&apos;s wallet on Solana. Fast, secure, and cost-effective.</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-[#2563EB]">2</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#1A1A2E]">Payment Recorded On-Chain</p>
                      <p className="text-xs text-[#64748B] mt-0.5">The payment is recorded as a message in your chat so both participants can see the transaction history.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-[#E2E8F0]" />

              {/* Private Payment */}
              <div>
                <p className="text-[10px] font-semibold text-[#16A34A] uppercase tracking-wider mb-3 flex items-center gap-1">
                  <EyeOff className="w-3 h-3" /> Private Payments (USDC via MagicBlock)
                </p>
                <div className="space-y-3 pl-1">
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#F0FDF4] flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-[#16A34A]">1</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#1A1A2E]">Private Transaction Built</p>
                      <p className="text-xs text-[#64748B] mt-0.5">MagicBlock&apos;s API builds a privacy-preserving USDC transfer using ephemeral rollups (TEE-based).</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#F0FDF4] flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-[#16A34A]">2</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#1A1A2E]">Sign &amp; Send</p>
                      <p className="text-xs text-[#64748B] mt-0.5">You sign the transaction — USDC is transferred with the amount hidden from on-chain observers.</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#F0FDF4] flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-[#16A34A]">3</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#1A1A2E]">Recipient Gets USDC</p>
                      <p className="text-xs text-[#64748B] mt-0.5">USDC arrives in the recipient&apos;s wallet. The transfer amount stays private — only sender and receiver know.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-[#F8FAFC] rounded-xl p-3 mt-2">
                <p className="text-xs text-[#64748B]">
                  <span className="font-semibold text-[#1A1A2E]">Your Keys, Your Funds:</span> All payments are user-to-user. <span className="text-[#16A34A] font-medium">You pay the fees, you sign the transaction — no middleman</span>.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Payment History */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0]">
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-[#F1F5F9] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#1A1A2E]">Transaction History</h3>
            <p className="text-[10px] sm:text-[11px] text-[#64748B]">All payments recorded on Solana</p>
          </div>
          <button
            onClick={loadOnChainPayments}
            disabled={loadingOnChain}
            className="p-2 rounded-lg hover:bg-[#F8FAFC] transition-colors disabled:opacity-50"
            title="Refresh from blockchain"
          >
            <RefreshCw className={`w-4 h-4 text-[#64748B] ${loadingOnChain ? "animate-spin" : ""}`} />
          </button>
        </div>
        {loadingOnChain && allPayments.length === 0 && (
          <div className="px-5 py-8 text-center">
            <div className="w-5 h-5 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs text-[#64748B]">Loading payment records from blockchain...</p>
          </div>
        )}
        <div className="divide-y divide-[#F1F5F9]">
          {allPayments.map((payment) => {
            const isSent = payment.sender === "me";
            return (
              <div key={payment.id} className="flex items-center gap-2.5 sm:gap-3 px-3.5 sm:px-5 py-3 sm:py-3.5 hover:bg-[#F8FAFC] transition-colors">
                <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  isSent ? "bg-[#EFF6FF]" : "bg-[#F0FDF4]"
                }`}>
                  {isSent ? (
                    <ArrowUpRight className="w-4 h-4 text-[#2563EB]" />
                  ) : (
                    <ArrowDownLeft className="w-4 h-4 text-[#16A34A]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                    <p className="text-sm font-medium text-[#1A1A2E]">
                      {isSent ? "Sent" : "Received"} {payment.amount.toFixed(2)} {payment.token}
                    </p>
                    {payment.isPrivate && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-[#16A34A] bg-[#F0FDF4] px-1.5 py-0.5 rounded-full">
                        <Lock className="w-2 h-2" /> Private
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#94A3B8] truncate">
                    {isSent ? `To: ${payment.recipient}` : `From: ${payment.sender}`} · {timeAgo(payment.timestamp)}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${isSent ? "text-[#1A1A2E]" : "text-[#16A34A]"}`}>
                    {isSent ? "-" : "+"}{payment.amount.toFixed(2)}
                  </p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    payment.status === "completed"
                      ? "bg-[#F0FDF4] text-[#16A34A]"
                      : "bg-[#FEF3C7] text-[#D97706]"
                  }`}>
                    {payment.status}
                  </span>
                </div>
              </div>
            );
          })}
          {!loadingOnChain && allPayments.length === 0 && (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-[#94A3B8]">No payment records yet</p>
              <p className="text-xs text-[#CBD5E1] mt-1">Send a payment to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
