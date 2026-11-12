-- The CEO's monthly company plan and the Managers' split of it into teams
-- (MG-Targets "Split the CEO's plan into teams", MG-Plan, MG-Home). Counts only.

-- CreateTable
CREATE TABLE "CompanyPlan" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "registered" INTEGER,
    "paid" INTEGER,
    "businessesSignedUp" INTEGER,
    "vacancies" INTEGER,
    "interviewsDone" INTEGER,
    "placed" INTEGER,
    "leftWithin30" INTEGER,
    "repeatBusinesses" INTEGER,
    "setByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyPlan_year_month_key" ON "CompanyPlan"("year", "month");

ALTER TABLE "CompanyPlan" ADD CONSTRAINT "CompanyPlan_setByStaffId_fkey" FOREIGN KEY ("setByStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanyPlan" ENABLE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "TeamPlan" (
    "id" TEXT NOT NULL,
    "teamLeadId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "registered" INTEGER,
    "paid" INTEGER,
    "businessesSignedUp" INTEGER,
    "vacancies" INTEGER,
    "interviewsDone" INTEGER,
    "placed" INTEGER,
    "leftWithin30" INTEGER,
    "repeatBusinesses" INTEGER,
    "setByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamPlan_teamLeadId_year_month_key" ON "TeamPlan"("teamLeadId", "year", "month");
CREATE INDEX "TeamPlan_year_month_idx" ON "TeamPlan"("year", "month");

ALTER TABLE "TeamPlan" ADD CONSTRAINT "TeamPlan_teamLeadId_fkey" FOREIGN KEY ("teamLeadId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamPlan" ADD CONSTRAINT "TeamPlan_setByStaffId_fkey" FOREIGN KEY ("setByStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeamPlan" ENABLE ROW LEVEL SECURITY;
