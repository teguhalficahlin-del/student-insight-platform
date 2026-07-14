/**
 * @file admin/js/setup-wizard.js
 *
 * Drives the 11-step setup wizard on admin/setup.html.
 *
 * State (current step + step-1..3 form values) is kept in
 * localStorage under SMK_SETUP_STATE_KEY so a refresh mid-wizard
 * doesn't lose progress. CSV-import steps write directly to the
 * database via Edge Functions, so they don't need to be cached
 * locally — their "done" flag is derived from having run at least
 * one successful import.
 *
 * Steps 4-8 each import a single staff role (Kepsek, Kaprodi, Wali
 * Kelas, Guru, BK) through the same bulk-import-users Edge Function
 * used elsewhere — role_type isn't a CSV column for these steps, it's
 * injected into the CSV text client-side (see injectColumn) before
 * the request is sent, since the role is already implied by which
 * step the admin is on.
 */

import {
    supabase,
    getCurrentUserRow, requireAdministrativeOrRedirect,
    getSchoolConfig, upsertSchoolConfig, markSetupCompleted,
    getPrograms, getClasses, addClass,
    importPrograms, importClasses, importUsers, importStudents, importParents, importDudi,
} from './api.js';
import { mountCsvImporter } from './import.js';

const STATE_KEY = 'smk_setup_wizard_state';
const TOTAL_STEPS = 11;

const defaultState = () => ({
    currentStep: 1,
    maxReachedStep: 1,
    schoolName: '',
    academicYear: '',
    semester: '1',
    stepDone: {
        1: false, 2: false, 3: false, 4: false, 5: false, 6: false,
        7: false, 8: false, 9: false, 10: false, 11: false,
        parentsImported: false,
    },
});

function loadState() {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        return raw ? { ...defaultState(), ...JSON.parse(raw) } : defaultState();
    } catch {
        return defaultState();
    }
}

function saveState(state) {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

let state = loadState();
let programsCache = [];
let classesCache = [];

const errorEl   = document.getElementById('wizard-error');
const nextBtn   = document.getElementById('wizard-next-btn');
const backBtn   = document.getElementById('wizard-back-btn');
const dashboardBtn = document.getElementById('wizard-dashboard-btn');
const labelEl   = document.getElementById('wizard-progress-label');

function showError(message) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
}
function clearError() {
    errorEl.style.display = 'none';
}

/**
 * Appends a constant-value column to every data row of a CSV string.
 * Used to inject role_type before sending a role-specific CSV (Kepsek/
 * Kaprodi/Wali Kelas/Guru/BK) to bulk-import-users, which expects
 * role_type as a column. Assumes unquoted, comma-separated CSV — the
 * same assumption import.js's client-side preview parser makes.
 */
function injectColumn(csvText, columnName, value) {
    const lines = csvText.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return csvText;

    const header = `${lines[0]},${columnName}`;
    const dataLines = lines.slice(1).map(line => `${line},${value}`);
    return [header, ...dataLines].join('\r\n');
}

// ─────────────────────────────────────────────────────────────
// RENDER / NAVIGATION
// ─────────────────────────────────────────────────────────────

function renderStepVisibility() {
    document.querySelectorAll('.wizard-step').forEach(el => {
        el.classList.toggle('is-active', Number(el.dataset.step) === state.currentStep);
    });
    document.querySelectorAll('.step-dot').forEach(el => {
        const step = Number(el.dataset.step);
        el.classList.toggle('is-active', step === state.currentStep);
        el.classList.toggle('is-done', state.stepDone[step] === true && step !== state.currentStep);

        const canClick = step <= state.maxReachedStep;
        el.style.cursor = canClick ? 'pointer' : 'default';
        el.onclick = canClick ? async () => {
            clearError();
            state.currentStep = step;
            saveState(state);
            await renderStep();
        } : null;
    });
    labelEl.textContent = `Tahap ${state.currentStep} dari ${TOTAL_STEPS}`;
    backBtn.style.visibility = state.currentStep === 1 ? 'hidden' : 'visible';
    nextBtn.textContent = state.currentStep === TOTAL_STEPS ? 'Selesaikan Setup' : 'Lanjut';
}

function updateDashboardBtnVisibility() {
    const show = state.stepDone[2]
        && state.stepDone[3]
        && state.currentStep < TOTAL_STEPS;
    dashboardBtn.style.display = show ? '' : 'none';
}

