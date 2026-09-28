/**
 * Phase 4 · K1 · migrations 042 (dm_key backfill) and 044 (users.deleted_at),
 * run verbatim on PGlite by phase4K1F2Migrations.mjs in a child process.
 */
import { spawnSync } from 'child_process';
import path from 'path';

const run = () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'phase4K1F2Migrations.mjs')], { encoding: 'utf8', timeout: 120000 });
  return { out: `${r.stdout}\n${r.stderr}` };
};

describe('K1 migrations on a real Postgres', () => {
  const { out } = run();
  it('K1-51 (c99a62d): 042 backfills dm_key without MIN(uuid), byte-identical to the JS key', () => {
    const lines = out.split('\n').filter((l) => / 042/.test(l));
    expect(lines.filter((l) => l.startsWith('FAIL '))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('PASS ')).length).toBe(6);
  });
  it('K1-55 (915f70f): 044 adds public.users.deleted_at so the account-delete UPDATE works', () => {
    const lines = out.split('\n').filter((l) => / 044: /.test(l));
    expect(lines.filter((l) => l.startsWith('FAIL '))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('PASS ')).length).toBe(3);
  });
});
