CREATE TABLE "CandidateIntroduction" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "jobSeekerId" TEXT NOT NULL,
    "shownByStaffId" TEXT NOT NULL,
    "shownAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "matchReasons" JSONB NOT NULL,
    "channel" TEXT NOT NULL,
    "messageLogId" TEXT,

    CONSTRAINT "CandidateIntroduction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CandidateIntroduction_businessId_jobSeekerId_shownAt_idx"
ON "CandidateIntroduction"("businessId", "jobSeekerId", "shownAt");

CREATE INDEX "CandidateIntroduction_vacancyId_shownAt_idx"
ON "CandidateIntroduction"("vacancyId", "shownAt");

CREATE INDEX "CandidateIntroduction_messageLogId_idx"
ON "CandidateIntroduction"("messageLogId");

ALTER TABLE "CandidateIntroduction"
ADD CONSTRAINT "CandidateIntroduction_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CandidateIntroduction"
ADD CONSTRAINT "CandidateIntroduction_vacancyId_fkey"
FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CandidateIntroduction"
ADD CONSTRAINT "CandidateIntroduction_jobSeekerId_fkey"
FOREIGN KEY ("jobSeekerId") REFERENCES "JobSeeker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CandidateIntroduction"
ADD CONSTRAINT "CandidateIntroduction_shownByStaffId_fkey"
FOREIGN KEY ("shownByStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CandidateIntroduction"
ADD CONSTRAINT "CandidateIntroduction_messageLogId_fkey"
FOREIGN KEY ("messageLogId") REFERENCES "MessageLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CandidateIntroductionLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "jobSeekerIds" TEXT[] NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateIntroductionLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CandidateIntroductionLink_tokenHash_key"
ON "CandidateIntroductionLink"("tokenHash");

CREATE INDEX "CandidateIntroductionLink_businessId_vacancyId_idx"
ON "CandidateIntroductionLink"("businessId", "vacancyId");

ALTER TABLE "CandidateIntroductionLink"
ADD CONSTRAINT "CandidateIntroductionLink_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CandidateIntroductionLink"
ADD CONSTRAINT "CandidateIntroductionLink_vacancyId_fkey"
FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
