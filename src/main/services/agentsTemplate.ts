export function generateGlobalAgentsMd(): string {
  return `# PlotToon — Global Agent Instructions

These instructions apply to all AI agents working within PlotToon projects.

## Identity

You are an AI assistant helping create webtoon-style visual stories using PlotToon.

## Core Rules

- **cuts.json is canonical.** Every plot's \`cuts.json\` is the single source of truth. Never create a second source of truth for cut data. Generated files like \`plot-text.md\` are derived views — regenerate, never edit them directly.
- **Clean images only.** Generated images must be suitable for general audiences. Do not produce violent, explicit, or harmful visual content.
- **Cut terminology.** Use "cut" (not "panel", "frame", or "scene") when referring to individual visual units in a webtoon plot.
- **No secret access.** Never read, write, log, or transmit private keys, API keys, wallet material, credentials, or tokens. Use placeholders if configuration examples are needed.
- **Respect file ownership.** Do not modify exported files in \`exports/\` directories — these are build artifacts. Do not modify \`project.json\` unless the user explicitly requests metadata changes.

## File Conventions

- Place generated images in the plot's \`assets/\` folder.
- Use the \`cut-NNN\` naming convention for cut IDs (e.g., \`cut-001\`, \`cut-012\`).
- Keep image paths in \`cuts.json\` relative to the project root.
- Write all text content in UTF-8.

## Workflow

1. Read \`cuts.json\` to understand the current state of a plot.
2. Make changes to \`cuts.json\` (add/edit cuts, update image state).
3. Regenerate \`plot-text.md\` from the updated \`cuts.json\` if it exists.
4. Never skip validation — all \`cuts.json\` writes must pass schema validation.
`
}

export function generateProjectAgentsMd(projectName: string): string {
  return `# ${projectName} — Agent Instructions

Instructions for AI agents working on this project.

## Project Context

This is a webtoon project managed by PlotToon.

## Conventions

- **cuts.json is canonical.** Each plot's \`cuts.json\` is the single source of truth for that plot's structure, dialogue, narration, overlays, and image state.
- **Cut terminology.** Always use "cut" to refer to individual visual units — not "panel", "frame", or "scene".
- **Clean images only.** All generated images must be suitable for general audiences.
- **No secret access.** Never read, write, log, or transmit private keys, API keys, wallet material, credentials, or tokens. Use placeholders only.

## File Structure

\`\`\`
${projectName}/
├── project.json          # Project metadata (do not edit unless requested)
├── structure.md          # Story arc outline
├── genesis.md            # Project origin and goals
├── style-guide.md        # Visual style reference
├── AGENTS.md             # This file
├── .publish-status.json  # Publish state
├── characters/           # Character definitions
└── plots/
    └── <plot-slug>/
        ├── cuts.json     # Canonical cut data
        ├── plot-text.md  # Generated from cuts.json (do not edit)
        ├── assets/       # Generated images
        └── exports/      # Build artifacts (do not modify)
\`\`\`

## Working with Cuts

- Use \`cut-NNN\` IDs (e.g., \`cut-001\`, \`cut-012\`).
- Keep image paths relative to the project root.
- Set \`imageState.status\` to \`pending\` for new cuts.
- Update \`imageState.status\` to \`done\` and set \`imageState.path\` after generating an image.
- Include \`direction\` for art guidance and \`dialogue\` for spoken text.
- Use \`narration\` for narrator voice-over or internal monologue.
- Use \`continuityNotes\` to track visual consistency across cuts.

## Restrictions

- Do not modify files in \`exports/\` directories.
- Do not create a second source of truth — derive views from \`cuts.json\`.
- Do not commit or transmit secrets of any kind.
`
}
