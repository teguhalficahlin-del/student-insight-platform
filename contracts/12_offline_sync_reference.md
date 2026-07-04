# Offline Sync Contract Reference
**Version:** 1.1.0

> **Status implementasi (4 Juli 2026):**
> - ✅ **Category A** — diimplementasi dengan pola online-first + IndexedDB per-store per portal (bukan `offline_queue` generik). Tidak memakai Service Worker / Background Sync API.
> - ✅ **Category B** — diimplementasi via `localStorage` stale-while-revalidate di tiap `dashboard.js`.
> - `[PLANNED]` — bagian-bagian bertanda ini **belum diimplementasi** dan menggambarkan arsitektur target masa depan. Jangan asumsikan sudah ada di kode.

---

## Kategori Operasi Offline

### Category A — Tulis Operasional (Queue + Background Sync)
Operasi tulis yang harus sampai ke server. Ditangani oleh `offline.js` + IndexedDB per portal + flush saat `online` event (tanpa Service Worker).

> **Implementasi aktual:** Setiap portal punya `offline.js` sendiri dengan store IndexedDB terpisah (`att_queue`, `obs_queue`, `pkl_att_queue`, dll). Flush dilakukan di main thread saat `navigator.onLine` atau event `online` — **bukan** via Background Sync API / Service Worker.

| Operasi | Queue Type | Portal |
|---|---|---|
| Absensi siswa (guru) | `ATTENDANCE_BATCH` | Guru |
| Observasi siswa | `OBSERVATION_CREATE` | Guru, DUDI |
| Entri jurnal | `JOURNAL_CREATE` | Guru |
| Event kasus | `CASE_EVENT_CREATE` | Guru |

**Aturan:** Kasus baru (`CASE_CREATE`) **wajib online** — tidak diantrikan. Tombol diblokir saat `navigator.onLine === false`.

### Category B — Baca Agregat (LocalStorage stale-while-revalidate)
Data tampilan yang aman ditampilkan stale, lalu di-refresh di latar belakang. Diimplementasi langsung di `dashboard.js` masing-masing portal via helper `LC` (localStorage prefix per portal).

| Data | Cache Key | Portal |
|---|---|---|
| Daftar siswa | `smkhr:myStudents-{userId}` | Guru |
| Jadwal mengajar | `smkhr:sched-{userId}-{date}` | Guru |
| Daftar jurnal | `smkhr:jurnal-{userId}` | Guru |
| Jadwal siswa | `smkhr:stu-sched-{studentId}-{date}` | Siswa |
| Observasi siswa | `smkhr:stu-obs-{studentId}` | Siswa |
| Observasi (ortu) | `smkhr:ortu-obs-{studentId}` | Ortu |
| Daftar siswa DUDI | `dudi:students-{userId}` | DUDI |
| Riwayat absensi DUDI | `dudi:att-hist-{userId}` | DUDI |
| Riwayat observasi DUDI | `dudi:obs-{userId}` | DUDI |

**Pola implementasi:**
```javascript
const cached = LC.get(key);
if (cached) render(cached);          // tampil instan
try {
    const fresh = await fetchData();
    LC.set(key, fresh);
    render(fresh);                   // update dengan data baru
} catch (err) {
    if (!cached) showError(err);     // error hanya jika tidak ada cache
}
```

**Saat logout:** `LC.clear()` menghapus semua key dengan prefix portal tersebut.

---

## Arsitektur Offline `[PLANNED]`

> Diagram berikut menggambarkan arsitektur **target** dengan Service Worker. Implementasi saat ini lebih sederhana: flush dilakukan di main thread, tanpa SW, tanpa `postMessage`.

```
┌─────────────────────────────────────────────────────────────┐
│  MAIN THREAD (Browser)                                       │
│                                                             │
│  User Action → buildOfflineQueueItem() → OfflineQueue.enqueue()
│                                                             │
│  UI Render ← OfflineQueue.cacheRead() ← IndexedDB Cache    │
│                                                             │
│  Sync Indicator ← SyncEngine.getQueueStatus()              │
└──────────────────────────┬──────────────────────────────────┘
                           │ postMessage / Background Sync
┌──────────────────────────▼──────────────────────────────────┐
│  SERVICE WORKER                                              │
│                                                             │
│  sync event → SyncEngine.flushQueue()                      │
│    → OfflineQueue.dequeueBatch()                            │
│    → _processItem() → Api.sync*()                           │
│    → markSuccess / markFailed / markConflict                │
│                                                             │
│  periodicsync → SyncEngine.pullData()                       │
│    → PostgREST fetch → OfflineQueue.cacheWrite()            │
└─────────────────────────────────────────────────────────────┘
```

---

## IndexedDB Stores

