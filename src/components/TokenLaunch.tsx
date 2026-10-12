"use client";

import { useState } from "react";
import {
  Plus,
  Coins,
  X,
  Loader2,
  ExternalLink,
  Image as ImageIcon,
  Upload,
  DollarSign,
  Info,
  CheckCircle2,
  AlertCircle,
  Users,
  AtSign,
  Wallet,
  Check,
} from "lucide-react";
import { useWallet, pollConfirmation, getSharedConnection } from "@/hooks/usePrivyWallet";
import { toast } from "@/components/Toast";
import { uploadImage } from "@/components/RichContent";
import { VersionedTransaction, Transaction, PublicKey } from "@solana/web3.js";
import { BAGS_REF_CODE, resolveFeeWallet, type FeeProvider, type ResolvedFeeWallet } from "@/lib/bags";
import {
  LAUNCHPAD,
  LAUNCHPAD_TERMS,
  LAUNCH_RENT_SOL,
  uploadMetadata,
  buildLaunchTx,
} from "@/lib/launchpad";
import { buildKickstartLaunch, sendKickstartLaunch } from "@/lib/easya";

/**
 * Which launchpad launches go through:
 *   "shyft"  — our own Meteora DBC config; fees come to the Shyft treasury
 *   "easya"  — EasyA Kickstart, where $SHYFT itself launched; fees go to EasyA
 *   "bags"   — the original Bags.fm path, kept for rollback
 */
const USE_EASYA = LAUNCHPAD === "easya";
const USE_SHYFT_LAUNCHPAD = LAUNCHPAD !== "bags" && !USE_EASYA;

const FEE_PROVIDERS: { value: FeeProvider; label: string }[] = [
  { value: "twitter", label: "X / Twitter" },
  { value: "tiktok", label: "TikTok" },
  { value: "kick", label: "Kick" },
  { value: "github", label: "GitHub" },
];

interface TokenLaunchProps {
  onClose: () => void;
  onSuccess?: (tokenMint: string) => void;
  username?: string;
  /**
   * Pre-fills the launch form — used by "Launch as coin" on a post so the
   * creator only has to confirm. Any field left undefined falls back to the
   * username-based defaults.
   */
  prefill?: {
    name?: string;
    symbol?: string;
    description?: string;
    imageUrl?: string;
    twitter?: string;
  };
}

function friendlyError(msg: string): string {
  if (!msg) return "Something went wrong";
  const lower = msg.toLowerCase();
  if (lower.includes("insufficient lamports") || lower.includes("insufficient funds") || lower.includes("0x1"))
    return "Insufficient SOL balance. Please top up your wallet.";
  if (lower.includes("user rejected") || lower.includes("user denied"))
    return "Transaction cancelled.";
  if (lower.includes("blockhash") || lower.includes("expired"))
    return "Transaction expired. Please try again.";
  if (msg.length > 100) return msg.slice(0, 80) + "…";
  return msg;
}

