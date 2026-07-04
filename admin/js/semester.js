/**
 * @file admin/js/semester.js
 *
 * "Tutup Semester" panel, mounted by dashboard.js into #panel-content.
 *
 * STATE MACHINE:
 *   A. Periode ACTIVE     → tampil ringkasan + tombol "Tutup Semester"
 *   B. Periode CLOSED, semester === '1' → tampil form "Buka Semester 2"
 *   C. Periode CLOSED, semester === '2' → tampil link ke Wizard Tutup Tahun Ajaran
 *   D. Periode tidak ditemukan di academic_periods → tampil error
 *
 * Closes the active academic_periods row (locks attendance/observations/
 * journals for that period via trg_*_period_lock) and advances
 * school_config.current_semester. Cases/intervensi/komunikasi orang tua
 * are intentionally untouched — see contracts/01 academic_periods comment.
 */

import { supabase, getSchoolConfig, getCurrentUserRow } from './api.js';

// ─────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────

export async function mountSemesterPanel(container) {
    container.innerHTML = `<p class="hint">Memuat data periode aktif...</p>`;

    try {
        const config = await getSchoolConfig();
        const period = await getCurrentPeriod(config);
        renderByState(container, period, config);
    } catch (err) {
        container.innerHTML = `
            <h3>Tutup Semester</h3>
            <div class="alert alert-danger">Gagal memuat data: ${err.message}</div>
        `;
    }
}

// ─────────────────────────────────────────────────────────────
// STATE ROUTER
// ─────────────────────────────────────────────────────────────

async function renderByState(container, period, config) {
    // State D — periode tidak ada
    if (!period) {
        // Jika current_semester sudah '2', berarti Semester 1 baru ditutup
        // tapi academic_periods Semester 2 belum dibuat → tampil form buka semester 2
        if (config.current_semester === '2') {
            // Buat synthetic closedPeriod dari config untuk renderOpenNextSemester
            const { data: closedPeriod, error } = await supabase
                .from('academic_periods')
                .select('*')
                .eq('academic_year', config.current_academic_year)
                .eq('semester', '1')
                .maybeSingle();
            if (error || !closedPeriod) {
                container.innerHTML = `
                    <h3>Tutup Semester</h3>
                    <div class="alert alert-danger">
                        Semester 1 (${config.current_academic_year}) tidak ditemukan.
                        Hubungi administrator.
                    </div>
                `;
                return;
            }
            await renderOpenNextSemester(container, closedPeriod, config);
            return;
        }

        container.innerHTML = `
            <h3>Tutup Semester</h3>
            <div class="alert alert-danger">
                Periode akademik aktif (${config.current_academic_year} semester
                ${config.current_semester}) belum terdaftar di
                <code>academic_periods</code>. Buat periode ini terlebih dahulu
                sebelum semester dapat ditutup.
            </div>
        `;
        return;
    }

    // State B — Semester 1 sudah ditutup, belum ada Semester 2
    if (period.status === 'CLOSED' && period.semester === '1') {
        await renderOpenNextSemester(container, period, config);
        return;
    }

    // State C — Semester 2 sudah ditutup, arahkan ke Tutup Tahun Ajaran
    if (period.status === 'CLOSED' && period.semester === '2') {
        container.innerHTML = `
            <h3>Tutup Semester</h3>
            <div class="alert alert-success">
                Semester 2 (${period.academic_year}) sudah ditutup.
            </div>
            <div class="alert alert-warning">
                Lanjutkan ke Wizard Tutup Tahun Ajaran untuk memproses
                kelulusan siswa kelas XII dan kenaikan kelas.
            </div>
            <a href="tutup-tahun.html" class="btn btn-primary">
                Buka Wizard Tutup Tahun Ajaran &rarr;
            </a>
        `;
        return;
    }

    // State A — periode ACTIVE, tampil ringkasan + tombol tutup
    try {
        const summary = await getCloseSummary(period);
        renderClosePanel(container, period, config, summary);
    } catch (err) {
        container.innerHTML = `
            <h3>Tutup Semester</h3>
            <div class="alert alert-danger">Gagal memuat ringkasan: ${err.message}</div>
        `;
    }
}

