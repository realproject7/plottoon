# Publish Architecture

PlotToon's publish flow is adapted from the `plotlink-ows` reference implementation. All publishing runs in the Electron main process; the renderer and agent terminal have no access to wallet material or signing functions.

## Design Principles

1. **OWS-only wallet.** No browser wallet, no private key export/import, no raw key material in app code.
2. **Main process signing.** Wallet operations stay in the main process behind IPC. The renderer requests signatures; it never signs.
3. **Local-only secrets.** OWS vault config lives at `~/.plotlink-ows/.env` and is never committed, logged, or written to project files.
4. **Explicit confirmation.** Publish and royalty/registration flows require explicit user confirmation before any on-chain transaction is signed.

## Publish Flow

```
1. Renderer calls publish:preflight (IPC)
   → Main validates wallet connection, OWS config, chain (Base mainnet eip155:8453)

2. Renderer calls publish:execute (IPC, confirmed=true)
   → Main process orchestrates:

   a. Upload content to PlotLink (/api/upload)
      - JSON body: { content: markdown, key: generated-key }

   b. Compute content hash
      - keccak256(toBytes(markdown)), NOT SHA-256
      - Produces 0x-prefixed bytes32 hex string

   c. Encode contract call via viem
      - createStoryline (new) or chainPlot (existing) on StoryFactory
      - Contract: 0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf

   d. Sign and broadcast via OWS-backed viem LocalAccount
      - owsViemAccount.ts creates a viem LocalAccount backed by OWS
      - Transaction signed in main process only

   e. Wait for receipt; decode events
      - Extract storylineId and plotIndex from transaction logs

   f. Index via PlotLink API with retry
      - /api/index/storyline (new) or /api/index/plot (existing)
      - Up to 10 retries, 30s between, 8s initial delay

   g. Persist publish status
      - .publish-status.json per plot directory
      - Tracks: draft → ready → publishing → published | published-not-indexed | failed
```

## Recovery: published-not-indexed

If indexing fails after a successful on-chain transaction:

1. Status transitions to `published-not-indexed` with the txHash preserved.
2. User can retry via `publish:retryIndex` IPC.
3. Retry sends the existing txHash to the index API — no new transaction is created.
4. On success, status transitions to `published`.
5. Cached index responses (`{ ok: true, cached: true }`) are treated as success.

## Runtime Config Resolution

| Config       | Env Override                     | OWS Vault Fallback    | Default        |
| ------------ | -------------------------------- | --------------------- | -------------- |
| Base RPC URL | `BASE_RPC_URL`                   | `NEXT_PUBLIC_RPC_URL` | Public default |
| PlotLink URL | `PLOTLINK_BASE_URL`              | `NEXT_PUBLIC_APP_URL` | Public default |
| StoryFactory | `PLOTLINK_STORY_FACTORY_ADDRESS` | —                     | Hardcoded      |
| MCV2 Bond    | `MCV2_BOND_ADDRESS`              | —                     | Hardcoded      |

OWS vault config is loaded from `~/.plotlink-ows/.env` as the final fallback before public defaults. Process environment variables take precedence.

## Image Upload

- `POST /api/upload-plot-images` with multipart FormData
- Wallet signature in body fields (not headers)
- Max 20 images per batch, 1 MB each, WebP or JPEG only
- Per-file error handling; partial failures are retried individually
- Upload resume tracks per-cut state (pending/uploaded/failed) with hash matching

## Security Boundary

| Layer          | Access                                                |
| -------------- | ----------------------------------------------------- |
| Main process   | OWS wallet, signing, contract encoding, PlotLink API  |
| Renderer       | IPC-only: preflight, execute (confirmed), retryIndex  |
| Preload        | No wallet, no signing, no key material                |
| Agent terminal | Sanitized env (whitelist + deny patterns), no signing |

See [PLOTLINK_INTEGRATION.md](PLOTLINK_INTEGRATION.md) for field mappings, index routes, and endpoint details.

## Public Repo Note

This document uses placeholders only. Do not add private keys, API keys, wallet material, private endpoint tokens, production credentials, or real passphrases.
