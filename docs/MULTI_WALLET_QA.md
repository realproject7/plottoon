# Multi-Wallet QA Notes

QA verification for the PlotToon multi-wallet feature set delivered in
issues #218 through #223. All test wallets in this document are fake
(`0xAAAA…0001`, `0xBBBB…0002`, `0xCCCC…0003`); no real addresses,
private keys, mnemonics, passphrases, vault paths, or environment
values appear here.

## Scope

This document captures the QA pass for issue #224 — verify that
PlotToon's multi-wallet implementation isolates wallet A and wallet B
across every wallet-bound surface, that publish confirmation and
recovery state run under the active wallet, and that PlotToon does not
copy the first-`plotlink-writer` wallet selection behavior into any new
flow.

## Acceptance matrix

Each subsystem is covered by automated tests merged in the listed
issue. The test path replaces a manual click-through for that
surface — running `npm test -- --run <path>` reproduces the assertion
that proves wallet A and wallet B do not bleed into each other.

| Surface                            | Wallet-A vs wallet-B guarantee                                                                                                                                                                                                          | Issue | Test                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity store (active selection)  | Active wallet is set via `wallet:identity:setActive`; never inferred from first `plotlink-writer` match                                                                                                                                 | #218  | `src/main/__tests__/walletIdentityStore.test.ts`, `src/main/__tests__/walletIdentityHandlers.test.ts`                                       |
| Wallet switcher UI                 | Dropdown shows the registered identities; clicking switch updates the main-process active wallet and dispatches `WALLET_ACTIVE_CHANGED_EVENT`                                                                                           | #219  | `src/renderer/__tests__/WalletSelector.test.tsx`                                                                                            |
| Project list                       | `project:discover` partitions on disk into owned / legacy / otherWallets / errors; the active wallet sees only its own + legacy bucket                                                                                                  | #220  | `src/main/__tests__/projectWalletScope.test.ts`, `src/renderer/__tests__/ProjectListWalletScope.test.tsx`                                   |
| Project create                     | `project:create` reads the active identity and stamps `meta.wallet.{address, source}`; rejects when no wallet is active                                                                                                                 | #220  | `src/main/__tests__/projectWalletScope.test.ts`                                                                                             |
| Legacy project assignment          | `project:assignWallet` is strictly legacy-only — refuses to reassign a project that is already stamped to a different wallet                                                                                                            | #220  | `src/main/__tests__/projectAssignWallet.test.ts`                                                                                            |
| Workspace stale-state guard        | A wallet switch clears `activeProjectId` in `App.tsx` and navigates Workspace back to Projects                                                                                                                                          | #220  | `src/renderer/__tests__/App.test.tsx` ("clears the open workspace project and returns to Projects when the active wallet changes")          |
| Terminal sessions                  | Sessions are keyed by `(projectId, activeWalletAddress)`; wallet A and wallet B get distinct sessions for the same project; legacy null-wallet sessions migrate once on first claim                                                     | #221  | `src/main/__tests__/terminalSessionWalletScope.test.ts`, `src/main/__tests__/terminalHandlersWallet.test.ts`                                |
| Dashboard data                     | `buildDashboardData` filters projects to those whose `meta.wallet.address` matches the active wallet; balance/royalty fetchers only run for the active wallet; legacy + other-wallet projects excluded from counts                      | #222  | `src/main/__tests__/dashboardData.test.ts` (`buildDashboardData — wallet scoping`)                                                          |
| Dashboard reactive refresh         | Dashboard listens for `WALLET_ACTIVE_CHANGED_EVENT` and re-loads on every switch; `RoyaltyClaimCard` remounts via `key={data.wallet.address}` so wallet A's `royaltyInfo`, `claimHistory`, `confirmOpen`, `claimResult` reset on switch | #222  | `src/renderer/__tests__/DashboardWalletScope.test.tsx`                                                                                      |
| Royalty claim confirmation context | Confirm dialog renders the truncated active wallet (`as 0xabcd…1234`) so the user cannot accidentally claim as the wrong wallet                                                                                                         | #222  | `src/renderer/__tests__/DashboardWalletScope.test.tsx` ("shows the active wallet address as context inside the royalty claim confirmation") |
| Publish preflight                  | When supplied a `projectId`, surfaces an ownership-mismatch error so the confirmation UI can disable Confirm before signing                                                                                                             | #223  | `src/main/__tests__/publishWalletBinding.test.ts`                                                                                           |
| Publish execute                    | Live mode refuses to sign a project owned by a different wallet (`realPublish` never called); mid-flight A→B switch causes the second execute to fail even after the first under A succeeded                                            | #223  | `src/main/__tests__/publishWalletBinding.test.ts` ("a mid-flight wallet switch from A to B mid-test causes the second execute to fail")     |
| Recovery / repair                  | `publish:retryIndex` and `publish:markNotIndexed` run the ownership check unconditionally (mock + live) so wallet B cannot mutate wallet A's `.publish-status.json`                                                                     | #223  | `src/main/__tests__/publishWalletBinding.test.ts` ("refuses in MOCK mode too")                                                              |

## Two-wallet scenario walkthrough

The scenario the issue describes — wallet A and wallet B each with
their own project, publish, and recovery state — is exercised end to
end by the test suites above. The minimal manual equivalent for a
local QA pass is:

