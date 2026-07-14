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
        window.location.replace('dashboard.html');
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
    // Tidak filter semester — enrollment hanya dibuat di semester 1,
    // semester 2 memakai data yang sama. Ambil semua semester tahun ini,
    // filter grade_level=12 di sisi klien, deduplikasi per student_id.
    const { data, error } = await supabase
        .from('class_enrollments')
        .select('student_id, class_id, semester, students!inner(student_id, full_name, nis, student_status), classes!inner(name, grade_level, programs(name))')
        .eq('academic_year', config.current_academic_year)
        .is('withdrawn_at', null)
        .order('semester', { ascending: false });
    if (error) throw error;

    const seen = new Set();
    return data
        .filter(r => r.classes.grade_level === 12)
        .filter(r => {
            if (seen.has(r.student_id)) return false;
            seen.add(r.student_id);
            return true;
        })
        .map(r => ({
            student_id:     r.student_id,
            class_id:       r.class_id,
            full_name:      r.students.full_name,
            nis:            r.students.nis,
            student_status: r.students.student_status,
            className:      r.classes.name,
            programName:    r.classes.programs?.name ?? 'Tanpa Program',
        }));
}

async function setupStep1() {
    state.gradeXIIStudents = await fetchGradeXIIStudents(state.config);
    const students = state.gradeXIIStudents;

    // Kelompokkan per program keahlian → per kelas
    const byProgram = new Map();
    for (const s of students) {
        if (!byProgram.has(s.programName)) byProgram.set(s.programName, new Map());
        const byClass = byProgram.get(s.programName);
        if (!byClass.has(s.className)) byClass.set(s.className, []);
        byClass.get(s.className).push(s);
    }
    const programKeys = [...byProgram.keys()].sort((a, b) => a.localeCompare(b, 'id'));

    const accordionHtml = programKeys.map(prog => {
        const byClass = byProgram.get(prog);
        const progTotal = [...byClass.values()].reduce((t, arr) => t + arr.length, 0);
        const classHtml = [...byClass.keys()].sort((a, b) => a.localeCompare(b, 'id')).map(kls => {
            const list = byClass.get(kls);
            const rows = list.map(s => `<tr><td>${s.full_name}</td><td>${s.nis}</td><td>${s.student_status}</td></tr>`).join('');
            return `
                <details style="margin:4px 0 4px 16px">
                    <summary style="cursor:pointer;font-weight:600">${kls} (${list.length})</summary>
                    <table class="table" style="margin-top:4px">
                        <thead><tr><th>Nama</th><th>NIS</th><th>Status</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </details>`;
        }).join('');
        return `
            <details style="margin-bottom:8px">
                <summary style="cursor:pointer;font-weight:600">${prog} (${progTotal})</summary>
                ${classHtml}
            </details>`;
    }).join('');

    const step1 = document.querySelector('.wizard-step[data-step="1"]');
    step1.innerHTML = `
        <div class="step-label">Langkah 1 dari 5</div>
        <h3>Review Siswa Kelas XII</h3>
        <p class="hint">Siswa yang terdaftar di kelas tingkat 12 pada tahun ajaran aktif.</p>

        ${students.length === 0
            ? `<div class="alert alert-warning" style="display:block">Tidak ada siswa kelas XII pada tahun ajaran ini.</div>`
            : `${summaryCard(students.length, 'Total Siswa Kelas XII')}${accordionHtml}`
        }
    `;
}

// ─────────────────────────────────────────────────────────────
// LANGKAH 2 — Kelulusan Massal
// ─────────────────────────────────────────────────────────────

