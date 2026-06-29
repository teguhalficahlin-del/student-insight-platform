# Event Schema Reference
**Version:** 1.0.0
**Status:** Frozen — change requires SCHEMA_VERSION bump

---

## Cara Membaca Dokumen Ini

Setiap schema entry menampilkan:
- **Siapa yang bisa mengirim** — role yang diizinkan
- **Kondisi blok** — kondisi yang memblok event ini
- **Envelope fields** — field di luar `payload`
- **Payload fields** — field di dalam objek `payload`
- **Privacy default** — nilai default jika tidak di-override

Tanda `*` = required. Tanpa tanda = optional.

---

## Struktur Envelope Case Event (Base)

Setiap case event yang dikirim ke server memiliki envelope berikut:

```json
{
  "case_id":              "uuid *",
  "event_type":           "CASE_EVENT_TYPE *",
  "author_user_id":       "uuid *",
  "author_role_at_time":  "ROLE_TYPE *",
  "privacy_level":        "VISIBILITY_LEVEL *",
  "payload":              "object *",

  // Populated per event type (lihat masing-masing schema):
  "previous_handler_role": "ROLE_TYPE",
  "new_handler_role":      "ROLE_TYPE",
  "previous_status":       "CASE_STATUS",
  "new_status":            "CASE_STATUS",
  "parent_message_id":     "uuid"
}
```

---

## Case Event Schemas

---

### COMMENT_ADDED

| Field | Type | Rule |
|---|---|---|
| **Siapa** | GURU, BK, WALI_KELAS, KAPRODI, KEPSEK, DUDI | Harus `current_handler_role` |
| **Blok jika** | `case.is_locked = true` AND bukan `current_handler_role` | INV-4 |
| **Privacy default** | `INTERNAL_SCHOOL` | |

**Payload:**
```json
{
  "text": "string, min 10, max 2000 *"
}
```

**Contoh:**
```json
{
  "case_id": "...",
  "event_type": "COMMENT_ADDED",
  "author_user_id": "...",
  "author_role_at_time": "BK",
  "privacy_level": "INTERNAL_SCHOOL",
  "payload": {
    "text": "Siswa telah hadir untuk sesi konseling pertama. Tampak kooperatif."
  }
}
```

---

### STATUS_CHANGED

Transisi status intermediate. Tidak mengubah handler.

| Field | Type | Rule |
|---|---|---|
| **Siapa** | current_handler_role | |
| **Envelope extra** | `new_status *`, `previous_status *` | |
| **Privacy default** | `INTERNAL_SCHOOL` | |

**Payload:**
```json
{
  "reason": "string, min 5, max 500 *"
}
```

**Valid status transitions:**

| Dari | Ke (via STATUS_CHANGED) |
|---|---|
| `OPEN` | `UNDER_REVIEW` |
| `UNDER_REVIEW` | `INTERVENTION` |
| `INTERVENTION` | `MONITORING` |

> Transisi ke `CLOSED` hanya melalui `DECISION_CLOSE` atau `FINAL_DECISION_MADE`.

---

### DECISION_ESCALATE

Memindahkan kasus ke handler berikutnya dalam rantai eskalasi.

| Field | Type | Rule |
|---|---|---|
| **Siapa** | GURU, BK, WALI_KELAS, KAPRODI, DUDI | Harus current_handler_role |
| **Blok jika** | Bukan current_handler_role | |
| **INV-2** | `new_handler_role ≠ previous_handler_role` | |
| **TN-05** | `new_handler_role` harus step berikutnya dalam chain | |
| **Privacy default** | `INTERNAL_SCHOOL` | |

**Rantai eskalasi yang valid:**

```
Track SEKOLAH: GURU → BK → WALI_KELAS → KAPRODI → KEPSEK
Track PKL:     DUDI → KAPRODI → KEPSEK
```

**Envelope extra:**
```json
{
  "previous_handler_role": "ROLE_TYPE *",
  "new_handler_role":      "ROLE_TYPE *",
  "previous_status":       "CASE_STATUS *",
  "new_status":            "CASE_STATUS *"
}
```

