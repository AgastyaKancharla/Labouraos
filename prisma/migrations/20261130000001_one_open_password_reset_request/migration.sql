-- "Forgot password": one open request per account, kept by the database too
-- (two requests at the same moment cannot both stay open). Prisma's schema
-- cannot describe a partial index, so it lives only in this migration.

-- Should two open requests exist already, the older ones end.
UPDATE "PasswordResetRequest" AS r
SET "status" = 'cancelled'
WHERE r."status" IN ('pending', 'revealed')
  AND EXISTS (
    SELECT 1 FROM "PasswordResetRequest" AS n
    WHERE n."staffId" = r."staffId"
      AND n."status" IN ('pending', 'revealed')
      AND (n."createdAt", n."id") > (r."createdAt", r."id")
  );

CREATE UNIQUE INDEX "PasswordResetRequest_one_open_per_staff"
  ON "PasswordResetRequest" ("staffId")
  WHERE "status" IN ('pending', 'revealed');
