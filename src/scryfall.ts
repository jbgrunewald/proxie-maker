import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { ROOT } from './project.js';

const USER_AGENT = 'proxie-maker/0.1 (open-source proxy tool; personal use)';
const CACHE_FILE = path.join(ROOT, 'data/oracle-cards.jsonl');
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface OracleFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors?: string[];
}

export interface OracleCard extends OracleFace {
  id: string;
  type_line: string;
  layout?: string;
  card_faces?: OracleFace[];
  color_identity?: string[];
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

export async function fetchOracle(opts: { force?: boolean } = {}): Promise<void> {
  if (!opts.force) {
    try {
      const s = await stat(CACHE_FILE);
      if (Date.now() - s.mtimeMs < CACHE_MAX_AGE_MS) return;
    } catch {}
  }
  console.log('Downloading Scryfall Oracle Cards bulk data…');
  const bulk = await fetchJson('https://api.scryfall.com/bulk-data');
  const oracle = bulk.data.find((d: any) => d.type === 'oracle_cards');
  if (!oracle?.jsonl_download_uri) throw new Error('Scryfall bulk-data listing had no oracle_cards jsonl_download_uri');
  const res = await fetch(oracle.jsonl_download_uri, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`bulk download → HTTP ${res.status}`);
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as any), createGunzip(), createWriteStream(CACHE_FILE));
  console.log(`Cached oracle data (${(oracle.compressed_size / 1e6).toFixed(0)} MB compressed) to data/oracle-cards.jsonl`);
}

let index: Map<string, OracleCard> | null = null;

export async function loadOracle(): Promise<void> {
  await fetchOracle();
  const lines = (await readFile(CACHE_FILE, 'utf8')).split('\n');
  index = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    const card: OracleCard = JSON.parse(line);
    // Art-series and token entries share names with real cards; never let them
    // shadow the playable card in the index.
    if (card.layout === 'art_series' || card.layout === 'token' || card.layout === 'double_faced_token') continue;
    index.set(card.name.toLowerCase(), card);
    // Double-faced cards: let either face's name resolve to the whole card.
    for (const face of card.card_faces ?? []) {
      if (!index.has(face.name.toLowerCase())) index.set(face.name.toLowerCase(), card);
    }
  }
}

export function lookupCard(exactName: string): OracleCard {
  if (!index) throw new Error('loadOracle() must be called first');
  const card = index.get(exactName.trim().toLowerCase());
  if (!card) {
    throw new Error(
      `Card not found in Scryfall oracle data: "${exactName}". ` +
        'Check the spelling — a typo must not render.',
    );
  }
  return card;
}

/** Front face of a card, with top-level fields as fallback for single-faced cards. */
export function frontFace(card: OracleCard): OracleFace {
  const face = card.card_faces?.[0];
  return face ? { ...card, ...face } : card;
}
