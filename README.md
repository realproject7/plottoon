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

```bash
npm install          # Install dependencies
npm run dev          # Start Electron app in development mode
npm run build        # Build for production
npm run typecheck    # Run TypeScript type checking
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
npm run format:check # Check formatting without writing
npm run test         # Run unit tests (Vitest)
npm run test:watch   # Run tests in watch mode
npm run smoke        # Full smoke check (typecheck + build)
```

## Status

PlotToon is currently in early development.

## License

PlotToon is source-available under the [PlotToon License](LICENSE).

It is free to use for creating and publishing cartoon/webtoon content to PlotLink. Other uses may require separate written permission.
