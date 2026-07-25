"use client";

import { useState, useEffect, type ReactNode, type SyntheticEvent } from "react";
import { ExternalLink, Play, X } from "lucide-react";
import { useAppStore } from "@/lib/store";

/* ═══════════════════════════════════════════════════════════════
   RichContent — renders text with embedded links, images, videos
   Like X/Twitter: detect URLs, show inline image previews,
   clickable links, YouTube embeds, etc.
   ═══════════════════════════════════════════════════════════════ */

/* ── URL regex ── */
const URL_REGEX = /https?:\/\/[^\s<]+[^\s<.,;:!?"')\]]/gi;

/* ── @mention regex ── */
const MENTION_REGEX = /@([a-zA-Z0-9_]{1,30})/g;

/* ── $TICKER regex — matches $BONK, $SOL, $WIF etc. (2–10 letters, word boundary) ── */
const TICKER_REGEX = /\$([A-Za-z]{2,10})\b/g;

/* ═══ Ticker price cache ═══ */
type TickerData = { price: number; change24h: number; mint: string; name: string; image?: string; ts: number };
const tickerCache = new Map<string, TickerData>();
const pendingFetches = new Map<string, Promise<TickerData | null>>();
const TICKER_TTL = 60_000;

async function fetchTickerData(symbol: string): Promise<TickerData | null> {
  const cached = tickerCache.get(symbol);
  if (cached && Date.now() - cached.ts < TICKER_TTL) return cached;

  if (pendingFetches.has(symbol)) return pendingFetches.get(symbol)!;

  const promise = (async (): Promise<TickerData | null> => {
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      const pair = (data.pairs || []).find(
        (p: any) =>
          p.chainId === "solana" &&
          p.baseToken?.symbol?.toUpperCase() === symbol.toUpperCase()
      );
      if (!pair) return null;
      const entry: TickerData = {
        price: parseFloat(pair.priceUsd) || 0,
        change24h: pair.priceChange?.h24 || 0,
        mint: pair.baseToken.address,
        name: pair.baseToken.name,
        image: pair.info?.imageUrl,
        ts: Date.now(),
      };
      tickerCache.set(symbol, entry);
      return entry;
    } catch {
      return null;
    } finally {
      pendingFetches.delete(symbol);
    }
  })();

  pendingFetches.set(symbol, promise);
  return promise;
}

function formatTickerPrice(p: number): string {
  if (!p || p <= 0) return "";
  if (p >= 1000) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (p >= 1) return `$${p.toFixed(3)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  if (p >= 0.0001) return `$${p.toFixed(6)}`;
  return `$${p.toExponential(2)}`;
}

/* ═══ TickerChip — inline tradeable token pill ═══ */
function TickerChip({ symbol }: { symbol: string }) {
  const [data, setData] = useState<TickerData | null | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    fetchTickerData(symbol).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => { cancelled = true; };
  }, [symbol]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data || data === "loading") return;
    (window as any).__shyftTickerClick?.(symbol, data);
  };

  if (data === "loading") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 rounded-full border border-[#E2E8F0] bg-[#F8FAFC] text-[12px] font-bold text-[#94A3B8] animate-pulse align-middle">
        ${symbol}
      </span>
    );
  }

  if (!data) {
    return <span className="text-[#6366F1] font-semibold">${symbol}</span>;
  }

  const isUp = data.change24h >= 0;

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`${data.name} · click to trade`}
      className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 rounded-full border transition-all duration-150 cursor-pointer align-middle hover:scale-105 active:scale-95 hover:shadow-sm"
      style={{
        background: "linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 100%)",
        borderColor: "#C7D2FE",
      }}
    >
      {data.image && (
        <img
          src={data.image}
          alt=""
          className="w-3.5 h-3.5 rounded-full object-cover flex-shrink-0"
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
        />
      )}
      <span className="text-[12px] font-bold text-[#4F46E5] leading-none">${symbol}</span>
      {!!data.price && (
        <>
          <span className="text-[11px] text-[#64748B] leading-none font-medium">
            {formatTickerPrice(data.price)}
          </span>
          <span
            className="text-[10px] font-semibold leading-none"
            style={{ color: isUp ? "#16A34A" : "#DC2626" }}
          >
            {isUp ? "▲" : "▼"}{Math.abs(data.change24h).toFixed(1)}%
          </span>
        </>
      )}
    </button>
  );
}

/* ── Image extensions ── */
const IMAGE_EXTS = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;

/* ── Video extensions ── */
const VIDEO_EXTS = /\.(mp4|webm|ogg|mov)(\?.*)?$/i;

/* ── IPFS URLs (Pinata, etc.) ── */
const IPFS_URL = /\.mypinata\.cloud\/ipfs\/|ipfs\.io\/ipfs\/|cloudflare-ipfs\.com\/ipfs\/|gateway\.pinata\.cloud\/ipfs\//i;

/** Rewrite any IPFS gateway URL to the dedicated Pinata gateway to avoid the
 *  shared gateway.pinata.cloud rate limits (429s that hide media from users). */
const DEDICATED_IPFS_GATEWAY =
  process.env.NEXT_PUBLIC_PINATA_GATEWAY || "amethyst-secondary-orca-737.mypinata.cloud";
function normalizeIpfsUrl(url: string): string {
  const match = url.match(/\/ipfs\/([a-zA-Z0-9]+)(\/[^?#]*)?(\?.*)?$/i);
  if (match) {
    const cid = match[1];
    const path = match[2] || "";
    return `https://${DEDICATED_IPFS_GATEWAY}/ipfs/${cid}${path}`;
  }
  return url;
}
/** Ordered gateway fallbacks for an IPFS URL. The dedicated gateway is tried
 *  first (fast, no rate limits, serves our pinned content); public gateways
 *  follow so posts whose CIDs aren't in our Pinata account (old/orphaned/
 *  external uploads) still load instead of 403/404/429-ing. */
