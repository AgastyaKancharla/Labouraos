-- =============================================================================
-- Laboura: size and file-type limits on the four private Supabase Storage buckets
-- (defence in depth; DEPLOY.md Step 3, item 7, and F4 on the free tier).
--
-- The app already checks every upload (size, and the real type read from the
-- file's first bytes). These limits make Supabase refuse anything else too, so
-- a leaked or misused service key still cannot park a 1 GB file or an HTML page
-- in a bucket. They match what the app writes (src/common/storage/
-- bucket-limits.spec.ts fails the build if the code and this file drift apart):
--
--   candidate-photos  5 MB   JPEG, PNG, WebP   selfies (job seekers, partners,
--                                              staff), ID card / Aadhaar QR photos
--   business-photos   8 MB   JPEG, PNG, WebP   storefront and shop-visit photos
--   agreements        10 MB  HTML, PDF, JPEG,  signed agreement copies (HTML),
--                            PNG, WebP, HEIC   expense bills and receipts
--   recordings        50 MB  MP3 (audio/mpeg)  call recordings copied from the
--                                              calling vendor
--
-- How to run (no terminal): Supabase dashboard -> your project -> SQL Editor ->
-- New query -> paste this whole file -> Run. Safe to run again. It changes no
-- file and creates no bucket; it never makes a bucket public. The last query
-- shows the result: four rows, public = false, with the limits above.
-- On the free Supabase plan the largest file allowed anywhere is 50 MB, which
-- is why recordings stop at 50 MB.
-- =============================================================================

UPDATE storage.buckets
SET public = false,
    file_size_limit = 5242880, -- 5 MB
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'candidate-photos';

UPDATE storage.buckets
SET public = false,
    file_size_limit = 8388608, -- 8 MB
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'business-photos';

UPDATE storage.buckets
SET public = false,
    file_size_limit = 10485760, -- 10 MB
    allowed_mime_types = ARRAY['text/html', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
WHERE id = 'agreements';

UPDATE storage.buckets
SET public = false,
    file_size_limit = 52428800, -- 50 MB
    allowed_mime_types = ARRAY['audio/mpeg']
WHERE id = 'recordings';

SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('candidate-photos', 'business-photos', 'agreements', 'recordings')
ORDER BY id;
