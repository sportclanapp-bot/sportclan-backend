/**
 * Fix list 25 Nov 2026 · group 3 (speed, server): same answers, fewer trips. (The replies were diffed
 * against the untouched build on a frozen database, .baseline/nov25; these lock the rules.)
 */
import fs from 'fs';
import path from 'path';
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
let mockRpc: (fn: string, args: any) => any = async () => ({ data: null, error: { code: 'PGRST202', message: 'no function' } });
let mockInFlight = 0; let mockPeak = 0; let mockReads = 0;
jest.mock('../utils/supabase', () => ({
  get supabase() {
    return { from: (t: string) => {
      const b = db.client.from(t); const then = b.then.bind(b);
      b.then = (ok: any, bad: any) => { mockReads++; mockInFlight++; mockPeak = Math.max(mockPeak, mockInFlight); return new Promise((r) => setTimeout(r, 5)).then(() => { mockInFlight--; return then(ok, bad); }); };
      return b;
    }, rpc: (fn: string, a: any) => mockRpc(fn, a) };
  },
}));
// eslint-disable-next-line import/first
import { IN_CHUNK, PARALLEL_READS, inParallel, selectAllIn } from '../utils/selectAll';
// eslint-disable-next-line import/first
import { countParticipantsByMatch } from '../utils/matchCounts';
// eslint-disable-next-line import/first
import { myHomeMatches, myMatchesWithStatus, myScheduledMatches, pickNextMatch, sortMyLive } from '../utils/nextMatch';
// eslint-disable-next-line import/first
import { MATCH_LIST_COLUMNS } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { hideOfficialReport } from '../middleware/hideOfficialReport.middleware';
// eslint-disable-next-line import/first
import { supabase } from '../utils/supabase';

const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
beforeEach(() => { mockInFlight = 0; mockPeak = 0; mockReads = 0; mockRpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'no function' } }); });

describe('reads a few at a time, in order', () => {
  it('keeps the order, never more than the limit at once, throws the first error', async () => {
    let now = 0; let peak = 0;
    const r = await inParallel(Array.from({ length: 25 }, (_, i) => i), async (n) => { now++; peak = Math.max(peak, now); await new Promise((x) => setTimeout(x, (25 - n) % 5)); now--; return n * 2; });
    expect(r).toEqual(Array.from({ length: 25 }, (_, i) => i * 2));
    expect(peak).toBe(PARALLEL_READS);
    await expect(inParallel([1, 2, 3], async (n) => { if (n === 2) throw new Error('boom'); return n; })).rejects.toThrow('boom');
    expect(await inParallel([], async () => 1)).toEqual([]);
  });
  it('selectAllIn: every chunk, in the ids’ order, duplicates once', async () => {
    const ids = Array.from({ length: IN_CHUNK * 3 + 7 }, (_, i) => `m${String(i).padStart(4, '0')}`);
    db = fakeDb({ t: ids.map((id) => ({ id })) });
    const rows = await selectAllIn<{ id: string }>([...ids, ids[0]!], (c, f, to) => (supabase as any).from('t').select('id').in('id', c).order('id').range(f, to));
    expect(rows.map((r) => r.id)).toEqual(ids);
    expect(mockReads).toBe(4);
    expect(mockPeak).toBe(4); // together, not one after another
  });
});

describe('item 18 · line-up counts in one call', () => {
  const ids = Array.from({ length: 250 }, (_, i) => `m${i}`);
  it('the function’s numbers (one trip); a match with none is absent', async () => {
    const asked: any[] = [];
    mockRpc = async (fn, a) => { asked.push([fn, a.p_ids.length]); return { data: { m0: 2, m7: 11 }, error: null }; };
    const r = await countParticipantsByMatch([...ids, 'm0']);
    expect([...r]).toEqual([['m0', 2], ['m7', 11]]);
    expect(asked).toEqual([['match_participant_counts', 250]]);
    expect(mockReads).toBe(0);
  });
  it('before migration 170, or when it fails or throws: counted from the rows as before', async () => {
    db = fakeDb({ match_participants: ids.flatMap((m, i) => Array.from({ length: i % 3 }, (_, k) => ({ id: `${m}-${k}`, match_id: m }))) });
    for (const rpc of [async () => ({ data: null, error: { code: 'PGRST202' } }), async () => { throw new Error('net'); }, async () => ({ data: null, error: null })]) {
      mockRpc = rpc as never;
      const r = await countParticipantsByMatch(ids);
      expect([r.get('m1'), r.get('m2'), r.get('m0'), r.size]).toEqual([1, 2, undefined, 166]);
    }
  });
  it('nothing asked: nothing read', async () => { expect((await countParticipantsByMatch([])).size).toBe(0); expect(mockReads).toBe(0); });
});