async function validateCurrentStep() {
    switch (state.currentStep) {
        case 1: {
            const name = document.getElementById('school-name').value.trim();
            const year = document.getElementById('academic-year').value.trim();
            if (!name) return 'Nama sekolah wajib diisi';
            if (!/^\d{4}\/\d{4}$/.test(year)) return 'Format tahun ajaran harus YYYY/YYYY (e.g. 2024/2025)';
            return null;
        }
        case 2:
            return programsCache.length > 0
                ? null
                : 'Upload file CSV program keahlian dan klik "Impor Data" terlebih dahulu';
        case 3:
            return classesCache.length > 0 ? null : 'Tambahkan minimal satu kelas';
        case 4:  // Kepsek — optional
        case 5:  // Kaprodi — optional
        case 6:  // Wali Kelas — optional
            return null;
        case 7:  // Guru — minimal satu guru wajib ada
            return state.stepDone[7]
                ? null
                : 'Tambahkan minimal satu guru sebelum lanjut';
        case 8:  // BK — optional
        case 9:  // Siswa + Orang Tua — optional, dapat dilanjutkan dari dashboard
        case 10: // DUDI — optional
            return null;
        case 11:
            return null;
        default:
            return null;
    }
}

async function persistCurrentStep() {
    if (state.currentStep === 1) {
        state.schoolName   = document.getElementById('school-name').value.trim();
        state.academicYear = document.getElementById('academic-year').value.trim();
        state.semester      = document.getElementById('active-semester').value;
        await upsertSchoolConfig({
            school_name:           state.schoolName,
            current_academic_year: state.academicYear,
            current_semester:      state.semester,
        });
    }
    state.stepDone[state.currentStep] = true;
}

nextBtn.addEventListener('click', async () => {
    clearError();
    nextBtn.disabled = true;
    try {
        const validationError = await validateCurrentStep();
        if (validationError) {
            showError(validationError);
            return;
        }
        await persistCurrentStep();
        saveState(state);

        if (state.currentStep === TOTAL_STEPS) {
            await markSetupCompleted();
            localStorage.removeItem(STATE_KEY);
            window.location.replace('dashboard.html');
            return;
        }

        state.currentStep += 1;
        if (state.currentStep > state.maxReachedStep) {
            state.maxReachedStep = state.currentStep;
        }
        saveState(state);
        await renderStep();
    } catch (err) {
        showError(err.message ?? 'Terjadi kesalahan. Coba lagi.');
    } finally {
        nextBtn.disabled = false;
    }
});

dashboardBtn.addEventListener('click', async () => {
    dashboardBtn.disabled = true;
    dashboardBtn.textContent = 'Membuka...';
    try {
        await markSetupCompleted();
        // Simpan state wizard — TIDAK dihapus,
        // agar TU bisa kembali melanjutkan setup
        saveState(state);
        window.location.replace('dashboard.html');
    } catch (err) {
        showError(err.message ?? 'Gagal membuka dashboard. Coba lagi.');
        dashboardBtn.disabled = false;
        dashboardBtn.textContent = 'Buka Dashboard';
    }
});

backBtn.addEventListener('click', async () => {
    if (state.currentStep === 1) return;
    clearError();
    state.currentStep -= 1;
    saveState(state);
    await renderStep();
});

// ─────────────────────────────────────────────────────────────
// PER-STEP SETUP
// ─────────────────────────────────────────────────────────────

async function renderClassTable() {
    classesCache = await getClasses(state.academicYear || null);
    const programById = new Map(programsCache.map(p => [p.program_id, p.name]));
    const tbody = document.querySelector('#class-table tbody');
    tbody.innerHTML = classesCache.map(c => `
        <tr><td>${c.name}</td><td>${programById.get(c.program_id) ?? '—'}</td><td>${c.grade_level}</td></tr>
    `).join('') || '<tr><td colspan="3" class="hint">Belum ada kelas</td></tr>';
}

function setupStep1() {
    document.getElementById('school-name').value = state.schoolName;
    document.getElementById('academic-year').value = state.academicYear;
    document.getElementById('active-semester').value = state.semester;
}

