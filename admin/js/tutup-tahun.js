/**
 * @file admin/js/tutup-tahun.js
 *
 * Drives the "Tutup Tahun Ajaran" wizard on admin/tutup-tahun.html.
 * In-memory state only (single-sitting admin operation, unlike the
 * setup wizard — no localStorage persistence across reload).
 *
 * Step 3 (Kenaikan Kelas) does NOT write class_enrollments at its own
 * confirm — the new academic_year isn't known until Step 4. It locks
 * the mapping (source class -> target class name + student list) into
 * state. Step 4's confirm performs the actual writes: school_config,
 * academic_periods, then enrollments — target classes must already
 * exist (no auto-create); it throws if a mapped target class is missing.
 */

import {
    supabase, getCurrentUserRow, requireAdministrativeOrRedirect, getSchoolConfig, SUPABASE_URL,
} from './api.js';

const TOTAL_STEPS = 5;
const NEXT_LABELS = {
    1: 'Lanjut ke Kelulusan',
    2: 'Lanjut ke Kenaikan Kelas',
    3: 'Lanjut ke Tahun Ajaran Baru',
    4: 'Lanjut ke Ringkasan',
    5: 'Selesai',
};

const state = {
    config:                 null,
    currentStep:            1,
    gradeXIIStudents:       [],
    graduationDone:         false,
    graduatedStudentIds:    [],
    notGraduatedStudentIds: [],
    sourceClasses:          [],
    promotionMapping:       [],
    promotionDone:          false,
    newYearDone:            false,
    newAcademicYear:        '',
    newSemester:            '',
    promotedCount:          0,
};

const errorEl = document.getElementById('wizard-error');
const nextBtn = document.getElementById('wizard-next-btn');
const backBtn = document.getElementById('wizard-back-btn');
const labelEl = document.getElementById('wizard-progress-label');

function showError(message) { errorEl.textContent = message; errorEl.style.display = 'block'; }
function clearError() { errorEl.style.display = 'none'; }

// ─────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────

function gateBlocksNext(step) {
    if (step === 2) return !state.graduationDone;
    if (step === 3) return !state.promotionDone;
    if (step === 4) return !state.newYearDone;
    return false;
}

function renderStepVisibility() {
    document.querySelectorAll('.wizard-step').forEach(el => {
        el.classList.toggle('is-active', Number(el.dataset.step) === state.currentStep);
    });
    document.querySelectorAll('.step-dot').forEach(el => {
        const step = Number(el.dataset.step);
        el.classList.toggle('is-active', step === state.currentStep);
        el.classList.toggle('is-done', step < state.currentStep);
    });
    labelEl.textContent = `Langkah ${state.currentStep} dari ${TOTAL_STEPS}`;
    backBtn.style.visibility = state.currentStep === 1 ? 'hidden' : 'visible';
    nextBtn.textContent = NEXT_LABELS[state.currentStep];
    nextBtn.disabled = gateBlocksNext(state.currentStep);
}

nextBtn.addEventListener('click', async () => {
    clearError();
    if (state.currentStep === TOTAL_STEPS) {
        window.location.href = 'dashboard.html';
        return;
    }
    state.currentStep += 1;
    await renderStep();
});

backBtn.addEventListener('click', async () => {
    if (state.currentStep === 1) return;
    clearError();
    state.currentStep -= 1;
    await renderStep();
});

async function renderStep() {
    clearError();
    renderStepVisibility();
    try {
        switch (state.currentStep) {
            case 1: await setupStep1(); break;
            case 2: setupStep2(); break;
            case 3: await setupStep3(); break;
            case 4: setupStep4(); break;
            case 5: setupStep5(); break;
        }
    } catch (err) {
        showError(err.message ?? 'Terjadi kesalahan. Coba lagi.');
    }
    renderStepVisibility();
}

// ─────────────────────────────────────────────────────────────
// LANGKAH 1 — Review Siswa Kelas XII
// ─────────────────────────────────────────────────────────────

