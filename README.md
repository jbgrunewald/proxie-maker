# proxie-maker

Turn a Magic: The Gathering decklist into print-ready proxy card fronts with
your own custom art, and generate the order file to have them professionally
printed at [MakePlayingCards](https://www.makeplayingcards.com) (MPC).

Card data (rules text, mana costs, types, colors) comes from Scryfall's free
bulk data. **No accounts, no API keys.** Everything runs locally.

**What it makes:** cards with an original frame design, your art, and
optionally your own card names — with the real card name printed in the
collector line so opponents can look it up. Made for personal play, not sale.

**What it deliberately does not do:** reproduce Wizards of the Coast's card
frames, fonts, or art. Print services screen for WotC IP and reject orders
containing it — original frame + original art is what actually gets printed.
Cards without assigned art render a placeholder, never the real card's art.

## How it works

```
decklist ──▶ data/cards.csv ◀──▶ web app (assign + crop art)
                   │
                   ▼
            render (HTML template → Playwright screenshot)
                   │                    out/cards/*.png      815×1110 px
                   ▼
            prep  (sharpen + shadow lift for print)
                   │                    out/print/*.png
                   ▼
            order (MPC Autofill XML)    out/order.xml
```

Every stage reads and writes plain files, so any stage can be re-run alone —
restyling the frame and re-rendering 100 cards costs one command. The CSV is
the single source of truth: the app writes it, you can hand-edit it, and it
belongs in version control alongside your decklist.

## Requirements

- Node.js 22+
- ~500 MB disk: Chromium for rendering (~290 MB, installed by the setup step
  below) and Scryfall's card database (~190 MB, downloaded automatically on
  first run and refreshed weekly; `npm run fetch-oracle` refreshes it by hand)

## Setup

```
npm install
npx playwright install chromium
```

## Quickstart

```
npm run app        # → http://localhost:5987
```

1. **Upload a decklist.** Plain text (`1 Lightning Bolt`), `1x` style, or an
   MTG Arena export. Every name is checked against Scryfall — typos are
   reported, never silently skipped. The gallery then shows each card in the
   real print template: rules text auto-fitted, mana symbols, and the frame
   color derived from the card's colors.
2. **Add your art.** Drop image files into the tray (any size — sources are
   never assumed to match). Drag a thumbnail onto a card to assign it; it
   auto-positions with a centered crop. The tray holds art that isn't on a card
   yet, so an assigned image leaves it — what's left in the tray is what still
   needs a home.
