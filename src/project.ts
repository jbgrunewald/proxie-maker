import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CSV_PATH = path.join(ROOT, 'data/cards.csv');
export const RAW_DIR = path.join(ROOT, 'art/raw');

/** What counts as an uploaded art file, for both the tray and cleanup. */
export const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** One row of data/cards.csv — the project's source of truth, hand-editable. */
export interface CardRow {
  id: string;
  original_card: string;
  display_name: string;
  art_file: string;
  crop_x: string;
  crop_y: string;
  crop_w: string;
  crop_h: string;
  layout: string;
  theme: string;
  category: string;
  qty: string;
  flavor: string;
  notes: string;
}

const COLUMNS: (keyof CardRow)[] = [
  'id', 'original_card', 'display_name', 'art_file',
  'crop_x', 'crop_y', 'crop_w', 'crop_h',
  'layout', 'theme', 'category', 'qty', 'flavor', 'notes',
];

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function loadCards(csvPath = CSV_PATH): Promise<CardRow[]> {
  const text = await readFile(csvPath, 'utf8');
  return parse(text, { columns: true, skip_empty_lines: true, trim: true }) as CardRow[];
}

export async function saveCards(rows: CardRow[], csvPath = CSV_PATH): Promise<void> {
  await writeFile(csvPath, stringify(rows, { header: true, columns: COLUMNS }));
}

export function emptyRow(originalCard: string, qty: number): CardRow {
  return {
    id: slugify(originalCard),
    original_card: originalCard,
    display_name: '',
    art_file: '',
    crop_x: '', crop_y: '', crop_w: '', crop_h: '',
    layout: '',
    theme: '',
    category: '',
    qty: String(qty),
    flavor: '',
    notes: '',
  };
}

/** Art files in art/raw, sorted. Empty before anything has been uploaded. */
export async function listRawImages(): Promise<string[]> {
  try {
    return (await readdir(RAW_DIR)).filter((f) => IMAGE_EXT.test(f)).sort();
  } catch {
    return [];
  }
}

/**
 * Empty the project: no deck, no uploaded art. Permanent — the art files are
 * the user's own and are not recoverable — so callers are expected to confirm.
 *
 * The CSV is rewritten with just its header rather than deleted, so the
 * "cards.csv always exists" assumption every stage makes keeps holding and a
 * reset shows up as a diff rather than a deletion in a repo that tracks it.
 * Anything in art/raw that isn't an image is left alone.
 */
export async function resetProject(): Promise<void> {
  // Art first: if a delete fails the deck is still intact, so the caller can
  // report a partial reset instead of leaving a deckless project behind.
  const images = await listRawImages();
  await Promise.all(images.map((f) => rm(path.join(RAW_DIR, f), { force: true, recursive: true })));
  await saveCards([]);
}
