/**
 * @file admin/js/wizard.js
 *
 * Controller untuk admin/wizard.html — wizard onboarding 9 langkah.
 * Step 1 (Profil Sekolah) dan Step 2 (Tahun Ajaran) terimplementasi
 * penuh; Step 3–8 placeholder "Segera hadir"; Step 9 ringkasan +
 * tombol "Buka Dashboard".
 *
 * State disimpan di memory saja (tidak localStorage) — refresh
 * memulai ulang wizard, tetapi data yang sudah tersimpan di DB
 * (school_config / academic_periods) akan di-pre-fill saat render.
 *
 * Semua akses Supabase lewat client yang diekspor api.js — tidak ada
 * createClient kedua di sini.
 */

import {
    supabase,
    getCurrentUserRow, requireAdministrativeOrRedirect,
    getSchoolConfig, upsertSchoolConfig, markSetupCompleted,
    getPrograms, addProgram, deleteRecord, changePassword,
    importPrograms, importClasses, importUsers, importStudents, importSchedules,
    logout,
} from './api.js';

const TOTAL_STEPS = 9;

const STEP_NAMES = {
    1: 'Profil Sekolah',
    2: 'Tahun Ajaran',
    3: 'Program Keahlian',
    4: 'Kelas & Rombel',
    5: 'Guru',
    6: 'Siswa',
    7: 'Wali Kelas',
    8: 'Jadwal',
    9: 'Selesai',
};

// ─────────────────────────────────────────────────────────────
// STATE (in-memory)
// ─────────────────────────────────────────────────────────────

const state = {
    currentStep:    1,
    completedSteps: new Set(),
    data: {
        schoolName:   '',
        address:      '',
        academicYear: '',
        semester:     '',   // '1' = Ganjil, '2' = Genap
        startDate:    '',
        endDate:      '',
    },
};

// ─────────────────────────────────────────────────────────────
// DOM REFS
// ─────────────────────────────────────────────────────────────

const contentEl  = document.getElementById('wizard-step-content');
const errorEl     = document.getElementById('wizard-error');
const activeNameEl = document.getElementById('wizard-active-step-name');
const prevBtn     = document.getElementById('wizard-prev-btn');
const nextBtn     = document.getElementById('wizard-next-btn');

// ─────────────────────────────────────────────────────────────
// ERROR HELPERS
// ─────────────────────────────────────────────────────────────

function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
}

function clearError() {
    errorEl.textContent = '';
    errorEl.style.display = 'none';
}

// ─────────────────────────────────────────────────────────────
// NAVIGATION / RENDER
// ─────────────────────────────────────────────────────────────

function markDone(n) {
    state.completedSteps.add(n);
    syncSidebar();
}

function syncSidebar() {
    document.querySelectorAll('#wizard-steps .wz-step-item').forEach(el => {
        const step = Number(el.dataset.step);
        const isActive = step === state.currentStep;
        const isDone   = state.completedSteps.has(step) && !isActive;

        el.classList.toggle('is-active', isActive);
        el.classList.toggle('is-done', isDone);

        // Marker: centang untuk langkah selesai, nomor untuk lainnya
        const marker = el.querySelector('.wz-marker');
        if (marker) marker.textContent = isDone ? '✓' : String(step);

        // Hanya langkah yang sudah selesai yang bisa diklik
        const canClick = state.completedSteps.has(step);
        el.style.cursor = canClick ? 'pointer' : 'default';
    });

    document.querySelectorAll('#wizard-progress-mobile .wz-bar').forEach(el => {
        const step = Number(el.dataset.step);
        el.classList.toggle('is-active', step === state.currentStep);
        el.classList.toggle('is-done', state.completedSteps.has(step) && step !== state.currentStep);
    });
}

function syncFooter() {
    prevBtn.disabled = state.currentStep === 1;
    nextBtn.textContent = state.currentStep === TOTAL_STEPS ? 'Buka Dashboard' : 'Selanjutnya';
}