async function fetchGradeXIIStudents(config) {
    const { data, error } = await supabase
        .from('class_enrollments')
        .select('student_id, class_id, students!inner(student_id, full_name, nis, student_status), classes!inner(name, grade_level)')
        .eq('academic_year', config.current_academic_year)
        .eq('semester', config.current_semester)
        .is('withdrawn_at', null)
        .eq('classes.grade_level', 12);
    if (error) throw error;

    return data.map(r => ({
        student_id:     r.student_id,
        class_id:       r.class_id,
        full_name:      r.students.full_name,
        nis:            r.students.nis,
        student_status: r.students.student_status,
        className:      r.classes.name,
    }));
}

async function setupStep1() {
    state.gradeXIIStudents = await fetchGradeXIIStudents(state.config);
    const tbody = document.querySelector('#grade12-table tbody');
    tbody.innerHTML = state.gradeXIIStudents.map(s => `
        <tr><td>${s.full_name}</td><td>${s.nis}</td><td>${s.className}</td><td>${s.student_status}</td></tr>
    `).join('') || `<tr><td colspan="4" class="hint">Tidak ada siswa kelas XII pada periode aktif.</td></tr>`;
}

// ─────────────────────────────────────────────────────────────
// LANGKAH 2 — Kelulusan Massal
// ─────────────────────────────────────────────────────────────

function setupStep2() {
    const tbody = document.querySelector('#graduation-table tbody');
    tbody.innerHTML = state.gradeXIIStudents.map(s => `
        <tr>
            <td><input type="checkbox" class="grad-checkbox" data-student-id="${s.student_id}" checked /></td>
            <td>${s.full_name}</td><td>${s.nis}</td><td>${s.className}</td>
        </tr>
    `).join('') || `<tr><td colspan="4" class="hint">Tidak ada siswa untuk diluluskan.</td></tr>`;

    document.querySelectorAll('.grad-checkbox').forEach(cb => cb.addEventListener('change', updateGraduationPreview));
    updateGraduationPreview();

    document.getElementById('confirm-graduation-btn').disabled = state.graduationDone;
    document.getElementById('confirm-graduation-btn').onclick = onConfirmGraduation;
}

function updateGraduationPreview() {
    const total   = state.gradeXIIStudents.length;
    const checked = document.querySelectorAll('.grad-checkbox:checked').length;
    document.getElementById('graduation-preview').textContent =
        `${checked} siswa akan diluluskan, ${total - checked} tidak diluluskan`;
}

async function onConfirmGraduation() {
    const btn        = document.getElementById('confirm-graduation-btn');
    const resultArea = document.getElementById('graduation-result');
    const checkedIds = [...document.querySelectorAll('.grad-checkbox:checked')].map(cb => cb.dataset.studentId);

    if (!window.confirm(`Luluskan ${checkedIds.length} siswa? Tindakan ini tidak dapat dibatalkan.`)) return;

    btn.disabled = true;
    btn.textContent = 'Memproses...';
    try {
        const { error } = await supabase
            .from('students')
            .update({
                student_status:          'LULUS',
                graduated_at:            new Date().toISOString(),
                graduated_academic_year: state.config.current_academic_year,
            })
            .in('student_id', checkedIds);
        if (error) throw error;

        state.graduatedStudentIds    = checkedIds;
        state.notGraduatedStudentIds = state.gradeXIIStudents
            .map(s => s.student_id)
            .filter(id => !checkedIds.includes(id));
        state.graduationDone = true;
        btn.style.display = 'none';

        resultArea.innerHTML = `<div class="alert alert-success">${checkedIds.length} siswa berhasil diluluskan.</div>`;
        renderStepVisibility();
    } catch (err) {
        resultArea.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        btn.disabled = false;
        btn.textContent = 'Konfirmasi Kelulusan';
    }
}

// ─────────────────────────────────────────────────────────────
// LANGKAH 3 — Kenaikan Kelas
// ─────────────────────────────────────────────────────────────

