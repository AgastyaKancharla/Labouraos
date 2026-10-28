-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "payoutAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PayoutWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "paymentId" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayoutWebhookEvent_eventId_key" ON "PayoutWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "PayoutWebhookEvent_paymentId_idx" ON "PayoutWebhookEvent"("paymentId");