export function ipfsGatewayChain(url: string): string[] {
  const match = url.match(/\/ipfs\/([a-zA-Z0-9]+)(\/[^?#]*)?(\?.*)?$/i);
  if (!match) return [url];
  const cid = match[1];
  const path = match[2] || "";
  return [
    `https://${DEDICATED_IPFS_GATEWAY}/ipfs/${cid}${path}`,
    `https://ipfs.io/ipfs/${cid}${path}`,
    `https://dweb.link/ipfs/${cid}${path}`,
  ];
}

/** Drop-in onError handler for any <img> whose src is an IPFS gateway URL.
 *  Advances through the gateway fallback chain so orphaned CIDs (not pinned to
 *  our account, which 403 on the dedicated gateway) still load from a public
 *  gateway. Attach as onError={handleIpfsImgError}. */
export function handleIpfsImgError(e: SyntheticEvent<HTMLImageElement, Event>) {
  const img = e.currentTarget;
  const chain = ipfsGatewayChain(img.src);
  if (chain.length <= 1) return; // not an IPFS URL — nothing to fall back to
  const idx = chain.indexOf(img.src);
  const next = idx === -1 ? 1 : idx + 1;
  if (next < chain.length) img.src = chain[next];
}
/** IPFS URLs that are NOT videos — treat as images */
const IPFS_IMAGE_URL = { test: (u: string) => IPFS_URL.test(u) && !VIDEO_EXTS.test(u) };
/** IPFS URLs that ARE videos */
const IPFS_VIDEO_URL = { test: (u: string) => IPFS_URL.test(u) && VIDEO_EXTS.test(u) };

/* ── YouTube regex ── */
const YOUTUBE_REGEX = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

/* ── GIF services ── */
const GIF_DOMAINS = /giphy\.com|tenor\.com|imgur\.com/i;

interface RichContentProps {
  content: string;
  className?: string;
}

export function RichContent({ content, className = "" }: RichContentProps) {
  const urls = content.match(URL_REGEX) || [];
  const imageUrls = urls.filter((u) => IMAGE_EXTS.test(u) || GIF_DOMAINS.test(u) || IPFS_IMAGE_URL.test(u));
  const videoUrls = urls.filter((u) => VIDEO_EXTS.test(u) || IPFS_VIDEO_URL.test(u));
  const youtubeUrls = urls.map((u) => ({ url: u, match: u.match(YOUTUBE_REGEX) })).filter((x) => x.match);
  const linkUrls = urls.filter(
    (u) => !IMAGE_EXTS.test(u) && !VIDEO_EXTS.test(u) && !YOUTUBE_REGEX.test(u) && !IPFS_IMAGE_URL.test(u)
  );

  /* ── Render text with inline links and @mentions ── */
  const { navigateToProfile } = useAppStore();
  const renderText = () => {
    const parts: (string | ReactNode)[] = [];
    let lastIndex = 0;

    // Combined regex for URLs, @mentions, and $TICKERS
    const COMBINED_REGEX = new RegExp(
      `(${URL_REGEX.source})|(@[a-zA-Z0-9_]{1,30})|(\\$[A-Za-z]{2,10}\\b)`,
      "gi"
    );
    const matches = [...content.matchAll(COMBINED_REGEX)];

    for (const match of matches) {
      const fullMatch = match[0];
      const idx = match.index!;

      // Text before the match
      if (idx > lastIndex) {
        parts.push(content.slice(lastIndex, idx));
      }

      // $TICKER
      if (fullMatch.startsWith("$")) {
        const symbol = fullMatch.slice(1).toUpperCase();
        parts.push(<TickerChip key={`ticker-${idx}`} symbol={symbol} />);
        lastIndex = idx + fullMatch.length;
        continue;
      }

      // @mention
      if (fullMatch.startsWith("@")) {
        const username = fullMatch.slice(1);
        parts.push(
          <button
            key={`mention-${idx}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // Search profileMap isn't available here — use a global event to resolve
              // We'll emit a custom event that Feed listens for, or use the store
              // For now, navigate to feed search — but actually we can resolve via store
              // The mention click triggers a profile search by username
              (window as any).__shyftMentionClick?.(username);
            }}
            className="text-[#2563EB] font-semibold hover:underline cursor-pointer"
          >
            @{username}
          </button>
        );
        lastIndex = idx + fullMatch.length;
        continue;
      }

      // URL handling (same as before)
      const url = fullMatch;

      // If it's an image/video URL, don't show it inline as text (we'll show the media below)
      if (IMAGE_EXTS.test(url) || IPFS_IMAGE_URL.test(url) || VIDEO_EXTS.test(url) || IPFS_VIDEO_URL.test(url)) {
        lastIndex = idx + url.length;
        continue;
      }

      // Render the URL as a clickable link
      parts.push(
        <a
          key={idx}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#2563EB] hover:underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {formatUrlDisplay(url)}
        </a>
      );
      lastIndex = idx + url.length;
    }

    // Remaining text
    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    return parts;
  };

  return (
    <div className={className}>
      {/* Text content with inline links */}
      <p className="text-[15px] text-[#1A1A2E] leading-relaxed whitespace-pre-wrap break-words">
        {renderText()}
      </p>

      {/* Image previews */}
      {imageUrls.length > 0 && (
        <div className={`mt-3 rounded-2xl overflow-hidden border border-[#E2E8F0] ${
          imageUrls.length === 1 ? "" : "grid grid-cols-2 gap-0.5"
        }`}>
          {imageUrls.map((url, i) => (
            <ImagePreview key={i} url={IPFS_URL.test(url) ? normalizeIpfsUrl(url) : url} single={imageUrls.length === 1} />
          ))}
        </div>
      )}

      {/* YouTube embeds */}
      {youtubeUrls.map(({ url, match }, i) => (
        match && <YouTubeEmbed key={i} videoId={match[1]} />
      ))}

      {/* Video previews */}
      {videoUrls.map((url, i) => (
        <VideoPreview key={i} url={IPFS_URL.test(url) ? normalizeIpfsUrl(url) : url} />
      ))}

      {/* Link previews (for non-image, non-video URLs) */}
      {linkUrls.slice(0, 1).map((url, i) => (
        <LinkPreview key={i} url={url} />
      ))}
    </div>
  );
}

/* ═══ Image Preview ═══ */
function ImagePreview({ url, single }: { url: string; single: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [gwIdx, setGwIdx] = useState(0);

  const chain = ipfsGatewayChain(url);
  const src = chain[Math.min(gwIdx, chain.length - 1)];

  const handleError = () => {
    // Try the next gateway before giving up (covers 403/404/429 on any host).
    if (gwIdx < chain.length - 1) {
      setGwIdx((i) => i + 1);
    } else {
      setError(true);
    }
  };

  if (error) return null;

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="block relative bg-[#F1F5F9] cursor-pointer hover:opacity-95 transition-opacity"
      onClick={(e) => e.stopPropagation()}
    >
      {!loaded && (
        <div className={`${single ? "h-[220px] sm:h-[300px]" : "h-[160px] sm:h-[200px]"} animate-pulse bg-[#E2E8F0]`} />
      )}
      <img
        src={src}
        alt=""
        onLoad={() => setLoaded(true)}
        onError={handleError}
        className={`w-full object-cover ${
          single ? "max-h-[320px] sm:max-h-[500px]" : "h-[160px] sm:h-[200px]"
        } ${loaded ? "" : "hidden"}`}
      />
    </a>
  );
}

/* ═══ Video Preview ═══ */
function VideoPreview({ url }: { url: string }) {
  const [gwIdx, setGwIdx] = useState(0);
  const chain = ipfsGatewayChain(url);
  const src = chain[Math.min(gwIdx, chain.length - 1)];

  const handleError = () => {
    if (gwIdx < chain.length - 1) setGwIdx((i) => i + 1);
  };

  return (
    <div className="mt-3 rounded-2xl overflow-hidden border border-[#E2E8F0]">
      <video
        key={src}
        src={src}
        controls
        preload="metadata"
        onError={handleError}
        className="w-full max-h-[280px] sm:max-h-[400px] object-contain bg-black"
      />
    </div>
  );
}

/* ═══ YouTube Embed ═══ */
function YouTubeEmbed({ videoId }: { videoId: string }) {
  const [showEmbed, setShowEmbed] = useState(false);
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

  return (
    <div className="mt-3 rounded-2xl overflow-hidden border border-[#E2E8F0] relative">
      {showEmbed ? (
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
          className="w-full aspect-video"
          allow="autoplay; encrypted-media"
          allowFullScreen
        />
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setShowEmbed(true); }}
          className="w-full relative group"
        >
          <img
            src={thumbnailUrl}
            alt="YouTube video"
            className="w-full aspect-video object-cover"
            onError={(e) => {
              // Fall back to hqdefault if maxresdefault doesn't exist
              (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
            <div className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
              <Play className="w-7 h-7 text-white ml-1" fill="white" />
            </div>
          </div>
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-black/70 text-white text-xs px-2.5 py-1 rounded-lg">
            <Play className="w-3 h-3" fill="white" />
            YouTube
          </div>
        </button>
      )}
    </div>
  );
}

/* ═══ Link Preview ═══ */
function LinkPreview({ url }: { url: string }) {
  const [favicon, setFavicon] = useState<string | null>(null);

  useEffect(() => {
    try {
      const domain = new URL(url).hostname;
      setFavicon(`https://www.google.com/s2/favicons?domain=${domain}&sz=32`);
    } catch {}
  }, [url]);

  let domain = "";
  try {
    domain = new URL(url).hostname.replace("www.", "");
  } catch {}

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 flex items-center gap-3 px-4 py-3 rounded-2xl border border-[#E2E8F0] hover:bg-[#F8FAFC] transition-colors group"
      onClick={(e) => e.stopPropagation()}
    >
      {favicon && (
        <img
          src={favicon}
          alt=""
          className="w-5 h-5 rounded flex-shrink-0"
          onError={(e) => (e.target as HTMLImageElement).style.display = "none"}
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#1A1A2E] truncate group-hover:text-[#2563EB] transition-colors">
          {domain}
        </p>
        <p className="text-xs text-[#94A3B8] truncate">{url}</p>
      </div>
      <ExternalLink className="w-4 h-4 text-[#94A3B8] flex-shrink-0" />
    </a>
  );
}

/* ═══ Media Upload — uploads images & videos to /api/upload (Pinata IPFS) ═══ */

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const ALL_MEDIA_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES];

export function isVideoFile(file: File): boolean {
  return VIDEO_TYPES.includes(file.type);
}

export async function uploadMedia(file: File): Promise<string> {
  if (!ALL_MEDIA_TYPES.includes(file.type)) {
    throw new Error("Invalid file type. Use JPG, PNG, GIF, WebP, MP4, WebM, or MOV");
  }
  const maxSize = isVideoFile(file) ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error(`File too large. Max ${isVideoFile(file) ? "50MB" : "10MB"}`);
  }

  // For large files (> 4MB) or videos, upload directly to Pinata via signed URL
  // This bypasses Vercel's 4.5MB body limit on serverless functions
  const useDirectUpload = file.size > 4 * 1024 * 1024 || isVideoFile(file);

  if (useDirectUpload) {
    return uploadDirectToPinata(file);
  }

  // Small images go through our server-side route (simpler, same-origin)
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || !data.url) {
    throw new Error(data.error || "Upload failed");
  }

  return data.url;
}

/**
 * Direct upload to Pinata using a signed URL — bypasses Vercel's 4.5MB limit.
 * 1. GET /api/upload/signed-url → { signedUrl, gateway }
 * 2. POST file directly to signedUrl (Pinata's servers)
 * 3. Construct IPFS URL with CID + filename
 */
async function uploadDirectToPinata(file: File): Promise<string> {
  // Step 1: Get signed URL from our API
  const signRes = await fetch("/api/upload/signed-url");
  const signData = await signRes.json();
  if (!signRes.ok || !signData.signedUrl) {
    throw new Error(signData.error || "Failed to get upload URL");
  }

  const { signedUrl, gateway } = signData;

  // Step 2: Upload directly to Pinata
  const formData = new FormData();
  const safeName = file.name?.replace(/[^a-zA-Z0-9._-]/g, "_") || (isVideoFile(file) ? "video.mp4" : "image.png");
  formData.append("file", file, safeName);
  formData.append("network", "public");
  formData.append("name", safeName);

  const uploadRes = await fetch(signedUrl, {
    method: "POST",
    body: formData,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    console.error("Direct Pinata upload error:", errText);
    throw new Error("Video upload failed — please try again");
  }

  const uploadData = await uploadRes.json();
  const cid = uploadData?.data?.cid;
  if (!cid) {
    throw new Error("Upload succeeded but no CID returned");
  }

  // Step 3: Construct the IPFS URL with filename for extension detection
  return `https://${gateway}/ipfs/${cid}/${safeName}`;
}

/** @deprecated Use uploadMedia instead */
export const uploadImage = uploadMedia;

/* ═══ Helper: shorten URL for display ═══ */
function formatUrlDisplay(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 20 ? u.pathname.slice(0, 20) + "…" : u.pathname;
    return u.hostname.replace("www.", "") + (path !== "/" ? path : "");
  } catch {
    return url.length > 40 ? url.slice(0, 40) + "…" : url;
  }
}

/* ═══ Compose Media Bar ═══ */
export function MediaBar({
  onMediaSelected,
  onImageSelected,
  onUploading,
  disabled,
}: {
  onMediaSelected?: (url: string, file?: File) => void;
  /** @deprecated Use onMediaSelected */
  onImageSelected?: (url: string, file?: File) => void;
  onUploading?: (uploading: boolean) => void;
  disabled?: boolean;
}) {
  const handleSelect = (cb: (url: string, file?: File) => void) => cb;
  const notify = onMediaSelected || onImageSelected || (() => {});

  const handleImageSelect = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/gif,image/webp";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { alert("Image must be under 10MB"); return; }
      const reader = new FileReader();
      reader.onloadend = () => notify(reader.result as string, file);
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleVideoSelect = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/mp4,video/webm,video/quicktime";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) { alert("Video must be under 50MB"); return; }
      // Create a local object URL for video preview
      const url = URL.createObjectURL(file);
      notify(url, file);
    };
    input.click();
  };

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={handleImageSelect}
        disabled={disabled}
        className="p-2 rounded-full hover:bg-[#EBF4FF] text-[#2563EB] transition-colors disabled:opacity-40"
        title="Add photo"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 19.5V4.5a2.25 2.25 0 0 0-2.25-2.25H3.75A2.25 2.25 0 0 0 1.5 4.5v15a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
      </button>
      <button
        onClick={handleVideoSelect}
        disabled={disabled}
        className="p-2 rounded-full hover:bg-[#EBF4FF] text-[#2563EB] transition-colors disabled:opacity-40"
        title="Add video"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
      </button>
      <button
        disabled={disabled}
        className="p-2 rounded-full hover:bg-[#EBF4FF] text-[#2563EB] transition-colors disabled:opacity-40"
        title="Add GIF"
        onClick={handleImageSelect}
      >
        <svg className="w-5 h-5 font-bold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <rect x="2" y="4" width="20" height="16" rx="3" />
          <text x="12" y="14.5" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8" fontWeight="bold">GIF</text>
        </svg>
      </button>
    </div>
  );
}
