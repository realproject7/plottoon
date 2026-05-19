<div align="center">

# PlotToon

### Agentic Webtoon Studio for PlotLink

<p>
  <a href="https://plotlink.xyz"><strong>PlotLink</strong></a> ·
  <a href="#what-is-plottoon"><strong>What is PlotToon?</strong></a> ·
  <a href="#how-it-works"><strong>How it Works</strong></a> ·
  <a href="#status"><strong>Status</strong></a>
</p>

<p>
  <a href="https://plotlink.xyz"><img src="https://img.shields.io/badge/PlotLink-plotlink.xyz-8B4513" alt="PlotLink" /></a>
  <img src="https://img.shields.io/badge/status-planning-lightgrey" alt="Status" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-PlotToon%20License-blue" alt="PlotToon License" /></a>
</p>

</div>

---

## What is PlotToon?

PlotToon is a local desktop studio for creating webtoon-style visual stories with a user-provided agent such as Codex CLI or Claude CLI.

It is designed for creators who want to plan, generate, edit, and publish `cartoon` stories to [PlotLink](https://plotlink.xyz).

## How it Works

```txt
Creator idea
  ↓
Agent helps build structure, characters, style, and cut-by-cut story plan
  ↓
Agent generates clean webtoon cuts
  ↓
Creator places speech bubbles, narration, and SFX in PlotToon
  ↓
PlotToon exports final cut images
  ↓
Publish to PlotLink as cartoon content
```

## Planned Features

- Local desktop app
- Project-based webtoon workspace
- Embedded agent terminal
- Cut-by-cut story planning
- Character and style guides
- Clean image cut workflow
- Speech bubble and narration editor
- Final cut export
- PlotLink publishing flow

## Development

### Prerequisites

- Node.js 20+
- npm 10+
- macOS, Linux, or Windows (Electron target)

### Local Setup

```bash
git clone <repo-url> && cd plottoon
npm install
npm run dev          # Start Electron app in development mode
```

### Commands

```bash
npm run dev          # Start Electron app in development mode
npm run build        # Build for production
npm run typecheck    # Run TypeScript type checking
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
npm run format:check # Check formatting without writing
npm test             # Run unit tests (Vitest)
npm run test:watch   # Run tests in watch mode
npm run smoke        # Full smoke check (typecheck + build)
```

### Final Smoke Test

Before opening a PR, run the full verification:

```bash
npm run typecheck && npm run lint && npm run format:check && npm test
```

### Publishing (Local Config)

Real publish requires local OWS wallet configuration. See [docs/PUBLISH_ARCHITECTURE.md](docs/PUBLISH_ARCHITECTURE.md) for the full publish flow. Setup placeholder:

```bash
# ~/.plotlink-ows/.env (local only, never committed)
NEXT_PUBLIC_RPC_URL=<your-base-rpc-url>
NEXT_PUBLIC_APP_URL=<your-plotlink-url>
```

No private keys, API keys, or wallet material should appear in the repository.

## Known Limitations

- **No browser wallet support.** PlotToon uses OWS (Open Wallet Standard) only. Browser extensions (MetaMask, etc.) are not supported.
- **No private key export/import.** Wallet keys are managed entirely by OWS; PlotToon never handles raw key material.
- **Base mainnet only.** Publishing targets `eip155:8453` (Base). Other chains are not supported.
- **Image generation requires external agent.** PlotToon does not generate images natively; a connected agent (Claude CLI, Codex CLI) with configured API access handles generation.
- **1 MB image limit.** All exported cut images must be under 1 MB per the PlotLink upload constraint.
- **Index retry is best-effort.** After on-chain publish, indexing may require manual retry if the PlotLink indexer is slow or unavailable.
- **Desktop only.** PlotToon is an Electron app; there is no web or mobile version.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [PlotLink Integration](docs/PLOTLINK_INTEGRATION.md)
- [Publish Architecture](docs/PUBLISH_ARCHITECTURE.md)
- [Image Backends](docs/IMAGE_BACKENDS.md)
- [Dependencies](docs/DEPENDENCIES.md)
- [Release Checklist](docs/RELEASE_CHECKLIST.md)

## Status

PlotToon is currently in early development.

## License

PlotToon is source-available under the [PlotToon License](LICENSE).

It is free to use for creating and publishing cartoon/webtoon content to PlotLink. Other uses may require separate written permission.
