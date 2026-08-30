import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { loadCards, saveCards, ROOT, type CardRow } from './project.js';
import { loadOracle, lookupCard } from './scryfall.js';
import { importDecklist } from './importer.js';
import { buildCardData, ART_W, ART_H } from './carddata.js';
import { ensurePlaceholderArt } from './placeholder.js';

const PORT = 5987;
const RAW_DIR = path.join(ROOT, 'art/raw');
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

function entryFor(row: CardRow) {
  const card = lookupCard(row.original_card);
  const crop =
    row.crop_w && row.crop_h
      ? {
          x: parseInt(row.crop_x || '0', 10),
          y: parseInt(row.crop_y || '0', 10),
          w: parseInt(row.crop_w, 10),
          h: parseInt(row.crop_h, 10),
        }
      : null;
  return {
    id: row.id,
    qty: parseInt(row.qty, 10) || 1,
    art_file: row.art_file || null,
    crop,
    // Cache-bust so an art change is never masked by the browser cache.
    data: buildCardData(row, card, `/api/art/${row.id}?v=${encodeURIComponent(row.art_file || 'placeholder')}`),
  };
}

// Rows joined with oracle data, in the shape the card template renders.
// Cards whose name no longer resolves are surfaced as errors, not skipped.
async function cardsPayload() {
  let rows: CardRow[];
  try {
    rows = await loadCards();
  } catch {
    return { art_window: { w: ART_W, h: ART_H }, cards: [], errors: [] };
  }
  const cards: any[] = [];
  const errors: string[] = [];
  for (const row of rows) {
    try {
      cards.push(entryFor(row));
    } catch (e: any) {
      errors.push(e.message);
    }
  }
  return { art_window: { w: ART_W, h: ART_H }, cards, errors };
}

const app = new Hono();

app.get('/api/cards', async (c) => c.json(await cardsPayload()));

app.post('/api/decklist', async (c) => {
  const text = await c.req.text();
  try {
    const result = await importDecklist(text);
    return c.json({
      imported: result.rows.length,
      slots: result.slots,
      unresolved: result.unresolved,
      removed: result.removed,
      ...(await cardsPayload()),
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// Assign/clear art or update the crop for one card. Writes straight to the CSV
// so the next `npm run render` uses it.
app.patch('/api/cards/:id', async (c) => {
  const body = await c.req.json();
  const rows = await loadCards();
  const row = rows.find((r) => r.id === c.req.param('id'));
  if (!row) return c.notFound();

  if ('art_file' in body) {
    row.art_file = body.art_file ?? '';
    row.crop_x = row.crop_y = row.crop_w = row.crop_h = '';
  }
  if ('crop' in body) {
    if (body.crop) {
      row.crop_x = String(Math.round(body.crop.x));
      row.crop_y = String(Math.round(body.crop.y));
      row.crop_w = String(Math.round(body.crop.w));
      row.crop_h = String(Math.round(body.crop.h));
    } else {
      row.crop_x = row.crop_y = row.crop_w = row.crop_h = '';
    }
  }
  await saveCards(rows);
  return c.json(entryFor(row));
});

app.post('/api/art-upload', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const files = ([] as any[]).concat((body as any)['files'] ?? []);
  await mkdir(RAW_DIR, { recursive: true });
  const saved: string[] = [];
  for (const f of files) {
    if (!(f instanceof File) || !IMAGE_EXT.test(f.name)) continue;
    const name = f.name.replace(/[^\w.\- ]+/g, '_');
    await writeFile(path.join(RAW_DIR, name), Buffer.from(await f.arrayBuffer()));
    saved.push(name);
  }
  return c.json({ saved });
});

app.get('/api/art-files', async (c) => {
  let files: string[] = [];
  try {
    files = (await readdir(RAW_DIR)).filter((f) => IMAGE_EXT.test(f)).sort();
  } catch {}
  const rows = await loadCards().catch(() => [] as CardRow[]);
  const assigned = new Map<string, string[]>();
  for (const row of rows) {
    if (row.art_file) assigned.set(row.art_file, [...(assigned.get(row.art_file) ?? []), row.id]);
  }
  return c.json({ files: files.map((f) => ({ file: f, assigned_to: assigned.get(f) ?? [] })) });
});

// Art for the gallery: custom art if assigned, else the placeholder. Never the
// real card's art — MPC screens for WotC IP, so that default would set users up
// to have orders rejected.
app.get('/api/art/:id', async (c) => {
  const rows = await loadCards().catch(() => [] as CardRow[]);
  const row = rows.find((r) => r.id === c.req.param('id'));
  if (!row) return c.notFound();
  if (row.art_file) return c.redirect(`/art/raw/${encodeURIComponent(row.art_file)}`);
  await ensurePlaceholderArt();
  return c.redirect('/art/placeholder.png');
});

// Static: UI, the shared card template, the mana font, and art files.
app.use('/template/*', serveStatic({ root: './' }));
app.use('/node_modules/mana-font/*', serveStatic({ root: './' }));
app.use('/art/*', serveStatic({ root: './' }));
app.use('/*', serveStatic({ root: './ui' }));

async function main() {
  console.log('Loading Scryfall oracle data (downloads on first run)…');
  await loadOracle();
  serve({ fetch: app.fetch, port: PORT });
  console.log(`proxie-maker running at http://localhost:${PORT}`);
}

main();