function setupStep2() {
    const students = state.gradeXIIStudents;
    const container = document.getElementById('graduation-list');

    document.getElementById('graduation-summary').innerHTML = summaryCard(students.length, 'Total Siswa Kelas XII');

    if (students.length === 0) {
        container.innerHTML = '<p class="hint">Tidak ada siswa untuk diluluskan.</p>';
    } else {
        // Kelompokkan per program → per kelas
        const byProgram = new Map();
        for (const s of students) {
            if (!byProgram.has(s.programName)) byProgram.set(s.programName, new Map());
            const byClass = byProgram.get(s.programName);
            if (!byClass.has(s.className)) byClass.set(s.className, []);
            byClass.get(s.className).push(s);
        }
        const programKeys = [...byProgram.keys()].sort((a, b) => a.localeCompare(b, 'id'));

        container.innerHTML = programKeys.map(prog => {
            const byClass = byProgram.get(prog);
            const progTotal = [...byClass.values()].reduce((t, arr) => t + arr.length, 0);
            const classHtml = [...byClass.keys()].sort((a, b) => a.localeCompare(b, 'id')).map(kls => {
                const list = byClass.get(kls);
                const rows = list.map(s => `
                    <tr>
                        <td style="width:36px"><input type="checkbox" class="grad-checkbox" data-student-id="${s.student_id}" checked /></td>
                        <td>${s.full_name}</td><td>${s.nis}</td>
                    </tr>`).join('');
                return `
                    <details style="margin:4px 0 4px 16px">
                        <summary style="cursor:pointer;font-weight:600">${kls} (${list.length})</summary>
                        <table class="table" style="margin-top:4px">
                            <thead><tr><th></th><th>Nama</th><th>NIS</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </details>`;
            }).join('');
            return `
                <details style="margin-bottom:8px">
                    <summary style="cursor:pointer;font-weight:600">${prog} (${progTotal})</summary>
                    ${classHtml}
                </details>`;
        }).join('');
    }

    // Deteksi kelulusan sudah dilakukan sebelumnya (mis. setelah hard reload)
    const alreadyGraduated = students.length > 0 && students.every(s => s.student_status === 'LULUS');
    if (alreadyGraduated) state.graduationDone = true;

    document.querySelectorAll('.grad-checkbox').forEach(cb => cb.addEventListener('change', updateGraduationPreview));
    updateGraduationPreview();

    const confirmBtn = document.getElementById('confirm-graduation-btn');
    if (state.graduationDone) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Kelulusan Terkonfirmasi';
    } else {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Konfirmasi Kelulusan';
        confirmBtn.onclick = onConfirmGraduation;
    }
}

function updateGraduationPreview() {
    const total      = state.gradeXIIStudents.length;
    const checkedEls = [...document.querySelectorAll('.grad-checkbox:checked')];
    const checked    = checkedEls.length;
    const notChecked = total - checked;

    // Hitung per program dari checkbox yang tercentang
    const byProgram = new Map();
    for (const cb of checkedEls) {
        const s = state.gradeXIIStudents.find(x => x.student_id === cb.dataset.studentId);
        if (!s) continue;
        byProgram.set(s.programName, (byProgram.get(s.programName) ?? 0) + 1);
    }
    const programRows = [...byProgram.entries()]
        .sort(([a], [b]) => a.localeCompare(b, 'id'))
        .map(([prog, n]) => `<li>${prog}: <strong>${n} siswa</strong></li>`)
        .join('');

    document.getElementById('graduation-preview').innerHTML = `
        <div class="alert alert-warning" style="display:block;margin-top:16px">
            <strong>⚠️ Periksa sebelum konfirmasi — tindakan ini tidak dapat dibatalkan.</strong><br>
            Akan diluluskan: <strong>${checked} siswa</strong>${notChecked > 0 ? `, tidak diluluskan: <strong>${notChecked} siswa</strong>` : ''}.
            <ul style="margin:8px 0 0 16px;padding:0">${programRows}</ul>
        </div>`;
}

async function onConfirmGraduation() {
    const btn        = document.getElementById('confirm-graduation-btn');
    const resultArea = document.getElementById('graduation-result');
    const checkedIds = [...document.querySelectorAll('.grad-checkbox:checked')].map(cb => cb.dataset.studentId);

    if (!window.confirm(`Luluskan ${checkedIds.length} siswa?\n\nPastikan jumlah sudah benar. Tindakan ini TIDAK DAPAT DIBATALKAN.`)) return;

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
        btn.disabled = true;
        btn.textContent = 'Kelulusan Terkonfirmasi';

        resultArea.innerHTML = `<div class="alert alert-success" style="display:block">✅ ${checkedIds.length} siswa berhasil diluluskan. Lanjutkan ke Kenaikan Kelas.</div>`;
        resultArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        renderStepVisibility();
    } catch (err) {
        resultArea.innerHTML = `<div class="alert alert-danger" style="display:block">❌ Gagal: ${err.message}</div>`;
        resultArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.disabled = false;
        btn.textContent = 'Konfirmasi Kelulusan';
    }
}

