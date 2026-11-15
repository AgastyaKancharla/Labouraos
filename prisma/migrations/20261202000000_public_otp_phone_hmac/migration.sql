-- L6: PublicOtpSend.phoneHash becomes a keyed HMAC (src/common/public-otp-limiter.service.ts).
-- The old rows hold an unkeyed SHA-256 of the phone. They only count within 24 hours
-- (resend wait and daily cap per link), so clearing them only lets a person ask once more.
DELETE FROM "PublicOtpSend";
