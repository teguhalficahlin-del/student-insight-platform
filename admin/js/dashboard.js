/**
 * @file admin/js/dashboard.js
 *
 * Bootstraps dashboard.html: auth guard, sidebar navigation,
 * and a handful of read-only/import panels. Not listed in the
 * original file spec (only auth.js/setup-wizard.js/import.js/
 * api.js were named) but dashboard.html needs its own small
 * controller — same role as setup-wizard.js plays for setup.html.
 */

import {
    getCurrentUserRow, requireAdministrativeOrRedirect,
    getSchoolConfig, logout,
    getPrograms, getClasses, importSchedules, importParents, importDudi,
    importStudents, importUsers,
    checkDependencies, deleteRecord, deleteBulk, toggleSubjectActive,
} from './api.js';
import { mountCsvImporter } from './import.js';
import { mountSemesterPanel } from './semester.js';
import { supabase } from './api.js';

const panelContent = document.getElementById('panel-content');

const PANEL_RENDERERS = {
    setup:             renderSetupPanel,
    programs:          renderProgramsPanel,
    classes:           renderClassesPanel,
    subjects:          renderSubjectsPanel,
    staff:             renderUsersPanel('GURU,BK,WALI_KELAS,KAPRODI,KEPSEK,ADMINISTRATIVE'.split(',')),
    students:          renderStudentsPanel,
    parents:           renderUsersPanel(['ORTU']),
    'import-parents':   renderImportParentsPanel,
    'import-dudi':      renderImportDudiPanel,
    'schedules-active': renderSchedulesPanel,
    'schedules-import': renderScheduleImportPanel,
    substitutes:       renderSubstitutesPanel,
    tutupsemester:      renderTutupSemesterPanel,
    'academic-year':    renderAcademicYearPanel,
    export:            renderExportPanel,
    'activity-log':     renderActivityLogPanel,
};

document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('is-active'));
        link.classList.add('is-active');
        const panel = link.dataset.panel;
        (PANEL_RENDERERS[panel] ?? renderComingSoon)(panel);
    });
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await logout();
    window.location.href = 'index.html';
});

// ─────────────────────────────────────────────────────────────
// PANELS
// ─────────────────────────────────────────────────────────────

function renderComingSoon(panel) {
    panelContent.innerHTML = `<p class="hint">Panel "${panel}" belum diimplementasikan.</p>`;
}