async function goToStep(n) {
    if (n < 1 || n > TOTAL_STEPS) return;
    clearError();
    state.currentStep = n;
    activeNameEl.textContent = STEP_NAMES[n];
    syncSidebar();
    syncFooter();

    const renderer = STEP_RENDERERS[n] ?? renderPlaceholder;
    contentEl.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        await renderer();
    } catch (err) {
        contentEl.innerHTML = '';
        showError(err.message ?? 'Gagal memuat langkah ini.');
    }
}

// ─────────────────────────────────────────────────────────────
// STEP RENDERERS
// ─────────────────────────────────────────────────────────────

async function renderStep1() {
    // Pre-fill dari DB jika sudah ada (resume) — fallback ke state memory
    let config = null;
    try { config = await getSchoolConfig(); } catch { /* abaikan, form kosong */ }

    const name    = state.data.schoolName || config?.school_name || '';
    const address = state.data.address    || config?.address     || '';

    contentEl.innerHTML = `
        <div class="step-label">Langkah 1 dari ${TOTAL_STEPS}</div>
        <h3>Profil Sekolah</h3>
        <div class="field">
            <label for="wz-school-name">Nama Sekolah</label>
            <input type="text" id="wz-school-name" class="input"
                placeholder="contoh: SMK Negeri 1 Contoh" value="${escapeAttr(name)}" />
        </div>
        <div class="field">
            <label for="wz-address">Alamat</label>
            <textarea id="wz-address" class="input" rows="3"
                placeholder="Alamat lengkap sekolah">${escapeHtml(address)}</textarea>
        </div>
    `;
    nextBtn.disabled = false;
}

async function renderStep2() {
    // Pre-fill: ambil periode aktif dari school_config + academic_periods
    let config = null;
    try { config = await getSchoolConfig(); } catch { /* abaikan */ }

    let period = null;
    if (config?.current_academic_year && config?.current_semester) {
        const { data } = await supabase
            .from('academic_periods')
            .select('academic_year, semester, start_date, end_date')
            .eq('academic_year', config.current_academic_year)
            .eq('semester', config.current_semester)
            .maybeSingle();
        period = data;
    }

    const academicYear = state.data.academicYear || period?.academic_year || config?.current_academic_year || '';
    const semester     = state.data.semester     || period?.semester      || config?.current_semester      || '1';
    const startDate    = state.data.startDate    || period?.start_date    || '';
    const endDate      = state.data.endDate      || period?.end_date      || '';

    contentEl.innerHTML = `
        <div class="step-label">Langkah 2 dari ${TOTAL_STEPS}</div>
        <h3>Tahun Ajaran</h3>
        <div class="field">
            <label for="wz-academic-year">Tahun Ajaran</label>
            <input type="text" id="wz-academic-year" class="input"
                placeholder="contoh: 2026/2027" value="${escapeAttr(academicYear)}" />
            <p class="hint">Format: YYYY/YYYY</p>
        </div>
        <div class="field">
            <label>Semester</label>
            <label style="font-weight:400; display:inline-flex; gap:6px; margin-right:18px;">
                <input type="radio" name="wz-semester" value="1" ${semester === '1' ? 'checked' : ''} /> Ganjil
            </label>
            <label style="font-weight:400; display:inline-flex; gap:6px;">
                <input type="radio" name="wz-semester" value="2" ${semester === '2' ? 'checked' : ''} /> Genap
            </label>
        </div>
        <div class="field">
            <label for="wz-start-date">Tanggal Mulai</label>
            <input type="date" id="wz-start-date" class="input" value="${escapeAttr(startDate)}" />
        </div>
        <div class="field">
            <label for="wz-end-date">Tanggal Selesai</label>
            <input type="date" id="wz-end-date" class="input" value="${escapeAttr(endDate)}" />
        </div>
    `;
    nextBtn.disabled = false;
}

function renderPlaceholder() {
    const step = state.currentStep;
    contentEl.innerHTML = `
        <div class="step-label">Langkah ${step} dari ${TOTAL_STEPS}</div>
        <h3>${STEP_NAMES[step]}</h3>
        ${templateButtonHtml(step)}
        <p>Langkah ini akan segera tersedia.</p>
    `;
    wireTemplateButton(step);
    // Placeholder belum bisa dilanjutkan
    nextBtn.disabled = true;
}

