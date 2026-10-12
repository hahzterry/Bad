import { Metadata } from "next";
import { Connection, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
import idl from "@/lib/idl.json";

const PROGRAM_ID = new PublicKey("EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ");
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY_PRIVATE}`;

const PROFILE_SEED = Buffer.from("profile");
const POST_SEED = Buffer.from("post");

function toLEBytes(num: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, BigInt(num), true);
  return new Uint8Array(buf);
}

function getProfilePda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PROFILE_SEED, owner.toBuffer()], PROGRAM_ID);
}

function getPostPda(author: PublicKey, postId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([POST_SEED, author.toBuffer(), toLEBytes(postId)], PROGRAM_ID);
}

const IPFS_GATEWAY =
  (process.env.PINATA_GATEWAY || process.env.NEXT_PUBLIC_PINATA_GATEWAY || "amethyst-secondary-orca-737.mypinata.cloud").trim();
function expandIpfs(content: string): string {
  if (!content) return "";
  return content.replace(
    /\b(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-zA-Z0-9]{50,})\b/g,
    (cid) => `https://${IPFS_GATEWAY}/ipfs/${cid}`
  );
}

interface Props {
  params: Promise<{ key: string }>;
}

async function fetchPostData(author: string, postId: number) {
  try {
    const connection = new Connection(RPC_URL, "confirmed");
    const dummyKeypair = PublicKey.default;
    const provider = new AnchorProvider(
      connection,
      { publicKey: dummyKeypair, signTransaction: async (tx: any) => tx, signAllTransactions: async (txs: any) => txs } as any,
      { commitment: "confirmed" }
    );
    const program = new Program(idl as Idl, provider);

    const authorPk = new PublicKey(author);
    const [postPda] = getPostPda(authorPk, postId);
    const [profilePda] = getProfilePda(authorPk);

    const post = await (program.account as any).post.fetch(postPda);
    let profile = null;
    try {
      profile = await (program.account as any).profile.fetch(profilePda);
    } catch {}

    return { post, profile };
  } catch {
    return null;
  }
}

function parseContent(rawContent: string): { displayContent: string; isPaid: boolean } {
  if (rawContent.startsWith("PAID|")) {
    return { displayContent: "🔒 This is a paid post — unlock it on Shyft to view", isPaid: true };
  }
  if (rawContent.startsWith("COMM|")) {
    const parts = rawContent.split("|");
    return { displayContent: parts.slice(2).join("|") || rawContent, isPaid: false };
  }
  if (rawContent.startsWith("RT|")) {
    const parts = rawContent.split("|");
    return { displayContent: `🔁 Repost from ${parts[1]}: ${parts.slice(2).join("|")}`, isPaid: false };
  }
  return { displayContent: rawContent, isPaid: false };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  // Key format: "author-postId" (base58 pubkey dash number)
  const dashIdx = key.lastIndexOf("-");
  if (dashIdx === -1) {
    return { title: "Post — Shyft" };
  }

  const author = key.slice(0, dashIdx);
  const postId = parseInt(key.slice(dashIdx + 1));

  if (isNaN(postId)) {
    return { title: "Post — Shyft" };
  }

  const data = await fetchPostData(author, postId);
  if (!data) {
    return {
      title: "Post not found — Shyft",
      description: "This post doesn't exist or was deleted.",
    };
  }

  const username = data.profile?.username || author.slice(0, 8);
  const { displayContent, isPaid } = parseContent(data.post.content || "");
  const cleanText = expandIpfs(displayContent)
    .replace(/https?:\/\/[^\s]+/g, "")
    .trim()
    .slice(0, 200);

  const likes = Number(data.post.likes || 0);
  const comments = Number(data.post.commentCount || 0);

  const title = `@${username} on Shyft`;
  const description = isPaid
    ? `🔒 Paid post by @${username} — unlock on Shyft to view`
    : cleanText || `Post by @${username} on Shyft`;

  const ogImageUrl = `https://baddie.stream/api/post-card?username=${encodeURIComponent(username)}&content=${encodeURIComponent(cleanText.slice(0, 160))}&likes=${likes}&comments=${comments}`;

  // Blink action URL for Solana wallets
  const actionUrl = `https://baddie.stream/api/actions/post?author=${author}&postId=${postId}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
      type: "website",
      siteName: "Shyft",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
    other: {
      // Dialect / Blinks uses these to discover the Action URL
      "dscvr:canvas:version": "vNext",
      "og:url": `https://baddie.stream/post/${author}-${postId}`,
    },
  };
}