async function renderProgramsPanel() {
    const programs = await getPrograms();
    panelContent.innerHTML = `
        <h3>Program Keahlian</h3>
        <div class="panel-toolbar">
            <button id="bulk-delete-btn" class="btn btn-danger" disabled>Hapus Semua Terpilih</button>
        </div>
        <table class="table">
            <thead><tr>
                <th class="checkbox-col"><input type="checkbox" id="select-all-checkbox"></th>
                <th>Kode</th><th>Nama</th><th>Status</th><th>Aksi</th>
            </tr></thead>
            <tbody>${programs.map(p => `
                <tr data-id="${p.program_id}">
                    <td class="checkbox-col"><input type="checkbox" class="row-checkbox" value="${p.program_id}"></td>
                    <td>${p.code}</td><td>${p.name}</td>
                    <td><span class="badge ${p.is_active ? 'badge-success' : 'badge-muted'}">${p.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
                    <td><button class="btn btn-danger row-delete-btn" data-id="${p.program_id}" data-name="${p.name}">Hapus</button></td>
                </tr>
            `).join('')}</tbody>
        </table>
    `;
    wireDeleteUI({
        table: 'programs',
        getName: id => programs.find(p => p.program_id === id)?.name ?? id,
        refresh: renderProgramsPanel,
    });
}

async function renderClassesPanel() {
    const [classes, programs] = await Promise.all([getClasses(), getPrograms()]);
    const programById = new Map(programs.map(p => [p.program_id, p.name]));
    panelContent.innerHTML = `
        <h3>Kelas &amp; Rombel</h3>
        <div class="panel-toolbar">
            <button id="bulk-delete-btn" class="btn btn-danger" disabled>Hapus Semua Terpilih</button>
        </div>
        <table class="table">
            <thead><tr>
                <th class="checkbox-col"><input type="checkbox" id="select-all-checkbox"></th>
                <th>Nama</th><th>Program</th><th>Tingkat</th><th>Tahun Ajaran</th><th>Aksi</th>
            </tr></thead>
            <tbody>${classes.map(c => `
                <tr data-id="${c.class_id}">
                    <td class="checkbox-col"><input type="checkbox" class="row-checkbox" value="${c.class_id}"></td>
                    <td>${c.name}</td><td>${programById.get(c.program_id) ?? '—'}</td>
                    <td>${c.grade_level}</td><td>${c.academic_year}</td>
                    <td><button class="btn btn-danger row-delete-btn" data-id="${c.class_id}" data-name="${c.name}">Hapus</button></td>
                </tr>
            `).join('')}</tbody>
        </table>
    `;
    wireDeleteUI({
        table: 'classes',
        getName: id => classes.find(c => c.class_id === id)?.name ?? id,
        refresh: renderClassesPanel,
    });
}

function sanitizeErrorMessage(err) {
    // Pesan aman untuk ditampilkan ke user
    if (!err) return 'Terjadi kesalahan tidak diketahui';
    const msg = err.message ?? err.error ?? String(err);
    // Sembunyikan detail teknis internal
    if (
        msg.includes('PGRST') ||
        msg.includes('JWT') ||
        msg.includes('syntax error') ||
        msg.includes('relation') ||
        msg.includes('column') ||
        msg.includes('violates')
    ) {
        return 'Terjadi kesalahan sistem. Hubungi administrator.';
    }
    return msg;
}

async function renderSubjectsPanel() {
    const { data: subjects, error } = await supabase.from('subjects').select('*').order('name');
    if (error) { console.error(error); panelContent.innerHTML = `<div class="alert alert-danger">${sanitizeErrorMessage(error)}</div>`; return; }
    panelContent.innerHTML = `
        <h3>Mata Pelajaran</h3>
        <table class="table">
            <thead><tr><th>Kode</th><th>Nama</th><th>Aktif</th></tr></thead>
            <tbody>${subjects.map(s => `
                <tr>
                    <td>${s.code}</td><td>${s.name}</td>
                    <td><input type="checkbox" class="subject-toggle" data-id="${s.subject_id}" ${s.is_active ? 'checked' : ''}></td>
                </tr>
            `).join('')}</tbody>
        </table>
    `;
    panelContent.querySelectorAll('.subject-toggle').forEach(checkbox => {
        checkbox.addEventListener('change', async () => {
            const subjectId = checkbox.dataset.id;
            const newValue = checkbox.checked;
            checkbox.disabled = true;
            try {
                await toggleSubjectActive(subjectId, newValue);
            } catch (err) {
                checkbox.checked = !newValue;
                panelContent.insertAdjacentHTML('afterbegin', `<div class="alert alert-danger">${sanitizeErrorMessage(err)}</div>`);
            } finally {
                checkbox.disabled = false;
            }
        });
    });
}

function renderUsersPanel(roles) {
    async function render() {
        const { data: users, error } = await supabase
            .from('users')
            .select('user_id, full_name, login_identifier, role_type, is_active')
            .in('role_type', roles)
            .order('full_name');
        if (error) { console.error(error); panelContent.innerHTML = `<div class="alert alert-danger">${sanitizeErrorMessage(error)}</div>`; return; }
        panelContent.innerHTML = `
            <h3>Daftar Pengguna</h3>
            <div class="panel-toolbar">
                <button id="bulk-delete-btn" class="btn btn-danger" disabled>Hapus Semua Terpilih</button>
            </div>
            <table class="table">
                <thead><tr>
                    <th class="checkbox-col"><input type="checkbox" id="select-all-checkbox"></th>
                    <th>Nama</th><th>Identifier</th><th>Role</th><th>Status</th><th>Aksi</th>
                </tr></thead>
                <tbody>${users.map(u => `
                    <tr data-id="${u.user_id}">
                        <td class="checkbox-col"><input type="checkbox" class="row-checkbox" value="${u.user_id}"></td>
                        <td>${u.full_name}</td><td>${u.login_identifier}</td><td>${u.role_type}</td>
                        <td><span class="badge ${u.is_active ? 'badge-success' : 'badge-muted'}">${u.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
                        <td><button class="btn btn-danger row-delete-btn" data-id="${u.user_id}" data-name="${u.full_name}">Hapus</button></td>
                    </tr>
                `).join('')}</tbody>
            </table>
        `;
        wireDeleteUI({
            table: 'users',
            getName: id => users.find(u => u.user_id === id)?.full_name ?? id,
            refresh: render,
        });
    }
    return render;
}

async function renderStudentsPanel() {
    const { data: students, error } = await supabase
        .from('students')
        .select('student_id, full_name, nis, student_status')
        .order('full_name');
    if (error) { console.error(error); panelContent.innerHTML = `<div class="alert alert-danger">${sanitizeErrorMessage(error)}</div>`; return; }
    panelContent.innerHTML = `
        <h3>Siswa</h3>
        <div class="panel-toolbar">
            <button id="bulk-delete-btn" class="btn btn-danger" disabled>Hapus Semua Terpilih</button>
        </div>
        <table class="table">
            <thead><tr>
                <th class="checkbox-col"><input type="checkbox" id="select-all-checkbox"></th>
                <th>Nama</th><th>NIS</th><th>Status</th><th>Aksi</th>
            </tr></thead>
            <tbody>${students.map(s => `
                <tr data-id="${s.student_id}">
                    <td class="checkbox-col"><input type="checkbox" class="row-checkbox" value="${s.student_id}"></td>
                    <td>${s.full_name}</td><td>${s.nis}</td><td>${s.student_status}</td>
                    <td><button class="btn btn-danger row-delete-btn" data-id="${s.student_id}" data-name="${s.full_name}">Hapus</button></td>
                </tr>
            `).join('')}</tbody>
        </table>
    `;
    wireDeleteUI({
        table: 'students',
        getName: id => students.find(s => s.student_id === id)?.full_name ?? id,
        refresh: renderStudentsPanel,
    });
}

async function renderSchedulesPanel() {
    const { data: schedules, error } = await supabase
        .from('teaching_schedules')
        .select('schedule_id, session_date, session_start, session_end, meeting_status')
        .order('session_date', { ascending: false })
        .limit(50);
    if (error) { console.error(error); panelContent.innerHTML = `<div class="alert alert-danger">${sanitizeErrorMessage(error)}</div>`; return; }
    panelContent.innerHTML = `
        <h3>Jadwal Aktif (50 terbaru)</h3>
        <div class="panel-toolbar">
            <button id="bulk-delete-btn" class="btn btn-danger" disabled>Hapus Semua Terpilih</button>
        </div>
        <table class="table">
            <thead><tr>
                <th class="checkbox-col"><input type="checkbox" id="select-all-checkbox"></th>
                <th>Tanggal</th><th>Jam</th><th>Status</th><th>Aksi</th>
            </tr></thead>
            <tbody>${schedules.map(s => `
                <tr data-id="${s.schedule_id}">
                    <td class="checkbox-col"><input type="checkbox" class="row-checkbox" value="${s.schedule_id}"></td>
                    <td>${s.session_date}</td><td>${s.session_start}–${s.session_end}</td><td>${s.meeting_status}</td>
                    <td><button class="btn btn-danger row-delete-btn" data-id="${s.schedule_id}" data-name="${s.session_date}">Hapus</button></td>
                </tr>
            `).join('')}</tbody>
        </table>
    `;
    wireDeleteUI({
        table: 'teaching_schedules',
        getName: id => schedules.find(s => s.schedule_id === id)?.session_date ?? id,
        refresh: renderSchedulesPanel,
    });
}

function renderImportParentsPanel() {
    panelContent.innerHTML = `<h3>Import Orang Tua</h3><div id="dashboard-import-parents-mount"></div>`;
    mountCsvImporter(document.getElementById('dashboard-import-parents-mount'), {
        columns: ['nama_ortu', 'nik', 'nis_siswa'],
        onImport: importParents,
        template: {
            filename: 'template_orang_tua.csv',
            columns: ['nama_ortu', 'nik', 'nis_siswa'],
            exampleRows: [
                ['Bambang Wijaya', '3201012003800001', '0091234567'],
                ['Bambang Wijaya', '3201012003800001', '0091234570'],
            ],
        },
    });
}

function renderImportDudiPanel() {
    panelContent.innerHTML = `<h3>Import DUDI</h3><div id="dashboard-import-dudi-mount"></div>`;
    mountCsvImporter(document.getElementById('dashboard-import-dudi-mount'), {
        columns: ['nama_usaha', 'nama_penanggung_jawab'],
        onImport: importDudi,
        template: {
            filename: 'template_dudi.csv',
            columns: ['nama_usaha', 'nama_penanggung_jawab'],
            exampleRows: [
                ['PT Mitra Teknologi Nusantara', 'Hendra Setiawan'],
                ['CV Karya Mandiri Elektronik', 'Yulia Permatasari'],
            ],
        },
    });
}

function renderScheduleImportPanel() {
    panelContent.innerHTML = `<h3>Import Jadwal Baru</h3><div id="dashboard-schedule-import-mount"></div>`;
    mountCsvImporter(document.getElementById('dashboard-schedule-import-mount'), {
        columns: ['hari', 'start_time', 'end_time', 'kelas', 'kode_guru', 'kode_mapel'],
        onImport: async (csvText) => {
            const result = await importSchedules(csvText);
            return {
                total:   result.total_templates,
                success: result.schedules_generated,
                failed:  result.failed,
                errors:  result.errors,
            };
        },
    });
}

async function renderSubstitutesPanel() {
    const { data: subs, error } = await supabase
        .from('substitute_schedules')
        .select('granted_at, sync_token_expires_at')
        .order('granted_at', { ascending: false })
        .limit(50);
    if (error) { console.error(error); panelContent.innerHTML = `<div class="alert alert-danger">${sanitizeErrorMessage(error)}</div>`; return; }
    panelContent.innerHTML = `
        <h3>Guru Pengganti (50 terbaru)</h3>
        <table class="table">
            <thead><tr><th>Diberikan Pada</th><th>Token Berlaku Sampai</th></tr></thead>
            <tbody>${subs.map(s => `<tr><td>${s.granted_at}</td><td>${s.sync_token_expires_at}</td></tr>`).join('')}</tbody>
        </table>
    `;
}

function renderTutupSemesterPanel() {
    mountSemesterPanel(panelContent);
}

function renderAcademicYearPanel() {
    panelContent.innerHTML = `
        <h3>Tahun Ajaran Baru</h3>
        <p class="hint">Mengubah tahun ajaran aktif memengaruhi seluruh jadwal dan absensi baru. Fitur rollover lengkap (kenaikan kelas otomatis) belum diimplementasikan — ubah <code>school_config.current_academic_year</code> secara manual untuk saat ini.</p>
    `;
}

function renderExportPanel() {
    panelContent.innerHTML = `<p class="hint">Export data belum diimplementasikan pada console ini.</p>`;
}

function renderActivityLogPanel() {
    panelContent.innerHTML = `<p class="hint">Log aktivitas belum diimplementasikan pada console ini.</p>`;
}

async function renderSetupPanel() {
    panelContent.innerHTML = `<p class="hint">Memuat status setup...</p>`;

    // Cek semua data sekaligus
    const [
        { count: programCount },
        { count: classCount },
        { count: kepsekCount },
        { count: kaprodiCount },
        { count: walikelasCount },
        { count: guruCount },
        { count: bkCount },
        { count: siswaCount },
        { count: ortuCount },
        { count: jadwalCount },
    ] = await Promise.all([
        supabase.from('programs').select('*', { count: 'exact', head: true }),
        supabase.from('classes').select('*', { count: 'exact', head: true }),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_type', 'KEPSEK'),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_type', 'KAPRODI'),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_type', 'WALI_KELAS'),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_type', 'GURU'),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_type', 'BK'),
        supabase.from('students').select('*', { count: 'exact', head: true }),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_type', 'ORTU'),
        supabase.from('schedule_templates').select('*', { count: 'exact', head: true }),
    ]);

    const steps = [
        {
            no: 1,
            label: 'Program Keahlian',
            count: programCount,
            satuan: 'program',
            done: programCount > 0,
            panel: 'programs',
            canDo: true,
            importPanel: null,
        },
        {
            no: 2,
            label: 'Kelas & Rombel',
            count: classCount,
            satuan: 'kelas',
            done: classCount > 0,
            panel: 'classes',
            canDo: programCount > 0,
            blockedBy: 'Program Keahlian',
            importPanel: null,
        },
        {
            no: 3,
            label: 'Kepala Sekolah',
            count: kepsekCount,
            satuan: 'akun',
            done: kepsekCount > 0,
            panel: 'staff',
            canDo: true,
            importPanel: 'import-kepsek',
        },
        {
            no: 4,
            label: 'Kaprodi',
            count: kaprodiCount,
            satuan: 'akun',
            done: kaprodiCount > 0,
            panel: 'staff',
            canDo: programCount > 0,
            blockedBy: 'Program Keahlian',
            importPanel: 'import-kaprodi',
        },
        {
            no: 5,
            label: 'Wali Kelas',
            count: walikelasCount,
            satuan: 'akun',
            done: walikelasCount > 0,
            panel: 'staff',
            canDo: classCount > 0,
            blockedBy: 'Kelas & Rombel',
            importPanel: 'import-walikelas',
        },
        {
            no: 6,
            label: 'Guru',
            count: guruCount,
            satuan: 'akun',
            done: guruCount > 0,
            panel: 'staff',
            canDo: true,
            importPanel: 'import-guru',
        },
        {
            no: 7,
            label: 'BK',
            count: bkCount,
            satuan: 'akun',
            done: bkCount > 0,
            panel: 'staff',
            canDo: true,
            importPanel: 'import-bk',
        },
        {
            no: 8,
            label: 'Siswa',
            count: siswaCount,
            satuan: 'siswa',
            done: siswaCount > 0,
            panel: 'students',
            canDo: classCount > 0,
            blockedBy: 'Kelas & Rombel',
            importPanel: 'import-siswa',
        },
        {
            no: 9,
            label: 'Orang Tua',
            count: ortuCount,
            satuan: 'akun',
            done: ortuCount > 0,
            panel: 'parents',
            canDo: siswaCount > 0,
            blockedBy: 'Siswa',
            importPanel: 'import-parents',
            optional: true,
        },
        {
            no: 10,
            label: 'Jadwal Pelajaran',
            count: jadwalCount,
            satuan: 'template jadwal',
            done: jadwalCount > 0,
            panel: 'schedules-active',
            canDo: guruCount > 0 && classCount > 0,
            blockedBy: 'Guru dan Kelas',
            importPanel: 'schedules-import',
        },
    ];

    const allDone = steps.filter(s => !s.optional).every(s => s.done);

    panelContent.innerHTML = `
        <h3>Setup Sekolah</h3>
        <p class="hint">
            ${allDone
                ? '✅ Semua data wajib sudah diisi. Sistem siap digunakan.'
                : 'Ikuti langkah berikut untuk menyiapkan sistem. Langkah yang bergaris abu-abu perlu langkah sebelumnya diselesaikan dulu.'}
        </p>
        <table class="table">
            <thead>
                <tr>
                    <th style="width:40px">#</th>
                    <th>Data</th>
                    <th style="width:160px">Status</th>
                    <th style="width:140px">Aksi</th>
                </tr>
            </thead>
            <tbody>
                ${steps.map(s => `
                    <tr style="${!s.canDo ? 'opacity:0.5' : ''}">
                        <td>${s.no}</td>
                        <td>
                            ${s.label}
                            ${s.optional ? '<span class="badge badge-muted" style="font-size:10px;margin-left:4px">Opsional</span>' : ''}
                            ${!s.canDo && s.blockedBy
                                ? `<br><span style="font-size:11px;color:var(--color-text-muted)">Perlu: ${s.blockedBy}</span>`
                                : ''}
                        </td>
                        <td>
                            ${s.done
                                ? `<span class="badge badge-success">✓ ${s.count} ${s.satuan}</span>`
                                : `<span class="badge badge-muted">Belum diisi</span>`}
                        </td>
                        <td>
                            ${s.importPanel
                                ? `<button class="btn btn-secondary setup-action-btn"
                                    data-panel="${s.importPanel}"
                                    ${!s.canDo ? 'disabled' : ''}>
                                    ${s.done ? 'Import Lagi' : 'Import'}
                                   </button>`
                                : `<button class="btn btn-secondary setup-action-btn"
                                    data-panel="${s.panel}"
                                    ${!s.canDo ? 'disabled' : ''}>
                                    Lihat Data
                                   </button>`}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    // Wire tombol aksi — klik navigasi ke panel yang relevan
    panelContent.querySelectorAll('.setup-action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetPanel = btn.dataset.panel;
            // Simulasi klik nav link
            const navLink = document.querySelector(`.nav-link[data-panel="${targetPanel}"]`);
            if (navLink) {
                navLink.click();
            } else {
                // Panel import khusus yang tidak ada di nav
                renderImportByKey(targetPanel);
            }
        });
    });
}