async function renderStep9() {
    const rows = [];
    for (let i = 1; i <= TOTAL_STEPS; i++) {
        const done = state.completedSteps.has(i);
        rows.push(`
            <tr>
                <td style="width:32px">${done ? '✔' : '○'}</td>
                <td>${STEP_NAMES[i]}</td>
                <td><span class="badge ${done ? 'badge-success' : 'badge-muted'}">${done ? 'Selesai' : 'Belum'}</span></td>
            </tr>
        `);
    }
    contentEl.innerHTML = `
        <div class="step-label">Langkah ${TOTAL_STEPS} dari ${TOTAL_STEPS}</div>
        <h3>Selesai</h3>
        <p>Tinjau status setiap langkah sebelum membuka dashboard.</p>
        <table class="table"><tbody>${rows.join('')}</tbody></table>
        <p class="hint">Klik "Buka Dashboard" untuk menandai setup selesai dan masuk ke konsol admin.</p>
    `;
    nextBtn.disabled = false;
}

async function renderStep3() {
    const programs = await getPrograms();

    contentEl.innerHTML = `
        <div class="step-label">Langkah 3 dari ${TOTAL_STEPS}</div>
        <h3>Program Keahlian</h3>
        <p class="hint">Tambahkan program keahlian (jurusan) yang ada di sekolah Anda.</p>
        ${templateButtonHtml(3)}
        <table class="table">
            <thead><tr><th style="width:120px">Kode</th><th>Nama Program</th><th style="width:48px"></th></tr></thead>
            <tbody id="wz-program-tbody">${renderProgramRows(programs)}</tbody>
        </table>
        <div class="field">
            <label for="wz-program-name">Nama Program</label>
            <input type="text" id="wz-program-name" class="input"
                placeholder="contoh: Teknik Komputer dan Jaringan" />
        </div>
        <div class="field">
            <label for="wz-program-code">Kode Program</label>
            <input type="text" id="wz-program-code" class="input" maxlength="20"
                placeholder="contoh: TKJ" />
            <p class="hint">Maksimal 20 karakter, otomatis menjadi huruf besar.</p>
        </div>
        <button type="button" class="btn btn-secondary" id="wz-program-add-btn">Tambah</button>

        <hr style="margin:24px 0;border:none;border-top:1px solid var(--color-border)" />
        <h4 style="margin:0 0 8px">Atau impor massal dari file</h4>
        ${importBlockHtml(3)}
    `;

    // Kode program: uppercase otomatis saat mengetik
    const codeInput = document.getElementById('wz-program-code');
    codeInput.addEventListener('input', () => {
        codeInput.value = codeInput.value.toUpperCase();
    });

    document.getElementById('wz-program-add-btn').addEventListener('click', onAddProgram);
    wireProgramDeleteButtons();
    wireTemplateButton(3);
    wireImportBlock(3, {
        importFn: importPrograms,
        onDone: async () => {
            const updated = await getPrograms();
            const tbody = contentEl.querySelector('#wz-program-tbody');
            if (tbody) tbody.innerHTML = renderProgramRows(updated);
            wireProgramDeleteButtons();
            nextBtn.disabled = updated.length < 1;
        },
    });

    // "Selanjutnya" hanya aktif jika minimal 1 program
    nextBtn.disabled = programs.length < 1;
}

function renderProgramRows(programs) {
    if (!programs.length) {
        return '<tr><td colspan="3" class="hint">Belum ada program. Tambahkan minimal satu.</td></tr>';
    }
    return programs.map(p => `
        <tr>
            <td>${escapeHtml(p.code)}</td>
            <td>${escapeHtml(p.name)}</td>
            <td><button type="button" class="btn btn-danger wz-program-del"
                data-id="${escapeAttr(p.program_id)}" title="Hapus"
                style="padding:4px 10px">✕</button></td>
        </tr>
    `).join('');
}