function suggestNextClassName(name) {
    if (name.startsWith('XI ')) return name.replace(/^XI /, 'XII ');
    if (name.startsWith('X '))  return name.replace(/^X /, 'XI ');
    return `${name} (Lanjutan)`;
}

async function fetchPromotableClasses(config) {
    // Hitung tahun ajaran baru otomatis dari current + 1
    const [startYear, endYear] = config.current_academic_year.split('/').map(Number);
    const nextAcademicYear = `${endYear}/${endYear + 1}`;

    // Fetch kelas sumber (grade 10 dan 11, tahun ajaran aktif)
    const { data: classes, error: classErr } = await supabase
        .from('classes')
        .select('class_id, name, program_id, grade_level')
        .eq('academic_year', config.current_academic_year)
        .in('grade_level', [10, 11]);
    if (classErr) throw classErr;

    // Fetch kelas tujuan yang sudah ada di tahun ajaran baru
    const { data: nextClasses, error: nextErr } = await supabase
        .from('classes')
        .select('class_id, name, grade_level')
        .eq('academic_year', nextAcademicYear);
    if (nextErr) throw nextErr;

    // Map nama kelas tujuan → { class_id, grade_level } (untuk validasi
    // dan pengelompokan per tingkat tanpa query tambahan per kelas)
    const nextClassMap = new Map(
        (nextClasses ?? []).map(c => [
            c.name.trim().toUpperCase(),
            { class_id: c.class_id, grade_level: c.grade_level },
        ])
    );

    // Fetch enrollments
    const { data: enrollments, error: enrollErr } = await supabase
        .from('class_enrollments')
        .select('student_id, class_id')
        .eq('academic_year', config.current_academic_year)
        .eq('semester', config.current_semester)
        .is('withdrawn_at', null);
    if (enrollErr) throw enrollErr;

    const studentsByClass = new Map();
    for (const e of enrollments) {
        if (!studentsByClass.has(e.class_id)) studentsByClass.set(e.class_id, []);
        studentsByClass.get(e.class_id).push(e.student_id);
    }

    return {
        nextAcademicYear,
        nextClassMap,
        classes: classes.map(c => ({
            ...c,
            studentIds:    studentsByClass.get(c.class_id) ?? [],
            suggestedName: suggestNextClassName(c.name),
        })),
    };
}

async function setupStep3() {
    const { nextAcademicYear, nextClassMap, classes } =
        await fetchPromotableClasses(state.config);

    state.sourceClasses    = classes;
    state.nextAcademicYear = nextAcademicYear;
    state.nextClassMap     = nextClassMap;

    // Kelompokkan kelas tujuan per tingkat dari nextClassMap
    // grade 10 → butuh grade 11, grade 11 → butuh grade 12
    const nextClassesByGrade = new Map();
    for (const [name, { class_id, grade_level }] of nextClassMap) {
        if (!nextClassesByGrade.has(grade_level))
            nextClassesByGrade.set(grade_level, []);
        nextClassesByGrade.get(grade_level).push({ name, class_id });
    }

    const tbody = document.querySelector('#promotion-table tbody');
    let allValid = true;

    tbody.innerHTML = state.sourceClasses.map(c => {
        const targetGrade  = c.grade_level + 1;
        const options      = nextClassesByGrade.get(targetGrade) ?? [];
        const suggested    = options.find(o =>
            o.name === suggestNextClassName(c.name).trim().toUpperCase()
        ) ?? options[0];
        const hasOptions   = options.length > 0;
        if (!hasOptions) allValid = false;

        const rowStyle = hasOptions ? '' : 'background:var(--color-danger-light, #fff0f0)';

        return `
            <tr style="${rowStyle}">
                <td>${c.name} (Kelas ${c.grade_level})</td>
                <td>${c.studentIds.length}</td>
                <td>
                    ${hasOptions ? `
                    <select class="input promotion-target-select"
                            data-source-class-id="${c.class_id}">
                        <option value="">-- Pilih Kelas Tujuan --</option>
                        ${options.map(o => `
                            <option value="${o.class_id}"
                                ${suggested && o.name === suggested.name ? 'selected' : ''}>
                                ${o.name}
                            </option>
                        `).join('')}
                    </select>` : `<span style="color:var(--color-danger)">Tidak ada kelas tujuan</span>`}
                </td>
            </tr>
        `;
    }).join('') || `<tr><td colspan="3" class="hint">Tidak ada kelas tingkat 10/11.</td></tr>`;

    const confirmBtn = document.getElementById('confirm-promotion-btn');
    confirmBtn.disabled = !allValid || state.promotionDone;
    confirmBtn.onclick  = onConfirmPromotion;

    if (!allValid) {
        const missingCount = state.sourceClasses.filter(c => {
            const targetGrade = c.grade_level + 1;
            const options = nextClassesByGrade.get(targetGrade) ?? [];
            return options.length === 0;
        }).length;

        document.getElementById('promotion-result').innerHTML = `
            <div class="alert alert-danger" style="margin-top:1rem;">
                <strong>${missingCount} kelas</strong> belum memiliki
                kelas tujuan untuk tahun ajaran ${nextAcademicYear}.
                Baris yang ditandai merah perlu diselesaikan terlebih dahulu.<br/>
                Buat kelas yang diperlukan via menu
                <strong>Kelas</strong> di dashboard, lalu muat ulang
                halaman ini.
            </div>`;
    }
}

