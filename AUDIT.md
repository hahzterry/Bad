# Shyft — Comprehensive Feature Audit

> Audited: All source files across components, hooks, lib, types, API routes, app routes, and the on-chain Solana program (`programs/shadowspace/src/lib.rs`)

---

## 1. Architecture Overview

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 14 (App Router), React, Tailwind CSS |
| **State** | Zustand (persisted to localStorage) |
| **Auth** | Privy (email, Google, Twitter, Solana wallet, embedded wallets) |
| **Blockchain** | Solana Mainnet via Anchor |
| **Program ID** | `EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ` |
| **RPC** | Helius Mainnet (proxied via `/api/rpc`) |
| **Media** | Pinata (IPFS) — images up to 10MB, videos up to 50MB |
| **Token Launch** | Bags.fm API (bonding curves, fee configs, swap) |
| **Private Payments** | MagicBlock (TEE-based ephemeral rollups, USDC) |
| **Encryption** | NaCl Box (X25519-XSalsa20-Poly1305) via tweetnacl |
| **Charts** | Recharts (AreaChart, BarChart, PieChart) |
| **Gasless UX** | Treasury-sponsored transactions via `/api/build-tx` server route |

---

## 2. Complete Feature List by Component

### 2.1 On-Chain Program (Solana / Anchor) — `lib.rs` (1,063 lines)

**11 PDA account types:** Profile, Post, Comment, Reaction, Chat, Message, FollowAccount, Community, Membership, Poll, PollVote

**Instructions implemented:**
| Instruction | Status |
|---|---|
| `create_profile` | ✅ Complete — init_if_needed, re-init guard |
| `migrate_profile` | ✅ Complete — realloc for schema changes |
| `update_profile` | ✅ Complete — display_name, bio, avatar_url, banner_url |
| `create_post` | ✅ Complete — 500 char max, public/private flag |
| `like_post` | ✅ Complete — increments counter (no unlike) |
| `create_comment` | ✅ Complete — 100 char max, linked to post |
| `react_to_post` | ✅ Complete — 1 reaction per user per post |
| `create_chat` | ✅ Complete — 2-party, participant constraint |
| `send_message` | ✅ Complete — 512 char max, payment flag |
| `create_community` | ✅ Complete — 100 member cap |
| `join_community` | ✅ Complete — membership PDA |
| `leave_community` | ✅ Complete — closes membership, rent to treasury |
| `update_community` | ✅ Complete — creator-only |
| `close_community` | ✅ Complete — creator-only, rent to treasury |
| `create_poll` | ✅ Complete — 2-4 options, time-bounded (max 30 days) |
| `vote_poll` | ✅ Complete — PDA prevents double-voting |
| `close_poll` | ✅ Complete — creator-only |
| `follow_user` | ✅ Complete — updates counters on both profiles |
| `unfollow_user` | ✅ Complete — closes follow PDA, rent to treasury |
| `close_profile` | ✅ Complete — rent to treasury |
| `close_post` | ✅ Complete — decrements post_count |
| `close_comment` | ✅ Complete — decrements comment_count |
| `close_reaction` | ✅ Complete — rent to treasury |
| `close_chat` | ✅ Complete — user1 only |
| `close_message` | ✅ Complete — sender only |
| `admin_force_close` | ✅ Complete — hardcoded admin authority |

**Security features:**
- All close operations send rent to hardcoded `TREASURY_PUBKEY`
- Re-initialization guards on all `init_if_needed` accounts
- Separate `payer` account pattern for gasless UX
- Admin force close restricted to hardcoded `ADMIN_AUTHORITY`

---

### 2.2 Feed (`Feed.tsx` — 1,732 lines)

