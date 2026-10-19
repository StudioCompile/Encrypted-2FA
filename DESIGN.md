# Vault — Design System

A professional tool: square, high contrast, one accent colour. No gradients, no glows, no rounded corners.

## Principles
1. **Square.** Every border radius is 0. Buttons, inputs, panels, dialogs, toasts, badges.
2. **High contrast.** Text is pure black on white or pure white on black. Control borders are at least 4.5:1 against the background; dividers are the only low-contrast lines.
3. **One accent.** Blue marks the primary action, the active nav item and focus. It is never used decoratively.
4. **Plain language.** One account, three places: Codes, Notes & files, Settings.
5. **Codes are data.** Codes use the monospace face with tabular figures.

## Tokens (`css/styles.css`)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#ffffff` | `#000000` | Page |
| `--surface` | `#ffffff` | `#0c0c0c` | Panels, sidebar |
| `--subtle` | `#f0f0f0` | `#1b1b1b` | Hover, active nav, dialog footers |
| `--line` | `#d4d4d4` | `#333333` | Row dividers |
| `--edge` | `#8c8c8c` | `#5e5e5e` | Panel outlines |
| `--border` | `#5c5c5c` | `#9a9a9a` | Inputs and outline buttons |
| `--text` / `--muted` | `#000` / `#454545` | `#fff` / `#c4c4c4` | Text |
| `--accent` | `#0047cc` | `#5c9dff` | Primary action, focus, active nav |
| `--danger` / `--ok` / `--warn` | `#b00020` / `#0a6b2d` / `#8a5000` | `#ff6b6b` / `#4ade80` / `#ffc247` | State |

Theme follows the system by default; Settings can force light or dark (`vault.theme` in localStorage, applied by `js/theme.js` before first paint).

## Type
System UI font stack and system monospace. Body 15px, page title 28px, section 20px. Weights 400/500/700.

## Components
* **Buttons:** 40px (32 small, 48 large). Primary (accent fill), outline, danger, ghost. One primary per view.
* **Inputs:** 42px, 1px `--border`, 2px accent focus outline.
* **Panel:** 1px `--edge` border, rows separated by `--line`.
* **Code row:** avatar square, name, monospace code, seconds left, and a 3px countdown bar that turns red in the last 5 seconds.
* **Dialogs:** native `<dialog>`, header / body / footer, footer on `--subtle`.
* **Notices:** 4px left rule in accent, warning or danger colour.
* **Icons:** [Lucide](https://lucide.dev) (ISC), built into `assets/icons.svg` by `npm run icons`.

## Layout
Sidebar 252px (Codes, Notes & files, Settings, account block with Lock and Sign out); content max 1000px. Below 820px the sidebar becomes a top bar with three tabs.

## Accessibility
Visible 2px focus ring, labelled controls, `role="alert"` errors, `aria-current` nav, reduced-motion support, and AA contrast in both themes.
