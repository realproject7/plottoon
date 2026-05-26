# Dashboard Parity Spec — PlotToon ↔ plotlink-ows

**Status:** implementation complete (Batch 9 / EPIC #247 closed). This doc was the design spec for the Dashboard redesign (#248); after #249 (data), #250 (UI), #251 (local activity + repair), and #252 (QA sign-off) landed, the gaps it identified have been closed. The doc below has been refreshed to reflect the **post-implementation** state. The QA sign-off is in `docs/DASHBOARD_QA.md`.

**Implementation history:**

- #248 — this spec (PR #257).
- #249 — data layer: direct-RPC royalty + USDC/PLOT balances + top-line gas + PLOT/USD price + PnL (PR #258).
- #250 — UI: redesigned Dashboard surface, wallet card with 3 balances, P&L card, Open in workspace action (PR #259).
- #251 — local activity feed + retry-index repair affordance (PR #260).
- #252 — QA sign-off + parity audit (PR #261, see `docs/DASHBOARD_QA.md`).
- #262 — fresh-install default for `MCV2_BOND_ADDRESS` (PR #265).
- #264 — `getPlotUsdPrice` fallback chain (GeckoTerminal primary → CoinGecko fallback) + module-local cache (PR #267).

## Scope

This doc maps every Dashboard / Wallet / Settings / Royalty feature exposed by `plotlink-ows` to the equivalent PlotToon implementation. `plotlink-ows` is the **functional source of truth** — PlotToon mirrors its on-chain reads and local-file-driven story state, but PlotToon is a desktop client, so there is no PlotLink HTTP layer in the middle.

## Design constraints (non-negotiable)

These are still load-bearing for any future Dashboard work:

1. **No new PlotLink API endpoint** is allowed for Dashboard profile/story/royalty data. Every value the Dashboard displays comes from (a) local PlotToon project files, or (b) Base mainnet RPC.
2. **No external PlotLink-only story listing** in the PlotToon Dashboard. The Dashboard only shows stories that map to local PlotToon project/publish metadata.
3. **A story is PlotToon-managed** only when local PlotToon `publish-status.json` carries a `storylineId` (and/or the project's `storylineId` metadata) — i.e. it was published from this PlotToon install. A bare PlotLink story that exists on-chain but has no local mapping is **not** rendered in PlotToon's Dashboard.
4. **PlotToon-managed stories get a local project/workspace action** (Open in workspace) — not just an external link.
5. **Wallet balances and royalties are read directly from Base RPC**, mirroring `plotlink-ows`. The renderer never depends on a PlotLink HTTP endpoint to populate these values.

## References

| Surface         | plotlink-ows                                 | PlotToon                                                                                      |
| --------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Dashboard route | `app/routes/dashboard.ts`                    | `src/main/services/dashboardData.ts` + `src/main/ipc/dashboardHandlers.ts`                    |
| Dashboard UI    | `app/web/components/Dashboard.tsx`           | `src/renderer/Dashboard.tsx`                                                                  |
| Wallet route    | `app/routes/wallet.ts`                       | `src/main/ipc/walletConnectionHandlers.ts`, `src/main/services/walletConnection.ts`           |
| Wallet card UI  | `app/web/components/WalletCard.tsx`          | `src/renderer/WalletSelector.tsx` + Dashboard `WalletCard`                                    |
| Settings route  | `app/routes/settings.ts`                     | `src/main/ipc/projectHandlers.ts` (capability report) + `src/renderer/CapabilityReport.tsx`   |
| Settings UI     | `app/web/components/Settings.tsx`            | `src/renderer/CapabilityReport.tsx`                                                           |
| Royalty read    | `dashboard.ts` (`getRoyaltyInfo` direct RPC) | `src/main/services/royaltyClaim.ts` `readRoyaltyInfo`                                         |
| Royalty claim   | bonding-curve contract call                  | `src/main/services/royaltyClaim.ts` `executeRoyaltyClaim` + `src/main/ipc/royaltyHandlers.ts` |
| ERC-20 balances | `wallet.ts` hand-encoded `eth_call`          | `src/main/services/erc20Balance.ts` `readErc20Balance` (viem `readContract`)                  |

## Parity table

Every row from the original spec, with the implementation state after Batch 9. Pin file paths to symbol names + nearby search anchors rather than line numbers so the doc can't rot with future refactors.

| Row                                    | plotlink-ows source                                        | PlotToon implementation                                                                                                                                                                                                                                                              | Parity                       |
| -------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| **Local project / story count**        | `dirs.length` under `STORIES_DIR`                          | `listProjects()` filtered by active wallet in `dashboardData.ts` `buildDashboardData` (search the wallet-scope filter comment)                                                                                                                                                       | ✓                            |
| **Total local plot/cut files**         | `mdFiles.length` per story dir                             | `entry.cutCount` per plot via `readCutsFile` in `loadPlotEntry`                                                                                                                                                                                                                      | ✓                            |
| **Published plots**                    | files with `status === 'published'`                        | `plotState === 'published'` in `computeCounts`                                                                                                                                                                                                                                       | ✓                            |
| **Pending plots**                      | implicit (`totalFiles - publishedFiles`)                   | explicit (`draft` / `ready` / `publishing` → pending)                                                                                                                                                                                                                                | ✓ (more granular)            |
| **Not-indexed plots**                  | `status === 'published-not-indexed'`                       | `plotState === 'published-not-indexed'`                                                                                                                                                                                                                                              | ✓                            |
| **Failed plots**                       | n/a (plotlink-ows treats failures as missing)              | `plotState === 'failed'`                                                                                                                                                                                                                                                             | ✓ (PlotToon improvement)     |
| **Published story groups**             | `Map` keyed by `storylineId`                               | `groupByStoryline` keyed by `storylineId`                                                                                                                                                                                                                                            | ✓                            |
| **PlotLink story URL**                 | `https://plotlink.gg/...` derived in UI (or absent)        | `publishResult.plotlinkUrl` on each plot, rendered as the `View →` link in `PlotRow`                                                                                                                                                                                                 | ✓ (when set by publish flow) |
| **BaseScan tx URL**                    | rendered from `txHash` in UI                               | `https://basescan.org/tx/<hash>` link in `PlotRow`                                                                                                                                                                                                                                   | ✓                            |
| **Gas cost per plot**                  | `f.gasCost` → ETH formatted                                | `publishResult.gasCostWei` → `formatGasWei` in `PlotRow`                                                                                                                                                                                                                             | ✓                            |
| **Gas cost per group**                 | `files.reduce` over `gasCost`                              | `StorylineGroup.totalPublishCostWei`                                                                                                                                                                                                                                                 | ✓                            |
| **Total gas cost (top-line)**          | `publishedFiles.reduce`                                    | `counts.totalPublishCostWei` aggregated in `sumPublishCost` (#249 Gap A)                                                                                                                                                                                                             | ✓                            |
| **ETH balance**                        | direct RPC `eth_getBalance`                                | direct RPC `getBalance` via viem in the `fetchBalance:` callback in `registerDashboardHandlers`                                                                                                                                                                                      | ✓                            |
| **USDC balance**                       | direct RPC `eth_call` `balanceOf(USDC_BASE)`               | direct RPC via `readErc20Balance(walletAddress, { rpcUrl, token: USDC_BASE_MAINNET })` — surfaced as `WalletSummary.usdcBalanceWei` (#249 Gap B)                                                                                                                                     | ✓                            |
| **PLOT balance**                       | direct RPC `eth_call` `balanceOf(PLOT)`                    | direct RPC via `readErc20Balance(walletAddress, { rpcUrl, token: PLOT_TOKEN_BASE_MAINNET })` — surfaced as `WalletSummary.plotBalanceWei` (#249 Gap C)                                                                                                                               | ✓                            |
| **ETH/USD price**                      | CoinGecko `simple/price?ids=ethereum`                      | identical CoinGecko call in `fetchEthPrice:` callback                                                                                                                                                                                                                                | ✓                            |
| **PLOT/USD price**                     | `lib/usd-price.getPlotUsdPrice()` (HUNT-backed derivation) | `src/main/services/plotPrice.ts` `getPlotUsdPrice` — GeckoTerminal `networks/base/tokens/<addr>` primary, CoinGecko `token_price/base` fallback, module-local 2-minute cache, graceful `null` when every source is unavailable; surfaced as `tokenPrice.plotUsd` (#249 Gap D / #264) | ✓                            |
| **Royalty earned**                     | `getRoyaltyInfo` → `unclaimed + totalClaimed` formatted    | `readRoyaltyInfo` direct RPC; convention aligned with plotlink-ows: contract returns `(unclaimed, totalClaimed)`, helper computes `earned = unclaimed + totalClaimed` (#249 Gap E)                                                                                                   | ✓                            |
| **Royalty claimed**                    | `totalClaimed` from `getRoyaltyInfo`                       | `claimed = totalClaimed` from the same call                                                                                                                                                                                                                                          | ✓                            |
| **Royalty unclaimed**                  | `earned − claimed` (UI math)                               | `unclaimed = unclaimed` (the first return value); surfaced on both `RoyaltyClaimCard` and the P&L card's `pnl-unclaimed-row` (#250 RE1)                                                                                                                                              | ✓                            |
| **Royalty claim action**               | "Claim PLOT royalties" button → `claimRoyalties` tx        | `executeRoyaltyClaim` → `claimRoyalties(reserveToken)`, wired through `royalty:claim` IPC; honors active-wallet vault freshness (#235 / #240)                                                                                                                                        | ✓                            |
| **Royalty claim history**              | reads `~/.plotlink/royalty-claims.log`                     | `royalty:claimHistory` IPC reads the local claim log, wallet-scoped per #233                                                                                                                                                                                                         | ✓                            |
| **Agent registration status**          | not in plotlink-ows Dashboard                              | `agent:registrationStatus` (#156)                                                                                                                                                                                                                                                    | ✓ (PlotToon-only)            |
| **Agent binding proof**                | not in plotlink-ows Dashboard                              | `agent:bindingProof` IPC (#223)                                                                                                                                                                                                                                                      | ✓ (PlotToon-only)            |
| **Active-wallet multi-wallet scoping** | single OWS wallet (`plotlink-writer-*`)                    | active identity from `walletIdentityStore`; Dashboard projects + plots + balances + royalty + claim history + activity feed all filter by `meta.wallet.address` (#222 / #233; #251 RE1 cleared activity on switch)                                                                   | ✓ (PlotToon improvement)     |
| **PnL summary (cost vs royalty USD)**  | computed: `totalRoyaltiesUsd - totalCostUsd`               | `pnl.totalGasUsd`, `pnl.totalRoyaltyUsd`, `pnl.netUsd` in `DashboardData`; each leg null when inputs missing; renderer flips net to negative class below zero (#249 Gap F + #250 RE1 unclaimed row)                                                                                  | ✓                            |
| **Local activity feed**                | not in plotlink-ows                                        | `ActivityFeed` aggregates local publishes + wallet-scoped royalty claims, time-sorted, capped at 8; `activity-empty` state when none (#251)                                                                                                                                          | ✓ (PlotToon-only)            |
| **Retry-index repair affordance**      | not in plotlink-ows                                        | `Retry index` button on `published-not-indexed` plot rows, calls `publish:retryIndex` (existing #129 handler), inline error on failure (#251)                                                                                                                                        | ✓ (PlotToon-only)            |

## Genuinely deferred items

These are the only outstanding items after Batch 9. None block parity; all are tracked for future tickets.

### 1. Live royalty-ABI cross-check against the deployed contract

#249 codified the plotlink-ows convention `(unclaimed, totalClaimed)` for `getRoyaltyInfo`. Before live rollout, one manual cross-check against the deployed `MCV2_BOND` contract on Base for a real wallet should confirm the values shown in PlotToon's Dashboard match the values plotlink-ows shows for the same wallet on the same chain. If the on-chain ABI differs from this convention, both clients need to update together.

Status: implementation matches plotlink-ows; awaiting one-time on-device verification (carried in `docs/DASHBOARD_QA.md` deferred-items list).

### 2. Recovery-attempt history in the Activity feed

#251's `ActivityFeed` aggregates publishes + royalty claims. Index-recovery attempts (the `Retry index` button) are reflected indirectly via the plot's state badge transitioning from `published-not-indexed` to `published`, but there's no per-attempt timeline entry. Adding repair-attempt history needs a small persistence change (append to a per-plot recovery log); scope-bound to its own future ticket.

### 3. On-device screenshot evidence

#252 ships written QA notes for every state, with renderer test assertions pinning every `data-testid`. A real-app screenshot pass is deferred until a contributor with a real OWS wallet explicitly consents to capture sanitized screenshots — the headless smoke environment has no real wallet, and the #252 acceptance criteria forbids real-wallet leakage in fixtures.

## Intentional implementation choices

These are differences from `plotlink-ows` that are **not** parity gaps — PlotToon deliberately diverges because the constraint matters more than the symmetry. Listed here so a future reader doesn't re-open them as bugs.

### HUNT-backed Mint Club derivation is NOT ported

`plotlink-ows`'s `lib/usd-price.ts` ships a HUNT-backed derivation through the Mint Club bonding-curve SDK as one of the PLOT/USD fallback paths. PlotToon's `getPlotUsdPrice` in `src/main/services/plotPrice.ts` does NOT include this path; it stops at GeckoTerminal → CoinGecko.

Why not: the Mint Club SDK adds non-trivial install surface to an Electron renderer (extra native deps, transitive web3 modules) and the two public sources we keep cover the same `(token contract on Base) → USD` lookup with simpler keyless HTTP. The graceful-`null` contract is preserved end-to-end: when both GeckoTerminal and CoinGecko have no quote, `tokenPrice.plotUsd` is null and the renderer hides the PnL leg — same UX as the pre-#264 best-effort path. The HUNT-backed derivation was the canonical fallback in plotlink-ows; for PlotToon, "no quote" is a documented terminal state, not a missing rung. If a future ticket needs HUNT coverage, the slot is the next `try*` call inside `fetchOnce`.

## Local project management action UX

For each row in the "Published story groups" block, the Dashboard renders one of two affordances based on whether PlotToon has local metadata for that storyline:

- **PlotToon-managed** (`storylineId` came from local `publish-status.json`): shows **Open in workspace** as the primary action. Clicking calls the `onSelectProject` prop wired through `App.tsx` to navigate to the project workspace (existing project router; no new IPC). BaseScan + PlotLink links remain as secondary actions on each plot row.
- **Other on-chain stories**: **not rendered at all**. PlotToon does not list PlotLink stories that lack local mapping.

The plotlink-ows Dashboard's "story name → file" navigation maps to PlotToon's "story group → project workspace" since PlotToon's unit of work is the project, not the markdown file.

## Wallet card parity

plotlink-ows's `WalletCard` shows: address, ETH balance, USDC balance, PLOT balance, create-wallet button (when no wallet exists), copy-address button.

PlotToon's Dashboard `WalletCard` after #250: address (truncated; full available via `title` + copy-to-clipboard), Base network chip, copy + BaseScan-address actions, plus three balance rows (ETH/USDC/PLOT) with per-token error rows and `—` placeholders for null wei. Wallet selection / creation lives in the sidebar `WalletSelector` (#219) so the Dashboard card is focused on balance display.

A11y / safety:

- Address rendered truncated by default; full address available in `title` attr + copy-to-clipboard.
- No OWS internal `owsName` / vault path / private material in the Wallet card or any Dashboard cell (boundary set by #234 / #239 / #234 RE1 / #253 RE1).

## Settings parity

plotlink-ows `Settings.tsx` exposes the OWS passphrase, wallet info, and a few env-style toggles.

PlotToon's equivalent is the **Capability Report / Status page**. After #253 it covers:

- PlotLink endpoint readiness (from `validatePublishConfig`)
- Wallet readiness (active identity + vault freshness via `checkActiveWalletInVault`)
- Signer mode (live / mock)
- CLI availability (Claude or Codex)
- Local export support (browser-only checks)
- AtlasCloud informational guidance

No re-implementation of plotlink-ows's settings UI is needed.

## Active-wallet scoping (PlotToon improvement over plotlink-ows)

plotlink-ows assumes a single `plotlink-writer-*` wallet. PlotToon supports multiple identities via `walletIdentityStore` (#218 / #219 / #220 / #234 / #235 / #239 / #240). The Dashboard:

- Filters projects to those owned by the active wallet (the wallet-scope filter in `dashboardData.ts` `buildDashboardData`).
- Filters royalty history to the active wallet (#233).
- Filters the activity feed to the active wallet (clears `activityClaims` on switch — #251 RE1).
- Re-renders when `WALLET_ACTIVE_CHANGED_EVENT` fires.

All Dashboard data (balances, royalty, project stats, activity) reads from the active wallet — never the first plotlink-writer entry. QA test "clears wallet A activity claims before wallet B dashboard data renders (no cross-wallet bleed)" pins this.

## Non-goals (still in force)

- No backend changes to PlotLink or plotlink-ows.
- No new IPC channels beyond the ones already exposed (`dashboard:getData`, `royalty:read`, `royalty:claim`, `royalty:claimHistory`, `publish:retryIndex`, etc.). The activity-feed history fetch reuses the existing `royalty:claimHistory` IPC.
- No multi-chain support: every value in this spec is Base mainnet.
- No persistence of price / balance snapshots — every Dashboard load fetches fresh.

## Public-safety constraints (carried from earlier multi-wallet work)

- The Dashboard must never serialize OWS internal `owsName`, vault paths, private keys, mnemonics, passphrases, or `EACCES`-style error fragments. Existing renderer-view projections (`#234`, `#239`, `#253` RE1) apply.
- All tests must use fake addresses (`0xaaaa…0001` style) and never real wallets. The #252 QA doc has the full sensitive-data audit.
- The royalty claim flow must continue to honor the active-wallet vault freshness guard (#235 / #240) — clicking Claim on Dashboard runs through the same `checkActiveWalletInVault` precheck and the Status report (#253) pins this.