async function onConfirmPromotion() {
    const errorArea  = document.getElementById('promotion-error');
    const resultArea = document.getElementById('promotion-result');
    errorArea.style.display = 'none';

    const selects = [...document.querySelectorAll('.promotion-target-select')];
    const mapping = [];
    const missing = [];

    for (const sel of selects) {
        const sourceClass = state.sourceClasses.find(c => c.class_id === sel.dataset.sourceClassId);
        if (!sel.value) { missing.push(sourceClass.name); continue; }
        const selectedOption = sel.options[sel.selectedIndex];
        mapping.push({
            targetClassId:    sel.value,
            targetName:       selectedOption.textContent.trim(),
            programId:        sourceClass.program_id,
            targetGradeLevel: sourceClass.grade_level + 1,
            studentIds:       sourceClass.studentIds,
        });
    }

    if (missing.length > 0) {
        errorArea.textContent = `Kelas tujuan belum dipilih untuk: ${missing.join(', ')}`;
        errorArea.style.display = 'block';
        return;
    }

    const totalStudents = mapping.reduce((sum, m) => sum + m.studentIds.length, 0);
    if (!window.confirm(
        `Konfirmasi pemetaan kenaikan kelas untuk ${totalStudents} siswa?\n\n` +
        `Data akan disimpan ke database setelah Anda mengonfirmasi tahun ajaran baru di langkah berikutnya.`
    )) return;

    state.promotionMapping = mapping;
    state.promotionDone = true;

    resultArea.innerHTML = `<div class="alert alert-success">Pemetaan kenaikan kelas untuk ${totalStudents} siswa telah dikonfirmasi. Data akan disimpan setelah tahun ajaran baru dibuka.</div>`;
    document.getElementById('confirm-promotion-btn').disabled = true;
    renderStepVisibility();
}

// ─────────────────────────────────────────────────────────────
// LANGKAH 4 — Buka Tahun Ajaran Baru
// ─────────────────────────────────────────────────────────────

function incrementAcademicYear(yearStr) {
    const [a, b] = yearStr.split('/').map(Number);
    return `${a + 1}/${b + 1}`;
}

function setupStep4() {
    const yearInput = document.getElementById('new-academic-year');
    if (!yearInput.value) yearInput.value = incrementAcademicYear(state.config.current_academic_year);

    document.getElementById('new-semester').value = '1';

    const newYearStart = yearInput.value.split('/')[0];
    const startInput = document.getElementById('new-period-start');
    const endInput   = document.getElementById('new-period-end');
    if (!startInput.value) startInput.value = `${newYearStart}-07-01`;
    if (!endInput.value)   endInput.value   = `${newYearStart}-12-31`;

    document.getElementById('confirm-new-year-btn').disabled = state.newYearDone;
    document.getElementById('confirm-new-year-btn').onclick = onConfirmNewYear;
}

