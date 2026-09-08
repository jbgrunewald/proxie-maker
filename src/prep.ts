import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { ROOT } from './project.js';

/** MPC's format requirements. Returns why a buffer fails them, or null. */
export function printFormatProblem(meta: Metadata): string | null {
  const ok = meta.width === 815 && meta.height === 1110 && meta.channels === 3 && meta.space === 'srgb';
  return ok ? null : `wrong format for print: ${meta.width}×${meta.height} ${meta.space} ch=${meta.channels}`;
}

/**
 * The encode every stage ends with: sRGB, no alpha, no palette. Takes a path,
 * a buffer, or a pipeline already part-built, so callers that resize first can
 * chain into it rather than restating the encode.
 */
export function toPrintPng(input: Buffer | string | Sharp): Sharp {
  const img = typeof input === 'string' || Buffer.isBuffer(input) ? sharp(input) : input;
  return img.removeAlpha().toColourspace('srgb').png({ palette: false });
}

// MPC prints noticeably darker than screen. Order matters and is fixed by the
// production spec: sharpen → lift shadows ~10% → sRGB, no alpha.
export async function prepForPrint(png: Buffer): Promise<Buffer> {
  return sharp(png)
    .sharpen({ sigma: 0.8 })
    // out = 0.9·in + 10%: black lifts to 10%, white stays white.
    .linear(0.9, 0.1 * 255)
    .removeAlpha()
    .toColourspace('srgb')
    .png({ palette: false })
    .toBuffer();
}

// Reads out/cards/ (clean renders), writes out/print/ (what actually gets
// ordered). Re-runs independently of rendering, like every other stage.
async function main() {
  const inDir = path.join(ROOT, 'out/cards');
  const outDir = path.join(ROOT, 'out/print');
  await rm(outDir, { recursive: true, force: true }); // derived output — no stale files
  await mkdir(outDir, { recursive: true });

  const files = (await readdir(inDir)).filter((f) => f.endsWith('.png')).sort();
  if (files.length === 0) {
    console.error('No renders in out/cards — run `npm run render` first.');
    process.exit(1);
  }

  let failed = false;
  for (const file of files) {
    const prepped = await prepForPrint(await readFile(path.join(inDir, file)));
    await writeFile(path.join(outDir, file), prepped);
    const meta = await sharp(prepped).metadata();
    const problem = printFormatProblem(meta);
    const ok = problem === null;
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${file.padEnd(32)} ${meta.width}×${meta.height} ${meta.space} ch=${meta.channels}`);
  }
  console.log(`\n${files.length} print-ready files in out/print/`);
  if (failed) process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
