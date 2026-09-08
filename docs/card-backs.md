# Card backs and double-faced cards

Status of the work to give cards their own backs, and to print the second face
of a double-faced card. Updated as each stage lands.

## Why this shape

MPC Autofill's order format already models exactly what we want, so we are not
bending it. In `desktop-tool/src/order.py`:

```python
backs = CardImageCollection.from_element(..., fill_image_id=cardback_elem.text)
# fill_image_id fills: all_slots() - slots()
```

`<cardback>` is the **fill image** for every slot in the order, and `<backs>`
carries per-slot overrides. So "one default back, changed on individual cards"
maps onto one `<cardback>` element plus a `<backs>` entry per exception.

## How many cards actually need this

Of 3,209 two-faced entries in Scryfall's oracle data, only 501 are genuinely
two-sided and need a printed back:

| Scryfall `layout` | Count | Needs a printed back? |
|---|---:|---|
| `transform` | 401 | yes |
| `modal_dfc` | 100 | yes |
| `adventure` | 170 | no — both halves print on the front |
| `split` | 134 | no — both halves print on the front |
| `flip` | 26 | no — both halves print on the front |
| `art_series` | 2,243 | never printed; filtered out in `loadOracle` |
| `double_faced_token` | 80 | filtered out in `loadOracle` |

So detecting a double-faced card is one precise check —
`layout === 'transform' || layout === 'modal_dfc'` — not a taxonomy problem.

The `adventure` / `split` / `flip` cards are a separate, pre-existing gap: they
render only their first face. Tracked under "Not in scope" below.

## Stages

### Stage 1 — a per-card back image ✅

Any card can carry its own back image; everything else keeps the shared
`art/cardback.png`. No double-faced awareness at all.

- `back_art_file` column in `data/cards.csv`; blank means the shared back.
- The image is fitted to the full card (815×1110, centered cover) and goes
  through the same print prep as the fronts.
- `npm run order` emits a `<backs>` entry for each card that has one, and keeps
  `<cardback>` as the default for every other slot.
- In the app, the **Flip** button under a card shows its back; drag art onto it
  from the tray, and the × clears it back to the shared default.
- Art used as a back counts as assigned, so it leaves the tray and cannot be
  deleted from under a card, exactly like front art.

### Stage 2 — render the second face 🔜

For `transform` and `modal_dfc` cards, the back is a *rendered card* — its own
name, type line, rules text, colors and P/T — not just an image.

- `backFace()` and `isDoubleFaced()` in `src/scryfall.ts`.
- `buildCardData` generalized to build either face.
- A second render pass writing `out/cards/<id>-back.png` through the card
  template, so the back gets the same frame, text fitting and print gate.
- `src/prep.ts` needs no change: it globs `out/cards/*.png`, so backs are
  already carried through print prep.
- The back face needs its own art and crop. Planned as `back_crop_x/y/w/h`
  alongside `back_art_file` rather than a second CSV row, because one row per
  distinct card is an invariant that import, remove and the order slot
  arithmetic all rely on.

### Stage 3 — the double-faced UI 🔜

- A flip icon marking double-faced cards in the gallery.
- Flipping shows the rendered back face, with its own art window and crop,
  reusing the per-card `art_window` machinery the layout work introduced.
- A back-mode control: shared default, custom image, or rendered face.

## Not in scope

- Adventure, Split and Flip cards rendering both halves on the front.
- Per-card back *layouts* — backs use the full card, not the layout table.