// ─────────────────────────────────────────────────────────────
// STATE A — RENDER TUTUP SEMESTER
// ─────────────────────────────────────────────────────────────

function renderClosePanel(container, period, config, summary) {
    const today   = new Date().toISOString().slice(0, 10);
    const earlyWarning = today < period.end_date
        ? `<div class="alert alert-danger" style="margin-bottom:1rem;">
               ⚠ <strong>Semester belum selesai.</strong>
               Jadwal berakhir pada <strong>${period.end_date}</strong>,
               tapi hari ini baru <strong>${today}</strong>.
               Menutup sekarang akan mengunci absensi dan jurnal secara permanen
               sebelum waktunya.
           </div>`
        : '';

    container.innerHTML = `
        <h3>Tutup Semester</h3>
        <p class="hint">
            Tahun Ajaran <strong>${period.academic_year}</strong> —
            Semester <strong>${period.semester}</strong>
            (${period.start_date} s/d ${period.end_date})
        </p>
        <div class="import-summary">
            <div class="stat">
                <div class="num">${summary.observationCount}</div>
                <div class="label">Observasi di Periode Ini</div>
            </div>
            <div class="stat">
                <div class="num">${summary.activeStudentCount}</div>
                <div class="label">Siswa Aktif</div>
            </div>
            <div class="stat">
                <div class="num" style="color:var(--color-warning)">
                    ${summary.openCaseCount}
                </div>
                <div class="label">Kasus Terbuka</div>
            </div>
        </div>
        ${earlyWarning}
        <div class="alert alert-warning">
            Menutup semester akan mengunci absensi, observasi, dan jurnal pada
            periode ini — tidak dapat ditambah atau diubah lagi. Kasus BK,
            intervensi, dan komunikasi orang tua yang masih berjalan
            <strong>tidak terpengaruh</strong> dan tetap dapat dilanjutkan.
        </div>
        <div id="semester-close-result"></div>
        <button id="confirm-close-semester-btn" type="button" class="btn btn-danger">
            Tutup Semester ${period.semester} Sekarang
        </button>
    `;

    document.getElementById('confirm-close-semester-btn')
        .addEventListener('click', () => onCloseClick(container, period, config, summary));
}

async function onCloseClick(container, period, config, summary) {
    const btn        = document.getElementById('confirm-close-semester-btn');
    const resultArea = document.getElementById('semester-close-result');

    const confirmed = window.confirm(
        `Tutup Semester ${period.semester} (${period.academic_year})?\n\n` +
        `${summary.observationCount} observasi serta seluruh absensi/jurnal ` +
        `pada periode ini akan dikunci.\n` +
        `${summary.openCaseCount} kasus terbuka TIDAK terpengaruh dan tetap ` +
        `bisa dilanjutkan.\n\n` +
        `Tindakan ini tidak dapat dibatalkan.`
    );
    if (!confirmed) return;

    btn.disabled    = true;
    btn.textContent = 'Menutup semester...';

    try {
        await closeSemester(period, config);

        // Re-fetch config terbaru lalu render state berikutnya
        const newConfig = await getSchoolConfig();
        const newPeriod = await getCurrentPeriod(newConfig);
        renderByState(container, newPeriod, newConfig);

    } catch (err) {
        resultArea.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        btn.disabled    = false;
        btn.textContent = `Tutup Semester ${period.semester} Sekarang`;
    }
}

// ─────────────────────────────────────────────────────────────
// STATE B — RENDER BUKA SEMESTER 2
// ─────────────────────────────────────────────────────────────

