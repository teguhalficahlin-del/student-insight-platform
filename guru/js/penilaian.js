(function () {
  'use strict';

  let _kelasId   = null;
  let _subjectId = null;
  let _year      = null;
  let _semester  = null;

  // ── Styles ───────────────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('pen-styles')) return;
    const s = document.createElement('style');
    s.id = 'pen-styles';
    s.textContent = `
.pen-section { border:1px solid var(--color-border); border-radius:var(--radius); overflow:hidden; margin-bottom:12px; }
.pen-section-header { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; background:var(--color-surface); cursor:pointer; user-select:none; font-weight:600; color:var(--color-text); }
.pen-section-header:hover { background:var(--color-bg); }
.pen-chevron { transition:transform .2s; color:var(--color-text-muted); }
.pen-section-body { padding:12px 16px; border-top:1px solid var(--color-border); }
`;
    document.head.appendChild(s);
  }

  // ── Collapse ─────────────────────────────────────────────────────────────────

  function initCollapse() {
    [
      { headerId: 'pen-perencanaan-header', bodyId: 'pen-perencanaan-body', open: true },
      { headerId: 'pen-pelaksanaan-header', bodyId: 'pen-pelaksanaan-body', open: false },
    ].forEach(function (cfg) {
      const header  = document.getElementById(cfg.headerId);
      const body    = document.getElementById(cfg.bodyId);
      const chevron = header ? header.querySelector('.pen-chevron') : null;
      if (!header || !body) return;

      body.style.display = cfg.open ? '' : 'none';
      if (chevron) chevron.style.transform = cfg.open ? 'rotate(180deg)' : '';

      header.addEventListener('click', function () {
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : '';
        if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
      });
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  function renderAll() {
    const container = document.getElementById('penilaian-placeholder');
    if (!container) return;

    const hasCtx = _kelasId && _subjectId && _year && _semester;
    const emptyHint = hasCtx
      ? null
      : '<p class="hint">Pilih kelas, mapel, tahun, dan semester untuk melihat data.</p>';

    container.innerHTML =
      '<div class="pen-section">' +
        '<div class="pen-section-header" id="pen-perencanaan-header">' +
          '<span>Perencanaan</span>' +
          '<span class="pen-chevron">▼</span>' +
        '</div>' +
        '<div class="pen-section-body" id="pen-perencanaan-body">' +
          (emptyHint || '<p class="hint">Belum ada TP untuk mapel dan kelas ini.</p>') +
        '</div>' +
      '</div>' +
      '<div class="pen-section">' +
        '<div class="pen-section-header" id="pen-pelaksanaan-header">' +
          '<span>Pelaksanaan</span>' +
          '<span class="pen-chevron">▼</span>' +
        '</div>' +
        '<div class="pen-section-body" id="pen-pelaksanaan-body">' +
          (emptyHint || '<p class="hint">Belum ada entri penilaian.</p>') +
        '</div>' +
      '</div>';

    initCollapse();
  }

  // ── Entry point ───────────────────────────────────────────────────────────────

  window.initPenilaianPanel = function (kelasId, subjectId, year, semester) {
    _kelasId   = kelasId   || null;
    _subjectId = subjectId || null;
    _year      = year      || null;
    _semester  = semester  || null;
    injectStyles();
    renderAll();
  };

}());
