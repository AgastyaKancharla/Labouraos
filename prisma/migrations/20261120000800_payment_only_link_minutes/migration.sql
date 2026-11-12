-- Settings: how long the payment-only link (someone else pays the ₹499) works. Guide: 15 minutes.
ALTER TABLE "PricingPolicy" ADD COLUMN "paymentOnlyLinkMinutes" INTEGER NOT NULL DEFAULT 15;