### `offline_queue` `[PLANNED]`

> **Belum diimplementasi.** Implementasi aktual memakai store terpisah per portal (`att_queue`, `obs_queue`, `pkl_att_queue`, dll) dengan struktur yang lebih sederhana — tidak ada `_status`, `retry_count`, atau `max_retries`.

Item Category A yang menunggu dikirim ke server.

| Field | Type | Keterangan |
|---|---|---|
| `idempotency_key` | string (PK) | UUID v4 dibuat saat enqueue |
| `queue_type` | OFFLINE_QUEUE_TYPE | Tipe operasi |
| `created_offline_at` | ISO timestamp | Waktu dibuat |
| `schema_version` | string | Versi schema saat dibuat |
| `retry_count` | integer | Dimulai dari 0 |
| `max_retries` | integer | Default 5 |
| `_status` | PENDING \| PROCESSING \| FAILED | Status saat ini |
| `_enqueued_at` | ISO timestamp | Waktu masuk queue |
| `_processing_at` | ISO timestamp \| null | Waktu mulai diproses |
| `_last_error` | string \| null | Error terakhir |
| + semua field dari OFFLINE_QUEUE_SCHEMAS | | |

**Indexes:**
- `by_queue_type` — untuk filter per tipe
- `by_created_at` — untuk FIFO ordering
- `by_status` — untuk mencari PENDING
- `by_type_status` — compound, untuk proses per tipe per status

**Kapasitas:** maks 500 item. Jika penuh, item FAILED tertua dievict.

---

### `sync_cache`

Data read-only untuk offline rendering.

| Field | Type | Keterangan |
|---|---|---|
| `cache_key` | string (PK) | Namespaced key (e.g. `schedule:uuid`) |
| `data_type` | string | Tipe data (e.g. `schedule`, `case`) |
| `data` | any | Payload JSON |
| `cached_at` | ISO timestamp | Waktu di-cache |
| `expires_at` | ISO timestamp | TTL |

**Cache key prefixes:**

| Prefix | Contoh | TTL |
|---|---|---|
| `schedule:{id}` | `schedule:abc-123` | 7 hari |
| `schedule_list:{userId}:{date}` | `schedule_list:uid:2024-01-15` | 7 hari |
| `student:{id}` | `student:abc-123` | 7 hari |
| `student_list:{classId}` | `student_list:cls-456` | 7 hari |
| `case:{id}` | `case:abc-123` | 1 hari |
| `case_events:{id}` | `case_events:abc-123` | 1 hari |
| `obs_list:{studentId}` | `obs_list:std-789` | 1 hari |
| `assignment_list:{userId}` | `assignment_list:uid` | 7 hari |
| `user_profile:{userId}` | `user_profile:uid` | 7 hari |
| `substitute:{scheduleId}` | `substitute:sch-123` | 7 hari |

**Kapasitas:** maks 2000 item. Expired items di-evict saat storage > 80%.

---

### `conflict_queue` `[PLANNED]`

> **Belum diimplementasi.** Penolakan server saat ini langsung dibuang (tidak diantrikan ke conflict_queue).

Item yang ditolak server karena `CONFLICT_CASE_STATE` (HTTP 409).

| Field | Type | Keterangan |
|---|---|---|
| `idempotency_key` | string (PK) | Sama dengan item di offline_queue |
| `case_id` | uuid | Untuk lookup per kasus |
| `_conflict_at` | ISO timestamp | Waktu konflik terdeteksi |
| `_server_current_state` | object | State kasus terkini dari server |
| + semua field dari item asli | | |

**Resolusi:** User harus memilih DISCARD atau REQUEUE secara manual.

---

### `sync_meta`

| Key | Value | Keterangan |
|---|---|---|
| `schema_version` | string | Versi schema saat ini |
| `user_id` | uuid | User yang login |
| `last_full_sync` | ISO timestamp | Waktu data pull terakhir |
| `last_sync:{store}` | ISO timestamp | Last sync per store |

---

### `dead_letter` `[PLANNED]`

> **Belum diimplementasi.** Item yang gagal permanen saat ini langsung dibuang dari IndexedDB.

Item yang exhausted `max_retries` atau schema mismatch. Disimpan untuk debugging.

| Field | Keterangan |
|---|---|
| `dead_at` | Waktu di-dead-letter |
| `_death_reason` | Alasan kematian item |

**Kapasitas:** maks 100 item. Tidak di-evict otomatis — perlu manual clear atau app reinstall.

---

## Lifecycle Item `[PLANNED]`

> **Belum diimplementasi sepenuhnya.** Lifecycle aktual: coba kirim online-first → jika gagal jaringan, antrikan ke IndexedDB → flush saat `online` event. Tidak ada PROCESSING state, tidak ada retry_count, tidak ada dead_letter.

