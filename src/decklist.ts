export interface DecklistEntry {
  qty: number;
  name: string;
}

const SECTION_HEADERS = /^(deck|commander|sideboard|maybeboard|companion|about)\b:?\s*$/i;

/**
 * Parse the common decklist formats:
 *   "1 Lightning Bolt"          (plain / Moxfield / Archidekt)
 *   "1x Lightning Bolt"
 *   "Lightning Bolt"            (qty 1)
 *   "1 Lightning Bolt (2X2) 117 *F*"   (MTG Arena; set/collector/foil tags stripped)
 * Blank lines, comments (# or //) and section headers are skipped.
 * Duplicate names are merged with quantities summed.
 */
export function parseDecklist(text: string): DecklistEntry[] {
  const merged = new Map<string, DecklistEntry>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    if (SECTION_HEADERS.test(line)) continue;

    const m = line.match(/^(?:(\d+)x?\s+)?(.+?)(?:\s+\([A-Z0-9]{2,6}\)\s*[\w-]*)?(?:\s+\*F\*)?$/i);
    if (!m) continue;
    const qty = m[1] ? parseInt(m[1], 10) : 1;
    const name = m[2].trim();
    if (!name) continue;

    const key = name.toLowerCase();
    const existing = merged.get(key);
    if (existing) existing.qty += qty;
    else merged.set(key, { qty, name });
  }
  return [...merged.values()];
}
