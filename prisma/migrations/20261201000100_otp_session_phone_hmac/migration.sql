-- INF-13: OtpSession.phoneHash becomes a keyed HMAC (src/common/otp/otp-phone-hash.ts).
-- Old rows hold a plain SHA-256 of the phone, which can be reversed by hashing every
-- mobile number. They are test data only and an OTP session lives 5 minutes, so the
-- old hashes are cleared (the row stays: getPhoneLast4 reads the encrypted phone).
-- A session cleared here can no longer be verified; the person asks for a new code.
ALTER TABLE "OtpSession" ALTER COLUMN "phoneHash" DROP NOT NULL;
UPDATE "OtpSession" SET "phoneHash" = NULL;
