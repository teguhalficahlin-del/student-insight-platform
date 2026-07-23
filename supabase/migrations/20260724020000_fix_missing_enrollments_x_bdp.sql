-- fix: 3 siswa (Naumi Fitria, Mhd.Fadil Akbar, Jilvia Putri Muharasih)
-- tidak memiliki record di class_enrollments → orang tua jatuh ke "Tanpa Kelas"
-- Root cause: enrollment hilang saat proses upload ulang data orang tua
-- Analisis dampak: aman — semester=1 konsisten dengan 32 siswa X BDP lain,
-- school_id/class_id/academic_year sudah diverifikasi match
INSERT INTO class_enrollments (student_id, class_id, school_id, academic_year, semester)
VALUES
    ('31b2ce8d-38e9-422a-b526-e595855e3006', 'efe243d6-0300-4522-b6bb-65b8d00c2a98', '244e389c-de7d-4d70-ac95-346d33a5d02c', '2026/2027', 1),
    ('f9193f38-b870-4ce9-a806-b1bdf333cd27', 'efe243d6-0300-4522-b6bb-65b8d00c2a98', '244e389c-de7d-4d70-ac95-346d33a5d02c', '2026/2027', 1),
    ('9d7348bc-ecdc-49e3-a035-5f08908f233c', 'efe243d6-0300-4522-b6bb-65b8d00c2a98', '244e389c-de7d-4d70-ac95-346d33a5d02c', '2026/2027', 1)
ON CONFLICT DO NOTHING;
