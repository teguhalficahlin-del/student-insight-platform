/**
 * @file admin/js/wizard.js
 *
 * Controller untuk admin/wizard.html — wizard onboarding 10 langkah.
 * Step 1–2 (Profil & Tahun Ajaran) form manual; Step 3 (Program) form
 * manual + impor; Step 4–9 berbasis impor Excel/CSV (Kelas, Guru, Siswa,
 * Orang Tua, DUDI, Jadwal); Step 10 ringkasan + tombol "Buka Dashboard".
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
    getPrograms, getClasses, deleteBulk, changePassword,
    fetchAllRows,
    updateProgram, updateClass, updateStudent, updateUserIdentifier,
    importPrograms, importClasses, importUsers, importStudents, importSchedules,
    importParents, importDudi,
    logout,
} from './api.js';

import { openScheduleBuilder } from './schedule-builder.js';

const TOTAL_STEPS = 11;

const STEP_NAMES = {
    1: 'Profil Sekolah',
    2: 'Tahun Ajaran',
    3: 'Program Keahlian',
    4: 'Kelas & Rombel',
    5: 'Staf & Peran',
    6: 'Siswa',
    7: 'Orang Tua',
    8: 'DUDI',
    9: 'Stakeholder',
    10: 'Jadwal',
    11: 'Selesai',
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

function showSuccess(msg) {
    errorEl.textContent = msg;
    errorEl.className = 'alert alert-success';
    errorEl.style.display = 'block';
    setTimeout(() => {
        errorEl.style.display = 'none';
        errorEl.className = 'alert alert-danger';
    }, 5000);
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

async function renderSummaryStep() {
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
    const incomplete = [];
    for (let i = 1; i < TOTAL_STEPS; i++) {
        if (!state.completedSteps.has(i)) incomplete.push(STEP_NAMES[i]);
    }
    const warningHtml = incomplete.length > 0
        ? `<div class="alert alert-warning">Langkah belum selesai: ${incomplete.join(', ')}. Anda tetap bisa melanjutkan, tapi sebaiknya selesaikan semua langkah agar platform berfungsi penuh.</div>`
        : '';

    contentEl.innerHTML = `
        <div class="step-label">Langkah ${TOTAL_STEPS} dari ${TOTAL_STEPS}</div>
        <h3>Selesai</h3>
        <p>Tinjau status setiap langkah sebelum membuka dashboard.</p>
        ${warningHtml}
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
        <p class="hint">Impor program keahlian (jurusan) yang ada di sekolah Anda. Lihat sheet PETUNJUK di template untuk panduan pengisian.</p>
        ${templateButtonHtml(3)}
        <div id="wz-data-list"></div>

        <hr style="margin:24px 0;border:none;border-top:1px solid var(--color-border)" />
        <h4 style="margin:0 0 8px">Impor dari file</h4>
        ${importBlockHtml(3)}
    `;

    wireTemplateButton(3);
    wireImportBlock(3, { onDone: () => refreshDataList(3) });
    await refreshDataList(3);

    nextBtn.disabled = programs.length < 1;
}

async function renderStakeholderStep() {
    contentEl.innerHTML = `
        <div class="step-label">Langkah 9 dari ${TOTAL_STEPS}</div>
        <h3>Stakeholder</h3>
        <p class="hint">Tambahkan akun stakeholder (komite sekolah, dinas pendidikan, dll). Stakeholder hanya bisa melihat ringkasan data sekolah, tidak bisa mengubah apa pun. Login menggunakan kode khusus yang Anda tentukan.</p>

        <div id="wz-data-list"><p class="hint">Memuat data…</p></div>

        <hr style="margin:24px 0;border:none;border-top:1px solid var(--color-border)" />
        <h4 style="margin:0 0 12px">Tambah Stakeholder</h4>
        <div class="field">
            <label for="wz-sh-name">Nama</label>
            <input type="text" id="wz-sh-name" class="input" placeholder="contoh: Komite Sekolah" />
        </div>
        <div class="field">
            <label for="wz-sh-code">Kode Login</label>
            <input type="text" id="wz-sh-code" class="input" maxlength="50" placeholder="contoh: KOMITE01" />
            <p class="hint">Kode unik untuk login. Akan otomatis menjadi huruf besar.</p>
        </div>
        <button type="button" class="btn btn-primary" id="wz-sh-add">Tambah</button>
    `;

    const codeInput = document.getElementById('wz-sh-code');
    codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase(); });

    document.getElementById('wz-sh-add').addEventListener('click', async () => {
        clearError();
        const nameEl = document.getElementById('wz-sh-name');
        const codeEl = document.getElementById('wz-sh-code');
        const name = nameEl.value.trim();
        const code = codeEl.value.trim().toUpperCase();

        if (!name) { showError('Nama stakeholder wajib diisi.'); return; }
        if (!code) { showError('Kode login wajib diisi.'); return; }

        const addBtn = document.getElementById('wz-sh-add');
        addBtn.disabled = true;
        addBtn.textContent = 'Menyimpan…';
        try {
            const csv = `nama,nip_atau_nik,role_type\n${name},${code},STAKEHOLDER`;
            await importUsers(csv);
            nameEl.value = '';
            codeEl.value = '';
            await refreshDataList(9);
        } catch (err) {
            showError(err.message ?? 'Gagal menambah stakeholder.');
        } finally {
            addBtn.disabled = false;
            addBtn.textContent = 'Tambah';
        }
    });

    await refreshDataList(9);
    nextBtn.disabled = false;
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
    9: renderStakeholderStep,
    10: renderImportStep,
    11: renderSummaryStep,
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
        // Langkah 4–9 berbasis impor: data tersimpan langsung saat unggah,
        // dan langkah-langkah ini opsional (boleh dilewati / dilanjutkan dari dashboard).
        case 4: case 5: case 6: case 7: case 8: case 9: case 10: return;
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
// role_type untuk Guru (5) disuntik client-side (lihat importFnForStep),
// jadi tidak ada di template.
const EXCEL_TEMPLATES = {
    3: { filename: 'template_program_keahlian.xlsx',
         headers: ['kode', 'nama'],
         exampleRows: [
             ['TKJ', 'Teknik Komputer dan Jaringan'],
             ['AKL', 'Akuntansi dan Keuangan Lembaga'],
         ],
         guide: [
             ['Kolom', 'Wajib?', 'Penjelasan'],
             ['kode', 'Wajib', 'Kode singkat program keahlian (maks 20 karakter). Contoh: TKJ, AKL, RPL. Harus unik.'],
             ['nama', 'Wajib', 'Nama lengkap program keahlian. Contoh: Teknik Komputer dan Jaringan.'],
             ['', '', ''],
             ['CATATAN', '', ''],
             ['1.', '', 'Upload ulang file akan memperbarui nama program. Kode yang sudah ada tidak akan diduplikasi.'],
             ['2.', '', 'Jika kode program salah ketik, gunakan tombol edit (✎) di wizard atau hapus lalu impor ulang.'],
         ] },
    4: { filename: 'template_kelas.xlsx',
         headers: ['nama_kelas', 'kode_program', 'tingkat'],
         exampleRows: [
             ['X TKJ 1', 'TKJ', '10'],
             ['XI AKL 1', 'AKL', '11'],
         ],
         guide: [
             ['Kolom', 'Wajib?', 'Penjelasan'],
             ['nama_kelas', 'Wajib', 'Nama kelas lengkap. Contoh: X TKJ 1, XI AKL 2. Harus unik per tahun ajaran.'],
             ['kode_program', 'Wajib', 'Kode program keahlian (harus sudah ada di langkah 3). Contoh: TKJ, AKL.'],
             ['tingkat', 'Wajib', 'Tingkat kelas: 10 (X), 11 (XI), atau 12 (XII).'],
             ['', '', ''],
             ['CATATAN', '', ''],
             ['1.', '', 'Upload ulang file akan memperbarui program dan tingkat. Nama kelas yang sudah ada tidak akan diduplikasi.'],
             ['2.', '', 'Jika nama kelas salah ketik, gunakan tombol edit (✎) di wizard atau hapus lalu impor ulang.'],
             ['3.', '', 'Tahun ajaran diambil otomatis dari konfigurasi sekolah.'],
         ] },
    5: { filename: 'template_staf.xlsx',
         headers: ['nama', 'nip_atau_nik', 'mengajar', 'teacher_code', 'wali_kelas', 'program_kaprodi', 'jabatan'],
         exampleRows: [
             ['Budi Santoso, S.Pd', '198501012010011001', 'YA', 'BSS', '', '', ''],
             ['Ririn Novianti, S.Pd', '198812052015032001', 'YA', 'RRN', 'XII TKJ 1', '', ''],
             ['Supriadi, M.Pd', '197706152003011005', 'YA', 'SPR', '', 'TKJ', ''],
             ['Ahmad Fauzi, M.Pd', '196811051994031005', '', '', '', '', 'KEPSEK'],
             ['Susi Marlina, S.Pd', '198501032010012003', '', '', '', '', 'WAKA_KURIKULUM'],
             ['Dewi Lestari, S.Pd', '198903152012032001', 'YA', 'DWL', '', '', 'BK'],
         ],
         guide: [
             ['Kolom', 'Wajib?', 'Penjelasan'],
             ['nama', 'Wajib', 'Nama lengkap beserta gelar'],
             ['nip_atau_nik', 'Wajib', 'NIP atau NIK — menjadi identitas login. Harus unik.'],
             ['mengajar', 'Opsional', 'Isi YA jika staf ini mengajar. Kosongkan jika tidak mengajar (misal Kepsek, BK murni).'],
             ['teacher_code', 'Opsional', 'Kode guru untuk jadwal (maks 20 karakter). Wajib jika mengajar=YA. Kosongkan untuk auto-generate dari inisial nama.'],
             ['wali_kelas', 'Opsional', 'Nama kelas yang diwalikan. Contoh: XII TKJ 1. Harus sesuai dengan data di langkah Kelas.'],
             ['program_kaprodi', 'Opsional', 'Kode program keahlian jika staf ini Kaprodi. Contoh: TKJ. Harus sesuai data di langkah Program.'],
             ['jabatan', 'Opsional', 'Jabatan tambahan, pisahkan dengan koma. Nilai yang valid: BK, KEPSEK, WAKA_KURIKULUM, WAKA_KESISWAAN, WAKA_HUMAS'],
             ['', '', ''],
             ['CATATAN', '', ''],
             ['1.', '', 'Staf yang mengajar (mengajar=YA) otomatis berperan sebagai GURU dan muncul di jadwal.'],
             ['2.', '', 'Staf yang tidak mengajar tetap bisa login dan mengakses fitur sesuai jabatannya.'],
             ['3.', '', 'Satu staf bisa rangkap jabatan. Contoh: guru yang juga BK, isi mengajar=YA dan jabatan=BK.'],
             ['4.', '', 'Upload ulang file akan memperbarui nama, kode, dan jabatan. Jika NIP salah ketik, hapus terlebih dahulu.'],
         ] },
    6: { filename: 'template_siswa.xlsx',
         headers: ['nama', 'nis', 'kode_program', 'class_name'],
         exampleRows: [
             ['Ani Rahayu', '2024001', 'TKJ', 'X TKJ 1'],
             ['Doni Pratama', '2024002', 'AKL', 'XI AKL 1'],
         ],
         guide: [
             ['Kolom', 'Wajib?', 'Penjelasan'],
             ['nama', 'Wajib', 'Nama lengkap siswa.'],
             ['nis', 'Wajib', 'Nomor Induk Siswa. Harus unik. Format sebagai teks agar angka 0 di depan tidak hilang.'],
             ['kode_program', 'Wajib', 'Kode program keahlian (harus sudah ada di langkah 3). Contoh: TKJ, AKL.'],
             ['class_name', 'Wajib', 'Nama kelas (harus sudah ada di langkah 4). Contoh: X TKJ 1.'],
             ['', '', ''],
             ['CATATAN', '', ''],
             ['1.', '', 'Upload ulang file akan memperbarui nama, program, dan kelas. NIS yang sudah ada tidak akan diduplikasi.'],
             ['2.', '', 'Jika NIS salah ketik, hapus siswa tersebut terlebih dahulu lalu impor ulang.'],
             ['3.', '', 'Tahun ajaran dan semester diambil otomatis dari konfigurasi sekolah.'],
         ] },
    7: { filename: 'template_orang_tua.xlsx',
         headers: ['nama_ortu', 'nik', 'nis_siswa'],
         exampleRows: [
             ['Bambang Wijaya', '3201012003800001', '2024001'],
             ['Bambang Wijaya', '3201012003800001', '2024002'],
         ],
         guide: [
             ['Kolom', 'Wajib?', 'Penjelasan'],
             ['nama_ortu', 'Wajib', 'Nama lengkap orang tua/wali.'],
             ['nik', 'Wajib', 'NIK orang tua — menjadi identitas login di Portal Orang Tua. Format sebagai teks.'],
             ['nis_siswa', 'Wajib', 'NIS anak (harus sudah ada di langkah 6). Satu orang tua bisa ditautkan ke beberapa anak.'],
             ['', '', ''],
             ['CATATAN', '', ''],
             ['1.', '', 'Satu orang tua dengan beberapa anak: tulis NIK yang sama di beberapa baris dengan NIS berbeda.'],
             ['2.', '', 'Orang tua login di Portal Orang Tua dengan NIK + password untuk melihat data anak.'],
             ['3.', '', 'Upload ulang file akan memperbarui nama. Jika NIK salah ketik, hapus lalu impor ulang.'],
         ] },
    8: { filename: 'template_dudi.xlsx',
         headers: ['nama_usaha', 'nama_penanggung_jawab'],
         exampleRows: [
             ['PT Mitra Teknologi Nusantara', 'Hendra Setiawan'],
             ['CV Karya Mandiri Elektronik', 'Yulia Permatasari'],
         ],
         guide: [
             ['Kolom', 'Wajib?', 'Penjelasan'],
             ['nama_usaha', 'Wajib', 'Nama lengkap usaha/perusahaan mitra PKL. Menjadi identitas login (di-slugifikasi).'],
             ['nama_penanggung_jawab', 'Wajib', 'Nama penanggung jawab dari pihak DUDI.'],
             ['', '', ''],
             ['CATATAN', '', ''],
             ['1.', '', 'DUDI login menggunakan nama usaha (bukan NIK). Sistem otomatis membuat slug dari nama usaha.'],
             ['2.', '', 'Upload ulang file akan memperbarui nama usaha dan penanggung jawab.'],
         ] },
    10: { filename: 'template_jadwal.xlsx',
          headers: ['nama_guru', 'nama_kelas', 'hari', 'start_time', 'end_time'],
          exampleRows: [
              ['Budi Santoso', 'X TKJ 1', 'Senin', '07:00', '08:30'],
              ['Budi Santoso', 'X TKJ 1', 'Senin', '08:30', '10:00'],
          ],
          guide: [
              ['Kolom', 'Wajib?', 'Penjelasan'],
              ['nama_guru', 'Wajib', 'Nama lengkap guru (harus sudah ada di langkah 5).'],
              ['nama_kelas', 'Wajib', 'Nama kelas (harus sudah ada di langkah 4). Contoh: X TKJ 1.'],
              ['hari', 'Wajib', 'Hari mengajar. Nilai valid: Senin, Selasa, Rabu, Kamis, Jumat, Sabtu.'],
              ['start_time', 'Wajib', 'Jam mulai (format HH:MM). Contoh: 07:00, 08:30.'],
              ['end_time', 'Wajib', 'Jam selesai (format HH:MM). Harus lebih besar dari start_time.'],
              ['', '', ''],
              ['CATATAN', '', ''],
              ['1.', '', 'Satu guru tidak boleh mengajar di kelas berbeda pada waktu yang tumpang-tindih.'],
              ['2.', '', 'Baris yang bentrok akan ditolak dan dilaporkan.'],
              ['3.', '', 'Alternatif: gunakan tombol "Susun Jadwal Visual" untuk menyusun jadwal secara visual.'],
          ] },
};

/** HTML tombol unduh template untuk langkah tertentu (kosong jika tak ada config). */
function templateButtonHtml(step) {
    if (!EXCEL_TEMPLATES[step]) return '';
    return `<button type="button" class="btn btn-primary wz-template-btn" style="margin-bottom:16px">↓ Unduh Template Excel</button>`;
}