async function onAddProgram() {
    clearError();
    const nameEl = document.getElementById('wz-program-name');
    const codeEl = document.getElementById('wz-program-code');
    const addBtn = document.getElementById('wz-program-add-btn');

    const name = nameEl.value.trim();
    const code = codeEl.value.trim().toUpperCase();

    if (!name) { showError('Nama program wajib diisi.'); return; }
    if (!code) { showError('Kode program wajib diisi.'); return; }

    // Cek duplikat kode dari DB (sumber kebenaran, bukan state memory)
    const existing = await getPrograms();
    if (existing.some(p => p.code === code)) {
        showError(`Kode program "${code}" sudah ada.`);
        return;
    }

    addBtn.disabled = true;
    addBtn.textContent = 'Menyimpan…';
    try {
        await addProgram({ name, code });
        await renderStep3(); // re-render daftar + reset form
    } catch (err) {
        showError(err.message ?? 'Gagal menambah program.');
        addBtn.disabled = false;
        addBtn.textContent = 'Tambah';
    }
}

function wireProgramDeleteButtons() {
    contentEl.querySelectorAll('.wz-program-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            clearError();
            btn.disabled = true;
            try {
                await deleteRecord('programs', btn.dataset.id);
                await renderStep3();
            } catch (err) {
                // asDeleteError di api.js sudah memberi pesan ramah bila ada FK (mis. kelas terkait)
                showError(err.message ?? 'Gagal menghapus program.');
                btn.disabled = false;
            }
        });
    });
}

const STEP_RENDERERS = {
    1: renderStep1,
    2: renderStep2,
    3: renderStep3,
    4: renderImportStep,
    5: renderImportStep,
    6: renderImportStep,
    7: renderImportStep,
    8: renderImportStep,
    9: renderStep9,
};

// ─────────────────────────────────────────────────────────────
// STEP SAVE / VALIDATE
// ─────────────────────────────────────────────────────────────

/**
 * Validasi + simpan langkah aktif. Throw Error (pesan user-facing)
 * jika gagal. Resolve tanpa nilai jika sukses.
 */
async function saveCurrentStep() {
    switch (state.currentStep) {
        case 1: return saveStep1();
        case 2: return saveStep2();
        case 3: return saveStep3();
        // Langkah 4–8 berbasis impor: data tersimpan langsung saat unggah,
        // dan langkah-langkah ini opsional (boleh dilewati / dilanjutkan dari dashboard).
        case 4: case 5: case 6: case 7: case 8: return;
        default: throw new Error('Langkah ini belum tersedia. Gunakan tombol Sebelumnya untuk kembali.');
    }
}

async function saveStep1() {
    const schoolName = document.getElementById('wz-school-name').value.trim();
    const address    = document.getElementById('wz-address').value.trim();

    if (!schoolName) throw new Error('Nama sekolah wajib diisi.');
    if (!address)    throw new Error('Alamat wajib diisi.');

    await upsertSchoolConfig({ school_name: schoolName, address });

    state.data.schoolName = schoolName;
    state.data.address    = address;
}

async function saveStep2() {
    const academicYear = document.getElementById('wz-academic-year').value.trim();
    const semesterEl   = document.querySelector('input[name="wz-semester"]:checked');
    const startDate    = document.getElementById('wz-start-date').value;
    const endDate      = document.getElementById('wz-end-date').value;

    if (!/^\d{4}\/\d{4}$/.test(academicYear)) {
        throw new Error('Format tahun ajaran harus YYYY/YYYY (contoh: 2026/2027).');
    }
    if (!semesterEl)            throw new Error('Pilih semester (Ganjil atau Genap).');
    if (!startDate)             throw new Error('Tanggal mulai wajib diisi.');
    if (!endDate)               throw new Error('Tanggal selesai wajib diisi.');
    if (endDate <= startDate)   throw new Error('Tanggal selesai harus setelah tanggal mulai.');

    const semester = semesterEl.value; // '1' | '2'

    // INSERT/UPSERT academic_periods — belum ada helper di api.js,
    // jadi pakai client langsung. uq_academic_period UNIQUE
    // (academic_year, semester) jadi target ON CONFLICT.
    const { error: periodErr } = await supabase
        .from('academic_periods')
        .upsert(
            {
                academic_year: academicYear,
                semester,
                start_date:    startDate,
                end_date:      endDate,
                status:        'ACTIVE',
            },
            { onConflict: 'academic_year,semester' },
        );
    if (periodErr) throw new Error(periodErr.message);

    // UPDATE school_config: tandai periode aktif
    await upsertSchoolConfig({
        current_academic_year: academicYear,
        current_semester:      semester,
    });

    state.data.academicYear = academicYear;
    state.data.semester     = semester;
    state.data.startDate    = startDate;
    state.data.endDate      = endDate;
}

