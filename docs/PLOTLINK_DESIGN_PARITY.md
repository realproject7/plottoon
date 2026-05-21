# PlotLink Design Parity Spec for PlotToon

Internal implementation spec. PlotToon should feel like a local desktop extension of PlotLink, not a separate wireframe app. **This pass must not use Open Design-generated independent styling** — every color, radius, control geometry, and component pattern is taken from the PlotLink web app.

## Scope

This document records the tokens, type system, and component patterns PlotToon must mirror. It is descriptive (what to match) plus a visual-parity QA checklist (how to verify). It does not include private endpoints, wallet material, API keys, or unpublished story content.

## Source of Truth

PlotLink files (read-only references — do not vendor or copy code without adaptation):

- `src/app/globals.css` — color tokens, typography, radius
- `src/app/layout.tsx` — root shell, font setup, NavBar mounting
- `src/components/NavBar.tsx` — fixed top nav, logo treatment, active-link styling
- `src/components/ConnectWallet.tsx` — compact border-pill wallet UI
- `src/components/Select.tsx` — custom listbox / dropdown
- `src/components/FilterBar.tsx` — sort tabs, segmented pills, pill selects
- `src/components/StoryCard.tsx` — card radius, border, hover shadow, badges
- `src/components/StoryGrid.tsx` — responsive grid, `--card-gap`

## Color Tokens

PlotToon must define the same CSS variables on `:root` and consume them as `var(--token)` (or via the Tailwind `@theme inline` aliases shown below). Values are OKLCH and must be copied verbatim from PlotLink so light-mode parity is exact.

| Token              | Value                       | Role                                 |
| ------------------ | --------------------------- | ------------------------------------ |
| `--bg`             | `oklch(98% 0.005 70)`       | Page background                      |
| `--surface`        | `oklch(95% 0.008 60)`       | Card / panel surface                 |
| `--surface-raised` | `oklch(91% 0.012 55)`       | Elevated panels, sidebars            |
| `--fg`             | `oklch(20% 0.015 50)`       | Primary text                         |
| `--muted`          | `oklch(48% 0.012 50)`       | Secondary text, inactive controls    |
| `--border`         | `oklch(87% 0.008 55)`       | All borders                          |
| `--accent`         | `oklch(52% 0.14 28)`        | Primary accent (PlotLink red-orange) |
| `--accent-dim`     | `oklch(40% 0.10 28)`        | Pressed / hover-darker accent        |
| `--accent-bg`      | `oklch(52% 0.14 28 / 0.08)` | Accent tint behind active controls   |
| `--danger`         | `oklch(50% 0.18 25)`        | Destructive / error                  |
| `--success`        | `oklch(45% 0.14 145)`       | Confirm / success                    |

Tailwind aliases (mirror the PlotLink `@theme inline` block so component code can keep using `bg-surface`, `text-foreground`, etc.):

```
--color-background: var(--bg)
--color-foreground: var(--fg)
--color-surface:    var(--surface)
--color-surface-raised: var(--surface-raised)
--color-muted:      var(--muted)
--color-accent:     var(--accent)
--color-accent-dim: var(--accent-dim)
--color-accent-bg:  var(--accent-bg)
--color-border:     var(--border)
--color-error:      var(--danger)
--color-danger:     var(--danger)
--color-success:    var(--success)
```

Compatibility aliases that PlotLink components still reference and that PlotToon must preserve when reusing the same component patterns: `--text`, `--text-muted`, `--bg-surface`, `--error`, `--bg-shelf`.

## Typography

PlotLink uses `next/font/google` to inject Newsreader and assign it to a CSS variable (`--font-newsreader`). **Electron cannot rely on Next's font injection**, so PlotToon must define an equivalent fallback strategy:

- **Heading / prose stack** (`--font-display`, `--font-heading`, `--font-prose`):

  ```
  'Newsreader', 'Iowan Old Style', Georgia, serif
  ```

  Self-host the Newsreader webfont under `src/renderer/assets/fonts/Newsreader-*.woff2` and load it via a `@font-face { font-display: swap; }` declaration in the renderer CSS. If self-hosting is deferred, the stack still degrades to `Iowan Old Style` (macOS) / `Georgia` (Windows/Linux) without changing the visual rhythm.

- **App / body stack** (`--font-body`, `--font-ui`, `--default-font-family`):

  ```
  -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif
  ```

  System UI only. Do not inject a web sans.

- **Monospace** (`--font-mono`):

  ```
  'SF Mono', ui-monospace, Menlo, monospace
  ```

The `body` element sets `font-family` to the body stack; `h1`–`h6`, `.font-serif`, and `.prose` switch to the heading/prose stack. PlotToon's renderer global CSS must apply the same rules.

## Radius

- `--card-radius: 4px` for cards and image-bearing panels.
- Default control radius is the Tailwind `rounded` token (4px) — applied to buttons, pills, selects.
- Pill controls use `rounded-full`.
- Pre/code blocks use `border-radius: 6px` (matches `.story-markdown pre`).