/** Pasang handler unduh ke tombol template langkah aktif (jika ada). */
function wireTemplateButton(step) {
    const cfg = EXCEL_TEMPLATES[step];
    if (!cfg) return;
    const btn = contentEl.querySelector('.wz-template-btn');
    if (btn) {
        btn.addEventListener('click', () =>
            generateExcelTemplate(cfg.filename, cfg.headers, cfg.exampleRows, cfg.guide));
    }
}

/** Generate file Excel (.xlsx) dari headers + exampleRows via SheetJS,
 *  lalu trigger unduhan di browser. Membutuhkan global XLSX (CDN). */
function generateExcelTemplate(filename, headers, exampleRows, guide) {
    if (typeof XLSX === 'undefined') {
        showError('Fitur unduh template membutuhkan koneksi internet.');
        return;
    }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows]);

    const PAD_ROWS = 300;
    const ncols = headers.length;
    for (let R = 0; R <= PAD_ROWS; R++) {
        for (let C = 0; C < ncols; C++) {
            const addr = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = ws[addr] ?? { t: 's', v: '' };
            cell.t = 's';
            cell.z = '@';
            ws[addr] = cell;
        }
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: PAD_ROWS, c: ncols - 1 } });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DATA');

    if (guide) {
        const gsw = XLSX.utils.aoa_to_sheet(guide);
        XLSX.utils.book_append_sheet(wb, gsw, 'PETUNJUK');
    }

    XLSX.writeFile(wb, filename);
}

