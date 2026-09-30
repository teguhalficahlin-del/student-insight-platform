/**
 * @file stakeholder/js/dashboard.js
 * Dashboard Portal Stakeholder — ringkasan agregat sekolah (view-only).
 */

import { applyBrandingById, getLoginUrl } from '../../shared/branding.js';
import { checkMustChangePassword } from '../../shared/change-password.js';
import { initLoginGuard } from '../../shared/login-guard.js';
import { initSessionGuard } from '../../shared/session-guard.js';
import {
    supabase, logout, getCurrentUserRow, STAKEHOLDER_ROLES,
    getStakeholderSummary, getKepsekMonitoring, getSchoolConfig,
} from './api.js';
import { showPwaBanner } from '../../shared/pwa-banner.js';

function fmtNum(n)  { return (n ?? 0).toLocaleString('id-ID'); }
function fmtPct(n)  { return (n === null || n === undefined) ? '—' : n + '%'; }
function fmtTime(d) {
    if (!d) return '—';
    return 'Diperbarui ' + new Date(d).toLocaleString('id-ID', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

// ─── MONITORING KEHADIRAN ────────────────────────────────────
// Dipindahkan dari portal guru (guru/js/dashboard.js, tab Kepsek).
// Sumber data sama persis: RPC fn_kepsek_monitoring. Nama fungsi dan
// id DOM dipertahankan agar mudah dibandingkan bila salah satunya
// berubah di kemudian hari.

const BULAN_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

let _config  = null;
let _ksChart = null;

function localDateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _prevAcademicYear() {
    const y = parseInt(_config?.current_academic_year?.split('/')[0] ?? new Date().getFullYear());
    return `${y - 1}/${y}`;
}

function fmtChartLabel(dateStr, byMonth) {
    const d = new Date(dateStr + 'T00:00:00');
    return byMonth
        ? BULAN_ID[d.getMonth()] + ' ' + d.getFullYear()
        : d.getDate() + ' ' + BULAN_ID[d.getMonth()];
}

async function init() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) { window.location.replace(getLoginUrl()); return; }

    const user = await getCurrentUserRow(auth.user);
    if (!user || !STAKEHOLDER_ROLES.includes(user.role_type)) {
        await supabase.auth.signOut();
        window.location.replace(getLoginUrl());
        return;
    }

    document.getElementById('hdr-name').textContent = user.full_name;
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display     = 'block';
    await Promise.all([
        applyBrandingById(user.school_id, supabase),
        checkMustChangePassword(supabase, user),
        initLoginGuard(supabase, user),
        loadSummary(),
        getSchoolConfig().then(c => { _config = c; }).catch(() => { _config = null; }),
    ]);

    // Monitoring kehadiran — identik dengan tampilan Kepala Sekolah
    wireMonitoringControls();
    await loadKepsekMonitoring('7_hari');

    document.getElementById('refresh-btn').onclick = () => {
        loadSummary();
        const aktif = document.querySelector('.ks-period-btn.active');
        loadKepsekMonitoring(aktif?.dataset.period ?? '7_hari');
    };
    showPwaBanner({ hasBottomNav: false });
    initSessionGuard(supabase, getLoginUrl());
}

async function loadSummary() {
    const btn    = document.getElementById('refresh-btn');
    const errBox = document.getElementById('error-box');
    btn.disabled = true;
    btn.textContent = 'Memuat…';
    errBox.style.display = 'none';

    try {
        const s = await getStakeholderSummary();
        document.getElementById('st-siswa').textContent          = fmtNum(s.total_siswa);
        document.getElementById('st-pkl').textContent            = fmtNum(s.total_pkl);
        document.getElementById('st-staf').textContent           = fmtNum(s.total_staf);
        document.getElementById('st-program').textContent        = fmtNum(s.total_program);
        document.getElementById('st-kelas').textContent          = fmtNum(s.total_kelas);
        document.getElementById('st-kehadiran-bulan').textContent = fmtPct(s.kehadiran_bulan_pct);
        document.getElementById('st-sesi').textContent           = fmtNum(s.sesi_hari_ini);
        document.getElementById('st-hadir-hari').textContent     = fmtNum(s.hadir_hari_ini);
        document.getElementById('updated-at').textContent        = fmtTime(s.updated_at);
    } catch (err) {
        errBox.textContent   = 'Gagal memuat ringkasan. Periksa koneksi lalu coba lagi.';
        errBox.style.display = 'block';
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Muat Ulang';
    }
}

