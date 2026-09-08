# Design — Linkdock · Mobbin-derived

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

## Genre
modern-minimal — gallery-white, monochrome and content-first

## Macrostructure family
- Auth pages: Split Marquee — inverse editorial statement plus kinetic bookmark rails
- App pages: Workbench — soft navigation island, generous canvas and function-led content
- Content/setup pages: Long Document — quiet single-column reading rhythm

## Theme
Mobbin monochrome — pure gallery canvas, near-black ink, neutral tint ladder and one scarce electric-blue accent.

### Light
- `--color-paper`      oklch(100% 0 0)
- `--color-paper-2`    oklch(96.5% 0 0)
- `--color-paper-3`    oklch(94.8% 0 0)
- `--color-ink`        oklch(19% 0 0)
- `--color-ink-2`      oklch(52% 0 0)
- `--color-rule`       oklch(91% 0 0)
- `--color-accent`     oklch(56% 0.24 260)
- `--color-accent-ink` oklch(100% 0 0)
- `--color-focus`      oklch(56% 0.24 260)
- `--color-danger`     oklch(58% 0.24 27)
- `--color-success`    oklch(60% 0.17 155)

### Dark
- `--color-paper`      oklch(15% 0.02 255)
- `--color-paper-2`    oklch(20% 0.022 255)
- `--color-paper-3`    oklch(26% 0.025 255)
- `--color-ink`        oklch(94% 0.005 250)
- `--color-ink-2`      oklch(68% 0.015 255)
- `--color-rule`       oklch(28% 0.025 255)
- `--color-accent`     oklch(72% 0.19 255)
- `--color-accent-ink` oklch(12% 0.02 255)
- `--color-focus`      oklch(72% 0.19 255)
- `--color-danger`     oklch(68% 0.22 27)
- `--color-success`    oklch(70% 0.17 155)

## Typography
- Display: Hanken Grotesk, variable weight 600–650, style normal
- Body: Hanken Grotesk, variable weight 300–500
- Mono: JetBrains Mono, weight 400–500
- Display tracking: -0.02em
- Type scale anchor: --text-display = clamp(2rem, 4vw, 3rem)

## Spacing
4-point named scale. Values in tokens.css. Pages must use named tokens.

## Motion
- Easings: cubic-bezier(0.16, 1, 0.3, 1) named --ease-out
- Reveal pattern: none — composed page
- Reduced-motion fallback: opacity-only, ≤ 150ms

## Microinteractions stance
- Silent success — no celebratory toasts for routine mutations
- Hover delay 800ms on tooltips, 0ms on focus
- Optimistic update + Undo over confirmation dialogs where feasible

## CTA voice
- Primary CTA: near-black stadium pill with white ink
- Secondary CTA: neutral-tint stadium pill without shadow
- Danger: quiet outlined pill until hover

## Per-page allowances
- Auth pages: inverse panel may use the bookmark-rail CSS composition
- App pages: function carries the page — no decorative enrichment, generous controls
- Content/setup pages: typography only, prose-led
- Admin: data tables, minimal chrome

## What pages MUST share
- The wordmark / logotype: "Linkdock" in Hanken Grotesk 700
- The accent colour and its placement (≤ 3% per viewport)
- The display + body + mono fonts
- The CTA voice (stadium shape and near-black primary fill)
- Section heading rhythm: sentence-case label above a heavy display heading

## What pages MAY differ on
- Layout within the page-type family
- Hero archetype within the family's allowance
- Table density on admin pages

## Exports

### tokens.css
See `web/src/styles/tokens.css` — the canonical token file.

### Tailwind v4 @theme
Mirrored in `web/src/styles/mobbin.css` via `@theme inline`.

### shadcn/ui CSS variables
```css
:root {
  --background:         100% 0 0;        /* paper */
  --foreground:         19% 0 0;         /* ink */
  --primary:            19% 0 0;         /* near-black CTA */
  --primary-foreground: 100% 0 0;
  --muted:              96.5% 0 0;       /* paper-2 */
  --muted-foreground:   52% 0 0;         /* ink-2 */
  --border:             91% 0 0;         /* rule */
  --input:              95.5% 0 0;       /* field */
  --ring:               56% 0.24 260;    /* electric-blue focus */
  --radius:             16px;
}
```
