/**
 * Migration 110 · a team's short name is kept. New team and Edit team always
 * asked for it, but `teams` had no column and the backend dropped the field.
 * Now it is validated (≤ 3, trimmed, upper-cased, blank clears), saved on
 * create and edit, and returned wherever team data goes out — including the
 * match rows (team_a_short_name / team_b_short_name) and standings rows.
 */
import fs from 'fs';
import path from 'path';
import { normalizeShortName, SHORT_NAME_MAX } from '../utils/validation';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '110_team_short_name.sql'), 'utf8');

describe('normalizeShortName', () => {
  test('trims and upper-cases; blank or null clears; absent leaves it alone', () => {
    expect(normalizeShortName(' mum ')).toEqual({ value: 'MUM' });
    expect(normalizeShortName('pu')).toEqual({ value: 'PU' });
    expect(normalizeShortName('')).toEqual({ value: null });
    expect(normalizeShortName('   ')).toEqual({ value: null });
    expect(normalizeShortName(null)).toEqual({ value: null });
    expect(normalizeShortName(undefined)).toEqual({});
  });
  test('over 3 characters, or not text, is refused', () => {
    expect(SHORT_NAME_MAX).toBe(3);
    expect(normalizeShortName('ABCD').error).toMatch(/3 characters or fewer/);
    expect(normalizeShortName(42).error).toMatch(/text/);
    expect(normalizeShortName('🏏🏏🏏')).toEqual({ value: '🏏🏏🏏' }); // counted as characters, not UTF-16 units
  });
});

describe('create and edit save it', () => {
  const teams = () => code('controllers/teams.controller.ts');
  test('create validates before the insert and writes short_name', () => {
    expect(teams()).toMatch(/const \{ sport_id, name, logo_url, city_id, join_policy, short_name \} = req\.body/);
    expect(teams()).toMatch(/\.\.\.\(shortName\.value !== undefined \? \{ short_name: shortName\.value \} : \{\}\),/);
  });
  test('edit validates and writes short_name (clearing with null works)', () => {
    expect(teams()).toMatch(/const \{ name, logo_url, city_id, is_public, join_policy, short_name \} = req\.body/);
    expect(teams()).toMatch(/if \(shortName\.value !== undefined\) allowed\.short_name = shortName\.value;/);
    expect((teams().match(/code: 'INVALID_SHORT_NAME'/g) ?? []).length).toBe(2);
  });
});

describe('it goes out wherever team data does', () => {
  test('explicit team selects carry short_name', () => {
    expect(code('controllers/search.controller.ts')).toMatch(/id, name, short_name, logo_url, sport_id,/);
    expect(code('controllers/tournaments.controller.ts')).toMatch(/team:team_id \(id, name, short_name, logo_url, sport_id\)/);
    expect(code('controllers/tournaments.controller.ts')).not.toMatch(/team:teams!team_id\(id, name\)/);
    expect(code('controllers/tournamentHub.controller.ts')).toMatch(/team:teams\(id, name, short_name, logo_url\)/);
    expect(code('controllers/teams.controller.ts')).toMatch(/select\('id, name, short_name, sport_id, join_policy, deleted_at(, kind)?'\)/);
  });
  test('match rows get team_a_short_name / team_b_short_name', () => {
    expect(code('controllers/matches.controller.ts')).toMatch(/import \{ attachTeamNames \} from '\.\.\/utils\/teamNames';/);
    const m = code('utils/teamNames.ts');
    expect(m).toMatch(/\.from\('teams'\)\.select\('id, name, short_name'\)\.in\('id', \[\.\.\.ids\]\)/);
    expect(m).toMatch(/m\.team_a_short_name = a\?\.short_name \?\? null;/);
    expect(m).toMatch(/m\.team_b_short_name = b\?\.short_name \?\? null;/);
  });
  test("match-result post cards get each side's name and short name", () => {
    const c = code('controllers/community.controller.ts');
    expect((c.match(/\(id, team_a_id, team_b_id, team_a_name, team_b_name,/g) ?? []).length).toBe(2);
    expect(c).toMatch(/await attachTeamNames\(items\.map\(\(p: any\) => p\.match\)\.filter\(Boolean\)\);/);
    expect(c).toMatch(/if \(m\) await attachTeamNames\(\[m\]\);/);
  });
  test('standings rows get team_short_name', () => {
    expect(code('controllers/features.controller.ts')).toMatch(/team_short_name: \(r as any\)\.teamShort,/);
  });
});

describe('migration 110', () => {
  test('a nullable column with a 1–3 character check; schema only', () => {
    expect(migration).toMatch(/ALTER TABLE teams ADD COLUMN IF NOT EXISTS short_name text;/);
    expect(migration).toMatch(/CHECK \(short_name IS NULL OR char_length\(short_name\) BETWEEN 1 AND 3\)/);
    expect(migration).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bINSERT\b/);
  });
});
