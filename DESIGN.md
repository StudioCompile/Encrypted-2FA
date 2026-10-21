# Vault — Design System

Friendly and calm: rounded corners, soft outlines, plenty of colour, no gradients. Everything eases in and out.

## Principles
1. **Rounded.** Cards 22px, controls 14px, small items 10px, toast and pills fully round.
2. **Soft outlines.** Borders are barely lighter than the surface. Hover and focus use colour, not heavy lines. Focus rings stay clearly visible.
3. **Colour with meaning.** Violet is the main action. Each code and note gets its own colour (six in rotation). Red only means danger or "about to expire".
4. **No gradients.** Flat colour only. Tints use `color-mix()` on a single colour.
5. **Smooth.** Pages rise in, dialogs pop, buttons lift on hover and press in on click, the countdown glides. All motion stops for people who prefer reduced motion.
6. **Plain words.** Three places: Codes, Notes, Settings. Short labels, one idea per screen. Terms: passcode (you type it), passkey (fingerprint or face), recovery key (backup).

## Tokens (`css/styles.css`)
Dark is the default look on dark systems; light follows the same names.
| Token | Use |
|---|---|
| `--bg`, `--surface`, `--subtle` | Page, cards, hover and fields |
| `--line`, `--border` | Soft dividers, input outlines |
| `--accent`, `--accent-soft` | Main action, active nav, highlight tint |
| `--c1`…`--c6` | Item colours: violet, mint, amber, coral, sky, pink |
| `--danger`, `--ok`, `--warn` | State |

## Components
* **Buttons:** 42px (34 small, 52 large), rounded, lift on hover. One primary per view.
* **Inputs:** 46px, soft outline, glow ring on focus.
* **Code row:** coloured avatar, name, monospace code, seconds left, and a rounded countdown bar in the row colour that turns red at the end.
* **Sidebar:** a floating rounded card with Codes, Notes, Settings and the lock button.
* **Create-a-vault steps:** a small "Step 1 of 3" bar above each setup screen.
* **Dialogs:** native `<dialog>`, soft blur behind, pop-in.
* **Icons:** [Lucide](https://lucide.dev) (ISC), built into `assets/icons.svg` by `npm run icons`.
