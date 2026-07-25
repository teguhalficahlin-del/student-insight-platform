/**
 * @file admin/js/schedule-builder.js
 *
 * Overlay penyusun jadwal visual. TU menyusun jadwal per hari
 * dalam grid: baris = slot waktu, kolom = kelas.
 * Setiap sel punya 2 input: mapel (teks bebas) + kode guru (autocomplete).
 * Sistem hanya validasi bentrok: 1 guru tidak boleh di 2 kelas pada jam sama.
 */

import {
    supabase, fetchAllRows,
    getSchoolConfig, getClasses, getTeacherList,
    getTimeSlots, saveTimeSlots,
    getScheduleTemplates, saveScheduleTemplates,
    applyScheduleTemplates, reapplyScheduleTemplates,
    getCoreSubjectsForSchedule,
    getSubjectCodeAliases, upsertSubjectCodeAlias, deleteSubjectCodeAlias,
} from './api.js';

const DAYS = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
const DAY_LABELS = { SENIN: 'Senin', SELASA: 'Selasa', RABU: 'Rabu', KAMIS: 'Kamis', JUMAT: 'Jumat', SABTU: 'Sabtu' };
const GRADES = [10, 11, 12];
const GRADE_LABELS = { 10: 'Kelas X', 11: 'Kelas XI', 12: 'Kelas XII' };

let overlayEl = null;
let loadSeq = 0; // monotonic counter to cancel stale async loads
let state = {
    academicYear: null,
    semester: null,
    schoolId: null,
    day: 'SENIN',
    grade: 10,
    slots: [],       // { start_time, end_time, is_break, break_label }
    classes: [],     // { class_id, name }
    teachers: [],    // { user_id, full_name, teacher_code }
    teacherMap: new Map(), // teacher_code → user_id
    teacherIdMap: new Map(), // user_id → teacher_code
    cells: new Map(),  // `${slotIdx}_${classId}` → { mapel, teacher_code }
    coreSubjects: [], // { name, code } dari v_core_subjects untuk datalist
    dirty: false,
};

export async function openScheduleBuilder() {
    const config = await getSchoolConfig();
    if (!config?.current_academic_year || !config?.current_semester) {
        alert('Tahun ajaran atau semester belum diset.');
        return;
    }

    state.academicYear = config.current_academic_year;
    state.semester = config.current_semester;
    state.schoolId = config.school_id;

    state.teachers = await getTeacherList();
    state.teacherMap = new Map(state.teachers.filter(t => t.teacher_code).map(t => [t.teacher_code.toUpperCase(), t.user_id]));
    state.teacherIdMap = new Map(state.teachers.filter(t => t.teacher_code).map(t => [t.user_id, t.teacher_code]));
    try { state.coreSubjects = await getCoreSubjectsForSchedule(); } catch (_) { state.coreSubjects = []; }

    createOverlay();
    await loadDay();
}

