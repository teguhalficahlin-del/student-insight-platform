-- Set slug untuk SMK Karya Bangsa (sekolah ke-2 di seed data)
-- Diperlukan agar link portal guru muncul di admin dashboard

UPDATE schools
SET slug = 'smkkb'
WHERE name ILIKE '%Karya Bangsa%' AND slug IS NULL;
