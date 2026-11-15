-- Staff accounts, first login and password reset (Master Guide rev 174–175,
-- 15 Nov): temporary passwords replace invite links; "Forgot password" asks a
-- senior for a reset code; Team Leads sign in with their own authenticator.

-- Temporary password (bcrypt hash only), the first-login set-up ticket and
-- the notice shown at the next sign-in after a reset.
ALTER TABLE "Staff" ADD COLUMN "tempPasswordHash" TEXT;
ALTER TABLE "Staff" ADD COLUMN "tempPasswordExpiresAt" TIMESTAMP(3);
ALTER TABLE "Staff" ADD COLUMN "tempPasswordIssuedByStaffId" TEXT;
ALTER TABLE "Staff" ADD COLUMN "setupTicketHash" TEXT;
ALTER TABLE "Staff" ADD COLUMN "setupTicketDeviceId" TEXT;
ALTER TABLE "Staff" ADD COLUMN "setupTicketExpiresAt" TIMESTAMP(3);
ALTER TABLE "Staff" ADD COLUMN "passwordResetNotice" JSONB;
ALTER TABLE "Staff"
  ADD CONSTRAINT "Staff_tempPasswordIssuedByStaffId_fkey"
  FOREIGN KEY ("tempPasswordIssuedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Staff_tempPasswordIssuedByStaffId_idx" ON "Staff"("tempPasswordIssuedByStaffId");
CREATE UNIQUE INDEX "Staff_setupTicketHash_key" ON "Staff"("setupTicketHash");

-- Temporary passwords a senior gives an existing account are kept in the
-- password reset history: what kind, and the issuer may be nobody (the
-- break-glass server command). Older rows are reset links.
ALTER TABLE "StaffPasswordReset" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'link';
ALTER TABLE "StaffPasswordReset" ALTER COLUMN "tokenHash" DROP NOT NULL;
ALTER TABLE "StaffPasswordReset" ALTER COLUMN "issuedByStaffId" DROP NOT NULL;

-- "Forgot password" requests approved by a senior with a reset code.
CREATE TABLE "PasswordResetRequest" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "knownDevice" BOOLEAN NOT NULL DEFAULT false,
    "app" TEXT,
    "ipAddress" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revealedByStaffId" TEXT,
    "revealedAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "refusedByStaffId" TEXT,
    "refusedAt" TIMESTAMP(3),
    "refusedReason" TEXT,

    CONSTRAINT "PasswordResetRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PasswordResetRequest_staffId_status_idx" ON "PasswordResetRequest"("staffId", "status");
CREATE INDEX "PasswordResetRequest_createdAt_idx" ON "PasswordResetRequest"("createdAt");
CREATE INDEX "PasswordResetRequest_revealedByStaffId_idx" ON "PasswordResetRequest"("revealedByStaffId");
CREATE INDEX "PasswordResetRequest_refusedByStaffId_idx" ON "PasswordResetRequest"("refusedByStaffId");
ALTER TABLE "PasswordResetRequest" ADD CONSTRAINT "PasswordResetRequest_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetRequest" ADD CONSTRAINT "PasswordResetRequest_revealedByStaffId_fkey" FOREIGN KEY ("revealedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PasswordResetRequest" ADD CONSTRAINT "PasswordResetRequest_refusedByStaffId_fkey" FOREIGN KEY ("refusedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PasswordResetRequest" ENABLE ROW LEVEL SECURITY;

-- Invite links are gone. Unused invites stop working now: the person is
-- "Not signed in yet" and a senior gives them a temporary password
-- ("New temporary password" on the staff list). Nothing else changes.
UPDATE "Staff"
SET "inviteTokenHash" = NULL, "inviteExpiresAt" = NULL
WHERE "inviteTokenHash" IS NOT NULL;

-- Unused reset links stop working too (the old password still works).
UPDATE "StaffPasswordReset"
SET "cancelledAt" = NOW()
WHERE "usedAt" IS NULL AND "cancelledAt" IS NULL;

-- Team Leads now sign in with their own authenticator, not a login code:
-- their open login code requests end now.
UPDATE "LoginCodeRequest"
SET "status" = 'expired'
WHERE "status" IN ('pending', 'revealed')
  AND "staffId" IN (SELECT "id" FROM "Staff" WHERE "role" = 'team_lead');