function createOverlay() {
    if (overlayEl) overlayEl.remove();

    overlayEl = document.createElement('div');
    overlayEl.className = 'sched-overlay';
    overlayEl.innerHTML = `
        <div class="sched-container">
            <div class="sched-header">
                <h3>Susun Jadwal — ${state.academicYear} Semester ${state.semester}</h3>
                <button type="button" class="btn btn-secondary sched-close">✕ Tutup</button>
            </div>

            <div class="sched-panel-tabs">
                <button type="button" class="sched-ptab active" data-panel="jadwal">📅 Jadwal</button>
                <button type="button" class="sched-ptab" data-panel="kode-mapel">🗺 Kode Mapel</button>
                <button type="button" class="sched-ptab" data-panel="kode-guru">👤 Kode Guru</button>
            </div>

            <div id="sched-panel-jadwal">
                <div class="sched-toolbar">
                    <div class="sched-grade-tabs" id="sched-grade-tabs">
                        ${GRADES.map(g => `<button type="button" class="sched-tab ${g === state.grade ? 'active' : ''}" data-grade="${g}">${GRADE_LABELS[g]}</button>`).join('')}
                    </div>
                    <button type="button" class="btn btn-secondary" id="sched-add-slot" style="padding:6px 12px">+ Slot Mengajar</button>
                    <button type="button" class="btn btn-secondary" id="sched-add-break" style="padding:6px 12px">+ Istirahat/Kegiatan</button>
                    <span class="sched-conflict-count" id="sched-conflict-count"></span>
                    <button type="button" class="btn btn-primary" id="sched-save" style="padding:6px 16px;margin-left:auto">Simpan</button>
                    <button type="button" class="btn btn-success" id="sched-apply" style="padding:6px 16px" title="Generate jadwal harian dari template yang sudah disimpan. Tidak mengubah sesi yang sudah ada.">Terapkan Jadwal</button>
                    <button type="button" class="btn btn-warning" id="sched-reapply" style="padding:6px 16px" title="Hapus sesi masa depan (tanpa absensi) lalu generate ulang dari template terkini. Gunakan setelah ganti guru atau ubah slot jadwal.">Terapkan Ulang</button>
                </div>

                <div class="sched-body">
                    <div class="sched-sidebar" id="sched-day-tabs">
                        ${DAYS.map(d => `<button type="button" class="sched-day-btn ${d === state.day ? 'active' : ''}" data-day="${d}">${DAY_LABELS[d]}</button>`).join('')}
                    </div>

                    <div class="sched-main">
                        <div class="sched-grid-wrapper" id="sched-grid-wrapper">
                            <p class="hint" style="padding:20px;text-align:center">Memuat...</p>
                        </div>

                        <div id="sched-status" class="sched-status"></div>
                    </div>
                </div>
            </div>

            <div id="sched-panel-kode-mapel" style="display:none;padding:20px">
                <p class="hint" style="text-align:center">Memuat...</p>
            </div>

            <div id="sched-panel-kode-guru" style="display:none;padding:20px">
                <p class="hint" style="text-align:center">Memuat...</p>
            </div>
        </div>
    `;

    document.body.appendChild(overlayEl);

    overlayEl.querySelector('.sched-close').addEventListener('click', closeOverlay);

    overlayEl.querySelector('.sched-panel-tabs').addEventListener('click', e => {
        const panel = e.target.dataset?.panel;
        if (!panel) return;
        overlayEl.querySelectorAll('.sched-ptab').forEach(t => t.classList.toggle('active', t.dataset.panel === panel));
        overlayEl.querySelectorAll('[id^="sched-panel-"]').forEach(p => { p.style.display = 'none'; });
        overlayEl.querySelector(`#sched-panel-${panel}`).style.display = '';
        if (panel === 'kode-mapel') renderKodeMapelPanel();
        if (panel === 'kode-guru') renderKodeGuruPanel();
    });
    overlayEl.querySelector('#sched-add-slot').addEventListener('click', () => addRow(false));
    overlayEl.querySelector('#sched-add-break').addEventListener('click', () => addRow(true));
    overlayEl.querySelector('#sched-save').addEventListener('click', save);
    overlayEl.querySelector('#sched-apply').addEventListener('click', applyTemplates);
    overlayEl.querySelector('#sched-reapply').addEventListener('click', reapplyTemplates);

    overlayEl.querySelector('#sched-day-tabs').addEventListener('click', async (e) => {
        const day = e.target.dataset?.day;
        if (!day || day === state.day) return;
        if (state.dirty && !confirm('Ada perubahan belum disimpan. Pindah hari?')) return;
        state.day = day;
        overlayEl.querySelectorAll('#sched-day-tabs .sched-day-btn').forEach(t => t.classList.toggle('active', t.dataset.day === day));
        await loadDay();
    });

    overlayEl.querySelector('#sched-grade-tabs').addEventListener('click', async (e) => {
        const grade = Number(e.target.dataset?.grade);
        if (!grade || grade === state.grade) return;
        state.grade = grade;
        overlayEl.querySelectorAll('#sched-grade-tabs .sched-tab').forEach(t => t.classList.toggle('active', Number(t.dataset.grade) === grade));
        await loadGrade();
    });
}

function closeOverlay() {
    if (state.dirty && !confirm('Ada perubahan belum disimpan. Tutup?')) return;
    overlayEl?.remove();
    overlayEl = null;
}

