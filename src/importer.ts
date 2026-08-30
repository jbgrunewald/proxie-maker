import { parseDecklist } from './decklist.js';
import { loadCards, saveCards, emptyRow, type CardRow } from './project.js';
import { lookupCard } from './scryfall.js';

export interface ImportResult {
  rows: CardRow[];
  slots: number;
  unresolved: string[];
  removed: string[];
}

/**
 * Decklist text → data/cards.csv. Existing rows keep their art assignments,
 * crops, display names and other hand edits; only qty is refreshed.
 * Requires loadOracle() to have been called.
 */
export async function importDecklist(text: string): Promise<ImportResult> {
  const entries = parseDecklist(text);
  if (entries.length === 0) throw new Error('No cards found in decklist.');

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

  const removed = existing
    .filter((r) => !rows.some((n) => n.original_card.toLowerCase() === r.original_card.toLowerCase()))
    .map((r) => r.original_card);

  await saveCards(rows);
  const slots = rows.reduce((sum, r) => sum + (parseInt(r.qty, 10) || 1), 0);
  return { rows, slots, unresolved, removed };
}