async function setupStep2() {
    programsCache = await getPrograms();

    const section = document.querySelector('.wizard-step[data-step="2"]');
    section.innerHTML = `
        <div class="step-label">Tahap 2 dari ${TOTAL_STEPS}</div>
        <h3>Program Keahlian</h3>
        <div id="import-programs-mount"></div>
    `;

    const container = document.getElementById('import-programs-mount');
    mountCsvImporter(container, {
        columns: ['kode', 'nama'],
        onImport: importPrograms,
        onDone: async (result) => {
            if (result.success > 0) {
                state.stepDone[2] = true;
                programsCache = await getPrograms();
                saveState(state);
            }
        },
        template: {
            filename: 'template_program_keahlian.csv',
            columns: ['kode', 'nama'],
            exampleRows: [
                ['TKJ', 'Teknik Komputer dan Jaringan'],
                ['RPL', 'Rekayasa Perangkat Lunak'],
                ['MM',  'Multimedia'],
            ],
        },
    });
    container.insertAdjacentHTML('afterbegin', alreadyImportedBanner(2));
}

async function setupStep3() {
    if (programsCache.length === 0) programsCache = await getPrograms();
    document.getElementById('new-class-program').innerHTML = programsCache
        .map(p => `<option value="${p.program_id}">${p.name}</option>`).join('');
    await renderClassTable();

    // CSV import block — inserted once, above the manual-add form,
    // below the existing class table.
    let importMount = document.getElementById('import-classes-mount');
    if (!importMount) {
        document.querySelector('#class-table')
            .insertAdjacentHTML('afterend', '<div id="import-classes-mount" style="margin:1rem 0;"></div>');
        importMount = document.getElementById('import-classes-mount');
    }
    mountCsvImporter(importMount, {
        columns: ['nama_kelas', 'kode_program', 'tingkat'],
        onImport: importClasses,
        onDone: async (result) => { if (result.success > 0) await renderClassTable(); },
        template: {
            filename: 'template_kelas.csv',
            columns: ['nama_kelas', 'kode_program', 'tingkat'],
            exampleRows: [
                ['X TKJ 1', 'TKJ', '10'],
                ['XI TKJ 1', 'TKJ', '11'],
                ['XII TKJ 1', 'TKJ', '12'],
            ],
        },
    });

    document.getElementById('add-class-btn').onclick = async () => {
        const name = document.getElementById('new-class-name').value.trim();
        const program_id = document.getElementById('new-class-program').value;
        const grade_level = Number(document.getElementById('new-class-grade').value);
        if (!name || !program_id) { showError('Nama kelas dan program wajib diisi'); return; }
        try {
            await addClass({ name, program_id, academic_year: state.academicYear, grade_level });
            document.getElementById('new-class-name').value = '';
            clearError();
            await renderClassTable();
        } catch (err) {
            showError(err.message);
        }
    };
}

function alreadyImportedBanner(stepKey) {
    if (!state.stepDone[stepKey]) return '';
    return '<div class="alert alert-success" style="margin-bottom:1rem">' +
        'Data sudah diimpor. Upload file baru untuk menambah atau memperbarui data.</div>';
}

/**
 * Shared mount for the single-role staff-import steps (4-8). Each one
 * sends a CSV without role_type to bulk-import-users — role_type is
 * injected here since it's implied by the step/role, not chosen by
 * the admin per-row.
 */
function mountRoleImporter({ mountId, stepNumber, roleType, columns, template }) {
    const container = document.getElementById(mountId);
    mountCsvImporter(container, {
        columns,
        onImport: (csvText) => importUsers(injectColumn(csvText, 'role_type', roleType)),
        onDone: (result) => { if (result.success > 0) state.stepDone[stepNumber] = true; saveState(state); },
        template,
    });
    container.insertAdjacentHTML('afterbegin', alreadyImportedBanner(stepNumber));
}

function setupStep4() {
    mountRoleImporter({
        mountId: 'import-kepsek-mount',
        stepNumber: 4,
        roleType: 'KEPSEK',
        columns: ['nama', 'nip_atau_nik'],
        template: {
            filename: 'template_kepsek.csv',
            columns: ['nama', 'nip_atau_nik'],
            exampleRows: [
                ['Budi Santoso', '197001012000011001'],
            ],
        },
    });
}

function setupStep5() {
    mountRoleImporter({
        mountId: 'import-kaprodi-mount',
        stepNumber: 5,
        roleType: 'KAPRODI',
        columns: ['nama', 'nip_atau_nik', 'kode_program'],
        template: {
            filename: 'template_kaprodi.csv',
            columns: ['nama', 'nip_atau_nik', 'kode_program'],
            exampleRows: [
                ['Sari Dewi', '197501012001012001', 'TKJ'],
            ],
        },
    });
}