export default function TokenLaunch({ onClose, onSuccess, username, prefill }: TokenLaunchProps) {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const [step, setStep] = useState<"form" | "creating" | "launching" | "success">("form");
  const [name, setName] = useState(prefill?.name ?? (username ? `${username}` : ""));
  const [symbol, setSymbol] = useState(prefill?.symbol ?? (username ? username.toUpperCase().slice(0, 6) : ""));
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [imageUrl, setImageUrl] = useState(prefill?.imageUrl ?? "");
  const [twitter, setTwitter] = useState(prefill?.twitter ?? "");
  const [website, setWebsite] = useState("");
  const [initialBuy, setInitialBuy] = useState("0");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [result, setResult] = useState<{ tokenMint: string; metadataUrl: string } | null>(null);
  const [error, setError] = useState("");

  // Fee recipient — by default the creator earns 100% of trading fees,
  // but they can direct a share (or all) of it to another user.
  const [feeMode, setFeeMode] = useState<"me" | "other">("me");
  const [recipientType, setRecipientType] = useState<"handle" | "wallet">("handle");
  const [recipientProvider, setRecipientProvider] = useState<FeeProvider>("twitter");
  const [recipientHandle, setRecipientHandle] = useState("");
  const [recipientWallet, setRecipientWallet] = useState("");
  const [recipientShare, setRecipientShare] = useState(100);
  const [resolvedRecipient, setResolvedRecipient] = useState<ResolvedFeeWallet | null>(null);
  const [resolvingRecipient, setResolvingRecipient] = useState(false);

  const handleVerifyHandle = async () => {
    const handle = recipientHandle.trim().replace(/^@/, "");
    if (!handle) {
      setError("Enter a handle to verify");
      return;
    }
    setResolvingRecipient(true);
    setError("");
    setResolvedRecipient(null);
    try {
      const r = await resolveFeeWallet(handle, recipientProvider);
      setResolvedRecipient(r);
      toast("success", "Recipient found!");
    } catch (e: any) {
      setError(friendlyError(e.message || "Couldn't find a wallet for that handle"));
    }
    setResolvingRecipient(false);
  };

  // Build the fee-share split sent to Bags. Sums to 10,000 bps (100%).
  const buildFeeClaimers = (creatorWallet: string): Array<{ wallet: string; bps: number }> => {
    if (feeMode === "me") {
      return [{ wallet: creatorWallet, bps: 10000 }];
    }

    let recipient: string;
    if (recipientType === "wallet") {
      recipient = recipientWallet.trim();
      try {
        new PublicKey(recipient);
      } catch {
        throw new Error("Enter a valid recipient wallet address");
      }
    } else {
      if (!resolvedRecipient) throw new Error("Verify the recipient's handle first");
      recipient = resolvedRecipient.wallet;
    }

    const recBps = Math.round(recipientShare * 100);
    if (recBps <= 0 || recBps > 10000) {
      throw new Error("Recipient share must be between 1% and 100%");
    }
    const creatorBps = 10000 - recBps;

    // If the recipient is the creator's own wallet, collapse to a single claimer.
    if (recipient === creatorWallet) {
      return [{ wallet: creatorWallet, bps: 10000 }];
    }

    const claimers: Array<{ wallet: string; bps: number }> = [];
    if (creatorBps > 0) claimers.push({ wallet: creatorWallet, bps: creatorBps });
    claimers.push({ wallet: recipient, bps: recBps });
    return claimers;
  };

  const handleImageSelect = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5MB");
      return;
    }
    setImageFile(file);
    setUploadingImage(true);
    setError("");
    try {
      const url = await uploadImage(file);
      setImageUrl(url);
    } catch (err: any) {
      setError("Failed to upload image. Try again.");
      setImageFile(null);
    }
    setUploadingImage(false);
  };

  /**
   * Launch on Shyft's own bonding curve.
   *
   * Two steps instead of Bags' four: pin the metadata, then sign ONE
   * transaction that creates the pool and — if an initial buy was entered —
   * buys in the same breath, so no sniper can take the first entry. The
   * creator funds it themselves; only trading is sponsored. Being the pool's
   * on-chain creator is what entitles them to their share of trading fees.
   */
  const launchOnShyft = async () => {
    if (!publicKey || !signTransaction) return;
    setStep("creating");

    try {
      const { uri } = await uploadMetadata({
        name,
        symbol,
        description,
        imageUrl,
        twitter: twitter || undefined,
        website: website || undefined,
      });

      setStep("launching");

      const { transaction, tokenMint } = await buildLaunchTx({
        wallet: publicKey.toBase58(),
        name,
        symbol,
        uri,
        firstBuyLamports: String(Math.floor(Number(initialBuy || 0) * 1e9)),
      });

      toast("info", "Approve to launch your token...");

      // The treasury and mint keypair already signed server-side; the creator's
      // signature is the last one missing, so this is a legacy Transaction.
      const tx = Transaction.from(Buffer.from(transaction, "base64"));
      const signed = await signTransaction(tx);

      const connection = getSharedConnection();
      const sig = await connection.sendRawTransaction(signed.serialize());
      await pollConfirmation(connection, sig);

      setResult({ tokenMint, metadataUrl: uri });
      setStep("success");
      toast("success", "Token launched");
      onSuccess?.(tokenMint);
    } catch (err: any) {
      console.error("Shyft launch error:", err);
      const msg = friendlyError(err.message);
      setError(msg);
      setStep("form");
      toast("error", msg);
    }
  };

  /**
   * Launch on EasyA Kickstart.
   *
   * Kickstart builds and broadcasts; we only add the creator's signature. The
   * transaction must be signed exactly as received — rebuilding it or adding
   * instructions invalidates the signature EasyA already attached.
   */
  const launchOnKickstart = async () => {
    if (!publicKey || !signTransaction) return;
    setStep("launching");

    try {
      const { transaction, tokenMint, metadataUrl } = await buildKickstartLaunch({
        wallet: publicKey.toBase58(),
        name,
        symbol,
        imageUrl,
        description: description || undefined,
        website: website || undefined,
        twitter: twitter || undefined,
        initialBuySol: Number(initialBuy || 0) || undefined,
      });

      toast("info", "Approve to launch your token...");

      const tx = Transaction.from(Buffer.from(transaction, "base64"));
      const signed = await signTransaction(tx);
      // Their blockhash expires in ~1 minute, so hand it straight back.
      await sendKickstartLaunch({
        signedTransaction: signed
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
        mint: tokenMint,
        wallet: publicKey.toBase58(),
      });

      setResult({ tokenMint, metadataUrl });
      setStep("success");
      toast("success", "Token launched on Kickstart");
      onSuccess?.(tokenMint);
    } catch (err: any) {
      console.error("Kickstart launch error:", err);
      const msg = friendlyError(err.message);
      setError(msg);
      setStep("form");
      toast("error", msg);
    }
  };

  const handleLaunch = async () => {
    if (!publicKey || !signTransaction || !signAllTransactions) {
      toast("error", "Connect your wallet first");
      return;
    }
    if (!name || !symbol || !description || !imageUrl) {
      setError("Please fill in all required fields");
      return;
    }

    setError("");

    if (USE_EASYA) {
      await launchOnKickstart();
      return;
    }
    if (USE_SHYFT_LAUNCHPAD) {
      await launchOnShyft();
      return;
    }

    // Resolve the fee split up front so a bad recipient fails before any tx.
    let feeClaimers: Array<{ wallet: string; bps: number }>;
    try {
      feeClaimers = buildFeeClaimers(publicKey.toBase58());
    } catch (err: any) {
      setError(friendlyError(err.message));
      return;
    }

    setStep("creating");

    try {
      // Step 1: Create token info + metadata via Bags API
      const infoRes = await fetch("/api/bags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-token-info",
          name, symbol, description, imageUrl,
          twitter: twitter || undefined,
          website: website || undefined,
        }),
      });
      const infoData = await infoRes.json();
      if (!infoData.success) throw new Error(infoData.error || "Failed to create token info");

      const { tokenMint, metadataUrl } = infoData.response;
      toast("success", "Token metadata created!");

      // Step 2: Create fee share config + launch tx, then batch sign
      setStep("launching");

      const connection = getSharedConnection();

      // Create fee share config (returns unsigned txs)
      const configRes = await fetch("/api/bags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-config",
          payerWallet: publicKey.toBase58(),
          tokenMint,
          feeClaimers,
        }),
      });
      const configData = await configRes.json();
      if (!configData.success) throw new Error(configData.error || "Failed to create fee config");

      // Sign & send config transactions (required before launch)
      const configTxs = (configData.response.transactions || []).map((b64: string) =>
        VersionedTransaction.deserialize(Buffer.from(b64, "base64"))
      );

      if (configTxs.length > 0) {
        toast("info", "Approve transaction to set up token...");
        const signedConfigTxs = await signAllTransactions(configTxs);
        for (const signed of signedConfigTxs) {
          const sig = await connection.sendRawTransaction(signed.serialize());
          await pollConfirmation(connection, sig);
        }
      }

      // Create launch transaction (now config exists on-chain)
      // Pass the per-token configKey from create-config — it already has partner info baked in
      const launchRes = await fetch("/api/bags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-launch-tx",
          metadataUrl, tokenMint,
          launchWallet: publicKey.toBase58(),
          initialBuyLamports: Math.floor(Number(initialBuy) * 1e9),
          configKey: configData.response.configKey,
        }),
      });
      const launchData = await launchRes.json();
      if (!launchData.success) throw new Error(launchData.error || "Failed to create launch tx");

      toast("info", "Approve transaction to launch token...");
      const launchTx = VersionedTransaction.deserialize(
        Buffer.from(launchData.response.unsignedTxBase64, "base64")
      );
      const signedLaunch = await signTransaction(launchTx);
      const launchSig = await connection.sendRawTransaction(signedLaunch.serialize());
      await pollConfirmation(connection, launchSig);

      setResult({ tokenMint, metadataUrl });
      setStep("success");
      toast("success", "Token launched");
      onSuccess?.(tokenMint);
    } catch (err: any) {
      console.error("Token launch error:", err);
      const msg = friendlyError(err.message);
      setError(msg);
      setStep("form");
      toast("error", msg);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-[#E2E8F0]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#E2E8F0]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#2563EB] to-[#7C3AED] flex items-center justify-center">
              <Plus className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#1A1A2E]">Launch Creator Token</h2>
              <p className="text-xs text-[#64748B]">
                {USE_EASYA
                  ? "Powered by EasyA Kickstart"
                  : USE_SHYFT_LAUNCHPAD
                    ? `${LAUNCHPAD_TERMS.tradeFeePercent}% trading fee · you earn ${LAUNCHPAD_TERMS.creatorPercentOfVolume}% of volume`
                    : "Powered by Bags.fm"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#F1F5F9] rounded-lg transition">
            <X className="w-5 h-5 text-[#94A3B8]" />
          </button>
        </div>

        {/* Success State */}
        {step === "success" && result && (
          <div className="p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-[#F0FDF4] flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-[#16A34A]" />
            </div>
            <h3 className="text-xl font-bold text-[#1A1A2E] mb-2">Token Launched</h3>
            <p className="text-sm text-[#64748B] mb-4">Your creator token is now live on Solana</p>

            <div className="bg-[#F8FAFC] rounded-xl p-4 mb-4 text-left border border-[#E2E8F0]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[#64748B]">Token Mint</span>
                <span className="text-xs font-mono text-[#475569]">
                  {result.tokenMint.slice(0, 8)}...{result.tokenMint.slice(-8)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#64748B]">Symbol</span>
                <span className="text-sm font-bold text-[#2563EB]">${symbol}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <a
                href={
                  USE_EASYA
                    ? `https://kickstart.easya.io/token/${result.tokenMint}`
                    : USE_SHYFT_LAUNCHPAD
                      ? `https://dexscreener.com/solana/${result.tokenMint}`
                      : `https://bags.fm/${result.tokenMint}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-[#2563EB] text-white rounded-xl font-medium text-sm hover:bg-[#1D4ED8] transition"
              >
                {USE_EASYA ? "View on Kickstart" : USE_SHYFT_LAUNCHPAD ? "View chart" : "View on Bags"} <ExternalLink className="w-4 h-4" />
              </a>
              <button
                onClick={onClose}
                className="flex-1 py-2.5 px-4 border border-[#E2E8F0] rounded-xl font-medium text-sm hover:bg-[#F8FAFC] transition text-[#475569]"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Loading States */}
        {(step === "creating" || step === "launching") && (
          <div className="p-6 text-center">
            <Loader2 className="w-12 h-12 text-[#2563EB] animate-spin mx-auto mb-4" />
            <h3 className="text-lg font-bold text-[#1A1A2E] mb-2">
              {step === "creating" ? "Creating Token Metadata..." : "Launching Token..."}
            </h3>
            <p className="text-sm text-[#64748B]">
              {step === "creating"
                ? USE_SHYFT_LAUNCHPAD
                  ? "Pinning your token's metadata to IPFS"
                  : "Setting up your token on Bags.fm"
                : USE_EASYA
                  ? "Building your launch on Kickstart — please approve the transaction"
                  : "Deploying to Solana — please approve the transaction"}
            </p>
          </div>
        )}

        {/* Form */}
        {step === "form" && (
          <div className="p-5 space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <span className="text-sm text-red-600">{error}</span>
              </div>
            )}

            {/* Launched from a post — reassure it's pre-filled, just review & launch */}
            {prefill && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <Coins className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span className="text-xs text-amber-700">
                  We filled this in from your post — review the name and symbol, then launch.
                </span>
              </div>
            )}

            {/* Token Name */}
            <div>
              <label className="text-xs font-medium text-[#64748B] mb-1.5 block">Token Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Shaan Token"
                className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-2.5 text-sm text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
              />
            </div>

            {/* Symbol */}
            <div>
              <label className="text-xs font-medium text-[#64748B] mb-1.5 block">Symbol *</label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-[#94A3B8]">$</span>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
                  placeholder="e.g. SHAAN"
                  maxLength={6}
                  className="w-full pl-7 pr-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl py-2.5 text-sm font-mono text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="text-xs font-medium text-[#64748B] mb-1.5 block">Description *</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell people about your token..."
                rows={3}
                className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-2.5 text-sm text-[#1A1A2E] resize-none focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
              />
            </div>

            {/* Token Image */}
            <div>
              <label className="text-xs font-medium text-[#64748B] mb-1.5 block">Token Image *</label>
              {imageUrl ? (
                <div className="flex items-center gap-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3">
                  <div className="w-14 h-14 rounded-xl border-2 border-[#2563EB]/20 overflow-hidden shrink-0">
                    <img src={imageUrl} alt="Token" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#475569] truncate">{imageFile?.name || "Image uploaded"}</p>
                    <button
                      type="button"
                      onClick={() => { setImageUrl(""); setImageFile(null); }}
                      className="text-xs text-red-500 hover:text-red-600 mt-1"
                    >
                      Remove & choose another
                    </button>
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-amber-300 bg-amber-50/40 rounded-xl cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageSelect(file);
                    }}
                  />
                  {uploadingImage ? (
                    <>
                      <Loader2 className="w-6 h-6 text-[#2563EB] animate-spin mb-1" />
                      <span className="text-xs text-[#64748B]">Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-6 h-6 text-amber-500 mb-1" />
                      <span className="text-sm font-medium text-[#475569]">Add a coin image to launch</span>
                      <span className="text-xs text-[#94A3B8] mt-0.5">PNG, JPG, GIF — max 5MB</span>
                    </>
                  )}
                </label>
              )}
            </div>

            {/* Social Links */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-medium text-[#64748B] mb-1 block">Twitter (optional)</label>
                <input
                  type="url"
                  value={twitter}
                  onChange={(e) => setTwitter(e.target.value)}
                  placeholder="https://x.com/..."
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-[#64748B] mb-1 block">Website (optional)</label>
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                />
              </div>
            </div>

            {/* Initial Buy — available on both launchpads */}
            <div>
              <label className="text-xs font-medium text-[#64748B] mb-1.5 block">Initial Buy (SOL) — optional</label>
              <p className="text-[10px] text-[#94A3B8] mb-2">
                {USE_SHYFT_LAUNCHPAD
                  ? "Buy your own token in the same transaction as the launch, so nobody can get in before you. Set to 0 to skip."
                  : "Buy some of your own token at launch. Set to 0 if you don't want to."}
              </p>
              <div className="flex items-center gap-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-2.5">
                <DollarSign className="w-4 h-4 text-[#94A3B8]" />
                <input
                  type="number"
                  value={initialBuy}
                  onChange={(e) => setInitialBuy(e.target.value)}
                  min="0"
                  step="0.01"
                  className="flex-1 bg-transparent text-sm text-[#1A1A2E] focus:outline-none"
                />
                <span className="text-xs font-medium text-[#64748B]">SOL</span>
              </div>
            </div>

            {/*
              A custom fee recipient is Bags-only — Shyft's config fixes the
              split on-chain, so offering a choice would imply otherwise.
            */}
            {!USE_SHYFT_LAUNCHPAD && (
            <>
            {/* Fee Recipient */}
            <div>
              <label className="text-xs font-medium text-[#64748B] mb-1.5 block">Trading Fee Recipient</label>
              <p className="text-[10px] text-[#94A3B8] mb-2">Choose who earns the trading fees from this token.</p>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setFeeMode("me")}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition ${
                    feeMode === "me"
                      ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]"
                      : "border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B] hover:border-[#CBD5E1]"
                  }`}
                >
                  <Wallet className="w-4 h-4" /> I earn the fees
                </button>
                <button
                  type="button"
                  onClick={() => setFeeMode("other")}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition ${
                    feeMode === "other"
                      ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]"
                      : "border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B] hover:border-[#CBD5E1]"
                  }`}
                >
                  <Users className="w-4 h-4" /> Someone else
                </button>
              </div>

              {feeMode === "other" && (
                <div className="space-y-3 p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl">
                  {/* Recipient type toggle */}
                  <div className="flex gap-1 p-1 bg-[#EEF2F7] rounded-lg">
                    <button
                      type="button"
                      onClick={() => { setRecipientType("handle"); setResolvedRecipient(null); }}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition ${
                        recipientType === "handle" ? "bg-white text-[#1A1A2E] shadow-sm" : "text-[#64748B]"
                      }`}
                    >
                      <AtSign className="w-3.5 h-3.5" /> Social handle
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRecipientType("wallet"); setResolvedRecipient(null); }}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition ${
                        recipientType === "wallet" ? "bg-white text-[#1A1A2E] shadow-sm" : "text-[#64748B]"
                      }`}
                    >
                      <Wallet className="w-3.5 h-3.5" /> Wallet address
                    </button>
                  </div>

                  {recipientType === "handle" ? (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <select
                          value={recipientProvider}
                          onChange={(e) => { setRecipientProvider(e.target.value as FeeProvider); setResolvedRecipient(null); }}
                          className="bg-white border border-[#E2E8F0] rounded-lg px-2 py-2 text-xs text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                        >
                          {FEE_PROVIDERS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                        <div className="relative flex-1">
                          <span className="absolute left-2.5 top-2 text-[#94A3B8] text-sm">@</span>
                          <input
                            type="text"
                            value={recipientHandle}
                            onChange={(e) => { setRecipientHandle(e.target.value); setResolvedRecipient(null); }}
                            placeholder="username"
                            className="w-full pl-6 pr-3 bg-white border border-[#E2E8F0] rounded-lg py-2 text-xs text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleVerifyHandle}
                          disabled={resolvingRecipient || !recipientHandle.trim()}
                          className="px-3 py-2 bg-[#2563EB] text-white rounded-lg text-xs font-medium hover:bg-[#1D4ED8] transition disabled:opacity-50 flex items-center gap-1"
                        >
                          {resolvingRecipient ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Verify"}
                        </button>
                      </div>

                      {resolvedRecipient && (
                        <div className="flex items-center gap-2 p-2 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg">
                          {resolvedRecipient.platformData?.avatar_url ? (
                            <img src={resolvedRecipient.platformData.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-[#16A34A]/10 flex items-center justify-center">
                              <Check className="w-4 h-4 text-[#16A34A]" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-[#166534] truncate">
                              {resolvedRecipient.platformData?.display_name || resolvedRecipient.platformData?.username || "Verified"}
                            </p>
                            <p className="text-[10px] font-mono text-[#16A34A] truncate">
                              {resolvedRecipient.wallet.slice(0, 6)}...{resolvedRecipient.wallet.slice(-6)}
                            </p>
                          </div>
                          <Check className="w-4 h-4 text-[#16A34A] shrink-0" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={recipientWallet}
                      onChange={(e) => setRecipientWallet(e.target.value)}
                      placeholder="Recipient's Solana wallet address"
                      className="w-full bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-xs font-mono text-[#1A1A2E] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                    />
                  )}

                  {/* Split */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-medium text-[#64748B]">They earn</label>
                      <span className="text-xs font-bold text-[#2563EB]">{recipientShare}%</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={recipientShare}
                      onChange={(e) => setRecipientShare(Number(e.target.value))}
                      className="w-full accent-[#2563EB]"
                    />
                    <p className="text-[10px] text-[#94A3B8] mt-1">
                      You keep {100 - recipientShare}% · They get {recipientShare}% of all trading fees
                    </p>
                  </div>
                </div>
              )}
            </div>
            </>
            )}

            {/* Info Banner */}
            <div className="flex items-start gap-2 p-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl">
              <Info className="w-4 h-4 text-[#2563EB] shrink-0 mt-0.5" />
              <div className="text-xs text-[#1D4ED8]">
                <p className="font-medium mb-0.5">How it works</p>
                {USE_SHYFT_LAUNCHPAD ? (
                  <p className="text-[#3B82F6]">
                    {LAUNCHPAD_TERMS.totalSupply.toLocaleString()} tokens go straight onto a bonding
                    curve. Every trade pays a {LAUNCHPAD_TERMS.tradeFeePercent}% fee, of which you
                    earn {LAUNCHPAD_TERMS.creatorFeeShare}% — {LAUNCHPAD_TERMS.creatorPercentOfVolume}%
                    of everything traded, forever. At {LAUNCHPAD_TERMS.graduationSol} SOL raised your
                    token graduates to {LAUNCHPAD_TERMS.migratesTo} with locked liquidity.
                  </p>
                ) : USE_EASYA ? (
                  <p className="text-[#3B82F6]">
                    Your token launches on EasyA Kickstart — the same launchpad $SHYFT launched on —
                    with a bonding curve. Your initial buy happens in the same transaction, so nobody
                    can get in before you. You earn a share of every trade.
                  </p>
                ) : (
                  <p className="text-[#3B82F6]">Your token launches on Bags.fm with a bonding curve. When people trade your token, you earn fees forever.</p>
                )}
              </div>
            </div>

            {/* Launch Button */}
            <button
              onClick={handleLaunch}
              disabled={!name || !symbol || !description || !imageUrl || !publicKey}
              className="w-full py-3 px-4 bg-gradient-to-r from-[#2563EB] to-[#7C3AED] text-white rounded-xl font-semibold text-sm hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {USE_EASYA ? "Launch on Kickstart" : USE_SHYFT_LAUNCHPAD ? "Launch Token" : "Launch Token on Bags"}
            </button>
            <p className="text-center text-[10px] text-[#94A3B8] mt-2">
              {USE_EASYA ? (
                `You pay the one-time launch cost (~${LAUNCH_RENT_SOL} SOL of network rent)${Number(initialBuy) > 0 ? ` + your ${initialBuy} SOL initial buy` : ""} from your wallet.`
              ) : USE_SHYFT_LAUNCHPAD ? (
                `You pay the one-time launch cost (~${LAUNCH_RENT_SOL} SOL of network rent) from your wallet.`
              ) : (
                <>You pay the one-time launch cost (~0.02 SOL network + rent){Number(initialBuy) > 0 ? ` + ${initialBuy} SOL initial buy` : ""} from your wallet.</>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
