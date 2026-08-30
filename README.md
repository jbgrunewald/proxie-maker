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
- ~500 MB disk: Chromium for rendering (~100 MB) and Scryfall's card database
  (~140 MB, downloaded automatically on first run, refreshed weekly)

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
   auto-positions with a centered crop.
3. **Adjust crops.** Drag inside a card's art window to reposition, scroll to
   zoom. Saves as you go. The × on hover unassigns.
4. **Render and prep:**
   ```
   npm run render   # out/cards/  + out/contact-sheet.html for review
   npm run prep     # out/print/  (sharpened, shadows lifted ~10% — MPC prints darker than screens)
   ```
5. **Generate the order:**
   ```
   npm run order    # out/order.xml
   ```
   This refuses to succeed while any card still has placeholder art, so a
   half-finished project can't be ordered by accident.

CLI-only alternative to step 1: `npm run import -- path/to/decklist.txt`.

## Placing the order

MPC has no public API. `out/order.xml` targets the community
[MPC Autofill desktop tool](https://github.com/chilli-axe/mpc-autofill), which
uploads your local files and fills MPC's web designer automatically; you review
and check out in the browser yourself.

- Put your card-back image at `art/cardback.png` before running `npm run order`.
- MPC can change their site at any time — do a small test order, or at least
  re-verify the desktop tool works, before committing to a large one.
- Output meets MPC's requirements: 815×1110 px (63.5×88.9 mm + 3 mm bleed at
  300 DPI), PNG, sRGB, no transparency — verified programmatically on every
  render and prep run.

## The project file: `data/cards.csv`

One row per distinct card. The app maintains it; every column is hand-editable.

| Column | Meaning |
|---|---|
| `id` | Stable slug, e.g. `the-scarab-god`. Output filenames derive from it. |
| `original_card` | Exact Scryfall name — the data join key. Corrected to canonical spelling on import. |
| `display_name` | Optional custom name shown on the card; the real name then moves to the collector line. |
| `art_file` | File in `art/raw/`. Blank renders the placeholder. |
| `crop_x/y/w/h` | Crop in source-image pixels. Blank = auto centered crop. |
| `theme` | Frame color override. Blank = derived from the card's colors: `w u b r g ub multi colorless land`. |
| `category` | Free tag for your own organization. |
| `qty` | Copies in the deck (drives order slots, e.g. 12 for basic Swamp). |
| `flavor` | Optional flavor text override. |
| `notes` | Free text. |

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

## Layout

```
data/cards.csv        project file (source of truth, commit it)
data/oracle-cards.jsonl   Scryfall cache (auto-downloaded, gitignored)
art/raw/              your art (gitignored)
template/             card.css + card-dom.js + fit-text.js — the frame
src/                  pipeline stages: import, render, prep, mpc-xml, server
ui/                   the web app
out/                  derived output (gitignored): cards/, print/, order.xml
```

## Current limitations

- Double-faced cards render their front face only; no card backs beyond the
  one shared `art/cardback.png`.
- Tokens aren't generated automatically — add them to the decklist as cards
  if you want them printed.
- One frame layout (classic frame with art window); no full-art option.

## A note on proxies

Proxies are for casual play with the consent of your playgroup, and this tool
prints the real card's name in the collector line so nothing is disguised.
Don't sell them, and don't pass them off as genuine cards.