PlotToon must not introduce a softer / more rounded radius scale. If a renderer-only utility is needed, alias `--card-radius` rather than redefining.

## Buttons

PlotLink buttons are compact, border-first, and low-height. Accent fill is reserved for the single primary action on a screen; everything else uses a transparent / surface background with a thin border.

| Variant                               | Class shape                                                                                                          | Pixel size                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Compact action (nav, wallet, filters) | `inline-flex h-7 items-center rounded border border-[var(--border)] px-2 py-1 text-xs font-medium`                   | 28px tall, 12px text                            |
| Standard action                       | `rounded border border-[var(--border)] px-3 py-1 text-xs font-medium`                                                | ~32px tall, 12px text                           |
| Primary (accent fill)                 | `rounded-lg bg-[var(--accent)] px-3 py-3 text-sm font-semibold text-white`                                           | Reserved for the single primary CTA per surface |
| Pill segment                          | `rounded-full px-2.5 py-1 text-[12px] font-medium` inside a `rounded-full border border-[var(--border)] p-0.5` group | Segmented control                               |
| Selected pill                         | `border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-bg)]` over the base pill                               | Filter chips                                    |

Hover: opacity 0.8 (`hover:opacity-80`) for links/icon buttons, `hover:bg-accent hover:text-background` only for the disconnected-wallet CTA. Do not add custom drop-shadows.

## Cards and Panels

Card pattern (matches `StoryCard.cardClass` and `StoryGrid`):

```
relative block aspect-[2/3] overflow-hidden
rounded-[var(--card-radius)]
border border-[var(--border)]
bg-[var(--surface)]
shadow-[0_1px_3px_oklch(0%_0_0_/_0.06)]
transition-[transform,box-shadow] duration-200 ease-out
hover:scale-[1.03]
hover:shadow-[0_12px_40px_oklch(0%_0_0_/_0.12)]
```

Grid pattern (`StoryGrid`):

```
grid grid-cols-2 gap-[var(--card-gap)] sm:grid-cols-3 lg:grid-cols-4
```

`--card-gap` is `6px`; `--grid-max` is `1280px`; `--page-max` is `1120px`. PlotToon's responsive breakpoints can be denser (it is a desktop window, not a phone), but the card aspect, gap, border, and hover-elevation must remain identical.

Non-card panels (sidebars, project list, inspector) use the same border/surface tokens with thin `1px` borders and minimal shadow. Do not introduce 8px+ radii or layered shadows.

## Navigation

PlotLink's `NavBar` is fixed, 44px tall, with a translucent surface and a backdrop blur:

```
fixed top-0 right-0 left-0 z-50
border-b border-[var(--border)]
bg-[var(--bg)]/95 backdrop-blur-sm
flex h-11 max-w-[var(--grid-max)] items-center justify-between px-4
```

- Logo: `font-heading text-[20px] font-medium tracking-tight`, accent-highlighted second word (`Plot<span class="text-accent">Link</span>`). PlotToon uses the same treatment with `PlotToon` — accent on `Toon`.
- Active link: `rounded px-2.5 py-1 text-xs font-medium` with `bg-[var(--accent)]/15 text-accent`.
- Inactive link: `text-muted hover:text-foreground`.

**Desktop shell adaptation**: PlotToon already runs in an Electron shell with a sidebar (`AppShell`). The PlotLink nav must be adapted into that shell — same heights (44px header band, 28px button heights), same colors and active-state treatment — without inventing a new visual language. Specifically:

- Top header band carries the logo and (eventually) the wallet pill.
- Sidebar Projects/Workspace/Status/Guides entries follow the same pill geometry (active = `bg-accent/15 text-accent`, inactive = `text-muted hover:text-foreground`).
- No additional gradients, drop shadows, or beveled tabs.

## Wallet UI

`WalletSelector` must adopt the PlotLink `ConnectWallet` compact border-pill style, not the default HTML `<button>` list it currently renders.

Connected pill (full):

```
inline-flex items-center gap-1.5
rounded border border-[var(--border)]
px-3 py-1
text-xs font-medium text-[var(--accent)]
hover:opacity-80 transition-opacity
```

Compact / mobile variant: same classes with `h-7` and `px-2`.

Disconnected CTA:

```
rounded border border-[var(--border)]
px-3 py-1 text-xs font-medium text-[var(--accent)]
hover:bg-[var(--accent)] hover:text-[var(--bg)]
transition-colors
```

Disconnect button (profile context):

```
rounded border border-[var(--border)]
px-2 py-0.5 text-[10px] text-[var(--muted)]
hover:text-[var(--danger)]
transition-colors
```