// ─────────────────────────────────────────────────────────────
function summaryCard(number, label) {
    return `<div style="padding:14px 20px;border-radius:8px;background:#eff6ff;border:1px solid #bfdbfe;display:inline-block;margin-bottom:20px">
        <div style="font-size:32px;font-weight:700;color:var(--color-primary)">${number}</div>
        <div style="font-size:12px;color:var(--color-text-muted);margin-top:2px">${label}</div>
    </div>`;
}

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
        .select('class_id, name, program_id, grade_level, programs(name)')
        .eq('academic_year', config.current_academic_year)
        .in('grade_level', [10, 11]);
    if (classErr) throw classErr;

    // Fetch kelas tujuan: kelas grade 11 dan 12 yang sudah ada (tahun ajaran saat ini).
    // Kelas adalah entitas permanen — tidak dibuat ulang tiap tahun.
    // Hanya enrollment siswa yang berubah per tahun ajaran.
    const { data: nextClasses, error: nextErr } = await supabase
        .from('classes')
        .select('class_id, name, grade_level')
        .eq('academic_year', config.current_academic_year)
        .in('grade_level', [11, 12]);
    if (nextErr) throw nextErr;

    // Map nama kelas tujuan → { class_id, grade_level } (untuk validasi
    // dan pengelompokan per tingkat tanpa query tambahan per kelas)
    const nextClassMap = new Map(
        (nextClasses ?? []).map(c => [
            c.name.trim().toUpperCase(),
            { class_id: c.class_id, grade_level: c.grade_level, displayName: c.name },
        ])
    );

    // Fetch enrollments — tidak filter semester (enrollment hanya di sem 1,
    // deduplikasi per student+class agar tidak dobel jika ada 2 semester)
    const { data: enrollments, error: enrollErr } = await supabase
        .from('class_enrollments')
        .select('student_id, class_id')
        .eq('academic_year', config.current_academic_year)
        .is('withdrawn_at', null);
    if (enrollErr) throw enrollErr;

    const studentsByClass = new Map();
    const seenEnroll = new Set();
    for (const e of enrollments) {
        const key = `${e.student_id}:${e.class_id}`;
        if (seenEnroll.has(key)) continue;
        seenEnroll.add(key);
        if (!studentsByClass.has(e.class_id)) studentsByClass.set(e.class_id, []);
        studentsByClass.get(e.class_id).push(e.student_id);
    }

    return {
        nextAcademicYear,
        nextClassMap,
        classes: classes.map(c => ({
            ...c,
            programName:   c.programs?.name ?? 'Tanpa Program',
            studentIds:    studentsByClass.get(c.class_id) ?? [],
            suggestedName: suggestNextClassName(c.name),
        })),
    };
}

function promotionLsKey() {
    return `promotionDone_${state.config.school_id}_${state.config.current_academic_year}`;
}

