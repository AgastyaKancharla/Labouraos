-- The go-live date in force when a salary sheet was prepared, kept on the sheet
-- like the weekly offs and full-day minutes, so the correction recompute of a
-- frozen month uses exactly it: a later go-live change never rewrites a paid month.
-- Null on sheets prepared before this change (no go-live date existed then).
ALTER TABLE "PayrollRun" ADD COLUMN "goLiveDay" TEXT;
