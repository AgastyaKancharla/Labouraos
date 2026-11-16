-- Laboura Field redesign (Master Guide rev 188): "Change result" on a visit needs a reason
-- and is kept in history (who, when, from, to, why). An onboarded visit is never changed.
CREATE TABLE "BusinessVisitResultChange" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "changedByStaffId" TEXT NOT NULL,
    "fromOutcome" TEXT,
    "fromOutcomeReason" TEXT,
    "fromRevisitOn" DATE,
    "toOutcome" TEXT NOT NULL,
    "toOutcomeReason" TEXT,
    "toRevisitOn" DATE,
    "reason" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessVisitResultChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BusinessVisitResultChange_visitId_changedAt_idx" ON "BusinessVisitResultChange"("visitId", "changedAt");

ALTER TABLE "BusinessVisitResultChange" ADD CONSTRAINT "BusinessVisitResultChange_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "BusinessVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
