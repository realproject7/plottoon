# PlotToon Architecture

PlotToon is a local desktop studio for creating webtoon-style visual stories for PlotLink.

## Product Shape

PlotToon combines:

- A local project workspace.
- An embedded agent terminal.
- A cut-based webtoon production model.
- A focused lettering/layout editor.
- Deterministic final image export.
- PlotLink cartoon publishing preparation.

The app is not intended to be a full drawing or painting tool.

## Core Boundary

The agent owns creative work:

- Story structure.
- Character and style planning.
- Cut planning.
- Prompt writing.
- Clean image generation or revision through configured tools.
- Overlay placement suggestions.

The app owns deterministic production state:

- Project files.
- `cuts.json` validation.
- Editor state.
- Text and bubble rendering.
- Final image export.
- Compression under the PlotLink image limit.
- Upload and publish readiness checks.
- Wallet/signing boundary.

## Local Project Model

PlotToon projects are file-backed. The app should keep project state readable by both the app and the connected agent.

```txt
webtoons/
  my-webtoon/
    project.json
    structure.md
    genesis.md
    style-guide.md
    AGENTS.md
    characters/
    plots/
      plot-01/
        cuts.json
        plot-text.md
        script.md
        assets/
        exports/
    .publish-status.json
```

## Canonical State

`cuts.json` is the canonical per-plot production file.

`plot-text.md` is a generated human-readable view derived from `cuts.json`. It should not become a competing source of truth.

## Cut Workflow

1. Plan cuts in `cuts.json`.
2. Generate or import clean images.
3. Place bubbles, narration, and SFX in the editor.
4. Store overlays in `cuts.json`.
5. Approve cuts.
6. Flatten final images.
7. Validate file size and metadata.
8. Prepare PlotLink markdown.

## Export Boundary

Published pixels must be deterministic.

PlotToon should upload final flattened images, not live overlay metadata. PlotLink should not need to reproduce PlotToon's editor rendering in v1.

## Non-Goals for MVP

- Full illustration editor.
- Brush painting.
- Manual inpainting UI.
- Automatic speech bubble placement.
- Built-in model training.
- First-class management of every image backend.
- One giant episode strip as the publish artifact.

