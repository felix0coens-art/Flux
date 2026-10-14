  // ----- Snel koppelen: typen, pijltjes en Enter -----

  const picker = { input: null, id: null, items: [], index: 0, typed: false };
  const normQ = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  function pickerItems(id, query) {
    const bulk = id === '__bulk__';
    const opts = assignOptions(bulk ? null : txById(id), bulk);
    const q = normQ(query);
    if (!q) return opts;
    const words = q.split(' ');
    return opts.map(o => {
      const n = normQ(o.label + ' ' + o.hint);
      if (!words.every(w => n.includes(w))) return null;
      const name = normQ(o.label);
      const score = name.startsWith(q) ? 0 : name.split(' ').some(w => w.startsWith(words[0])) ? 1 : 2;
      return Object.assign({ score }, o);
    }).filter(Boolean).sort((a, b) => a.score - b.score);
  }

  function openPicker(input, typed) {
    picker.input = input;
    picker.id = input.dataset.assignInput;
    picker.typed = !!typed;
    picker.items = pickerItems(picker.id, typed ? input.value : '');
    picker.index = typed ? 0 : Math.max(0, picker.items.findIndex(o => o.label === input.dataset.label));
    renderPicker();
  }

  function renderPicker() {
    let pop = $('#assign-pop');
    if (!pop) { pop = document.createElement('div'); pop.id = 'assign-pop'; pop.className = 'assign-pop'; pop.setAttribute('role', 'listbox'); document.body.appendChild(pop); }
    if (!picker.input || !document.body.contains(picker.input)) { pop.hidden = true; return; }
    let last = null;
    pop.innerHTML = picker.items.length ? picker.items.map((o, i) => {
      const head = !picker.typed && o.group !== last ? `<div class="assign-group">${esc(o.group)}</div>` : '';
      last = o.group;
      return `${head}<div class="assign-opt ${i === picker.index ? 'active' : ''}" role="option" data-pick="${i}">${esc(o.label)}${o.hint ? ` <span class="muted small">${esc(o.hint)}</span>` : ''}</div>`;
    }).join('') : '<div class="assign-empty">Niets gevonden. <span class="muted">Enter = nieuwe categorie</span></div>';
    const r = picker.input.getBoundingClientRect();
    const width = Math.max(r.width, 240);
    pop.style.width = width + 'px';
    pop.style.left = Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - width - 8)) + 'px';
    const below = window.innerHeight - r.bottom;
    pop.style.maxHeight = Math.max(160, Math.min(320, Math.max(below, r.top) - 16)) + 'px';
    pop.hidden = false;
    if (below < 200 && r.top > below) { pop.style.top = (r.top + window.scrollY - pop.offsetHeight - 4) + 'px'; }
    else pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    picker.input.setAttribute('aria-expanded', 'true');
    const act = $('.assign-opt.active', pop);
    if (act) act.scrollIntoView({ block: 'nearest' });
  }

  function closePicker(restore) {
    const pop = $('#assign-pop');
    if (pop) pop.hidden = true;
    if (picker.input) {
      picker.input.setAttribute('aria-expanded', 'false');
      if (restore) picker.input.value = picker.input.dataset.label || '';
    }
    picker.input = null;
  }

  /** Kiest een optie; met Enter springt Helder meteen naar de volgende transactie. */
  function choosePick(i, viaKeyboard) {
    const input = picker.input;
    if (!input) return;
    const item = picker.items[i];
    const id = picker.id;
    if (!item) {
      if (picker.typed && input.value.trim() && id !== '__bulk__') { closePicker(true); newCategoryFor(id, input.value.trim()); }
      return;
    }
    const all = $$('[data-assign-input]').filter(x => x.dataset.assignInput !== '__bulk__');
    const pos = all.indexOf(input);
    closePicker(false);
    input.blur();
    if (id === '__bulk__') { bulkAssign(item.value); return; }
    assignTx(id, item.value);
    if (viaKeyboard && !modal) {
      requestAnimationFrame(() => {
        const next = $$('[data-assign-input]').filter(x => x.dataset.assignInput !== '__bulk__');
        const stillThere = next.findIndex(x => x.dataset.assignInput === id);
        const target = next[stillThere >= 0 ? stillThere + 1 : pos];
        if (target) { target.focus(); target.select(); }
      });
    }
  }

  function newCategoryFor(id, name) {
    const t = txById(id);
    if (!t) return;
    openModal({ type: 'category', assignTo: t.id, category: { id: C.uid('cat'), name, kind: t.amount > 0 ? 'income' : 'expense', color: t.amount > 0 ? '#37b24d' : '#3b5bdb', lookupTags: '' } });
  }