**Payload:**
```json
{
  "reason": "string, min 10, max 1000 *"
}
```

**Contoh:**
```json
{
  "event_type": "DECISION_ESCALATE",
  "previous_handler_role": "GURU",
  "new_handler_role": "BK",
  "previous_status": "OPEN",
  "new_status": "UNDER_REVIEW",
  "payload": {
    "reason": "Perilaku membutuhkan penanganan oleh Guru BK. Sudah dilakukan pendekatan awal namun tidak ada perubahan signifikan."
  }
}
```

---

### DECISION_CLOSE

Menutup kasus oleh current_handler_role.

| Field | Type | Rule |
|---|---|---|
| **Siapa** | Semua role yang bisa jadi current_handler | |
| **Envelope extra** | `previous_status *` | |
| **Privacy default** | `INTERNAL_SCHOOL` | |
| **Setelah event ini** | `case.status → CLOSED` (via trigger) | INV-1 berlaku |

**Payload:**
```json
{
  "summary": "string, min 20, max 2000 *",
  "outcome": "string, min 5, max 500 *"
}
```

---

### FINAL_DECISION_MADE

Keputusan Kepsek yang langsung menutup kasus. Melewati handler check.

| Field | Type | Rule |
|---|---|---|
| **Siapa** | KEPSEK only | |
| **Blok jika** | `case.status = CLOSED` | INV-1 |
| **Tidak diblok oleh** | `case.is_locked`, `current_handler_role` | |
| **Envelope extra** | `previous_status *` | |
| **Privacy default** | `INTERNAL_SCHOOL` | |
| **Setelah event ini** | `case.status → CLOSED` | |

**Payload:**
```json
{
  "decision": "string, min 20, max 2000 *",
  "notes":    "string, min 10, max 2000 *"
}
```

---

### STUDENT_UPDATE_ADDED

Pesan yang bisa dilihat siswa tentang perkembangan kasusnya.

| Field | Type | Rule |
|---|---|---|
| **Siapa** | current_handler_role | |
| **Privacy** | `STUDENT_VISIBLE` — **fixed, tidak bisa diubah** | |
| **Side effect** | Juga membuat row di tabel `student_updates` (same transaction) | |

**Payload:**
```json
{
  "text": "string, min 10, max 1000 *"
}
```

> Jika tidak ada `student_update` untuk suatu kasus, client menampilkan fallback text generik berdasarkan `case.status`.

---

### PARENT_MESSAGE_RECEIVED

Event sistem — **bukan dikirim oleh client**. Dibuat oleh Edge Function saat ORTU mengirim pesan yang terhubung ke kasus ini.

| Field | Type | Rule |
|---|---|---|
| **Siapa** | System (Edge Function / service role) | |
| **Blok jika** | `case.is_locked = true` | INV-4 |
| **Envelope extra** | `parent_message_id *` | |
| **Privacy default** | `INTERNAL_SCHOOL` | |

**Payload:**
```json
{
  "parent_user_id":  "uuid *",
  "student_id":      "uuid *",
  "message_preview": "string, max 200 *"
}
```

---

### PARENT_MESSAGE_LINKED

Menghubungkan pesan orang tua yang sudah ada ke kasus ini.

| Field | Type | Rule |
|---|---|---|
| **Siapa** | GURU, BK, WALI_KELAS, KAPRODI, KEPSEK | |
| **Envelope extra** | `parent_message_id *` | |
| **Privacy default** | `INTERNAL_SCHOOL` | |

**Payload:**
```json
{
  "linked_by_note": "string, max 500"
}
```

---

### PARENT_REPLY_SENT

Dicatat saat staff mengirim balasan ke ORTU.

| Field | Type | Rule |
|---|---|---|
| **Siapa** | GURU, BK, WALI_KELAS, KAPRODI, KEPSEK | |
| **Envelope extra** | `parent_message_id *` | |
| **Privacy default** | `INTERNAL_SCHOOL` | |
| **Side effect** | Membuat OUTBOUND `parent_message` row (same transaction) | |

