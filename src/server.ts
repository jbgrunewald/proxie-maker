import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { loadCards } from './project.js';
import { loadOracle, lookupCard, ensureScryfallArt } from './scryfall.js';
import { importDecklist } from './importer.js';
import { buildCardData } from './carddata.js';

const PORT = 5987;

// Rows joined with oracle data, in the shape the card template renders.
// Cards whose name no longer resolves are surfaced as errors, not skipped.
async function cardsPayload() {
  let rows;
  try {
    rows = await loadCards();
  } catch {
    return { cards: [], errors: [] };
  }
  const cards: any[] = [];
  const errors: string[] = [];
  for (const row of rows) {
    try {
      const card = lookupCard(row.original_card);
      cards.push({
        id: row.id,
        qty: parseInt(row.qty, 10) || 1,
        has_custom_art: !!row.art_file,
        data: buildCardData(row, card, `/api/art/${row.id}`),
      });
    } catch (e: any) {
      errors.push(e.message);
    }
  }
  return { cards, errors };
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

// Art for the gallery: custom art if assigned, else Scryfall's (cached on demand).
app.get('/api/art/:id', async (c) => {
  const rows = await loadCards().catch(() => []);
  const row = rows.find((r) => r.id === c.req.param('id'));
  if (!row) return c.notFound();
  if (row.art_file) return c.redirect(`/art/raw/${row.art_file}`);
  const card = lookupCard(row.original_card);
  const file = await ensureScryfallArt(card);
  if (!file) return c.notFound();
  return c.redirect(`/art/scryfall/${card.id}.jpg`);
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