// ─────────────────────────────────────────────────────────────
// BULK IMPORT (unggah Excel/CSV → edge function)
// ─────────────────────────────────────────────────────────────

const IMPORT_STEP_INFO = {
    4: { title: 'Kelas & Rombel',
         desc: 'Impor daftar kelas. Program keahlian (langkah 3) harus sudah ada. Lihat sheet PETUNJUK di template untuk panduan pengisian.' },
    5: { title: 'Staf & Peran',
         desc: 'Impor semua staf sekolah: guru, BK, wali kelas, kaprodi, kepsek, dan waka. NIP/NIK menjadi identitas login. Lihat sheet PETUNJUK di template untuk panduan pengisian kolom jabatan dan peran.' },
    6: { title: 'Siswa',
         desc: 'Impor data siswa sekaligus penempatan kelas. Program (langkah 3) dan kelas (langkah 4) harus sudah ada. Lihat sheet PETUNJUK di template untuk panduan pengisian.' },
    7: { title: 'Orang Tua',
         desc: 'Impor akun orang tua/wali dan tautkan ke siswanya lewat NIS. Siswa (langkah 6) harus sudah ada. NIK menjadi identitas login di Portal Orang Tua. Lihat sheet PETUNJUK di template untuk panduan pengisian.' },
    8: { title: 'DUDI',
         desc: 'Impor data DUDI (Dunia Usaha/Dunia Industri) mitra PKL. Login memakai nama usaha. Lihat sheet PETUNJUK di template untuk panduan pengisian.' },
    10: { title: 'Jadwal',
          desc: 'Impor jadwal mengajar mingguan, atau gunakan Susun Jadwal Visual. Guru (langkah 5) dan kelas (langkah 4) harus sudah ada. Lihat sheet PETUNJUK di template untuk panduan pengisian.' },
};

