# Image Backend Strategy

PlotToon v1 should keep image generation flexible without taking ownership of every provider integration.

## MVP Paths

### Manual Import

Manual clean image import is the baseline path. Users or agents can place generated images into the project, and PlotToon imports them as clean cut images.

### Agent-Managed Generation

Claude/Codex agents may use tools available in the user's local environment to generate images. The agent must save outputs into the expected project asset folder and update `cuts.json` metadata.

Expected output shape:

```txt
plots/plot-01/assets/cut-001/clean-v001.webp
```

The app validates the file and records it as the current clean image.

## AtlasCloud-Style Advanced Option

API-based image engines such as AtlasCloud can be supported as an advanced agent-managed option.

In v1:

- PlotToon provides setup guidance.
- The user configures provider access in their own local agent or shell environment.
- The connected agent decides whether to use the provider.
- PlotToon validates generated output files.
- PlotToon does not store provider API keys.
- PlotToon does not manage provider billing.

## Metadata

When known, image generation metadata should be stored in `cuts.json`:

- Backend id.
- Model.
- Prompt.
- References.
- Attempt count.
- Revision notes.

## Future

A first-class provider adapter can be added later if demand justifies account, billing, model, error, and support maintenance.

