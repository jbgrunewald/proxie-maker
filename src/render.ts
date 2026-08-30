import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Print spec — verified numbers from the production spec, do not recompute.
const CARD_W = 815;
const CARD_H = 1110;
// Art window inner size; must match .art-window in template/card.css
// (691 content width minus 2×2px border, 495 minus border).
const ART_W = 687;
const ART_H = 491;

interface FixtureCard {
  id: string;
  original_card: string;
  neogen_name: string;
  theme: string;
  flavor: string | null;
  oracle: {
    name: string;
    mana_cost?: string;
    type_line: string;
    oracle_text?: string;
    flavor_text?: string;
    power?: string;
    toughness?: string;
  };
}

async function ensurePlaceholderArt(): Promise<string> {
  // Stand-in for Leonardo exports; deliberately an odd size (1664×2496) to
  // prove the pipeline takes arbitrary source dimensions.
  const file = path.join(ROOT, 'art/raw/placeholder.png');
  try {
    await access(file);
    return file;
  } catch {}
  const svg = `<svg width="1664" height="2496" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="g" cx="50%" cy="38%" r="75%">
        <stop offset="0%" stop-color="#3f6b7a"/>
        <stop offset="45%" stop-color="#22333f"/>
        <stop offset="100%" stop-color="#0b0d14"/>
      </radialGradient>
    </defs>
    <rect width="1664" height="2496" fill="url(#g)"/>
    <circle cx="832" cy="900" r="340" fill="none" stroke="#7fb0ba" stroke-width="6" opacity="0.5"/>
    <circle cx="832" cy="900" r="470" fill="none" stroke="#7fb0ba" stroke-width="3" opacity="0.25"/>
    <text x="832" y="2300" text-anchor="middle" font-family="Helvetica" font-size="90"
      fill="#5e7f88" opacity="0.6">placeholder art</text>
  </svg>`;
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
}

async function cropArt(artPath: string): Promise<string> {
  // Center cover-crop stands in for the future crop UI; extract-then-resize
  // ordering is preserved by sharp's cover fit.
  const buf = await sharp(artPath).resize(ART_W, ART_H, { fit: 'cover' }).png().toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function main() {
  const fixtures: FixtureCard[] = JSON.parse(
    await readFile(path.join(ROOT, 'data/fixtures.json'), 'utf8'),
  );
  const artData = await cropArt(await ensurePlaceholderArt());
  const outDir = path.join(ROOT, 'out/cards');
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  await page.goto('file://' + path.join(ROOT, 'template/card.html'));

  let failed = false;
  for (const card of fixtures) {
    await page.evaluate((c) => (window as any).renderCard(c), card);
    await page.evaluate((src) => {
      (document.getElementById('art') as HTMLImageElement).src = src;
    }, artData);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const sizes = await page.evaluate(() => (window as any).fitText());

    const shot = await page.locator('#card').screenshot();
    // MPC format gate: sRGB, no alpha.
    const png = await sharp(shot).removeAlpha().toColourspace('srgb').png({ palette: false }).toBuffer();
    const outPath = path.join(outDir, `${card.id}.png`);
    await writeFile(outPath, png);

    const meta = await sharp(png).metadata();
    const ok =
      meta.width === CARD_W && meta.height === CARD_H && meta.channels === 3 && meta.space === 'srgb';
    if (!ok) failed = true;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${card.id.padEnd(24)} ${meta.width}×${meta.height} ` +
        `${meta.space} ch=${meta.channels} rules=${sizes.rulesSize}px name=${sizes.nameSize}px`,
    );
  }

  await browser.close();

  // Contact sheet for quick visual review of the whole run.
  const sheet = `<!doctype html><meta charset="utf-8"><title>Neogen render — contact sheet</title>
<body style="background:#222;margin:24px;display:flex;flex-wrap:wrap;gap:24px">
${fixtures.map((c) => `<img src="cards/${c.id}.png" width="407" alt="${c.id}">`).join('\n')}
</body>`;
  await writeFile(path.join(ROOT, 'out/contact-sheet.html'), sheet);

  if (failed) process.exit(1);
}

main();