/** Fungsi impor (edge function) untuk tiap langkah. Guru menyuntikkan
 *  role_type karena perannya tersirat dari langkah. */
function importFnForStep(step) {
    switch (step) {
        case 3: return importPrograms;
        case 4: return importClasses;
        case 5: return importUsers;
        case 6: return importStudents;
        case 7: return importParents;
        case 8: return importDudi;
        case 10: return importSchedules;
        default: throw new Error(`Tidak ada importer untuk langkah ${step}`);
    }
}

/** Tambah satu kolom konstan ke setiap baris data CSV (mis. role_type).
 *  Hanya menempel kolom di akhir tiap baris, jadi aman terhadap quoting. */
function injectColumn(csvText, columnName, value, defaultOnly = false) {
    const lines = csvText.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return csvText;
    // Kalau kolom sudah ada di header, jangan inject
    if (defaultOnly && lines[0].toLowerCase().includes(columnName.toLowerCase())) return csvText;
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
        stripLeadingApostropheCells(ws);
        return XLSX.utils.sheet_to_csv(ws);
    }
    return stripLeadingApostropheCsv(await file.text());
}

/** Buang tanda kutip satu di awal nilai sel (penanda teks Excel yang
 *  kadang ikut tersimpan), agar NIP/NIS tidak berawalan '. */
