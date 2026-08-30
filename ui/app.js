const importPanel = document.getElementById('import-panel');
const toggleBtn = document.getElementById('toggle-import');
const statusEl = document.getElementById('import-status');
const workbench = document.getElementById('workbench');
const gallery = document.getElementById('gallery');
const artList = document.getElementById('art-list');
const dropZone = document.getElementById('drop-zone');

const CARD_SCALE = 0.35;
let artWindow = { w: 687, h: 491 }; // authoritative value arrives with /api/cards
const cropAspect = () => artWindow.w / artWindow.h;

// ---------------------------------------------------------------- data

async function refresh() {
  const res = await fetch('/api/cards');
  const payload = await res.json();
  artWindow = payload.art_window ?? artWindow;
  renderGallery(payload);
  await refreshTray();
  const hasCards = payload.cards.length > 0;
  importPanel.hidden = hasCards;
  workbench.hidden = !hasCards;
  toggleBtn.hidden = !hasCards;
}

async function refreshTray() {
  const res = await fetch('/api/art-files');
  const { files } = await res.json();
  artList.innerHTML = '';
  for (const f of files) {
    const thumb = document.createElement('div');
    thumb.className = 'thumb' + (f.assigned_to.length ? ' assigned' : '');
    thumb.dataset.file = f.file;
    thumb.innerHTML = `<img src="/art/raw/${encodeURIComponent(f.file)}" draggable="false">
      <span class="thumb-name">${f.file}</span>`;
    if (f.assigned_to.length) thumb.title = `assigned to: ${f.assigned_to.join(', ')}`;
    thumb.addEventListener('mousedown', (e) => startTrayDrag(e, f.file));
    artList.appendChild(thumb);
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
  if (entry.art_file) {
    slot.appendChild(clearArtButton(entry));
    enableReposition(win, entry);
  }
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
  ghost.innerHTML = `<img src="/art/raw/${encodeURIComponent(file)}">`;
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

function coverCrop(imgW, imgH) {
  // Same default the renderer's fit:'cover' uses: max centered window-shaped rect.
  let w = imgW;
  let h = w / cropAspect();
  if (h > imgH) {
    h = imgH;
    w = h * cropAspect();
  }
  return { x: (imgW - w) / 2, y: (imgH - h) / 2, w, h };
}

function clampCrop(crop, imgW, imgH) {
  crop.w = Math.min(crop.w, imgW, imgH * cropAspect());
  crop.w = Math.max(crop.w, 120);
  crop.h = crop.w / cropAspect();
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
  const st = { imgW: 0, imgH: 0, crop: null };

  const ready = () => {
    st.imgW = img.naturalWidth;
    st.imgH = img.naturalHeight;
    st.crop = entry.crop ? { ...entry.crop } : coverCrop(st.imgW, st.imgH);
    clampCrop(st.crop, st.imgW, st.imgH);
    applyCropPreview(img, win, st);
  };
  if (img.complete && img.naturalWidth) ready();
  else img.addEventListener('load', ready);

  const save = debounce(() => patchCard(entry.id, { crop: roundCrop(st.crop) }), 500);

  win.addEventListener('mousedown', (e) => {
    if (!st.crop) return;
    e.preventDefault();
    const move = (ev) => {
      const s = (win.clientWidth * CARD_SCALE) / st.crop.w; // screen px per source px
      st.crop.x -= ev.movementX / s;
      st.crop.y -= ev.movementY / s;
      clampCrop(st.crop, st.imgW, st.imgH);
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
    st.crop.h = st.crop.w / cropAspect();
    st.crop.x = cx - st.crop.w / 2;
    st.crop.y = cy - st.crop.h / 2;
    clampCrop(st.crop, st.imgW, st.imgH);
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
  const text = document.getElementById('decklist-text').value;
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
  artWindow = result.art_window ?? artWindow;
  renderGallery(result);
  importPanel.hidden = !result.unresolved?.length;
  workbench.hidden = false;
  toggleBtn.hidden = false;
  refreshTray();
});

document.getElementById('decklist-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) document.getElementById('decklist-text').value = await file.text();
});

toggleBtn.addEventListener('click', () => {
  importPanel.hidden = !importPanel.hidden;
});

refresh();
