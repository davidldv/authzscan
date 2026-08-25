# Design

Recorded from the built surface (`landing/index.html`), not from intention. Ground truth.

## The world: The Authorization Matrix

Correct object-level authorization draws a diagonal. Each subject reaches its own objects and nothing else. An IDOR is one filled cell sitting off that diagonal. The landing page *is* that matrix, read five ways down the scroll, and it deliberately refuses the arrangement this category ships by default: near-black ground, one neon accent, rounded feature cards in an auto-fit grid.

Chosen by the user over the dice-assigned direction (an access-log world). Seed key `d6250b25`, direction round, persuade mode, code-led build.

## Ground and light

Light, cool, institutional. The use scene is a security reviewer reading a diff at their desk under daylight and overhead fluorescents, so the page is lit like a printed register rather than a terminal.

| Token | Value | Role |
|---|---|---|
| `--ground` | `#e5e7e2` | Page ground. Cool grey-white with no warmth in it. Not cream. |
| `--paper` | `#f2f3f0` | Cell ground, masthead, the closing band. |
| `--ink` | `#111417` | Text, and the fill of a legitimately owned cell. |
| `--ink-2` | `#585c56` | Secondary text and every axis label. |
| `--rule` | `#c5c8c0` | Band and container rules. |
| `--rule-2` | `#d7dad2` | Cell rules inside the matrix. |
| `--breach` | `#c8102e` | The one alarm colour. |
| `--breach-deep` | `#8f0a1f` | The field the breach band is drenched in. |
| `--hold` | `#166b39` | A confirmed-good state. Used sparingly. |
| `--cell` | `48px`, `34px` under 640px | The grid unit everything reflows in. |

Colour strategy is committed rather than restrained: red owns a whole band at page scale (the two-query comparison), and outside that band it appears only where it carries the verdict. It is never decoration.

## Type

Two families, one system.

- **Archivo** (variable, `wdth` 62 to 125) is the voice. Headings run at `wdth` 118 / `wght` 800, which reads as an engineering chart title rather than a marketing hero. Body at `wdth` 100.
- **Martian Mono** (variable) carries every coordinate and measurement: axis labels, matrix cells, the readout, code, metrics, exit codes. Mono is never used as a costume for "technical"; if it is set in mono, it is data.

Scale: `h1` `clamp(2.5rem,6.4vw,5rem)`, `h2` `clamp(1.9rem,4vw,3rem)`, `h3` `1.06rem`. Body 17px/1.62, measure capped at 66ch. `font-feature-settings:"tnum"` is on globally so numerals in tabular data line up.

## Composition rules

- **The grid admits itself.** Hairline rules run through every band and are never hidden behind a card. In the hero's right column the matrix's own row rules continue as a repeating background under the headline.
- **Whole cells only.** The matrix, the eval register, and the pipeline reflow in whole units, never fractions.
- **Absence is information.** A hardened twin renders as an outlined cell, not a missing one. The `not analyzed` state has a drawn swatch of its own.
- **No eyebrows.** Pipeline steps carry their number inline inside the heading (`<h3><i>01</i>Inventory</h3>`), because the sequence is load-bearing, but nothing sits above a heading as a kicker.
- **No cards as page structure.** Sections are ruled registers sharing 1px gaps over a rule-coloured background, not floating rounded boxes.

## Components

- `.mx` — the hero matrix. A real `<table>` with `<th scope>` on both axes. Owned cells are ink blocks with a 3px inset; the single breach cell is the same block in `--breach`.
- `.readout` — the signature interaction. Hovering or focusing a cell lights its full row and column plus both axis labels, and prints `subject → object · owner · verdict`. Keyboard access is a roving tabindex with arrow-key movement, so the grid is one tab stop, not seventy-two.
- `.row-cmd` — the install command as an operable matrix row. Appears twice: hero and close.
- `.pipe`, `.states`, `.reg`, `.counter`, `.truth` — all the same register grammar at different densities.

## Motion

One authored moment. On load the ownership diagonal seats cell by cell (`seat`, 0.34s, `cubic-bezier(.16,1,.3,1)`, staggered 38ms), which is the scan sweeping the grid, and the breach cell lands last. The whole thing is inside `@media(prefers-reduced-motion:no-preference)`; with reduced motion every cell is simply present. Nothing else on the page animates on scroll.

## Browser surfaces

Themed rather than left to defaults: `::selection` is breach red on white, `:focus-visible` is a 2px breach outline, the scrollbar is set through `scrollbar-color`, and link underlines use `text-decoration-color:var(--breach)` with a 0.22em offset.

## Voice

Plain, technical, and unhyped, because the product's whole argument is that it does not oversell. Copy carries no em dashes or en dashes. Limits are stated in the same breath as results: the eval section names the single run, the model dependence, the duplicate finding, and the fact that a planted benchmark is easier than a real codebase.

## Guard

`landing/verify.mjs` runs as a pre-ship check. It requires `npx authzscan` and the repo URL to be present, requires exactly two `data-metric` slots, and bans the placeholder string plus the two invented mockup numbers from an early draft. Run `node landing/verify.mjs`; it prints `landing check ok`.