```
User Action (offline)
    │
    ▼
buildOfflineQueueItem()  ← event_schema.js
validate() → { valid, errors, item }
    │
    ├── invalid → tampilkan error ke user, tidak enqueue
    │
    ▼
OfflineQueue.enqueue(item)
    │
    ├── duplicate idempotency_key → return { enqueued: false }
    ├── queue full → evict FAILED items → retry
    │
    ▼
offline_queue [ _status = PENDING ]
    │
    ▼  (saat online, background sync event)
OfflineQueue.dequeueBatch(10)
    ├── filter: _status = PENDING
    ├── sort: PROCESSING_ORDER priority, then FIFO
    ├── mark: _status = PROCESSING, _processing_at = now
    │
    ▼
_processItem(item, api, queue)
    │
    ├── 200 OK → markSuccess() → DELETE from queue
    │              broadcast ITEM_SYNCED ke main thread
    │
    ├── 409 CONFLICT → markConflict() → MOVE to conflict_queue
    │                  broadcast ITEM_CONFLICT ke main thread
    │
    ├── 4xx (non-retryable) → markFailed()
    │    retry_count += 1
    │    if retry_count >= max_retries → MOVE to dead_letter
    │    else → _status = PENDING (akan diproses lagi)
    │
    ├── 5xx / 429 → markFailed() → sama dengan 4xx non-retryable
    │
    └── network error → markFailed() tanpa increment retry_count
                        throw → Background Sync akan retry
```

---

## Processing Priority Order `[PLANNED]`

> **Belum diimplementasi.** Flush aktual memproses semua store secara paralel tanpa prioritas antar-tipe.

Item diproses dalam urutan berikut (dalam satu batch):

1. `ATTENDANCE_BATCH` — paling time-sensitive (data absensi per sesi)
2. `CASE_CREATE` — kasus baru harus ada sebelum event-nya
3. `CASE_EVENT_CREATE`
4. `OBSERVATION_CREATE`
5. `JOURNAL_CREATE` — paling rendah (data privat, tidak blocking)

Dalam satu tipe, urutan FIFO berdasarkan `created_offline_at`.

---

## Conflict Resolution Flow `[PLANNED]`

> **Belum diimplementasi.** Saat ini HTTP 409 dianggap "penolakan server" dan item langsung dibuang — tidak ada dialog resolusi konflik ke user.

Saat item `CASE_EVENT_CREATE` menerima respons 409:

```
Server returns:
{
  "error": {
    "code": "CONFLICT_CASE_STATE",
    "context": {
      "current_status": "UNDER_REVIEW",
      "current_handler_role": "BK",
      "is_locked": false,
      "last_event_at": "2024-01-15T07:45:00Z"
    }
  }
}
```

SyncEngine:
1. Panggil `queue.markConflict(key, context)` → item pindah ke `conflict_queue`
2. Broadcast `ITEM_CONFLICT` ke semua tabs via `clients.postMessage()`

Main thread:
3. Terima message `ITEM_CONFLICT`
4. Tampilkan conflict resolution dialog

User choices:
- **Discard** → `queue.resolveConflict(key, 'DISCARD')` → item dihapus
- **Refresh & Retry** → fetch kasus terbaru dari server, tampilkan ke user,
                        jika aksi masih valid: `queue.resolveConflict(key, 'REQUEUE')`

---

## Data Pull Scope `[PLANNED]`

> **Belum diimplementasi.** `SyncEngine` dan `sync_cache` belum ada. Data offline saat ini hanya dari localStorage (Category B).

`SyncEngine.pullData()` menarik data berikut ke `sync_cache`:

| Data | Source | Filter |
|---|---|---|
| User profile | `users` table | `user_id = current_user` |
| Teaching assignments | `teaching_assignments` | `user_id = current_user, is_active = true` |
| Schedules (7 hari) | `v_offline_sync_manifest_guru` | `teacher_id = current_user, date range` |
| Substitute schedules | `v_offline_sync_manifest_substitute` | `substitute_user_id = current_user, today` |
| Active cases | `cases` + `case_events` | `current_handler_role = current_role, status != CLOSED` |

**Tidak di-pull:**
- Semua kasus (hanya yang sedang ditangani user)
- Data siswa global (hanya via schedule manifest)
- Pesan orang tua (Category B — online only)
- Dashboard agregat (Category B)

---

## Service Worker Setup `[PLANNED]`

> **Belum diimplementasi.** Service Worker saat ini dinonaktifkan secara sengaja (self-destruct untuk cegah stale deploy). Semua kode di bagian ini adalah target arsitektur masa depan.

