/**
 * SC-359 · team capacity — removed (Oct 2026, Dipak: no app-imposed caps on
 * quantities). A team has no member cap: joining, a captain's add and the
 * team page never say "full". (The sport's players-a-side still applies to
 * each match's line-up.)
 */
import * as fs from 'fs';
import * as path from 'path';

const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'teams.controller.ts'), 'utf8');

describe('SC-359 · no team member cap (Oct 2026)', () => {
  it('no capacity rule, no "team is full"', () => {
    expect(src).not.toMatch(/TEAM_MAX_MEMBERS|isAtCapacity|TEAM_FULL|This team is full/);
  });
  it('the team page is never full and sends no max_members', () => {
    expect(src).toContain('(team as { is_full?: boolean }).is_full = false;');
    expect(src).not.toContain('max_members =');
  });
});