async function renderOpenNextSemester(container, closedPeriod, config) {
    // Hitung default tanggal (format ISO YYYY-MM-DD → perbandingan string = kronologis).
    // Mulai: 1 Januari tahun berikutnya, TAPI tidak boleh di masa lalu atau sebelum
    // S1 selesai — ambil yang paling akhir agar default selalu lolos validasi
    // onOpenNextSemester (tidak pernah menolak nilai bawaannya sendiri).
    const closedYear  = parseInt(closedPeriod.academic_year.split('/')[0], 10);
    const today        = new Date().toISOString().slice(0, 10);
    const defaultStart = [`${closedYear + 1}-01-01`, today, closedPeriod.end_date]
        .filter(Boolean)
        .sort()
        .pop();
    // Selesai: 30 Juni tahun berikutnya, tapi jaga selalu setelah tanggal mulai
    // (kasus langka: S2 dibuka lewat pertengahan tahun → geser ke mulai + 6 bulan).
    const juneEnd    = `${closedYear + 1}-06-30`;
    let   defaultEnd = juneEnd;
    if (juneEnd <= defaultStart) {
        const d = new Date(`${defaultStart}T00:00:00`);
        d.setMonth(d.getMonth() + 6);
        defaultEnd = d.toISOString().slice(0, 10);
    }

    container.innerHTML = `
        <h3>Tutup Semester</h3>
        <div class="alert alert-success">
            Semester 1 (${closedPeriod.academic_year}) sudah ditutup.
        </div>

        <div class="card" style="margin-top:1.5rem; padding:1.5rem;">
            <p class="label" style="font-weight:600; margin-bottom:1rem;">
                BUKA SEMESTER 2
            </p>
            <p class="hint">
                Tentukan tanggal pelaksanaan Semester 2
                tahun ajaran ${closedPeriod.academic_year}.
            </p>

            <div class="form-group">
                <label for="next-sem-start">Tanggal Mulai Semester 2</label>
                <input type="date" id="next-sem-start"
                       class="form-control" value="${defaultStart}" />
            </div>
            <div class="form-group" style="margin-top:0.75rem;">
                <label for="next-sem-end">Tanggal Selesai Semester 2</label>
                <input type="date" id="next-sem-end"
                       class="form-control" value="${defaultEnd}" />
            </div>

            <div id="open-semester-result" style="margin-top:1rem;"></div>

            <button id="open-next-semester-btn" type="button"
                    class="btn btn-primary" style="margin-top:1rem;">
                Buka Semester 2 Sekarang
            </button>
        </div>
    `;

    document.getElementById('open-next-semester-btn')
        .addEventListener('click', () => onOpenNextSemester(container, closedPeriod, config));
}

