// Shared card DOM builder — used by the print renderer's harness (card.html)
// and the web app's gallery, so the preview and the printed card are the same
// markup. No ids inside the card so many can coexist on one page.
(function () {
  const MARKUP = `
  <div class="frame">
    <div class="title-bar">
      <span class="card-name"></span>
      <span class="mana-cost"></span>
    </div>
    <div class="art-window"><img class="art" alt=""></div>
    <div class="type-bar"><span class="type-line"></span></div>
    <div class="text-box">
      <div class="text-box-inner"></div>
    </div>
    <div class="collector-line"></div>
    <div class="pt-box" hidden></div>
  </div>`;

  const SYMBOL_ALIASES = { t: 'tap', q: 'untap' };

  function symbolHtml(sym, costStyle) {
    const key = sym.toLowerCase().replace(/\//g, '');
    const cls = SYMBOL_ALIASES[key] || key;
    return `<i class="ms ms-${cls}${costStyle ? ' ms-cost ms-shadow' : ''}"></i>`;
  }

  function manaify(text, costStyle) {
    return text.replace(/\{([^}]+)\}/g, (_, sym) => symbolHtml(sym, costStyle));
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function rulesHtml(text) {
    return text.split('\n').map((p) => {
      let html = manaify(esc(p), true);
      html = html.replace(/\(([^)]+)\)/g, '<em class="reminder">($1)</em>');
      return `<p>${html}</p>`;
    }).join('');
  }

  function renderInto(root, card) {
    const o = card.oracle;
    root.className = `card theme-${card.theme}`;
    root.innerHTML = MARKUP;
    const q = (sel) => root.querySelector(sel);

    q('.card-name').textContent = card.display_name || card.original_card;
    q('.mana-cost').innerHTML = manaify(o.mana_cost || '', true);
    q('.type-line').textContent = o.type_line;
    if (card.art_src) q('.art').src = card.art_src;

    const box = q('.text-box-inner');
    const isBasic = /\bBasic Land\b/.test(o.type_line);
    if (isBasic) {
      // Classic basic-land treatment: one big symbol instead of reminder text
      const sym = { Swamp: 'b', Island: 'u', Plains: 'w', Mountain: 'r', Forest: 'g' }[o.name] || 'c';
      box.innerHTML = `<div class="basic-symbol"><i class="ms ms-${sym}"></i></div>`;
    } else {
      let html = rulesHtml(o.oracle_text || '');
      const flavor = card.flavor || o.flavor_text;
      if (flavor) html += `<div class="flavor-divider"></div><p class="flavor">${esc(flavor)}</p>`;
      box.innerHTML = html;
    }

    const pt = q('.pt-box');
    if (o.power != null && o.toughness != null) {
      pt.hidden = false;
      pt.textContent = `${o.power}/${o.toughness}`;
    }

    const collectorName = card.display_name ? card.original_card : '';
    q('.collector-line').textContent =
      [collectorName, 'proxy — not for sale'].filter(Boolean).join('  •  ');
  }

  window.CardDom = { renderInto };
})();
