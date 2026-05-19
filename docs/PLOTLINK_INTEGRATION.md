# PlotLink Integration Reference

Integration reference for PlotToon → PlotLink cartoon publishing.

## Upload Endpoint

- **Method:** `POST /api/upload-plot-images`
- **Auth:** Wallet signature (see Wallet Signing Boundary below)
- **Signature transport:** `message` and `signature` fields in the multipart `FormData` body (not headers)
- **Signature message format:**

```text
PlotLink: Upload plot images
Timestamp: {numeric millisecond timestamp via Date.now()}
```

### Constraints

| Limit                   | Value            |
| ----------------------- | ---------------- |
| Max images per batch    | 20               |
| Max file size per image | 1 MB             |
| Accepted formats        | WebP, JPEG       |
| Rate limit              | 3 batches/minute |

### Response Shape

Response contains an ordered array keyed by `index`. Each entry is either a success or a per-file error. PlotToon must treat partial failures individually — a batch with 20 images may have 18 successes and 2 errors.

```typescript
interface UploadResponse {
  results: Array<{
    index: number
    url?: string // CDN URL on success
    cid?: string // content identifier on success
    mimeType?: string // e.g. "image/webp" on success
    sizeBytes?: number // stored file size on success
    error?: string // error message on failure
  }>
}
```

### Error Behavior

- HTTP 401: signature invalid or expired — re-sign and retry
- HTTP 413: file exceeds 1 MB — compress further or reject
- HTTP 429: rate limited — back off and retry after indicated delay
- Per-file errors in 200 response: partial failure — retry only failed indices

## Wallet Signing Boundary

PlotToon uses app-owned signing. The following rules are non-negotiable:

1. **Signing happens in the main process only** — never in renderer, never in agent terminal.
2. **No wallet material in renderer context** — private keys, mnemonics, and signing functions must not cross the IPC boundary.
3. **No wallet material in terminal environment** — the agent terminal env must not contain keys, passphrases, or signing utilities.
4. **No wallet material in source, logs, or docs** — never commit, log, or expose signing secrets.
5. **Signature requests flow through IPC** — renderer requests a signature via an IPC handle; main process signs and returns only the signature string.

### Architecture

```
Renderer (requests upload)
    │
    ▼ IPC: requestSignature(message)
Main Process (owns wallet, signs message)
    │
    ▼ returns: signature string only
Renderer (attaches signature to upload request)
```

## Publish Service (Main Process)

All PlotLink publishing runs in the main process via `src/main/services/plotlinkPublish.ts`. The renderer never touches PlotLink APIs, signing, transactions, or indexing directly — it invokes `publish:preflight`, `publish:execute`, and `publish:retryIndex` IPC handles registered in `src/main/ipc/publishHandlers.ts`.

### Architecture

```
Renderer
    │  ipc: publish:preflight → validates wallet, config, chain
    │  ipc: publish:execute   → uploads, signs, broadcasts, indexes
    │  ipc: publish:retryIndex → retries failed indexing
    ▼
Main Process (owns wallet, OWS signer, contract encoder)
    │  plotlinkPublish.ts  → realPublish(), createPlotlinkUploadClient()
    │  owsViemAccount.ts   → OWS-backed viem LocalAccount
    │  owsRuntimeConfig.ts → vault config, chain validation, contract defaults
    ▼
PlotLink (on-chain StoryFactory + index API)
```

### Field Mapping

| PlotToon (internal)      | PlotLink (outbound)      | When                |
| ------------------------ | ------------------------ | ------------------- |
| `matureFlag`             | `isNsfw`                 | Always              |
| `contentType: "cartoon"` | `contentType: "cartoon"` | New storylines only |
| `storylineTitle`         | `storylineTitle`         | New storylines only |
| `storylineId`            | `storylineId`            | Existing storylines |
| `markdown`               | `content`                | Always              |

### Index Routes

| Route                       | When                     | Key Fields                                                     | Response            |
| --------------------------- | ------------------------ | -------------------------------------------------------------- | ------------------- |
| `POST /api/index/storyline` | New storylines only      | `storylineTitle`, `contentType`, `isNsfw`, `content`, `txHash` | `{ success: true }` |
| `POST /api/index/plot`      | Existing storylines only | `storylineId`, `isNsfw`, `content`, `txHash`                   | `{ success: true }` |

New storylines call only `/api/index/storyline` — the genesis plot is indexed as part of that response. Existing storylines call only `/api/index/plot` with a `chain-plot` transaction hash. `isNsfw` is sent as a string literal (`"true"` / `"false"`).

**Important:** Index routes return only `{ success: true }`. They do NOT return `storylineId`, `plotId`, or `plotUrl`. Publish identifiers must be derived from the transaction receipt/events, not from index responses.

### Content Upload

Content is uploaded via `POST /api/upload` with `{ content, key }` JSON body. The upload client is created by `createPlotlinkUploadClient(plotlinkBaseUrl)` in `plotlinkPublish.ts`. Upload keys are generated per action: `plotlink/storylines/{ts}-{slug}.json` or `plotlink/plots/{storylineId}-{ts}-{slug}.json`.

### Transaction Signing

The main process creates an OWS-backed viem `LocalAccount` via `createOwsViemAccount()`. This account is used with viem's `WalletClient` to sign and broadcast transactions. The renderer never has access to wallet material.

### Content Hash

PlotLink verifies content hashes as `keccak256(toBytes(markdown))`, producing a `0x`-prefixed 64-character hex string (bytes32). SHA-256 hashes are NOT accepted.

### Transaction Flow

1. Upload markdown content to PlotLink `/api/upload`
2. Compute keccak256 content hash
3. Encode contract call via viem (`createStoryline` or `chainPlot` on StoryFactory)
4. Sign and broadcast via OWS-backed viem account
5. Wait for receipt; decode events for storylineId/plotIndex
6. Index via `/api/index/storyline` or `/api/index/plot` with retry
7. Track publish status per plot directory

### Runtime Config

Contract addresses and chain config are resolved via `src/main/services/owsRuntimeConfig.ts`:

- **Chain:** `eip155:8453` (Base mainnet) — enforced in preflight and execute
- **StoryFactory:** `0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf`
- **MCV2_BOND:** `0xc5a076cad94176c2996B32d8466Be1cE757FAa27`
- Env overrides: `PLOTLINK_STORY_FACTORY_ADDRESS`, `MCV2_BOND_ADDRESS`, `BASE_RPC_URL`, `PLOTLINK_BASE_URL`
- OWS vault config loaded from `~/.plotlink-ows/.env` with process.env fallback

## Patterns to Reuse from PlotLink/plotlink-ows

| Pattern                                    | Reuse | Adapt                                          |
| ------------------------------------------ | ----- | ---------------------------------------------- |
| Batch image upload endpoint shape          | ✓     | —                                              |
| Signature message format                   | ✓     | —                                              |
| Per-file error handling in batch responses | ✓     | —                                              |
| Upload state tracking / resume             | —     | Build PlotToon-specific state machine (#45)    |
| Content type declaration (`cartoon`)       | ✓     | PlotToon sets at storyline level, not per-plot |
| Reader markdown rendering                  | ✓     | Verify compatibility only (#50)                |

## Content Type

PlotLink content type is **storyline-level**, not per-plot:

- `fiction` — text-led stories
- `cartoon` — image-led PlotToon content

PlotToon publishes as `cartoon`. This is set once per storyline on PlotLink, not per publish request.

## Public Repo Note

This document uses placeholders only. Do not add private keys, API keys, wallet material, private endpoint tokens, production credentials, or unpublished user story text.