function stripLeadingApostropheCells(ws) {
    Object.keys(ws).forEach(addr => {
        if (addr[0] === '!') return;
        const cell = ws[addr];
        if (cell && typeof cell.v === 'string' && cell.v.startsWith("'")) {
            cell.v = cell.v.replace(/^'+/, '');
            delete cell.w; // buang teks ter-cache agar nilai baru yang dipakai
        }
    });
}

/** Versi CSV: hapus ' di awal baris atau tepat setelah pemisah koma. */
function stripLeadingApostropheCsv(text) {
    return text.replace(/(^|,)'+/gm, '$1');
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
    const hasIdentifier = headers.some(h => ['nip_atau_nik', 'nis', 'nik', 'nis_siswa'].includes(h));
    const idTip = hasIdentifier
        ? `<p class="hint" style="margin-top:8px">Jika NIP/NIS panjang berubah jadi angka di Excel, format kolomnya sebagai <b>Teks</b> atau awali dengan tanda kutip satu (<code>'</code>) — tanda itu otomatis dihapus saat impor.</p>`
        : '';
    return `
        <div class="wz-import">
            <p class="hint">Kolom yang diharapkan: <code>${headers.join(', ')}</code></p>
            <input type="file" class="input wz-file-input" accept=".xlsx,.xls,.csv"
                style="padding:8px; margin-bottom:12px" />
            <button type="button" class="btn btn-primary wz-import-btn" disabled>Unggah &amp; Impor</button>
            ${idTip}
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
        fileInput.disabled = true;
        resultEl.innerHTML = '';

        importRunning = true;
        const rowCount = csvText.split(/\r\n|\n|\r/).filter(l => l.trim()).length - 1;
        let dots = 0;
        const ticker = setInterval(() => {
            dots = (dots + 1) % 4;
            importBtn.textContent = `Mengimpor ${rowCount} baris${'.'.repeat(dots)}`;
        }, 400);
        try {
            const result = await fn(csvText);
            clearInterval(ticker);
            renderImportResult(resultEl, result);
            const changed = (result?.success ?? 0) > 0 || (result?.updated ?? 0) > 0;
            if (changed) {
                importBtn.textContent = '✓ Impor Selesai';
                importBtn.classList.remove('btn-primary');
                importBtn.classList.add('btn-success');
                importBtn.disabled = true;
            } else {
                resetImportBtn();
            }
            fileInput.disabled = false;
            importRunning = false;
            if (onDone) await onDone(result);
        } catch (err) {
            clearInterval(ticker);
            resultEl.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message ?? 'Impor gagal.')}</div>`;
            resetImportBtn();
            fileInput.disabled = false;
            importRunning = false;
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
        <div class="wz-data-list" id="wz-data-list"><p class="hint">Memuat data…</p></div>
        <hr style="margin:24px 0;border:none;border-top:1px solid var(--color-border)" />
        <h4 style="margin:0 0 8px">Impor dari file</h4>
        ${importBlockHtml(step)}
    `;
    wireTemplateButton(step);
    wireImportBlock(step, { onDone: () => refreshDataList(step) });
    await refreshDataList(step);

    // Step 10: tombol Susun Jadwal visual
    if (step === 10) {
        const schedBtn = document.createElement('button');
        schedBtn.type = 'button';
        schedBtn.className = 'btn btn-primary';
        schedBtn.style.cssText = 'margin-bottom:16px;padding:10px 20px;font-size:14px';
        schedBtn.textContent = '📋 Susun Jadwal Visual';
        const dataList = contentEl.querySelector('#wz-data-list');
        if (dataList) dataList.before(schedBtn);
        schedBtn.addEventListener('click', () => openScheduleBuilder());
    }

    // Langkah impor bersifat opsional — boleh dilanjutkan tanpa unggah.
    nextBtn.disabled = false;
}

// ── Daftar data terkini per langkah (tampil + hapus) ──────────

const STEP_LIST = {
    3: {
        title: 'Program terdaftar',
        headers: ['Kode', 'Nama Program'],
        deleteTable: 'programs',
        editFields: [
            { key: 'code', label: 'Kode Program' },
            { key: 'name', label: 'Nama Program' },
        ],
        save: (id, vals, oldData) => updateProgram(id, vals, oldData?.code),
        fetch: async () => {
            const data = await getPrograms();
            return data.map(p => ({ id: p.program_id, cells: [p.code, p.name], editData: { code: p.code, name: p.name } }));
        },
    },
    4: {
        title: 'Kelas terdaftar',
        headers: ['Nama Kelas', 'Tingkat'],
        deleteTable: 'classes',
        groupBy: 'group',
        editFields: [
            { key: 'name', label: 'Nama Kelas' },
        ],
        save: (id, vals) => updateClass(id, vals),
        fetch: async () => {
            const [classes, programs] = await Promise.all([getClasses(), getPrograms()]);
            const pm = new Map(programs.map(p => [p.program_id, p.code]));
            const pn = new Map(programs.map(p => [p.program_id, p.name]));
            return classes.map(c => ({
                id: c.class_id,
                cells: [c.name, c.grade_level],
                group: pn.get(c.program_id) ?? '—',
                editData: { name: c.name },
            }));
        },
    },
    5: {
        title: 'Staf terdaftar',
        headers: ['Nama', 'NIP/NIK', 'Kode', 'Jabatan'],
        deleteTable: 'users',
        editFields: [
            { key: 'full_name', label: 'Nama' },
            { key: 'login_identifier', label: 'NIP/NIK' },
            { key: 'teacher_code', label: 'Kode Guru' },
        ],
        save: (id, vals) => updateUserIdentifier(id, vals),
        fetch: async () => {
            const data = await fetchAllRows('users',
                q => q.select('user_id, full_name, login_identifier, teacher_code, role_type, is_bk, is_kepsek, is_waka_kurikulum, is_waka_kesiswaan, wali_kelas_class_id, kaprodi_program_id')
                      .not('role_type', 'in', '("SISWA","ORTU","DUDI","ADMINISTRATIVE")')
                      .order('full_name'));
            return data.map(u => {
                const jabatan = [];
                if (u.role_type === 'GURU') jabatan.push('Guru');
                if (u.wali_kelas_class_id) jabatan.push('Wali Kelas');
                if (u.is_bk) jabatan.push('BK');
                if (u.kaprodi_program_id) jabatan.push('Kaprodi');
                if (u.is_kepsek) jabatan.push('Kepsek');
                if (u.is_waka_kurikulum) jabatan.push('Waka Kurikulum');
                if (u.is_waka_kesiswaan) jabatan.push('Waka Kesiswaan');
                if (u.role_type === 'STAKEHOLDER') jabatan.push('Stakeholder');
                return {
                    id: u.user_id,
                    cells: [u.full_name, u.login_identifier, u.teacher_code ?? '—', jabatan.join(', ') || u.role_type],
                    editData: { full_name: u.full_name, login_identifier: u.login_identifier, teacher_code: u.teacher_code ?? '' },
                };
            });
        },
    },
    6: {
        title: 'Siswa terdaftar',
        headers: ['Nama', 'NIS'],
        deleteTable: 'students',
        nestedGroup: true,
        editFields: [
            { key: 'full_name', label: 'Nama' },
            { key: 'nis', label: 'NIS' },
        ],
        save: (id, vals) => updateStudent(id, vals),
        fetch: async () => {
            const data = await fetchAllRows('students',
                q => q.select(`student_id, full_name, nis,
                    program:programs ( name ),
                    enrollment:class_enrollments ( class:classes ( name ) )
                `).order('full_name'));
            return data.map(s => {
                const enrollments = Array.isArray(s.enrollment) ? s.enrollment : (s.enrollment ? [s.enrollment] : []);
                return {
                    id: s.student_id,
                    cells: [s.full_name, s.nis],
                    editData: { full_name: s.full_name, nis: s.nis },
                    program: s.program?.name ?? 'Tanpa program',
                    kelas: enrollments[0]?.class?.name ?? 'Belum ada kelas',
                };
            });
        },
    },
    7: {
        title: 'Orang Tua terdaftar',
        headers: ['Nama', 'NIK', 'Anak'],
        deleteTable: 'users',
        nestedGroup: true,
        editFields: [
            { key: 'full_name', label: 'Nama' },
            { key: 'login_identifier', label: 'NIK' },
        ],
        save: (id, vals) => updateUserIdentifier(id, vals),
        fetch: async () => {
            const parents = await fetchAllRows('users',
                q => q.select('user_id, full_name, login_identifier')
                      .eq('role_type', 'ORTU')
                      .order('full_name'));
            if (parents.length === 0) return [];

            const links = await fetchAllRows('student_parents',
                q => q.select(`parent_user_id, students ( full_name,
                    program:programs ( name ),
                    enrollment:class_enrollments ( class:classes ( name ) )
                )`));

            const parentChildMap = new Map();
            for (const link of links) {
                const pid = link.parent_user_id;
                if (!parentChildMap.has(pid)) parentChildMap.set(pid, []);
                const enrollments = Array.isArray(link.students?.enrollment) ? link.students.enrollment : (link.students?.enrollment ? [link.students.enrollment] : []);
                parentChildMap.get(pid).push({
                    name: link.students?.full_name,
                    program: link.students?.program?.name ?? 'Tanpa program',
                    kelas: enrollments[0]?.class?.name ?? 'Belum ada kelas',
                });
            }

            return parents.map(u => {
                const children = parentChildMap.get(u.user_id) ?? [];
                const childNames = children.map(c => c.name).join(', ') || '—';
                return {
                    id: u.user_id,
                    cells: [u.full_name, u.login_identifier, childNames],
                    editData: { full_name: u.full_name, login_identifier: u.login_identifier },
                    program: children[0]?.program ?? 'Tanpa program',
                    kelas: children[0]?.kelas ?? 'Belum ada kelas',
                };
            });
        },
    },
    8: {
        title: 'DUDI terdaftar',
        headers: ['Nama Usaha', 'Penanggung Jawab'],
        deleteTable: 'users',
        editFields: [
            { key: 'dudi_org_name', label: 'Nama Usaha' },
            { key: 'full_name', label: 'Penanggung Jawab' },
        ],
        save: (id, vals) => updateUserIdentifier(id, vals),
        fetch: async () => {
            const data = await fetchAllRows('users',
                q => q.select('user_id, full_name, dudi_org_name')
                      .eq('role_type', 'DUDI')
                      .order('dudi_org_name'));
            return data.map(u => ({
                id: u.user_id,
                cells: [u.dudi_org_name ?? '—', u.full_name],
                editData: { dudi_org_name: u.dudi_org_name ?? '', full_name: u.full_name },
            }));
        },
    },
    9: {
        title: 'Stakeholder terdaftar',
        headers: ['Nama', 'Kode Login'],
        deleteTable: 'users',
        editFields: [
            { key: 'full_name', label: 'Nama' },
            { key: 'login_identifier', label: 'Kode Login' },
        ],
        save: (id, vals) => updateUserIdentifier(id, vals),
        fetch: async () => {
            const data = await fetchAllRows('users',
                q => q.select('user_id, full_name, login_identifier')
                      .eq('role_type', 'STAKEHOLDER')
                      .order('full_name'));
            return data.map(u => ({
                id: u.user_id,
                cells: [u.full_name, u.login_identifier],
                editData: { full_name: u.full_name, login_identifier: u.login_identifier },
            }));
        },
    },
    10: {
        title: 'Jadwal terdaftar',
        headers: ['Tanggal', 'Waktu', 'Kelas', 'Guru'],
        deleteTable: 'teaching_schedules',
        fetch: async () => {
            const data = await fetchAllRows('teaching_schedules',
                q => q.select(`
                    schedule_id, session_date, session_start, session_end,
                    class:classes ( name ),
                    teacher:users!teaching_schedules_scheduled_teacher_id_fkey ( full_name )
                `).order('session_date', { ascending: false }));
            return data.map(s => ({
                id: s.schedule_id,
                cells: [
                    s.session_date,
                    `${s.session_start?.slice(0,5)}–${s.session_end?.slice(0,5)}`,
                    s.class?.name ?? '—',
                    s.teacher?.full_name ?? '—',
                ],
            }));
        },
    },
};

/** Ambil users untuk satu role lalu petakan tiap baris ke sel tabel.
 *  Mem-paginasi (fetchAllRows) agar daftar ribuan (mis. ORTU) tidak terpotong
 *  di 1000 dan jumlah yang tampil akurat. */
async function fetchUsersByRole(roleType, toCells, toEditData) {
    const data = await fetchAllRows('users',
        q => q.select('user_id, full_name, login_identifier, teacher_code, wali_kelas_class_id')
              .eq('role_type', roleType)
              .order('full_name'));
    return data.map(u => {
        const row = { id: u.user_id, cells: toCells(u) };
        if (toEditData) row.editData = toEditData(u);
        return row;
    });
}

/** Muat ulang & render daftar data terkini untuk langkah aktif. */
async function refreshDataList(step) {
    const el = contentEl.querySelector('#wz-data-list');
    if (!el) return;
    const cfg = STEP_LIST[step];
    if (!cfg) { el.innerHTML = ''; return; }

    el.innerHTML = '<p class="hint">Memuat data…</p>';
    try {
        const rows = await cfg.fetch();
        el.innerHTML = renderDataTable(cfg, rows);
        wireDataTable(step, cfg);
    } catch (err) {
        el.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message ?? 'Gagal memuat data.')}</div>`;
    }
}

function renderDataTable(cfg, rows) {
    const heading = `<h4 style="margin:0 0 8px">${escapeHtml(cfg.title)} (${rows.length})</h4>`;
    if (!rows.length) {
        return heading + '<p class="hint">Belum ada data. Unggah file di bawah untuk menambahkan.</p>';
    }

    const canDelete = !!cfg.deleteTable;
    const toolbar = canDelete ? `
        <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap">
            <button type="button" class="btn btn-danger wz-del-selected" disabled style="padding:6px 12px">Hapus Terpilih (0)</button>
            <button type="button" class="btn btn-secondary wz-del-all" style="padding:6px 12px">Hapus Semua (${rows.length})</button>
        </div>` : '';

    const allIdsJson = canDelete ? `<script type="application/json" class="wz-all-ids">${JSON.stringify(rows.map(r => r.id))}</script>` : '';

    if (cfg.nestedGroup) {
        return heading + toolbar + renderNestedAccordion(cfg, rows) + allIdsJson;
    }

    if (cfg.groupBy) {
        return heading + toolbar + renderGroupedAccordion(cfg, rows) + allIdsJson;
    }

    const hasEdit = !!cfg.editFields;
    const checkTh = canDelete
        ? '<th style="width:36px"><input type="checkbox" class="wz-check-all" title="Pilih semua" /></th>'
        : '';
    const editTh = hasEdit ? '<th style="width:40px"></th>' : '';
    const head = checkTh + cfg.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('') + editTh;

    const MAX_DISPLAY = 100;
    const displayRows = rows.slice(0, MAX_DISPLAY);
    const body = displayRows.map(r => renderRow(r, canDelete, hasEdit)).join('');

    const truncNote = rows.length > MAX_DISPLAY
        ? `<p class="hint" style="margin-top:8px">Menampilkan ${MAX_DISPLAY} dari ${rows.length} data. Hapus Semua tetap menghapus seluruh ${rows.length} data.</p>`
        : '';

    return heading + toolbar +
        `<table class="table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` + truncNote + allIdsJson;
}

function renderRow(r, canDelete, hasEdit) {
    const checkTd = canDelete
        ? `<td><input type="checkbox" class="wz-check" value="${escapeAttr(r.id)}" /></td>`
        : '';
    const cells = r.cells.map(c => `<td>${escapeHtml(String(c ?? ''))}</td>`).join('');
    const editTd = hasEdit
        ? `<td><button type="button" class="btn btn-secondary wz-edit-btn" data-id="${escapeAttr(r.id)}" data-edit='${escapeAttr(JSON.stringify(r.editData ?? {}))}' style="padding:2px 8px;font-size:12px">✎</button></td>`
        : '';
    return `<tr>${checkTd}${cells}${editTd}</tr>`;
}

function renderGroupedAccordion(cfg, rows) {
    const canDelete = !!cfg.deleteTable;
    const hasEdit = !!cfg.editFields;
    const groups = new Map();
    for (const r of rows) {
        const key = r[cfg.groupBy] ?? '—';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }

    const checkTh = canDelete
        ? '<th style="width:36px"><input type="checkbox" class="wz-group-check-all" title="Pilih semua" /></th>'
        : '';
    const editTh = hasEdit ? '<th style="width:40px"></th>' : '';
    const head = checkTh + cfg.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('') + editTh;

    const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'id'));
    return sortedKeys.map(key => {
        const groupRows = groups.get(key);
        const body = groupRows.map(r => renderRow(r, canDelete, hasEdit)).join('');
        return `
            <details class="wz-accordion" style="margin-bottom:8px">
                <summary class="wz-accordion-header">${escapeHtml(key)} (${groupRows.length})</summary>
                <table class="table" style="margin-top:4px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
            </details>`;
    }).join('');
}