3. **Adjust crops.** Drag inside a card's art window to reposition, scroll to
   zoom. Saves as you go. The × on hover unassigns, returning the image to the
   tray. (A file can still be shared by two cards by naming it in both rows of
   the CSV; the tray just won't offer it twice.)

   **Remove** under a card drops it from the deck — its art goes back to the
   tray, untouched. **Delete** on a tray thumbnail deletes the image file
   itself, which is permanent. Both ask before acting: the first click arms the
   button, the second does it, and clicking elsewhere or pressing Escape backs
   out.

   **⟳** shows a card's back. Every card shares `art/cardback.png` by default;
   drag art onto the flipped card to give that one card its own back, and the ×
   returns it to the shared one. Art used as a back counts as assigned, so it
   leaves the tray like front art does. See
   [docs/card-backs.md](docs/card-backs.md) for where this is going.
4. **Render and prep:**
   ```
   npm run render   # out/cards/  + out/contact-sheet.html for review
   npm run prep     # out/print/  (sharpened, shadows lifted ~10% — MPC prints darker than screens)
   ```
5. **Generate the order:**
   ```
   npm run order            # → out/order.xml
   npm run order -- --draft # same, but allowed while art is still placeholder
   ```
   Without `--draft` this refuses while any card still has placeholder art and
   writes nothing, so a half-finished project can't be ordered by accident.
   `--draft` exists to exercise the handoff to the autofill tool before the art
   is done — the file it writes names placeholder renders, so don't order it.

CLI-only alternative to step 1: `npm run import -- path/to/decklist.txt`.

Every stage is its own script, and each reads and writes plain files, so any of
them can be re-run alone:

| Script | Does |
|---|---|
| `npm run app` | The web app on http://localhost:5987 |
| `npm run dev` | Same, plus live reload — see "Working on the app" |
| `npm run import -- <file>` | Import a decklist without the app |
| `npm run render` | `data/cards.csv` → `out/cards/*.png` |
| `npm run prep` | `out/cards/` → `out/print/` (print correction) |
| `npm run order` | `out/print/` → `out/order.xml` |
| `npm run fetch-oracle` | Refresh the Scryfall cache by hand |

**Start over** in the header empties the project: the decklist and every
uploaded art file in `art/raw/`. Click once to arm, again to confirm — the
deleted art is not recoverable. Rendered output in `out/` is left alone.

## Working on the app

`npm run dev` is `npm run app` plus live reload: `ui/` and `template/` edits
refresh the open browser tab, and `src/` edits restart the server (~2s), after
which the tab reloads itself. `npm run app` has none of it, so a stray save
can't reload the page out from under you while you're placing art.

## Placing the order

MPC has no public API. `out/order.xml` targets the community
[MPC Autofill desktop tool](https://github.com/chilli-axe/mpc-autofill), which
uploads your local files and fills MPC's web designer automatically; you review
and check out in the browser yourself.

- `art/cardback.png` is your card back. If you haven't made one, `npm run order`
  generates a neutral stand-in (original geometry — MPC screens for Wizards'
  card back) at the same 815×1110, through the same print prep as the fronts.
  Drop your own file at that path and it is used instead.
- MPC can change their site at any time — do a small test order, or at least
  re-verify the desktop tool works, before committing to a large one.
- Output meets MPC's requirements: 815×1110 px (63.5×88.9 mm + 3 mm bleed at
  300 DPI), PNG, sRGB, no transparency — verified programmatically on every
  render and prep run.

## The project file: `data/cards.csv`

One row per distinct card. The app maintains it; every column is hand-editable.

There is no database behind this file — it *is* the project — so it is written
carefully:

- **Saves are atomic.** Each write goes to a unique temporary file, is flushed
  to disk, and is renamed over the target, so an interrupted write leaves you
  with the old file rather than a truncated one.
- **Writes are serialised.** Every change goes through one queue, so two edits
  landing together — a crop saving as you click Import — cannot overwrite each
  other.
- **`data/cards.csv.bak` holds one undo, for the changes that lose work.** It
  is written before a save that *removes* cards: **Start over**, **Remove**, or
  a re-import that drops rows. Ordinary edits — art, crops, renames — don't
  touch it, so the undo survives until you next remove something. To recover:

  ```
  cp data/cards.csv.bak data/cards.csv
  ```

  It restores the deck, not art files a **Start over** deleted.
- **A file that can't be read is never written over.** The app reports the
  problem instead of showing an empty project, and refuses to import or to
  touch art while it can't tell which art is in use.

Committing `data/cards.csv` is still the real safety net; the backup is one
step deep, and if you broke the file by hand-editing it, undoing that edit
beats restoring a backup that predates your other edits.

**One writer at a time.** That queue lives inside a single process, so it does
not coordinate between commands: running `npm run import` while `npm run app`
is open, or two copies of the app at once, can lose one side's changes. The
atomic write still holds — you get one complete file or the other, never a
corrupt one — but the loser's edits are gone. This is a deliberate trade-off
for a local single-user tool; a lock file would buy little. Keep one command
writing at a time, or reload the app after a CLI import.

| Column | Meaning |
|---|---|
| `id` | Stable slug, e.g. `the-scarab-god`. Output filenames derive from it. |
| `original_card` | Exact Scryfall name — the data join key. Corrected to canonical spelling on import. |
| `display_name` | Optional custom name shown on the card; the real name then moves to the collector line. |
| `art_file` | File in `art/raw/`. Blank renders the placeholder. |
| `back_art_file` | Optional per-card back image, fitted to the whole card. Blank uses the shared `art/cardback.png`. |
| `crop_x/y/w/h` | Crop in source-image pixels. Blank = auto centered crop. Cleared when `art_file` or `layout` changes. |
| `layout` | `classic` (blank) or `full-art`. Sets the art window's shape; see "Layouts". |
| `theme` | Frame color override. Blank = derived from the card's colors: `w u b r g ub multi colorless land`. |
| `category` | Free tag for your own organization. |
| `qty` | Copies in the deck (drives order slots, e.g. 12 for basic Swamp). |
| `flavor` | Optional flavor text override. |
| `notes` | Free text. |

### Layouts

Two ship today, pickable per card from the dropdown on each card in the app:

- **`classic`** — art in a window inside the frame.
- **`full-art`** — the art *is* the card, bleed included, with the title, type
  and rules panels floating over it as dark translucent glass. Rules text stays
  the same size as classic, so nothing becomes less readable.

Changing a card's layout resets its crop, because the art window changes shape:
classic crops landscape (667×491), full-art crops portrait (815×1110).

Layouts are defined once, in `LAYOUTS` in `src/carddata.ts`, as the art
window's content box in card pixels:

```ts
export const LAYOUTS = {
  classic: { art: { w: 667, h: 491 } },
  'full-art': { art: { w: 815, h: 1110 } },
} satisfies Record<string, LayoutSpec>;
```

A new layout is a row here plus, if it needs more than a differently shaped art
window, a `.layout-<name>` block in `template/card.css` — `full-art` is one such
block, and the card markup is identical for both. The name reaches the template
as a `layout-<name>` class and as the `--art-w` / `--art-h` custom properties,
so the CSS never repeats the numbers, and the app's picker is built from the
server's layout list rather than a hardcoded one.

`npm run render` measures the rendered art window and fails if it disagrees
with the table, so the two cannot drift apart silently — they had, before this
check existed. An unknown layout name in the CSV is an error, not a fallback.

Re-importing a decklist updates quantities and adds/removes rows while
preserving art assignments, crops, and names on kept rows.

## Customizing the frame

The frame is plain HTML/CSS rendered by a headless browser — restyle
`template/card.css` and re-run `npm run render`. Frame color themes are CSS
variables; the card markup lives in `template/card-dom.js` and is shared by
the app's live preview and the print renderer, so what you see in the gallery
is what prints.

Fonts: mana symbols use the openly licensed
[Mana font](https://mana.andrewgioia.com) (SIL OFL); text uses system serif
faces. Magic's own typefaces (e.g. Beleren) are proprietary — don't add them.

## Repository layout

```
data/cards.csv        project file (source of truth, commit it)
data/oracle-cards.jsonl   Scryfall cache (auto-downloaded, gitignored)
art/raw/              your art (gitignored)
docs/                 design notes for work in progress
template/             card.css + card-dom.js + fit-text.js — the frame
src/                  pipeline stages: import, render, prep, mpc-xml, server
ui/                   the web app
out/                  derived output (gitignored): cards/, print/, order.xml
```

## Current limitations

- Double-faced cards (`transform`, `modal_dfc`) render their front face only.
  A card can be given its own back image, but the back *face* is not rendered
  yet — see [docs/card-backs.md](docs/card-backs.md).
- Cards whose two halves share one printed side — Adventures, Splits and
  Flips — render only the first half, so the adventure or the second half of a
  split is missing.
- Tokens aren't generated automatically — add them to the decklist as cards
  if you want them printed.

## A note on proxies

Proxies are for casual play with the consent of your playgroup, and this tool
prints the real card's name in the collector line so nothing is disguised.
Don't sell them, and don't pass them off as genuine cards.
