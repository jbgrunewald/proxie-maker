# proxie-maker

Turn a decklist into print-ready Magic proxy card fronts (815×1110 px @ 300 DPI,
sRGB, no alpha — MakePlayingCards' format requirements), with optional custom art
and custom card names. Card data comes from Scryfall's free bulk data — no API keys.

## Workflow

```
npm install
npx playwright install chromium

npm run app        # web app at http://localhost:5987 (downloads Scryfall
                   #   oracle data on first run)
npm run render     # → out/cards/*.png + out/contact-sheet.html
npm run prep       # → out/print/*.png (sharpen + shadow lift — MPC prints dark)
npm run order      # → out/order.xml for the MPC Autofill desktop tool
```

In the app: upload a decklist to see every card in the print template. Drop
your own images into the art tray, drag a thumbnail onto a card to assign it
(auto-positioned), then drag inside the art window to reposition and scroll to
zoom. Everything writes to `data/cards.csv`, which `npm run render` reads.

Cards without assigned art render a placeholder, never the real card's art:
printers screen for Wizards IP, so original art (plus this tool's original
frame) is what actually makes it through an order.

CLI equivalents: `npm run import -- path/to/decklist.txt` imports a decklist
without the app.

Decklists can be plain (`1 Lightning Bolt`), `1x`-style, or MTG Arena exports.
Unresolvable names fail loudly — a typo must not render.

`data/cards.csv` is the project's source of truth and is hand-editable:

- `display_name` — custom card name; the real name then moves to the collector line
- `art_file` — a file in `art/raw/`; blank renders the placeholder
- `crop_x/y/w/h` — source-pixel crop; blank means auto center-crop
- `theme` — frame color override; blank derives it from the card's colors
  (`w u b r g ub multi colorless land`)
- `qty` — copies in the deck (matters for the order, not the render)

Re-importing a decklist preserves existing rows' art assignments and edits.


## Layout

- `template/card.css` — the frame; restyle here, and only here
- `template/fit-text.js` — steps rules-text/name font size down until it fits
- `src/scryfall.ts` — oracle bulk cache (gzipped JSONL), exact-name lookup, art cache
- `src/decklist.ts` / `src/import.ts` — decklist parsing → cards.csv
- `src/render.ts` — Playwright renderer; verifies the MPC format gate per card

- `src/server.ts` — the web app (`npm run app`): decklist import, art upload,
  drag-to-assign and crop write-back, all through `data/cards.csv`
- `src/prep.ts` — print prep: sharpen → ~10% shadow lift → sRGB, no alpha
- `src/mpc-xml.ts` — order XML with local file paths; refuses (exit 1) while
  cards still have placeholder art or missing print files

## Ordering

MakePlayingCards has no API. `out/order.xml` targets the community
[MPC Autofill desktop tool](https://github.com/chilli-axe/mpc-autofill), which
uploads the local files and fills MPC's web designer; checkout stays manual.
Put a card back at `art/cardback.png` before generating the order. MPC can
change their site — verify the tool against the current designer before an
actual order.

Status vs. `HANDOFF.md`: all six build-order stages implemented.

Mana symbol font: npm package `mana-font` (SIL OFL). Card text uses free system
faces — Magic's own fonts are proprietary.