async function onOpenNextSemester(container, closedPeriod, config) {
    const btn        = document.getElementById('open-next-semester-btn');
    const resultArea = document.getElementById('open-semester-result');
    const startDate  = document.getElementById('next-sem-start').value;
    const endDate    = document.getElementById('next-sem-end').value;

    // Validasi input
    if (!startDate || !endDate) {
        resultArea.innerHTML = `<div class="alert alert-danger">Tanggal mulai dan selesai wajib diisi.</div>`;
        return;
    }
    if (startDate >= endDate) {
        resultArea.innerHTML = `<div class="alert alert-danger">Tanggal mulai harus sebelum tanggal selesai.</div>`;
        return;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (startDate < today) {
        resultArea.innerHTML = `<div class="alert alert-danger">Tanggal mulai tidak boleh di masa lalu.</div>`;
        return;
    }
    if (closedPeriod.end_date && startDate < closedPeriod.end_date) {
        resultArea.innerHTML = `<div class="alert alert-danger">Tanggal mulai S2 tidak boleh sebelum tanggal selesai S1 (${closedPeriod.end_date}).</div>`;
        return;
    }

    const confirmed = window.confirm(
        `Buka Semester 2 (${closedPeriod.academic_year})?\n\n` +
        `Periode: ${startDate} s/d ${endDate}\n\n` +
        `Jadwal pelajaran lama tetap aktif sampai admin mengimport jadwal baru.`
    );
    if (!confirmed) return;

    btn.disabled    = true;
    btn.textContent = 'Memproses...';

    try {
        await openNextSemester(closedPeriod.academic_year, startDate, endDate);

        // Render halaman sukses + checklist transisi semester
        container.innerHTML = `
            <h3>Tutup Semester</h3>
            <div class="alert alert-success">
                Semester 2 (${closedPeriod.academic_year}) berhasil dibuka.
                Periode aktif: ${startDate} s/d ${endDate}.
            </div>
            <div class="card" style="margin-top:1.5rem; padding:1.5rem;">
                <p style="font-weight:600; margin-bottom:1rem;">
                    Yang perlu disiapkan untuk Semester 2:
                </p>
                <ol style="line-height:2rem; padding-left:1.25rem;">
                    <li>
                        <strong>Import jadwal baru</strong> —
                        jadwal semester 2 biasanya berbeda dari semester 1.
                    </li>
                    <li>
                        <strong>Cek dan update data aktor:</strong>
                        <ul style="margin-top:0.5rem; line-height:2rem;">
                            <li>Siswa — update status PKL, kembali dari PKL, atau keluar</li>
                            <li>Guru &amp; Staf — pastikan data aktif dan penugasan kelas sudah sesuai</li>
                            <li>Orang Tua — pastikan relasi ke siswa aktif sudah terdaftar</li>
                            <li>DUDI — tambahkan tempat PKL baru jika ada</li>
                        </ul>
                    </li>
                    <li>
                        <strong>Cek kasus terbuka</strong> —
                        pastikan kasus BK dari Semester 1 sudah ditangani atau didelegasikan.
                    </li>
                </ol>
            </div>
        `;

    } catch (err) {
        resultArea.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        btn.disabled    = false;
        btn.textContent = 'Buka Semester 2 Sekarang';
    }
}

// ─────────────────────────────────────────────────────────────
// DATABASE OPERATIONS
// ─────────────────────────────────────────────────────────────

async function getCurrentPeriod(config) {
    const { data, error } = await supabase
        .from('academic_periods')
        .select('*')
        .eq('academic_year', config.current_academic_year)
        .eq('semester',      config.current_semester)
        .maybeSingle();
    if (error) throw error;
    return data;
}

async function getCloseSummary(period) {
    const [obs, students, cases] = await Promise.all([
        supabase.from('observations')
            .select('observation_id', { count: 'exact', head: true })
            .gte('observed_at', period.start_date)
            .lte('observed_at', period.end_date),
        supabase.from('students')
            .select('student_id', { count: 'exact', head: true })
            .eq('student_status', 'AKTIF'),
        supabase.from('cases')
            .select('case_id', { count: 'exact', head: true })
            .neq('status', 'CLOSED'),
    ]);
    if (obs.error)      throw obs.error;
    if (students.error) throw students.error;
    if (cases.error)    throw cases.error;

    return {
        observationCount:   obs.count      ?? 0,
        activeStudentCount: students.count ?? 0,
        openCaseCount:      cases.count    ?? 0,
    };
}

/** Closes the active period and advances school_config.current_semester. */
export async function closeSemester(period, config) {
    const userRow = await getCurrentUserRow();

    const { error: closeErr } = await supabase
        .from('academic_periods')
        .update({
            status:            'CLOSED',
            closed_at:         new Date().toISOString(),
            closed_by_user_id: userRow.user_id,
        })
        .eq('id', period.id);
    if (closeErr) throw closeErr;

    if (period.semester === '1') {
        const { error: configErr } = await supabase
            .from('school_config')
            .update({ current_semester: '2' })
            .eq('config_id', config.config_id);
        if (configErr) throw configErr;
    }
    // semester === '2': school_config dibiarkan — Wizard Tutup Tahun Ajaran
    // yang akan advance current_academic_year dan current_semester.
}

/** Inserts a new ACTIVE academic_period for semester 2. */
async function openNextSemester(academicYear, startDate, endDate) {
    const { error } = await supabase
        .from('academic_periods')
        .insert({
            academic_year: academicYear,
            semester:      '2',
            start_date:    startDate,
            end_date:      endDate,
            status:        'ACTIVE',
        });
    if (error) throw error;
}