async function loadDay() {
    const seq = ++loadSeq;
    state.slots = [];
    state.cells = new Map();

    const [timeSlots, templates] = await Promise.all([
        getTimeSlots(state.academicYear, state.semester, state.day),
        getScheduleTemplates(state.academicYear, state.semester, state.day),
    ]);

    if (seq !== loadSeq) return; // a newer load was triggered, discard this result

    state.slots = timeSlots.map(s => ({
        start_time: s.start_time?.slice(0, 5),
        end_time: s.end_time?.slice(0, 5),
        is_break: s.is_break,
        break_label: s.break_label,
    }));

    for (const t of templates) {
        const slotIdx = state.slots.findIndex(s =>
            !s.is_break && s.start_time === t.start_time?.slice(0, 5) && s.end_time === t.end_time?.slice(0, 5)
        );
        if (slotIdx >= 0) {
            const key = `${slotIdx}_${t.class_id}`;
            state.cells.set(key, {
                mapel: t.subject_label ?? '',
                teacher_code: state.teacherIdMap.get(t.teacher_id) ?? '',
            });
        }
    }

    sortSlots();   // tampilkan baris urut waktu (istirahat di posisi yang benar)
    state.dirty = false;
    await loadGrade(seq);
}

async function loadGrade(seq) {
    // When called from a grade-tab click (not from loadDay), take a new sequence slot
    if (seq === undefined) seq = ++loadSeq;

    const classes = await getClasses(state.academicYear);

    if (seq !== loadSeq) return; // stale

    state.classes = classes
        .filter(c => c.grade_level === state.grade)
        .sort((a, b) => a.name.localeCompare(b.name, 'id'));
    renderGrid();
}

function clampTime(h, m) {
    const totalMin = Math.min(h * 60 + m, 23 * 60 + 59);
    return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
}

function addRow(isBreak) {
    const lastSlot = state.slots[state.slots.length - 1];
    const defaultStart = lastSlot?.end_time ?? '07:00';
    const [h, m] = defaultStart.split(':').map(Number);
    const defaultEnd = clampTime(h, m + 40);

    state.slots.push({
        start_time: defaultStart,
        end_time: defaultEnd,
        is_break: isBreak,
        break_label: isBreak ? 'ISTIRAHAT' : null,
    });
    state.dirty = true;
    sortSlots();
    renderGrid();
}

function removeRow(idx) {
    state.slots.splice(idx, 1);
    // Re-key cells
    const newCells = new Map();
    for (const [key, val] of state.cells) {
        const [si, cid] = key.split('_');
        const sIdx = Number(si);
        if (sIdx === idx) continue;
        const newIdx = sIdx > idx ? sIdx - 1 : sIdx;
        newCells.set(`${newIdx}_${cid}`, val);
    }
    state.cells = newCells;
    state.dirty = true;
    renderGrid();
}

// Jaga agar state.slots selalu urut berdasarkan waktu mulai, lalu re-key
// state.cells (yang memakai index slot) agar tetap menunjuk slot yang benar.
// Tanpa ini, baris ISTIRAHAT/kegiatan yang ditambah belakangan menumpuk di
// bawah meski waktunya di tengah hari.
function sortSlots() {
    const indexed = state.slots.map((slot, oldIdx) => ({ slot, oldIdx }));
    indexed.sort((a, b) => {
        const s = (a.slot.start_time ?? '').localeCompare(b.slot.start_time ?? '');
        return s !== 0 ? s : (a.slot.end_time ?? '').localeCompare(b.slot.end_time ?? '');
    });
    const oldToNew = new Map();
    indexed.forEach((e, newIdx) => oldToNew.set(e.oldIdx, newIdx));
    state.slots = indexed.map(e => e.slot);

    const newCells = new Map();
    for (const [key, val] of state.cells) {
        const [si, cid] = key.split('_');
        const newIdx = oldToNew.get(Number(si));
        if (newIdx === undefined) continue;
        newCells.set(`${newIdx}_${cid}`, val);
    }
    state.cells = newCells;
}

