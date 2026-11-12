-- A job seeker whose ₹499 was refunded stayed "active" and kept being offered to
-- businesses (guide check 12 Nov, finding 5). Refund approval now moves an active or
-- paused profile to "refunded". This moves the profiles refunded before that change:
-- active or paused, with a live refund (not rejected or cancelled) of his current
-- guarantee. A refund belongs to it when it names his latest paid ₹499
-- ("refundsPaymentId"); only a refund without that link falls back to the dates
-- (made on or after the ₹499 he paid last). Someone who paid again after his refund
-- is left alone. Idempotent. No status-history row is written for these (the refund
-- payment itself is the record).
UPDATE "JobSeeker" AS js
SET "status" = 'refunded'
WHERE js."status" IN ('active', 'paused')
  AND EXISTS (
    SELECT 1 FROM "Payment" AS p
    WHERE p."jobSeekerId" = js."id"
      AND p."type" = 'refund'
      AND p."status" NOT IN ('rejected', 'cancelled')
      AND (
        (p."refundsPaymentId" IS NOT NULL AND p."refundsPaymentId" = (
          SELECT a."id" FROM "Payment" AS a
          WHERE a."jobSeekerId" = js."id"
            AND a."type" IN ('activation', 'reactivation')
            AND a."status" IN ('completed', 'succeeded')
          ORDER BY a."createdAt" DESC, a."id" DESC
          LIMIT 1
        ))
        OR (p."refundsPaymentId" IS NULL AND (js."paymentReceivedAt" IS NULL OR p."createdAt" >= js."paymentReceivedAt"))
      )
  );
