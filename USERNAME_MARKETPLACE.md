# Tradable Usernames + Marketplace

**Status: PAUSED — devnet only, mainnet untouched. Picked up whenever you're ready.**

Last worked on: 2026-07-26. Everything below is deployed and tested on **devnet**.
The mainnet program has not been modified (still slot `435169144`, 853,568 bytes).

---

## What it does

A username becomes a thing you **own** (a "deed"), separate from your profile, so it
can be transferred and sold.

- **Claim** a name — the deed is created, seeded by the name itself, so the blockchain
  enforces uniqueness. Today uniqueness is only checked in JavaScript
  (`isUsernameTaken()` in `src/lib/program.ts`), which anyone could bypass.
- **Switch** which of your names you display, free.
- **Transfer** a name to another wallet (both parties sign).
- **Sell** it at a fixed price in **$SHYFT** — list, buy, reprice, delist.
  2.5% of every sale goes to the treasury.

**Core rule:** you cannot move (transfer or list) the name you're currently
displaying — switch away first. That's what guarantees nobody ends up nameless.

---

## Test status — 60/60 on devnet

| Suite | Result | Covers |
|---|---|---|
| `test-username-trading.ts` | 15/15 | claim, uniqueness, transfer, display switching, theft attempts |
| `test-username-marketplace.ts` | 21/21 | list, buy, reprice, delist, exact token amounts, payment attacks |
| `test-username-migration.ts` | 8/8 | backfill, duplicates, admin can't mint arbitrary names |
| `test-migration-safety.ts` | 16/16 | posting/liking/commenting still work after migration |

Run any of them with `npx tsx <file>` from the repo root. They refuse to run
against anything but devnet (genesis-hash check).

---

## Migration: your real mainnet data is clean

Read-only scan of all **235 live profiles**:

```
profiles with a username    : 235
longer than 16 bytes        : 0     <- no cleanup needed
illegal chars (not a-z0-9_) : 0     <- no cleanup needed
colliding names             : 2
```

Only two collisions, and both resolve themselves — the older account is active,
the duplicate is empty:

| name | keeps it | loses it |
|---|---|---|
| `shaan` | `Gk5sqqsD3WiFeZYexwWoTeFsBQrWPN9zcUdtCBVbdRmd` — Apr 1, 13 posts, 14 followers | `9uUXiBrDK8kDckbkBnBsCScZNVsTTJbxWWANPrWa4FBf` — Jul 4, 0 posts, 0 followers |
| `tommy` | `65R3AP63DC3VddgBkqbDwM3ePnPekFrUHoJXPQNe7nyX` — Apr 29, 4 posts, 1 follower | `98q3pBvJ1gFgE92reBtnZkRYNbK77pyWkeGtMxoGNMGD` — Jul 5, 0 posts, 0 followers |

Users do **nothing** — you run one script and everyone gets their deed.
Verified that migration doesn't disturb posts, likes, comments, follows or counters
(the backfill passes the profile in read-only, so the runtime forbids writing to it).

---

## TODO — where to restart

### 1. Claim on/off switch  ← START HERE
Needed so mainnet can deploy with public claiming disabled until the backfill is
done. Without it there's a window where bots can steal your users' handles.
Not built yet.

### 2. Independent security audit
**Recommended before real $SHYFT flows through this.** Two genuine bugs were found
in this code by testing after it "looked correct" on review. Once it holds money,
mistakes are permanent.

### 3. Frontend
Nothing user-visible exists yet. `src/lib/idl.json` is still the OLD idl, so the
app can't see any of the new instructions. Needs: claim a name, my names, list for
sale, browse marketplace, buy.

### 4. Mainnet deploy — this exact order
1. Deploy with claiming **OFF**
2. Run backfill for all 233 names
3. **Verify** all 233 records exist and point at the right owners
4. Turn claiming **ON**
5. Ship the app update

---

## Mainnet cost when you do it

