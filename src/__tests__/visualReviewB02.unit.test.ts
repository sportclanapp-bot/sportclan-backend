/**
 * Visual review B02 · a tournament's chat holds its people, and only them.
 *
 * V022 — "S5 Group Cup Chat" had one member, the organiser.
 * N2   — GET /tournaments/:id/chat added ANY signed-in caller as a member.
 * D7   — organisers (admins) + every player of an approved team; added on
 *        approval/join, removed on withdrawal/rejection/leaving.
 */
import fs from 'fs';
import path from 'path';
import { planChatSync } from '../utils/tournamentChat';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const aud = (organisers: string[], players: string[]) => ({ organisers: new Set(organisers), players: new Set(players) });

describe('D7 · the chat equals its audience', () => {
  it('adds every player of an approved team and every organiser', () => {
    const p = planChatSync(aud(['org'], ['p1', 'p2']), [{ user_id: 'org', role: 'admin' }]);
    expect(p.add).toEqual([{ user_id: 'p1', role: 'member' }, { user_id: 'p2', role: 'member' }]);
    expect(p.remove).toEqual([]);
  });
  it('removes people who no longer belong — a withdrawn team, a leaver, an outsider who opened it', () => {
    const p = planChatSync(aud(['org'], ['p1']), [
      { user_id: 'org', role: 'admin' }, { user_id: 'p1', role: 'member' }, { user_id: 'stranger', role: 'member' },
    ]);
    expect(p.remove).toEqual(['stranger']);
  });
  it('an organiser who also plays is an admin, and a member-organiser is promoted', () => {
    expect(planChatSync(aud(['o'], ['o']), []).add).toEqual([{ user_id: 'o', role: 'admin' }]);
    expect(planChatSync(aud(['o'], []), [{ user_id: 'o', role: 'member' }]).promote).toEqual(['o']);
  });
  it('is idempotent: a chat already in sync needs no change', () => {
    const p = planChatSync(aud(['o'], ['p']), [{ user_id: 'o', role: 'admin' }, { user_id: 'p', role: 'member' }]);
    expect(p).toEqual({ add: [], promote: [], remove: [] });
  });
});

describe('N2 · only the tournament’s people can open its chat', () => {
  const t = code('controllers/tournaments.controller.ts');
  const fn = t.slice(t.indexOf('export async function getTournamentChat'), t.indexOf('export async function', t.indexOf('export async function getTournamentChat') + 10));
  it('checks before anything else is returned, and no longer inserts the caller', () => {
    expect(fn).toMatch(/if \(!\(await canOpenTournamentChat\(id, userId\)\)\)[\s\S]{0,120}403[\s\S]{0,200}NOT_IN_TOURNAMENT/);
    expect(fn).not.toMatch(/insert\(\{ chat_id: chatId, user_id: userId, role: 'member' \}\)/);
  });
});

describe('D7 · every trigger re-syncs', () => {
  const t = code('controllers/tournaments.controller.ts');
  it.each(['directAddTeam', 'createEntry', 'updateEntry', 'addTournamentOrganiser', 'removeTournamentOrganiser', 'reassignTournamentOrganiser'])(
    'tournaments · %s', (fn) => {
      const i = t.indexOf(`export async function ${fn}(`);
      expect(t.slice(i, i + 600)).toContain('syncAfterSuccess(res, () => syncTournamentChatMembers(String(req.params.id)))');
    },
  );
  const teams = code('controllers/teams.controller.ts');
  it.each(['addTeamMember', 'removeTeamMember', 'decideJoinRequest'])('teams · %s', (fn) => {
    const i = teams.indexOf(`export async function ${fn}(`);
    expect(teams.slice(i, i + 600)).toContain('syncAfterSuccess(res, () => syncTournamentChatsForTeam(String(req.params.id)))');
  });
  it('teams · every instant join (by code, and D8 from the team page) goes through joinOpenTeam, which syncs', () => {
    const i = teams.indexOf('async function joinOpenTeam(');
    expect(teams.slice(i, teams.indexOf('export async function', i + 10))).toContain('void syncTournamentChatsForTeam(team.id as string)');
    const j = teams.indexOf('export async function joinTeamByCode(');
    expect(teams.slice(j, teams.indexOf('export async function', j + 10))).toContain('await joinOpenTeam(');
  });
  it('a sync after a failed read changes nothing (no removals on missing data)', () => {
    const u = code('utils/tournamentChat.ts');
    expect(u).toMatch(/if \(tRes\.error \|\| coRes\.error \|\| entRes\.error \|\| !tRes\.data\) return null;/);
    expect(u).toMatch(/if \(!audience\) return null;/);
  });
});

describe('N2 · the tournament tells the app whether this viewer may open the chat', () => {
  it('getTournament returns can_open_chat', () => {
    const t = code('controllers/tournaments.controller.ts');
    expect(t).toMatch(/const can_open_chat = req\.userId \? await canOpenTournamentChat\(String\(tournament\.id\), req\.userId\) : false;/);
    expect(t).toMatch(/res\.json\(\{ tournament, entries: entries \|\| \[\], can_open_chat \}\)/);
  });
});