| Feature | Status | Details |
|---|---|---|
| Create text posts | ✅ | 200 char limit, on-chain via treasury-sponsored tx |
| Media upload (images) | ✅ | Via Pinata IPFS, inline preview |
| Media upload (videos) | ✅ | Direct upload to Pinata for >4MB, 50MB max |
| Paid posts | ✅ | `PAID|price|content` encoding, SOL unlock |
| Community posts | ✅ | `COMM|id|content` prefix, filtered from main feed |
| Reposts | ✅ | `RT|@author|content` format |
| Likes (on-chain) | ✅ | Increments counter, no unlike |
| Comments (on-chain) | ✅ | With delete (close_comment) |
| Reactions (6 emoji) | ✅ | ❤️🔥🚀😂👏💡, 1 per user, removable |
| Tipping | ✅ | Preset amounts (0.01-1 SOL) + custom, direct SOL transfer |
| Polls | ✅ | Create (2-4 options), vote, countdown timer, close |
| Post deletion | ✅ | Closes PDA, rent to treasury |
| Share as Blink | ✅ | Generates Solana Actions URL |
| "Flex" earnings | ✅ | Opens tipping OG card link |
| Auto-refresh | ✅ | Every 30 seconds |
| Notification focus | ✅ | Scrolls to post on notification click |
| @mention click | ✅ | Resolves username → profile navigation |
| Gold badge | ✅ | Hardcoded: "shaan", "shyft" |
| RichContent rendering | ✅ | URLs, images, videos, YouTube embeds, link previews |

---

### 2.3 Chat (`Chat.tsx` — 1,034 lines)

| Feature | Status | Details |
|---|---|---|
| Contact list | ✅ | From following list |
| Search contacts | ✅ | Filter by username/display name |
| Create chat | ✅ | On-chain chat PDA between two users |
| Send messages | ✅ | On-chain, max 512 chars |
| E2E encryption | ✅ | NaCl Box via `deriveEncryptionKeypair` |
| Key exchange | ✅ | Public keys published as `PUBKEY:` messages |
| Plaintext fallback | ✅ | Before key exchange completes |
| Message polling | ✅ | Every 15 seconds |
| In-chat payments | ✅ | Private USDC via MagicBlock |
| Payment rendering | ✅ | Shows amount, tx link, completion status |
| Unread badges | ✅ | Per-conversation count |
| Message decryption | ✅ | Auto-decrypt with stored keypair |

---

### 2.4 Profile (`Profile.tsx` — 1,393 lines)

| Feature | Status | Details |
|---|---|---|
| View own profile | ✅ | Twitter/X-style layout |
| View others' profiles | ✅ | Via `viewingProfile` state |
| Edit display name | ✅ | Max 24 chars |
| Edit bio | ✅ | Max 64 chars |
| Upload avatar | ✅ | Via Pinata IPFS |
| Upload banner | ✅ | Via Pinata IPFS |
| Follow / Unfollow | ✅ | On-chain with mutual detection |
| Follower count | ✅ | Real PDA-based count (not on-chain counter) |
| Following count | ✅ | Real PDA-based count |
| Posts tab | ✅ | With `ProfilePostCard` sub-component |
| Likes tab | ❌ Stub | "Coming soon" placeholder |
| Wallet section | ✅ | SOL balance, copy address, QR code |
| Export embedded key | ✅ | For Privy embedded wallets |
| Solana Explorer link | ✅ | Opens profile's wallet on explorer |
| Gold badge | ✅ | Hardcoded for "shaan", "shyft" |
| Follow list modal | ✅ | Verified followers, followers, following tabs |

---

### 2.5 Communities (`Communities.tsx` — 1,019 lines)

| Feature | Status | Details |
|---|---|---|
| List all communities | ✅ | With search filter |
| My communities section | ✅ | Separated from discover |
| Create community | ✅ | Name (32), description (128), avatar upload |
| Join community | ✅ | On-chain membership PDA |
| Leave community | ✅ | Closes membership PDA |
| Community detail view | ✅ | Header, feed, member list |
| Community feed | ✅ | Posts tagged with `COMM|id|` prefix |
| Post to community | ✅ | 480 char limit, auto-refresh 8s |
| Edit community | ✅ | Creator-only, description + avatar |
| Delete community | ✅ | Creator-only, with confirmation dialog |
| Member list | ✅ | With profile resolution, creator crown badge |
| 100 member cap | ✅ | Enforced on-chain + shown in UI |

