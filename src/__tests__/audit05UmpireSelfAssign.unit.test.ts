/**
 * Audit #5 (11 Oct 2026): a stranger could add "umpire" to their own account,
 * self-assign on ANY match (tournament fixtures too) and then score, complete,
 * abandon or void it. Now: a tournament fixture only to its organisers or the
 * tournament's own officials; a casual match only by the creator's acceptance.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const ORG = id(1); const STRANGER = id(2); const T_OFF = id(3); const CREATOR = id(4); const T = id(10);
const FIX = id(20); const CASUAL = id(21);
const mkDb = () => fakeDb({
  users: [ORG, STRANGER, T_OFF, CREATOR].map((u, i) => ({ id: u, name: `U${i}`, deleted_at: null })),
  user_account_types: [STRANGER, T_OFF].map((u) => ({ user_id: u, account_type: 'umpire' })),
  tournaments: [{ id: T, created_by: ORG, parent_id: null }],
  tournament_organisers: [],
  tournament_officials: [{ tournament_id: T, user_id: T_OFF, role: 'umpire' }],
  matches: [
    { id: FIX, tournament_id: T, created_by: ORG, umpire_id: null, umpire_offer_by: null, status: 'scheduled', is_ranked: false, team_a_name: 'A', team_b_name: 'B', sport_id: null, voided_at: null },
    { id: CASUAL, tournament_id: null, created_by: CREATOR, umpire_id: null, umpire_offer_by: null, status: 'scheduled', is_ranked: false, team_a_name: 'C', team_b_name: 'D', sport_id: null, voided_at: null },
  ],
  match_participants: [],
});
let db = mkDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []) }));
jest.mock('../utils/sportSlug', () => ({ sportSlugOf: jest.fn(async () => 'badminton') }));

// eslint-disable-next-line import/first
import { selfAssignUmpire, answerUmpireOffer } from '../controllers/matches.controller';

function call(fn: (req: any, res: any) => Promise<unknown>, userId: string, matchId: string, body: object = {}) {
  const out: { status: number; body: any } = { status: 200, body: null };
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; } };
  return fn({ userId, params: { id: matchId }, body }, res).then(() => out);
}
const m = (mid: string) => db.t('matches').find((r) => r.id === mid)!;

describe('audit #5: who may take a match official seat', () => {
  beforeEach(() => { db = mkDb(); });

  it('a stranger with the umpire role is refused on a tournament fixture', async () => {
    const r = await call(selfAssignUmpire, STRANGER, FIX);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ORGANISER_NAMES_OFFICIALS');
    expect(m(FIX).umpire_id).toBeNull();
  });

  it("the tournament's own official may take it", async () => {
    const r = await call(selfAssignUmpire, T_OFF, FIX);
    expect(r.status).toBe(200);
    expect(m(FIX).umpire_id).toBe(T_OFF);
  });

  it('on a casual match a stranger only offers; the seat stays empty', async () => {
    const r = await call(selfAssignUmpire, STRANGER, CASUAL);
    expect(r.status).toBe(200);
    expect(r.body.offered).toBe(true);
    expect(m(CASUAL).umpire_id).toBeNull();
    expect(m(CASUAL).umpire_offer_by).toBe(STRANGER);
  });

  it('only the creator can accept the offer, and then the stranger is the official', async () => {
    await call(selfAssignUmpire, STRANGER, CASUAL);
    expect((await call(answerUmpireOffer, STRANGER, CASUAL, { accept: true })).status).toBe(403);
    expect(m(CASUAL).umpire_id).toBeNull();
    const ok = await call(answerUmpireOffer, CREATOR, CASUAL, { accept: true });
    expect(ok.status).toBe(200);
    expect(m(CASUAL).umpire_id).toBe(STRANGER);
    expect(m(CASUAL).umpire_offer_by).toBeNull();
  });

  it('a declined offer leaves no official', async () => {
    await call(selfAssignUmpire, STRANGER, CASUAL);
    const r = await call(answerUmpireOffer, CREATOR, CASUAL, { accept: false });
    expect(r.status).toBe(200);
    expect(m(CASUAL).umpire_id).toBeNull();
    expect(m(CASUAL).umpire_offer_by).toBeNull();
  });
});
