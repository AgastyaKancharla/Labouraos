-- Owner decision 14 Nov: no office-network rule at all. Every login already needs a
-- one-time code from a senior or the authenticator code, and the rule could lock
-- everyone out. The Settings switch added on 12 Nov goes; login-code requests no
-- longer record "office network yes/no" (old rows keep their value).
ALTER TABLE "PricingPolicy" DROP COLUMN "officeNetworkRequired";
ALTER TABLE "LoginCodeRequest" ALTER COLUMN "onOfficeNetwork" SET DEFAULT false;