The current PlotToon disabled / unavailable wallet option (added in #197) must keep the `disabled` attribute + `unavailableReason` text below, but the button itself must adopt the pill geometry above — not a full-width default button.

## Inputs and Selects

Two patterns coexist in PlotLink and PlotToon must use them as-is:

1. **Form-region select** (PlotLink `Select.tsx`): a custom listbox.

   ```
   button:  border-border bg-surface text-foreground
            w-full rounded border px-3 pr-10 py-2 text-left text-sm
            focus:border-accent focus:outline-none disabled:opacity-50
   listbox: border-border bg-surface absolute z-50 mt-1
            max-h-60 w-full overflow-auto rounded border py-1 shadow-lg
   option:  px-3 py-2 text-sm; selected = bg-accent text-background;
            focused = bg-border/50; disabled = text-muted opacity-50
   ```

   Use when the value is part of a form (Create flow, Settings, Filters drawer).

2. **Pill select** (PlotLink `FilterBar` desktop): a native `<select>` styled as a compact pill.

   ```
   inactive: rounded-full border px-3 py-1.5 text-[12px] font-medium
             border-[var(--border)] bg-transparent text-[var(--muted)]
             hover:border-[var(--muted)] hover:text-[var(--fg)]
   active:   border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]
   focus:    focus:border-[var(--accent)] focus:outline-none
   ```

   Use for inline filters in toolbars.

Native `select` elements globally inherit the dropdown arrow override defined in PlotLink `globals.css` (SVG chevron, `padding-right: 2.5rem`). PlotToon must port that block as-is.

Checkboxes: `h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]`.

## Iconography

PlotLink uses Lucide-style inline SVGs at 12–16px, `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`. PlotToon must keep this convention. Do not introduce filled monocolor icons or oversize (24px+) icons in toolbars.

## Visual QA Checklist (before / after)

Use this checklist on both the previous build and the parity build. Each item must match PlotLink's web app on the same screen size (~1280×800 desktop window).

### Tokens

- [ ] `:root` exposes every variable in the [Color Tokens](#color-tokens) table with the exact PlotLink values.
- [ ] Tailwind theme aliases (`bg-surface`, `text-foreground`, `border-border`, `text-accent`, etc.) resolve to the same OKLCH values as in PlotLink.
- [ ] `--card-radius`, `--card-gap`, `--grid-max`, `--page-max` are present with values `4px / 6px / 1280px / 1120px`.

### Typography

- [ ] `body` renders in the system UI stack; no Helvetica/Arial fallback.
- [ ] `h1`–`h6` render in Newsreader (or the documented serif fallback). Heading on the Projects screen is visually identical to PlotLink discover headings.
- [ ] `.prose` blocks (e.g. guides) use the heading/prose stack with line-height 1.7.
- [ ] Monospace renders SF Mono / ui-monospace, never the platform default.
- [ ] No FOIT/FOUT flash on cold start of `npm run dev` (font-display: swap).

### Buttons & Pills

- [ ] Default toolbar buttons are 28px tall, 12px text, bordered, no fill.
- [ ] The single primary action per screen is the only accent-filled button.
- [ ] Segmented pill controls (filter writer / content type) match PlotLink width and selected-state contrast.

### Cards / Grid

- [ ] Project / story cards render with 4px radius, `--border` border, the documented shadow scale, and 2:3 aspect ratio.
- [ ] Hover lifts the card to `scale(1.03)` with the soft 40px shadow — no transform jitter.
- [ ] Grid uses `--card-gap` (6px) at every breakpoint.

### Navigation

- [ ] Top band is 44px, sticky, and renders the `bg-[var(--bg)]/95` translucent surface with backdrop blur.
- [ ] Logo word-mark uses the heading font, with the second half of the brand name in `text-accent`.
- [ ] Active sidebar / nav entry uses `bg-accent/15 text-accent`; inactive uses `text-muted hover:text-foreground`.

### Wallet UI

- [ ] `WalletSelector` renders compact border-pill buttons, not full-width HTML buttons.
- [ ] Disconnected CTA shows the `connect wallet` text in `text-accent` on a bordered pill.
- [ ] Disabled option (OWS unavailable) retains the `disabled` attribute and renders `unavailableReason` below the button without losing pill geometry.

### Inputs / Selects

- [ ] Custom `Select` (form contexts) renders the chevron, the bordered surface button, and a `shadow-lg` listbox.
- [ ] Pill selects (toolbar contexts) collapse to the 12px / 28px geometry described above.
- [ ] Native `<select>` elements show the chevron from `globals.css` (no double-arrow on Linux/Chromium).

### Anti-AI-slop

- [ ] No purple/cyan gradients introduced for emphasis.
- [ ] No emoji decorations injected into buttons or status pills.
- [ ] No oversized 16px+ radii on standard controls.
- [ ] No "glass" cards, no neon glow shadows.
- [ ] No alternate body font; system UI only.

## Implementation Boundaries

- This pass is **design-only documentation**. Token wiring, font loading, and component refactors land in follow-up issues that reference this spec.
- Open Design output (if any was generated for this project) must not be used as the starting point for tokens, components, or layout. Reference PlotLink's web app exclusively.
- Any deviation from PlotLink's values must be called out as an explicit follow-up question before changing UI code.
