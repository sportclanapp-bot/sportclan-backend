/**
 * Visual review B07 (backend) · the Add venue form's details are stored
 * (migration 099, decided 27 Sep 2026). They used to be thrown away on Save.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../utils/supabase', () => ({ supabase: {} }));
jest.mock('../utils/sportId', () => ({
  resolveSportId: async (raw: string | undefined) => (raw === 'cricket' || raw === 'uuid-cricket' ? 'uuid-cricket' : undefined),
}));
// eslint-disable-next-line import/first
import { venueDetails } from '../controllers/venues.controller';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('venueDetails', () => {
  it('keeps only what was given, trimmed, with the sport resolved', async () => {
    expect(await venueDetails({ address: '  12 MG Road ', sport_id: 'cricket', surface: 'turf', image_url: 'https://cdn.x/v.jpg' }))
      .toEqual({ fields: { address: '12 MG Road', sport_id: 'uuid-cricket', surface: 'turf', image_url: 'https://cdn.x/v.jpg' } });
    expect(await venueDetails({ name: 'x' })).toEqual({ fields: {} });
    expect(await venueDetails(undefined)).toEqual({ fields: {} });
  });
  it('refuses a bad one with a sentence', async () => {
    expect(await venueDetails({ address: 'a'.repeat(201) })).toEqual({ error: 'Address must be 200 characters or fewer.' });
    expect(await venueDetails({ surface: 's'.repeat(41) })).toEqual({ error: 'Surface must be 40 characters or fewer.' });
    expect(await venueDetails({ image_url: 'file:///local.jpg' })).toEqual({ error: 'The cover photo link is not valid.' });
    expect(await venueDetails({ sport_id: 'quidditch' })).toEqual({ error: 'Unknown sport.' });
  });
});

describe('createVenue and searchVenues', () => {
  const v = code('controllers/venues.controller.ts');
  it('an existing venue gets its empty details filled, never overwritten', () => {
    expect(v).toMatch(/for \(const \[k, v\] of Object\.entries\(details\.fields\)\) if \(row\[k\] == null\) fill\[k\] = v;/);
  });
  it('the directory returns the details and the city by name', () => {
    expect(v).toMatch(/address, sport_id, surface, image_url, city:cities!city_id\(name\)/);
    expect(v).toMatch(/city: city\?\.name \?\? null/);
  });
  it('migration 099 adds the four columns, nullable', () => {
    const m = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/099_venue_details.sql'), 'utf8');
    for (const c of ['address   text', 'sport_id  uuid REFERENCES sports(id) ON DELETE SET NULL', 'surface   text', 'image_url text']) {
      expect(m).toContain(`ADD COLUMN IF NOT EXISTS ${c}`);
    }
  });
});