async function setupStep3() {
    const { nextAcademicYear, nextClassMap, classes } =
        await fetchPromotableClasses(state.config);

    state.sourceClasses    = classes;
    state.nextAcademicYear = nextAcademicYear;
    state.nextClassMap     = nextClassMap;

    // Pulihkan status konfirmasi dari localStorage setelah hard reload
    const saved = localStorage.getItem(promotionLsKey());
    if (saved) {
        try {
            state.promotionMapping = JSON.parse(saved);
            state.promotionDone    = true;
        } catch (_) { localStorage.removeItem(promotionLsKey()); }
    }

    // Kelompokkan kelas tujuan per tingkat dari nextClassMap
    // grade 10 → butuh grade 11, grade 11 → butuh grade 12
    const nextClassesByGrade = new Map();
    for (const [upperName, { class_id, grade_level, displayName }] of nextClassMap) {
        if (!nextClassesByGrade.has(grade_level))
            nextClassesByGrade.set(grade_level, []);
        nextClassesByGrade.get(grade_level).push({ name: upperName, displayName, class_id });
    }

    const container = document.getElementById('promotion-list');
    const totalPromotable = state.sourceClasses.reduce((t, c) => t + c.studentIds.length, 0);
    document.getElementById('promotion-summary').innerHTML = summaryCard(totalPromotable, 'Total Siswa Naik Kelas');
    let allValid = true;

    if (state.sourceClasses.length === 0) {
        container.innerHTML = '<p class="hint">Tidak ada kelas tingkat 10/11.</p>';
    } else {
        // Kelompokkan per program keahlian
        const byProgram = new Map();
        for (const c of state.sourceClasses) {
            if (!byProgram.has(c.programName)) byProgram.set(c.programName, []);
            byProgram.get(c.programName).push(c);
        }
        const programKeys = [...byProgram.keys()].sort((a, b) => a.localeCompare(b, 'id'));

        container.innerHTML = programKeys.map(prog => {
            const classList = byProgram.get(prog)
                .sort((a, b) => a.grade_level - b.grade_level || a.name.localeCompare(b.name, 'id'));

            const rows = classList.map(c => {
                const targetGrade = c.grade_level + 1;
                const options     = nextClassesByGrade.get(targetGrade) ?? [];
                const suggested   = options.find(o =>
                    o.name === suggestNextClassName(c.name).trim().toUpperCase()
                ) ?? options[0];
                const hasOptions  = options.length > 0;
                if (!hasOptions) allValid = false;

                const rowStyle = hasOptions ? '' : 'background:var(--color-danger-light,#fff0f0)';
                return `
                    <tr style="${rowStyle}">
                        <td>${c.name} (Kelas ${c.grade_level})</td>
                        <td>${c.studentIds.length}</td>
                        <td>
                            ${hasOptions
                                ? `<select class="input promotion-target-select" data-source-class-id="${c.class_id}">
                                       <option value="">-- Pilih Kelas Tujuan --</option>
                                       ${options.map(o => `<option value="${o.class_id}" ${suggested && o.name === suggested.name ? 'selected' : ''}>${o.displayName}</option>`).join('')}
                                   </select>`
                                : `<span style="color:var(--color-danger)">Tidak ada kelas tujuan</span>`}
                        </td>
                    </tr>`;
            }).join('');

            const progTotal = classList.reduce((t, c) => t + c.studentIds.length, 0);
            return `
                <details style="margin-bottom:8px">
                    <summary style="cursor:pointer;font-weight:600">${prog} (${progTotal} siswa)</summary>
                    <table class="table" style="margin-top:4px">
                        <thead><tr><th>Kelas Asal</th><th>Jumlah</th><th>Kelas Tujuan</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </details>`;
        }).join('');
    }

    updatePromotionPreview();

    const confirmBtn = document.getElementById('confirm-promotion-btn');
    confirmBtn.disabled = !allValid || state.promotionDone;
    confirmBtn.onclick  = onConfirmPromotion;

    if (state.promotionDone) {
        const totalStudents = state.promotionMapping.reduce((s, m) => s + m.studentIds.length, 0);
        document.getElementById('promotion-result').innerHTML =
            `<div class="alert alert-success" style="display:block">✅ Pemetaan kenaikan kelas untuk ${totalStudents} siswa telah dikonfirmasi. Lanjutkan ke Tahun Ajaran Baru.</div>`;
    }

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

function updatePromotionPreview() {
    const total = state.sourceClasses.reduce((s, c) => s + c.studentIds.length, 0);
    if (total === 0) return;

    const byProgram = {};
    for (const c of state.sourceClasses) {
        byProgram[c.programName] = (byProgram[c.programName] ?? 0) + c.studentIds.length;
    }
    const programRows = Object.entries(byProgram)
        .map(([prog, n]) => `<li>${prog}: <strong>${n} siswa</strong></li>`)
        .join('');

    document.getElementById('promotion-preview').innerHTML = `
        <div class="alert alert-warning" style="display:block;margin-top:16px">
            <strong>⚠️ Periksa sebelum konfirmasi — tindakan ini tidak dapat dibatalkan.</strong><br>
            Akan dinaikkan kelas: <strong>${total} siswa</strong>.
            <ul style="margin:8px 0 0 16px;padding:0">${programRows}</ul>
        </div>`;
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
    localStorage.setItem(promotionLsKey(), JSON.stringify(mapping));

    resultArea.innerHTML = `<div class="alert alert-success" style="display:block">✅ Pemetaan kenaikan kelas untuk ${totalStudents} siswa telah dikonfirmasi. Lanjutkan ke Tahun Ajaran Baru.</div>`;
    resultArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

    const totalPromo = state.sourceClasses.reduce((s, c) => s + c.studentIds.length, 0);
    const byProgram  = {};
    for (const c of state.sourceClasses) {
        byProgram[c.programName] = (byProgram[c.programName] ?? 0) + c.studentIds.length;
    }
    const programRows = Object.entries(byProgram)
        .map(([prog, n]) => `<li>${prog}: <strong>${n} siswa</strong></li>`)
        .join('');

    const newYear = document.getElementById('new-academic-year').value || '—';
    document.getElementById('new-year-preview').innerHTML = `
        <div class="alert alert-warning" style="display:block;margin-top:16px">
            <strong>⚠️ Periksa sebelum konfirmasi — tindakan ini tidak dapat dibatalkan.</strong><br>
            Akan dibuka tahun ajaran <strong>${newYear}</strong> dan <strong>${totalPromo} siswa</strong> dipindahkan ke kelas barunya.
            <ul style="margin:8px 0 0 16px;padding:0">${programRows}</ul>
        </div>`;
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

        btn.textContent = 'Terkonfirmasi';
        resultArea.innerHTML = `<div class="alert alert-success" style="display:block">✅ Tahun ajaran ${newAcademicYear} semester ${newSemester} aktif. ${data.enrolled_count} siswa naik kelas.</div>`;
        resultArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        renderStepVisibility();
    } catch (err) {
        resultArea.innerHTML = `<div class="alert alert-danger" style="display:block">❌ Gagal: ${err.message}</div>`;
        resultArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

    const canProceed = await checkSemestersClosed(state.config);
    if (!canProceed) return;

    await renderStep();
})();

