import { copyFile, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CSV_PATH = path.join(ROOT, 'data/cards.csv');

const RECOVERY_HINT =
  'If you edited it by hand, undo that edit — it is the only copy of your work.\n' +
  'data/cards.csv.bak holds the file as it was before the app last removed cards.';
/**
 * The previous contents of the project file, kept because this CSV *is* the
 * project: there is no database behind it, and several actions in the app
 * rewrite the whole file. One level of undo for a mis-click, a bad re-import
 * or a Start over. Not a substitute for committing the CSV.
 */
export const CSV_BACKUP_PATH = `${CSV_PATH}.bak`;
export const RAW_DIR = path.join(ROOT, 'art/raw');

/** What counts as an uploaded art file, for both the tray and cleanup. */
export const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** One row of data/cards.csv — the project's source of truth, hand-editable. */
export interface CardRow {
  id: string;
  original_card: string;
  display_name: string;
  art_file: string;
  /** Optional per-card back image; blank means the shared art/cardback.png. */
  back_art_file: string;
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
  'id', 'original_card', 'display_name', 'art_file', 'back_art_file',
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

export async function loadCards(): Promise<CardRow[]> {
  const text = await readFile(CSV_PATH, 'utf8');

  let rows: CardRow[];
  try {
    rows = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as CardRow[];
  } catch (e: any) {
    throw new Error(`data/cards.csv could not be read: ${e.message}\n${RECOVERY_HINT}`);
  }

  // An id and a name are what make a row a card — the id drives every output
  // filename. Counted in rows rather than lines, because a quoted flavor field
  // can span several lines.
  const i = rows.findIndex((r) => !r.id?.trim() || !r.original_card?.trim());
  if (i !== -1) {
    throw new Error(`data/cards.csv row ${i + 1} has no id or original_card.\n${RECOVERY_HINT}`);
  }
  return rows;
}

export async function saveCards(rows: CardRow[]): Promise<void> {
  // Back up only when this save drops cards. Copying on every save would make
  // the backup one *write* deep, and the app writes constantly — a single crop
  // drag after an accidental Start over would consume the undo. Adding cards,
  // assigning art and moving crops are all recoverable by doing them again;
  // losing rows is not.
  const removesRows = await savesFewerCards(rows);
  if (removesRows) await copyFile(CSV_PATH, CSV_BACKUP_PATH).catch(() => {});

  // Write beside the target, flush it, then rename over. A plain write that
  // dies partway truncates the only copy of the project. The tmp name is
  // unique because a second writer sharing it would have this rename install
  // *their* half-written buffer — and report success.
  const tmp = `${CSV_PATH}.${process.pid}.${tmpCounter++}.tmp`;
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(stringify(rows, { header: true, columns: COLUMNS }));
    await fh.sync(); // else the rename can outlive the data on power loss
  } finally {
    await fh.close();
  }
  await rename(tmp, CSV_PATH);
}

let tmpCounter = 0;

/** Whether writing `next` would drop cards that are on disk now. */
async function savesFewerCards(next: CardRow[]): Promise<boolean> {
  let current: CardRow[];
  try {
    current = await loadCards();
  } catch {
    return false; // no readable file to lose anything from
  }
  const keeping = new Set(next.map((r) => r.id));
  return current.some((r) => !keeping.has(r.id));
}

export function emptyRow(originalCard: string, qty: number): CardRow {
  return {
    id: slugify(originalCard),
    original_card: originalCard,
    display_name: '',
    art_file: '',
    back_art_file: '',
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
  // Through the queue, so a crop save already in flight cannot land after this
  // and resurrect the deck.
  await updateCards((rows) => {
    rows.length = 0;
    return true;
  });
}

/**
 * Serialise a read-modify-write of the CSV.
 *
 * The app edits the whole file for a one-field change, so two overlapping
 * requests — a debounced crop save landing while an art drop is in flight —
 * would both read the same pre-state and the second write would silently drop
 * the first one's change. Cheap to avoid: one queue, since this is a
 * single-process local tool.
 *
 * `fn` mutates the rows it is given. Return `null` to leave the file alone
 * (nothing matched, say); anything else is saved.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

export function updateCards<T>(fn: (rows: CardRow[]) => T | Promise<T>): Promise<T> {
  const run = writeQueue.then(async () => {
    let rows: CardRow[];
    try {
      rows = await loadCards();
    } catch (e: any) {
      // No file yet is an empty project. A file that exists but cannot be read
      // is not: writing over it would destroy the user's only copy, and take
      // the backup with it.
      if (e?.code !== 'ENOENT') throw e;
      rows = [];
    }
    const result = await fn(rows);
    if (result !== null) await saveCards(rows);
    return result;
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined, // a failed edit must not wedge the queue
  );
  return run;
}
