/**
 * Q32 (Dipak, 21 Nov 2026, A) · N-R6-E065 / F119 part b: while a tournament's offline venue hub runs,
 * every other phone is read-only for its results (409 HUB_RUNNING, in words); the hub's own phone
 * (lease person + device) records; a match outside a tournament, or no hub, is untouched.
 */
const mockLease: { row: null | { user_id: string; device_id: string } } = { row: null };
jest.mock('../utils/hubLease', () => ({ getHubLease: jest.fn(async () => mockLease.row) }));
jest.mock('../utils/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Asha Organiser' } }) }) }) }) },
}));
import fs from 'fs';
import path from 'path';
import { hubRefusal, HUB_RUNNING } from '../utils/hubReadOnly';

beforeEach(() => { mockLease.row = null; });

test('no hub, or not a tournament match: this phone records', async () => {
  expect(await hubRefusal('t1', 'u1', 'd1')).toBeNull();
  mockLease.row = { user_id: 'org', device_id: 'hub' };
  expect(await hubRefusal(null, 'u1', 'd1')).toBeNull();
});

test('the hub phone itself records', async () => {
  mockLease.row = { user_id: 'org', device_id: 'hub' };
  expect(await hubRefusal('t1', 'org', 'hub')).toBeNull();
});

test('another phone — another organiser, an umpire, or the hub holder on a second phone — only views', async () => {
  mockLease.row = { user_id: 'org', device_id: 'hub' };
  const other = await hubRefusal('t1', 'umpire', 'd2');
  expect(other).toEqual({ code: HUB_RUNNING, error: 'The venue hub on Asha Organiser’s phone is recording this tournament’s results, so this phone can only view them. Record the result on the hub phone, or take the hub over from the tournament’s Venue hub.' });
  expect((await hubRefusal('t1', 'org', 'phone2'))?.error).toMatch(/^The venue hub on your other phone is recording/);
  expect((await hubRefusal('t1', 'org', null))?.code).toBe(HUB_RUNNING); // no device id: not the hub
});

test('every result path asks it', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  // live points, undo, typed score and QR hand-off (authorizeScorer)
  expect(read('controllers/scoring.controller.ts')).toMatch(/const hub = await hubRefusal\(match\.tournament_id, userId, deviceId\);\s*if \(hub\) return \{ ok: false as const, status: 409, error: hub\.error, code: hub\.code, match \};/);
  // edit / delete an action
  expect(read('controllers/matchFeatures.controller.ts')).toMatch(/const hub = await hubRefusal\(\(match as \{ tournament_id\?: string \| null \}\)\.tournament_id, userId, deviceId\);/);
  // decide (stands / replay / awarded)
  expect(read('controllers/matchDecision.controller.ts')).toMatch(/const hub = await hubRefusal\(m\.tournament_id, userId, deviceIdOf\(req\)\);\s*if \(hub\) return res\.status\(409\)\.json\(hub\);/);
  const mc = read('controllers/matches.controller.ts');
  // complete (result, walkover, retirement): F119 b — a second phone was told 'already completed'
  expect(mc).toMatch(/if \(!system\) \{\s*const hub = await hubRefusal\(match\.tournament_id as string \| null, userId, deviceIdOf\(req\)\);\s*if \(hub\) return res\.status\(409\)\.json\(hub\);/);
  // PATCH status / winner / score
  expect(mc).toMatch(/\['status', 'winner_team_id', 'score_summary'\]\.some\(\(k\) => k in update\)\) \{\s*const hub = await hubRefusal/);
  // the match page tells the app
  expect(mc).toContain('matchWithRating.hub_elsewhere = holder ?');
});
