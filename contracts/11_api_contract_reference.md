# API Contract Reference
**Version:** 1.0.0
**Base URL:** `https://<project-ref>.supabase.co/functions/v1`

---

## Konvensi Global

### Request Headers (semua endpoint)
```
Content-Type:       application/json
Authorization:      Bearer <user_jwt>
x-schema-version:  1.0.0
```

### Response Shape — Sukses
```json
{ "data": { ... } }
```

### Response Shape — Error
```json
{
  "error": {
    "code":           "ERROR_CODE",
    "message":        "Pesan human-readable",
    "details":        ["field-level error 1"],
    "context":        null,
    "schema_version": "1.0.0",
    "timestamp":      "2024-01-15T08:00:00.000Z"
  }
}
```

### HTTP Status Codes

| Status | Situasi |
|---|---|
| `200` | Sukses (termasuk idempotent duplicate) |
| `400` | Validasi payload gagal |
| `401` | JWT tidak ada atau expired |
| `403` | JWT valid tapi tidak ada akses |
| `409` | Conflict — state server berubah sejak snapshot |
| `422` | Domain invariant violation |
| `429` | Rate limit |
| `500` | Server error (retryable) |
| `503` | Service unavailable (retryable) |

### Retry Policy
- Status `429`, `500`, `503` → retry otomatis, maks 3x
- Backoff: 500ms → 1000ms → 2000ms
- Timeout per request: 15 detik
- Status lain → tidak di-retry

---

## Endpoint Inventory

| Endpoint | Auth | Offline? | Idempotent? |
|---|---|---|---|
| `POST sync-attendance-batch` | User JWT | ✅ Category A | ✅ UPSERT |
| `POST sync-observation` | User JWT | ✅ Category A | ✅ ON CONFLICT |
| `POST sync-journal` | User JWT | ✅ Category A | ✅ ON CONFLICT |
| `POST sync-case-event` | User JWT | ✅ Category A | ✅ ON CONFLICT |
| `POST sync-case-create` | User JWT | ✅ Category A | ✅ ON CONFLICT |
| `POST send-parent-reply` | User JWT | ❌ Online only | ❌ Per-call |
| `POST provision-user` | KEPSEK JWT | ❌ Online only | ✅ keyed on email |
| `POST evaluate-teacher-indicators` | KEPSEK / Cron | ❌ Online only | ✅ idempotent |
| `GET health` | None | — | — |

---

## Endpoint Detail

---

### POST `sync-attendance-batch`

Mengisi absensi untuk satu sesi mengajar penuh. Satu request = satu sesi, bukan per-siswa.

**Siapa yang boleh:** Guru yang bertugas (`assigned_teacher_id`) atau guru pengganti dengan token valid.

**Request:**
```json
{
  "idempotency_key":    "uuid",
  "schedule_id":        "uuid *",
  "submitted_by":       "uuid *   — user_id pengisi",
  "session_date":       "YYYY-MM-DD *",
  "records": [
    {
      "student_id": "uuid *",
      "status":     "HADIR | TIDAK_HADIR | IZIN | SAKIT *",
      "source":     "AUTO_DETECTED | MANUAL_OVERRIDE | TEACHER_DECLARED *"
    }
  ],
  "substitute_token":   "string   — wajib jika guru pengganti",
  "meeting_status":     "NORMAL | KEGIATAN_SEKOLAH | GURU_TIDAK_HADIR",
  "_schema_version":    "1.0.0"
}
```

**Response 200:**
```json
{
  "data": {
    "schedule_id":      "uuid",
    "records_upserted": 32,
    "was_duplicate":    false
  }
}
```

**Idempotency:** UPSERT per `(schedule_id, student_id)`. Aman dikirim ulang.
Jika `meeting_status = GURU_TIDAK_HADIR` → semua records di-void oleh trigger server.

**Error spesifik:**

