/**
 * Decision 27 Sep 2026 · voiding a final clears the champion; restoring it
 * crowns the winner again. (S5 KO Cup still named Smoke Tigers after its final
 * was voided.)
 */
import fs from 'fs';
import path from 'path';

type Row = Record<string, any>;
const db: { tournaments: Row[]; matches: Row[] } = { tournaments: [], matches: [] };
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let lim = Infinity;
    const run = () => {
      const rows = (db as any)[table].filter((r: Row) => filters.every((f) => f(r))).slice(0, lim);
      if (patch) for (const r of rows) Object.assign(r, patch);
      return rows;
    };
    const q: any = {
      select: () => q,
      update: (p: Row) => { patch = p; return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: null) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      not: (c: string, _op: string, v: null) => { filters.push((r) => (r[c] ?? null) !== v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      order: () => q,
      limit: (n: number) => { lim = n; return q; },
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: run(), error: null }),
    };
    return q;
  };
  return { supabase: { from } };
});
// eslint-disable-next-line import/first
import { recrownAfterVoidChange } from '../controllers/tournaments.controller';

const T = 't1', FINAL = 'f1', SEMI = 's1', TIGERS = 'tigers', B = 'tigersB';
beforeEach(() => {
  db.tournaments = [{ id: T, status: 'completed', format: 'knockout', champion_team_id: TIGERS }];
  db.matches = [
    { id: SEMI, tournament_id: T, next_match_id: FINAL, group_label: null, status: 'completed', winner_team_id: TIGERS, voided_at: null, round: 1 },
    { id: FINAL, tournament_id: T, next_match_id: null, group_label: null, status: 'completed', winner_team_id: TIGERS,
      team_a_id: TIGERS, team_b_id: B, team_a_name: 'Smoke Tigers', team_b_name: 'Smoke Tigers B', voided_at: null, round: 2 },
  ];
});

describe('voiding a final un-crowns; restoring re-crowns', () => {
  it('a voided final clears champion_team_id (the tournament stays completed)', async () => {
    db.matches[1]!.voided_at = '2026-09-27T10:00:00Z';
    await recrownAfterVoidChange(FINAL);
    expect(db.tournaments[0]).toMatchObject({ champion_team_id: null, status: 'completed' });
  });
  it('restoring the final crowns its winner again', async () => {
    db.tournaments[0]!.champion_team_id = null;
    await recrownAfterVoidChange(FINAL);
    expect(db.tournaments[0]!.champion_team_id).toBe(TIGERS);
  });
  it('voiding an earlier round changes nothing', async () => {
    db.matches[0]!.voided_at = '2026-09-27T10:00:00Z';
    await recrownAfterVoidChange(SEMI);
    expect(db.tournaments[0]!.champion_team_id).toBe(TIGERS);
  });
  it('a tournament that is not completed is left alone', async () => {
    db.tournaments[0]!.status = 'live';
    db.matches[1]!.voided_at = 'x';
    await recrownAfterVoidChange(FINAL);
    expect(db.tournaments[0]!.champion_team_id).toBe(TIGERS);
  });
});

describe('wired into void and restore', () => {
  const m = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
  it('both paths call it', () => {
    expect((m.match(/if \(match\.tournament_id\) await recrownAfterVoidChange\(id\);/g) ?? []).length).toBe(2);
  });
});
