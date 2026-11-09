ALTER TABLE "PricingPolicy"
  ADD COLUMN "legalMinimumWageUnskilledPaise" INTEGER NOT NULL DEFAULT 2337600,
  ADD COLUMN "legalMinimumWageSemiSkilledPaise" INTEGER NOT NULL DEFAULT 2571400,
  ADD COLUMN "legalMinimumWageSkilledPaise" INTEGER NOT NULL DEFAULT 2828600,
  ADD COLUMN "legalMinimumWageHighlySkilledPaise" INTEGER NOT NULL DEFAULT 3111400,
  ADD COLUMN "legalMinimumWageEffectiveFrom" DATE NOT NULL DEFAULT DATE '2026-05-22';

CREATE TABLE "Trade" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "salaryMinPaise" INTEGER NOT NULL,
  "salaryMaxPaise" INTEGER NOT NULL,
  "minimumWageLevel" TEXT NOT NULL DEFAULT 'unskilled',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Trade_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Trade_nameKey_normalized_check" CHECK ("nameKey" = lower(btrim("nameKey"))),
  CONSTRAINT "Trade_salaryRange_check" CHECK ("salaryMinPaise" > 0 AND "salaryMaxPaise" >= "salaryMinPaise"),
  CONSTRAINT "Trade_minimumWageLevel_check" CHECK ("minimumWageLevel" IN ('unskilled', 'semi_skilled', 'skilled', 'highly_skilled'))
);
CREATE UNIQUE INDEX "Trade_nameKey_key" ON "Trade"("nameKey");
CREATE INDEX "Trade_active_sortOrder_idx" ON "Trade"("active", "sortOrder");

CREATE TABLE "TradeSuggestion" (
  "id" TEXT NOT NULL,
  "typedName" TEXT NOT NULL,
  "typedNameKey" TEXT NOT NULL,
  "typedByStaffId" TEXT,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'waiting',
  "mappedToTradeId" TEXT,
  "decidedByStaffId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeSuggestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TradeSuggestion_typedNameKey_normalized_check" CHECK ("typedNameKey" = lower(btrim("typedNameKey"))),
  CONSTRAINT "TradeSuggestion_status_check" CHECK ("status" IN ('waiting', 'added', 'mapped', 'dismissed')),
  CONSTRAINT "TradeSuggestion_mappedToTradeId_fkey" FOREIGN KEY ("mappedToTradeId") REFERENCES "Trade"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TradeSuggestion_typedNameKey_key" ON "TradeSuggestion"("typedNameKey");
CREATE INDEX "TradeSuggestion_status_createdAt_idx" ON "TradeSuggestion"("status", "createdAt");

CREATE TABLE "TradeSuggestionSubject" (
  "id" TEXT NOT NULL,
  "tradeSuggestionId" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeSuggestionSubject_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TradeSuggestionSubject_tradeSuggestionId_fkey" FOREIGN KEY ("tradeSuggestionId") REFERENCES "TradeSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TradeSuggestionSubject_tradeSuggestionId_subjectType_subjectId_key"
  ON "TradeSuggestionSubject"("tradeSuggestionId", "subjectType", "subjectId");
CREATE INDEX "TradeSuggestionSubject_subjectType_subjectId_idx"
  ON "TradeSuggestionSubject"("subjectType", "subjectId");

INSERT INTO "Trade" ("id", "name", "nameKey", "salaryMinPaise", "salaryMaxPaise", "sortOrder", "updatedAt") VALUES
  ('phase20-trade-01', 'Housekeeping', 'housekeeping', 1600000, 2300000, 1, CURRENT_TIMESTAMP),
  ('phase20-trade-02', 'Cook', 'cook', 1800000, 3000000, 2, CURRENT_TIMESTAMP),
  ('phase20-trade-03', 'Kitchen helper', 'kitchen helper', 1500000, 2000000, 3, CURRENT_TIMESTAMP),
  ('phase20-trade-04', 'Waiter', 'waiter', 1500000, 2200000, 4, CURRENT_TIMESTAMP),
  ('phase20-trade-05', 'Driver', 'driver', 2000000, 3000000, 5, CURRENT_TIMESTAMP),
  ('phase20-trade-06', 'Delivery rider', 'delivery rider', 2200000, 3500000, 6, CURRENT_TIMESTAMP),
  ('phase20-trade-07', 'Security guard', 'security guard', 1700000, 2400000, 7, CURRENT_TIMESTAMP),
  ('phase20-trade-08', 'Electrician', 'electrician', 2100000, 3200000, 8, CURRENT_TIMESTAMP),
  ('phase20-trade-09', 'Plumber', 'plumber', 2000000, 3000000, 9, CURRENT_TIMESTAMP),
  ('phase20-trade-10', 'Carpenter', 'carpenter', 2000000, 3200000, 10, CURRENT_TIMESTAMP),
  ('phase20-trade-11', 'Painter', 'painter', 1800000, 2800000, 11, CURRENT_TIMESTAMP),
  ('phase20-trade-12', 'AC technician', 'ac technician', 2000000, 3000000, 12, CURRENT_TIMESTAMP),
  ('phase20-trade-13', 'Helper / loader', 'helper / loader', 1500000, 2200000, 13, CURRENT_TIMESTAMP),
  ('phase20-trade-14', 'Warehouse packer', 'warehouse packer', 1900000, 2700000, 14, CURRENT_TIMESTAMP),
  ('phase20-trade-15', 'Retail staff', 'retail staff', 1500000, 2200000, 15, CURRENT_TIMESTAMP),
  ('phase20-trade-16', 'Caretaker / nanny', 'caretaker / nanny', 1500000, 2300000, 16, CURRENT_TIMESTAMP);
