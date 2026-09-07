import { watch } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import {
  loadCards, saveCards, listRawImages, resetProject,
  IMAGE_EXT, RAW_DIR, ROOT, type CardRow,
} from './project.js';
import { loadOracle, lookupCard } from './scryfall.js';
import { importDecklist } from './importer.js';
import { buildCardData, layoutFor, LAYOUTS } from './carddata.js';
import { ensurePlaceholderArt } from './placeholder.js';

const PORT = 5987;

// Live reload is a development convenience, so it is off in the `npm run app`
// path a user builds a deck in — an unrelated ui/ save should not yank the page
// out from under someone mid-crop. `npm run dev` sets this.
const LIVE_RELOAD = process.env.PROXIE_LIVERELOAD === '1';

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
    // The crop rectangle is shaped by this card's art window, which varies by
    // layout — so it travels with the card, not with the payload.
    art_window: layoutFor(row).art,
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
    return { layouts: Object.keys(LAYOUTS), cards: [], errors: [] };
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
  // The app builds its layout picker from this, so a new layout needs no UI change.
  return { layouts: Object.keys(LAYOUTS), cards, errors };
}

const app = new Hono();

app.get('/api/cards', async (c) => c.json(await cardsPayload()));

app.post('/api/decklist', async (c) => {
  const text = await c.req.text();
  try {
    const result = await importDecklist(text);
    return c.json({
      // What will render, not what was written — see ImportResult.
      imported: result.resolvedRows,
      slots: result.resolvedSlots,
      unresolved: result.unresolved,
      removed: result.removed,
      ...(await cardsPayload()),
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// Start over: empty the project — deck and uploaded art both. Permanent, which
// is why the UI arms it behind a confirm step. The response carries no payload;
// the client refetches, and building one here would be wasted work.
app.post('/api/reset', async (c) => {
  // Irreversible and unauthenticated on a known port, so require a JSON body:
  // that makes the request non-simple, and a page on another origin cannot send
  // it without a CORS preflight this server never answers. The token is a
  // second, cheaper guard against a stray POST from a shell.
  if (!c.req.header('content-type')?.includes('application/json')) {
    return c.json({ error: 'reset requires a JSON request' }, 415);
  }
  const body = await c.req.json().catch(() => null);
  if (body?.confirm !== 'discard-art') {
    return c.json({ error: 'reset requires {"confirm":"discard-art"}' }, 400);
  }
  await resetProject();
  return c.body(null, 204);
});

// Plain CSV columns the app may edit directly. Adding an editable field is a
// line here rather than another branch in the handler.
const EDITABLE_FIELDS = ['display_name', 'layout', 'theme', 'flavor', 'category', 'notes'] as const;

// Saved crops are in source-image pixels at one art-window aspect, so anything
// that changes which pixels are shown invalidates them.
const CROP_INVALIDATING = new Set<string>(['art_file', 'layout']);

// Edit one card. Writes straight to the CSV so the next `npm run render` uses it.
app.patch('/api/cards/:id', async (c) => {
  const body = await c.req.json();
  const rows = await loadCards();
  const row = rows.find((r) => r.id === c.req.param('id'));
  if (!row) return c.notFound();

  const clearCrop = () => {
    row.crop_x = row.crop_y = row.crop_w = row.crop_h = '';
  };

  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    row[field] = body[field] == null ? '' : String(body[field]);
    if (CROP_INVALIDATING.has(field)) clearCrop();
  }

  if ('art_file' in body) {
    row.art_file = body.art_file ?? '';
    clearCrop();
  }
  if ('crop' in body) {
    if (body.crop) {
      row.crop_x = String(Math.round(body.crop.x));
      row.crop_y = String(Math.round(body.crop.y));
      row.crop_w = String(Math.round(body.crop.w));
      row.crop_h = String(Math.round(body.crop.h));
    } else {
      clearCrop();
    }
  }

  // entryFor throws on an unknown layout, which would leave the CSV holding a
  // value that cannot render — validate before saving.
  const entry = entryFor(row);
  await saveCards(rows);
  return c.json(entry);
});

// Drop one card from the deck. Its art file is deliberately left on disk: the
// row is gone, so nothing references the file, and it reappears in the tray for
// use elsewhere. Deleting art is the tray's job, not this one.
app.delete('/api/cards/:id', async (c) => {
  const rows = await loadCards();
  const i = rows.findIndex((r) => r.id === c.req.param('id'));
  if (i === -1) return c.notFound();
  const [removed] = rows.splice(i, 1);
  await saveCards(rows);
  return c.json({ removed: removed.display_name || removed.original_card });
});

// Delete one uploaded art file. Permanent, so the UI confirms first.
app.delete('/api/art-files/:file', async (c) => {
  // basename, so a crafted name cannot escape art/raw.
  const name = path.basename(c.req.param('file'));
  if (!IMAGE_EXT.test(name)) return c.json({ error: 'not an art file' }, 400);

  // The tray only offers unassigned art, but a stale page could still ask;
  // refuse rather than leave a card pointing at a file that no longer exists.
  const rows = await loadCards().catch(() => [] as CardRow[]);
  const usedBy = rows.filter((r) => r.art_file === name).map((r) => r.id);
  if (usedBy.length > 0) {
    return c.json({ error: `still assigned to ${usedBy.join(', ')}` }, 409);
  }

  await rm(path.join(RAW_DIR, name), { force: true });
  return c.body(null, 204);
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

/**
 * A raw-art URL stamped with the file's mtime. Art is served with ordinary
 * caching (it is far too big to revalidate on every load), so without this a
 * file replaced under the same name — routine after a reset — would keep
 * showing the old image until a hard reload.
 */
async function rawArtUrl(file: string): Promise<string> {
  const v = await stat(path.join(RAW_DIR, file)).then((st) => st.mtimeMs).catch(() => 0);
  return `/art/raw/${encodeURIComponent(file)}?v=${Math.round(v)}`;
}

app.get('/api/art-files', async (c) => {
  const files = await listRawImages();
  const rows = await loadCards().catch(() => [] as CardRow[]);
  const assigned = new Map<string, string[]>();
  for (const row of rows) {
    if (row.art_file) assigned.set(row.art_file, [...(assigned.get(row.art_file) ?? []), row.id]);
  }
  return c.json({
    files: await Promise.all(
      files.map(async (f) => ({ file: f, assigned_to: assigned.get(f) ?? [], url: await rawArtUrl(f) }))
    ),
  });
});

// Art for the gallery: custom art if assigned, else the placeholder. Never the
// real card's art — MPC screens for WotC IP, so that default would set users up
// to have orders rejected.
app.get('/api/art/:id', async (c) => {
  const rows = await loadCards().catch(() => [] as CardRow[]);
  const row = rows.find((r) => r.id === c.req.param('id'));
  if (!row) return c.notFound();
  if (row.art_file) return c.redirect(await rawArtUrl(row.art_file));
  await ensurePlaceholderArt();
  return c.redirect('/art/placeholder.png');
});

// ------------------------------------------------------------ live reload
//
// Dev-only (`npm run dev`). The browser holds an SSE connection and reloads
// when the front-end changes. Two paths cover the two kinds of edit:
//
//   ui/ + template/ edits  → the watcher below pushes a "reload" event.
//   src/ edits             → tsx restarts this process, dropping every
//                            connection; the client reloads once it reconnects.
//
// With the route absent outside dev, the client's EventSource gets a 404 and
// gives up after one attempt rather than retrying.
const liveClients = new Set<() => void>();

if (LIVE_RELOAD) {
  app.get('/api/livereload', (c) =>
    streamSSE(c, async (stream) => {
      const send = () => void stream.writeSSE({ data: 'reload' });
      liveClients.add(send);
      // Resolves only when the client goes away, which is what holds the stream
      // (and so the response) open for as long as the tab is.
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          liveClients.delete(send);
          resolve();
        });
      });
    })
  );
}

function watchForReload() {
  // Editors write a file as several events (and some save via rename), so
  // coalesce a burst into one reload.
  let pending: NodeJS.Timeout | undefined;
  const notify = (file: string | null) => {
    if (file && /(^\.|~$|\.swp$)/.test(path.basename(file))) return; // editor temp files
    clearTimeout(pending);
    pending = setTimeout(() => {
      for (const send of liveClients) send();
    }, 60);
  };
  for (const dir of ['ui', 'template']) {
    try {
      watch(path.join(ROOT, dir), { recursive: true }, (_event, file) => notify(file))
        .on('error', (err) => console.warn(`live reload: ${dir}/ watch failed (${err.message})`));
    } catch (e: any) {
      console.warn(`live reload: not watching ${dir}/ (${e.message})`);
    }
  }
}

// Static: UI, the shared card template, the mana font, and art files.
//
// The UI and template files are edited mid-session, and with only a
// last-modified header the browser may reuse a cached copy without asking, so
// an edit appears to do nothing until a hard reload. no-cache fixes that.
//
// It is deliberately not applied to art or the vendored font: this serveStatic
// has no conditional-request handling — it answers If-Modified-Since with a
// fresh 200 and the whole body — so no-cache there would re-stream every
// megabyte of art on each load. Art URLs already carry a ?v= cache-buster.
const noCache = (root: string) =>
  serveStatic({ root, onFound: (_path, c) => void c.header('Cache-Control', 'no-cache') });

app.use('/template/*', noCache('./'));
app.use('/node_modules/mana-font/*', serveStatic({ root: './' }));
app.use('/art/*', serveStatic({ root: './' }));
app.use('/*', noCache('./ui'));

async function main() {
  console.log('Loading Scryfall oracle data (downloads on first run)…');
  await loadOracle();
  serve({ fetch: app.fetch, port: PORT });
  if (LIVE_RELOAD) watchForReload();
  console.log(`proxie-maker running at http://localhost:${PORT}`);
}

main();
