const importPanel = document.getElementById('import-panel');
const toggleBtn = document.getElementById('toggle-import');
const resetBtn = document.getElementById('reset-btn');
const statusEl = document.getElementById('import-status');
const workbench = document.getElementById('workbench');
const gallery = document.getElementById('gallery');
const artList = document.getElementById('art-list');
const dropZone = document.getElementById('drop-zone');
const decklistText = document.getElementById('decklist-text');
const decklistFile = document.getElementById('decklist-file');
const trayEmpty = document.getElementById('tray-empty');

const CARD_SCALE = 0.35;
// The art window's shape comes from the card's layout, so it is per card —
// buildCardData puts the layout's box on entry.data.art.
const cropAspect = (entry) => entry.data.art.w / entry.data.art.h;
let layouts = ['classic']; // replaced by the server's list on first load
// Slots currently showing their back. Client-only: which side you are looking
// at is not part of the project.
const flipped = new Set();

// ---------------------------------------------------------------- data

async function refresh() {
  const res = await fetch('/api/cards');
  const payload = await res.json();
  renderGallery(payload);
  await refreshTray();
  showDeckChrome(payload.cards.length > 0);
}

// The header controls and the two panels are all a function of "is there a
// deck?", so they move together. `keepImportPanel` is for the one case that
// differs: after an import with unresolved names, the panel stays up to show
// them.
function showDeckChrome(hasCards, keepImportPanel = false) {
  disarmAll(); // never let a button come back from hidden still armed
  importPanel.hidden = hasCards && !keepImportPanel;
  workbench.hidden = !hasCards;
  toggleBtn.hidden = !hasCards;
  resetBtn.hidden = !hasCards;
}

// The tray is the pool of art that is not on a card yet. Once a thumbnail is
// dropped on a card it lives there instead; the × on the card sends it back.
async function refreshTray() {
  const res = await fetch('/api/art-files');
  const { files } = await res.json();
  const unassigned = files.filter((f) => f.assigned_to.length === 0);

  artList.innerHTML = '';
  for (const f of unassigned) {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.dataset.file = f.file;
    thumb.dataset.url = f.url;
    thumb.innerHTML = `<img src="${f.url}" draggable="false">
      <span class="thumb-name">${f.file}</span>`;
    thumb.addEventListener('mousedown', (e) => startTrayDrag(e, f.file));
    thumb.appendChild(deleteArtButton(f.file));
    artList.appendChild(thumb);
  }

  // An empty tray means two very different things — nothing uploaded yet, or
  // everything already placed. The drop zone covers the first; say the second.
  const placed = files.length - unassigned.length;
  trayEmpty.hidden = unassigned.length > 0 || files.length === 0;
  if (!trayEmpty.hidden) {
    trayEmpty.textContent =
      (placed === 1 ? 'Your one image is on a card.' : `All ${placed} images are on cards.`) +
      ' Remove one with the × on a card to bring it back here.';
  }
}

