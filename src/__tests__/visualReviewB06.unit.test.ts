/**
 * Visual review B06 (backend) · a finished tournament names its champion and
 * stays finished.
 * V104 — the manual Complete path never set champion_team_id.
 * V109 — the bracket dropped voided_at and had no score for cricket/football.
 * N3   — a completed or cancelled tournament could be PATCHed back to live.
 */
import fs from 'fs';
import path from 'path';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const t = code('controllers/tournaments.controller.ts');
const fnBody = (name: string) => {
  const i = t.indexOf(`export async function ${name}(`);
  return t.slice(i, t.indexOf('\nexport ', i + 10));
};

describe('N3 · a finished tournament cannot be reopened', () => {
  const u = fnBody('updateTournament');
  it('refuses any status change out of completed or cancelled, before the auth split', () => {
    expect(u).toMatch(/\(tournament\.status === 'completed' \|\| tournament\.status === 'cancelled'\)[\s\S]{0,120}req\.body\.status !== tournament\.status[\s\S]{0,300}TOURNAMENT_FINISHED/);
    expect(u.indexOf('TOURNAMENT_FINISHED')).toBeLessThan(u.indexOf('isTerminalStatusChange'));
  });
});

describe('V104 · manual Complete crowns the champion', () => {
  const u = fnBody('updateTournament');
  it('computes and stores it on the completing update, then announces it', () => {
    expect(u).toMatch(/if \(update\.status === 'completed' && tournament\.status !== 'completed'\)[\s\S]{0,120}crownedChampion = await championOf\(id\)/);
    expect(u).toMatch(/update\.champion_team_id = crownedChampion\.id/);
    expect(u).toMatch(/notifyTournamentChampion\(id, crownedChampion\.id/);
  });
  it('championOf uses the same rules as the automatic crowning', () => {
    const c = fnBody('championOf');
    expect(c).toMatch(/fmt === 'round_robin' \|\| fmt === 'league'[\s\S]*rankTeams\(/);
    expect(c).toMatch(/\.is\('next_match_id', null\)\s*\.is\('group_label', null\)\s*\.eq\('status', 'completed'\)\s*\.is\('voided_at', null\)/);
  });
});

describe('V109 · the bracket carries the score and the void', () => {
  const b = fnBody('getBracket');
  it('voided_at reaches the response', () => expect(b).toMatch(/voided_at: \(m as any\)\.voided_at \?\? null/));
  it('cricket runs and football goals count as the score', () => {
    expect(b).toMatch(/score_a: ss\.team_a_score \?\? ss\?\.A\?\.score \?\? ss\?\.A\?\.runs \?\? ss\.goals_a \?\? null/);
  });
});