**Payload:**
```json
{
  "reply_preview": "string, max 200 *"
}
```

---

### CASE_LOCKED

Mengunci kasus. Setelah ini, `COMMENT_ADDED` hanya bisa dari `current_handler_role`.

| Field | Type | Rule |
|---|---|---|
| **Siapa** | current_handler_role | |
| **Privacy default** | `INTERNAL_SCHOOL` | |
| **Setelah event ini** | `case.is_locked → true` | TN-04 |

**Payload:**
```json
{
  "reason": "string, min 5, max 500 *"
}
```

---

### CASE_UNLOCKED

Membuka kunci kasus.

| Field | Type | Rule |
|---|---|---|
| **Siapa** | current_handler_role | |
| **Privacy default** | `INTERNAL_SCHOOL` | |
| **Setelah event ini** | `case.is_locked → false` | TN-04 |

**Payload:**
```json
{
  "reason": "string, min 5, max 500 *"
}
```

---

## Offline Queue Schemas

Semua item offline queue memiliki base envelope berikut:

```json
{
  "idempotency_key":    "uuid *  — dibuat client saat item dibuat",
  "queue_type":         "OFFLINE_QUEUE_TYPE *",
  "created_offline_at": "ISO timestamp *",
  "schema_version":     "string *  — nilai SCHEMA_VERSION saat item dibuat",
  "retry_count":        "integer >= 0 *  — mulai dari 0",
  "max_retries":        "integer > 0 *  — default 5",
  "_meta": {
    "serverEndpoint":   "string — endpoint tujuan",
    "conflictPolicy":   "REJECT | REJECT_WITH_DIFF | IDEMPOTENT_INSERT",
    "idempotencyScope": "field yang digunakan untuk dedup di server"
  }
}
```

---

### ATTENDANCE_BATCH

Satu item = satu sesi penuh (bukan per-siswa).

**Server endpoint:** `POST /functions/v1/sync-attendance-batch`
**Idempotency scope:** `schedule_id` — satu sukses per schedule.
**Server behavior:** `UPSERT` (ON CONFLICT DO UPDATE).

```json
{
  "schedule_id":   "uuid *",
  "submitted_by":  "uuid *",
  "session_date":  "YYYY-MM-DD *",
  "records": [
    {
      "student_id": "uuid *",
      "status":     "ATTENDANCE_STATUS *",
      "source":     "ATTENDANCE_SOURCE *"
    }
  ],
  "substitute_token": "string — diisi jika guru pengganti",
  "meeting_status":   "NORMAL | KEGIATAN_SEKOLAH | GURU_TIDAK_HADIR"
}
```

---

### OBSERVATION_CREATE

**Server endpoint:** `POST /functions/v1/sync-observation`
**Idempotency scope:** `idempotency_key`

```json
{
  "student_id":     "uuid *",
  "author_user_id": "uuid *",
  "sentiment":      "POSITIF | NEGATIF *",
  "dimension":      "OBSERVATION_DIMENSION *",
  "content":        "string, min 10, max 1000 *",
  "visibility":     "VISIBILITY_LEVEL *",
  "observed_at":    "YYYY-MM-DD *",
  "schedule_id":    "uuid",
  "class_id":       "uuid"
}
```

---

### JOURNAL_CREATE

**Server endpoint:** `POST /functions/v1/sync-journal`
**Idempotency scope:** `idempotency_key`

```json
{
  "owner_user_id": "uuid *",
  "content":       "string, min 1, max 10000 *",
  "entry_date":    "YYYY-MM-DD *",
  "schedule_id":   "uuid",
  "class_id":      "uuid"
}
```

---

### CASE_EVENT_CREATE

Untuk case event yang dibuat saat offline.

**Server endpoint:** `POST /functions/v1/sync-case-event`
**Conflict policy:** `REJECT_WITH_DIFF` — server mengembalikan state kasus saat ini jika ada konflik.