async function patchCard(id, body) {
  const res = await fetch(`/api/cards/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const entry = await res.json();
  updateSlot(entry);
  // Only an art assignment can change what the tray holds — a crop cannot, and
  // crops are saved repeatedly while dragging and zooming.
  if ('art_file' in body || 'back_art_file' in body) refreshTray();
  return entry;
}

// ---------------------------------------------------------------- gallery

function renderGallery(payload) {
  layouts = payload.layouts ?? layouts;
  // Forget flips for cards that no longer exist, so a re-imported name does
  // not come back already flipped.
  const live = new Set(payload.cards.map((c) => c.id));
  for (const id of [...flipped]) if (!live.has(id)) flipped.delete(id);
  gallery.innerHTML = '';
  for (const msg of payload.errors ?? []) {
    const div = document.createElement('div');
    div.className = 'err';
    div.textContent = msg;
    gallery.appendChild(div);
  }
  for (const entry of payload.cards) gallery.appendChild(buildSlot(entry));
  fitAllCards();
}

function fitAllCards() {
  for (const el of gallery.querySelectorAll('.card')) window.fitText(el);
}

// Fonts load lazily on first render, after which text metrics change — refit
// once everything settles, and again on any late font arrival.
document.fonts.ready.then(fitAllCards);
document.fonts.addEventListener('loadingdone', fitAllCards);

function buildSlot(entry) {
  const slot = document.createElement('div');
  slot.className = 'card-slot';
  slot.dataset.id = entry.id;
  fillSlot(slot, entry);
  return slot;
}

function updateSlot(entry) {
  const slot = gallery.querySelector(`.card-slot[data-id="${entry.id}"]`);
  if (!slot) return;
  fillSlot(slot, entry);
  for (const card of slot.querySelectorAll('.card')) window.fitText(card);
}

function fillSlot(slot, entry) {
  // Only this slot's buttons: they are about to be detached and would be
  // stranded in `armed`. Disarming page-wide would cancel a confirmation the
  // user has pending somewhere else.
  for (const btn of [...armed]) if (slot.contains(btn)) disarm(btn);
  slot.innerHTML = '';
  if (entry.qty > 1) {
    const badge = document.createElement('div');
    badge.className = 'qty-badge';
    badge.textContent = `×${entry.qty}`;
    slot.appendChild(badge);
  }
  const scale = document.createElement('div');
  scale.className = 'card-scale';
  const showingBack = flipped.has(entry.id);

  let win = null;
  if (showingBack) {
    scale.appendChild(backFace(entry));
  } else {
    const cardEl = document.createElement('div');
    window.CardDom.renderInto(cardEl, entry.data);
    scale.appendChild(cardEl);
    win = cardEl.querySelector('.art-window');
    win.classList.add('drop-target');
  }
  slot.appendChild(scale);
  if (layouts.length > 1) slot.appendChild(layoutRow(entry));

  const field = showingBack ? 'back_art_file' : 'art_file';
  if (entry[field]) slot.appendChild(clearButton(entry, field));
  if (win && entry.art_file) enableReposition(win, entry);
}

// The back of a card: its own image if it has one, otherwise a note that it
// uses the shared art/cardback.png. A drop target either way, so dragging art
// here assigns a back rather than a front.
function backFace(entry) {
  const face = document.createElement('div');
  face.className = 'card-back drop-target';
  face.dataset.face = 'back';
  if (entry.back_art_file) {
    const img = document.createElement('img');
    img.src = entry.back_art_url;
    img.draggable = false;
    face.appendChild(img);
  } else {
    face.classList.add('is-default');
    face.innerHTML = '<span>shared card back<br><small>drop art here to give this card its own</small></span>';
  }
  return face;
}



// Sits under the card rather than over it: layout is a setting you go looking
// for, unlike the × on the art, which is destructive and stays out of the way.
// Options come from the server's layout list, so adding a layout in
// src/carddata.ts is enough — nothing here enumerates them.
function layoutRow(entry) {
  const row = document.createElement('label'); // wraps the select, so the word is a click target
  row.className = 'slot-controls';
  row.title = 'Changing the layout resets this card\'s crop, since the art window changes shape';

  const caption = document.createElement('span');
  caption.className = 'slot-label';
  caption.textContent = 'Layout';

  const sel = document.createElement('select');
  sel.className = 'layout-select';
  for (const name of layouts) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    opt.selected = name === entry.data.layout;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => patchCard(entry.id, { layout: sel.value }));

  row.append(caption, sel);
  row.append(flipButton(entry));
  row.append(removeCardButton(entry));
  return row;
}

// Which side you are looking at, not a property of the card — so it lives in
// `flipped` and never reaches the CSV.
function flipButton(entry) {
  const btn = document.createElement('button');
  btn.className = 'flip-card';
  const showing = flipped.has(entry.id);
  btn.textContent = '⟳';
  btn.title = showing ? 'Show the front' : 'Show the back';
  btn.setAttribute('aria-label', btn.title);
  btn.classList.toggle('is-flipped', showing);
  btn.addEventListener('click', () => {
    if (flipped.has(entry.id)) flipped.delete(entry.id);
    else flipped.add(entry.id);
    updateSlot(entry);
  });
  return btn;
}

// Removing a card drops the CSV row — including any display name, flavor text
// and crop you hand-edited — so it asks first. The art file is untouched and
// simply returns to the tray, since nothing points at it any more.
function removeCardButton(entry) {
  const btn = document.createElement('button');
  btn.className = 'remove-card';
  return confirmOnce(btn, {
    label: 'Remove',
    armedLabel: 'Remove card?',
    title: 'Remove this card from the deck',
    armedTitle: 'Drops the row and any hand edits on it. The art returns to the tray.',
    onConfirm: async () => {
      const res = await fetch(`/api/cards/${entry.id}`, { method: 'DELETE' });
      if (!res.ok) {
        statusEl.innerHTML = '<span class="err">Could not remove that card.</span>';
        return;
      }
      const { removed } = await res.json();
      statusEl.textContent = `Removed ${removed}. Re-import your decklist to bring it back.`;
      await refresh();
    },
  });
}

// Deleting the file itself, not just an assignment — irreversible, so it asks.
// Only unassigned art is ever in the tray, and the server refuses anyway if a
// card still points at the file.
function deleteArtButton(file) {
  const btn = document.createElement('button');
  btn.className = 'delete-art';
  // Swallow mousedown so pressing the button never starts a drag of the thumb.
  btn.addEventListener('mousedown', (e) => e.stopPropagation());
  return confirmOnce(btn, {
    label: 'Delete',
    armedLabel: 'Delete file?',
    title: `Delete ${file} from art/raw`,
    armedTitle: 'Permanently deletes the image file. Cannot be undone.',
    onConfirm: async () => {
      const res = await fetch(`/api/art-files/${encodeURIComponent(file)}`, { method: 'DELETE' });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        statusEl.innerHTML = `<span class="err">Could not delete ${file}${error ? ` — ${error}` : ''}.</span>`;
        return;
      }
      await refreshTray();
    },
  });
}

// Unassigns one side's art. The back keeps an extra class for positioning only.
function clearButton(entry, field) {
  const back = field === 'back_art_file';
  const btn = document.createElement('button');
  btn.className = back ? 'clear-art clear-back' : 'clear-art';
  btn.textContent = '×';
  btn.title = back
    ? `use the shared back instead of ${entry.back_art_file}`
    : `remove ${entry.art_file}`;
  btn.addEventListener('click', () => patchCard(entry.id, { [field]: null }));
  return btn;
}

// ------------------------------------------------- drag art from the tray

function startTrayDrag(e, file) {
  e.preventDefault();
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  const src = artList.querySelector(`.thumb[data-file="${CSS.escape(file)}"]`)?.dataset.url
    ?? `/art/raw/${encodeURIComponent(file)}`;
  ghost.innerHTML = `<img src="${src}">`;
  document.body.appendChild(ghost);
  let target = null;

  const move = (ev) => {
    ghost.style.left = ev.clientX + 12 + 'px';
    ghost.style.top = ev.clientY + 12 + 'px';
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const win = el && el.closest('.drop-target');
    if (target && target !== win) target.classList.remove('drop-hover');
    target = win;
    if (target) target.classList.add('drop-hover');
  };
  const up = (ev) => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    ghost.remove();
    if (target) target.classList.remove('drop-hover');

    // Resolve the drop from where the button came up rather than from the last
    // mousemove. A quick flick can end without a move event landing over the
    // card, and the drop would then be silently lost. `target` stays as the
    // fallback for a mouseup that carries no usable coordinates.
    const el = ev && Number.isFinite(ev.clientX)
      ? document.elementFromPoint(ev.clientX, ev.clientY)
      : null;
    const dropOn = (el && el.closest('.drop-target')) || target;
    const slot = dropOn && dropOn.closest('.card-slot');
    if (!slot) return;
    const field = dropOn.dataset.face === 'back' ? 'back_art_file' : 'art_file';
    patchCard(slot.dataset.id, { [field]: file });
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  move(e);
}

// ------------------------------------------- reposition (pan + zoom) art

function coverCrop(imgW, imgH, aspect) {
  // Same default the renderer's fit:'cover' uses: max centered window-shaped rect.
  let w = imgW;
  let h = w / aspect;
  if (h > imgH) {
    h = imgH;
    w = h * aspect;
  }
  return { x: (imgW - w) / 2, y: (imgH - h) / 2, w, h };
}

function clampCrop(crop, imgW, imgH, aspect) {
  crop.w = Math.min(crop.w, imgW, imgH * aspect);
  crop.w = Math.max(crop.w, 120);
  crop.h = crop.w / aspect;
  crop.x = Math.max(0, Math.min(crop.x, imgW - crop.w));
  crop.y = Math.max(0, Math.min(crop.y, imgH - crop.h));
  return crop;
}

function applyCropPreview(img, win, st) {
  const s = win.clientWidth / st.crop.w;
  img.style.position = 'absolute';
  img.style.maxWidth = 'none';
  img.style.objectFit = 'fill';
  img.style.width = st.imgW * s + 'px';
  img.style.height = st.imgH * s + 'px';
  img.style.left = -st.crop.x * s + 'px';
  img.style.top = -st.crop.y * s + 'px';
}

function enableReposition(win, entry) {
  const img = win.querySelector('.art');
  win.classList.add('repositionable');
  const aspect = cropAspect(entry);
  const st = { imgW: 0, imgH: 0, crop: null };

  // A cached or redirected image can report `complete` before it has decoded,
  // and sizing a crop from a 0×0 image yields a degenerate rectangle that
  // clampCrop then inflates to a 120px sliver — which a later drag would save
  // over the user's real crop. So: bail until the size is known, and try both
  // on load and immediately, since whichever comes first is unpredictable.
  const ready = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    st.imgW = img.naturalWidth;
    st.imgH = img.naturalHeight;
    st.crop = entry.crop ? { ...entry.crop } : coverCrop(st.imgW, st.imgH, aspect);
    clampCrop(st.crop, st.imgW, st.imgH, aspect);
    applyCropPreview(img, win, st);
  };
  img.addEventListener('load', ready);
  ready();

  const save = debounce(() => patchCard(entry.id, { crop: roundCrop(st.crop) }), 500);

  win.addEventListener('mousedown', (e) => {
    if (!st.crop) return;
    e.preventDefault();
    const move = (ev) => {
      const s = (win.clientWidth * CARD_SCALE) / st.crop.w; // screen px per source px
      st.crop.x -= ev.movementX / s;
      st.crop.y -= ev.movementY / s;
      clampCrop(st.crop, st.imgW, st.imgH, aspect);
      applyCropPreview(img, win, st);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      save();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  win.addEventListener('wheel', (e) => {
    if (!st.crop) return;
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0015);
    const cx = st.crop.x + st.crop.w / 2;
    const cy = st.crop.y + st.crop.h / 2;
    st.crop.w *= factor;
    st.crop.h = st.crop.w / aspect;
    st.crop.x = cx - st.crop.w / 2;
    st.crop.y = cy - st.crop.h / 2;
    clampCrop(st.crop, st.imgW, st.imgH, aspect);
    applyCropPreview(img, win, st);
    save();
  }, { passive: false });
}

const roundCrop = (c) => ({ x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) });

function debounce(fn, ms) {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

// ---------------------------------------------------------------- uploads

async function uploadFiles(fileList) {
  const form = new FormData();
  for (const f of fileList) form.append('files', f);
  dropZone.classList.add('busy');
  await fetch('/api/art-upload', { method: 'POST', body: form });
  dropZone.classList.remove('busy');
  refreshTray();
}

document.getElementById('art-input').addEventListener('change', (e) => {
  if (e.target.files.length) uploadFiles(e.target.files);
  e.target.value = '';
});

for (const ev of ['dragover', 'dragenter']) {
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.add('drop-hover');
  });
}
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drop-hover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drop-hover');
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
});

// ---------------------------------------------------------------- import

document.getElementById('import-btn').addEventListener('click', async () => {
  const text = decklistText.value;
  if (!text.trim()) {
    statusEl.innerHTML = '<span class="err">Paste a decklist or choose a file first.</span>';
    return;
  }
  statusEl.textContent = 'Importing…';
  const res = await fetch('/api/decklist', { method: 'POST', body: text });
  const result = await res.json();
  if (result.error) {
    statusEl.innerHTML = `<span class="err">${result.error}</span>`;
    return;
  }
  const n = result.unresolved?.length ?? 0;
  const gone = result.removed ?? [];
  let msg = `Imported ${result.imported} cards (${result.slots} slots).`;
  if (gone.length) {
    // These rows carried art assignments, crops and hand-edited names. The CLI
    // has always reported them; the app used to drop them silently.
    msg += `\n${gone.length} card${gone.length === 1 ? '' : 's'} removed, along with `
      + `${gone.length === 1 ? 'its' : 'their'} art and any edits: ${gone.join(', ')}`;
  }
  if (n) {
    // These rows are in the CSV but will not render, so say so rather than
    // folding them into the imported count.
    msg += `\n${n} name${n === 1 ? '' : 's'} not found on Scryfall — `
      + `${n === 1 ? 'it is' : 'they are'} in data/cards.csv but will not render `
      + `until fixed: ${result.unresolved.join(', ')}`;
  }
  statusEl.textContent = msg;
  renderGallery(result);
  showDeckChrome(true, !!result.unresolved?.length);
  refreshTray();
});

decklistFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) decklistText.value = await file.text();
});

toggleBtn.addEventListener('click', () => {
  importPanel.hidden = !importPanel.hidden;
});

// ------------------------------------------------- confirm-once buttons

// Anything that destroys work asks once: the first click arms the button, the
// second runs it, and clicking elsewhere or pressing Escape backs out. Chosen
// over confirm(), which blocks the page and moves the explanation off the
// control. It stays armed until dismissed rather than timing out — a timer
// that expires while you are reading turns your confirming click into a
// silent re-arm.
//
// One document listener disarms whatever is armed, so the per-card buttons do
// not each add their own.
const armed = new Set();

function disarm(btn) {
  armed.delete(btn);
  btn.classList.remove('danger');
  btn.textContent = btn.dataset.label;
  btn.title = btn.dataset.title || '';
}

function disarmAll() {
  for (const btn of [...armed]) disarm(btn);
}

document.addEventListener('mousedown', (e) => {
  for (const btn of [...armed]) if (!btn.contains(e.target)) disarm(btn);
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') disarmAll();
}, true);

/** Wire a button so `onConfirm` only runs on a second, deliberate click. */
function confirmOnce(btn, { label, armedLabel, title = '', armedTitle = '', onConfirm }) {
  btn.dataset.label = label;
  btn.dataset.title = title;
  btn.textContent = label;
  btn.title = title;

  let busy = false;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (busy) return; // a double-click must not re-arm behind the first action
    if (!btn.classList.contains('danger')) {
      disarmAll(); // only one thing armed at a time
      armed.add(btn);
      btn.classList.add('danger');
      btn.textContent = armedLabel;
      btn.title = armedTitle;
      return;
    }
    disarm(btn);
    busy = true;
    try {
      await onConfirm();
    } finally {
      busy = false;
    }
  });
  return btn;
}

// ---------------------------------------------------------------- reset

confirmOnce(resetBtn, {
  label: 'Start over',
  armedLabel: 'Discard deck + art?',
  armedTitle: 'Deletes the decklist and every uploaded art file. Cannot be undone.',
  onConfirm: async () => {
    const res = await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'discard-art' }),
    });
    if (!res.ok) {
      statusEl.innerHTML = '<span class="err">Reset failed — nothing was changed.</span>';
      return;
    }
    decklistText.value = '';
    decklistFile.value = ''; // else re-picking the same file fires no change event
    statusEl.textContent = 'Project cleared — decklist and uploaded art removed.';
    await refresh();
  },
});

refresh();
