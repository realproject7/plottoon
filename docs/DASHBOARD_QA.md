# Dashboard Parity QA — Batch 9 sign-off

**Status:** verification pass for the Dashboard parity batch (parent EPIC #247) — implementations from #248 (spec), #249 (data), #250 (UI), #251 (local activity + repair). This doc closes #252.

**Scope:** confirm the redesigned Dashboard ships every plotlink-ows parity item, no new PlotLink HTTP endpoint, active-wallet scoping with no cross-wallet bleed, and graceful fallback states. No code changes in this PR — verification + sanitized notes only.

## Verification commands

All five commands run from a clean checkout of `task/252-dashboard-qa` (branched off `main` at commit 2a547b5, after #260 merged):

| Command                | Result                                |
| ---------------------- | ------------------------------------- |
| `npm run typecheck`    | **pass** (no errors)                  |
| `npm run lint`         | **pass** (eslint, --max-warnings 0)   |
| `npm run format:check` | **pass** (prettier)                   |
| `npm test -- --run`    | **pass** — 1521 tests across 80 files |
| `npm run build`        | **pass** — main + preload + renderer  |

Smoke test under xvfb (`CI=true xvfb-run -a npm run smoke`) was also run as part of the merge-time CI on #260 and passed (#198 regression still green).

## Acceptance audit

Each check from #252 mapped to the code path / test that demonstrates compliance.

### 1. No new PlotLink API endpoint is required or called for Dashboard profile/story data

- Dashboard royalty fetch in `src/main/index.ts` `registerDashboardHandlers` block (`fetchRoyalty:` callback) calls `readRoyaltyInfo(walletAddress, plotTokenAddress, { config: dashboardRoyaltyConfig })` — direct Base RPC via viem `readContract`. No `${plotlinkBaseUrl}/api/...` HTTP call anywhere in the Dashboard path.
- `grep -rn "api/royalty\|plotlink.*royalty" src/` returns only historical comments in `src/main/index.ts` and the regression test in `dashboardData.test.ts` (the test that asserts `globalThis.fetch` is never called) — both deliberately mention the removed endpoint to pin the constraint.
- ERC-20 balances (`fetchUsdcBalance`, `fetchPlotBalance` in `registerDashboardHandlers`) go through `readErc20Balance` → viem `readContract` on Base RPC.
- ETH balance uses viem `getBalance` directly (`fetchBalance:` callback in `registerDashboardHandlers`).
- ETH/USD uses the CoinGecko public endpoint — not PlotLink.
- PLOT/USD uses `src/main/services/plotPrice.ts` `getPlotUsdPrice` (#264): GeckoTerminal `networks/base/tokens/<addr>` primary, CoinGecko `token_price/base` fallback, module-local 2-minute cache, graceful `null` when both sources are unavailable. Both endpoints are public; PlotLink hosts neither.

**Regression pin:** `dashboardData.test.ts` "#249 buildDashboardData — no PlotLink HTTP for royalty" spies on `globalThis.fetch` and asserts it is never invoked for a direct-RPC `fetchRoyalty`.

### 2. Dashboard royalty reads use direct RPC / existing royalty service

`readRoyaltyInfo` is the same helper `royalty:read` IPC uses. Both Dashboard and the royalty card go through the same MCV2-bond `getRoyaltyInfo` call with `(unclaimed, totalClaimed)` semantics (#249) — matches plotlink-ows `app/routes/dashboard.ts`.

### 3. Active wallet switch redraws all Dashboard sections and clears stale data

- In `Dashboard.tsx`, the `useEffect` that listens for `WALLET_ACTIVE_CHANGED_EVENT` calls `load()`. (Search `WALLET_ACTIVE_CHANGED_EVENT`.)
- The rebuilt `load()` callback clears `activityClaims` BEFORE awaiting `dashboard.getData()`, so wallet B's payload can't render with wallet A's claims still in state (#251 RE1 fix in commit a4ca707). The inline comment marker is `#251 RE1`.
- `RoyaltyClaimCard` is keyed by `data.wallet.address` (search `key={data.wallet.address`) so React unmounts + remounts on switch — closes the #222 RE1 stale-state finding.

**Regression pins:**

- `Dashboard.test.tsx` "#250 Wallet switch — Dashboard reloads on WALLET_ACTIVE_CHANGED_EVENT".
- `Dashboard.test.tsx` "clears wallet A activity claims before wallet B dashboard data renders (no cross-wallet bleed)" — deferred Promise gates wallet B's `getClaimHistory` so the test observes the post-swap / pre-history-resolved state.
- `DashboardWalletScope.test.tsx` "shows wallet B address (not A) in the wallet card after switching" and "clears wallet A royalty info, confirm dialog, and claim history when switching to wallet B".

### 4. No-active-wallet state is clear and does not show old stats

- Header subtitle reads "No wallet connected — pick one in the sidebar to see your stats." (search the literal copy in `Dashboard.tsx`).
- `WalletCard` renders "Not connected" placeholder; `RoyaltyClaimCard` returns null when `!walletConnected`.
- Project / plot counts read as zero because `dashboardData.ts` filters owned projects by active wallet address.

**Regression pin:** `Dashboard.test.tsx` "#250 Dashboard — header + active wallet context — renders the no-wallet hint when disconnected".

### 5. Already-connected PlotLink and PlotToon OWS wallets both render correctly

- `WalletCard` renders `sourceLabel(source)` ("plotlink" or "plottoon") under the truncated address.
- `WalletSummary.source: string | null` in `dashboardData.ts` carries the source from `walletState.wallet` via `getWallet()`; both source types (`plotlink-writer` and `plottoon-writer`) are accepted.

**Regression pin:** `Dashboard.test.tsx` "shows wallet info when connected" + the source label is asserted by `getAllByText(/plottoon/i)`.

### 6. ETH, USDC, and PLOT balances render with graceful fallback errors

- `WalletBalanceRow` in `Dashboard.tsx` renders three states per token: error → `dash-card__danger` row; null wei → `—` placeholder; populated wei → `formatToken(wei, decimals, suffix)` with correct decimals per token (ETH 18, USDC 6, PLOT 18).
- The error of one token never hides the other rows.

**Regression pins** (in `Dashboard.test.tsx` under "#250 Wallet card"):

- "renders ETH + USDC + PLOT balance rows formatted per-token"
- "surfaces a per-token error on the failing row without hiding the others"
- "shows '—' placeholder rows when balance fetchers are not wired"

### 7. PLOT royalty earned, claimed, unclaimed, claimable state, confirmation, tx link, and claim history render correctly

- `RoyaltyClaimCard` renders Earned + Claimed + Unclaimed PLOT amounts (#250 relabel from ETH); claim button appears when unclaimed > 0; confirm dialog includes the active wallet address; success surfaces the tx hash; history block shows the last 3 claims with BaseScan links.
- The P&L card additionally surfaces earned + unclaimed PLOT amounts on its summary rows (`pnl-royalty-row` + `pnl-unclaimed-row`) per #250 RE1, with USD aggregates computed from `plotUsd`.

**Regression pins:**

- "shows royalty info when earned" (relaxed to `getAllByText` because earned/unclaimed PLOT now appears on both the royalty card and the P&L card).
- "exposes earned AND unclaimed royalty values on the P&L card when present".
- "displays claim history from persisted records".
- "shows the active wallet address as context inside the royalty claim confirmation" (DashboardWalletScope).

### 8. Local production renders draft, ready, published, not-indexed, failed, and empty states

- `LocalGroupCard` (in `Dashboard.tsx`) shows plots that have no `storylineId` (drafts, ready, failed) grouped by project.
- Storyline cards surface published + published-not-indexed via `PlotStateBadge`.
- Stat row shows Failed + Not Indexed cards when their counts are non-zero.
- Empty state when no storyline + no local groups.

**Regression pins:**

- "renders empty state when no plots".
- "renders stat cards with counts".
- "renders storyline groups with plot rows".
- "renders local groups for unpublished plots".
- "hides failed and not-indexed cards when counts are zero".
- "renders plot state badges".

### 9. Local project/workspace action exists only for locally managed PlotToon projects/story groups

- `StorylineCard` + `LocalGroupCard` both render an "Open in workspace" action conditional on `onOpenWorkspace` prop AND the existence of a local `projectId`.
- Per #248 spec constraint, the Dashboard only surfaces stories present in local PlotToon publish metadata — external PlotLink-only stories never reach the renderer at all because `dashboardData.ts` builds storylines/localGroups from `listProjects()` filtered by `meta.wallet.address`. The renderer cannot accidentally show a managed action for a non-managed group.

**Regression pins:**

- "renders Open in workspace when onSelectProject is provided and calls it with the local projectId".
- "does not render the Open in workspace action when onSelectProject is omitted".

### 10. Local activity feed (#251) is wallet-scoped + clears on switch

- Aggregates local publishes (from `dashboardData`) + royalty claims (from wallet-scoped `royalty:claimHistory`).
- Sorted by descending time; empty state when neither source has entries.
- Cleared in `load()` before the new dashboard payload renders (the RE1 fix).

**Regression pins:**

- "renders the empty state when there are no published plots or claim records".
- "renders a publish entry per published plot with BaseScan + PlotLink links".
- "merges royalty claims into the activity list and sorts both kinds by descending time".
- "surfaces a failed royalty claim as a distinct activity entry with the error text".
- The deferred-Promise cross-wallet-bleed test cited under #3.

### 11. Retry-index repair affordance (#251)

`PlotRow` renders a "Retry index" button only when `plotState === 'published-not-indexed'` and `onRetryIndex` is wired. The button calls `publish:retryIndex` (the existing #129 handler), which enforces wallet-scoped ownership server-side (#223 RE1). Errors render inline next to the row.

**Regression pins:**

- "renders a Retry index button for published-not-indexed plots and calls publish.retryIndex with the projectId+slug".
- "shows the retry error inline when publish.retryIndex returns success:false (no dashboard reload)".
- "does not render the Retry index button for plots that are not in the not-indexed state".

### 12. Public repo test fixtures contain only fake addresses and no sensitive data

Audited `src/main/__tests__/` and `src/renderer/__tests__/`:

- **EVM addresses**: 148 occurrences across all test files. After deduplication, the unique set is fake patterns (`0xaaaa…`, `0xbbbb…`, `0xcccc…`, `0xdddd…`, `0xeeee…`, `0xdead…`, `0xc0ffee…`, repeating-hex patterns like `0xabcdef…`) plus **five** deployed-contract constants on Base mainnet (`0x4F567DACBF9D15A6acBe4A47FC2Ade0719Fb63C4` PLOT token, `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` USDC, `0xc5a076cad94176c2996B32d8466Be1cE757FAa27` MCV2 bond, `0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf` Story Factory, `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` ERC-8004 registry) and the zero address `0x0000…`. The contract addresses are publicly published, not wallets.
- **Local paths**: every `/private/var/folders/...` string is a deliberately-fake "looks-like-macOS-tmp" pattern used to assert leak-proof behavior — the tests INJECT them so they can assert they never appear in error messages or report payloads. `agentEnv.test.ts` uses `/home/testuser` (literal "testuser"). No real user paths anywhere.
- **Wallet secrets**: `walletIdentityStore.test.ts` and `walletIdentityHandlers.test.ts` assert serialized JSON does NOT match `/privateKey|mnemonic|seed|passphrase|secret|vaultPath/i`.
- **OWS internal names**: distinctive strings like `plottoon-writer-distinctive-internal-selector` are deliberately seeded to assert they never appear in renderer-facing payloads (the #234 / #239 / #240 / #253 RE1 boundary tests).
- **Unpublished story text**: only short stub strings like "My Comic", "Episode 1", "Draft Comic", "Recovery Story" — clearly placeholder.

### 13. Dashboard visually matches PlotLink visual style while functionally matching plotlink-ows

- Continues using PlotLink design tokens (`--surface`, `--border`, `--accent`, `--muted`, `--danger`, `--card-radius`, `--space-*`) and the self-hosted Newsreader font (`src/renderer/tokens.css`).
- Cards use the existing `dash-card` shell + new `dash-card--wallet`, `dash-card--pnl` modifiers (#250).
- Activity feed uses the same surface tokens; rows match the bordered-panel style of the published-groups cards (#251).
- New `dash-chip` mirrors PlotLink's compact bordered chip style (used for the Base network indicator).
- No browser-default buttons or generic wireframe controls introduced.

Functional coverage matches the `plotlink-ows` Dashboard rows enumerated in `docs/DASHBOARD_PARITY.md` (the #248 spec): wallet identity + address + 3 token balances + ETH/USD + PLOT/USD; published storyline groups with gas + latest + PlotLink + BaseScan; royalty earned/claimed/unclaimed/claim action/history; PnL summary; activity feed.

## Sanitized written QA notes per state

Each state below is described from the rendered DOM under the corresponding fixtures in the renderer test suite. No screenshots are attached because the smoke environment has no real wallet to populate the live numbers, and the issue explicitly forbids real-wallet leakage in fixtures/screenshots. Test assertions function as substantive QA evidence; every described element has a `data-testid` so future verification can run by ID rather than visual inspection.

### A. No active wallet

Header subtitle reads: "No wallet connected — pick one in the sidebar to see your stats." `active-wallet-context` testid is **absent**. Stat row shows all zeros (Projects 0, Plots 0, Published 0, Pending 0; Failed/Not Indexed cards hidden when zero). Wallet card shows "Not connected". P&L card renders with `pnl-eth-fallback` + `pnl-plot-fallback` both reading "unavailable"; gas/royalty/net rows show `—`. Royalty claim card is hidden (renders null when `!walletConnected`). Local production section hidden. Activity feed renders the empty state (`activity-empty` testid).

Test fixtures: `Dashboard.test.tsx` "renders empty state when no plots" + "renders the no-wallet hint when disconnected".

### B. Active wallet with no projects

Header subtitle: `Active wallet: 0xaaaa…0001 · plottoon`. Stat row shows zeros. Wallet card renders the truncated address, Base chip, copy button, BaseScan address link, and three balance rows (ETH/USDC/PLOT) all reading `—` because the test fixture leaves the balance fetchers unwired. P&L card renders with all rows `—` and both fallback prices "unavailable". Royalty card hidden (no earned royalty). Empty state `No plots yet. Create a project and add some plots to get started.` Activity feed empty.

Test fixtures: `Dashboard.test.tsx` "#250 Dashboard — header + active wallet context" + "shows '—' placeholder rows when balance fetchers are not wired".

### C. Active wallet with local published + not-indexed project data

Header same as B. Stat row populated with Published / Pending / Not Indexed counts; Failed card hidden when zero. Wallet card identical to B (balances depend on whether fetchers are wired). P&L card shows the lifetime gas total; royalty + USD legs render based on whether prices are present. Royalty card visible when `royalty.earnedWei` non-null. Published storyline cards render with project name, truncated `storylineId`, "N published" + "M not indexed" meta, total gas, latest publish timestamp, BaseScan + PlotLink links per plot, and a **Retry index** button next to each `published-not-indexed` plot row. "Open in workspace" action visible at the bottom of each storyline + local-group card (when `onSelectProject` is wired in `App.tsx`). Activity feed lists publishes + claims in descending time order, capped at 8 entries.

Test fixtures: "renders storyline groups with plot rows" + "renders a Retry index button for published-not-indexed plots" + "renders a publish entry per published plot with BaseScan + PlotLink links" + "renders Open in workspace when onSelectProject is provided".

### D. Active wallet with royalty / balance fallback states

When `fetchEthPrice` / `fetchPlotPrice` reject: `pnl-eth-fallback` / `pnl-plot-fallback` show "unavailable"; the gas USD / royalty USD / net USD rows fall back to `—`. ETH/USD failure does NOT clobber the PLOT/USD error message and vice versa (`dashboardData.test.ts` "degrades gracefully on plot price fetch failure without clobbering eth price"). When `fetchUsdcBalance` rejects: only the USDC row in the wallet card shows the error text; ETH and PLOT rows continue to render normally. When `fetchRoyalty` rejects: royalty card shows "Royalties" label + the generic error string; the rest of the dashboard still renders. When `dashboard.getData()` rejects: the entire dashboard shows the existing error-panel with a Retry button.

Test fixtures: "degrades gracefully when balance fetch fails", "degrades gracefully when royalty fetch fails", "shows error state and retry button", "retries on button click".

## Remaining plotlink-ows parity gaps

Per the #248 spec, every parity row marked **Gap A–F** was closed by #249 + #250. The remaining items intentionally deferred or carried as known limitations:

1. **Royalty-convention assumption against the deployed ABI**. #249 codified the plotlink-ows convention `(unclaimed, totalClaimed)`. Before live rollout, run a manual cross-check against the deployed `MCV2_BOND` contract on Base for one real wallet, comparing values shown in PlotToon's Dashboard against plotlink-ows. If the on-chain ABI differs, both clients need to update together — the divergence flagged in `docs/DASHBOARD_PARITY.md` Gap E remains a one-time QA gate.

2. **Activity feed**: only covers publishes + royalty claims today. The #251 issue mentioned indexing repairs as a separate activity kind, but the existing data model only carries the current `indexed` boolean, not a history of repair attempts. Adding repair-attempt history would need a small persistence change (append to a per-plot recovery log); deferred as scope-bound to its own ticket.

3. **No real-app screenshot evidence**. The smoke environment has no real OWS wallet to populate balances/royalties. Renderer test assertions pin every data-testid for visual structure; future on-device QA (separate from this ticket) can attach sanitized screenshots from a wallet held by a contributor who explicitly consents.

> **No longer deferred (post-#264)**: PLOT/USD now uses `getPlotUsdPrice` with a GeckoTerminal → CoinGecko fallback chain and a module-local 2-minute cache. `tokenPrice.plotUsd` is null only when both public sources have no quote (the PnL row hides gracefully in that case). The HUNT-backed Mint Club derivation that plotlink-ows uses as its canonical fallback is intentionally NOT ported — see `docs/DASHBOARD_PARITY.md` § "Intentional implementation choices" for the rationale.

## Sensitive-data audit summary

| Surface                      | Result                                                                                                                                        | Evidence                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Public addresses in fixtures | Fake patterns + deployed contracts only                                                                                                       | Section 12 above                                                                          |
| Local file paths in fixtures | Only `/home/testuser` literal + deliberately fake `/private/var/folders/SENSITIVE/…` injection paths used to assert leak-proof error handling | Section 12 above                                                                          |
| OWS internal names           | Only distinctive-string strings deliberately seeded to assert non-leakage (#234 / #239 / #240 / #253 RE1)                                     | `grep -rn "distinctive-selector\|distinctive-registry-selector"`                          |
| Wallet secrets               | Existing `isWalletIdentityShape` rejects banned keys; serialized-JSON assertions in identity-store + identity-handler tests                   | `walletIdentityStore.test.ts` + `walletIdentityHandlers.test.ts` — see grep pattern below |
| Unpublished story text       | Only short stub strings (`My Comic`, `Episode 1`, `Draft Comic`)                                                                              | manual review of `Dashboard.test.tsx`                                                     |

The grep pattern for the wallet-secrets evidence cell is `vaultPath|privateKey|mnemonic|seed|passphrase|secret` (kept outside the table so the pipes don't break Markdown rendering).

## Sign-off

Parent EPIC #247 can be marked complete once #252 lands. All eleven required checks enumerated in #252 pass against the rebuilt UI (the audit above adds two extra sections — activity feed (#10) and retry-index (#11) — covering the implementations from #251 beyond the issue's verbatim list). The renderer + main-process implementations match the #248 spec; the only deferred items are the three carried items above (royalty-ABI on-chain cross-check, recovery-attempt history in the activity feed, on-device screenshot evidence) — none blocking. (Pre-#264 this list included PLOT/USD HUNT-derivation fallback; #264 shipped the GeckoTerminal-primary / CoinGecko-fallback chain so that item moved to the "intentional implementation choices" section of `docs/DASHBOARD_PARITY.md`.)
