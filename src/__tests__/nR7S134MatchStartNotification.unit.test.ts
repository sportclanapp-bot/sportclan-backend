/**
 * N-R7-S134 (Step 2 B11, SP-BKB-C32): a player in a basketball match got the result (and the quarters)
 * but no notification when the match started — 'match_start' existed as a type behind the Match updates
 * switch, but nothing sent it. A scheduled match's first play now tells its players and followers once,
 * in the sport's words ('🏀 Tip-off'); a start already sent sends nothing.
 */
import fs from 'fs';
import path from 'path';

let mockRows: Record<string, unknown> = {};
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const chain: any = {};
    for (const m of ['select', 'in', 'eq', 'limit', 'maybeSingle', 'order', 'is']) chain[m] = jest.fn(() => chain);
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: mockRows[t] ?? null, error: null }));
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'basketball' })) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(async () => undefined), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import * as scoring from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import * as push from '../utils/scorePush';
// eslint-disable-next-line import/first
import { notifyUsers } from '../utils/notify';

const fanout = (scoring as unknown as { fanoutMatchStart?: (id: string, actor?: string) => Promise<void> }).fanoutMatchStart;
const words = (push as unknown as { matchStartPush?: (a: { slug: string; teamAName: string; teamBName: string }) => { title: string; body: string } }).matchStartPush;

beforeEach(() => { (notifyUsers as jest.Mock).mockClear(); });

test('the start push in the sport’s words', () => {
  expect(typeof words).toBe('function');
  expect(words!({ slug: 'basketball', teamAName: 'Kings', teamBName: 'Hawks' })).toEqual({ title: '🏀 Tip-off', body: 'Kings vs Hawks is under way — follow it live.' });
  expect(words!({ slug: 'football', teamAName: 'A', teamBName: 'B' }).title).toBe('⚽ Kick-off');
  expect(words!({ slug: 'badminton', teamAName: 'A', teamBName: 'B' }).title).toBe('🏸 Match started');
});

test('players and followers get one match_start (not the scorer); a start already sent sends nothing', async () => {
  expect(typeof fanout).toBe('function');
  mockRows = {
    notifications: [],
    matches: { sport_id: 'bk', team_a_name: 'Kings', team_b_name: 'Hawks' },
    match_participants: [{ user_id: 'p1' }, { user_id: 'p2' }],
    match_followers: [{ user_id: 'f1' }, { user_id: 'p1' }],
  };
  await fanout!('m1', 'scorer');
  expect(notifyUsers).toHaveBeenCalledTimes(1);
  expect(notifyUsers).toHaveBeenCalledWith(['p1', 'p2', 'f1'], expect.objectContaining({ type: 'match_start', title: '🏀 Tip-off', data: { matchId: 'm1', screen: 'MatchDetail' } }), { actorId: 'scorer' });
  mockRows = { ...mockRows, notifications: [{ id: 'n1' }] };
  await fanout!('m1', 'scorer');
  expect(notifyUsers).toHaveBeenCalledTimes(1);
});

test('the first play of a scheduled match (live event and QR hand-over) sends it', () => {
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', 'controllers', f), 'utf8');
  expect(src('scoring.controller.ts')).toMatch(/if \(startsPlay && match\.status === 'scheduled'\) inBackground\(fanoutMatchStart\(matchId, userId\)/);
  expect(src('qrHandoff.controller.ts')).toMatch(/if \(scorerMatch\.status === 'scheduled'\) inBackground\(fanoutMatchStart\(id!, p\.u\)/);
});