export default async function PostPage({ params }: Props) {
  const { key } = await params;
  const dashIdx = key.lastIndexOf("-");

  let author = "";
  let postId = 0;
  let data: Awaited<ReturnType<typeof fetchPostData>> = null;

  if (dashIdx !== -1) {
    author = key.slice(0, dashIdx);
    postId = parseInt(key.slice(dashIdx + 1));
    if (!isNaN(postId)) {
      data = await fetchPostData(author, postId);
    }
  }

  const username = data?.profile?.username || author.slice(0, 8) || "unknown";
  const rawContent = data?.post?.content || "";
  const { displayContent, isPaid } = parseContent(rawContent);
  const expanded = expandIpfs(displayContent);
  const cleanText = expanded.replace(/https?:\/\/[^\s]+/g, "").trim();
  const likes = Number(data?.post?.likes || 0);
  const comments = Number(data?.post?.commentCount || 0);

  // Extract images from content
  const imgMatches = expanded.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/gi) || [];

  const actionApiUrl = author && postId
    ? `solana-action:https://baddie.stream/api/actions/post?author=${author}&postId=${postId}`
    : null;

  return (
    <html>
      <head>
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            background: #0A0A0F; 
            color: #E2E8F0; 
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 24px;
          }
          .card {
            background: #111118;
            border: 1px solid #1E293B;
            border-radius: 16px;
            max-width: 560px;
            width: 100%;
            padding: 32px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          }
          .header {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 24px;
          }
          .avatar {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: #1E293B;
            border: 2px solid #2563EB;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            font-weight: 700;
            color: #2563EB;
            overflow: hidden;
          }
          .avatar img { width: 100%; height: 100%; object-fit: cover; }
          .username {
            font-size: 18px;
            font-weight: 700;
            color: #FFFFFF;
          }
          .subtitle {
            font-size: 13px;
            color: #64748B;
          }
          .content {
            font-size: 16px;
            line-height: 1.6;
            color: #CBD5E1;
            margin-bottom: 20px;
            word-break: break-word;
          }
          .post-image {
            width: 100%;
            border-radius: 12px;
            margin-bottom: 20px;
            max-height: 300px;
            object-fit: cover;
          }
          .stats {
            display: flex;
            gap: 24px;
            padding: 16px 0;
            border-top: 1px solid #1E293B;
            margin-bottom: 20px;
          }
          .stat { font-size: 14px; color: #94A3B8; }
          .stat strong { color: #FFFFFF; }
          .actions {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
          }
          .btn {
            display: inline-block;
            padding: 10px 20px;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.2s;
          }
          .btn-primary {
            background: #2563EB;
            color: white;
          }
          .btn-primary:hover { background: #1D4ED8; }
          .btn-secondary {
            background: #1E293B;
            color: #94A3B8;
          }
          .btn-secondary:hover { background: #334155; color: #E2E8F0; }
          .blink-label {
            font-size: 11px;
            color: #475569;
            text-align: center;
            margin-top: 16px;
          }
          .brand {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid #1E293B;
          }
          .brand-name {
            font-size: 14px;
            font-weight: 800;
            color: #2563EB;
            letter-spacing: -0.5px;
          }
          .brand-sub {
            font-size: 12px;
            color: #475569;
          }
        `}</style>
      </head>
      <body>
        <div className="card">
          <div className="header">
            <div className="avatar">
              {username.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="username">@{username}</div>
              <div className="subtitle">on Shyft — On-Chain Social</div>
            </div>
          </div>

          {isPaid ? (
            <div className="content" style={{ color: "#94A3B8", fontStyle: "italic" }}>
              🔒 This is a paid post — unlock it on Shyft to view the full content
            </div>
          ) : (
            <div className="content">{cleanText || "Check out this post on Shyft!"}</div>
          )}

          {imgMatches.length > 0 && !isPaid && (
            <img className="post-image" src={imgMatches[0]} alt="Post media" />
          )}

          <div className="stats">
            <div className="stat">❤️ <strong>{likes}</strong> likes</div>
            <div className="stat">💬 <strong>{comments}</strong> comments</div>
          </div>

          <div className="actions">
            <a href="https://baddie.stream" className="btn btn-primary">
              Open on Shyft →
            </a>
            {actionApiUrl && (
              <a href={actionApiUrl} className="btn btn-secondary">
                💸 Tip Creator
              </a>
            )}
          </div>

          {actionApiUrl && (
            <div className="blink-label">
              Tip this creator directly with any Solana wallet
            </div>
          )}

          <div className="brand">
            <span className="brand-name">SHYFT</span>
            <span className="brand-sub">Powered by Solana</span>
          </div>
        </div>
      </body>
    </html>
  );
}