| Code | Situasi |
|---|---|
| `SYNC_TOKEN_EXPIRED` | Token guru pengganti sudah kedaluwarsa |
| `NOT_ASSIGNED_TEACHER` | Bukan guru yang bertugas atau pengganti valid |
| `SCHEDULE_NOT_FOUND` | `schedule_id` tidak ditemukan |

---

### POST `sync-observation`

Membuat satu catatan observasi siswa.

**Siapa yang boleh:** GURU, WALI_KELAS, BK, KAPRODI, KEPSEK.

**Request:**
```json
{
  "idempotency_key":  "uuid *",
  "student_id":       "uuid *",
  "author_user_id":   "uuid *",
  "sentiment":        "POSITIF | NEGATIF *",
  "dimension":        "AKADEMIK | KEHADIRAN | PERILAKU | SOSIAL | AFEKTIF | BAKAT_MINAT | FISIK | LAINNYA *",
  "content":          "string, min 10, max 1000 *",
  "visibility":       "INTERNAL_SCHOOL | STUDENT_VISIBLE *",
  "observed_at":      "YYYY-MM-DD *",
  "schedule_id":      "uuid   — opsional, untuk signal teacher_attendance",
  "class_id":         "uuid   — opsional",
  "_schema_version":  "1.0.0"
}
```

**Response 200:**
```json
{
  "data": {
    "observation_id": "uuid",
    "was_duplicate":  false
  }
}
```

**Catatan server:**
- Jika `sentiment = NEGATIF` dan `visibility = STUDENT_VISIBLE` → `visibility_override_flag = true` di-set
- Jika `schedule_id` disertakan → INSERT ke `teacher_attendance_log`
- Idempotency: `ON CONFLICT (idempotency_key) DO NOTHING`, return existing `observation_id`

---

### POST `sync-journal`

Membuat satu entri jurnal mengajar. **Hanya terlihat oleh pemilik.**

**Siapa yang boleh:** GURU, WALI_KELAS.

**Request:**
```json
{
  "idempotency_key":  "uuid *",
  "owner_user_id":    "uuid *",
  "content":          "string, min 1, max 10000 *",
  "entry_date":       "YYYY-MM-DD *",
  "schedule_id":      "uuid   — opsional",
  "class_id":         "uuid   — opsional",
  "_schema_version":  "1.0.0"
}
```

**Response 200:**
```json
{
  "data": {
    "journal_id":    "uuid",
    "was_duplicate": false
  }
}
```

---

### POST `sync-case-event`

Menambahkan satu event ke log kasus. Endpoint paling kompleks.

**Siapa yang boleh:** Bergantung pada `event_type` (lihat Event Schema Reference).

**Request:**
```json
{
  "idempotency_key":          "uuid *",
  "case_id":                  "uuid *",
  "event_type":               "CASE_EVENT_TYPE *",
  "author_user_id":           "uuid *",
  "author_role":              "ROLE_TYPE *",
  "privacy_level":            "VISIBILITY_LEVEL *",
  "payload":                  "object *",

  "case_status_snapshot":     "CASE_STATUS *   — state saat offline action",
  "current_handler_snapshot": "ROLE_TYPE *",
  "is_locked_snapshot":       "boolean *",

  "previous_handler_role":    "ROLE_TYPE   — untuk DECISION_ESCALATE",
  "new_handler_role":         "ROLE_TYPE   — untuk DECISION_ESCALATE",
  "previous_status":          "CASE_STATUS — untuk transisi status",
  "new_status":               "CASE_STATUS — untuk transisi status",
  "parent_message_id":        "uuid        — untuk PARENT_MESSAGE_*",

  "_schema_version":          "1.0.0"
}
```

**Response 200:**
```json
{
  "data": {
    "event_id":           "uuid",
    "case_id":            "uuid",
    "new_case_status":    "CLOSED",
    "new_handler_role":   "BK",
    "was_duplicate":      false
  }
}
```

