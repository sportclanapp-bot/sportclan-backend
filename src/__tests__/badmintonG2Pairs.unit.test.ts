/**
 * Badminton gap 2 (Oct 2026) · singles and pair entries.
 * A singles player enters as themselves; a doubles player invites a partner,
 * who accepts; "looking for a partner"; a partner change before the draw; the
 * organiser adds or pairs players. Underneath, a hidden entry team.
 */
import { fakeDb, fakeId } from './helpers/fakeSupabase';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const RAVI = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const AMIT = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003';
const PRIYA = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004';
const SARA = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009';
const NEHA = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005';
const SID = 'sport-bd';
const MS = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006';
const XD = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000007';
const CUP = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000008';
const mkDb = () => fakeDb({
  users: [
    { id: ORG, name: 'Org', username: 'org', gender: 'male', dob: '1980-01-01' },
    { id: RAVI, name: 'Ravi K', username: 'ravi', gender: 'male', dob: '1995-05-01' },
    { id: AMIT, name: 'Amit S', username: 'amit', gender: 'male', dob: '1996-05-01' },
    { id: PRIYA, name: 'Priya', username: 'priya', gender: 'female', dob: '1997-05-01' },
    { id: NEHA, name: 'Neha', username: 'neha', gender: 'female', dob: '2015-05-01' },
  ],
  tournaments: [
    { id: MS, name: 'Open · MS', status: 'upcoming', sport_id: SID, max_teams: 2, created_by: ORG, settings: { v: 1, category: { gender: 'men' } }, start_date: '2026-11-07', parent_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010', entry_kind: 'singles', fixtures_generated: false },
    { id: XD, name: 'Open · XD', status: 'upcoming', sport_id: SID, max_teams: 8, created_by: ORG, settings: { v: 1, category: { gender: 'mixed' }, entry: 'open' }, start_date: '2026-11-07', parent_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010', entry_kind: 'doubles', fixtures_generated: false },
    { id: CUP, name: 'Club Cup', status: 'upcoming', sport_id: SID, max_teams: 8, created_by: ORG, settings: null, start_date: '2026-11-07', entry_kind: 'team', fixtures_generated: false },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010', name: 'Open', status: 'upcoming', sport_id: SID, created_by: ORG, is_parent: true },
  ],
});
let db = mkDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
const notified: Array<{ userId: string; type: string; body: string }> = [];
jest.mock('../utils/notify', () => ({
  notifyUnlessBlocked: jest.fn(async (_a: string, n: { userId: string; type: string; body: string }) => { notified.push(n); }),
  notifyUser: jest.fn(), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(async () => []),
}));
let mockBlocked = new Set<string>();
jest.mock('../utils/blocks', () => ({
  isBlockedBetween: jest.fn(async (a: string, b: string) => mockBlocked.has(`${a}|${b}`) || mockBlocked.has(`${b}|${a}`)),
  blockedUserIds: jest.fn(async () => new Set()),
}));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatMembers: jest.fn(), syncAfterSuccess: jest.fn(), canOpenTournamentChat: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import { enterSelf, addPlayersEntry, createPairInvite, answerPairInvite, getPairs, entryTeamName, relatedEntries } from '../controllers/pairEntries.controller';
// eslint-disable-next-line import/first
import { createEntry, updateEntry } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { liveTeams, refuseEntryTeam } from '../utils/teamVisibility';

const run = async (fn: any, userId: string, params: object, body: object = {}) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), on: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params, query: {}, body, headers: {} } as any, r);
  return r;
};
const entriesOf = (tid: string) => db.t('tournament_entries').filter((e) => e.tournament_id === tid);
const rosterOf = (teamId: string) => db.t('team_members').filter((m) => m.team_id === teamId).map((m) => `${m.user_id}:${m.role}`).sort();
beforeEach(() => { db = mkDb(); notified.length = 0; mockBlocked = new Set(); });

