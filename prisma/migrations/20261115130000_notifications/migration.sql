-- Phase 21 Task 6: notification bells.

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientStaffId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "openKey" TEXT,
    "seenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),
    "clearedByStaffId" TEXT,
    "clearedReason" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_openKey_key" ON "Notification"("openKey");
CREATE INDEX "Notification_recipientStaffId_clearedAt_idx" ON "Notification"("recipientStaffId", "clearedAt");
CREATE INDEX "Notification_kind_clearedAt_idx" ON "Notification"("kind", "clearedAt");
CREATE INDEX "Notification_subjectType_subjectId_idx" ON "Notification"("subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientStaffId_fkey" FOREIGN KEY ("recipientStaffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_clearedByStaffId_fkey" FOREIGN KEY ("clearedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row level security (the API connects as the table owner; no anon access).
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
