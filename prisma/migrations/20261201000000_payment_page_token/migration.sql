-- Security INF-1: the pay page is opened by its own 256-bit token, kept only as a hash.
-- The short upiReference stays the UPI tr= / bank matching reference. Rows made before
-- this have no hash until their link is sent again (resend) or opened from the person's
-- own registration or result page; until then a still-pending row's old /p/pay/<upiReference>
-- link keeps working (pay-page-token.ts).
ALTER TABLE "Payment" ADD COLUMN "pageTokenHash" TEXT;
CREATE UNIQUE INDEX "Payment_pageTokenHash_key" ON "Payment"("pageTokenHash");