function renderImportByKey(key) {
    const importFunctions = {
        'import-kepsek':   () => renderStaffImportPanel('KEPSEK',    'Kepala Sekolah'),
        'import-kaprodi':  () => renderStaffImportPanel('KAPRODI',   'Kaprodi'),
        'import-walikelas':() => renderStaffImportPanel('WALI_KELAS','Wali Kelas'),
        'import-guru':     () => renderStaffImportPanel('GURU',      'Guru'),
        'import-bk':       () => renderStaffImportPanel('BK',        'BK'),
        'import-siswa':    () => renderImportSiswaPanel(),
    };
    const fn = importFunctions[key];
    if (fn) fn();
    else renderComingSoon(key);
}

function renderStaffImportPanel(roleType, label) {
    panelContent.innerHTML = `<h3>Import ${label}</h3><div id="staff-import-mount"></div>`;

    const colsBase = ['nama', 'nip_atau_nik'];
    const colsExtra = roleType === 'WALI_KELAS' ? ['nama_kelas'] :
                      roleType === 'GURU' ? ['kode_program', 'teacher_code'] :
                      roleType === 'KAPRODI' ? ['kode_program'] : [];
    const columns = [...colsBase, ...colsExtra];

    mountCsvImporter(document.getElementById('staff-import-mount'), {
        columns,
        onImport: (csvText) => {
            // Inject role_type column
            const lines = csvText.trim().split(/\r\n|\n|\r/);
            const header = lines[0] + ',role_type';
            const rows = lines.slice(1).map(l => l + `,${roleType}`);
            const enriched = [header, ...rows].join('\n');
            return importUsers(enriched);
        },
        onDone: () => renderSetupPanel(),
        template: {
            filename: `template_${label.toLowerCase().replace(/ /g,'_')}.csv`,
            columns,
            exampleRows: [['Nama Lengkap', '198501012010011001', ...colsExtra.map(() => '')]],
        },
    });
}

