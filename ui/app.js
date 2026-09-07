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
// each entry carries its own art_window from the server.
const cropAspect = (entry) => entry.art_window.w / entry.art_window.h;
let layouts = ['classic']; // replaced by the server's list on first load

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
  setArmed(false); // never let the button come back from hidden still armed
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
  refreshTray();
}

// ---------------------------------------------------------------- gallery

function renderGallery(payload) {
  layouts = payload.layouts ?? layouts;
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
  window.fitText(slot.querySelector('.card'));
}

function fillSlot(slot, entry) {
  slot.innerHTML = '';
  if (entry.qty > 1) {
    const badge = document.createElement('div');
    badge.className = 'qty-badge';
    badge.textContent = `×${entry.qty}`;
    slot.appendChild(badge);
  }
  const scale = document.createElement('div');
  scale.className = 'card-scale';
  const cardEl = document.createElement('div');
  window.CardDom.renderInto(cardEl, entry.data);
  scale.appendChild(cardEl);
  slot.appendChild(scale);

  const win = cardEl.querySelector('.art-window');
  win.classList.add('drop-target');
  if (layouts.length > 1) slot.appendChild(layoutSelect(entry));
  if (entry.art_file) {
    slot.appendChild(clearArtButton(entry));
    enableReposition(win, entry);
  }
}

// Options come from the server's layout list, so adding a layout in
// src/carddata.ts is enough — nothing here enumerates them.
function layoutSelect(entry) {
  const sel = document.createElement('select');
  sel.className = 'layout-select';
  sel.title = 'Card layout — changing it resets the crop, since the art window changes shape';
  for (const name of layouts) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    opt.selected = name === entry.data.layout;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => patchCard(entry.id, { layout: sel.value }));
  return sel;
}

function clearArtButton(entry) {
  const btn = document.createElement('button');
  btn.className = 'clear-art';
  btn.textContent = '×';
  btn.title = `remove ${entry.art_file}`;
  btn.addEventListener('click', () => patchCard(entry.id, { art_file: null }));
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
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    ghost.remove();
    if (target) {
      target.classList.remove('drop-hover');
      const slot = target.closest('.card-slot');
      if (slot) patchCard(slot.dataset.id, { art_file: file });
    }
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
  let msg = `Imported ${result.imported} cards (${result.slots} slots).`;
  if (result.unresolved?.length) {
    msg += `\nNot found on Scryfall: ${result.unresolved.join(', ')}`;
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

// ---------------------------------------------------------------- reset

// Two-step confirm rather than confirm(): a modal dialog blocks the page, and
// this keeps the "what it does" text on the button itself. It stays armed until
// dismissed rather than timing out — a timer that expires while you're reading
// the button turns your confirming click into a silent re-arm.
const ARMED_LABEL = 'Discard deck + art?';
const ARMED_TITLE = 'Deletes the decklist and every uploaded art file. Cannot be undone.';

const isArmed = () => resetBtn.classList.contains('danger');

function setArmed(armed) {
  resetBtn.classList.toggle('danger', armed);
  resetBtn.textContent = armed ? ARMED_LABEL : 'Start over';
  resetBtn.title = armed ? ARMED_TITLE : '';
}

document.addEventListener('mousedown', (e) => {
  if (!resetBtn.contains(e.target)) setArmed(false);
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setArmed(false);
}, true);

let resetting = false;

resetBtn.addEventListener('click', async () => {
  if (resetting) return; // a second click of a double-click must not re-arm
  if (!isArmed()) {
    setArmed(true);
    return;
  }
  setArmed(false);
  resetting = true;
  try {
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
  } finally {
    resetting = false;
  }
  await refresh();
});

refresh();
