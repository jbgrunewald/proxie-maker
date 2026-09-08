import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { loadCards, ROOT, type CardRow } from './project.js';
import { loadOracle, lookupCard } from './scryfall.js';
import { buildCardData, layoutFor } from './carddata.js';
import { ensurePlaceholderArt } from './placeholder.js';

// Print spec — verified numbers from the production spec, do not recompute.
const CARD_W = 815;
const CARD_H = 1110;

/** Custom art with saved crop → custom art auto-crop → placeholder. */
async function resolveArt(row: CardRow): Promise<Buffer> {
  const { art } = layoutFor(row);
  if (row.art_file) {
    const src = sharp(path.join(ROOT, 'art/raw', row.art_file));
    if (row.crop_w && row.crop_h) {
      // Extract-then-resize ordering is required by the print spec.
      src.extract({
        left: parseInt(row.crop_x || '0', 10),
        top: parseInt(row.crop_y || '0', 10),
        width: parseInt(row.crop_w, 10),
        height: parseInt(row.crop_h, 10),
      });
      return src.resize(art.w, art.h).png().toBuffer();
    }
    return src.resize(art.w, art.h, { fit: 'cover' }).png().toBuffer();
  }
  return sharp(await ensurePlaceholderArt()).resize(art.w, art.h, { fit: 'cover' }).png().toBuffer();
}

async function main() {
  await loadOracle();
  const rows = await loadCards();
  const outDir = path.join(ROOT, 'out/cards');
  await rm(outDir, { recursive: true, force: true }); // derived output — no stale files
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  await page.goto('file://' + path.join(ROOT, 'template/card.html'));

  let failed = false;
  for (const row of rows) {
    const card = lookupCard(row.original_card); // throws loudly on a bad name
    const artData = `data:image/png;base64,${(await resolveArt(row)).toString('base64')}`;
    const cardData = buildCardData(row, card, artData);

    await page.evaluate((c) => (window as any).renderCard(c), cardData);
    await page.waitForFunction(() => {
      const img = document.querySelector('#card .art') as HTMLImageElement | null;
      return !!img && (img.src === '' || img.complete);
    });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const sizes = await page.evaluate(() => (window as any).fitText());

    // Every check for this card lands here, so one card gets one verdict —
    // a per-check flag next to an "ok" line would be worse than no check.
    const problems: string[] = [];

    // The art window's real size must match the layout table, or the art we
    // resized is not the art that gets shown: object-fit: cover silently trims
    // the difference, and the app's crop rectangle is shaped by the same
    // numbers. Measure rather than trust a comment.
    const artBox = (await page.evaluate(
      `(() => {
        const e = document.querySelector('.art-window');
        const cs = getComputedStyle(e);
        return [
          e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
          e.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
        ];
      })()`,
    )) as [number, number];
    const want = cardData.art;
    if (artBox[0] !== want.w || artBox[1] !== want.h) {
      problems.push(
        `art window is ${artBox[0]}×${artBox[1]} but layout "${cardData.layout}" declares ` +
          `${want.w}×${want.h} — fix LAYOUTS in src/carddata.ts or card.css`,
      );
    }

    // fit-text shrinks until the text fits; still overflowing at its floor
    // means the printed card would be clipped. That must not pass silently.
    if (sizes.rulesOverflow || sizes.nameOverflow) {
      const which = [sizes.rulesOverflow && 'rules', sizes.nameOverflow && 'name']
        .filter(Boolean)
        .join(' + ');
      problems.push(`${which} still overflow at minimum font size — the printed card is clipped`);
    }

    const shot = await page.locator('#card').screenshot();
    // MPC format gate: sRGB, no alpha.
    const png = await sharp(shot).removeAlpha().toColourspace('srgb').png({ palette: false }).toBuffer();
    await writeFile(path.join(outDir, `${row.id}.png`), png);

    const meta = await sharp(png).metadata();
    if (meta.width !== CARD_W || meta.height !== CARD_H || meta.channels !== 3 || meta.space !== 'srgb') {
      problems.push(`wrong format for print: ${meta.width}×${meta.height} ${meta.space} ch=${meta.channels}`);
    }

    const ok = problems.length === 0;
    if (!ok) failed = true;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${row.id.padEnd(28)} ${cardData.theme.padEnd(9)} ` +
        `${meta.width}×${meta.height} ${meta.space} ch=${meta.channels} rules=${sizes.rulesSize}px`,
    );
    for (const problem of problems) console.error(`       ${problem}`);
  }

  // Per-card backs. These are plain images fitted to the whole card rather than
  // template renders, so they skip the browser — but they go through the same
  // format gate, and land in out/cards/ so `npm run prep` picks them up with
  // everything else.
  for (const row of rows.filter((r) => r.back_art_file)) {
    const problems: string[] = [];
    const png = await sharp(path.join(ROOT, 'art/raw', row.back_art_file))
      .resize(CARD_W, CARD_H, { fit: 'cover' })
      .removeAlpha()
      .toColourspace('srgb')
      .png({ palette: false })
      .toBuffer();
    await writeFile(path.join(outDir, `${row.id}-back.png`), png);

    const meta = await sharp(png).metadata();
    if (meta.width !== CARD_W || meta.height !== CARD_H || meta.channels !== 3 || meta.space !== 'srgb') {
      problems.push(`wrong format for print: ${meta.width}×${meta.height} ${meta.space} ch=${meta.channels}`);
    }
    const ok = problems.length === 0;
    if (!ok) failed = true;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${(row.id + '-back').padEnd(28)} ${'back'.padEnd(9)} ` +
        `${meta.width}×${meta.height} ${meta.space} ch=${meta.channels} ${row.back_art_file}`,
    );
    for (const problem of problems) console.error(`       ${problem}`);
  }

  await browser.close();

  const sheet = `<!doctype html><meta charset="utf-8"><title>proxie-maker — contact sheet</title>
<body style="background:#222;margin:24px;display:flex;flex-wrap:wrap;gap:24px">
${rows.map((r) => `<a href="cards/${r.id}.png"><img src="cards/${r.id}.png" width="272" alt="${r.id}"></a>`).join('\n')}
</body>`;
  await writeFile(path.join(ROOT, 'out/contact-sheet.html'), sheet);

  if (failed) process.exit(1);
}

main();
