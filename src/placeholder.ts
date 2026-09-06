import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from './project.js';
import { prepForPrint } from './prep.js';

// Cards render with this until the user assigns their own art. Deliberately NOT
// the real card's art: MPC screens for WotC IP, so defaulting to Scryfall images
// would set users up to have orders rejected.
export async function ensurePlaceholderArt(): Promise<string> {
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
    <rect x="24" y="24" width="1326" height="934" fill="none" stroke="#43525c" stroke-width="3" stroke-dasharray="18 14"/>
    <text x="687" y="480" text-anchor="middle" font-family="Helvetica" font-size="60"
      fill="#6b7884" opacity="0.8">no art assigned</text>
    <text x="687" y="560" text-anchor="middle" font-family="Helvetica" font-size="34"
      fill="#56626c" opacity="0.8">drag an image here in the app</text>
  </svg>`;
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
}

// Card back. MPC needs a back for every order, and a design of your own is the
// point eventually — this is a neutral stand-in so the order pipeline can be
// exercised end to end before you have one. Original geometry only: MPC screens
// for Wizards' card back and will reject an order carrying it.
//
// Full bleed at the same 815×1110 as the fronts, and put through the same
// print prep, so the back is not brighter than the cards it ships with.
export async function ensureCardBack(): Promise<string> {
  const file = path.join(ROOT, 'art/cardback.png');
  try {
    await access(file);
    return file;
  } catch {}
  const svg = `<svg width="815" height="1110" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bg" cx="50%" cy="45%" r="72%">
        <stop offset="0%" stop-color="#2a3340"/>
        <stop offset="60%" stop-color="#161b23"/>
        <stop offset="100%" stop-color="#0b0e13"/>
      </radialGradient>
      <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6d7f92"/><stop offset="100%" stop-color="#3a4654"/>
      </linearGradient>
    </defs>
    <rect width="815" height="1110" fill="url(#bg)"/>
    <rect x="46" y="46" width="723" height="1018" rx="26" fill="none"
      stroke="url(#edge)" stroke-width="3" opacity="0.85"/>
    <rect x="62" y="62" width="691" height="986" rx="18" fill="none"
      stroke="#4a586a" stroke-width="1.5" opacity="0.55"/>
    <g transform="translate(407.5 555)" fill="none" stroke="#7d8fa4" stroke-linejoin="round">
      <path d="M0 -196 L142 0 L0 196 L-142 0 Z" stroke-width="3.5" opacity="0.9"/>
      <path d="M0 -138 L100 0 L0 138 L-100 0 Z" stroke-width="2" opacity="0.6"/>
      <path d="M0 -74 L54 0 L0 74 L-54 0 Z" stroke-width="1.5" opacity="0.4"/>
      <circle r="15" fill="#7d8fa4" stroke="none" opacity="0.75"/>
    </g>
    <text x="407.5" y="880" text-anchor="middle" font-family="Helvetica" font-size="30"
      letter-spacing="14" fill="#5d6c7d" opacity="0.8">PROXY</text>
    <text x="407.5" y="924" text-anchor="middle" font-family="Helvetica" font-size="19"
      letter-spacing="4" fill="#46525f" opacity="0.75">NOT FOR SALE</text>
  </svg>`;
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(svg)).png().toBuffer().then(async (png) => {
    await writeFile(file, await prepForPrint(png));
  });
  return file;
}
