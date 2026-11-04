-- CreateTable
CREATE TABLE "JobSeekerTrade" (
    "id" TEXT NOT NULL,
    "jobSeekerId" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "yearsExperience" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobSeekerTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSeekerLanguage" (
    "id" TEXT NOT NULL,
    "jobSeekerId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "speaks" BOOLEAN NOT NULL DEFAULT false,
    "reads" BOOLEAN NOT NULL DEFAULT false,
    "writes" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobSeekerLanguage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobSeekerTrade_jobSeekerId_trade_key" ON "JobSeekerTrade"("jobSeekerId", "trade");

-- CreateIndex
CREATE INDEX "JobSeekerTrade_jobSeekerId_idx" ON "JobSeekerTrade"("jobSeekerId");

-- CreateIndex
CREATE UNIQUE INDEX "JobSeekerLanguage_jobSeekerId_language_key" ON "JobSeekerLanguage"("jobSeekerId", "language");

-- CreateIndex
CREATE INDEX "JobSeekerLanguage_jobSeekerId_idx" ON "JobSeekerLanguage"("jobSeekerId");

-- AddForeignKey
ALTER TABLE "JobSeekerTrade" ADD CONSTRAINT "JobSeekerTrade_jobSeekerId_fkey" FOREIGN KEY ("jobSeekerId") REFERENCES "JobSeeker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSeekerLanguage" ADD CONSTRAINT "JobSeekerLanguage_jobSeekerId_fkey" FOREIGN KEY ("jobSeekerId") REFERENCES "JobSeeker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