```
extend the program   0.79 SOL   permanent (program grew 853,568 -> 966,904 bytes)
backfill 233 names   0.17 SOL   permanent
deploy buffer        6.73 SOL   temporary, refunded after deploy
─────────────────────────────
need available      ~7.5 SOL    in 8wf9jJ... (upgrade authority)
actually spent      ~0.96 SOL
```

---

## Decisions still open

1. **Audit before launch — yes or no?**
2. **Is 2.5% the marketplace fee you want?** Trivial now, annoying later.
3. **Confirm the two collision winners** above.

---

## ⚠️ AUDIT FINDINGS — 2026-07-27 (must fix before mainnet)

Re-audited on request. The escrow itself held up, but three problems around it:

### 1. Impersonation via `create_profile` — FIXED (2026-07-27)
`create_profile` now **rejects a non-empty username** (`UsernameNotClaimed`, 6017).
The only way to set `profile.username` is the registry-gated path
(`claim_username` / `set_display_username` / `transfer_username` / `buy_username`),
so a fresh wallet can no longer display a name someone else owns. New signup is a
two-step flow: create profile empty → `claim_username`. Verified on devnet
(trading suite TEST 0). **Frontend impact:** the app's create-profile call must
pass an empty username and follow with a claim.

Real-world case that motivated this: `@shaan` exists twice on mainnet — the real
`Gk5sqqsD…` (shaanxsol, Apr 1, 13 posts) and an empty impersonator `9uUXiBrD…`
(Shaan12, Jul 4, 0 posts). Migration awards the deed to the older/active one.

### 2. Treasury rent drain on list/delist — FIXED (2026-07-27)
`Listing` now stores `rent_payer` (set to the funder at list time). Both
`buy_username` and `delist_username` use `close = rent_payer` with
`has_one = rent_payer`, so the listing rent can ONLY return to whoever funded it —
never the seller. The list→delist drain loop (the exact bug that drained the
treasury before) is closed: a cycle just returns the funder's own rent, net zero.
Verified on devnet (marketplace suite TEST 5: attacker redirect blocked, correct
refund confirmed). Matches the existing `ClosePost` `close = treasury` pattern.

### 3. Treasury fee — RESOLVED (2026-07-27)
Fee set to **0** (`MARKETPLACE_FEE_BPS = 0`) for the growth phase — bring users
first, no cut. Treasury validation is now guarded behind `fee > 0`, so no $SHYFT
treasury account is needed and a buy can't fail on it (tested: a buy succeeds
even with a bogus treasury account passed in; seller gets the full price).
**To re-enable a fee later:** set the bps back, AND create a $SHYFT token account
for `4tpjCdXS1fKiYoBYLvTNNyHwzTAhuigB3TY6Wd2QbxT9` before the first paid sale.

### ⚠️ ATA rent-drain rule for the frontend (NOT yet built — must follow)
The program never creates token accounts (it only transfers between existing
ones), so it has zero ATA exposure today. But `buy_username` requires the
**seller** to already have a $SHYFT token account to receive payment. When the
frontend creates that account it MUST NOT pay from the treasury/server: an ATA is
owned by the user it's for, and the owner can close it to reclaim the rent — so a
treasury-funded ATA is a drain loop (create → user closes → pockets rent →
repeat). This is the exact drain that hit the project before.
**Rule:** create the seller's $SHYFT ATA inside the buy tx with
`createAssociatedTokenAccountIdempotent`, **payer = buyer** (a real signer already
spending money), never the treasury. Same rule anywhere else the app would create
a user-owned token account.

### 4. API wiring + frontend — DONE for web (2026-07-28)
- `src/lib/idl.json` refreshed to the 46-instruction build.
- `src/app/api/build-tx/route.ts`: added `claimUsername`, `setDisplayUsername`,
  `listUsername`, `updatePrice`, `delistUsername`, `buyUsername` handlers, plus
  `getUsernamePda`/`getListingPda`/`getAta`/`createAtaIdempotentIx` helpers. The
  build loop now accepts an array of ixs from a handler (buyUsername returns
  [create-seller-ATA, buy]). **createProfile now sends an empty username** (the
  two-step flow the impersonation fix requires).
