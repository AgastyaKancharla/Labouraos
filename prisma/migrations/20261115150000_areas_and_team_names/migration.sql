-- Areas list managed by the CEO and Managers (guide, Forms: "Areas: picked
-- from a list of Bengaluru areas that the CEO and Managers manage in the
-- Command Center"), seeded from the starting list the registration forms used
-- (src/modules/screens-call-registration/bengaluru-areas.ts). And a team name
-- for each Team Lead's team (CEO Teams screen).

CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "pincode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mergedIntoId" TEXT,
    "createdByStaffId" TEXT,
    "updatedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Area_nameKey_key" ON "Area"("nameKey");
CREATE INDEX "Area_active_idx" ON "Area"("active");

ALTER TABLE "Area" ENABLE ROW LEVEL SECURITY;

INSERT INTO "Area" ("id", "name", "nameKey", "pincode", "latitude", "longitude", "updatedAt") VALUES
    (gen_random_uuid()::text, 'BTM Layout 2nd Stage', 'btm layout 2nd stage', '560076', 12.9166, 77.6101, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Banashankari', 'banashankari', '560070', 12.9255, 77.5468, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Banaswadi', 'banaswadi', '560043', 13.0104, 77.6482, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Basavanagudi', 'basavanagudi', '560004', 12.9406, 77.5738, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Bellandur', 'bellandur', '560103', 12.9257, 77.6762, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Bommanahalli', 'bommanahalli', '560068', 12.9030, 77.6243, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Domlur', 'domlur', '560071', 12.9610, 77.6387, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Electronic City', 'electronic city', '560100', 12.8452, 77.6602, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Frazer Town', 'frazer town', '560005', 12.9970, 77.6150, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Gandhinagar (Majestic)', 'gandhinagar (majestic)', '560009', 12.9767, 77.5713, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Hebbal', 'hebbal', '560024', 13.0358, 77.5970, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Hennur', 'hennur', '560043', 13.0358, 77.6380, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'HSR Layout', 'hsr layout', '560102', 12.9116, 77.6389, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Indiranagar', 'indiranagar', '560038', 12.9784, 77.6408, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Jalahalli', 'jalahalli', '560013', 13.0465, 77.5486, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Jayanagar', 'jayanagar', '560041', 12.9250, 77.5938, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'JP Nagar', 'jp nagar', '560078', 12.9063, 77.5857, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Kengeri', 'kengeri', '560060', 12.9081, 77.4853, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Koramangala', 'koramangala', '560034', 12.9352, 77.6245, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'KR Puram', 'kr puram', '560036', 13.0074, 77.6950, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Kumaraswamy Layout', 'kumaraswamy layout', '560078', 12.9081, 77.5553, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Madiwala', 'madiwala', '560068', 12.9226, 77.6174, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Mahadevapura', 'mahadevapura', '560048', 12.9916, 77.7062, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Malleshwaram', 'malleshwaram', '560003', 13.0035, 77.5647, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Marathahalli', 'marathahalli', '560037', 12.9569, 77.7011, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Nagarbhavi', 'nagarbhavi', '560072', 12.9600, 77.5100, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Peenya', 'peenya', '560058', 13.0329, 77.5273, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Rajajinagar', 'rajajinagar', '560010', 12.9915, 77.5545, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'RT Nagar', 'rt nagar', '560032', 13.0219, 77.5946, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Sarjapur Road', 'sarjapur road', '560035', 12.9010, 77.6860, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Shivajinagar', 'shivajinagar', '560051', 12.9857, 77.6057, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Ulsoor', 'ulsoor', '560008', 12.9817, 77.6286, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Uttarahalli', 'uttarahalli', '560061', 12.9055, 77.5422, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Vijayanagar', 'vijayanagar', '560040', 12.9719, 77.5376, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Whitefield', 'whitefield', '560066', 12.9698, 77.7500, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Wilson Garden', 'wilson garden', '560027', 12.9490, 77.5968, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Yelahanka', 'yelahanka', '560064', 13.1007, 77.5963, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Yeshwanthpur', 'yeshwanthpur', '560022', 13.0285, 77.5409, CURRENT_TIMESTAMP)
ON CONFLICT ("nameKey") DO NOTHING;

ALTER TABLE "Staff" ADD COLUMN "teamName" TEXT;
