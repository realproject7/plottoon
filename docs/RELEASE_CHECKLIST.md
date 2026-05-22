# Release Readiness Checklist

Pre-release verification for PlotToon builds.

## Code Quality

- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with zero warnings
- [ ] `npm run format:check` passes (Prettier)
- [ ] `npm test` passes all tests
- [ ] `npm run smoke` passes (typecheck + build)
- [ ] No `TODO` or `FIXME` comments blocking release

## Multi-Wallet

- [ ] Two-wallet acceptance matrix in `docs/MULTI_WALLET_QA.md` passes
- [ ] No new code path looks up the active wallet by `plotlink-writer` name prefix; always read from `walletIdentityStore.getActive()`

## Publish Flow

- [ ] Publish preflight validates wallet + config + chain
- [ ] Publish execute completes with mock/dry-run mode
- [ ] Publish confirmation required before signing (not bypassed)
- [ ] Index retry works for published-not-indexed state
- [ ] Content hash uses keccak256 (not SHA-256)
- [ ] All exports under 1 MB per PlotLink constraint

## Security

- [ ] Context isolation enabled (`contextIsolation: true`)
- [ ] Node integration disabled (`nodeIntegration: false`)
- [ ] Preload exposes no wallet signing, private keys, or mnemonics
- [ ] Agent terminal env sanitized (ALLOWED_KEYS whitelist, DENIED_PATTERNS block)
- [ ] No private keys, API keys, or wallet material in source, docs, or logs
- [ ] OWS-only wallet: no browser wallet support, no key export/import
- [ ] Publish and royalty flows require explicit confirmation
- [ ] Content rating validated before publish (blocks without rating)

## Content Gates

- [ ] Content rating defaults to all-ages
- [ ] Mature flag correctly maps to isNsfw on PlotLink
- [ ] Cloud/backend disclosure visible in AtlasCloudGuide
- [ ] Cost warning present for batch generation

## Documentation

- [ ] README has dev setup commands
- [ ] Known limitations documented
- [ ] Publish architecture documented (docs/PUBLISH_ARCHITECTURE.md)
- [ ] PlotLink integration reference current (docs/PLOTLINK_INTEGRATION.md)
- [ ] No private endpoints, credentials, or real passphrases in docs

## Build and Distribution

- [ ] `npm run build` produces working Electron package
- [ ] App launches and renders workspace
- [ ] Agent terminal connects and accepts commands
- [ ] Project create/open workflow functions
- [ ] Cut editor loads and renders overlays

## Public Repo Note

This checklist uses placeholders only. Do not add private keys, API keys, wallet material, private endpoint tokens, or production credentials.