async function saveStep3() {
    // Program disimpan real-time per item; di sini cukup validasi count dari DB.
    const programs = await getPrograms();
    if (programs.length === 0) {
        throw new Error('Tambahkan minimal satu Program Keahlian.');
    }
}

async function finishSetup() {
    await markSetupCompleted(); // upsert school_config setup_completed = true
    window.location.href = 'dashboard.html';
}

// ─────────────────────────────────────────────────────────────
// BUTTON WIRING
// ─────────────────────────────────────────────────────────────

async function withLoading(fn) {
    nextBtn.disabled = true;
    prevBtn.disabled = true;
    const prevLabel = nextBtn.textContent;
    nextBtn.textContent = 'Menyimpan…';
    try {
        await fn();
    } finally {
        nextBtn.textContent = prevLabel;
        syncFooter(); // pulihkan state disabled prev sesuai langkah
    }
}

nextBtn.addEventListener('click', async () => {
    clearError();

    if (state.currentStep === TOTAL_STEPS) {
        await withLoading(async () => {
            try {
                await finishSetup();
            } catch (err) {
                showError(err.message ?? 'Gagal menyelesaikan setup.');
                nextBtn.disabled = false; // pulihkan: gagal, izinkan coba lagi
            }
        });
        return;
    }

    await withLoading(async () => {
        try {
            await saveCurrentStep();
        } catch (err) {
            showError(err.message ?? 'Terjadi kesalahan. Coba lagi.');
            nextBtn.disabled = false; // pulihkan: validasi gagal, izinkan coba lagi
            return;
        }
        markDone(state.currentStep);
        await goToStep(state.currentStep + 1);
    });
});

prevBtn.addEventListener('click', async () => {
    if (state.currentStep === 1) return;
    await goToStep(state.currentStep - 1);
});

// Klik item sidebar — hanya ke langkah yang sudah selesai
document.getElementById('wizard-steps').addEventListener('click', async (e) => {
    const item = e.target.closest('.wz-step-item');
    if (!item) return;
    const step = Number(item.dataset.step);
    if (!state.completedSteps.has(step)) return;
    await goToStep(step);
});

// ─────────────────────────────────────────────────────────────
// SMALL UTILS
// ─────────────────────────────────────────────────────────────

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────
// CSV TEMPLATES (unduh contoh format per langkah)
// ─────────────────────────────────────────────────────────────

// Kolom HARUS sama persis dengan kontrak edge function bulk-import-*.
// role_type untuk Guru (5) & Wali Kelas (7) disuntik client-side
// (lihat importFnForStep), jadi tidak ada di template.
const EXCEL_TEMPLATES = {
    3: { filename: 'template_program_keahlian.xlsx',
         headers: ['kode', 'nama'],
         exampleRows: [
             ['TKJ', 'Teknik Komputer dan Jaringan'],
             ['AKL', 'Akuntansi dan Keuangan Lembaga'],
         ] },
    4: { filename: 'template_kelas.xlsx',
         headers: ['nama_kelas', 'kode_program', 'tingkat'],
         exampleRows: [
             ['X TKJ 1', 'TKJ', '10'],
             ['XI AKL 1', 'AKL', '11'],
         ] },
    5: { filename: 'template_guru.xlsx',
         headers: ['nama', 'nip_atau_nik'],
         exampleRows: [
             ['Budi Santoso', '198501012010011001'],
             ['Sari Dewi', '198703022011012002'],
         ] },
    6: { filename: 'template_siswa.xlsx',
         headers: ['nama', 'nis', 'kode_program', 'class_name'],
         exampleRows: [
             ['Ani Rahayu', '2024001', 'TKJ', 'X TKJ 1'],
             ['Doni Pratama', '2024002', 'AKL', 'XI AKL 1'],
         ] },
    7: { filename: 'template_wali_kelas.xlsx',
         headers: ['nama', 'nip_atau_nik', 'nama_kelas'],
         exampleRows: [
             ['Budi Santoso', '198501012010011001', 'X TKJ 1'],
         ] },
    8: { filename: 'template_jadwal.xlsx',
         headers: ['hari', 'start_time', 'end_time', 'kelas', 'kode_guru', 'kode_mapel'],
         exampleRows: [
             ['Senin', '07:00', '08:30', 'X TKJ 1', 'BS', 'MTK'],
         ] },
};