---

### 2.6 Payments (`Payments.tsx` — 527 lines)

| Feature | Status | Details |
|---|---|---|
| Public SOL transfer | ✅ | Via `usePrivatePayment` hook |
| Private USDC transfer | ✅ | Via MagicBlock ephemeral rollup |
| Payment mode toggle | ✅ | Public SOL ↔ Private USDC |
| Step progress indicator | ✅ | Building → Signing → Sending → Confirming → Done |
| Transaction history | ⚠️ Partial | Local state only, not fetched from on-chain |
| How Payments Work section | ✅ | Explainer UI |
| Balance check | ✅ | Before sending |
| Recipient validation | ✅ | PublicKey parsing |

---

### 2.7 Token Launch (`TokenLaunch.tsx` — ~500 lines)

| Feature | Status | Details |
|---|---|---|
| Token creation form | ✅ | Name, symbol (6 max), description, image |
| Image upload to IPFS | ✅ | Via Pinata |
| Optional metadata | ✅ | Twitter URL, website URL |
| Initial buy (SOL) | ✅ | Optional initial purchase |
| 3-step launch flow | ✅ | Metadata → Fee config → Launch tx |
| Bags.fm integration | ✅ | Via `/api/bags` proxy |
| Referral code | ✅ | `BAGS_REF_CODE = "shyftlol"` (25% partner fee) |

---

### 2.8 Tokens (`Tokens.tsx` — ~500 lines)

| Feature | Status | Details |
|---|---|---|
| Discover tab | ✅ | Trending token feed from Bags API |
| My Tokens tab | ✅ | User's launched tokens |
| Earnings tab | ✅ | Claimable fees with multi-tx claiming |
| Token detail modal | ✅ | Embeds `TokenTrade` component |
| Creator info | ✅ | Resolved from Bags API |

---

### 2.9 Token Trade (`TokenTrade.tsx` — ~500 lines)

| Feature | Status | Details |
|---|---|---|
| Buy mode | ✅ | SOL amount presets (0.1, 0.5, 1, 5) |
| Sell mode | ✅ | Percentage presets (25%, 50%, 75%, 100%) |
| Real-time quotes | ✅ | Price impact display |
| Token balance check | ✅ | For sell mode |
| Trade execution | ✅ | Via Bags API swap endpoint |
| Route display | ✅ | Shows swap route from quote |

---

### 2.10 Friends / People (`Friends.tsx` — ~500 lines)

| Feature | Status | Details |
|---|---|---|
| Discover tab | ✅ | Search by username/display name with debounce |
| Following tab | ✅ | Users I follow |
| Followers tab | ✅ | Users following me |
| Follow / Unfollow | ✅ | On-chain with optimistic UI |
| Mutual detection | ✅ | "Mutual", "Following", "Follows you" badges |
| Navigate to profile | ✅ | Click to open profile |

---

### 2.11 Creator Dashboard (`CreatorDashboard.tsx` — 993 lines)

| Feature | Status | Details |
|---|---|---|
| Overview stat cards | ✅ | Total posts, likes, comments, SOL earned |
| Engagement chart (7 days) | ✅ | Likes + comments area chart (Recharts) |
| Earnings chart (7 days) | ✅ | Bar chart with daily SOL totals |
| Content mix pie chart | ✅ | Public vs private posts |
| Activity by day of week | ✅ | Bar chart |
| Post performance table | ✅ | Ranked by engagement, top 10 |
| Top engagers | ✅ | Top 5 users by interactions |
| Creator score | ✅ | 0-100 composite score with grade (S/A/B/C/D) |
| Posting heatmap | ✅ | 24-hour grid |
| Recent tips received | ✅ | From on-chain payment data |
| Creator insight | ✅ | Dynamic tip based on metrics |
| Posting streak | ✅ | Consecutive days counter |

