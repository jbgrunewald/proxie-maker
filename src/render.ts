import { writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { loadCards, ROOT, type CardRow } from './project.js';
import { loadOracle, lookupCard, ensureScryfallArt, type OracleCard } from './scryfall.js';
import { buildCardData, ART_W, ART_H } from './carddata.js';

// Print spec — verified numbers from the production spec, do not recompute.
const CARD_W = 815;
const CARD_H = 1110;

async function ensurePlaceholderArt(): Promise<string> {
  const file = path.join(ROOT, 'art/placeholder.png');
  try {
    await access(file);
    return file;
  } catch {}
  const svg = `<svg width="1374" height="982" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="g" cx="50%" cy="42%" r="75%">
      <stop offset="0%" stop-color="#3f4b56"/><stop offset="100%" stop-color="#101216"/>
    </radialGradient></defs>
    <rect width="1374" height="982" fill="url(#g)"/>
    <text x="687" y="510" text-anchor="middle" font-family="Helvetica" font-size="64"
      fill="#6b7884" opacity="0.7">no art assigned</text>
  </svg>`;
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
}

/** Custom art with saved crop → custom art auto-crop → Scryfall art → placeholder. */
async function resolveArt(row: CardRow, card: OracleCard): Promise<Buffer> {
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
      return src.resize(ART_W, ART_H).png().toBuffer();
    }
    return src.resize(ART_W, ART_H, { fit: 'cover' }).png().toBuffer();
  }
  const scryfallArt = await ensureScryfallArt(card);
  const file = scryfallArt ?? (await ensurePlaceholderArt());
  return sharp(file).resize(ART_W, ART_H, { fit: 'cover' }).png().toBuffer();
}

async function main() {
  await loadOracle();
  const rows = await loadCards();
  const outDir = path.join(ROOT, 'out/cards');
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  await page.goto('file://' + path.join(ROOT, 'template/card.html'));

  let failed = false;
  for (const row of rows) {
    const card = lookupCard(row.original_card); // throws loudly on a bad name
    const artData = `data:image/png;base64,${(await resolveArt(row, card)).toString('base64')}`;
    const cardData = buildCardData(row, card, artData);

    await page.evaluate((c) => (window as any).renderCard(c), cardData);
    await page.waitForFunction(() => {
      const img = document.querySelector('#card .art') as HTMLImageElement | null;
      return !!img && (img.src === '' || img.complete);
    });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const sizes = await page.evaluate(() => (window as any).fitText());

    const shot = await page.locator('#card').screenshot();
    // MPC format gate: sRGB, no alpha.
    const png = await sharp(shot).removeAlpha().toColourspace('srgb').png({ palette: false }).toBuffer();
    await writeFile(path.join(outDir, `${row.id}.png`), png);

    const meta = await sharp(png).metadata();
    const ok =
      meta.width === CARD_W && meta.height === CARD_H && meta.channels === 3 && meta.space === 'srgb';
    if (!ok) failed = true;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${row.id.padEnd(28)} ${cardData.theme.padEnd(9)} ` +
        `${meta.width}×${meta.height} ${meta.space} ch=${meta.channels} rules=${sizes.rulesSize}px`,
    );
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