### Registrasi di `service_worker.js`

```javascript
import { SyncEngine } from './12_sync_engine.js';

// Terima konfigurasi dari main thread
self.addEventListener('message', (event) => {
    if (event.data?.type === 'SW_CONFIG') {
        SyncEngine.configure({
            postgrestUrl: event.data.postgrestUrl,
            functionsUrl: event.data.functionsUrl,
            getToken:     async () => event.data.token, // disimpan di SW memory
            userId:       event.data.userId,
            userRole:     event.data.userRole,
        });
    }
});

// Background Sync
self.addEventListener('sync', (event) => {
    if (event.tag === SyncEngine.SYNC_TAGS.QUEUE_FLUSH) {
        event.waitUntil(SyncEngine.flushQueue());
    }
    if (event.tag === SyncEngine.SYNC_TAGS.DATA_PULL) {
        event.waitUntil(SyncEngine.pullData());
    }
});

// Periodic Sync (jika browser mendukung)
self.addEventListener('periodicsync', (event) => {
    if (event.tag === SyncEngine.SYNC_TAGS.DATA_PULL) {
        event.waitUntil(SyncEngine.pullData());
    }
});
```

### Konfigurasi dari main thread

```javascript
// Di app.js, setelah login berhasil
const registration = await navigator.serviceWorker.ready;
const { data: { session } } = await supabase.auth.getSession();

registration.active.postMessage({
    type:         'SW_CONFIG',
    postgrestUrl: `${SUPABASE_URL}/rest/v1`,
    functionsUrl: `${SUPABASE_URL}/functions/v1`,
    token:        session.access_token,
    userId:       session.user.id,
    userRole:     currentUser.role_type,
});
```

### Trigger manual sync (setelah user action)

```javascript
// Setelah enqueue item
await queue.enqueue(item);
await SyncEngine.requestSync(); // register background sync tag
```

---

## Schema Version Migration `[PLANNED]`

> **Belum diimplementasi.** Saat ini schema version dicek per-store (`_schema_ver` di tiap item IDB) dan item lama di-discard — bukan via mekanisme `OfflineQueue.checkSchemaVersion()` generik ini.

Saat app diupdate dengan perubahan breaking (major version bump):

```
App load → OfflineQueue.checkSchemaVersion()
    │
    ├── major version sama → OK, lanjut normal
    │
    └── major version berbeda →
            _clearQueuesForMigration()
              DELETE semua dari offline_queue
              DELETE semua dari conflict_queue
              (sync_cache dipertahankan — format data tidak berubah)
            setMeta(SCHEMA_VERSION, new_version)
            return { action: 'MAJOR_VERSION_MIGRATION', warning: '...' }
```

App harus menampilkan pesan ke user: *"Aplikasi telah diperbarui. Data offline yang belum terkirim telah dihapus. Pastikan Anda terhubung ke internet untuk sinkronisasi data terbaru."*

---

## Storage Guard `[PLANNED]`

> **Belum diimplementasi.** Tidak ada batas kapasitas atau eviction otomatis pada implementasi saat ini.

| Threshold | Aksi |
|---|---|
| Usage > 80% | Evict expired cache sebelum data pull |
| offline_queue ≥ 500 item | Evict item FAILED tertua, tolak enqueue baru jika masih penuh |
| conflict_queue ≥ 50 item | Warning di UI: "Ada 50+ item menunggu resolusi" |
| dead_letter ≥ 100 item | Warning di UI: "Ada item yang gagal permanen. Hubungi admin." |

Cek storage:
```javascript
const estimate = await OfflineQueue.storageEstimate();
// { usageBytes: 12345678, quotaBytes: 524288000, usagePercent: 2 }
```

---

## Main Thread: Mendengarkan Pesan dari SW `[PLANNED]`

> **Belum diimplementasi.** Tidak ada komunikasi SW → main thread karena SW belum aktif. Status sync saat ini ditangani langsung via return value `flushPending()`.

```javascript
navigator.serviceWorker.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.source !== 'sync_engine') return;

    switch (msg.type) {
        case 'SYNC_COMPLETE':
            updateSyncIndicator('synced');
            break;

        case 'ITEM_SYNCED':
            // Update UI untuk item yang berhasil disync
            refreshRelatedData(msg.queue_type);
            break;

        case 'ITEM_CONFLICT':
            // Tampilkan conflict resolution dialog
            showConflictDialog({
                idempotencyKey: msg.idempotency_key,
                caseId:         msg.case_id,
                currentState:   msg.currentState,
            });
            break;

        case 'DATA_PULL_COMPLETE':
            if (msg.errors) console.warn('Partial pull errors:', msg.errors);
            refreshAllViews();
            break;
    }
});
```
