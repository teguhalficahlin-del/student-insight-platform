(function () {
  var WA_NUMBER = '6281276979602';
  var WA_TEXT   = 'Halo, saya butuh bantuan terkait platform sekolah.';

  function inject() {
    if (document.getElementById('wa-float-btn')) return;

    var style = document.createElement('style');
    style.textContent = [
      '#wa-float-btn{',
        'position:fixed;bottom:24px;right:20px;z-index:9999;',
        'width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;',
        'background:#25D366;box-shadow:0 4px 14px rgba(0,0,0,.25);',
        'display:flex;align-items:center;justify-content:center;',
        'transition:transform .18s,box-shadow .18s;',
        'text-decoration:none;',
      '}',
      '#wa-float-btn:hover{transform:scale(1.1);box-shadow:0 6px 20px rgba(0,0,0,.32);}',
      '#wa-float-btn svg{width:30px;height:30px;fill:#fff;}',
      '@media(max-width:480px){#wa-float-btn{bottom:70px;right:14px;}}',
    ].join('');
    document.head.appendChild(style);

    var btn = document.createElement('a');
    btn.id   = 'wa-float-btn';
    btn.href = 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(WA_TEXT);
    btn.target = '_blank';
    btn.rel    = 'noopener noreferrer';
    btn.title  = 'Chat WhatsApp Support';
    btn.setAttribute('aria-label', 'Hubungi support via WhatsApp');
    // WhatsApp official SVG logo
    btn.innerHTML = '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M16 .5C7.44.5.5 7.44.5 16c0 2.73.7 5.38 2.04 7.72L.5 31.5l8.05-2.01A15.45 15.45 0 0 0 16 31.5C24.56 31.5 31.5 24.56 31.5 16S24.56.5 16 .5Zm0 28.18a13.6 13.6 0 0 1-6.93-1.9l-.5-.3-5.18 1.3 1.35-4.95-.33-.52A13.53 13.53 0 0 1 2.32 16C2.32 9.02 8.02 3.32 16 3.32S29.68 9.02 29.68 16 23.98 28.68 16 28.68Zm7.47-10.12c-.41-.2-2.42-1.19-2.8-1.33-.37-.14-.64-.2-.9.2s-1.04 1.33-1.27 1.6c-.23.28-.47.31-.88.1a11.12 11.12 0 0 1-3.27-2.02 12.26 12.26 0 0 1-2.26-2.82c-.24-.41 0-.63.18-.84.16-.18.37-.47.55-.7.18-.24.24-.41.37-.68.12-.27.06-.5-.03-.7-.1-.2-.9-2.17-1.23-2.97-.32-.77-.65-.67-.9-.68l-.76-.01c-.27 0-.7.1-1.06.5s-1.4 1.37-1.4 3.33 1.43 3.87 1.63 4.13c.2.27 2.82 4.3 6.83 6.03.95.41 1.7.66 2.28.84.96.3 1.83.26 2.52.16.77-.12 2.37-.97 2.7-1.9.34-.94.34-1.74.24-1.9-.1-.18-.37-.28-.78-.48Z"/></svg>';

    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