async function loadKepsekMonitoring(period, academicYear = null, dateStart = null, dateEnd = null) {
    const errEl    = document.getElementById('ks-monitoring-error');
    const pctSiswa = document.getElementById('ks-pct-siswa');
    const pctGuru  = document.getElementById('ks-pct-guru');
    const detSiswa = document.getElementById('ks-detail-siswa');
    const detGuru  = document.getElementById('ks-detail-guru');
    const hintEl   = document.getElementById('ks-chart-hint');

    pctSiswa.textContent = '…';
    pctGuru.textContent  = '…';
    detSiswa.textContent = '';
    detGuru.textContent  = '';
    errEl.style.display  = 'none';

    try {
        // 'hari_ini' pakai tanggal lokal browser, bukan CURRENT_DATE UTC di DB
        let _period    = period;
        let _dateStart = dateStart;
        let _dateEnd   = dateEnd;
        if (period === 'hari_ini') {
            const today = localDateStr();
            _period    = 'rentang';
            _dateStart = today;
            _dateEnd   = today;
        }
        const d = await getKepsekMonitoring(_period, academicYear, _dateStart, _dateEnd);
        const s = d.summary ?? {};

        pctSiswa.textContent = (s.pct_siswa != null && !isNaN(s.pct_siswa)) ? s.pct_siswa + '%' : '0%';
        pctGuru.textContent  = (s.pct_guru != null && !isNaN(s.pct_guru)) ? s.pct_guru + '%' : '0%';
        const countLate  = document.getElementById('ks-count-late');
        const countExits = document.getElementById('ks-count-exits');
        if (countLate)  countLate.textContent  = s.count_late  != null ? s.count_late  + ' siswa' : '—';
        if (countExits) countExits.textContent = s.count_exits != null ? s.count_exits + ' siswa' : '—';
        detSiswa.textContent = `${s.siswa_hadir ?? 0} / ${s.siswa_total ?? 0} siswa hadir`;
        detGuru.textContent  = `${s.guru_hadir  ?? 0} / ${s.guru_total  ?? 0} guru hadir`;

        const chartData = d.chart ?? [];
        hintEl.textContent = chartData.length === 0
            ? 'Belum ada data pada periode ini'
            : d.by_month ? 'Persentase kehadiran per bulan' : 'Persentase kehadiran per hari';

        renderKepsekChart(chartData, d.by_month);

        // Nonaktifkan tombol Tahun Lalu bila tidak ada data untuk tahun ajaran lalu
        const btnTahunLalu = document.querySelector('.ks-period-btn[data-period="tahun_ajaran_lalu"]');
        if (btnTahunLalu) {
            const earliest = d.data_earliest;
            const _prevAyEnd = _prevAcademicYear().split('/')[1] + '-06-30';
            const noData = !earliest || earliest > _prevAyEnd;
            btnTahunLalu.disabled = noData;
            btnTahunLalu.style.opacity = noData ? '0.4' : '';
            if (noData && btnTahunLalu.classList.contains('active')) {
                btnTahunLalu.classList.remove('active');
                const btn7 = document.querySelector('.ks-period-btn[data-period="7_hari"]');
                if (btn7) btn7.classList.add('active');
                loadKepsekMonitoring('7_hari');
            }
        }
    } catch (err) {
        errEl.textContent   = `Gagal memuat data monitoring: ${err.message ?? err}`;
        errEl.style.display = 'block';
        pctSiswa.textContent = '—';
        pctGuru.textContent  = '—';
        console.error('[stakeholder monitoring]', err);
    }
}

