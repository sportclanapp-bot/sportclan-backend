/**
 * Phase 4 · K1 — migrations proven on a real Postgres (PGlite, in-process), the
 * same way as migration098Trigger.unit.test.ts: phase4K1Migrations.mjs runs the
 * SQL files verbatim in a child process and prints PASS/FAIL per assertion.
 */
import { spawnSync } from 'child_process';
import path from 'path';

const run = () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'phase4K1Migrations.mjs')], { encoding: 'utf8', timeout: 120000 });
  return { out: `${r.stdout}\n${r.stderr}`, status: r.status };
};
const { out, status } = run();
const line = (label: string) => out.split('\n').find((l) => l.endsWith(label) || l.includes(`${label} (got`)) ?? `MISSING ${label}`;

describe('K1 migrations on PGlite', () => {
  it('the script ran to the end', () => {
    expect(status).toBe(0);
    expect(out).not.toMatch(/^FAIL /m);
  });
  it('K1-13 (7b64be8): 025 adds tournaments.city as text, and a typed city name is stored', () => {
    expect(line('025 adds tournaments.city as text')).toMatch(/^PASS /);
    expect(line('a typed city name is stored')).toMatch(/^PASS /);
  });
  it('K1-29a (1b1d38b): 030 deduct_coins_if_sufficient has a balance floor — NULL, not a negative balance', () => {
    for (const l of [
      '030 deducts when the balance covers it and returns the new balance',
      '030 returns NULL when the balance does not cover it',
      '030 never drives the balance below zero (balance still 2)',
      '030 allows spending exactly the whole balance',
    ]) expect(line(l)).toMatch(/^PASS /);
  });
});
