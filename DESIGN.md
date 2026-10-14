# Vault — Design System

A secure-tool look: near-black neutral surfaces, one yellow brand colour, small corners, layered shadows. It should read as a professional instrument, not a marketing site.

## Principles
1. **Neutral first.** Surfaces are true greys with no blue cast. Yellow is the only chroma, so it always means "primary action" or "live state".
2. **Depth, not decoration.** Panels separate from the page with a 1px border plus a soft shadow. No gradients or glows.
3. **Tight geometry.** Corners are small (4–6px). Nothing is pill-shaped except status badges.
4. **Density with air.** Panels pack information (label, value, meta) but keep 16–24px internal padding.
5. **Codes are data.** Anything the user copies or reads digit by digit (2FA codes, secrets) uses the monospace face in a recessed tile.

## Colour
| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0a0a0a` | `#f1f1ee` | Page background |
| `--surface` | `#141414` | `#ffffff` | Panels, header, sidebar |
| `--surface-2` | `#1c1c1c` | `#f6f6f3` | Inner tiles, hover, active nav |
| `--field` | `#0f0f0f` | `#ffffff` | Inputs, recessed areas |
| `--border` | `#262626` | `#e0e0db` | Panel and row dividers |
| `--border2` | `#3a3a3a` | `#b8b8b1` | Input and outline-button borders |
| `--text` | `#f4f4f2` | `#121212` | Primary text |
| `--muted` | `#8b8b87` | `#66665f` | Secondary text, labels |
| `--primary-bg` | `#f2b705` | `#f2b705` | Primary buttons, brand marks |
| `--accent` | `#f2b705` | `#8a6200` | Yellow used as text or focus ring (darkened on light for contrast) |
| `--on-accent` | `#14110a` | `#14110a` | Text on yellow |
| `--red` / `--green` | `#ff5c5c` / `#3ecf8e` | `#c42b2b` / `#17803f` | Errors, warnings / success |

Rules: never put white text on yellow; never use yellow for body text on light backgrounds (use `--accent`); keep one yellow primary button per view.

## Typography
- **Inter** for everything (400, 500, 600, 700). Headlines 700 with −0.02 to −0.03em tracking.
- **JetBrains Mono** for codes and secrets.
- Scale: 64/38 hero · 32 page title · 24–26 section/panel title · 19 card title · 15 body · 13–14 meta.
- Body line length under 65ch.

## Shape and elevation
- Radius: `--radius-sm` 2px, `--radius` 4px (buttons, inputs, tiles), `--radius-lg` 6px (panels, modals).
- `--shadow-1`: panels at rest. `--shadow-2`: modals. `--edge`: 1px inner top highlight in dark mode that lifts panels off the page.
- Primary buttons get a faint inner highlight and a yellow-tinted shadow.

## Components
- **Panel**: `surface` + 1px `border` + `shadow-1`, 20–24px padding. Header = title (semibold) over muted subtitle.
- **Tile**: `surface-2` + `border` inside a panel, for stats and code values.
- **Buttons**: primary (yellow, dark text), outline (`border2`), ghost, danger (red). Sizes sm / default / lg. Weight 600.
- **Inputs**: `field` background, `border2` border, yellow border on focus.
- **Nav**: sidebar tabs with a 3px yellow bar on the active item.
- **Timer ring**: yellow stroke, turns red in the last 5 seconds.
- **Modal**: `surface`, `radius-lg`, `shadow-2`, 14ms rise-in.
- **Toast**: inverted (light on dark theme), bottom centre.

## Layout
- Marketing pages: 1120px max width, header and content share one gutter.
- Tool pages: fixed 232px sidebar plus a content column up to 960px. Below 860px the sidebar becomes a top bar with horizontally scrolling tabs.

## Logo
`assets/logo.png` is a white V on transparent, already trimmed (500×373). Header height 26px, unlock screen 44px. In light theme the CSS filter inverts it to black. Keep clear space of at least half the mark's height. Favicon: the mark on a `#0a0a0a` rounded square.

## Motion and accessibility
- Motion only answers actions (modal open, button press) and live data (timer ring, code refresh). `prefers-reduced-motion` disables it.
- Visible 2px yellow focus ring on every interactive element.
- Text contrast meets WCAG AA in both themes.
- Theme persists in `localStorage` (`vault-theme`) and is applied before first paint.

## Files
`css/styles.css` holds all tokens and components; pages are plain HTML and share it. Change a token in `:root` or `[data-theme="light"]` to restyle everything.