/** HTML tombol unduh template untuk langkah tertentu (kosong jika tak ada config). */
function templateButtonHtml(step) {
    if (!EXCEL_TEMPLATES[step]) return '';
    return `<button type="button" class="btn btn-secondary wz-template-btn" style="margin-bottom:16px">↓ Unduh Template Excel</button>`;
}

/** Pasang handler unduh ke tombol template langkah aktif (jika ada). */
function wireTemplateButton(step) {
    const cfg = EXCEL_TEMPLATES[step];
    if (!cfg) return;
    const btn = contentEl.querySelector('.wz-template-btn');
    if (btn) {
        btn.addEventListener('click', () =>
            generateExcelTemplate(cfg.filename, cfg.headers, cfg.exampleRows));
    }
}

/** Generate file Excel (.xlsx) dari headers + exampleRows via SheetJS,
 *  lalu trigger unduhan di browser. Membutuhkan global XLSX (CDN). */
function generateExcelTemplate(filename, headers, exampleRows) {
    if (typeof XLSX === 'undefined') {
        showError('Fitur unduh template membutuhkan koneksi internet.');
        return;
    }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, filename);
}

// ─────────────────────────────────────────────────────────────
// BULK IMPORT (unggah Excel/CSV → edge function)
// ─────────────────────────────────────────────────────────────

const IMPORT_STEP_INFO = {
    4: { title: 'Kelas & Rombel',
         desc: 'Impor daftar kelas. Program keahlian (Langkah 3) dan tahun ajaran aktif harus sudah ada — tahun ajaran diambil otomatis dari konfigurasi sekolah.' },
    5: { title: 'Guru',
         desc: 'Impor akun guru. NIP/NIK menjadi identitas login dan setiap baris otomatis berperan sebagai GURU.' },
    6: { title: 'Siswa',
         desc: 'Impor data siswa sekaligus penempatan kelas. Program & kelas harus sudah ada; tahun ajaran & semester diambil otomatis.' },
    7: { title: 'Wali Kelas',
         desc: 'Daftarkan akun wali kelas dan tautkan ke kelasnya. Kelas (Langkah 4) harus sudah ada. Gunakan NIP/NIK yang belum dipakai akun lain.' },
    8: { title: 'Jadwal',
         desc: 'Impor jadwal mengajar mingguan. Nama kelas, kode guru, dan kode mata pelajaran harus sudah terdaftar di sistem.' },
};

/** Fungsi impor (edge function) untuk tiap langkah. Guru & Wali Kelas
 *  menyuntikkan role_type karena perannya sudah tersirat dari langkah. */
function importFnForStep(step) {
    switch (step) {
        case 3: return importPrograms;
        case 4: return importClasses;
        case 5: return (csv) => importUsers(injectColumn(csv, 'role_type', 'GURU'));
        case 6: return importStudents;
        case 7: return (csv) => importUsers(injectColumn(csv, 'role_type', 'WALI_KELAS'));
        case 8: return importSchedules;
        default: throw new Error(`Tidak ada importer untuk langkah ${step}`);
    }
}

/** Tambah satu kolom konstan ke setiap baris data CSV (mis. role_type).
 *  Hanya menempel kolom di akhir tiap baris, jadi aman terhadap quoting. */