function renderGrid() {
    const wrapper = overlayEl.querySelector('#sched-grid-wrapper');

    if (state.slots.length === 0) {
        wrapper.innerHTML = '<p class="hint" style="padding:20px;text-align:center">Belum ada slot waktu. Klik "+ Slot Mengajar" untuk menambahkan.</p>';
        return;
    }

    const colCount = state.classes.length;
    let html = '<table class="sched-table"><thead><tr>';
    html += '<th class="sched-th-no">No</th>';
    html += '<th class="sched-th-time">Waktu</th>';
    state.classes.forEach(c => {
        html += `<th class="sched-th-class" colspan="2">${esc(c.name)}</th>`;
    });
    html += '<th class="sched-th-del"></th></tr>';

    // Sub-header
    html += '<tr><th></th><th></th>';
    state.classes.forEach(() => {
        html += '<th class="sched-sub">Mapel</th><th class="sched-sub">KG</th>';
    });
    html += '<th></th></tr></thead><tbody>';

    let slotNo = 0;
    state.slots.forEach((slot, idx) => {
        if (slot.is_break) {
            html += `<tr class="sched-break-row">`;
            html += `<td></td>`;
            html += `<td class="sched-time-cell">
                <input type="time" class="sched-time-input" value="${slot.start_time}" data-idx="${idx}" data-field="start_time" />
                <span class="sched-time-sep">—</span>
                <input type="time" class="sched-time-input" value="${slot.end_time}" data-idx="${idx}" data-field="end_time" />
            </td>`;
            html += `<td colspan="${colCount * 2}" class="sched-break-label">
                <input type="text" class="sched-break-input" value="${esc(slot.break_label ?? '')}" data-idx="${idx}" placeholder="ISTIRAHAT" />
            </td>`;
            html += `<td><button type="button" class="sched-del-row" data-idx="${idx}">✕</button></td>`;
            html += '</tr>';
        } else {
            slotNo++;
            html += `<tr class="sched-slot-row">`;
            html += `<td class="sched-no">${slotNo}</td>`;
            html += `<td class="sched-time-cell">
                <input type="time" class="sched-time-input" value="${slot.start_time}" data-idx="${idx}" data-field="start_time" />
                <span class="sched-time-sep">—</span>
                <input type="time" class="sched-time-input" value="${slot.end_time}" data-idx="${idx}" data-field="end_time" />
            </td>`;

            state.classes.forEach(c => {
                const key = `${idx}_${c.class_id}`;
                const cell = state.cells.get(key) ?? { mapel: '', teacher_code: '' };
                html += `<td class="sched-cell-mapel"><input type="text" class="sched-input sched-mapel" data-key="${key}" value="${esc(cell.mapel)}" placeholder="—" list="sched-subjects" /></td>`;
                html += `<td class="sched-cell-kg"><input type="text" class="sched-input sched-kg" data-key="${key}" value="${esc(cell.teacher_code)}" placeholder="—" list="sched-teachers" /></td>`;
            });

            html += `<td><button type="button" class="sched-del-row" data-idx="${idx}">✕</button></td>`;
            html += '</tr>';
        }
    });

    html += '</tbody></table>';

    // Datalist for teacher autocomplete
    html += '<datalist id="sched-teachers">';
    state.teachers.forEach(t => {
        if (t.teacher_code) html += `<option value="${esc(t.teacher_code)}" label="${esc(t.full_name)}">`;
    });
    html += '</datalist>';

    // Datalist for mapel autocomplete (nama dari core.subjects)
    html += '<datalist id="sched-subjects">';
    state.coreSubjects.forEach(cs => {
        html += `<option value="${esc(cs.name)}">`;
    });
    html += '</datalist>';

    wrapper.innerHTML = html;
    wireGridEvents();
    checkConflicts();
}

