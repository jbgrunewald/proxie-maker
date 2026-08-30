import { readFile } from 'node:fs/promises';
import { parseDecklist } from './decklist.js';
import { loadCards, saveCards, emptyRow, CSV_PATH, type CardRow } from './project.js';
import { loadOracle, lookupCard } from './scryfall.js';

// Usage: tsx src/import.ts <decklist.txt>
// Creates or updates data/cards.csv. Existing rows keep their art assignments,
// crops, display names and other hand edits; only qty is refreshed.
async function main() {
  const decklistPath = process.argv[2];
  if (!decklistPath) {
    console.error('usage: npm run import -- <decklist.txt>');
    process.exit(2);
  }

  const entries = parseDecklist(await readFile(decklistPath, 'utf8'));
  if (entries.length === 0) {
    console.error('No cards found in decklist.');
    process.exit(2);
  }

  await loadOracle();

  let existing: CardRow[] = [];
  try {
    existing = await loadCards();
  } catch {}
  const byName = new Map(existing.map((r) => [r.original_card.toLowerCase(), r]));

  const rows: CardRow[] = [];
  const unresolved: string[] = [];
  for (const entry of entries) {
    let canonicalName = entry.name;
    try {
      // Resolve to Scryfall's canonical spelling so the CSV join key is exact.
      canonicalName = lookupCard(entry.name).name;
    } catch {
      unresolved.push(entry.name);
    }
    const prior = byName.get(entry.name.toLowerCase()) ?? byName.get(canonicalName.toLowerCase());
    if (prior) {
      rows.push({ ...prior, qty: String(entry.qty) });
    } else {
      rows.push(emptyRow(canonicalName, entry.qty));
    }
  }

  const dropped = existing.filter(
    (r) => !rows.some((n) => n.original_card.toLowerCase() === r.original_card.toLowerCase()),
  );

  await saveCards(rows);

  const slots = rows.reduce((sum, r) => sum + (parseInt(r.qty, 10) || 1), 0);
  console.log(`Wrote ${rows.length} rows (${slots} slots) to ${CSV_PATH}`);
  for (const r of dropped) console.log(`  note: "${r.original_card}" was in the CSV but not this decklist — row removed`);
  if (unresolved.length > 0) {
    console.error('\nNOT FOUND in Scryfall oracle data (fix these before rendering):');
    for (const name of unresolved) console.error(`  ✗ ${name}`);
    process.exit(1);
  }
}

main();
