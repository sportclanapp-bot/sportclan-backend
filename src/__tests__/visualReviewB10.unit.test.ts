/**
 * Visual review B10 (backend) · teams.
 * V136/V153 (D8) — a public team with approval off joins from its page instantly.
 * V148 (D10)     — getTeam says whether the team can be disbanded.
 * V056           — "my teams" rows carry the viewer's role.
 * V146           — an empty expense ledger reports today's roster, not "1 member".
 */
import fs from 'fs';
import path from 'path';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const t = code('controllers/teams.controller.ts');
const fn = (name: string) => {
  const i = t.indexOf(`function ${name}(`);
  return t.slice(i, t.indexOf('\nexport ', i + 10));
};

describe('D8 · open public teams join from the team page', () => {
  it('requestToJoin reads join_policy and joins an open team', () => {
    const r = fn('requestToJoin');
    expect(r).toMatch(/select\('id, name, is_public, join_policy'\)/);
    expect(r).toMatch(/join_policy === 'open'[\s\S]{0,120}await joinOpenTeam\(/);
    expect(r).toMatch(/joined: true/);
  });
  it('an approval team still files a request', () => {
    expect(fn('requestToJoin')).toMatch(/createJoinRequest\(team\.id, userId, team\.name\)/);
  });
  it('both instant paths share every gate', () => {
    const j = fn('joinOpenTeam');
    expect(j).toMatch(/Already a member of this team/);
    expect(j).toMatch(/await joinGate\(team\.id, userId\)/);
    expect(j).toMatch(/BLOCKED_FROM_TEAM/);
  });
});

describe('D10 · can_disband', () => {
  it('is false when the team has a match or a tournament entry', () => {
    expect(fn('getTeam')).toMatch(/can_disband = \(matchCount \?\? 0\) === 0 && \(entryCount \?\? 0\) === 0/);
  });
});

describe('V056 · my teams carry my role', () => {
  it('listTeams attaches my_role from the membership rows', () => {
    const l = fn('listTeams');
    expect(l).toMatch(/\.select\('team_id, role'\)/);
    expect(l).toMatch(/my_role: myRoleByTeam\.get\(t\.id\)/);
  });
});

describe('V146 · an empty ledger uses the roster', () => {
  it('memberCount falls back to currentRoster when there are no expenses', () => {
    expect(code('controllers/teamExpenses.controller.ts')).toMatch(/rows\.length === 0 \? Math\.max\(1, \(await currentRoster\(id!\)\)\.length\) : sum\.memberCount/);
  });
});