async function checkSemestersClosed(config) {
    const { data: periods, error } = await supabase
        .from('academic_periods')
        .select('semester, status')
        .eq('academic_year', config.current_academic_year);
    if (error) {
        document.querySelector('.wizard-panel').innerHTML = `
            <div class="alert alert-danger">Gagal memeriksa status semester: ${error.message}</div>`;
        return false;
    }

    const sem1 = periods?.find(p => p.semester === '1');
    const sem2 = periods?.find(p => p.semester === '2');

    const sem1Closed = sem1?.status === 'CLOSED';
    const sem2Closed = sem2?.status === 'CLOSED';

    if (!sem1Closed || !sem2Closed) {
        const missing = [];
        if (!sem1Closed) missing.push('Semester 1');
        if (!sem2Closed) missing.push('Semester 2');

        document.querySelector('.wizard-panel').innerHTML = `
            <div class="alert alert-danger" style="margin:2rem;">
                <h3 style="margin-top:0">Tidak Dapat Melanjutkan</h3>
                <p>
                    <strong>${missing.join(' dan ')}</strong> tahun ajaran
                    ${config.current_academic_year} belum ditutup.
                </p>
                <p>
                    Tutup kedua semester terlebih dahulu melalui menu
                    <strong>Tutup Semester</strong> di dashboard sebelum
                    memulai wizard Tutup Tahun Ajaran.
                </p>
                <a href="dashboard.html" class="btn btn-primary" style="margin-top:1rem;">
                    Kembali ke Dashboard
                </a>
            </div>`;
        nextBtn.style.display = 'none';
        backBtn.style.display = 'none';
        return false;
    }
    return true;
}
