import { parseDecklist } from './decklist.js';
import { loadCards, saveCards, emptyRow, type CardRow } from './project.js';
import { lookupCard } from './scryfall.js';

export interface ImportResult {
  /** Every row written to the CSV, unresolved names included. */
  rows: CardRow[];
  /** Slots across all rows — what the CSV now describes. */
  slots: number;
  /** Rows whose name resolved, i.e. the ones that will actually render. */
  resolvedRows: number;
  /** Slots belonging to those rows. */
  resolvedSlots: number;
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
  const qty = (r: CardRow) => parseInt(r.qty, 10) || 1;
  const slots = rows.reduce((sum, r) => sum + qty(r), 0);

  // An unresolved row is still written — the name is kept so it can be fixed
  // rather than silently dropped — but it cannot render, so counting it as
  // imported would overstate what the user actually got.
  const unresolvedNames = new Set(unresolved.map((n) => n.toLowerCase()));
  const resolved = rows.filter((r) => !unresolvedNames.has(r.original_card.toLowerCase()));
  const resolvedSlots = resolved.reduce((sum, r) => sum + qty(r), 0);

  return { rows, slots, resolvedRows: resolved.length, resolvedSlots, unresolved, removed };
}
