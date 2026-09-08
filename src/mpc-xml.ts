import { readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadCards, ROOT } from './project.js';
import { ensureCardBack } from './placeholder.js';

// MPC's pricing brackets; quantity must fit within the chosen bracket.
const BRACKETS = [18, 36, 55, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 396, 504, 612];
const STOCK = '(S30) Standard Smooth';
const PRINT_DIR = path.join(ROOT, 'out/print');

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cardEl = (file: string, slots: string, name: string, query: string) =>
  `    <card>
      <id>${esc(file)}</id>
      <sourceType>Local File</sourceType>
      <slots>${slots}</slots>
      <name>${esc(name)}</name>
      <query>${esc(query)}</query>
    </card>`;

// Emits an order for the MPC Autofill desktop tool
// (https://github.com/chilli-axe/mpc-autofill) using local file paths, which it
// uploads and autofills into MakePlayingCards' designer. MPC has no API and can
// change their site — re-verify the tool works before ordering.
async function main() {
  // A draft order is for exercising the export — it still names the placeholder
  // renders, so it is not something to actually order from.
  const draft = process.argv.includes('--draft');
  const outPath = path.join(ROOT, 'out/order.xml');
  const rows = await loadCards();
  if (rows.length === 0) {
    console.error('No cards in data/cards.csv — import a decklist first.');
    process.exit(1);
  }

  const missingArt = rows.filter((r) => !r.art_file);
  const missingRender: string[] = [];
  // One listing instead of an access() per card, and no exceptions as control flow.
  // Only the print files themselves: a .DS_Store or a note dropped in this
  // directory must not read as an orphan and block the order.
  const printed = new Set(
    (await readdir(PRINT_DIR).catch(() => [] as string[])).filter((f) => f.endsWith('.png')),
  );

  let slot = 0;
  const fronts: string[] = [];
  const backs: string[] = [];
  for (const row of rows) {
    const qty = parseInt(row.qty, 10) || 1;
    const slots = Array.from({ length: qty }, (_, i) => slot + i).join(',');
    slot += qty;
    const query = row.display_name || row.original_card;

    const push = (into: string[], suffix: string) => {
      const name = `${row.id}${suffix}.png`;
      if (!printed.has(name)) missingRender.push(`${row.id}${suffix}`);
      into.push(cardEl(path.join(PRINT_DIR, name), slots, name, query));
    };
    push(fronts, '');
    // Only cards with their own back need an entry: every slot left out of
    // <backs> is filled with <cardback> by the autofill tool.
    if (row.back_art_file) push(backs, '-back');
  }

  // Print files that no longer belong to any row. `render` and `prep` each
  // clear their output directory, so these can only come from a card removed
  // since the last render — and order.xml would then be built from a directory
  // that does not describe this deck.
  const expected = new Set(rows.flatMap((r) => [`${r.id}.png`, ...(r.back_art_file ? [`${r.id}-back.png`] : [])]));
  const orphans = [...printed].filter((f) => !expected.has(f)).sort();

  const quantity = slot;
  const bracket = BRACKETS.find((b) => b >= quantity);
  if (!bracket) throw new Error(`${quantity} cards exceeds MPC's largest bracket (${BRACKETS.at(-1)})`);

  const cardbackFile = await ensureCardBack();
  const cardback = `\n  <cardback>${esc(cardbackFile)}</cardback>`;

  // Omitted entirely when no card has its own back, which is the shape this
  // file had before per-card backs existed and the autofill tool is happy with.
  const backsBlock = backs.length ? `\n  <backs>\n${backs.join('\n')}\n  </backs>` : '';

  const xml = `<order>
  <details>
    <quantity>${quantity}</quantity>
    <bracket>${bracket}</bracket>
    <stock>${STOCK}</stock>
    <foil>false</foil>
  </details>
  <fronts>
${fronts.join('\n')}
  </fronts>${backsBlock}${cardback}
</order>
`;

  // Validate before writing: a refusal that leaves an order.xml on disk is
  // worse than no refusal at all, since the next step is handing that file to
  // the autofill tool. That includes an order.xml left by an EARLIER run, which
  // would look current — so a refusal clears it.
  const refuse = async (...lines: string[]) => {
    for (const line of lines) console.error(line);
    await rm(outPath, { force: true });
    process.exit(1);
  };
  if (missingRender.length) {
    await refuse(
      `No print file in out/print/ for: ${missingRender.join(', ')}`,
      'Run `npm run render` then `npm run prep` first. Nothing written.',
    );
  }
  if (orphans.length) {
    await refuse(
      `out/print/ holds files no card claims: ${orphans.join(', ')}`,
      'It describes an older deck. Re-run `npm run render` then `npm run prep`. Nothing written.',
    );
  }
  if (missingArt.length && !draft) {
    await refuse(
      `${missingArt.length} card(s) still have PLACEHOLDER art and would print that way:`,
      ...missingArt.map((r) => `  ✗ ${r.id}`),
      '\nNothing written. Assign art in the app, or re-run with',
      '`npm run order -- --draft` to export anyway for testing the handoff.',
    );
  }

  await writeFile(outPath, xml);
  console.log(`Wrote ${outPath}: ${rows.length} cards, ${quantity} slots, bracket ${bracket}, ${STOCK}`);
  console.log(`Card back: ${cardbackFile}`);
  if (missingArt.length) {
    console.log(`\nDRAFT — ${missingArt.length} card(s) carry placeholder art. Do not order from this file.`);
  }
}

main();