- `src/lib/program.ts`: client methods `claimUsername/setDisplayUsername/
  listUsername/updatePrice/delistUsername/buyUsername/getUsernameRecord/
  getListings`.
- `src/components/Marketplace.tsx`: browse listings, Buy, List-a-name, Delist.
  Wired as a "market" tab in `page.tsx` + `Sidebar.tsx`.
- **Rent decisions (user's call):** seller funds their own listing rent
  (`payer = user` in listUsername), and the buyer funds the seller's $SHYFT ATA
  in the buy tx (`createAtaIdempotentIx` payer = buyer). Treasury never funds a
  user-owned account → no rent-drain. buy/delist pass `rentPayer = listing.rentPayer`
  (fetched) to satisfy the `has_one`.
- Web `next build` passes. **Mobile app NOT wired** (separate copy). Claim UI on
  the profile/signup screen still TODO (marketplace tab is done; the two-step
  signup that replaces the old single-call createProfile is not yet in the UI).

### What held up under re-audit
Escrow logic is sound and tested: can't list a name you don't own, can't double-list,
an escrowed name can't be transferred out (the listing PDA can't sign), the buyer
can't redirect payment or pay with a counterfeit mint, only the seller can delist or
reprice, and the amounts are exact.

---

## Build gotchas (important)

**Devnet builds need a feature flag:**
```bash
anchor build -- --features devnet-mint     # devnet
anchor build                                # mainnet (real $SHYFT mint)
```
The real $SHYFT mint (`7tnB2Dn61NkxWrpkESkUvfoKo6TcoecsazYemptEASY`) has a revoked
mint authority, so it cannot be recreated on devnet. `devnet-mint` swaps in the test
mint `HmpXENZ7a1yK4GbfgZqgfcwTfSzLfBFAtYaGANScfxyC`.
**Never deploy a `devnet-mint` binary to mainnet.**

**Deploying to devnet:**
```bash
solana program deploy target/deploy/shadowspace.so \
  --program-id EEnouVLAoQGMEbrypEhP3Ct5RgCViCWG4n1nCZNwMxjQ \
  -u devnet -k ~/.config/solana/mainnet.json \
  --upgrade-authority ~/.config/solana/mainnet.json
```
Your Solana CLI defaults to **mainnet** — always pass `-u devnet` explicitly.
If the program grew, `solana program extend <id> <bytes> -u devnet` first.

**Don't use anchor-spl's `Mint`/`TokenAccount` types in account structs.** Pulling
them into the IDL requires `anchor-spl/idl-build`, which drags in token_2022 and
re-resolves the dependency graph into an unsatisfiable `zeroize_derive ^1.5`
(zeroize 1.9.0 arrives via ephemeral-rollups-sdk). Token accounts are passed
unchecked and validated by hand in `buy_username` instead.

**Use the Helius RPC for the backfill**, not the public devnet/mainnet endpoint —
233 transactions will hit rate limits (`429`).

---

## Code map

All in `programs/shadowspace/src/lib.rs`:

| Instruction | What it does |
|---|---|
| `claim_username(name)` | claim a fresh name; also displays it |
| `set_display_username(name)` | switch to another name you own |
| `transfer_username(name)` | give a name away (both sign) |
| `list_username(name, price)` | put it up for sale, escrows it |
| `buy_username(name)` | buyer signs alone; pays seller + 2.5% fee |
| `update_price(name, price)` | reprice without unwinding |
| `delist_username(name)` | take it back |
| `admin_backfill_username(name)` | migration only; gated on `ADMIN_AUTHORITY` |

Accounts: `UsernameRecord` (seeded `[b"username", name]`), `Listing`
(seeded `[b"listing", name]`).
New errors appended at the END of `ShadowError` so existing codes don't shift:
`InvalidUsername` 6014, `NotUsernameOwner` 6015, `MustSwitchNameFirst` 6016.