describe('singles: enter as yourself', () => {
  test('a hidden entry team of one, the entry waiting for approval; the organiser hears', async () => {
    const r = await run(enterSelf, RAVI, { id: MS });
    expect(r.statusCode).toBe(200);
    const [e] = entriesOf(MS);
    expect(e.status).toBe('pending');
    const team = db.t('teams').find((x) => x.id === e.team_id)!;
    expect(team).toMatchObject({ kind: 'entry', name: 'Ravi K', sport_id: SID, created_by: RAVI });
    expect(rosterOf(team.id)).toEqual([`${RAVI}:captain`]);
    expect(notified.find((n) => n.userId === ORG)!.body).toBe('Ravi K asked to enter Open · MS.');
  });
  test('twice, a woman in a men’s event, a full event, and a team are refused', async () => {
    await run(enterSelf, RAVI, { id: MS });
    expect((await run(enterSelf, RAVI, { id: MS })).body.code).toBe('ALREADY_ENTERED');
    const w = await run(enterSelf, PRIYA, { id: MS });
    expect(w.body).toMatchObject({ code: 'CATEGORY' });
    await run(enterSelf, AMIT, { id: MS });
    // Stage 9 · T13: full with the waitlist turned off is refused (on, the default, it waits — stage9T13Waitlist).
    (db.t('tournaments').find((x: any) => x.id === MS) as any).settings.waitlist = false;
    expect((await run(enterSelf, ORG, { id: MS })).body.code).toBe('TOURNAMENT_FULL');
    (db.t('tournaments').find((x: any) => x.id === MS) as any).settings.waitlist = undefined;
    // an older app entering a team
    const CLUB = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000011';
    db.t('teams').push({ id: CLUB, sport_id: SID, kind: 'club', deleted_at: null });
    db.t('team_members').push({ team_id: CLUB, user_id: ORG, role: 'captain' });
    const t = await run(createEntry, ORG, { id: MS }, { team_id: CLUB });
    expect(t.statusCode).toBe(409);
    expect(t.body.code).toBe('ENTER_AS_PLAYERS');
  });
  test('a doubles event can’t be entered alone; a team event isn’t entered by players', async () => {
    expect((await run(enterSelf, RAVI, { id: XD })).body.code).toBe('NEEDS_PARTNER');
    expect((await run(enterSelf, RAVI, { id: CUP })).body.code).toBe('ENTER_AS_TEAM');
    expect((await run(enterSelf, RAVI, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010' })).body.code).toBe('ENTER_AN_EVENT');
  });
});

test('the organiser approves a player’s entry (it was refused as a team’s)', async () => {
  await run(enterSelf, RAVI, { id: MS });
  const [e] = entriesOf(MS);
  const r = await run(updateEntry, ORG, { id: MS, entryId: e.id }, { status: 'approved' });
  expect(r.statusCode).toBe(200);
  expect(entriesOf(MS)[0].status).toBe('approved');
});

describe('doubles: invite a partner, who accepts', () => {
  test('invite → the partner hears → accepts → the pair is entered (open entry: straight in)', async () => {
    const inv = await run(createPairInvite, RAVI, { id: XD }, { invitee_id: PRIYA, note: 'Saturday ok?' });
    expect(inv.statusCode).toBe(200);
    expect(notified.find((n) => n.userId === PRIYA)).toMatchObject({ type: 'pair_invite', body: 'Ravi K wants you as their partner in Open · XD. “Saturday ok?”' });
    const pairs = await run(getPairs, PRIYA, { id: XD });
    expect(pairs.body.received[0]).toMatchObject({ inviter: { id: RAVI, name: 'Ravi K' }, note: 'Saturday ok?' });
    const acc = await run(answerPairInvite, PRIYA, { id: XD, inviteId: inv.body.invite.id, action: 'accept' });
    expect(acc.statusCode).toBe(200);
    const [e] = entriesOf(XD);
    expect(e.status).toBe('approved');
    expect(db.t('teams').find((x) => x.id === e.team_id)).toMatchObject({ kind: 'entry', name: 'Ravi K / Priya' });
    expect(rosterOf(e.team_id)).toEqual([`${RAVI}:captain`, `${PRIYA}:vice_captain`]);
    expect(notified.find((n) => n.userId === RAVI)!.type).toBe('pair_accepted');
    const mine = await run(getPairs, RAVI, { id: XD });
    expect(mine.body.my_entry).toMatchObject({ entry_id: e.id, status: 'approved', partner: { id: PRIYA, name: 'Priya' } });
  });
  test('a mixed pair needs a man and a woman; an under-age partner is named', async () => {
    const two = await run(createPairInvite, RAVI, { id: XD }, { invitee_id: AMIT });
    expect(two.body).toMatchObject({ code: 'CATEGORY', error: 'A mixed event needs at least one man and one woman in the pair.' });
    db.t('tournaments').find((x) => x.id === XD)!.settings = { v: 1, category: { gender: 'mixed', minAge: 18 } };
    const kid = await run(createPairInvite, RAVI, { id: XD }, { invitee_id: NEHA });
    expect(kid.body.code).toBe('CATEGORY');
    expect(kid.body.error).toMatch(/Neha is 11/);
  });
  test('decline tells the inviter; only the invitee answers; the inviter cancels', async () => {
    const inv = (await run(createPairInvite, RAVI, { id: XD }, { invitee_id: PRIYA })).body.invite;
    expect((await run(answerPairInvite, AMIT, { id: XD, inviteId: inv.id, action: 'accept' })).statusCode).toBe(403);
    const d = await run(answerPairInvite, PRIYA, { id: XD, inviteId: inv.id, action: 'decline' });
    expect(d.body.invite.status).toBe('declined');
    expect(notified.find((n) => n.userId === RAVI)!.type).toBe('pair_declined');
    expect((await run(answerPairInvite, PRIYA, { id: XD, inviteId: inv.id, action: 'accept' })).body.code).toBe('INVITE_CLOSED');
    const inv2 = (await run(createPairInvite, RAVI, { id: XD }, { invitee_id: PRIYA })).body.invite;
    expect((await run(answerPairInvite, PRIYA, { id: XD, inviteId: inv2.id, action: 'cancel' })).statusCode).toBe(403);
    expect((await run(answerPairInvite, RAVI, { id: XD, inviteId: inv2.id, action: 'cancel' })).body.invite.status).toBe('cancelled');
    expect(entriesOf(XD)).toHaveLength(0);
  });
  test('a new request replaces my last one; a blocked player can’t be invited; not yourself', async () => {
    const a = (await run(createPairInvite, RAVI, { id: XD }, { invitee_id: PRIYA })).body.invite;
    await run(createPairInvite, RAVI, { id: XD }, { open: true });
    expect(db.t('tournament_pair_invites').find((x) => x.id === a.id)!.status).toBe('cancelled');
    mockBlocked.add(`${RAVI}|${NEHA}`);
    db.t('tournaments').find((x) => x.id === XD)!.settings = { v: 1 };
    expect((await run(createPairInvite, RAVI, { id: XD }, { invitee_id: NEHA })).body.code).toBe('BLOCKED');
    expect((await run(createPairInvite, RAVI, { id: XD }, { invitee_id: RAVI })).body.code).toBe('BAD_PARTNER');
  });
});

describe('looking for a partner', () => {
  test('listed for others (not me); asking is an invite to them; once paired, gone from the list', async () => {
    await run(createPairInvite, PRIYA, { id: XD }, { open: true, note: 'Intermediate, Sat mornings' });
    const seen = await run(getPairs, RAVI, { id: XD });
    expect(seen.body.looking).toEqual([expect.objectContaining({ user: expect.objectContaining({ id: PRIYA, gender: 'female' }), note: 'Intermediate, Sat mornings' })]);
    expect((await run(getPairs, PRIYA, { id: XD })).body).toMatchObject({ looking: [], my_open: { id: expect.any(String) } });
    const ask = (await run(createPairInvite, RAVI, { id: XD }, { invitee_id: PRIYA })).body.invite;
    await run(answerPairInvite, PRIYA, { id: XD, inviteId: ask.id, action: 'accept' });
    expect((await run(getPairs, AMIT, { id: XD })).body.looking).toEqual([]);
    expect(db.t('tournament_pair_invites').filter((x) => x.status === 'open')).toHaveLength(0);
  });
});

describe('a partner change before the draw', () => {
  const pair = async () => {
    const inv = (await run(createPairInvite, RAVI, { id: XD }, { invitee_id: PRIYA })).body.invite;
    await run(answerPairInvite, PRIYA, { id: XD, inviteId: inv.id, action: 'accept' });
    return entriesOf(XD)[0];
  };
  test('Ravi swaps Priya for another partner; Priya is told; the pair keeps its entry', async () => {
    db.t('users').push({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009', name: 'Sara', username: 'sara', gender: 'female', dob: '1990-01-01' });
    const e = await pair();
    const ch = (await run(createPairInvite, RAVI, { id: XD }, { invitee_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009', entry_id: e.id })).body.invite;
    expect(ch.entry_id).toBe(e.id);
    const acc = await run(answerPairInvite, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009', { id: XD, inviteId: ch.id, action: 'accept' });
    expect(acc.statusCode).toBe(200);
    expect(entriesOf(XD)).toHaveLength(1);
    expect(rosterOf(e.team_id)).toEqual([`${RAVI}:captain`, `${SARA}:vice_captain`]);
    expect(db.t('teams').find((x) => x.id === e.team_id)!.name).toBe('Ravi K / Sara');
    expect(notified.find((n) => n.userId === PRIYA && n.type === 'partner_changed')!.body).toBe('Ravi K now plays Open · XD with Sara.');
  });
  test('not after the draw, and not someone else’s entry', async () => {
    const e = await pair();
    expect((await run(createPairInvite, AMIT, { id: XD }, { invitee_id: NEHA, entry_id: e.id })).body.code).toBe('NOT_YOUR_ENTRY');
    db.t('tournaments').find((x) => x.id === XD)!.fixtures_generated = true;
    expect((await run(createPairInvite, RAVI, { id: XD }, { invitee_id: NEHA, entry_id: e.id })).body.code).toBe('PAIRS_LOCKED');
  });
});

describe('the organiser adds or pairs players', () => {
  test('a pair straight in, both told; not twice; only organisers', async () => {
    const r = await run(addPlayersEntry, ORG, { id: XD }, { user_ids: [AMIT, PRIYA] });
    expect(r.statusCode).toBe(200);
    expect(entriesOf(XD)[0].status).toBe('approved');
    expect(notified.filter((n) => n.type === 'entry_approved').map((n) => n.userId).sort()).toEqual([AMIT, PRIYA]);
    expect((await run(addPlayersEntry, ORG, { id: XD }, { user_ids: [RAVI, PRIYA] })).body).toMatchObject({ code: 'ALREADY_ENTERED', user_id: PRIYA });
    expect((await run(addPlayersEntry, RAVI, { id: XD }, { user_ids: [RAVI, NEHA] })).statusCode).toBe(403);
    expect((await run(addPlayersEntry, ORG, { id: XD }, { user_ids: [RAVI] })).body.code).toBe('BAD_PLAYERS');
  });
  test('entering a player cancels their open requests in the event', async () => {
    await run(createPairInvite, RAVI, { id: XD }, { open: true });
    await run(addPlayersEntry, ORG, { id: XD }, { user_ids: [RAVI, PRIYA] });
    expect(db.t('tournament_pair_invites').every((x) => x.status === 'cancelled')).toBe(true);
  });
});

describe('entry teams stay hidden', () => {
  test('lists show club teams only', () => {
    const q: any = { calls: [] as string[], is(c: string) { this.calls.push(`is:${c}`); return this; }, eq(c: string, v: string) { this.calls.push(`eq:${c}=${v}`); return this; } };
    liveTeams(q);
    expect(q.calls).toEqual(['is:deleted_at', 'eq:kind=club']);
  });
  test('the team routes can’t change an entry team’s roster', async () => {
    db.t('teams').push({ id: 'et', kind: 'entry' }, { id: 'ct', kind: 'club' });
    const next = jest.fn();
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) };
    await refuseEntryTeam({ params: { id: 'et' } } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
    await refuseEntryTeam({ params: { id: 'ct' } } as any, res, next);
    expect(next).toHaveBeenCalled();
  });
  test('pair names fit the 60-character team name', () => {
    expect(entryTeamName(['Ravi K', 'Priya'])).toBe('Ravi K / Priya');
    const long = entryTeamName(['A'.repeat(50), 'B'.repeat(50)]);
    expect(long.length).toBeLessThanOrEqual(60);
    expect(entryTeamName(['Solo'])).toBe('Solo');
    expect(fakeId()).toMatch(/^0{8}-/);
  });
});

describe('gap 6 · after a retirement: the player’s other entries', () => {
  test('this entry, and their entries in the tournament’s other events (organisers only)', async () => {
    await run(enterSelf, RAVI, { id: MS });
    await run(addPlayersEntry, ORG, { id: XD }, { user_ids: [RAVI, PRIYA] });
    const msTeam = entriesOf(MS)[0].team_id;
    const r = await run(relatedEntries, ORG, { id: MS, teamId: msTeam });
    expect(r.body.this_entry).toEqual({ entry_id: entriesOf(MS)[0].id });
    expect(r.body.others).toEqual([expect.objectContaining({ tournament_id: XD, entry_id: entriesOf(XD)[0].id, team_name: 'Ravi K / Priya' })]);
    expect((await run(relatedEntries, RAVI, { id: MS, teamId: msTeam })).statusCode).toBe(403);
  });
});
