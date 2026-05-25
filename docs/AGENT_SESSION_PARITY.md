# Agent Session Parity Spec — PlotToon ↔ plotlink-ows

**Status:** implementation complete (#271 / #272 / #273 / #274 merged; #275 QA sign-off in this doc).

This doc maps every agent-session behaviour exposed by `plotlink-ows` to the equivalent PlotToon implementation and pins each parity check to a specific test name. It is the QA sign-off artefact for #275. When a parity bullet is changed, the linked test should be updated in the same PR.

## Scope

PlotToon's agent surface mirrors `plotlink-ows`'s AI-terminal experience. The functional contract is:

- one PTY per `(wallet, project)` pair, launched into the project root with the user's configured AI CLI (Claude or Codex);
- persistence of session metadata + scrollback so a window close / app restart restores the session a user would expect;
- explicit lifecycle UX (resume / fresh / detach / stop / destroy) so the user is never surprised by a destructive operation;
- sanitized env on every spawn so a host-env API key never lands on disk or in a renderer-facing payload.

`plotlink-ows` is the functional source of truth for the terminal panel shape (status dots, reconnect/discard controls, resume-failed fallback). PlotToon is a desktop client, so there is no PlotLink HTTP surface in front of the agent — every check below maps to a main-process module or an IPC handler.

## Design constraints (non-negotiable)

1. **No host-env API key, wallet private key, mnemonic, vault path, or OWS internal wallet name** ever lands on disk or in a renderer-facing IPC payload. The only opt-in is the #276 env bridge for `ATLASCLOUD_API_KEY`, and even then the renderer status surface shows only the configured/enabled flag — not the value.
2. **Wallet A and wallet B must never share** session state or scrollback for the same project. Lookups always normalize the wallet address (lowercased EVM hex).
3. **Destroy is destructive**: `terminal:destroy` removes the in-memory entry AND the persisted record, so adoption on next mount allocates a fresh sessionId.
4. **Detach is non-destructive**: the PTY keeps running; the renderer just stops piping user input.
5. **Resume failure is recoverable**: a `mode: 'resume'` session that exits inside `RESUME_QUICK_EXIT_MS` (5 s) is classified `resume-failed` and the renderer offers a fresh launch — never a silent stuck-disconnected state.

## Reference map

| Surface                | plotlink-ows                                                | PlotToon                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent CLI detection    | shell-based which/where checks                              | `src/main/services/agentRuntime.ts` `detectAgentRuntimes` + `buildLaunchCommand`                                                                                                                                  |
| PTY lifecycle          | `app/routes/terminal.ts` create / resume / discard / max-N  | `src/main/services/terminalSession.ts` `createSession` / `connectSession` / `disconnectSession` / `restartSession` / `destroySession`                                                                             |
| Session persistence    | server-side JSON keyed by session                           | `src/main/services/terminalSessionStore.ts` JSON at `<userData>/config/terminal-sessions.json`, keyed by `<normalizedWallet>:<projectId>`                                                                         |
| Scrollback persistence | server-side log files                                       | `src/renderer/terminalScrollback.ts` IndexedDB at `plottoon-terminal/scrollback`, keyed by `<lowercasedWallet>:<projectId>`                                                                                       |
| IPC layer              | HTTP routes + WebSocket data stream                         | `src/main/ipc/terminalHandlers.ts` `terminal:create` / `terminal:findByProject` / `terminal:connect` / `terminal:disconnect` / `terminal:restart` / `terminal:destroy` + `terminal:data` / `terminal:exit` events |
| Terminal panel         | `app/web/components/TerminalPanel.tsx` (tabs + status dots) | `src/renderer/TerminalPanel.tsx` (status dot + Resume / Start Fresh / Detach / Stop / Destroy)                                                                                                                    |
| Sanitized env          | shell-level allowlist                                       | `src/main/services/agentEnv.ts` `buildAgentEnv` with allowlist + deny patterns + opt-in #276 bridge                                                                                                               |

## Parity checks → test mapping

Each row below is one bullet from the #275 acceptance checklist. Tests are referenced by their `describe` + `it` strings.

### 1. Project open auto-starts or resumes the configured AI agent session

- **Renderer**: `src/renderer/__tests__/TerminalPanel.test.tsx` — `#272 RE1 TerminalPanel — auto-start agent session on mount > calls terminal.connect with current dims when the new session is disconnected and has a Claude agent`.
- **Main**: `src/main/__tests__/agentSessionParity.test.ts` — `#275 parity — Claude fresh session allocates a UUID that survives restart > first terminal:create allocates a UUID; restart adopts the same UUID via persistence`.

### 2. Claude fresh session uses a persisted UUID; resume uses that session id

- **Spawner**: `src/main/__tests__/terminalSessionAgent.test.ts` — `#272 connectSession — spawns the configured agent command... > spawns Claude (claude --session-id ... in projectRoot) when agentKind=claude on fresh session`.
- **Launch builder**: `src/main/__tests__/agentRuntime.test.ts` — `#271 buildLaunchCommand — Claude > builds a Claude resume launch with --resume <sessionId>` and `> throws AgentLaunchError when resume is requested without a sessionId`.
- **Persistence + restart**: `src/main/__tests__/terminalHandlersWallet.test.ts` — `#273 terminalHandlers — restore persisted session metadata across restarts > terminal:create returns a session adopted from the persisted store after restart`.

### 3. Codex behaviour matches the supported local CLI resume behavior documented in #271

- **Spawner**: `src/main/__tests__/terminalSessionAgent.test.ts` — `> spawns Codex (codex -C <projectRoot>) when agentKind=codex on fresh session`.
- **Launch builder + limitation doc**: `src/main/__tests__/agentRuntime.test.ts` — `#271 buildLaunchCommand — Codex > builds a Codex resume launch as 'codex resume' (interactive picker per documented limitation)` and `> documents the deterministic-resume limitation via codexResumeLimitations`.

### 4. Closing/reopening Workspace restores session metadata and scrollback

- **Metadata**: `src/main/__tests__/terminalSessionStore.test.ts` — `#273 terminalSessionStore — round trip > round-trips a single record`.
- **Scrollback**: `src/renderer/__tests__/terminalScrollback.test.ts` — `#273 terminalScrollback — round trip > writes then reads scrollback for (wallet, project)`.
- **Combined restore-on-mount**: `src/renderer/__tests__/TerminalPanel.test.tsx` — `#273 TerminalPanel — scrollback restore (uses fake content only) > restores persisted scrollback for (wallet, project) on mount`.

### 5. App restart restores session metadata and offers/resumes correctly

- **Adoption across restart**: `src/main/__tests__/agentSessionParity.test.ts` — `#275 parity — Claude fresh session allocates a UUID that survives restart > first terminal:create allocates a UUID; restart adopts the same UUID via persistence`.
- **Resume-mode auto-pick**: `src/main/__tests__/terminalHandlersWallet.test.ts` — `#273 terminalHandlers — restore persisted session metadata across restarts > terminal:create returns a session adopted from the persisted store after restart`.

### 6. Wallet A and wallet B never share agent session state or scrollback for the same project

- **In-memory session**: `src/main/__tests__/terminalSessionWalletScope.test.ts` — `terminalSession wallet keying (#221) > creates separate sessions for the same project under wallet A and wallet B` + `> switching wallets does not return the previous wallet's session` + `> destroying wallet A's session leaves wallet B's untouched`.
- **Persisted file**: `src/main/__tests__/terminalSessionStore.test.ts` — `#273 terminalSessionStore — wallet scoping > keys records by (walletAddress, projectId)` + `src/main/__tests__/agentSessionParity.test.ts` — `#275 parity — wallet A and wallet B never share session state for the same project > persisted session file rejects cross-wallet adoption`.
- **Scrollback**: `src/renderer/__tests__/terminalScrollback.test.ts` — `#273 terminalScrollback — wallet scoping (no cross-wallet bleed) > reads from wallet A do not return wallet B's content for the same project`.
- **Cross-boot regression**: `src/main/__tests__/agentSessionParity.test.ts` — `#275 parity — wallet A and wallet B never share session state for the same project > terminal:create under wallet A then under wallet B produces distinct sessionIds`.

### 7. Detach does not kill the running agent

- **Renderer**: `src/renderer/__tests__/TerminalPanelLifecycle.test.tsx` — `#274 TerminalPanel — detach does NOT kill the PTY > Detach is a renderer-only state change — never calls terminal.disconnect or destroy`.

### 8. Stop/destroy kills only the selected wallet/project session

- **Stop**: `src/renderer/__tests__/TerminalPanelLifecycle.test.tsx` — `#274 TerminalPanel — lifecycle controls > connected → Stop calls terminal.disconnect (does NOT destroy)`.
- **Destroy confirm**: `src/renderer/__tests__/TerminalPanelLifecycle.test.tsx` — `#274 TerminalPanel — destroy requires explicit confirm > first click sets confirm state but does NOT invoke terminal.destroy`.
- **Destroy isolation**: `src/main/__tests__/agentSessionParity.test.ts` — `#275 parity — destroy actually destroys (no resurrection across restart) > terminal:destroy + restart yields a fresh sessionId, not the destroyed one`.
- **Wallet isolation on destroy**: `src/main/__tests__/terminalSessionWalletScope.test.ts` — `> destroying wallet A's session leaves wallet B's untouched`.

### 9. Resume failure falls back or prompts cleanly

- **Classifier**: `src/main/__tests__/terminalSessionResumeFailed.test.ts` — `#274 connectSession — resume-failed classification > flips state to resume-failed when a resume session exits within RESUME_QUICK_EXIT_MS` (+ negative branches for fresh / late-exit / legacy null-agent).
- **Renderer fallback**: `src/renderer/__tests__/TerminalPanelLifecycle.test.tsx` — `#274 TerminalPanel — resume-failed fallback > IPC exit event with state=resume-failed flips the panel into the recovery surface`.

### 10. Sanitized env remains enforced

- **Allowlist + deny patterns**: `src/main/__tests__/agentEnv.test.ts` — `buildAgentEnv > includes allowed keys from host env`, `> blocks secret patterns from host env`, `> does not leak non-allowed, non-denied keys`.
- **Opt-in bridge**: `src/main/__tests__/agentEnv.test.ts` — `> #276 bridgedEnv keys land in the output even when the key matches a deny pattern` + `> #276 unrelated deny-pattern keys are still blocked when bridge does not include them`.
- **Spawn-time integration**: `src/main/__tests__/terminalSessionAgent.test.ts` — `#272 connectSession env handling — no secret leakage > does not include any wallet-shaped or private-key env in the spawned env`.

### 11. No renderer-facing payload includes OWS internal wallet name, vault path, passphrase, API keys, private keys, or sensitive local path fragments

- **terminal:create payload shape**: `src/main/__tests__/agentSessionParity.test.ts` — `#275 parity — terminal:create renderer-facing payload shape > contains ONLY the documented SessionMeta keys`.
- **terminal:findByProject payload shape**: `src/main/__tests__/agentSessionParity.test.ts` — `#275 parity — terminal:findByProject renderer-facing payload > returns the same key set as terminal:create when a session exists`.
- **Persisted file leakage check**: `src/main/__tests__/agentSessionParity.test.ts` — `#275 parity — persisted session file contains no secrets, env values, or OWS internals > no secret-shaped string lands on disk even when host env carries one`.
- **Scrollback leakage check**: `src/main/__tests__/terminalSessionStore.test.ts` — `#273 terminalSessionStore — no key/secret leakage on disk > persisted file never carries an env value even if the host has one set`.

## What's intentionally divergent

| Behaviour             | plotlink-ows                 | PlotToon                                                                                                                                                                                                                                                          |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-tab session UI  | tabs across plots            | one panel per Workspace; the Workspace owns the active `(wallet, project)` selection. Multi-tab is out of scope for v1 — there is one session per `(wallet, project)` in memory regardless, so tabs would add UI weight without changing the underlying contract. |
| Server-side log files | per-session log on disk      | scrollback persisted in renderer IndexedDB, capped at 64 KiB tail. PlotToon's desktop process avoids dropping log files on disk so the user's home directory stays clean.                                                                                         |
| Max session guard     | numeric cap (`max-sessions`) | naturally bounded by the 1-per-`(wallet, project)` invariant. We don't expose a numeric cap because the user can't end up with more sessions than `(active wallets) × (open projects)`, and switching either dimension always detaches the previous panel.        |

## Pipeline sign-off

The following were green at the close of #275:

- `npm run typecheck`
- `npm run lint`
- `npm test -- --run`
- `npm run build`
- `CI=true xvfb-run -a npm run smoke`

## Public safety

Every fixture in the linked tests uses a fake EVM address (`0xaaaa...0001`, `0xbbbb...0002`) and fake content sentinels (`fake-test-distinctive-anthropic-key-yzab-9988`, etc.). No real wallet address, API key, vault path, passphrase, or unpublished story content appears in the parity test suite.