function setupStep6() {
    mountRoleImporter({
        mountId: 'import-walikelas-mount',
        stepNumber: 6,
        roleType: 'WALI_KELAS',
        columns: ['nama', 'nip_atau_nik', 'nama_kelas'],
        template: {
            filename: 'template_wali_kelas.csv',
            columns: ['nama', 'nip_atau_nik', 'nama_kelas'],
            exampleRows: [
                ['Ahmad Fauzi', '198001012003011001', 'X TKJ 1'],
            ],
        },
    });
}

function setupStep7() {
    mountRoleImporter({
        mountId: 'import-guru-mount',
        stepNumber: 7,
        roleType: 'GURU',
        columns: ['nama', 'nip_atau_nik'],
        template: {
            filename: 'template_guru.csv',
            columns: ['nama', 'nip_atau_nik'],
            exampleRows: [
                ['Rina Wati', '198501012005012001'],
            ],
        },
    });
}

function setupStep8() {
    mountRoleImporter({
        mountId: 'import-bk-mount',
        stepNumber: 8,
        roleType: 'BK',
        columns: ['nama', 'nip_atau_nik'],
        template: {
            filename: 'template_bk.csv',
            columns: ['nama', 'nip_atau_nik'],
            exampleRows: [
                ['Dedi Kurniawan', '197901012002011001'],
            ],
        },
    });
}

function setupStep9() {
    const studentsContainer = document.getElementById('import-students-mount');
    mountCsvImporter(studentsContainer, {
        columns: ['nama', 'nis', 'kode_program', 'class_name'],
        onImport: importStudents,
        onDone: (result) => { if (result.success > 0) state.stepDone[9] = true; saveState(state); },
        template: {
            filename: 'template_siswa.csv',
            columns: ['nama', 'nis', 'kode_program', 'class_name'],
            exampleRows: [
                ['Rizky Ramadhan', '0091234567', 'TKJ', 'X TKJ 1'],
                ['Putri Ayu Lestari', '0091234568', 'RPL', 'X RPL 1'],
                ['Fajar Nugroho', '0091234569', 'MM', 'X MM 1'],
            ],
        },
    });
    studentsContainer.insertAdjacentHTML('afterbegin', alreadyImportedBanner(9));

    const parentsContainer = document.getElementById('import-parents-mount');
    mountCsvImporter(parentsContainer, {
        columns: ['nama_ortu', 'nik', 'nis_siswa'],
        onImport: importParents,
        onDone: (result) => {
            // Tracked under a non-numeric key — Orang Tua isn't its own
            // numbered wizard step, so it can't collide with stepDone[N].
            if (result.success > 0) { state.stepDone.parentsImported = true; saveState(state); }
        },
        template: {
            filename: 'template_orang_tua.csv',
            columns: ['nama_ortu', 'nik', 'nis_siswa'],
            exampleRows: [
                ['Bambang Wijaya', '3201012003800001', '0091234567'],
                ['Bambang Wijaya', '3201012003800001', '0091234570'],
            ],
        },
    });
    parentsContainer.insertAdjacentHTML('afterbegin', alreadyImportedBanner('parentsImported'));
}

function setupStep10() {
    const container = document.getElementById('import-dudi-mount');
    mountCsvImporter(container, {
        columns: ['nama_usaha', 'nama_penanggung_jawab', 'kode_program'],
        onImport: importDudi,
        onDone: (result) => { if (result.success > 0) state.stepDone[10] = true; saveState(state); },
        template: {
            filename: 'template_dudi.csv',
            columns: ['nama_usaha', 'nama_penanggung_jawab', 'kode_program'],
            exampleRows: [
                ['PT Mitra Teknologi Nusantara', 'Hendra Setiawan', 'TKJ'],
                ['CV Karya Mandiri Elektronik', 'Yulia Permatasari', 'TKJ'],
            ],
        },
    });
    container.insertAdjacentHTML('afterbegin', alreadyImportedBanner(10));
}

