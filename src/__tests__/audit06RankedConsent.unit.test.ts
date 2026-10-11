/**
 * Audit #6 (11 Oct 2026): anyone could create a ranked match between two teams
 * they weren't in, add anyone to its line-up and complete it — changing those
 * players' ratings. Now the creator must be on one of the teams, and only
 * players who agreed (creator, creator's teammates, "In", or a tournament
 * fixture's line-up) have their record changed.
 */
import { fakeDb } from './helpers/fakeSupabase';

const STRANGER = 'u-stranger'; const CAPT_A = 'u-a1'; const A2 = 'u-a2'; const B1 = 'u-b1'; const B2 = 'u-b2';
const TA = 't-a'; const TB = 't-b';
let db = fakeDb();
const mk = () => fakeDb({
  teams: [{ id: TA, sport_id: 's1', deleted_at: null }, { id: TB, sport_id: 's1', deleted_at: null }],
  team_members: [
    { id: 'm1', team_id: TA, user_id: CAPT_A }, { id: 'm2', team_id: TA, user_id: A2 },
    { id: 'm3', team_id: TB, user_id: B1 }, { id: 'm4', team_id: TB, user_id: B2 },
  ],
  match_availability: [{ match_id: 'm', user_id: B1, status: 'available' }],
  tournaments: [],
});
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));

// eslint-disable-next-line import/first
import { createMatchRefusal } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { consentedParticipants } from '../utils/matchConsent';

const base = { sportId: 's1', venue: 'Ground', scheduledAt: new Date(Date.now() + 3600_000).toISOString(), isRanked: true, isOpen: false, tournamentId: null };

describe('audit #6: ranked matches for other people’s teams', () => {
  beforeEach(() => { db = mk(); });

  it('a stranger cannot create a match between two teams they are not in', async () => {
    const r = await createMatchRefusal({ ...base, userId: STRANGER, teamIds: [TA, TB] });
    expect(r?.code).toBe('NOT_ON_TEAM');
  });

  it("a team's own player can", async () => {
    expect(await createMatchRefusal({ ...base, userId: CAPT_A, teamIds: [TA, TB] })).toBeNull();
  });

  it('only players who agreed have their record changed', async () => {
    const parts = [
      { user_id: CAPT_A, team_side: 'A' }, { user_id: A2, team_side: 'A' },
      { user_id: B1, team_side: 'B' }, { user_id: B2, team_side: 'B' }, { user_id: STRANGER, team_side: 'B' },
    ];
    const counted = await consentedParticipants({ id: 'm', created_by: CAPT_A, tournament_id: null, team_a_id: TA, team_b_id: TB }, parts);
    // CAPT_A: creator; A2: creator's teammate; B1: said "In". B2 and the stranger did not agree.
    expect(counted.map((p) => p.user_id).sort()).toEqual([A2, B1, CAPT_A].sort());
  });

  it('a stranger who creates a typed-name match changes nobody else’s record', async () => {
    const counted = await consentedParticipants({ id: 'm2', created_by: STRANGER, tournament_id: null, team_a_id: null, team_b_id: null },
      [{ user_id: STRANGER, team_side: 'A' }, { user_id: B2, team_side: 'B' }]);
    expect(counted.map((p) => p.user_id)).toEqual([STRANGER]);
  });

  it('a tournament fixture counts its whole line-up', async () => {
    const parts = [{ user_id: B2, team_side: 'A' }, { user_id: A2, team_side: 'B' }];
    expect(await consentedParticipants({ id: 'm3', created_by: STRANGER, tournament_id: 'T', team_a_id: TB, team_b_id: TA }, parts)).toEqual(parts);
  });
});
