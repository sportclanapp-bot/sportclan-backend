/**
 * N-R7-S173 (Step 2 FINAL, SIDE-B17-3): only the pad's Abandon wrote the abandon line
 * ({ kind: 'abandoned' } note) in the match log. The sweep of idle live matches, a cancelled
 * tournament and a withdrawal walkover wrote none, so after 'Replay the rest' the app's clock
 * (N-R7-706/708 stop it at that line) counted the whole time the match stood. Every path that
 * abandons a LIVE match now writes it; a match nobody started still gets none.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUser: jest.fn(), notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []) }));
// eslint-disable-next-line import/first
import { sweepStaleLiveMatches, sweepUnplayedScheduledMatches } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { walkoverOnWithdraw, cancelTournamentSideEffects } from '../controllers/tournaments.controller';

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const notes = (id: string) => db.t('match_events').filter((e) => e.match_id === id && e.event_type === 'note' && e.payload?.kind === 'abandoned');

describe('the sweep of idle live matches', () => {
  beforeEach(() => {
    db = fakeDb({ matches: [
      { id: 'idle', status: 'live', scheduled_at: ago(10), tournament_id: null, updated_at: ago(8) },
      { id: 'old', status: 'scheduled', scheduled_at: ago(72), tournament_id: null, updated_at: ago(72) },
    ] });
  });
  it('an idle live match it abandons gets the abandon line', async () => {
    await sweepStaleLiveMatches({ outcome: async () => null });
    expect(db.t('matches').find((m) => m.id === 'idle')!.status).toBe('abandoned');
    expect(notes('idle')).toHaveLength(1);
    expect(notes('idle')[0]!.payload).toEqual({ kind: 'abandoned' });
  });
  it('a match nobody started gets none', async () => {
    await sweepUnplayedScheduledMatches();
    expect(db.t('matches').find((m) => m.id === 'old')!.status).toBe('abandoned');
    expect(notes('old')).toHaveLength(0);
  });
});

describe('a cancelled tournament', () => {
  beforeEach(() => {
    db = fakeDb({ matches: [
      { id: 'tl', status: 'live', tournament_id: 'T' },
      { id: 'ts', status: 'scheduled', tournament_id: 'T' },
      { id: 'tc', status: 'completed', tournament_id: 'T' },
    ] });
  });
  it('its live match gets the abandon line (by the organiser); a scheduled or finished one none', async () => {
    await cancelTournamentSideEffects('T', 'P3 Cup', 'ORG');
    expect(db.t('matches').map((m) => m.status)).toEqual(['abandoned', 'abandoned', 'completed']);
    expect(notes('tl')).toHaveLength(1);
    expect(notes('tl')[0]!.created_by).toBe('ORG');
    expect(notes('ts')).toHaveLength(0);
    expect(notes('tc')).toHaveLength(0);
  });
});

describe('a withdrawal walkover', () => {
  const m = (over: object) => ({ tournament_id: 'T', group_label: null, voided_at: null, sport_id: 's', score_summary: {}, round: 1, next_match_id: null, rules: null, format: null, overs: null, ...over });
  beforeEach(() => {
    db = fakeDb({
      sports: [{ id: 's', slug: 'football' }],
      tournaments: [{ id: 'T', format: 'round_robin', status: 'live', settings: {}, champion_team_id: null }],
      tournament_entries: [{ tournament_id: 'T', team_id: 'A', status: 'withdrawn' }, { tournament_id: 'T', team_id: 'B', status: 'approved' }, { tournament_id: 'T', team_id: 'C', status: 'approved' }],
      team_members: [{ team_id: 'B', user_id: 'b1' }, { team_id: 'C', user_id: 'c1' }, { team_id: 'C', user_id: 'c2' }],
      matches: [
        m({ id: 'wl', team_a_id: 'A', team_b_id: 'B', team_a_name: 'A', team_b_name: 'B', status: 'live' }),
        m({ id: 'ws', team_a_id: 'C', team_b_id: 'A', team_a_name: 'C', team_b_name: 'A', status: 'scheduled' }),
      ],
    });
  });
  it('a live match given away gets the abandon line with who goes through; a scheduled one none', async () => {
    await walkoverOnWithdraw('T', 'A');
    const wl = db.t('matches').find((x) => x.id === 'wl')!;
    expect([wl.status, wl.winner_team_id]).toEqual(['abandoned', 'B']);
    expect(notes('wl').map((e) => e.payload)).toEqual([{ kind: 'abandoned', walkover_side: 'B', walkover_one: true }]);
    expect(db.t('matches').find((x) => x.id === 'ws')!.status).toBe('abandoned');
    expect(notes('ws')).toHaveLength(0);
  });
  it('a live match whose opponent has withdrawn too gets a plain abandon line', async () => {
    db.t('tournament_entries').find((e) => e.team_id === 'B')!.status = 'withdrawn';
    await walkoverOnWithdraw('T', 'A');
    expect(notes('wl').map((e) => e.payload)).toEqual([{ kind: 'abandoned' }]);
  });
});