function renderNestedAccordion(cfg, rows) {
    const canDelete = !!cfg.deleteTable;
    const hasEdit = !!cfg.editFields;

    // Level 1: program, Level 2: kelas
    const programs = new Map();
    for (const r of rows) {
        const prog = r.program ?? '—';
        const kls  = r.kelas ?? '—';
        if (!programs.has(prog)) programs.set(prog, new Map());
        const classes = programs.get(prog);
        if (!classes.has(kls)) classes.set(kls, []);
        classes.get(kls).push(r);
    }

    const checkTh = canDelete
        ? '<th style="width:36px"><input type="checkbox" class="wz-group-check-all" title="Pilih semua di kelas ini" /></th>'
        : '';
    const editTh = hasEdit ? '<th style="width:40px"></th>' : '';
    const head = checkTh + cfg.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('') + editTh;

    const sortedProgs = [...programs.keys()].sort((a, b) => a.localeCompare(b, 'id'));
    return sortedProgs.map(prog => {
        const classMap = programs.get(prog);
        let progTotal = 0;
        classMap.forEach(arr => { progTotal += arr.length; });

        const sortedClasses = [...classMap.keys()].sort((a, b) => a.localeCompare(b, 'id'));
        const classAccordions = sortedClasses.map(kls => {
            const classRows = classMap.get(kls);
            const body = classRows.map(r => renderRow(r, canDelete, hasEdit)).join('');
            return `
                <details class="wz-accordion wz-accordion-inner" style="margin:4px 0 4px 16px">
                    <summary class="wz-accordion-header">${escapeHtml(kls)} (${classRows.length})</summary>
                    <table class="table" style="margin-top:4px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
                </details>`;
        }).join('');

        return `
            <details class="wz-accordion" style="margin-bottom:8px">
                <summary class="wz-accordion-header">${escapeHtml(prog)} (${progTotal})</summary>
                <div style="padding:4px 0">${classAccordions}</div>
            </details>`;
    }).join('');
}