function renderKepsekChart(chartData, byMonth) {
    const canvas = document.getElementById('ks-chart');
    const maxY2  = Math.max(10, ...chartData.map(p => p.count_late ?? 0), ...chartData.map(p => p.count_exits ?? 0));
    const labels     = chartData.map(p => fmtChartLabel(p.date, byMonth));
    const dataSiswa  = chartData.map(p => p.pct_siswa);
    const dataGuru   = chartData.map(p => p.pct_guru);
    const dataLate   = chartData.map(p => p.count_late  ?? null);
    const dataExits  = chartData.map(p => p.count_exits ?? null);

    if (_ksChart) { _ksChart.destroy(); _ksChart = null; }

    _ksChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Kehadiran Siswa (%)',
                    data: dataSiswa,
                    borderColor: '#1D9E75',
                    backgroundColor: '#1D9E7518',
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y1',
                    pointRadius: chartData.length <= 14 ? 4 : 2,
                    spanGaps: true,
                },
                {
                    label: 'Kehadiran Guru (%)',
                    data: dataGuru,
                    borderColor: '#185FA5',
                    backgroundColor: '#185FA518',
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y1',
                    pointRadius: chartData.length <= 14 ? 4 : 2,
                    spanGaps: true,
                },
                {
                    label: 'Keterlambatan',
                    data: dataLate,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245,158,11,0.1)',
                    tension: 0.3,
                    yAxisID: 'y2',
                    pointRadius: chartData.length <= 14 ? 4 : 2,
                    spanGaps: true,
                },
                {
                    label: 'Izin Keluar',
                    data: dataExits,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139,92,246,0.1)',
                    tension: 0.3,
                    yAxisID: 'y2',
                    pointRadius: chartData.length <= 14 ? 4 : 2,
                    spanGaps: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const v = ctx.parsed.y;
                            if (ctx.dataset.yAxisID === 'y2') {
                                return `${ctx.dataset.label}: ${v != null ? v + ' siswa' : '—'}`;
                            }
                            return `${ctx.dataset.label}: ${v != null ? v + '%' : '0%'}`;
                        },
                    },
                },
            },
            scales: {
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    min: 0, max: 100,
                    ticks: { callback: v => v + '%', font: { size: 11 } },
                    grid: { color: '#0001' },
                },
                y2: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    min: 0,
                    max: maxY2,
                    title: { display: true, text: 'Jumlah Siswa', font: { size: 10 } },
                    ticks: { font: { size: 11 }, precision: 0 },
                    grid: { drawOnChartArea: false },
                },
                x: { ticks: { font: { size: 11 }, maxRotation: 45 } },
            },
        },
    });
}

function wireMonitoringControls() {
    document.getElementById('ks-period-toggle')?.addEventListener('click', e => {
        const btn = e.target.closest('.ks-period-btn');
        if (!btn || btn.disabled) return;
        document.querySelectorAll('.ks-period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const period = btn.dataset.period;
        const ayLalu = period === 'tahun_ajaran_lalu' ? _prevAcademicYear() : null;
        loadKepsekMonitoring(period, ayLalu);
    });

    document.getElementById('ks-range-btn')?.addEventListener('click', () => {
        const start = document.getElementById('ks-range-start').value;
        const end   = document.getElementById('ks-range-end').value;
        if (!start || !end) return;
        document.querySelectorAll('.ks-period-btn').forEach(b => b.classList.remove('active'));
        loadKepsekMonitoring('rentang', null, start, end);
    });

    // Default rentang: 7 hari terakhir
    document.getElementById('ks-range-start').value = localDateStr(new Date(Date.now() - 6 * 86400000));
    document.getElementById('ks-range-end').value   = localDateStr();
}

document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await logout();
    window.location.replace(getLoginUrl());
});

init().catch(err => console.error('[stakeholder] init failed:', err));