function wireGridEvents() {
    // Time inputs — sinkronisasi: end_time baris N = start_time baris N+1
    overlayEl.querySelectorAll('.sched-time-input').forEach(input => {
        input.addEventListener('change', () => {
            const idx = Number(input.dataset.idx);
            const field = input.dataset.field;
            state.slots[idx][field] = input.value;
            state.dirty = true;

            // Sinkronisasi waktu antar baris bersebelahan (array selalu urut waktu).
            if (field === 'end_time' && idx + 1 < state.slots.length) {
                state.slots[idx + 1].start_time = input.value;
            }
            if (field === 'start_time' && idx > 0) {
                state.slots[idx - 1].end_time = input.value;
            }
            // Urutkan ulang agar baris (mis. istirahat yang waktunya diubah)
            // langsung pindah ke posisi kronologis yang benar.
            sortSlots();
            renderGrid();
        });
    });

    // Break label
    overlayEl.querySelectorAll('.sched-break-input').forEach(input => {
        input.addEventListener('change', () => {
            const idx = Number(input.dataset.idx);
            state.slots[idx].break_label = input.value;
            state.dirty = true;
        });
    });

    // Mapel inputs
    overlayEl.querySelectorAll('.sched-mapel').forEach(input => {
        input.addEventListener('input', () => {
            const key = input.dataset.key;
            if (!state.cells.has(key)) state.cells.set(key, { mapel: '', teacher_code: '' });
            state.cells.get(key).mapel = input.value;
            state.dirty = true;
        });
    });

    // KG (kode guru) inputs
    overlayEl.querySelectorAll('.sched-kg').forEach(input => {
        input.addEventListener('input', () => {
            const key = input.dataset.key;
            if (!state.cells.has(key)) state.cells.set(key, { mapel: '', teacher_code: '' });
            state.cells.get(key).teacher_code = input.value.toUpperCase();
            input.value = input.value.toUpperCase();
            state.dirty = true;
            checkConflicts();
        });
    });

    // Delete row
    overlayEl.querySelectorAll('.sched-del-row').forEach(btn => {
        btn.addEventListener('click', () => removeRow(Number(btn.dataset.idx)));
    });

    // Multi-cell paste
    const gridTable = overlayEl.querySelector('.sched-table');
    if (gridTable) gridTable.addEventListener('paste', handleGridPaste);
}

function checkConflicts() {
    const conflicts = new Map(); // `${slotIdx}_${teacherCode}` → [classNames]

    for (const [key, cell] of state.cells) {
        if (!cell.teacher_code) continue;
        const [slotIdxStr, classId] = key.split('_');
        const conflictKey = `${slotIdxStr}_${cell.teacher_code}`;
        if (!conflicts.has(conflictKey)) conflicts.set(conflictKey, []);
        const cls = state.classes.find(c => c.class_id === classId);
        conflicts.get(conflictKey).push({ classId, className: cls?.name ?? '?' });
    }

    // Reset all
    overlayEl.querySelectorAll('.sched-kg').forEach(input => {
        input.classList.remove('sched-conflict');
        input.title = '';
    });

    let conflictCount = 0;
    for (const [conflictKey, entries] of conflicts) {
        if (entries.length <= 1) continue;
        conflictCount++;
        const [slotIdxStr, teacherCode] = conflictKey.split('_');
        const classNames = entries.map(e => e.className).join(', ');

        entries.forEach(e => {
            const key = `${slotIdxStr}_${e.classId}`;
            const input = overlayEl.querySelector(`.sched-kg[data-key="${key}"]`);
            if (input) {
                input.classList.add('sched-conflict');
                input.title = `Bentrok: ${teacherCode} ada di ${classNames}`;
            }
        });
    }

    const countEl = overlayEl.querySelector('#sched-conflict-count');
    if (conflictCount > 0) {
        countEl.textContent = `⚠ ${conflictCount} bentrok`;
        countEl.style.color = 'var(--color-danger)';
    } else {
        countEl.textContent = '✓ Tidak ada bentrok';
        countEl.style.color = 'var(--color-success)';
    }
}

async function save() {
    const saveBtn = overlayEl.querySelector('#sched-save');
    const statusEl = overlayEl.querySelector('#sched-status');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Menyimpan...';
    statusEl.textContent = '';

    try {
        // Save time slots
        await saveTimeSlots(state.academicYear, state.semester, state.day, state.slots);

        // Build templates from cells (all grades, not just current view)
        // Load ALL classes for this academic year to include other grades' data
        const allClasses = await getClasses(state.academicYear);
        const allClassIds = new Set(allClasses.map(c => c.class_id));

        const templates = [];
        for (const [key, cell] of state.cells) {
            if (!cell.teacher_code) continue;
            const [slotIdxStr, classId] = key.split('_');
            const slotIdx = Number(slotIdxStr);
            const slot = state.slots[slotIdx];
            if (!slot || slot.is_break) continue;
            if (!allClassIds.has(classId)) continue;

            const teacherId = state.teacherMap.get(cell.teacher_code.toUpperCase());
            if (!teacherId) continue;

            templates.push({
                start_time: slot.start_time,
                end_time: slot.end_time,
                class_id: classId,
                teacher_id: teacherId,
                subject_label: cell.mapel || null,
            });
        }

        await saveScheduleTemplates(state.academicYear, state.semester, state.day, templates);

        state.dirty = false;
        statusEl.textContent = `Tersimpan: ${templates.length} slot untuk hari ${DAY_LABELS[state.day]}`;
        statusEl.style.color = 'var(--color-success)';
    } catch (err) {
        statusEl.textContent = `Gagal: ${err.message}`;
        statusEl.style.color = 'var(--color-danger)';
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Simpan';
    }
}

