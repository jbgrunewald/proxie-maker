import { writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { loadCards, ROOT, type CardRow } from './project.js';
import { loadOracle, lookupCard, frontFace, ensureScryfallArt, type OracleCard } from './scryfall.js';

// Print spec — verified numbers from the production spec, do not recompute.
const CARD_W = 815;
const CARD_H = 1110;
// Art window inner size; must match .art-window in template/card.css
// (691 content width minus 2×2px border, 495 minus border).
const ART_W = 687;
const ART_H = 491;

/** Frame theme from the card itself; a `theme` value in the CSV overrides this. */
export function deriveTheme(card: OracleCard): string {
  const face = frontFace(card);
  if (/\bLand\b/.test(face.type_line ?? card.type_line)) return 'land';
  const colors = face.colors ?? card.color_identity ?? [];
  if (colors.length === 0) return 'colorless';
  if (colors.length === 1) return colors[0].toLowerCase();
  const pair = [...colors].sort().join('');
  if (pair === 'BU') return 'ub';
  return 'multi';
}

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
    const face = frontFace(card);
    const artData = `data:image/png;base64,${(await resolveArt(row, card)).toString('base64')}`;

    const cardData = {
      theme: row.theme || deriveTheme(card),
      display_name: row.display_name,
      original_card: face.name, // front-face name; the full "A // B" stays in the CSV
      flavor: row.flavor || null,
      oracle: {
        name: face.name,
        mana_cost: face.mana_cost,
        type_line: face.type_line ?? card.type_line,
        oracle_text: face.oracle_text,
        flavor_text: face.flavor_text,
        power: face.power ?? null,
        toughness: face.toughness ?? null,
      },
    };

    await page.evaluate((c) => (window as any).renderCard(c), cardData);
    await page.evaluate((src) => {
      (document.getElementById('art') as HTMLImageElement).src = src;
    }, artData);
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