---

### 2.12 Supporting Components

| Component | Lines | Status | Purpose |
|---|---|---|---|
| `Header.tsx` | ~280 | ✅ | Notification bell, theme toggle, wallet connect, profile check (3 retries) |
| `Sidebar.tsx` | ~130 | ✅ | Desktop nav (8 tabs), unread chat badge, social links |
| `MobileNav.tsx` | ~60 | ✅ | 6-tab bottom nav, unread chat badge, safe area padding |
| `Landing.tsx` | 507 | ✅ | Marketing page, feature carousel (4s auto-cycle), live on-chain stats, partner logos |
| `ProfileSetup.tsx` | ~250 | ✅ | First-time profile creation, username check (debounced), reserved usernames + invite codes |
| `OnboardingDemo.tsx` | ~200 | ✅ | 6-slide onboarding carousel (auto-advance 4s), skip/next buttons |
| `FollowListModal.tsx` | 377 | ✅ | Twitter/X-style modal with 3 tabs: verified followers, followers, following |
| `ProfileHoverCard.tsx` | ~160 | ✅ | Hover card with avatar, name, bio, follower/following counts, post count |
| `RichContent.tsx` | 472 | ✅ | URL detection, image previews, video players, YouTube embeds, @mention parsing, link previews |
| `ThemeProvider.tsx` | - | ✅ | Light/dark theme support |
| `Toast.tsx` | - | ✅ | Toast notification system |

---

### 2.13 Hooks

| Hook | Status | Purpose |
|---|---|---|
| `useProgram.ts` | ✅ | Creates `ShyftClient` from Anchor provider |
| `usePrivyWallet.ts` | ✅ | Bridges Privy → wallet-adapter interface (`useWallet`, `useConnection`, `useAnchorWallet`) |
| `usePrivatePayment.ts` | ✅ | Public SOL transfers with step tracking |
| `useMagicBlockPayment.ts` | ✅ | Private USDC via MagicBlock TEE, handles versioned + legacy tx, ephemeral vs base chain |
| `useNotifications.ts` | ✅ | Polls every 5s for comments, likes, reactions, follows, reposts, @mentions, tips |

---

### 2.14 State Management (`store.ts` — 322 lines)

| Store Slice | Status | Details |
|---|---|---|
| User state | ✅ | `currentUser`, `isConnected` |
| Feed (local) | ✅ | Posts, likes, comments (legacy local state) |
| Chat (local) | ✅ | Conversations, messages, payment messages |
| Payments (local) | ✅ | Payment records, status updates |
| On-chain interactions | ✅ | `onChainComments`, `likedPosts`, `unlockedPosts`, `postTips` |
| Navigation | ✅ | `activeTab`, `viewingProfile`, `navigateToProfile`, `focusPostKey` |
| Theme | ✅ | Light/dark with `toggleTheme` |
| Notifications | ✅ | Up to 100, sorted by timestamp, `seenNotificationKeys` for dedup |
| Persistence | ✅ | Zustand `persist` middleware (localStorage) |

---

### 2.15 Encryption (`encryption.ts` — 120 lines)

| Feature | Status | Details |
|---|---|---|
| Key derivation | ✅ | Wallet signature → SHA-256 → X25519 keypair |
| Message encryption | ✅ | `ENC:{nonce}:{ciphertext}` format |
| Message decryption | ✅ | NaCl box.open with sender's pubkey |
| Key exchange format | ✅ | `PUBKEY:{base64}` on-chain message |
| Type guards | ✅ | `isEncryptedMessage()`, `isPubkeyMessage()` |

---

### 2.16 API Routes