function renderImportSiswaPanel() {
    panelContent.innerHTML = `<h3>Import Siswa</h3><div id="siswa-import-mount"></div>`;

    mountCsvImporter(document.getElementById('siswa-import-mount'), {
        columns: ['nama', 'nis', 'kode_program', 'class_name'],
        onImport: importStudents,
        onDone: () => renderSetupPanel(),
        template: {
            filename: 'template_siswa.csv',
            columns: ['nama', 'nis', 'kode_program', 'class_name'],
            exampleRows: [['Ani Lestari', '0091234567', 'RPL', 'X-RPL-1']],
        },
    });
}

// ─────────────────────────────────────────────────────────────
// DELETE UI HELPERS
// ─────────────────────────────────────────────────────────────

function wireDeleteUI({ table, getName, refresh }) {
    const selectAll = panelContent.querySelector('#select-all-checkbox');
    const bulkBtn    = panelContent.querySelector('#bulk-delete-btn');
    const rowCheckboxes = () => Array.from(panelContent.querySelectorAll('.row-checkbox'));

    function updateBulkBtnState() {
        bulkBtn.disabled = !rowCheckboxes().some(cb => cb.checked);
    }

    selectAll?.addEventListener('change', () => {
        rowCheckboxes().forEach(cb => { cb.checked = selectAll.checked; });
        updateBulkBtnState();
    });
    rowCheckboxes().forEach(cb => cb.addEventListener('change', updateBulkBtnState));

    panelContent.querySelectorAll('.row-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const name = btn.dataset.name;
            try {
                const { canDelete, items } = await checkDependencies(table, id);
                showDeleteModal({
                    name,
                    dependencies: canDelete ? [] : items,
                    onConfirm: async () => {
                        await deleteRecord(table, id);
                        await refresh();
                    },
                });
            } catch (err) {
                panelContent.insertAdjacentHTML('afterbegin', `<div class="alert alert-danger">${sanitizeErrorMessage(err)}</div>`);
            }
        });
    });

    bulkBtn?.addEventListener('click', async () => {
        const ids = rowCheckboxes().filter(cb => cb.checked).map(cb => cb.value);
        if (ids.length === 0) return;

        try {
            const depResults = await Promise.all(ids.map(id => checkDependencies(table, id)));
            const mergedItems = new Map();
            depResults.forEach(({ items }) => {
                items.forEach(({ label, count }) => {
                    mergedItems.set(label, (mergedItems.get(label) ?? 0) + count);
                });
            });
            const items = Array.from(mergedItems, ([label, count]) => ({ label, count }));

            showDeleteModal({
                name: `${ids.length} item terpilih`,
                dependencies: items,
                onConfirm: async () => {
                    const { errors } = await deleteBulk(table, ids);
                    if (errors.length > 0) {
                        const msg = errors.map(e => `${getName(e.id)}: ${e.message}`).join('\n');
                        alert(`Sebagian data gagal dihapus:\n${msg}`);
                    }
                    await refresh();
                },
            });
        } catch (err) {
            panelContent.insertAdjacentHTML('afterbegin', `<div class="alert alert-danger">${sanitizeErrorMessage(err)}</div>`);
        }
    });

    updateBulkBtnState();
}