```json
{
  "case_id":                    "uuid *",
  "event_type":                 "CASE_EVENT_TYPE *",
  "author_user_id":             "uuid *",
  "author_role":                "ROLE_TYPE *",
  "privacy_level":              "VISIBILITY_LEVEL *",
  "payload":                    "object *",
  "case_status_snapshot":       "CASE_STATUS *  — state kasus saat offline action",
  "current_handler_snapshot":   "ROLE_TYPE *",
  "is_locked_snapshot":         "boolean *",
  "previous_handler_role":      "ROLE_TYPE",
  "new_handler_role":           "ROLE_TYPE",
  "previous_status":            "CASE_STATUS",
  "new_status":                 "CASE_STATUS",
  "parent_message_id":          "uuid"
}
```

**Server conflict response (REJECT_WITH_DIFF):**
```json
{
  "error": {
    "code": "CONFLICT_CASE_STATE",
    "message": "Case state has changed since offline snapshot",
    "context": {
      "current_status":       "CASE_STATUS",
      "current_handler_role": "ROLE_TYPE",
      "is_locked":            "boolean",
      "last_event_at":        "ISO timestamp"
    }
  }
}
```

---

### CASE_CREATE

**Server endpoint:** `POST /functions/v1/sync-case-create`
**Conflict policy:** `IDEMPOTENT_INSERT` — `INSERT ... ON CONFLICT (case_id) DO NOTHING`.

```json
{
  "case_id":            "uuid *  — client-generated, menjadi PK",
  "student_id":         "uuid *",
  "created_by_user_id": "uuid *",
  "initiated_by_role":  "ROLE_TYPE *",
  "track":              "SEKOLAH | PKL *",
  "title":              "string, min 5, max 200 *",
  "description":        "string, min 20, max 5000 *"
}
```

---

## Standard Error Envelope

Semua error dari Edge Functions dan dari `buildErrorEnvelope()`:

```json
{
  "error": {
    "code":           "ERROR_CODE",
    "message":        "Human-readable summary",
    "details":        ["field-level error 1", "field-level error 2"],
    "context":        null,
    "schema_version": "1.0.0",
    "timestamp":      "ISO timestamp"
  }
}
```

### Daftar Error Codes

| Code | Trigger |
|---|---|
| `VALIDATION_FAILED` | Field validation gagal |
| `MISSING_REQUIRED_FIELD` | Required field tidak ada |
| `INVALID_ENUM_VALUE` | Nilai di luar enum yang valid |
| `CASE_ALREADY_CLOSED` | INV-1: event pada kasus CLOSED |
| `ESCALATION_SAME_HANDLER` | INV-2: handler tidak berubah |
| `ESCALATION_WRONG_STEP` | TN-05: bukan step berikutnya dalam chain |
| `CASE_LOCKED` | INV-4: aksi diblok oleh lock |
| `NOT_CURRENT_HANDLER` | Bukan current_handler_role |
| `ROLE_NOT_PERMITTED` | Role tidak diizinkan untuk aksi ini |
| `IDEMPOTENCY_DUPLICATE` | Replay duplikat terdeteksi |
| `CONFLICT_CASE_STATE` | State kasus berubah saat offline |
| `SCHEMA_VERSION_MISMATCH` | Client schema tidak cocok dengan server |
| `SYNC_TOKEN_EXPIRED` | Token guru pengganti sudah kedaluwarsa |
| `UNAUTHORIZED` | Tidak terautentikasi |
| `FORBIDDEN` | Terautentikasi tapi tidak punya akses |

---

## Versioning Rules

| Perubahan | Aksi |
|---|---|
| Tambah optional field | Bump MINOR (`1.0.0 → 1.1.0`) |
| Rename/hapus field, ubah validasi | Bump MAJOR (`1.0.0 → 2.0.0`) |
| Tambah event type baru | Bump MINOR |
| Hapus event type | Bump MAJOR |

Server menolak item offline dengan MAJOR version berbeda (`SCHEMA_VERSION_MISMATCH`).
Client harus memaksa re-sync dan update app jika menerima error ini.