async function checkAllConflicts() {
    // fetchAllRows menembus batas 1000 baris PostgREST default
    // (36 kelas × 10 slot × 6 hari = ~2160 template)
    const data = await fetchAllRows('schedule_templates',
        q => q.select('day_of_week, start_time, teacher_id')
              .eq('academic_year', state.academicYear)
              .eq('semester', state.semester));

    const counts = new Map();
    for (const t of data) {
        const key = `${t.day_of_week}_${t.start_time}_${t.teacher_id}`;
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.values()].filter(n => n > 1).length;
}

async function applyTemplates() {
    if (state.dirty) {
        if (!confirm('Ada perubahan yang belum disimpan. Simpan dulu sebelum menerapkan?')) return;
        await save();
        if (state.dirty) return; // save gagal
    }

    const applyBtn = overlayEl.querySelector('#sched-apply');
    const statusEl = overlayEl.querySelector('#sched-status');
    applyBtn.disabled = true;
    applyBtn.textContent = 'Memeriksa bentrok...';
    statusEl.textContent = '';

    try {
        const conflictCount = await checkAllConflicts();
        if (conflictCount > 0) {
            statusEl.textContent =
                `✗ Tidak dapat diterapkan — ditemukan ${conflictCount} bentrok jadwal ` +
                `(guru sama, jam sama, kelas berbeda). Perbaiki semua bentrok terlebih dahulu.`;
            statusEl.style.color = 'var(--color-danger)';
            applyBtn.disabled = false;
            applyBtn.textContent = 'Terapkan Jadwal';
            applyBtn.style.background = '';
            return;
        }

        applyBtn.textContent = 'Menerapkan...';
        const result = await applyScheduleTemplates();
        const newSessions = result.schedules_generated ?? 0;
        const totalSessions = result.schedules_total ?? result.schedules_generated ?? 0;
        const sessionInfo = newSessions < totalSessions
            ? `${newSessions} sesi baru (${totalSessions} total, ${totalSessions - newSessions} sudah ada)`
            : `${newSessions} sesi dibuat`;
        statusEl.textContent =
            `✓ Jadwal diterapkan — ${result.templates_found} template, ` +
            `${result.assignments_upserted} penugasan, ${sessionInfo}.`;
        statusEl.style.color = 'var(--color-success)';
        applyBtn.disabled = false;
        applyBtn.textContent = '✓ Jadwal Diterapkan';
        applyBtn.style.background = 'var(--color-success)';
    } catch (err) {
        statusEl.textContent = `✗ Gagal: ${err.message}`;
        statusEl.style.color = 'var(--color-danger)';
        applyBtn.disabled = false;
        applyBtn.textContent = 'Terapkan Jadwal';
        applyBtn.style.background = '';
    }
}

