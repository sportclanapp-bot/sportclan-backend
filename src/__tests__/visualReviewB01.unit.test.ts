/**
 * Visual review B01 · a voided or abandoned match stops counting anywhere.
 *
 * V041/V211 — the rating card read "1200" over "1216 after 1 rated match".
 * V042     — First Match / Veteran / Winner / Champion stayed after a void.
 * V007     — "starts in 15 minutes!" for a match already played and voided.
 * V008     — "1184 → 1184.74 (+0.74)".
 * V074     — "win coins returned" named no match and read like a credit.
 * N1       — a match voided while live could still be completed, paying out
 *            rating, coins and badges for a match that counts for nobody.
 */
import fs from 'fs';
import path from 'path';

const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ── V042 · revoke, against a fake supabase ─────────────────────────────────
type Row = Record<string, any>;
const db: { badges: Row[]; user_sport_profiles: Row[]; user_badges: Row[]; failProfiles?: boolean } = {
  badges: [], user_sport_profiles: [], user_badges: [],
};
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const q: any = {
      select: () => q,
      update: (p: Row) => { patch = p; return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      is: (c: string, v: null) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      then: (resolve: (v: unknown) => unknown) => {
        if (table === 'user_sport_profiles' && db.failProfiles) return resolve({ data: null, error: { message: 'boom' } });
        const rows = (db as any)[table].filter((r: Row) => filters.every((f) => f(r)));
        if (patch) for (const r of rows) Object.assign(r, patch);
        return resolve({ data: rows, error: null });
      },
    };
    return q;
  };
  return { supabase: { from } };
});
// eslint-disable-next-line import/first
import { revokeRecordBadgesForUser } from '../controllers/badges.controller';

const BADGES = [
  { id: 'first_match', category: 'matches', threshold: 1 },
  { id: 'ten_matches', category: 'matches', threshold: 10 },
  { id: 'first_win', category: 'wins', threshold: 1 },
  { id: 'community_star', category: 'community', threshold: 20 },
];

beforeEach(() => {
  db.badges = BADGES.map((b) => ({ ...b }));
  db.failProfiles = false;
});

describe('V042 · badges a void no longer earns are taken back', () => {
  const active = () => db.user_badges.filter((b) => !b.revoked_at).map((b) => b.badge_id).sort();
  it('soft-revokes match and win badges whose threshold the walked-back totals miss — no row is deleted', async () => {
    db.user_sport_profiles = [{ user_id: 'u', matches_played: 0, wins: 0 }];
    db.user_badges = ['first_match', 'first_win', 'community_star'].map((b, i) => ({ id: `ub${i}`, user_id: 'u', badge_id: b }));
    const r = await revokeRecordBadgesForUser('u');
    expect(r.revoked).toBe(2);
    expect(db.user_badges).toHaveLength(3);
    expect(active()).toEqual(['community_star']);
    expect(db.user_badges.find((b) => b.badge_id === 'first_win')).toMatchObject({ revoke_reason: 'match voided' });
  });
  it('an already-revoked badge is not revoked again (its revoked_at stays the original)', async () => {
    db.user_sport_profiles = [{ user_id: 'u', matches_played: 0, wins: 0 }];
    db.user_badges = [{ id: 'x', user_id: 'u', badge_id: 'first_match', revoked_at: '2026-01-01T00:00:00Z' }];
    const r = await revokeRecordBadgesForUser('u');
    expect(r.revoked).toBe(0);
    expect(db.user_badges[0]!.revoked_at).toBe('2026-01-01T00:00:00Z');
  });

  it('keeps the badges that are still earned, summed across sports', async () => {
    db.user_sport_profiles = [
      { user_id: 'u', matches_played: 1, wins: 0 },
      { user_id: 'u', matches_played: 0, wins: 1 },
    ];
    db.user_badges = ['first_match', 'first_win', 'ten_matches'].map((b, i) => ({ id: `ub${i}`, user_id: 'u', badge_id: b }));
    await revokeRecordBadgesForUser('u');
    expect(active()).toEqual(['first_match', 'first_win']);
  });

  it('never touches another user', async () => {
    db.user_sport_profiles = [{ user_id: 'u', matches_played: 0, wins: 0 }];
    db.user_badges = [{ id: 'x', user_id: 'other', badge_id: 'first_match' }];
    await revokeRecordBadgesForUser('u');
    expect(db.user_badges[0]!.revoked_at).toBeUndefined();
  });

  it('revokes nothing when the totals cannot be read (SC-396 rule)', async () => {
    db.failProfiles = true;
    db.user_badges = [{ id: 'x', user_id: 'u', badge_id: 'first_match' }];
    const r = await revokeRecordBadgesForUser('u');
    expect(r.revoked).toBe(0);
    expect(db.user_badges[0]!.revoked_at).toBeUndefined();
  });
});