function wireDataTable(step, cfg) {
    if (!cfg.deleteTable) return;

    const checks   = Array.from(contentEl.querySelectorAll('.wz-check'));
    const checkAll = contentEl.querySelector('.wz-check-all');
    const selBtn   = contentEl.querySelector('.wz-del-selected');
    const allBtn   = contentEl.querySelector('.wz-del-all');

    // Tabel kosong (tanpa toolbar/checkbox) — tidak ada yang perlu di-wire.
    if (!selBtn || !allBtn) return;

    const selectedIds = () => checks.filter(c => c.checked).map(c => c.value);

    function syncSelectedBtn() {
        const n = selectedIds().length;
        selBtn.textContent = `Hapus Terpilih (${n})`;
        selBtn.disabled = n === 0;
        if (checkAll) checkAll.checked = n > 0 && n === checks.length;
    }

    checks.forEach(c => c.addEventListener('change', syncSelectedBtn));
    if (checkAll) {
        checkAll.addEventListener('change', () => {
            checks.forEach(c => { c.checked = checkAll.checked; });
            syncSelectedBtn();
        });
    }

    // Per-group "check all" di accordion
    contentEl.querySelectorAll('.wz-group-check-all').forEach(groupCheckAll => {
        const groupChecks = Array.from(
            groupCheckAll.closest('table').querySelectorAll('.wz-check')
        );
        groupCheckAll.addEventListener('change', () => {
            groupChecks.forEach(c => { c.checked = groupCheckAll.checked; });
            syncSelectedBtn();
        });
    });

    selBtn.addEventListener('click', async () => {
        const ids = selectedIds();
        if (!ids.length) return;
        const blockMsg = await checkDeleteOrder(step);
        if (blockMsg) { showError(blockMsg); return; }
        if (!confirm(`Hapus ${ids.length} data terpilih? Tindakan ini tidak dapat dibatalkan.`)) return;
        runBulkDelete(step, cfg, ids, selBtn);
    });

    allBtn.addEventListener('click', async () => {
        const allIdsEl = contentEl.querySelector('.wz-all-ids');
        const ids = allIdsEl ? JSON.parse(allIdsEl.textContent) : checks.map(c => c.value);
        if (!ids.length) return;
        const blockMsg = await checkDeleteOrder(step);
        if (blockMsg) { showError(blockMsg); return; }
        if (!confirm(`Hapus SEMUA ${ids.length} data pada langkah ini? Tindakan ini tidak dapat dibatalkan.`)) return;
        runBulkDelete(step, cfg, ids, allBtn);
    });

    // Wire edit buttons
    if (cfg.editFields) {
        contentEl.querySelectorAll('.wz-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const editData = JSON.parse(btn.dataset.edit || '{}');
                showEditModal(step, cfg, id, editData);
            });
        });
    }
}