async function setupStep11() {
    classesCache = await getClasses();
    programsCache = await getPrograms();
    document.getElementById('final-summary').innerHTML = `
        <p><strong>Sekolah:</strong> ${state.schoolName} — Tahun Ajaran ${state.academicYear}, Semester ${state.semester}</p>
        <p><strong>Program Keahlian:</strong> ${programsCache.length} program</p>
        <p><strong>Kelas:</strong> ${classesCache.length} kelas</p>
        <p><strong>Import Kepsek:</strong> <span class="badge ${state.stepDone[4] ? 'badge-success' : 'badge-muted'}">${state.stepDone[4] ? 'Sudah diimpor' : 'Belum/dilewati'}</span></p>
        <p><strong>Import Kaprodi:</strong> <span class="badge ${state.stepDone[5] ? 'badge-success' : 'badge-muted'}">${state.stepDone[5] ? 'Sudah diimpor' : 'Belum/dilewati'}</span></p>
        <p><strong>Import Wali Kelas:</strong> <span class="badge ${state.stepDone[6] ? 'badge-success' : 'badge-muted'}">${state.stepDone[6] ? 'Sudah diimpor' : 'Belum/dilewati'}</span></p>
        <p><strong>Import Guru:</strong> <span class="badge ${state.stepDone[7] ? 'badge-success' : 'badge-muted'}">${state.stepDone[7] ? 'Sudah diimpor' : 'Belum/dilewati'}</span></p>
        <p><strong>Import BK:</strong> <span class="badge ${state.stepDone[8] ? 'badge-success' : 'badge-muted'}">${state.stepDone[8] ? 'Sudah diimpor' : 'Belum/dilewati'}</span></p>
        <p><strong>Import Siswa:</strong> <span class="badge ${state.stepDone[9] ? 'badge-success' : 'badge-muted'}">${state.stepDone[9] ? 'Sudah diimpor' : 'Belum/dilewati'}</span></p>
        <p><strong>Import Orang Tua:</strong> <span class="badge ${state.stepDone.parentsImported ? 'badge-success' : 'badge-muted'}">${state.stepDone.parentsImported ? 'Sudah diimpor' : 'Opsional — dapat dilakukan via dashboard'}</span></p>
        <p><strong>Import DUDI:</strong> <span class="badge ${state.stepDone[10] ? 'badge-success' : 'badge-muted'}">${state.stepDone[10] ? 'Sudah diimpor' : 'Opsional — dapat dilakukan via dashboard'}</span></p>
        <p class="hint">Klik "Selesaikan Setup" untuk mengaktifkan sistem.</p>
    `;
}

async function renderStep() {
    clearError();
    renderStepVisibility();
    switch (state.currentStep) {
        case 1:  setupStep1(); break;
        case 2:  await setupStep2(); break;
        case 3:  await setupStep3(); break;
        case 4:  setupStep4(); break;
        case 5:  setupStep5(); break;
        case 6:  setupStep6(); break;
        case 7:  setupStep7(); break;
        case 8:  setupStep8(); break;
        case 9:  setupStep9(); break;
        case 10: setupStep10(); break;
        case 11: await setupStep11(); break;
    }
    updateDashboardBtnVisibility();
}

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────

(async function init() {
    const userRow = await getCurrentUserRow();
    if (!requireAdministrativeOrRedirect(userRow)) return;

    // Fallback safety: repairs localStorage state saved before
    // maxReachedStep existed (currentStep already past 1, but
    // maxReachedStep fell back to defaultState's 1).
    if (state.currentStep > state.maxReachedStep) {
        state.maxReachedStep = state.currentStep;
        saveState(state);
    }

    const config = await getSchoolConfig();
    if (config?.setup_completed) {
        const raw = localStorage.getItem(STATE_KEY);
        const savedState = raw ? JSON.parse(raw) : null;
        const isIncomplete = savedState && savedState.maxReachedStep < 11;
        if (!isIncomplete) {
            window.location.replace('dashboard.html');
            return;
        }
    }

    await renderStep();

    // Cek database — apakah data minimum sudah ada?
    // Ini memungkinkan tombol "Buka Dashboard" muncul
    // meski wizard baru dimulai ulang di sesi baru.
    try {
        const [programsData, classesData, guruData] = await Promise.all([
            supabase.from('programs').select('program_id', { count: 'exact', head: true }),
            supabase.from('classes').select('class_id', { count: 'exact', head: true }),
            supabase.from('v_users_staff_directory').select('user_id', { count: 'exact', head: true })
                .eq('role_type', 'GURU'),
        ]);

        const hasPrograms = (programsData.count ?? 0) > 0;
        const hasClasses  = (classesData.count ?? 0) > 0;
        const hasGuru     = (guruData.count ?? 0) > 0;

        if (hasPrograms) state.stepDone[2] = true;
        if (hasClasses)  state.stepDone[3] = true;
        if (hasGuru)     state.stepDone[7] = true;

        if (hasPrograms || hasClasses || hasGuru) {
            saveState(state);
            updateDashboardBtnVisibility();
        }
    } catch {
        // Gagal cek DB — abaikan, tombol tidak ditampilkan
    }
})();