describe('V042 · soft revoke everywhere badges are read', () => {
  const b = code('controllers/badges.controller.ts');
  it('no badge row is ever deleted', () => {
    expect(b).not.toMatch(/from\('user_badges'\)[\s\S]{0,120}\.delete\(\)/);
  });
  it('the badge grid and count ignore revoked rows', () => {
    expect(b).toMatch(/\.eq\('user_id', id\)\s*\.is\('revoked_at', null\)/);
  });
  it('re-earning clears revoked_at on the existing row', () => {
    expect(b).toMatch(/update\(\{ revoked_at: null, revoke_reason: null \}\)/);
    expect(b).toMatch(/const earnedIds = new Set\(\(rows \|\| \[\]\)\.filter\(\(e\) => !e\.revoked_at\)/);
  });
});

describe('V042 · wired into void and restore', () => {
  const m = code('controllers/matches.controller.ts');
  it('void revokes for every player whose record moved', () => {
    expect(m).toMatch(/applyRecordDeltas\(match\.sport_id, deltas, -1\)[\s\S]{0,2000}revokeRecordBadgesSafe\(d\.user_id\)/);
  });
  it('restore re-awards', () => {
    expect(m).toMatch(/applyRecordDeltas\(match\.sport_id, deltas, 1\)[\s\S]{0,1200}awardBadgesSafe\(d\.user_id\)/);
  });
});

describe('N1 · a voided match cannot be completed', () => {
  const m = code('controllers/matches.controller.ts');
  const start = m.indexOf('export async function completeMatch');
  const complete = m.slice(start, m.indexOf('export async function', start + 10));
  it('loads voided_at with the match', () => {
    expect(complete).toMatch(/\.select\('[^']*voided_at'\)/);
  });
  it('refuses with 409 MATCH_VOIDED before anything is written', () => {
    expect(complete).toMatch(/match\.voided_at && match\.status !== 'completed'[\s\S]{0,200}409[\s\S]{0,200}MATCH_VOIDED/);
    expect(complete.indexOf('MATCH_VOIDED')).toBeLessThan(complete.indexOf('.update('));
  });
});

describe('V041/V211 · voided matches leave every rating-history read', () => {
  const reads: Array<[string, RegExp]> = [
    ['controllers/users.controller.ts', /getRatingHistory[\s\S]*?\.from\('rating_history'\)[\s\S]{0,200}matches!inner\(id, voided_at\)[\s\S]{0,200}\.is\('match\.voided_at', null\)/],
    ['controllers/insights.controller.ts', /\.from\('rating_history'\)\s*\.select\('new_rating, match:matches!inner\(voided_at\)'\)[\s\S]{0,80}\.is\('match\.voided_at', null\)/],
    ['controllers/seasons.controller.ts', /\.from\('rating_history'\)\s*\.select\('id, match:matches!inner\(voided_at\)'[\s\S]{0,200}\.is\('match\.voided_at', null\)/],
    ['controllers/notifications.controller.ts', /\.from\('rating_history'\)\s*\.select\('delta, match:matches!inner\(voided_at\)'\)[\s\S]{0,80}\.is\('match\.voided_at', null\)/],
  ];
  it.each(reads)('%s', (file, re) => {
    expect(code(file)).toMatch(re);
  });
  it('the rating-history response keeps its old shape (no nested match)', () => {
    expect(code('controllers/users.controller.ts')).toMatch(/\.map\(\(\{ match: _m, \.\.\.row \}: any\) => row\)/);
  });
  it('the weekly digest skips voided matches in matches_played', () => {
    expect(code('controllers/notifications.controller.ts')).toMatch(/m\.status !== 'completed' \|\| m\.voided_at/);
  });
});

describe('V007 · reminders only for a match that has not started', () => {
  it('the app-open path', () => {
    expect(code('controllers/users.controller.ts')).toMatch(/if \(m\.status !== 'scheduled' \|\| m\.voided_at\) return false;/);
  });
  it('the 5-minute sweep', () => {
    const f = code('controllers/features.controller.ts');
    const sweep = f.slice(f.indexOf('export async function runMatchReminderSweep'));
    expect(sweep).toMatch(/\.eq\('status', 'scheduled'\)\s*\.is\('voided_at', null\)/);
    expect(sweep.slice(0, 800)).not.toMatch(/'live'/);
  });
});

describe('V008 · the rating notification shows whole numbers that add up', () => {
  const m = code('controllers/matches.controller.ts');
  it('rounds both ends and reports their difference', () => {
    expect(m).toMatch(/const shownOld = Math\.round\(Number\(row\.old_rating\)\);/);
    expect(m).toMatch(/const shownDelta = shownNew - shownOld;/);
    expect(m).toMatch(/rating changed: \$\{shownOld\} \\u2192 \$\{shownNew\} \(\$\{sign\}\$\{shownDelta\}\)/);
  });
});

describe('V074/V254 · coins: one transaction, floored, and the row names the match', () => {
  it('awardCoins goes through award_coin_event and falls back only when it is missing or fails', () => {
    const c = code('utils/coins.ts');
    expect(c).toMatch(/rpc\('award_coin_event'/);
    expect(c).toMatch(/PGRST202/);
    expect(c.indexOf("rpc('award_coin_event'")).toBeLessThan(c.indexOf(".from('coin_events')"));
  });
  it('migration 096 clamps a clawback to the balance under a row lock', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '096_atomic_coin_award.sql'), 'utf8');
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/-LEAST\(-p_coins, GREATEST\(v_balance, 0\)\)/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, event_type\) DO NOTHING/);
  });
  it('the void row says "taken back" and which match', () => {
    const w = code('utils/winCoins.ts');
    expect(w).toMatch(/`Win coins taken back · \$\{label\}`/);
    expect(w).not.toMatch(/win coins returned/);
  });
});