| Route | Purpose |
|---|---|
| `/api/rpc` | Helius RPC proxy (hides API key) |
| `/api/build-tx` | Server-side tx construction with treasury payer (gasless) |
| `/api/upload` | Image upload to Pinata (server-side, <4MB) |
| `/api/upload/signed-url` | Signed URL for direct Pinata upload (>4MB, videos) |
| `/api/bags` | Proxy to Bags.fm API for token operations |
| `/api/stats` | On-chain stats for landing page |
| `/api/actions/post` | Solana Actions/Blinks endpoint for posts |
| `/api/actions/resolve` | Resolve Solana Actions |
| `/api/post-card` | OG image generation for post sharing |
| `/api/tip-card` | OG image for tip sharing |
| `/api/tips-received` | Query tips received by wallet |

### 2.17 App Routes

| Route | Purpose |
|---|---|
| `/` (`page.tsx`) | Main SPA — Landing (unauthenticated) or tabbed app (authenticated) |
| `/docs` | Full documentation page (590 lines) |
| `/chat/[id]` | Deep link to specific chat |
| `/post/[key]` | Deep link to specific post |
| `/tip` | Tip sharing page with OG metadata for X/Twitter |
| `/feed`, `/profile`, `/payments` | Empty directories (routing handled client-side via tabs) |

---

## 3. Notable Gaps for a Social Platform

### 3.1 Missing Core Features

| Gap | Severity | Notes |
|---|---|---|
| **No unlike/unllike** | Medium | `like_post` only increments — no decrement instruction. Users can't undo likes. |
| **No post editing** | Medium | Posts are immutable once created. Only option is delete + recreate. |
| **No DM group chats** | Medium | Chat is strictly 1-to-1. The on-chain `Chat` struct only has `user1`/`user2`. |
| **No image/media in chat** | Low | Chat only supports text + encrypted text + payment messages. |
| **No bookmark/save posts** | Low | Common social feature entirely missing. |
| **No hashtag system** | Low | No hashtag parsing, trending topics, or hashtag search. |
| **No content moderation** | High | No reporting, blocking, or content filtering mechanism at all. |
| **No block/mute** | High | Users cannot block or mute other users. |
| **No search across posts** | Medium | Feed has no search. Only Friends tab has user search. |
| **No trending/algorithm** | Low | Feed is purely reverse-chronological. No trending, recommended, or algorithmic feed. |
| **No push notifications** | Medium | Only polling-based in-app notifications. No web push, no mobile push. |
| **No email notifications** | Low | No email for mentions, follows, etc. |

### 3.2 Missing Token/Financial Features

| Gap | Severity | Notes |
|---|---|---|
| **No token-gated content** | Medium | Tokens exist but aren't used for gating access to posts or communities. |
| **No subscription/recurring payments** | Low | Only one-time tips and payments. |
| **No payment history from on-chain** | Medium | Transaction history is local state only — lost on cache clear. |

### 3.3 Missing Infrastructure

| Gap | Severity | Notes |
|---|---|---|
| **No rate limiting on API routes** | High | `/api/build-tx`, `/api/upload`, `/api/rpc` have no rate limiting. |
| **No error boundary** | Medium | No React error boundary — unhandled errors crash the whole app. |
| **No SSR/SEO** | Low | Entire app is `"use client"` — no server-rendered content except `/docs` and `/tip`. |
| **No analytics/telemetry** | Low | No usage tracking beyond on-chain data. |
| **No PWA manifest** | Low | Has `appleWebApp` metadata but no full PWA manifest/service worker. |

---

## 4. Partially Built / Stubbed Features