async function reapplyTemplates() {
    if (state.dirty) {
        if (!confirm('Ada perubahan yang belum disimpan. Simpan dulu sebelum menerapkan ulang?')) return;
        await save();
        if (state.dirty) return;
    }

    const statusEl   = overlayEl.querySelector('#sched-status');
    const reapplyBtn = overlayEl.querySelector('#sched-reapply');
    const applyBtn   = overlayEl.querySelector('#sched-apply');

    const confirmed = confirm(
        'Terapkan Ulang Jadwal akan menghapus semua sesi mulai besok yang belum punya absensi, ' +
        'lalu men-generate ulang dari template terkini.\n\n' +
        'Sesi hari ini dan sesi yang sudah ada absensinya tidak akan terganggu.\n\n' +
        'Lanjutkan?'
    );
    if (!confirmed) return;

    reapplyBtn.disabled = true;
    applyBtn.disabled   = true;
    reapplyBtn.textContent = 'Menerapkan ulang...';
    statusEl.textContent   = '';

    try {
        const result = await reapplyScheduleTemplates();
        const deleted   = result.sessions_deleted   ?? 0;
        const generated = result.schedules_generated ?? 0;
        statusEl.textContent =
            `✓ Jadwal diperbarui — ${deleted} sesi lama dihapus, ` +
            `${result.templates_found} template, ${generated} sesi baru dibuat.`;
        statusEl.style.color    = 'var(--color-success)';
        reapplyBtn.textContent  = '✓ Jadwal Diperbarui';
        reapplyBtn.style.background = 'var(--color-success)';
    } catch (err) {
        statusEl.textContent = `✗ Gagal: ${err.message}`;
        statusEl.style.color = 'var(--color-danger)';
        reapplyBtn.textContent = 'Terapkan Ulang';
        reapplyBtn.style.background = '';
    } finally {
        reapplyBtn.disabled = false;
        applyBtn.disabled   = false;
    }
}

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Panel: Kode Mapel ─────────────────────────────────────────────────────

async function renderKodeMapelPanel() {
    const panel = overlayEl.querySelector('#sched-panel-kode-mapel');
    panel.innerHTML = '<p class="hint" style="text-align:center">Memuat…</p>';

    let aliases = [];
    try { aliases = await getSubjectCodeAliases(); } catch (_) { /* kosong */ }

    const subjectOptions = state.coreSubjects.map(cs =>
        `<option value="${esc(cs.subject_id)}">${esc(cs.name)}</option>`
    ).join('');

    const rows = aliases.map(a => `
        <tr>
            <td style="padding:6px 12px">${esc(a.kode)}</td>
            <td style="padding:6px 12px">${esc(a.subject_name)}</td>
            <td style="padding:6px 8px">
                <button type="button" class="btn btn-secondary sca-del" data-id="${esc(a.alias_id)}"
                    style="padding:2px 10px;font-size:12px">Hapus</button>
            </td>
        </tr>`).join('');

    panel.innerHTML = `
        <h4 style="margin:0 0 12px">Kode Mapel</h4>
        <p class="hint" style="margin:0 0 12px">
            Petakan singkatan yang Anda gunakan di grid jadwal ke mata pelajaran kurikulum.
            Dipakai otomatis saat "Terapkan Jadwal".
        </p>

        <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap">
            <div>
                <label style="display:block;font-size:12px;margin-bottom:4px">Kode (singkatan)</label>
                <input type="text" id="sca-kode" class="input" placeholder="mis. B.INGG"
                    style="width:140px;text-transform:uppercase">
            </div>
            <div>
                <label style="display:block;font-size:12px;margin-bottom:4px">Nama Mapel</label>
                <select id="sca-subject" class="input" style="width:260px">
                    <option value="">— pilih —</option>
                    ${subjectOptions}
                </select>
            </div>
            <button type="button" class="btn btn-primary" id="sca-add" style="padding:6px 16px">Tambah</button>
            <span id="sca-status" style="font-size:13px"></span>
        </div>

        ${aliases.length > 0 ? `
        <table class="table" style="max-width:500px">
            <thead><tr><th>Kode</th><th>Nama Mapel</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
        </table>` : '<p class="hint">Belum ada alias. Tambahkan di atas.</p>'}
    `;

    panel.querySelector('#sca-kode').addEventListener('input', e => {
        e.target.value = e.target.value.toUpperCase();
    });

    panel.querySelector('#sca-add').addEventListener('click', async () => {
        const kode = panel.querySelector('#sca-kode').value.trim();
        const coreSubjectId = panel.querySelector('#sca-subject').value;
        const statusEl = panel.querySelector('#sca-status');
        if (!kode || !coreSubjectId) { statusEl.textContent = 'Isi kode dan pilih mapel.'; statusEl.style.color = 'var(--color-danger)'; return; }
        try {
            statusEl.textContent = 'Menyimpan…';
            statusEl.style.color = '';
            await upsertSubjectCodeAlias(state.schoolId, kode, coreSubjectId);
            await renderKodeMapelPanel();
        } catch (err) {
            panel.querySelector('#sca-status').textContent = `Gagal: ${err.message}`;
            panel.querySelector('#sca-status').style.color = 'var(--color-danger)';
        }
    });

    panel.querySelectorAll('.sca-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Hapus alias ini?')) return;
            try {
                await deleteSubjectCodeAlias(btn.dataset.id);
                await renderKodeMapelPanel();
            } catch (err) {
                alert(`Gagal: ${err.message}`);
            }
        });
    });
}

