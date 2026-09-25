/**
 * F-08 (MATCH_CREATE_TEST_PLAN): a full pickup trapped its players, a live or
 * abandoned match took joiners, and every joiner went to side A.
 * The rules live in join_open_match (migration 095) with a guard in the
 * controllers; both are asserted here.
 */
import fs from 'fs';
import path from 'path';

const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
const sql = read('supabase/migrations/095_pickup_join_sides.sql');
const fnBody = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION join_open_match'));
const code = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const matches = read('src/controllers/matches.controller.ts');
const join = matches.slice(matches.indexOf('export async function joinOpenMatch'), matches.indexOf('\nexport ', matches.indexOf('export async function joinOpenMatch') + 10));

describe('F-08 · join_open_match (095)', () => {
  test('a full pickup stays a pickup: is_open is never set false', () => {
    expect(code(fnBody)).not.toMatch(/is_open\s*=/);
    expect(code(fnBody)).toMatch(/SET players_needed = v_needed,\s*updated_at = now\(\)/);
  });
  test('only a scheduled match is joinable ("started" otherwise)', () => {
    expect(code(fnBody)).toMatch(/IF v_status <> 'scheduled' THEN\s*RETURN QUERY SELECT 'started'/);
  });
  test('each joiner goes to the smaller side, A on a tie', () => {
    expect(code(fnBody)).toContain("COUNT(*) FILTER (WHERE team_side = 'A'), COUNT(*) FILTER (WHERE team_side = 'B')");
    expect(code(fnBody)).toContain("CASE WHEN v_b < v_a THEN 'B' ELSE 'A' END");
    expect(code(fnBody)).not.toMatch(/VALUES \(p_match_id, p_user_id, 'A'\)/);
  });
  test('the row lock is still taken first (SC-59)', () => {
    expect(code(fnBody).indexOf('FOR UPDATE')).toBeLessThan(code(fnBody).indexOf('INSERT INTO match_participants'));
  });
});

describe('F-08 · controllers', () => {
  test('joinOpenMatch refuses a match that is not scheduled, before the RPC', () => {
    const guard = join.indexOf("policyRow && policyRow.status !== 'scheduled'");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(join.indexOf("supabase.rpc('join_open_match'"));
    expect(join).toContain("case 'started':");
  });
  test('the approval path maps "started" too', () => {
    expect(read('src/controllers/matchJoinRequests.controller.ts')).toContain("case 'started':");
  });
  test('the inactive-user nudge only points at a pickup with a slot', () => {
    const f = read('src/controllers/features.controller.ts');
    const q = f.slice(f.indexOf(".select('id, team_a_name, venue, city_id')"));
    expect(q.slice(0, 400)).toContain(".gt('players_needed', 0)");
  });
});