function injectColumn(csvText, columnName, value) {
    const lines = csvText.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return csvText;
    const header = `${lines[0]},${columnName}`;
    const dataLines = lines.slice(1).map(line => `${line},${value}`);
    return [header, ...dataLines].join('\r\n');
}

/** Baca file unggahan (.xlsx/.xls/.csv) menjadi teks CSV.
 *  Excel dikonversi via SheetJS (global XLSX dari CDN di wizard.html). */
async function fileToCsv(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        if (typeof XLSX === 'undefined') {
            throw new Error('Pustaka Excel gagal dimuat. Periksa koneksi internet, atau unggah file CSV.');
        }
        const buf = await file.arrayBuffer();
        const wb  = XLSX.read(buf, { type: 'array' });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        return XLSX.utils.sheet_to_csv(ws);
    }
    return await file.text();
}

/** Buang baris yang seluruh selnya kosong (sisa baris kosong di Excel). */
function stripEmptyCsvLines(csv) {
    return csv
        .split(/\r\n|\n|\r/)
        .filter(line => line.split(',').some(cell => cell.trim().length > 0))
        .join('\r\n');
}

/** HTML blok unggah: input file + tombol impor + area hasil. */
function importBlockHtml(step) {
    const headers = EXCEL_TEMPLATES[step]?.headers ?? [];
    return `
        <div class="wz-import">
            <p class="hint">Kolom yang diharapkan: <code>${headers.join(', ')}</code></p>
            <input type="file" class="input wz-file-input" accept=".xlsx,.xls,.csv"
                style="padding:8px; margin-bottom:12px" />
            <button type="button" class="btn btn-primary wz-import-btn" disabled>Unggah &amp; Impor</button>
            <div class="wz-import-result" style="margin-top:16px"></div>
        </div>
    `;
}

/** Pasang handler unggah+impor pada blok yang dirender importBlockHtml. */
function wireImportBlock(step, { importFn, onDone } = {}) {
    const fn        = importFn ?? importFnForStep(step);
    const fileInput = contentEl.querySelector('.wz-file-input');
    const importBtn = contentEl.querySelector('.wz-import-btn');
    const resultEl  = contentEl.querySelector('.wz-import-result');
    if (!fileInput || !importBtn || !resultEl) return;

    let csvText = null;

    function resetImportBtn() {
        importBtn.disabled = !csvText;
        importBtn.textContent = 'Unggah & Impor';
        importBtn.classList.remove('btn-success');
        importBtn.classList.add('btn-primary');
    }

    fileInput.addEventListener('change', async () => {
        resultEl.innerHTML = '';
        const file = fileInput.files?.[0];
        if (!file) { csvText = null; resetImportBtn(); return; }
        try {
            csvText = stripEmptyCsvLines(await fileToCsv(file));
            if (!csvText.trim()) throw new Error('File kosong atau tidak ada baris data.');
            resetImportBtn();
        } catch (err) {
            csvText = null;
            resetImportBtn();
            resultEl.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message ?? 'Gagal membaca file.')}</div>`;
        }
    });

    importBtn.addEventListener('click', async () => {
        if (!csvText) return;
        importBtn.disabled = true;
        importBtn.textContent = 'Mengimpor…';
        resultEl.innerHTML = '';
        try {
            const result = await fn(csvText);
            renderImportResult(resultEl, result);
            const changed = (result?.success ?? 0) > 0 || (result?.updated ?? 0) > 0;
            if (changed) {
                importBtn.textContent = '✓ Impor Selesai';
                importBtn.classList.remove('btn-primary');
                importBtn.classList.add('btn-success');
                importBtn.disabled = true; // cegah submit ganda; pilih file lain untuk impor lagi
            } else {
                resetImportBtn();
            }
            if (onDone) await onDone(result);
        } catch (err) {
            resultEl.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message ?? 'Impor gagal.')}</div>`;
            resetImportBtn();
        }
    });
}

