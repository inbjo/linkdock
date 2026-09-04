# Design — Linkdock

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

## Genre
modern-minimal

## Macrostructure family
- Auth pages: Marquee Hero — single bold statement fills viewport
- App pages: Workbench — product UI is the primary content, guided by function
- Content/setup pages: Long Document — reads like a memo, continuous prose with inline section heads

## Theme
Cobalt — cool engineered paper, one electric cobalt accent.

### Light
- `--color-paper`      oklch(98.5% 0.002 250)
- `--color-paper-2`    oklch(96% 0.003 250)
- `--color-paper-3`    oklch(93% 0.004 250)
- `--color-ink`        oklch(22% 0.02 260)
- `--color-ink-2`      oklch(48% 0.015 260)
- `--color-rule`       oklch(91% 0.004 250)
- `--color-accent`     oklch(55% 0.22 255)
- `--color-accent-ink` oklch(98% 0.01 250)
- `--color-focus`      oklch(55% 0.22 255)
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
- Display: Space Grotesk, weight 500–700, style normal, tracking -0.02em
- Body: Inter, weight 400–500
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
- Primary CTA: cobalt-filled pill, white ink, 6px radius, 0.5rem 1rem padding
- Secondary CTA: outlined pill, ink border, transparent fill, same radius
- Danger: red-filled pill, same shape

## Per-page allowances
- Auth pages: typography only, centered, generous whitespace
- App pages: function carries the page — no enrichment, tight controls
- Content/setup pages: typography only, prose-led
- Admin: data tables, minimal chrome

## What pages MUST share
- The wordmark / logotype: "Linkdock" in Space Grotesk 700
- The accent colour and its placement (≤ 5% per viewport)
- The display + body + mono fonts
- The CTA voice (pill shape, 6px radius, padding rhythm)
- Section heading rhythm: label (mono uppercase) + display heading

## What pages MAY differ on
- Layout within the page-type family
- Hero archetype within the family's allowance
- Table density on admin pages

## Exports

### tokens.css
See `web/src/styles/tokens.css` — the canonical token file.

### Tailwind v4 @theme
Mirrored in `web/src/styles/index.css` via `@theme inline`.

### shadcn/ui CSS variables
```css
:root {
  --background:         98.5% 0.002 250;  /* paper */
  --foreground:         22% 0.02 260;     /* ink */
  --primary:            55% 0.22 255;    /* accent */
  --primary-foreground: 98% 0.01 250;    /* accent-ink */
  --muted:              96% 0.003 250;   /* paper-2 */
  --muted-foreground:   48% 0.015 260;   /* ink-2 */
  --border:             91% 0.004 250;   /* rule */
  --input:              91% 0.004 250;   /* rule */
  --ring:               55% 0.22 255;   /* focus */
  --radius:             6px;
}
```