/**
 * Modal konfirmasi hapus, dua level: tanpa dependency (Level 1)
 * atau dengan dependency yang mewajibkan ketik "HAPUS" (Level 2).
 */
function showDeleteModal({ name, dependencies, onConfirm }) {
    const isLevel2 = dependencies.length > 0;

    const overlay = document.createElement('div');
    overlay.className = 'delete-modal-overlay';
    overlay.innerHTML = `
        <div class="delete-modal">
            ${isLevel2 ? `
                <h3>⚠️ Data ini memiliki catatan terkait</h3>
                <div class="delete-modal-warning">
                    <p>Tidak bisa langsung menghapus <strong>${name}</strong> karena masih memiliki:</p>
                    <ul class="delete-modal-deps">
                        ${dependencies.map(d => `<li>${d.count} ${d.label}</li>`).join('')}
                    </ul>
                </div>
                <p class="hint">Ketik <strong>HAPUS</strong> untuk mengaktifkan penghapusan permanen.</p>
                <input type="text" class="input delete-modal-input" placeholder="Ketik HAPUS">
            ` : `
                <h3>Hapus ${name}?</h3>
                <p>Tindakan ini tidak bisa dibatalkan.</p>
            `}
            <div class="delete-modal-actions">
                <button class="btn btn-secondary" data-action="cancel">Batal</button>
                <button class="btn btn-danger" data-action="confirm" ${isLevel2 ? 'disabled' : ''}>
                    ${isLevel2 ? 'Hapus Permanen' : 'Hapus'}
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const confirmBtn = overlay.querySelector('[data-action="confirm"]');
    const cancelBtn  = overlay.querySelector('[data-action="cancel"]');
    const input      = overlay.querySelector('.delete-modal-input');

    function close() { overlay.remove(); }

    input?.addEventListener('input', () => {
        confirmBtn.disabled = input.value !== 'HAPUS';
    });
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        try {
            await onConfirm();
            close();
        } catch (err) {
            confirmBtn.disabled = isLevel2 ? input.value !== 'HAPUS' : false;
            overlay.querySelector('.delete-modal').insertAdjacentHTML(
                'beforeend',
                `<div class="alert alert-danger">${sanitizeErrorMessage(err)}</div>`
            );
        }
    });
}

/**
 * Welcome screen full-page — tampil otomatis saat dashboard pertama
 * kali dibuka dan database belum ada program apa pun (fresh install).
 */
function showWelcomeScreen({ userName }) {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.style.display = 'none';

    const overlay = document.createElement('div');
    overlay.className = 'welcome-screen-overlay';
    overlay.innerHTML = `
        <div class="welcome-screen-card">
            <div class="welcome-screen-brand">Student Insight Platform</div>
            <p class="welcome-screen-greeting">Selamat datang, ${userName || 'Tata Usaha'}</p>
            <p class="welcome-screen-desc">Sistem belum dikonfigurasi. Ikuti panduan berikut untuk menyiapkan data sekolah Anda.</p>
            <p class="welcome-screen-estimate">Estimasi waktu pengisian: &plusmn; 30 menit</p>
            <button type="button" class="btn btn-primary welcome-screen-cta">Mulai Setup Sekolah &rarr;</button>
            <p class="welcome-screen-footer">Butuh bantuan? Hubungi administrator sistem Anda.</p>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.welcome-screen-cta').addEventListener('click', () => {
        overlay.remove();
        if (sidebar) sidebar.style.display = '';
        const setupLink = document.querySelector('.nav-link[data-panel="setup"]');
        if (setupLink) setupLink.click();
    });
}

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────

(async function init() {
    const userRow = await getCurrentUserRow();
    if (!requireAdministrativeOrRedirect(userRow)) return;

    const config = await getSchoolConfig();

    document.getElementById('dashboard-school-name').textContent = config.school_name;
    document.getElementById('dashboard-user-name').textContent = `Masuk sebagai ${userRow.full_name}`;

    const programs = await getPrograms().catch(() => null);
    if (programs !== null && programs.length === 0) {
        showWelcomeScreen({ userName: userRow.full_name });
    }

    // Tampilkan setup panel sebagai default saat pertama masuk
    await renderSetupPanel();

    // Set nav link setup sebagai aktif
    const setupLink = document.querySelector('.nav-link[data-panel="setup"]');
    if (setupLink) setupLink.classList.add('is-active');
})();
