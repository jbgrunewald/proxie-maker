import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from './project.js';

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
