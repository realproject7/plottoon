# Dashboard Parity Spec — PlotToon ↔ plotlink-ows

**Status**: design spec for the Dashboard redesign (parent EPIC #247, this doc is #248).
**Implementation tickets**: #249 (data), #250 (UI), #251 (project management), #252 (QA).

## Scope

This doc maps every Dashboard / Wallet / Settings / Royalty feature exposed by `plotlink-ows` to the equivalent PlotToon implementation, identifies the gaps PlotToon needs to close, and pins the design constraints the implementation tickets must follow.

`plotlink-ows` is the **functional source of truth**. PlotToon mirrors its on-chain reads and local-file-driven story state, but PlotToon is a desktop client — there is no PlotLink HTTP layer in the middle.

## Design constraints (non-negotiable)

1. **No new PlotLink API endpoint** is required, proposed, or allowed for this phase. Every parity row below is implementable today against (a) local PlotToon project files, or (b) Base mainnet RPC.
2. **No external PlotLink-only story listing** in the PlotToon Dashboard. The Dashboard only shows stories that map to local PlotToon project/publish metadata.
3. **A story is PlotToon-managed** only when local PlotToon `publish-status.json` carries a `storylineId` (and/or the project's `storylineId` metadata) — i.e. it was published from this PlotToon install. A bare PlotLink story that exists on-chain but has no local mapping is **not** rendered in PlotToon's Dashboard.
4. **PlotToon-managed stories get a local project/workspace action** (Open in workspace) — not just an external link.
5. **Wallet balances and royalties are read directly from Base RPC**, mirroring `plotlink-ows`. The renderer never depends on a PlotLink HTTP endpoint to populate these values.
6. **Dashboard royalty data must not call any PlotLink HTTP royalty endpoint** — including the placeholder `${plotlinkBaseUrl}/api/royalty/${address}` PlotToon currently calls in `src/main/index.ts:179-193`. That call is a known gap and must be replaced with `readRoyaltyInfo` from `src/main/services/royaltyClaim.ts`.

## References

| Surface         | plotlink-ows                                 | PlotToon                                                                                    |
| --------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Dashboard route | `app/routes/dashboard.ts`                    | `src/main/services/dashboardData.ts` + `src/main/ipc/dashboardHandlers.ts`                  |
| Dashboard UI    | `app/web/components/Dashboard.tsx`           | `src/renderer/Dashboard.tsx`                                                                |
| Wallet route    | `app/routes/wallet.ts`                       | `src/main/ipc/walletConnectionHandlers.ts`, `src/main/services/walletConnection.ts`         |
| Wallet card UI  | `app/web/components/WalletCard.tsx`          | `src/renderer/WalletSelector.tsx` + Dashboard `WalletCard`                                  |
| Settings route  | `app/routes/settings.ts`                     | `src/main/ipc/projectHandlers.ts` (capability report) + `src/renderer/CapabilityReport.tsx` |
| Settings UI     | `app/web/components/Settings.tsx`            | `src/renderer/CapabilityReport.tsx`                                                         |
| Royalty read    | `dashboard.ts` (`getRoyaltyInfo` direct RPC) | `src/main/services/royaltyClaim.ts:readRoyaltyInfo`                                         |
| Royalty claim   | bonding-curve contract call                  | `src/main/services/royaltyClaim.ts:executeRoyaltyClaim` + `src/main/ipc/royaltyHandlers.ts` |

## Parity table

Each row lists the user-visible value, the plotlink-ows source, the current PlotToon source, and whether PlotToon ships parity today (✓) or needs work (Gap). Gaps are described in detail below the table.

| Row                                    | plotlink-ows source                                                                     | PlotToon source                                                                                                                                                                  | Parity                              |
| -------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Local project / story count**        | `dirs.length` under `STORIES_DIR`                                                       | `listProjects()` filtered by active wallet (`dashboardData.ts:259-280`)                                                                                                          | ✓                                   |
| **Total local plot/cut files**         | `mdFiles.length` per story dir                                                          | `entry.cutCount` per plot via `readCutsFile` (`dashboardData.ts:107`)                                                                                                            | ✓                                   |
| **Published plots**                    | files with `status === 'published'`                                                     | `plotState === 'published'` (`dashboardData.ts:224-226`)                                                                                                                         | ✓                                   |
| **Pending plots**                      | implicit (`totalFiles - publishedFiles`)                                                | explicit (`draft` / `ready` / `publishing` → pending)                                                                                                                            | ✓ (more granular than plotlink-ows) |
| **Not-indexed plots**                  | `status === 'published-not-indexed'`                                                    | `plotState === 'published-not-indexed'`                                                                                                                                          | ✓                                   |
| **Failed plots**                       | n/a (plotlink-ows treats failures as missing)                                           | `plotState === 'failed'`                                                                                                                                                         | ✓ (PlotToon improvement)            |
| **Published story groups**             | `Map` keyed by `storylineId` (`dashboard.ts:155-160`)                                   | `groupByStoryline` keyed by `storylineId` (`dashboardData.ts:154-200`)                                                                                                           | ✓                                   |
| **PlotLink story URL**                 | `https://plotlink.gg/...` derived in UI (or absent)                                     | `publishResult.plotlinkUrl` field on each plot (`Dashboard.tsx:75-83`)                                                                                                           | ✓ when set by publish flow          |
| **BaseScan tx URL**                    | rendered from `txHash` in UI                                                            | rendered from `publishResult.txHash` (`Dashboard.tsx:66-73`) — `https://basescan.org/tx/<hash>`                                                                                  | ✓                                   |
| **Gas cost per plot**                  | `f.gasCost` → ETH formatted                                                             | `publishResult.gasCostWei` → `formatGasWei` (`Dashboard.tsx:14-20`)                                                                                                              | ✓                                   |
| **Gas cost per group**                 | `files.reduce` over `gasCost`                                                           | `StorylineGroup.totalPublishCostWei` (`dashboardData.ts:184-186`)                                                                                                                | ✓                                   |
| **Total gas cost**                     | `publishedFiles.reduce`                                                                 | sum across `storylines` and `localGroups` — currently **only summed per-group**, not surfaced as a top-line stat                                                                 | **Gap A**                           |
| **ETH balance**                        | direct RPC `eth_getBalance` (`wallet.ts:46-55`; `dashboard.ts: getEthBalance`)          | direct RPC `getBalance` via viem (`src/main/index.ts:155-167`)                                                                                                                   | ✓                                   |
| **USDC balance**                       | direct RPC `eth_call` `balanceOf(USDC_BASE)` (`wallet.ts:58-67`, `dashboard.ts:90-104`) | not implemented                                                                                                                                                                  | **Gap B**                           |
| **PLOT balance**                       | direct RPC `eth_call` `balanceOf(PLOT)` (`wallet.ts:69-78`)                             | not implemented                                                                                                                                                                  | **Gap C**                           |
| **PLOT/USD price**                     | `lib/usd-price.getPlotUsdPrice()` (HUNT-backed derivation)                              | not implemented; PlotToon shows ETH/USD only                                                                                                                                     | **Gap D**                           |
| **ETH/USD price**                      | CoinGecko `simple/price?ids=ethereum`                                                   | identical (`src/main/index.ts:169-178`)                                                                                                                                          | ✓                                   |
| **Royalty earned**                     | `getRoyaltyInfo` → `unclaimed + totalClaimed` formatted (`dashboard.ts:118-128`)        | `readRoyaltyInfo` direct RPC but **not wired into Dashboard** today; Dashboard uses HTTP placeholder                                                                             | **Gap E**                           |
| **Royalty claimed**                    | `totalClaimed` from `getRoyaltyInfo`                                                    | same direct-RPC source, same wiring gap                                                                                                                                          | **Gap E**                           |
| **Royalty unclaimed**                  | `earned − claimed` (UI math)                                                            | `earned − claimed` (UI math) once Gap E is closed                                                                                                                                | **Gap E**                           |
| **Royalty claim action**               | "Claim PLOT royalties" button → `claimRoyalties` tx                                     | `executeRoyaltyClaim` → `claimRoyalties(reserveToken)` (`royaltyClaim.ts:109-167`), wired through `royalty:claim` IPC                                                            | ✓                                   |
| **Royalty claim history**              | reads `~/.plotlink/royalty-claims.log`                                                  | `royalty:listClaims` reads local claim log (per #233 wallet-scoped)                                                                                                              | ✓                                   |
| **Agent registration status**          | not in plotlink-ows Dashboard                                                           | exposed via `agent:registrationStatus` (#156)                                                                                                                                    | ✓ (PlotToon-only surface)           |
| **Agent binding proof**                | not in plotlink-ows Dashboard                                                           | `agent:bindingProof` IPC (#223)                                                                                                                                                  | ✓ (PlotToon-only surface)           |
| **Active-wallet multi-wallet scoping** | single OWS wallet (`plotlink-writer-*`)                                                 | active identity from `walletIdentityStore`; Dashboard filters projects + plots + royalty + claim history by `meta.wallet.address` per `dashboardData.ts:273-280`, `#222`, `#233` | ✓ (PlotToon improvement)            |
| **PnL summary (cost vs royalty USD)**  | computed: `totalRoyaltiesUsd - totalCostUsd`                                            | not implemented                                                                                                                                                                  | **Gap F**                           |

## Gaps to close (implementation direction for #249/#250)

Implementation tickets must address each gap below. All values use direct Base RPC; none require a new PlotLink endpoint.

### Gap A — Top-line total gas cost

PlotToon already sums gas per group. Surface an aggregate top-line stat across all storylines + local groups in `DashboardData.counts` (e.g. `totalPublishCostWei`). UI shows it next to "Plots published" in the StatCard row.

### Gap B — USDC balance

Add `fetchUsdcBalance(address)` alongside `fetchBalance` (ETH) in the Dashboard dependency injection (`src/main/index.ts:152-194`). Implementation mirrors plotlink-ows: `eth_call` to `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (USDC on Base) with `balanceOf(address)` selector (`0x70a08231` + 32-byte left-padded address). USDC is 6 decimals. Surface as `WalletSummary.usdcBalanceWei` (string, raw) and let the renderer format.

### Gap C — PLOT balance

Same pattern as USDC, against `0x4F567DACBF9D15A6acBe4A47FC2Ade0719Fb63C4` (PLOT token on Base — already defined as `PLOT_TOKEN_BASE_MAINNET` in `src/main/services/royaltyClaim.ts:8`). 18 decimals. Surface as `WalletSummary.plotBalanceWei`.

Implementation note: a small shared helper `readErc20Balance(rpcUrl, token, address) → bigint` would replace the three call-sites (USDC, PLOT, and any future ERC-20). Prefer viem `readContract` with a minimal `balanceOf` ABI rather than hand-encoding the selector — keeps the call site small and avoids the brittle hex-pad code path plotlink-ows uses.

### Gap D — PLOT/USD price

plotlink-ows derives PLOT/USD from a HUNT-backed math (`lib/usd-price.ts`). For PlotToon, the simplest port is the same derivation — but it depends on the HUNT price feed plotlink-ows uses (likely also CoinGecko). The implementer should:

1. Read `lib/usd-price.ts` from plotlink-ows and port the derivation.
2. If the derivation depends on a service the desktop app can't reach (auth, CORS, etc.), fall back to a CoinGecko-style lookup for the PLOT token by Base address — this is acceptable as best-effort and zero-on-failure.

Surface as `TokenPrice.plotUsd` alongside the existing `ethUsd`.

### Gap E — Direct-RPC royalty reads in the Dashboard

**Today**: `src/main/index.ts:179-193` wires `fetchRoyalty` to `${plotlinkBaseUrl}/api/royalty/${walletAddress}` — an HTTP call to a PlotLink endpoint that may or may not exist. **This is the explicit no-new-PlotLink-API violation flagged in #248**.

**Fix**: replace `fetchRoyalty` with a direct call to `readRoyaltyInfo(walletAddress, plotTokenAddress, { config: royaltyConfig })` from `src/main/services/royaltyClaim.ts`. The royalty service already runs the on-chain `getRoyaltyInfo` read against `MCV2_BOND` with the PLOT reserve token — same contract + same args plotlink-ows uses. Wire it into `getDashboardDeps()` so the dashboard handler reads royalties without any HTTP hop.

**Convention check**: plotlink-ows treats `getRoyaltyInfo` outputs as `[unclaimed, totalClaimed]` and computes `earned = unclaimed + totalClaimed`. PlotToon's current `readRoyaltyInfo` (royaltyClaim.ts:18-22, 98-99) labels them `[earned, claimed]` and computes `unclaimed = earned − claimed`. **One of these two views of the contract is incorrect**; the implementation ticket should resolve this by inspecting the deployed contract ABI / explorer page directly before publishing the integration. The QA ticket (#252) must verify that the values shown in PlotToon's Dashboard match the values plotlink-ows shows for the same wallet on the same chain.

### Gap F — PnL summary

Once balances + prices + royalty land, add a simple PnL block to the Dashboard summary:

- `totalCostsUsd = formatEth(totalPublishCostWei) * ethUsd`
- `totalRoyaltiesUsd = formatPlot(royalty.earnedWei) * plotUsd`
- `netPnlUsd = totalRoyaltiesUsd - totalCostsUsd`

All three derived values, never persisted. The PnL block hides when any of its inputs is null (price fetch failed, no royalty data, etc.) — match plotlink-ows's best-effort, zero-on-failure pattern. **Do not** raise a hard error in the renderer if prices are unavailable; the rest of the Dashboard must still render.

## Local project management action UX

For each row in the "Published story groups" block, the Dashboard renders one of two affordances based on whether PlotToon has local metadata for that storyline:

- **PlotToon-managed** (`storylineId` came from local `publish-status.json`): shows **Open in workspace** as the primary action. Clicking sends the user to the Projects screen scoped to the owning project (PlotToon navigates via the existing project router; no new IPC required). The BaseScan + PlotLink links remain as secondary actions.
- **Other on-chain stories**: **not rendered at all**. PlotToon does not list PlotLink stories that lack local mapping. This is the explicit "no external PlotLink-only story listing" constraint from #248.

The plotlink-ows Dashboard's "story name → file" navigation maps roughly to PlotToon's "story group → project workspace" since PlotToon's unit of work is the project, not the markdown file. Clicking a plot row inside an expanded group navigates to the plot editor (same surface as the Projects-screen workflow once the project is open).

## Wallet card parity

plotlink-ows's `WalletCard` shows: address, ETH balance, USDC balance, PLOT balance, create-wallet button (when no wallet exists), copy-address button.

PlotToon already has the wallet switcher in the sidebar (#219) with switch / connect / disconnect / "Reuse existing" / "Create new" entries — that supersedes plotlink-ows's single-wallet "create wallet" button. The Dashboard's `WalletCard` should focus on **balance display** (ETH + USDC + PLOT after Gaps B/C land) plus the copy-address action; wallet selection/creation stays in the sidebar.

A11y / safety notes:

- Address is rendered truncated by default; full address available in the `title` attr and via copy-to-clipboard.
- No OWS internal `owsName` / vault path / private material in the Wallet card or any Dashboard cell (boundary set by #234 / #239 / #234 RE1).

## Settings parity

plotlink-ows `Settings.tsx` exposes the OWS passphrase, wallet info, and a few env-style toggles.

PlotToon's equivalent is the **Capability Report / Status page**, which after #253 already covers:

- PlotLink endpoint readiness (from `validatePublishConfig`)
- Wallet readiness (active identity + vault freshness via `checkActiveWalletInVault`)
- Signer mode (live / mock)
- CLI availability (Claude or Codex)
- Local export support (browser-only checks)
- AtlasCloud informational guidance

The Settings parity work for #248 is therefore "explicitly link from the Dashboard to the Status page" rather than re-implementing settings UI. No new settings ticket is needed.

## Active-wallet scoping (PlotToon improvement over plotlink-ows)

plotlink-ows assumes a single `plotlink-writer-*` wallet (`wallet.ts:24-26`). PlotToon supports multiple identities via `walletIdentityStore` (#218 / #219 / #220 / #234 / #235 / #239 / #240). The Dashboard:

- Filters projects to those owned by the active wallet (`dashboardData.ts:273-280`).
- Filters royalty history to the active wallet (#233).
- Re-renders when `WALLET_ACTIVE_CHANGED_EVENT` fires (the wallet switcher already dispatches this).

All Dashboard data (balances, royalty, project stats) reads from the active wallet — never the first plotlink-writer entry. The QA ticket (#252) must include a switch-wallets-mid-session test to prove no stats from wallet A bleed into wallet B's Dashboard.

## Non-goals for #248 (deferred or out-of-scope)

- No backend changes to PlotLink or plotlink-ows.
- No new IPC channels beyond the ones already exposed (`dashboard:getData`, `royalty:read`, `royalty:claim`, `royalty:listClaims`, etc.).
- No multi-chain support: every value in this spec is Base mainnet.
- No persistence of price / balance snapshots — every Dashboard load fetches fresh.

## Implementation order (for #249 → #252)

1. **#249 (data)**: Gap E (replace HTTP royalty with direct RPC), Gap B/C (USDC/PLOT balances via ERC-20 `balanceOf`), Gap A (top-line total gas), Gap D (PLOT/USD price), Gap F (PnL math).
2. **#250 (UI)**: render the new fields, port plotlink-ows's two-token balance display, add the PnL block, add Open-in-workspace action for managed groups.
3. **#251 (project management actions)**: wire Open-in-workspace through the existing project router; surface local-only states (drafts, failed publish) with actionable affordances.
4. **#252 (QA)**: parity-vs-plotlink-ows check on the same wallet; switch-wallets-mid-session test; no-PlotLink-HTTP-call assertion; royalty-convention verification against the live contract.

## Public-safety constraints (carried from earlier multi-wallet work)

- The Dashboard must never serialize OWS internal `owsName`, vault paths, private keys, mnemonics, passphrases, or `EACCES`-style error fragments. Existing renderer-view projections (`#234`, `#239`) apply.
- All tests must use fake addresses (`0xaaaa…0001` style) and never real wallets.
- The royalty claim flow must continue to honor the active-wallet vault freshness guard (#235 / #240) — clicking Claim on Dashboard runs through the same `checkActiveWalletInVault` precheck and the Status report (#253) already pins this.
