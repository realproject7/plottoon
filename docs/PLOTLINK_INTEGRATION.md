# PlotLink Integration Reference

Phase 6 implementation boundaries for PlotToon → PlotLink cartoon publishing.

## Upload Endpoint

- **Method:** `POST /api/upload-plot-images`
- **Auth:** Wallet signature (see Wallet Signing Boundary below)
- **Signature message format:**

```text
PlotLink: Upload plot images
Timestamp: {ISO 8601 timestamp}
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

## Ticket Assessment: #49 and #50

- **#49 (Wire PlotToon publish metadata to PlotLink cartoon contentType):** Requires implementation. PlotToon must send `contentType: "cartoon"` in new storyline publish requests (storyline-level, not per-plot). The PlotLink side is ready (plotlink#1212), but PlotToon's publish request builder needs to include it.
- **#50 (Verify PlotToon markdown in PlotLink cartoon reader):** Verification-only after Phase 6 integration. Once #48 publish request is implemented, generate a test publish and confirm PlotLink's cartoon reader (plotlink#1214) renders the image sequence correctly. No new PlotToon code expected unless rendering issues surface.

## Public Repo Note

This document uses placeholders only. Do not add private keys, API keys, wallet material, private endpoint tokens, production credentials, or unpublished user story text.