/** Render ringkasan + tabel error/konflik hasil impor. */
function renderImportResult(el, result) {
    const { total = 0, success = 0, updated = 0, failed = 0, errors = [], conflicts = [] } = result ?? {};
    const problems = [...errors, ...conflicts];
    const allGood  = failed === 0 && problems.length === 0;

    const summary = `Total ${total} baris — berhasil ${success}` +
        (updated ? `, diperbarui ${updated}` : '') +
        `, gagal ${failed}` +
        (conflicts.length ? `, konflik ${conflicts.length}` : '') + '.';

    let html = `<div class="alert ${allGood ? 'alert-success' : 'alert-warning'}">${escapeHtml(summary)}</div>`;
    if (problems.length) {
        html += `
            <table class="table">
                <thead><tr><th style="width:64px">Baris</th><th>Pesan</th></tr></thead>
                <tbody>${problems.map(e => `<tr><td>${e.row ?? '-'}</td><td>${escapeHtml(e.message ?? '')}</td></tr>`).join('')}</tbody>
            </table>`;
    }
    el.innerHTML = html;
}

/** Renderer generik untuk langkah berbasis impor (4–8). */
async function renderImportStep() {
    const step = state.currentStep;
    const info = IMPORT_STEP_INFO[step] ?? { title: STEP_NAMES[step], desc: '' };

    contentEl.innerHTML = `
        <div class="step-label">Langkah ${step} dari ${TOTAL_STEPS}</div>
        <h3>${info.title}</h3>
        <p class="hint">${info.desc}</p>
        ${templateButtonHtml(step)}
        ${importBlockHtml(step)}
    `;
    wireTemplateButton(step);
    wireImportBlock(step);

    // Langkah impor bersifat opsional — boleh dilanjutkan tanpa unggah.
    nextBtn.disabled = false;
}

// ─────────────────────────────────────────────────────────────
// INIT (auth guard + render langkah 1)
// ─────────────────────────────────────────────────────────────

(async function init() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) { window.location.href = 'index.html'; return; }

    const userRow = await getCurrentUserRow();
    if (!requireAdministrativeOrRedirect(userRow)) return;

    // Tombol logout di header — di-wire lebih awal agar tetap berfungsi
    // bahkan saat wizard terblokir oleh modal ganti password.
    const logoutBtn = document.getElementById('wizard-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            logoutBtn.disabled = true;
            logoutBtn.textContent = 'Keluar...';
            try {
                await logout();
            } catch (_) {
                // signOut gagal pun session lokal tetap dihapus oleh Supabase client
            } finally {
                window.location.replace('index.html');
            }
        });
    }

    // Cek apakah password default sudah diganti
    let config = null;
    try { config = await getSchoolConfig(); } catch (_) { config = null; }

    if (!config?.password_changed) {
        // Tampilkan modal — blokir wizard sampai password diganti
        const modal       = document.getElementById('password-modal');
        const newPassEl   = document.getElementById('modal-new-password');
        const confirmEl   = document.getElementById('modal-confirm-password');
        const submitBtn   = document.getElementById('modal-submit-btn');
        const modalErrEl  = document.getElementById('password-modal-error');

        modal.style.display = 'flex';

        submitBtn.addEventListener('click', async () => {
            const newPass     = newPassEl.value;
            const confirmPass = confirmEl.value;

            // Reset error
            modalErrEl.style.display = 'none';
            modalErrEl.textContent = '';

            // Validasi
            if (newPass.length < 8) {
                modalErrEl.textContent = 'Password minimal 8 karakter.';
                modalErrEl.style.display = 'block';
                return;
            }
            if (newPass === 'Admin1234') {
                modalErrEl.textContent = 'Password tidak boleh sama dengan password default.';
                modalErrEl.style.display = 'block';
                return;
            }
            if (newPass !== confirmPass) {
                modalErrEl.textContent = 'Konfirmasi password tidak cocok.';
                modalErrEl.style.display = 'block';
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Menyimpan...';

            try {
                await changePassword(newPass);
                modal.style.display = 'none';
                await goToStep(1);
            } catch (err) {
                modalErrEl.textContent = err.message ?? 'Gagal menyimpan password. Coba lagi.';
                modalErrEl.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Simpan Password';
            }
        });

        // Jangan panggil goToStep — wizard tetap terblokir sampai modal selesai
        return;
    }

    await goToStep(1);
})();
