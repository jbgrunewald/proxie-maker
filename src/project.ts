import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CSV_PATH = path.join(ROOT, 'data/cards.csv');

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
  theme: string;
  category: string;
  qty: string;
  flavor: string;
  notes: string;
}

const COLUMNS: (keyof CardRow)[] = [
  'id', 'original_card', 'display_name', 'art_file',
  'crop_x', 'crop_y', 'crop_w', 'crop_h',
  'theme', 'category', 'qty', 'flavor', 'notes',
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
    theme: '',
    category: '',
    qty: String(qty),
    flavor: '',
    notes: '',
  };
}
