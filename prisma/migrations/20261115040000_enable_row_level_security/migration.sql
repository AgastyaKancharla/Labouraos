-- Turn on row level security for every table in the public schema, with no
-- policies. Supabase publishes the public schema through its automatic REST
-- API (PostgREST); with RLS on and no policy, that API returns nothing to the
-- anon and authenticated keys. The app is not affected: Prisma connects as the
-- table owner, and an owner bypasses RLS unless FORCE is set (it is not).
--
-- This also covers _prisma_migrations, which Prisma creates in public.
-- Tables created by later migrations need their own
--   ALTER TABLE "NewTable" ENABLE ROW LEVEL SECURITY;
-- src/common/prisma/row-level-security.spec.ts fails CI when one is missing.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END
$$;
