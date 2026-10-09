/**
 * Tournament officials: the role list matches the database. OFFICIAL_ROLES also
 * offered 'organiser', which migration 036's CHECK refuses, so an organiser
 * passed the role check and then 500'd on the insert. It must be a clean 400
 * before any query runs.
 */
import fs from 'fs';
import path from 'path';

const mockFrom = jest.fn();
jest.mock('../utils/supabase', () => ({ supabase: { from: (...a: unknown[]) => mockFrom(...a), rpc: jest.fn() } }));
jest.mock('../utils/notify', () => ({ notifyUnlessBlocked: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { addTournamentOfficial, OFFICIAL_ROLES } from '../controllers/features.controller';

const T = '22222222-2222-4222-8222-222222222222';
const PERSON = '55555555-5555-4555-8555-555555555555';

const call = async (body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await addTournamentOfficial({ userId: 'me', params: { id: T }, query: {}, body } as any, r);
  return r;
};

/** The roles the latest tournament_officials.role CHECK allows. */
function dbRoles(): string[] {
  const dir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
  let roles: string[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/tournament_officials/.test(sql)) continue;
    const m = [...sql.matchAll(/CHECK\s*\(\s*role\s+IN\s*\(([^)]*)\)/gi)].pop();
    if (m) roles = [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
  }
  return roles;
}

describe('tournament official roles', () => {
  beforeEach(() => mockFrom.mockReset());

  it('the API offers exactly the roles the database CHECK allows', () => {
    expect(dbRoles().length).toBeGreaterThan(0);
    expect([...OFFICIAL_ROLES].sort()).toEqual(dbRoles().sort());
  });

  it("'organiser' is refused with a 400 naming the allowed roles, before any query", async () => {
    const r = await call({ user_id: PERSON, role: 'organiser' });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('role must be one of: umpire, referee, scorer, commentator, assistant, chief_referee, deputy_referee, pairings, sector, fair_play'); // Stage 10 · TT12 · Stage 12 · CH11
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