describe('item 26 · Home’s matches in one go are the two calls’ matches', () => {
  const at = (h: number) => new Date(Date.parse('2026-11-25T10:00:00Z') + h * 3600000).toISOString();
  const M = (id: string, status: string, extra: object = {}) => ({ id, status, voided_at: null, scheduled_at: at(1), updated_at: at(0), created_by: 'x', team_a_id: null, team_b_id: null, sport_id: 's', score_summary: { big: true }, ...extra });
  const seed = () => { db = fakeDb({
    match_participants: [{ match_id: 'p1', user_id: 'u' }, { match_id: 'p2', user_id: 'u' }, { match_id: 'v', user_id: 'u' }],
    team_members: [],
    match_followers: [{ match_id: 'f1', user_id: 'u' }, { match_id: 'p1', user_id: 'u' }, { match_id: 'c1', user_id: 'u' }, { match_id: 'fs', user_id: 'u' }],
    matches: [M('p1', 'live'), M('p2', 'scheduled', { scheduled_at: at(3) }), M('c1', 'live', { created_by: 'u', updated_at: at(2) }), M('c2', 'scheduled', { created_by: 'u', scheduled_at: at(3) }),
      M('f1', 'live', { updated_at: at(5) }), M('fs', 'scheduled', { scheduled_at: at(0.1) }), M('v', 'live', { voided_at: at(0) }), M('done', 'completed', { created_by: 'u' })],
  }); };
  // The fake's `or` takes only eq/is, so the team read is checked on the real database (nov25 snapshots).
  it('same live rows with the same relation, same next match (never one you only follow)', async () => {
    seed();
    const now = Date.parse(at(0));
    const home = await myHomeMatches('u', now);
    seed();
    const live = await myMatchesWithStatus('u', 'live', { followed: true });
    const next = pickNextMatch(await myScheduledMatches('u'), now);
    expect(sortMyLive(home.live)).toEqual(sortMyLive(live));
    expect(home.next).toEqual(next);
    expect(home.next.match.score_summary).toEqual({ big: true }); // the whole row
    expect(home.live.find((m) => m.id === 'p1').relation).toBe('plays');
    expect(home.live.find((m) => m.id === 'c1').relation).toBe('created');
  });
  it('nothing yours', async () => {
    db = fakeDb({});
    expect(await myHomeMatches('nobody')).toEqual({ next: { match: null, overdue: false }, live: [] });
  });
  it('the officials’ report never leaves in it (nor in the replies it replaces)', () => {
    for (const body of [{ match: { official_report: 'x', id: 1 } }, { matches: [{ official_report: 'x', id: 1 }] }, { next: { match: { official_report: 'x', id: 1 } }, my_live: { matches: [{ official_report: 'x', id: 2 }] } }, { next: null, my_live: undefined }]) {
      let sent: any = null;
      const res: any = { json: (b: unknown) => { sent = b; return res; } };
      hideOfficialReport({} as any, res, () => undefined);
      res.json(body);
      expect(JSON.stringify(sent)).not.toContain('official_report');
    }
  });
});

describe('item 13 · a match list’s columns', () => {
  const cols = MATCH_LIST_COLUMNS.split(', ');
  it('every column the app reads on a list; none of the dropped ones', () => {
    for (const c of ['id', 'sport_id', 'tournament_id', 'team_a_id', 'team_b_id', 'team_a_name', 'team_b_name', 'scheduled_at', 'venue', 'format', 'overs', 'status', 'winner_team_id', 'score_summary', 'rules', 'created_by', 'is_ranked', 'is_open', 'players_needed', 'voided_at', 'round', 'match_no', 'group_label', 'next_match_id', 'bracket', 'completed_at', 'join_policy', 'toss_winner_team_id', 'tie_toss']) expect(cols).toContain(c);
    for (const c of ['official_report', 'squad_locked_at', 'scorecard_locked_at', 'mvp_user_id', 'result_type', 'is_test_seed', 'called_by', 'loser_next_match_id', 'loser_next_slot', 'umpire_offer_by', 'umpire_offer_at', 'client_key']) expect(cols).not.toContain(c);
    expect(new Set(cols).size).toBe(cols.length);
  });
});

describe('items 14, 17, 22 · reads together', () => {
  const body = (f: string, fn: string, n = 14000) => { const s = src(f); const i = s.indexOf(`export async function ${fn}(`); return s.slice(i, i + n); };
  it('getMatch: the checks go in one Promise.all; a failed one is what it was', () => {
    const b = body('controllers/matches.controller.ts', 'getMatch');
    expect(b).toMatch(/const \[sportSlug, scorer, canDefaultHere, canWalkoverHere, hubHolder, canVoid, canRate, selfMode, umpireOffer, viewerCan\] = await Promise\.all\(/);
    expect(b).toContain('canDefault(match as never, userId, officiates)');
  });
  it('getUserById: nothing is returned before the profile exists, is not deleted and is not blocked', () => {
    const b = body('controllers/users.controller.ts', 'getUserById', 6000);
    expect(b.indexOf("if (blocked) return res.status(404)")).toBeGreaterThan(b.indexOf('await Promise.all(['));
    expect(b.indexOf("if (blocked) return res.status(404)")).toBeLessThan(b.indexOf('const safeUser'));
  });
  it('getTournament: fixtures of a tournament with none never claim results', () => {
    expect(body('controllers/tournaments.controller.ts', 'getTournament', 5000)).toContain('has_results = (fixturesCount ?? 0) > 0 ? hasResult : false');
  });
});

describe('migration 170', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/170_speed_counts_and_team_indexes.sql'), 'utf8');
  it('both team indexes, the two counting functions for the server only, nothing else', () => {
    expect(sql).toMatch(/idx_matches_team_a_id ON public\.matches \(team_a_id\)/);
    expect(sql).toMatch(/idx_matches_team_b_id ON public\.matches \(team_b_id\)/);
    for (const f of ['match_participant_counts\\(uuid\\[\\]\\)', 'services_type_counts\\(uuid, uuid, boolean\\)']) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f} FROM anon, authenticated`));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f} TO service_role`));
    }
    expect(sql).not.toMatch(/\b(DELETE|UPDATE|DROP|TRUNCATE|ALTER TABLE)\b/);
  });
});
