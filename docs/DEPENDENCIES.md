# Dependency and License Registry

Machine-readable registry of PlotToon's runtime dependencies, planned dependencies, and licensing notes.

## Built-In Runtime Dependencies

These ship with the application binary.

| Package   | Version | License | Purpose                  |
| --------- | ------- | ------- | ------------------------ |
| Electron  | 42.x    | MIT     | Desktop shell / Chromium |
| React     | 19.x    | MIT     | UI framework             |
| React DOM | 19.x    | MIT     | React renderer for web   |

## Built-In Dev Dependencies

Used during development and CI only. Not shipped to end users.

| Package                   | Version | License    | Purpose                |
| ------------------------- | ------- | ---------- | ---------------------- |
| TypeScript                | 5.x     | Apache-2.0 | Type checking          |
| Vite                      | 6.x     | MIT        | Bundler                |
| electron-vite             | 3.x     | MIT        | Electron + Vite bridge |
| Vitest                    | 4.x     | MIT        | Test runner            |
| ESLint                    | 10.x    | MIT        | Linter                 |
| Prettier                  | 3.x     | MIT        | Code formatter         |
| @vitejs/plugin-react      | 4.x     | MIT        | React fast refresh     |
| @testing-library/react    | 16.x    | MIT        | Component test utils   |
| @testing-library/jest-dom | 6.x     | MIT        | DOM test matchers      |
| jsdom                     | 29.x    | MIT        | DOM environment        |
| @types/react              | 19.x    | MIT        | React type definitions |
| @types/react-dom          | 19.x    | MIT        | ReactDOM type defs     |
| typescript-eslint         | 8.x     | MIT        | TS ESLint rules        |
| eslint-plugin-react-hooks | 7.x     | MIT        | React hooks lint rules |
| @eslint/js                | 10.x    | MIT        | ESLint core rules      |

## Vendored Fonts

Webfont binaries committed under `src/renderer/assets/fonts/` and bundled into the renderer at build time. No runtime network fetch.

| File                     | Family     | Subset / Variant             | License                         | Source                         |
| ------------------------ | ---------- | ---------------------------- | ------------------------------- | ------------------------------ |
| `Newsreader-latin.woff2` | Newsreader | Latin, variable axis 400–700 | SIL Open Font License 1.1 (OFL) | Google Fonts (Production Type) |

The OFL license text is stored verbatim alongside the font at `src/renderer/assets/fonts/OFL.txt`. Per OFL §2 the license and copyright notice must accompany any redistribution; the OFL.txt file satisfies that requirement.

Adding a new vendored font:

1. Drop the file under `src/renderer/assets/fonts/`.
2. Save the upstream license text next to it (`OFL.txt`, `LICENSE`, etc.).
3. Add a row to the table above.
4. Declare an `@font-face` rule in `src/renderer/tokens.css` using a relative `url('./assets/fonts/...')` reference so Vite picks it up.

## Planned Runtime Dependencies

Dependencies expected in upcoming issues. Actual versions will be recorded when added.

| Package | License    | Purpose                   | Status  |
| ------- | ---------- | ------------------------- | ------- |
| sharp   | Apache-2.0 | Image processing / export | Planned |
| zustand | MIT        | Client state management   | Planned |

## Optional External Connectors

These tools are **not bundled** with PlotToon. They run in the user's local environment and are accessed by agents or user configuration. PlotToon does not distribute, link, or embed them.

| Tool / Service   | License    | Interaction Model                    | Notes                                        |
| ---------------- | ---------- | ------------------------------------ | -------------------------------------------- |
| Image gen APIs   | Varies     | Agent calls external API             | User configures credentials in their own env |
| ComfyUI          | GPL-3.0    | Agent sends requests to local server | External-only; not embedded or linked        |
| Stable Diffusion | CreativeML | Agent manages via local tools        | External-only; not embedded or linked        |

### GPL Boundary

GPL-licensed tools (e.g., ComfyUI) are documented as **external-only connectors**. PlotToon communicates with them over HTTP or CLI as a separate process. PlotToon does not embed, link, or distribute GPL code. If this boundary changes in the future, licensing must be reviewed before any integration.

## Project License

PlotToon is source-available. The project license is documented in the repository root. Dependencies must be compatible with the project's license terms. Copyleft dependencies (GPL, AGPL) must not be bundled or linked — they may only be used as external connectors.

## Updating This Registry

When adding a new dependency:

1. Add it to the appropriate table above.
2. Record the license from the package's `LICENSE` file or npm registry.
3. If the license is GPL or AGPL, it must go in the **Optional External Connectors** section with a note that it is external-only.