async function onConfirmNewYear() {
    const btn        = document.getElementById('confirm-new-year-btn');
    const resultArea = document.getElementById('new-year-result');

    const newAcademicYear = document.getElementById('new-academic-year').value.trim();
    const newSemester     = document.getElementById('new-semester').value;
    const startDate       = document.getElementById('new-period-start').value;
    const endDate         = document.getElementById('new-period-end').value;

    if (!/^\d{4}\/\d{4}$/.test(newAcademicYear)) {
        resultArea.innerHTML = `<div class="alert alert-danger">Format tahun ajaran harus YYYY/YYYY (contoh: 2027/2028)</div>`;
        return;
    }
    if (!startDate || !endDate || startDate >= endDate) {
        resultArea.innerHTML = `<div class="alert alert-danger">Tanggal mulai/selesai semester tidak valid</div>`;
        return;
    }

    if (!window.confirm(
        `Buka tahun ajaran ${newAcademicYear} semester ${newSemester}?\n\n` +
        `Ini akan memproses kenaikan kelas yang sudah dipetakan dan tidak dapat dibatalkan.`
    )) return;

    btn.disabled = true;
    btn.textContent = 'Memproses...';
    try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');

        const res = await fetch(`${SUPABASE_URL}/functions/v1/open-academic-year`, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
                config_id:         state.config.config_id,
                academic_year:     newAcademicYear,
                semester:          Number(newSemester),
                start_date:        startDate,
                end_date:          endDate,
                old_academic_year: state.config.current_academic_year,
                promotion_mapping: state.promotionMapping.map(m => ({
                    targetClassId:    m.targetClassId,
                    targetName:       m.targetName,
                    programId:        m.programId,
                    targetGradeLevel: m.targetGradeLevel,
                    studentIds:       m.studentIds,
                })),
            }),
        });

        const body = await res.json();
        if (!res.ok) {
            const message = body?.error?.message ?? body?.message ?? 'Terjadi kesalahan';
            throw new Error(message);
        }

        const data = body.data;

        state.newAcademicYear = newAcademicYear;
        state.newSemester     = newSemester;
        state.promotedCount   = data.enrolled_count;
        state.newYearDone     = true;

        resultArea.innerHTML = `<div class="alert alert-success">Tahun ajaran ${newAcademicYear} semester ${newSemester} aktif. ${data.enrolled_count} siswa naik kelas.</div>`;
        renderStepVisibility();
    } catch (err) {
        resultArea.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        btn.disabled = false;
        btn.textContent = 'Konfirmasi';
    }
}

// ─────────────────────────────────────────────────────────────
// LANGKAH 5 — Ringkasan
// ─────────────────────────────────────────────────────────────

function setupStep5() {
    const graduatedCount    = state.graduatedStudentIds.length;
    const notProcessedCount = state.notGraduatedStudentIds.length;
    const promotedCount     = state.promotedCount;

    document.getElementById('final-summary').innerHTML = `
        <p><strong>${graduatedCount}</strong> siswa lulus</p>
        <p><strong>${promotedCount}</strong> siswa naik kelas</p>
        ${notProcessedCount > 0
            ? `<p><strong>${notProcessedCount}</strong> siswa tidak diproses (kelas XII, tidak lulus, tidak ada jalur kenaikan kelas)</p>`
            : ''}
        <p>Tahun ajaran baru aktif: <strong>${state.newAcademicYear} Semester ${state.newSemester}</strong></p>
    `;
}

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────

(async function init() {
    const userRow = await getCurrentUserRow();
    if (!requireAdministrativeOrRedirect(userRow)) return;

    state.config = await getSchoolConfig();
    await renderStep();
})();