// ─── Panel: Kode Guru ─────────────────────────────────────────────────────

function renderKodeGuruPanel() {
    const panel = overlayEl.querySelector('#sched-panel-kode-guru');
    const withCode = state.teachers.filter(t => t.teacher_code);
    const rows = withCode.map(t =>
        `<tr><td style="padding:6px 12px">${esc(t.teacher_code)}</td><td style="padding:6px 12px">${esc(t.full_name)}</td></tr>`
    ).join('');

    panel.innerHTML = `
        <h4 style="margin:0 0 12px">Kode Guru</h4>
        <p class="hint" style="margin:0 0 12px">
            Daftar ini otomatis dari data staf. Kolom KG di grid jadwal menggunakan kode-kode berikut.
        </p>
        ${withCode.length > 0 ? `
        <table class="table" style="max-width:400px">
            <thead><tr><th>Kode</th><th>Nama Guru</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>` : '<p class="hint">Belum ada guru dengan kode. Isi kode di menu Staf &amp; Peran.</p>'}
        <p class="hint" style="margin-top:12px">Untuk mengubah kode guru, edit di menu <strong>Staf &amp; Peran</strong>.</p>
    `;
}

// ─── Paste handler multi-sel ───────────────────────────────────────────────

function handleGridPaste(e) {
    const target = e.target;
    const isMapel = target.classList.contains('sched-mapel');
    const isKg    = target.classList.contains('sched-kg');
    if (!isMapel && !isKg) return;

    const text = e.clipboardData?.getData('text/plain') ?? '';
    const pasteRows = text.split(/\r?\n/).filter(r => r !== '');
    if (pasteRows.length === 0) return;

    // Jika hanya 1 baris 1 kolom: biarkan browser handle (paste normal)
    const firstCols = pasteRows[0].split('\t');
    if (pasteRows.length === 1 && firstCols.length === 1) return;

    e.preventDefault();

    const key = target.dataset.key;
    if (!key) return;
    const [startSlotStr, startClassId] = key.split('_');
    const startSlotIdx = Number(startSlotStr);

    // Indeks kelas awal di state.classes
    const startClassIdx = state.classes.findIndex(c => c.class_id === startClassId);
    if (startClassIdx < 0) return;

    // Indeks slot awal di state.slots (hanya non-break)
    const nonBreakSlots = state.slots
        .map((s, i) => ({ slot: s, idx: i }))
        .filter(s => !s.slot.is_break);
    const startNbIdx = nonBreakSlots.findIndex(s => s.idx === startSlotIdx);
    if (startNbIdx < 0) return;

    // Kolom awal: 0 = mapel, 1 = kg
    const startCol = isKg ? 1 : 0;

    for (let ri = 0; ri < pasteRows.length; ri++) {
        const nbIdx = startNbIdx + ri;
        if (nbIdx >= nonBreakSlots.length) break;
        const slotIdx = nonBreakSlots[nbIdx].idx;

        const cols = pasteRows[ri].split('\t');
        let colOffset = 0;
        while (colOffset < cols.length) {
            const absCol = startCol + colOffset;  // 0=mapel, 1=kg, 2=mapel kelas+1, 3=kg kelas+1 …
            const classOffset = Math.floor(absCol / 2);
            const fieldIdx    = absCol % 2;       // 0=mapel, 1=kg
            const classIdx    = startClassIdx + classOffset;
            if (classIdx >= state.classes.length) break;

            const cellKey = `${slotIdx}_${state.classes[classIdx].class_id}`;
            if (!state.cells.has(cellKey)) state.cells.set(cellKey, { mapel: '', teacher_code: '' });
            const cell = state.cells.get(cellKey);
            const val  = cols[colOffset].trim();

            if (fieldIdx === 0) {
                cell.mapel = val;
            } else {
                cell.teacher_code = val.toUpperCase();
            }
            colOffset++;
        }
    }

    state.dirty = true;
    renderGrid();
    checkConflicts();
}
