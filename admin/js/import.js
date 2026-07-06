/**
 * @file admin/js/import.js
 *
 * Reusable CSV upload + preview + result-report widget.
 * Used by setup-wizard.js for steps 4 (Guru & Staf), 5 (Siswa),
 * and 6 (Jadwal Mengajar) — each step calls mountCsvImporter()
 * with a different Edge Function caller and column list.
 */

/** Minimal client-side CSV parse, just for the preview table. */
function previewParseCsv(text, maxRows = 10) {
    const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1, 1 + maxRows).map(line => line.split(',').map(c => c.trim()));
    return { headers, rows, totalDataRows: lines.length - 1 };
}

/**
 * Mounts a CSV importer into `container`.
 *
 * @param container        DOM element to render into
 * @param options.columns  array of expected column names (for the hint text)
 * @param options.onImport async (csvText) => result  — calls the Edge Function
 * @param options.onDone   (result) => void — called after a successful import
 */
export function mountCsvImporter(container, { columns, onImport, onDone, template }) {
    container.innerHTML = `
        <p class="hint">Kolom yang diharapkan: <code>${columns.join(', ')}</code></p>
        ${template ? `<button type="button" class="btn btn-secondary csv-template-btn">Download Template CSV</button>` : ''}
        <div class="dropzone">
            <input type="file" accept=".csv,text/csv" class="csv-file-input" />
            <p class="hint">Pilih file CSV untuk diunggah</p>
        </div>
        <div class="csv-preview-area"></div>
        <div class="csv-result-area"></div>
        <button type="button" class="btn btn-primary csv-import-btn" disabled>Impor Data</button>
    `;

    const fileInput   = container.querySelector('.csv-file-input');
    const previewArea = container.querySelector('.csv-preview-area');
    const resultArea  = container.querySelector('.csv-result-area');
    const importBtn   = container.querySelector('.csv-import-btn');

    if (template) {
        container.querySelector('.csv-template-btn').addEventListener('click', () => {
            downloadCsvTemplate(template.filename, template.columns, template.exampleRows);
        });
    }

    let currentCsvText = null;
    let importSucceeded = false;

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        resultArea.innerHTML = '';
        importSucceeded = false;
        importBtn.disabled = true;
        importBtn.textContent = 'Impor Data';
        importBtn.classList.remove('btn-success');
        importBtn.classList.add('btn-primary');
        if (!file) {
            currentCsvText = null;
            importBtn.disabled = true;
            previewArea.innerHTML = '';
            return;
        }

        currentCsvText = await file.text();
        const { headers, rows, totalDataRows } = previewParseCsv(currentCsvText);

        if (headers.length === 0) {
            previewArea.innerHTML = `<div class="alert alert-danger">File CSV kosong atau tidak valid.</div>`;
            importBtn.disabled = true;
            return;
        }

        previewArea.innerHTML = `
            <p class="hint">Pratinjau ${Math.min(10, totalDataRows)} dari ${totalDataRows} baris:</p>
            <table class="table">
                <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                <tbody>
                    ${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}
                </tbody>
            </table>
        `;
        importBtn.disabled = false;
    });

    importBtn.addEventListener('click', async () => {
        if (!currentCsvText) return;
        importBtn.disabled = true;
        importBtn.textContent = 'Mengimpor...';
        resultArea.innerHTML = '';

        try {
            const result = await onImport(currentCsvText);
            renderResult(resultArea, result);
            onDone?.(result);

            const isFullSuccess = (result.failed ?? 0) === 0
                && (result.errors?.length ?? 0) === 0
                && (result.success ?? 0) > 0;

            if (isFullSuccess) {
                importSucceeded = true;
            }
        } catch (err) {
            resultArea.innerHTML = `
                <div class="alert alert-danger">
                    ${err.message ?? 'Impor gagal'}
                </div>
                <div class="alert alert-warning">
                    Jika Anda tidak yakin apakah data sudah tersimpan,
                    periksa panel data terlebih dahulu sebelum mengulang impor.
                </div>
            `;
        } finally {
            if (importSucceeded) {
                importBtn.disabled = true;
                importBtn.textContent = '✓ Data Berhasil Diimpor';
                importBtn.classList.remove('btn-primary');
                importBtn.classList.add('btn-success');
            } else {
                importBtn.disabled = false;
                importBtn.textContent = 'Impor Data';
            }
        }
    });
}

/** Builds a CSV blob from headers + example rows and triggers a browser download. */
function downloadCsvTemplate(filename, columns, exampleRows) {
    const csv = [columns, ...exampleRows]
        .map(row => row.join(','))
        .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function renderResult(resultArea, result) {
    const { total = 0, success = 0, failed = 0, errors = [], conflicts = [] } = result;
    // Akun baru: bulk-import-users → result.imported, bulk-import-dudi/parents → result.created,
    // provision-student-accounts → result.created_accounts
    const newAccounts = result.imported ?? result.created ?? result.created_accounts ?? [];

    let html = `
        <div class="import-summary">
            <div class="stat"><div class="num">${total}</div><div class="label">Total Baris</div></div>
            <div class="stat"><div class="num" style="color:var(--color-success)">${success}</div><div class="label">Berhasil</div></div>
            <div class="stat"><div class="num" style="color:var(--color-danger)">${failed}</div><div class="label">Gagal</div></div>
            ${conflicts.length ? `<div class="stat"><div class="num" style="color:var(--color-warning)">${conflicts.length}</div><div class="label">Konflik</div></div>` : ''}
        </div>
    `;

    if (newAccounts.length > 0) {
        const idCol = newAccounts[0].login_identifier !== undefined ? 'login_identifier'
            : newAccounts[0].nis !== undefined ? 'nis' : 'login_identifier';
        html += `
            <div class="alert" style="background:var(--color-warning-bg,#fefce8);border:1px solid var(--color-warning,#ca8a04);border-radius:6px;padding:12px;margin-top:12px">
                <strong>⚠ Catat password sementara berikut — hanya ditampilkan sekali!</strong>
                <p class="hint" style="margin:4px 0 8px">Bagikan ke masing-masing pengguna. Mereka wajib ganti saat login pertama.</p>
                <table class="table" style="font-size:13px">
                    <thead><tr><th>Nama</th><th>Kode Login</th><th>Password Sementara</th></tr></thead>
                    <tbody>${newAccounts.map(a => `<tr><td>${a.full_name ?? ''}</td><td><code>${a[idCol] ?? ''}</code></td><td><code>${a.temp_password ?? ''}</code></td></tr>`).join('')}</tbody>
                </table>
            </div>
        `;
    }

    if (errors.length > 0) {
        html += `
            <table class="table">
                <thead><tr><th>Baris</th><th>Pesan</th></tr></thead>
                <tbody>${errors.map(e => `<tr><td>${e.row}</td><td>${e.message}</td></tr>`).join('')}</tbody>
            </table>
        `;
    }

    if (conflicts.length > 0) {
        html += `
            <p class="hint">Konflik jadwal (perlu ditinjau manual):</p>
            <table class="table">
                <thead><tr><th>Baris</th><th>Pesan</th></tr></thead>
                <tbody>${conflicts.map(c => `<tr><td>${c.row}</td><td>${c.message}</td></tr>`).join('')}</tbody>
            </table>
        `;
    }

    if (failed === 0 && conflicts.length === 0) {
        html += `<div class="alert alert-success">Semua baris berhasil diimpor.</div>`;
    }

    resultArea.innerHTML = html;
}
