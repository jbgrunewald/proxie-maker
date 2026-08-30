const importPanel = document.getElementById('import-panel');
const toggleBtn = document.getElementById('toggle-import');
const statusEl = document.getElementById('import-status');
const gallery = document.getElementById('gallery');

async function refresh() {
  const res = await fetch('/api/cards');
  const payload = await res.json();
  renderGallery(payload);
  const hasCards = payload.cards.length > 0;
  importPanel.hidden = hasCards;
  toggleBtn.hidden = !hasCards;
}

function renderGallery(payload) {
  gallery.innerHTML = '';
  for (const msg of payload.errors ?? []) {
    const div = document.createElement('div');
    div.className = 'err';
    div.textContent = msg;
    gallery.appendChild(div);
  }
  for (const entry of payload.cards) {
    const slot = document.createElement('div');
    slot.className = 'card-slot';
    slot.dataset.id = entry.id;
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
    gallery.appendChild(slot);
  }
  // Auto-fit needs final font metrics; run once fonts are in.
  document.fonts.ready.then(() => {
    for (const el of gallery.querySelectorAll('.card')) window.fitText(el);
  });
}

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
  renderGallery(result);
  importPanel.hidden = result.unresolved?.length ? false : true;
  toggleBtn.hidden = false;
});

document.getElementById('decklist-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) document.getElementById('decklist-text').value = await file.text();
});

toggleBtn.addEventListener('click', () => {
  importPanel.hidden = !importPanel.hidden;
});

refresh();
