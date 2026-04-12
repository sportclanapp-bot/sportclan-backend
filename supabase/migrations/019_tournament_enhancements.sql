-- Tournament enhancements: organiser details, registration deadline, logo
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS organiser_name TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS organiser_mobile TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS registration_deadline TIMESTAMPTZ;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS logo_url TEXT;