1. Start PlotToon with no active wallet. Sidebar shows "Connect
   wallet"; the Projects screen shows the "No active wallet" empty
   state (`data-testid="no-active-wallet-state"`). No project is
   visible regardless of what's on disk.
2. Register / connect a wallet via the switcher. The active wallet
   address appears in the sidebar trigger. The Projects screen
   re-partitions automatically (no app restart) via
   `WALLET_ACTIVE_CHANGED_EVENT`.
3. Create a new project. Open `project.json` — `meta.wallet.address`
   matches the active wallet's lowercased EVM address;
   `meta.wallet.source` is `plottoon-writer` or `plotlink-writer`.
   No `owsName`, `privateKey`, `mnemonic`, `seed`, `passphrase`,
   `secret`, or `vaultPath` is present. (`validateMeta` rejects any
   such key, see `projectMeta.ts` and the
   `projectWalletScope.test.ts` "banned key" cases.)
4. Open a terminal for that project. Note the session id (visible in
   `terminal:findByProject` IPC). Switch to a second wallet via the
   switcher. Workspace navigates back to Projects automatically.
5. Under wallet B: the project from step 3 is in the
   "Unassigned projects" bucket only if it's legacy / unstamped —
   otherwise it sits in the (hidden) other-wallets bucket and is not
   visible at all. Create a project under B — its `meta.wallet`
   matches B. Open a terminal — `terminal:findByProject` returns a
   different session id than wallet A's.
6. Try to assign wallet A's project to wallet B via
   `project:assignWallet`. Handler rejects with "This project is
   already assigned to a different wallet" (#220, strict legacy-only).
7. Open the Dashboard. Counts, balance, royalty, and storylines all
   reflect wallet B only. Open the royalty Claim Royalties button —
   confirmation dialog shows `as 0xbbbb…0002`. Switch back to wallet
   A — dashboard re-fetches, royalty card remounts, wallet A's data
   replaces B's.
8. Try a publish flow against wallet A's project while wallet B is
   active. `publish:preflight(projectId)` returns `ready: false` with
   a "different wallet" error in `errors[]`. `publish:execute` refuses
   with the same error; `realPublish` is never called.

Each of these steps has a corresponding automated test row in the
acceptance matrix above. The smoke test
(`CI=true xvfb-run -a npm run smoke`) covers the no-active-wallet
startup path and the wallet option discovery.

## No first-`plotlink-writer` lookup

All new multi-wallet flows in #218–#223 read the active wallet from
`walletState.wallet` (mirrored from `walletIdentityStore`) or directly
from the identity store via `getActive()`. There is no flow that
picks "the first wallet whose name starts with `plotlink-writer`" as
the active wallet.

A `grep -RIn "plotlink-writer" src/main/ipc src/main/services` returns
these references — verified individually:

- `src/main/services/walletConnection.ts:41` defines
  `PLOTLINK_WALLET_PREFIX = 'plotlink-writer'`. The two uses are:
  - `discoverExistingWallets()` filters the OWS vault entries to
    _only those PlotToon recognizes_ (`plotlink-writer*` or
    `plottoon-writer*`). This is discovery scope, not active-wallet
    selection — the user still picks which discovered wallet to use
    via the switcher (#219) and that selection drives
    `walletIdentityStore.setActive`.
  - The same function maps the prefix to the `source` discriminator
    (`'plotlink-writer'` vs `'plottoon-writer'`) on the returned
    `WalletConnectionOption`. Again, label assignment — not
    selection.
- `src/main/services/projectMeta.ts:95-97` validates that
  `wallet.source` is one of the two known string literals.
  Enum-style validator, not selection.
- `src/main/ipc/projectHandlers.ts:135` is the comment that warns
  future contributors to NOT infer ownership from the first
  `plotlink-writer` wallet — exactly the anti-pattern the issue
  forbids.

No code path uses `entries.find(e => e.name.startsWith('plotlink-writer'))`
as an active-wallet selector. Active wallet selection is always
explicit through the #218 identity store API.

## Cross-repo: `realproject7/plotlink-ows#196`

The cross-repo ticket `plotlink-ows#196` mirrors the same multi-wallet
work for the standalone plotlink-ows web app. As of this QA pass, the
ticket is still OPEN with no comments — the work has not started on
the plotlink-ows side. The scope matches PlotToon's #218–#223 (active
wallet selection, no first-prefix lookup, dashboard/royalty/AI writer
scoped to active wallet, no secret material in metadata).

**Finding:** no PlotToon-side follow-up is needed. The plotlink-ows
team owns #196 and its acceptance criteria are independent of
PlotToon. PlotToon's behavior is now correct on its own: it never
infers ownership from a wallet name prefix and never relies on
plotlink-ows to provide active-wallet selection. When plotlink-ows
implements its own active-wallet model, PlotToon's existing publish
flow will continue to work because it identifies the wallet by
address, not by `name` or selection order, when it signs.

## Public-repo safety

- All addresses in this document and in tests are fake placeholders.
- No `privateKey`, `mnemonic`, `seed`, `passphrase`, `secret`,
  `vaultPath`, or `owsName` appears in any project file, dashboard
  payload, renderer state, log line, or test fixture. `validateMeta`
  rejects any such key on `project.json` read.
- Renderer-side regressions verify the rendered DOM never contains
  OWS internal names or wallet-secret terminology
  (`ProjectListWalletScope.test.tsx`, `DashboardWalletScope.test.tsx`).
