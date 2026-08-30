import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadCards, ROOT } from './project.js';

// MPC's pricing brackets; quantity must fit within the chosen bracket.
const BRACKETS = [18, 36, 55, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 396, 504, 612];
const STOCK = '(S30) Standard Smooth';
const CARDBACK = path.join(ROOT, 'art/cardback.png');

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Emits an order for the MPC Autofill desktop tool
// (https://github.com/chilli-axe/mpc-autofill) using local file paths, which it
// uploads and autofills into MakePlayingCards' designer. MPC has no API and can
// change their site — re-verify the tool works before ordering.
async function main() {
  const rows = await loadCards();

  const missingArt = rows.filter((r) => !r.art_file);
  const missingRender: string[] = [];

  let slot = 0;
  const fronts: string[] = [];
  for (const row of rows) {
    const qty = parseInt(row.qty, 10) || 1;
    const slots = Array.from({ length: qty }, (_, i) => slot + i).join(',');
    slot += qty;
    const file = path.join(ROOT, 'out/print', `${row.id}.png`);
    try {
      await access(file);
    } catch {
      missingRender.push(row.id);
    }
    fronts.push(
      `    <card>
      <id>${esc(file)}</id>
      <sourceType>Local File</sourceType>
      <slots>${slots}</slots>
      <name>${esc(row.id)}.png</name>
      <query>${esc(row.display_name || row.original_card)}</query>
    </card>`,
    );
  }

  const quantity = slot;
  const bracket = BRACKETS.find((b) => b >= quantity);
  if (!bracket) throw new Error(`${quantity} cards exceeds MPC's largest bracket (${BRACKETS.at(-1)})`);

  let cardback = '';
  try {
    await access(CARDBACK);
    cardback = `\n  <cardback>${esc(CARDBACK)}</cardback>`;
  } catch {}

  const xml = `<order>
  <details>
    <quantity>${quantity}</quantity>
    <bracket>${bracket}</bracket>
    <stock>${STOCK}</stock>
    <foil>false</foil>
  </details>
  <fronts>
${fronts.join('\n')}
  </fronts>${cardback}
</order>
`;

  const outPath = path.join(ROOT, 'out/order.xml');
  await writeFile(outPath, xml);
  console.log(`Wrote ${outPath}: ${rows.length} cards, ${quantity} slots, bracket ${bracket}, ${STOCK}`);

  if (missingRender.length) {
    console.error(`\nWARNING — no print file in out/print/ for: ${missingRender.join(', ')}`);
    console.error('Run `npm run render` then `npm run prep` first.');
  }
  if (missingArt.length) {
    console.error(`\nWARNING — ${missingArt.length} card(s) still have PLACEHOLDER art and would print that way:`);
    for (const r of missingArt) console.error(`  ✗ ${r.id}`);
  }
  if (!cardback) {
    console.error('\nNOTE — no art/cardback.png found; the order has no <cardback> element.');
    console.error("Add one before ordering (MPC needs a back; the desktop tool will ask otherwise).");
  }
  if (missingRender.length || missingArt.length) process.exit(1);
}

main();
