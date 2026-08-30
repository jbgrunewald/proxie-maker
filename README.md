# Neogen card pipeline

Turns exported AI art plus Magic card data into print-ready card fronts for MakePlayingCards.
Full spec: see `HANDOFF.md` (build order steps 1–2 are done; 3–6 pending).

## Current state — validation slice

Renders four fixture cards (`data/fixtures.json`, real Scryfall oracle text) through the
HTML/CSS template with placeholder art, exercising the worst cases: longest rules text,
no rules text, near-overflow with flavor, and a renamed hero card.

```
npm install
npx playwright install chromium
npm run render          # → out/cards/*.png + out/contact-sheet.html
```

Output is verified per card: exactly 815×1110 px, sRGB, no alpha (the MPC format gate).
The renderer logs the auto-fit font size chosen for each card.

- `template/card.css` — the frame; restyle here, and only here
- `template/fit-text.js` — steps rules-text / name font size down until it fits
- `src/render.ts` — Playwright renderer; art is center-cropped by sharp as a stand-in
  for the future crop UI

Note: the Mana symbol font is the npm package `mana-font` (the handoff's
`@andrewgioia/mana` name does not exist on npm), and the handoff's "Wilhelt" is
**Wilhelt, the Rotcleaver** on Scryfall.