**Response 409 — Conflict:**
```json
{
  "error": {
    "code":    "CONFLICT_CASE_STATE",
    "message": "State kasus berubah sejak snapshot offline",
    "context": {
      "current_status":       "UNDER_REVIEW",
      "current_handler_role": "BK",
      "is_locked":            false,
      "last_event_at":        "2024-01-15T07:45:00.000Z"
    }
  }
}
```

**Server validation sequence (dalam satu transaction):**

```
1. SELECT cases WHERE case_id = ? FOR UPDATE
2. Cek INV-1: status != CLOSED
3. Cek INV-3: author_role = current_handler_role
   (kecuali FINAL_DECISION_MADE dan PARENT_MESSAGE_LINKED)
4. Cek INV-4: jika is_locked dan event_type = COMMENT_ADDED
   → pastikan author_role = current_handler_role (sudah tercakup INV-3)
5. Cek INV-2: jika DECISION_ESCALATE → new_handler != previous_handler
6. Bandingkan snapshot vs state aktual:
   jika berbeda → 409 dengan current state
7. INSERT case_events
8. Trigger: UPDATE cases (denormalized fields)
9. Jika STUDENT_UPDATE_ADDED → INSERT student_updates
10. COMMIT
```

**Error spesifik:**

| Code | HTTP | Situasi |
|---|---|---|
| `CASE_ALREADY_CLOSED` | 422 | INV-1 |
| `NOT_CURRENT_HANDLER` | 422 | INV-3 |
| `ESCALATION_SAME_HANDLER` | 422 | INV-2 |
| `ESCALATION_WRONG_STEP` | 422 | TN-05 |
| `CONFLICT_CASE_STATE` | 409 | Snapshot tidak cocok |
| `IDEMPOTENCY_DUPLICATE` | 200 | Event sudah ada |

---

### POST `sync-case-create`

Membuat kasus baru. `case_id` dibuat oleh client.

**Siapa yang boleh:** GURU, KEPSEK, DUDI.

**Request:**
```json
{
  "idempotency_key":    "uuid *   — sama dengan case_id",
  "case_id":            "uuid *   — client-generated, menjadi PK",
  "student_id":         "uuid *",
  "created_by_user_id": "uuid *",
  "initiated_by_role":  "ROLE_TYPE *",
  "track":              "SEKOLAH | PKL *",
  "title":              "string, min 5, max 200 *",
  "description":        "string, min 20, max 5000 *",
  "_schema_version":    "1.0.0"
}
```

**Response 200:**
```json
{
  "data": {
    "case_id":       "uuid",
    "was_duplicate": false
  }
}
```

**Server behavior:**
```sql
INSERT INTO cases (case_id, student_id, ..., current_handler_role = initiated_by_role)
ON CONFLICT (case_id) DO NOTHING;

-- Initial audit event
INSERT INTO case_events (case_id, event_type = 'STATUS_CHANGED',
  new_status = 'OPEN', author_role_at_time = initiated_by_role, ...);
```

---

### POST `send-parent-reply`

Mengirim balasan ke pesan orang tua. **Online only. Tidak idempotent.**

**Siapa yang boleh:** GURU, BK, WALI_KELAS, KAPRODI, KEPSEK.

**Request:**
```json
{
  "reply_to_message_id": "uuid *",
  "body":                "string, min 1, max 5000 *",
  "student_id":          "uuid *",
  "case_id":             "uuid   — opsional, jika terkait kasus"
}
```

**Response 200:**
```json
{
  "data": {
    "message_id":    "uuid",
    "case_event_id": "uuid | null"
  }
}
```

**Catatan:** Tidak ada retry otomatis. UI harus mencegah double-submit (disable tombol setelah klik pertama).

---

### POST `provision-user`

Membuat akun pengguna baru (auth + users dalam satu transaksi).

**Siapa yang boleh:** KEPSEK JWT atau service role.