| Feature | Location | Status | Details |
|---|---|---|---|
| **Profile "Likes" tab** | `Profile.tsx:979` | 🟡 Stub | Shows "Coming soon" placeholder — no infrastructure to query which posts a user has liked. |
| **Local feed state** | `store.ts` | 🟡 Legacy | `posts`, `addPost`, `toggleLike`, `addComment` in store are vestigial — all feed ops are on-chain now. |
| **GIF button** | `RichContent.tsx` MediaBar | 🟡 Fake | GIF button just opens image picker — no GIF search (Giphy/Tenor) integration. |
| **Private posts** | `Post.is_private` on-chain | 🟡 Partial | The `is_private` flag exists on-chain and in `create_post`, but the Feed UI doesn't filter or paywall based on it (paid posts use `PAID|` prefix encoding instead). |
| **Chat encryption key storage** | `Chat.tsx` | 🟡 Ephemeral | Encryption keypair is derived each session. If user doesn't sign the derivation message, they can't read old messages. No persistent key storage. |
| **Community member auto-join** | `Communities.tsx` | 🟡 Gap | Creator auto-joins (member_count starts at 1) but no on-chain membership PDA is created for the creator. The UI shows them as a member via `isCreatorOf` check. |

---

## 5. Quality & UX Issues

### 5.1 Performance Concerns

| Issue | Location | Impact |
|---|---|---|
| **`getAllPosts()` / `getAllProfiles()` / `getAllComments()` called everywhere** | Feed, Chat, Profile, Dashboard, Communities, Notifications | Every component fetches ALL on-chain data. This will degrade badly with growth. No pagination, no cursor-based loading. |
| **Notification polling fetches entire state every 5s** | `useNotifications.ts` | 5 parallel `getAll*()` calls every 5 seconds. Extremely heavy RPC usage. |
| **Community feed fetches ALL posts then filters** | `Communities.tsx` CommunityFeed | Fetches every post in the program, then filters by `COMM|id|`. |
| **No caching strategy** | `clearRpcCache()` called frequently | Cache is cleared aggressively before most reads. |
| **CreatorDashboard loads everything** | `CreatorDashboard.tsx` | Fetches all posts, profiles, payments, comments, and reactions in parallel on mount. |

### 5.2 UX Issues

| Issue | Location | Impact |
|---|---|---|
| **200 char post limit** | `Feed.tsx` | Very restrictive for a social platform. On-chain allows 500 chars. |
| **No optimistic UI for posts** | `Feed.tsx` | Post doesn't appear until on-chain confirmation + next refresh cycle. |
| **No loading state between tabs** | `page.tsx` | Switching tabs remounts components, causing visible loading flashes. |
| **Edit modal duplicated** | `Communities.tsx` | The edit community modal code is fully duplicated between detail view and list view (~100 lines). |
| **Hardcoded color values** | All components | All colors are hardcoded hex values (e.g., `#2563EB`, `#1A1A2E`) instead of using CSS variables or Tailwind theme. Dark mode support is present via `ThemeProvider` but many components use hardcoded light-mode colors. |
| **@mention resolution via `window.__shyftMentionClick`** | `RichContent.tsx:80` | Global window hack for mention click handling — fragile and not React-idiomatic. |
| **No skeleton loading states** | Most components | Only `CreatorDashboard` has skeleton loaders. Others show blank or spinners. |

### 5.3 Security Considerations

| Issue | Location | Risk |
|---|---|---|
| **No input sanitization** | All text inputs | Post content, bios, usernames are stored as-is. XSS via rendered content is mitigated by React, but stored content could be malicious. |
| **Treasury keypair on server** | `/api/build-tx` | Treasury signs all sponsored transactions server-side. If the server is compromised, treasury funds are at risk. |
| **No content length validation on client** | Several forms | Some forms rely only on `maxLength` HTML attribute, not programmatic validation before submission. |
| **Payment history lost on cache clear** | `store.ts` (localStorage) | All payment records are in local Zustand store. Clearing browser data loses all history. |
| **Admin force close has no audit trail** | `lib.rs` | `admin_force_close` can close any program account with no on-chain record of what was closed or why. |

---

## 6. Integration Map

