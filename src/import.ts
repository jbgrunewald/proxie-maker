import { readFile } from 'node:fs/promises';
import { importDecklist } from './importer.js';
import { CSV_PATH } from './project.js';
import { loadOracle } from './scryfall.js';

// Usage: tsx src/import.ts <decklist.txt>
async function main() {
  const decklistPath = process.argv[2];
  if (!decklistPath) {
    console.error('usage: npm run import -- <decklist.txt>');
    process.exit(2);
  }

  await loadOracle();
  const result = await importDecklist(await readFile(decklistPath, 'utf8'));

  console.log(`Wrote ${result.rows.length} rows (${result.slots} slots) to ${CSV_PATH}`);
  for (const name of result.removed) {
    console.log(`  note: "${name}" was in the CSV but not this decklist — row removed`);
  }
  if (result.unresolved.length > 0) {
    console.error('\nNOT FOUND in Scryfall oracle data (fix these before rendering):');
    for (const name of result.unresolved) console.error(`  ✗ ${name}`);
    process.exit(1);
  }
}

main();
