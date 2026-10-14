  // ----- Bonnetjes -----

  function filesAvailable() { return !!(Sync && Sync.mode === 'server' && !demo); }

  function attachmentChip(f) {
    const url = Sync.files.url(f.id);
    const isImg = /^image\//.test(f.type);
    return `<span class="file-chip" data-file="${esc(f.id)}">
      <a href="${esc(url)}" target="_blank" rel="noopener" title="${esc(f.name)}">${isImg ? `<img src="${esc(url)}" alt="" loading="lazy">` : '<span class="file-pdf">PDF</span>'}<span class="file-name">${esc(f.name)}</span></a>
      <button type="button" class="chip-x" data-action="tx-file-remove" data-id="${esc(f.id)}" aria-label="Bonnetje verwijderen">✕</button></span>`;
  }

  /** Foto verkleinen (max. 1800 px, jpg) zodat ze snel oplaadt; pdf's gaan ongewijzigd. */
  function prepareFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Kon het bestand niet lezen'));
      if (file.type === 'application/pdf' || !/^image\//.test(file.type)) {
        reader.onload = () => resolve({ name: file.name, type: file.type || 'application/pdf', data: String(reader.result).split(',')[1] });
        reader.readAsDataURL(file);
        return;
      }
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Dit beeld kan niet geopend worden (bv. HEIC): kies een jpg of png'));
        img.onload = () => {
          const k = Math.min(1, 1800 / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve({ name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', data: cv.toDataURL('image/jpeg', 0.82).split(',')[1] });
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadTxFile(input) {
    const file = input.files && input.files[0];
    const t = modal && modal.tx;
    if (!file || !t) return;
    const status = $('#tx-file-status');
    if (status) status.textContent = 'Bezig met opladen…';
    try {
      const p = await prepareFile(file);
      const meta = await Sync.files.upload(p.name, p.type, p.data);
      t.attachments = (t.attachments || []).concat([{ id: meta.id, name: meta.name, type: meta.type, size: meta.size }]);
      const box = $('#tx-files');
      if (box) box.insertAdjacentHTML('beforeend', attachmentChip(meta));
      if (status) status.textContent = 'Opgeladen. Vergeet niet op Opslaan te klikken.';
    } catch (e) {
      if (status) status.textContent = e.message;
    }
    input.value = '';
  }