```
┌─────────────────────────────────────────────────────────┐
│                     page.tsx (SPA Router)                │
│   ┌─────────┐ ┌──────┐ ┌───────┐ ┌──────────┐          │
│   │Sidebar  │ │Header│ │Mobile │ │Onboarding│          │
│   │         │ │      │ │Nav    │ │Demo      │          │
│   └────┬────┘ └──┬───┘ └───┬───┘ └──────────┘          │
│        │         │         │                            │
│   ┌────▼─────────▼─────────▼──────────────────────┐     │
│   │               Active Tab Content               │     │
│   │                                                │     │
│   │  Feed ←→ RichContent, OnChainPostCard          │     │
│   │  Chat ←→ encryption.ts, useMagicBlockPayment   │     │
│   │  Profile ←→ FollowListModal, ProfileHoverCard  │     │
│   │  Friends                                       │     │
│   │  Tokens ←→ TokenLaunch, TokenTrade             │     │
│   │  Communities ←→ CommunityFeed, CommunityCard   │     │
│   │  Payments ←→ usePrivatePayment, useMagicBlock  │     │
│   │  Dashboard ←→ Recharts                         │     │
│   └────────────────────┬───────────────────────────┘     │
│                        │                                 │
│   ┌────────────────────▼───────────────────────────┐     │
│   │              Shared Infrastructure              │     │
│   │                                                │     │
│   │  useProgram() → ShyftClient → Anchor Program   │     │
│   │  usePrivyWallet() → Privy SDK                  │     │
│   │  useAppStore() → Zustand (persisted)           │     │
│   │  useNotifications() → polling (5s)             │     │
│   │  Toast system                                  │     │
│   └────────────────────┬───────────────────────────┘     │
└────────────────────────┼─────────────────────────────────┘
                         │
    ┌────────────────────▼───────────────────────────┐
    │              API Routes (Next.js)               │
    │                                                │
    │  /api/build-tx   → Treasury-signed txs         │
    │  /api/rpc        → Helius proxy                │
    │  /api/upload     → Pinata IPFS                 │
    │  /api/bags       → Bags.fm proxy               │
    │  /api/stats      → On-chain stats              │
    │  /api/actions/*  → Solana Actions/Blinks       │
    │  /api/post-card  → OG image gen                │
    │  /api/tip-card   → OG image gen                │
    └────────────────────┬───────────────────────────┘
                         │
    ┌────────────────────▼───────────────────────────┐
    │           External Services                     │
    │                                                │
    │  Solana Mainnet (Helius RPC)                   │
    │  Pinata (IPFS media hosting)                   │
    │  Bags.fm (token launch + trading)              │
    │  MagicBlock (private USDC payments)            │
    │  Privy (auth + embedded wallets)               │
    └────────────────────────────────────────────────┘
```

---

## 7. Summary Statistics

| Metric | Count |
|---|---|
| **React components** | 19 |
| **Custom hooks** | 5 |
| **API routes** | ~11 |
| **On-chain instructions** | 26 |
| **On-chain account types** | 11 |
| **Total frontend lines** | ~12,000+ |
| **Solana program lines** | 1,063 |
| **TypeScript types** | 6 main types in `types/index.ts` |
| **Store slices** | 14 state groups |
| **External integrations** | 5 (Solana, Privy, Pinata, Bags.fm, MagicBlock) |

---

## 8. Recommendations (Priority Order)

1. **Add rate limiting** to `/api/build-tx` and `/api/upload` — these are open endpoints that can drain the treasury
2. **Implement pagination** for `getAllPosts()`, `getAllComments()` etc. — current approach won't scale past ~1,000 accounts
3. **Add block/report** functionality — essential for any public social platform
4. **Index on-chain data** with a proper indexer (Helius DAS, custom geyser plugin, or database) instead of `getProgramAccounts()` calls
5. **Persist payment history** on-chain or in a database — current localStorage approach loses data
6. **Implement the "Likes" tab** on Profile or remove it
7. **Add error boundaries** to prevent full-app crashes
8. **Consolidate dark mode** — use CSS variables instead of hardcoded colors
9. **Add unlike instruction** to the Solana program
10. **Add post editing** instruction (or document why immutability is intentional)