function showEditModal(step, cfg, id, editData) {
    let existing = document.getElementById('wz-edit-modal');
    if (existing) existing.remove();

    const fields = cfg.editFields.map(f => `
        <div class="field">
            <label>${escapeHtml(f.label)}</label>
            <input type="text" class="input wz-edit-field" data-key="${escapeAttr(f.key)}"
                value="${escapeAttr(editData[f.key] ?? '')}" />
        </div>
    `).join('');

    const modal = document.createElement('div');
    modal.id = 'wz-edit-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:999';
    modal.innerHTML = `
        <div style="background:var(--color-surface);border-radius:var(--radius-lg);padding:24px;width:100%;max-width:440px;box-shadow:var(--shadow-md)">
            <h4 style="margin:0 0 16px">Edit Data</h4>
            <div id="wz-edit-error" class="alert alert-danger" style="display:none"></div>
            ${fields}
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
                <button type="button" class="btn btn-secondary" id="wz-edit-cancel">Batal</button>
                <button type="button" class="btn btn-primary" id="wz-edit-save">Simpan</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('wz-edit-cancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    document.getElementById('wz-edit-save').addEventListener('click', async () => {
        const saveBtn = document.getElementById('wz-edit-save');
        const errEl   = document.getElementById('wz-edit-error');
        errEl.style.display = 'none';

        const vals = {};
        modal.querySelectorAll('.wz-edit-field').forEach(input => {
            vals[input.dataset.key] = input.value.trim();
        });

        const empty = cfg.editFields.filter(f => !vals[f.key]);
        if (empty.length) {
            errEl.textContent = `Field wajib kosong: ${empty.map(f => f.label).join(', ')}`;
            errEl.style.display = 'block';
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Menyimpan...';
        try {
            const result = await cfg.save(id, vals, editData);
            modal.remove();

            // Tampilkan info kelas yang ikut di-rename
            if (Array.isArray(result) && result.length > 0) {
                const renameList = result.map(r => `${r.from} → ${r.to}`).join(', ');
                showSuccess(`Data diperbarui. Kelas ikut di-rename: ${renameList}`);
            }

            await refreshDataList(step);
        } catch (err) {
            errEl.textContent = err.message ?? 'Gagal menyimpan perubahan.';
            errEl.style.display = 'block';
            saveBtn.disabled = false;
            saveBtn.textContent = 'Simpan';
        }
    });
}

// Validasi urutan hapus: cek tabel yang mereferensi data pada langkah ini.
// Byproduct impor (class_enrollments, student_parents, teaching_assignments,
// schedule_templates) di-cascade otomatis — tidak perlu dicek di sini.
// Yang dicek: data transaksional/operasional yang harus dihapus manual.
const DELETE_ORDER_CHECKS = {
    3: [ // Program: kelas & siswa harus kosong dulu
        { label: 'Kelas (langkah 4)',  table: 'classes',  query: q => q.select('class_id', { count: 'exact', head: true }) },
        { label: 'Siswa (langkah 6)',  table: 'students', query: q => q.select('student_id', { count: 'exact', head: true }) },
    ],
    4: [ // Kelas: jadwal & siswa harus kosong
        { label: 'Jadwal (langkah 10)', table: 'teaching_schedules', query: q => q.select('schedule_id', { count: 'exact', head: true }) },
        { label: 'Siswa (langkah 6)',   table: 'students', query: q => q.select('student_id', { count: 'exact', head: true }) },
    ],
    5: [ // Staf: jadwal harus kosong
        { label: 'Jadwal (langkah 10)', table: 'teaching_schedules', query: q => q.select('schedule_id', { count: 'exact', head: true }) },
        { label: 'Guru pengganti',      table: 'substitute_schedules', query: q => q.select('substitute_id', { count: 'exact', head: true }) },
    ],
    6: [ // Siswa: data transaksional harus kosong (enrollment & student_parents di-cascade)
        { label: 'Kehadiran',   table: 'attendance',    query: q => q.select('attendance_id', { count: 'exact', head: true }) },
        { label: 'Observasi',   table: 'observations',  query: q => q.select('observation_id', { count: 'exact', head: true }) },
        { label: 'Kasus',       table: 'cases',         query: q => q.select('case_id', { count: 'exact', head: true }) },
        { label: 'PKL',         table: 'pkl_placements', query: q => q.select('placement_id', { count: 'exact', head: true }) },
    ],
    8: [ // DUDI: PKL harus kosong
        { label: 'PKL',         table: 'pkl_placements', query: q => q.select('placement_id', { count: 'exact', head: true }) },
    ],
    10: [ // Jadwal: data transaksional harus kosong
        { label: 'Kehadiran',       table: 'attendance',           query: q => q.select('attendance_id', { count: 'exact', head: true }) },
        { label: 'Observasi',       table: 'observations',         query: q => q.select('observation_id', { count: 'exact', head: true }).not('schedule_id', 'is', null) },
        { label: 'Guru pengganti',  table: 'substitute_schedules', query: q => q.select('substitute_id', { count: 'exact', head: true }) },
    ],
};

async function checkDeleteOrder(step) {
    const checks = DELETE_ORDER_CHECKS[step];
    if (!checks) return null;

    const results = await Promise.all(
        checks.map(c => c.query(supabase.from(c.table)))
    );

    const blockers = [];
    results.forEach(({ count, error }, i) => {
        if (error) {
            console.warn(`[checkDeleteOrder] ${checks[i].table}:`, error.message);
            return;
        }
        if (count > 0) blockers.push(`${checks[i].label} (${count})`);
    });

    if (blockers.length === 0) return null;
    return `Tidak bisa menghapus — masih ada data terkait: ${blockers.join(', ')}. Hapus data tersebut terlebih dahulu.`;
}

async function runBulkDelete(step, cfg, ids, btn) {
    clearError();
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = `Menghapus 0/${ids.length}…`;
    const onProgress = (done, total) => { btn.textContent = `Menghapus ${done}/${total}…`; };
    try {
        const { deleted, errors } = await deleteBulk(cfg.deleteTable, ids, onProgress);
        if (errors.length) {
            showError(`${deleted} terhapus, ${errors.length} gagal. Contoh: ${errors[0].message}`);
        }
    } catch (err) {
        showError(err.message ?? 'Gagal menghapus data.');
    } finally {
        btn.textContent = label;
        await refreshDataList(step);
    }
}

// ─────────────────────────────────────────────────────────────
// INIT (auth guard + render langkah 1)
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// GANTI PASSWORD (modal)
// ─────────────────────────────────────────────────────────────

function showPasswordModal(isFirstTime) {
    const modal      = document.getElementById('password-modal');
    const newPassEl  = document.getElementById('modal-new-password');
    const confirmEl  = document.getElementById('modal-confirm-password');
    const submitBtn  = document.getElementById('modal-submit-btn');
    const modalErrEl = document.getElementById('password-modal-error');

    newPassEl.value  = '';
    confirmEl.value  = '';
    modalErrEl.style.display = 'none';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Simpan Password';
    modal.style.display = 'flex';

    const handler = async () => {
        const newPass     = newPassEl.value;
        const confirmPass = confirmEl.value;

        modalErrEl.style.display = 'none';
        modalErrEl.textContent = '';

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
            submitBtn.removeEventListener('click', handler);
            if (isFirstTime) await goToStep(1);
        } catch (err) {
            modalErrEl.textContent = err.message ?? 'Gagal menyimpan password. Coba lagi.';
            modalErrEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Simpan Password';
        }
    };

    submitBtn.addEventListener('click', handler);
}

// Guard: peringatan saat TU menutup/refresh halaman di tengah wizard
let importRunning = false;
window.addEventListener('beforeunload', (e) => {
    if (importRunning) {
        e.preventDefault();
        e.returnValue = '';
    }
});

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

    // Tombol ganti password di header — selalu tersedia
    const changePwBtn = document.getElementById('wizard-change-pw-btn');
    if (changePwBtn) {
        changePwBtn.addEventListener('click', () => showPasswordModal(false));
    }

    // Cek apakah password default sudah diganti
    let config = null;
    try { config = await getSchoolConfig(); } catch (_) { config = null; }

    if (!config?.password_changed) {
        showPasswordModal(true);
        return;
    }

    await goToStep(1);
})();