**Request:**
```json
{
  "email":              "string *   — valid email",
  "full_name":          "string *   — min 2, max 150 chars",
  "role_type":          "ROLE_TYPE *",
  "program_id":         "uuid   — wajib untuk GURU, KAPRODI",
  "wali_kelas_class_id":"uuid   — wajib jika akan jadi Wali Kelas",
  "dudi_org_name":      "string — wajib untuk DUDI",
  "student_id":         "uuid   — opsional, link akun SISWA ke student yang ada",
  "parent_student_id":  "uuid   — opsional, link akun ORTU ke student"
}
```

**Response 200:**
```json
{
  "data": {
    "user_id":       "uuid",
    "auth_user_id":  "uuid",
    "was_duplicate": false
  }
}
```

**Idempotency:** Keyed on `email`. Jika email sudah ada → return existing user, `was_duplicate: true`.

---

### POST `evaluate-teacher-indicators`

Menyelesaikan semua `PENDING_EVALUATION` teacher indicators untuk satu tanggal.

**Siapa yang boleh:** KEPSEK JWT atau Supabase cron service role.

**Request:**
```json
{
  "session_date": "YYYY-MM-DD *"
}
```

**Response 200:**
```json
{
  "data": {
    "session_date": "2024-01-15",
    "resolved": [
      { "schedule_id": "uuid", "resolved_to": "HADIR" },
      { "schedule_id": "uuid", "resolved_to": "TIDAK_HADIR" }
    ],
    "total": 24
  }
}
```

**Cron setup (Supabase):**
```sql
-- Di Supabase Dashboard > Database > Extensions > pg_cron
SELECT cron.schedule(
  'evaluate-teacher-indicators-daily',
  '0 10 * * 1-6',   -- 17:00 WIB = 10:00 UTC, Senin–Sabtu
  $$
    SELECT net.http_post(
      url := 'https://<project>.supabase.co/functions/v1/evaluate-teacher-indicators',
      headers := '{"Authorization": "Bearer <service_role_key>"}',
      body := concat('{"session_date":"', CURRENT_DATE, '"}')::jsonb
    );
  $$
);
```

---

### GET `health`

Cek konektivitas. Tidak memerlukan auth.

**Response 200:**
```json
{ "status": "ok", "version": "1.0.0" }
```

Digunakan oleh Service Worker untuk mendeteksi apakah online sebelum memulai sync.

---

## Conflict Resolution UI Contract

Ketika `sync-case-event` mengembalikan `409 CONFLICT_CASE_STATE`, client harus:

1. **Tampilkan dialog** dengan informasi:
   - "Kasus telah diperbarui oleh pihak lain saat Anda offline"
   - State terkini: status, handler, waktu update terakhir
2. **Berikan dua pilihan:**
   - "Perbarui dan Coba Lagi" — refresh kasus dari server, lalu terapkan aksi lagi jika masih valid
   - "Batalkan" — buang item dari offline queue
3. **Jangan auto-retry** conflict — ini adalah keputusan user, bukan error transien

```javascript
// Contoh handling di aplikasi
const result = await api.syncCaseEvent(payload, userCtx, caseCtx);

if (result.conflict) {
  const currentState = result.currentState;
  showConflictDialog({
    message: 'Kasus ini telah diperbarui saat Anda offline.',
    currentStatus:  currentState.current_status,
    currentHandler: currentState.current_handler_role,
    lastUpdated:    currentState.last_event_at,
    onRetry:   () => refreshCaseAndRetry(payload.case_id),
    onDiscard: () => discardQueueItem(payload.idempotency_key),
  });
  return;
}
```

---

## Schema Version Mismatch

Jika server mendeteksi `x-schema-version` tidak cocok dengan versi yang diharapkan (major version berbeda):

**Response 400:**
```json
{
  "error": {
    "code":    "SCHEMA_VERSION_MISMATCH",
    "message": "Versi aplikasi Anda sudah usang. Silakan perbarui aplikasi.",
    "context": {
      "client_version": "1.0.0",
      "server_version": "2.0.0"
    }
  }
}
```

Client harus menampilkan prompt update dan menghentikan semua sync sampai user memperbarui PWA.
