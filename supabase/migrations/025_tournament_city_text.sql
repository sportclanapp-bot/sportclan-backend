-- Add city TEXT column to tournaments so we store the city name directly
-- alongside the optional city_id FK. This fixes the frontend/backend mismatch
-- where CreateTournamentScreen sent a text string but the backend only
-- accepted a UUID city_id.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS city TEXT;
