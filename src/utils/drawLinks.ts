/**
 * Stage 9 · T7 / T8 (Oct 2026) · draws linked to a main draw, every knockout
 * sport — events of the same tournament:
 *  - a QUALIFYING draw (settings.qualifying = { into, rounds }) stops after its
 *    rounds; each last-round winner goes into the main draw as a qualifier
 *    ("Q"); once they're all through it's complete (no champion), and the main
 *    draw can be made. Its last-round losers are the lucky losers ("LL") the
 *    organiser can put in for a withdrawal.
 *  - a CONSOLATION draw (settings.consolation = { from, kind }) fills itself
 *    with the main draw's first-round losers, or each player's first-match
 *    losers (a bye's winner who then loses); the organiser makes its draw.
 * Entries go straight in (approved): the organiser set the link, so the event
 * limits and the waitlist don't apply.
 */
import { supabase } from './supabase';
import { notifyUsers } from './notify';
import { settingsOf } from './tournamentSettings';
import { allRows } from './selectAll';

type T = { id: string; name: string | null; event_label?: string | null; parent_id: string | null; status: string | null; settings: unknown; fixtures_generated?: boolean };
type M = { id: string; tournament_id: string; round: number | null; next_match_id: string | null; winner_team_id: string | null; team_a_id: string | null; team_b_id: string | null; third_place?: boolean | null };

const COLS = 'id, name, event_label, parent_id, status, settings, fixtures_generated';
const nameOf = (t: T) => t.event_label || t.name || 'the draw';

/** The other events of the same tournament (the family, but not `t`). */
export async function siblingsOf(t: { id: string; parent_id: string | null }): Promise<T[]> {
  if (!t.parent_id) return [];
  const { data } = await supabase.from('tournaments').select(COLS).eq('parent_id', t.parent_id).neq('id', t.id);
  return (data ?? []) as T[];
}

/** Put a team into a draw (approved; `tag` Q / LL), unless it's already there. Returns whether it was added. */
export async function enterInto(tournamentId: string, teamId: string, tag: 'Q' | 'LL' | null): Promise<boolean> {
  const { data: had } = await supabase.from('tournament_entries').select('id, status').eq('tournament_id', tournamentId).eq('team_id', teamId).maybeSingle();
  if (had) {
    if ((had as { status: string }).status === 'approved') return false;
    await supabase.from('tournament_entries').update({ status: 'approved', ...(tag ? { entry_tag: tag } : {}) }).eq('id', (had as { id: string }).id);
    return true;
  }
  const { error } = await supabase.from('tournament_entries').insert({ tournament_id: tournamentId, team_id: teamId, status: 'approved', ...(tag ? { entry_tag: tag } : {}) });
  return !error;
}

/** A corrected result: take a team back out of a draw it was put in, while that draw isn't made (soft: withdrawn). */
async function takeOut(t: T, teamId: string, tag: 'Q' | null): Promise<void> {
  if (t.fixtures_generated) return;
  let q = supabase.from('tournament_entries').update({ status: 'withdrawn' }).eq('tournament_id', t.id).eq('team_id', teamId).eq('status', 'approved');
  q = tag ? q.eq('entry_tag', tag) : q.is('entry_tag', null);
  await q;
}

async function tell(teamId: string, title: string, body: string, tournamentId: string): Promise<void> {
  const { data } = await supabase.from('team_members').select('user_id').eq('team_id', teamId);
  const ids = [...new Set(((data ?? []) as Array<{ user_id: string | null }>).map((r) => r.user_id).filter((x): x is string => !!x))];
  if (ids.length) void notifyUsers(ids, { type: 'draw_moved', title, body, data: { tournamentId } });
}

/**
 * After a knockout match is decided: a qualifier goes through, a loser goes to
 * the consolation draw. Returns `final: true` when this was a qualifying
 * draw's last-round match (it crowns nobody — the caller stops there).
 */
export async function onKnockoutDecided(m: M): Promise<{ final: boolean }> {
  if (!m.winner_team_id || m.round == null) return { final: false };
  const { data: tRow } = await supabase.from('tournaments').select(COLS).eq('id', m.tournament_id).maybeSingle();
  const t = tRow as T | null;
  if (!t) return { final: false };
  const loser = m.winner_team_id === m.team_a_id ? m.team_b_id : m.winner_team_id === m.team_b_id ? m.team_a_id : null;

  // T8: a consolation draw fed by this one.
  for (const c of await siblingsOf(t)) {
    const link = settingsOf(c).consolation;
    if (!link || link.from !== t.id || !loser || c.fixtures_generated) continue;
    if (m.round === 1 || (link.kind === 'first_match' && m.round === 2)) await takeOut(c, m.winner_team_id, null); // re-decided: the winner plays on here
    let first = m.round === 1;
    if (!first && link.kind === 'first_match' && m.round === 2) {
      // A round-1 bye: the loser's round-1 match had no opponent.
      const { data: r1 } = await supabase.from('matches').select('team_a_id, team_b_id').eq('tournament_id', t.id).eq('round', 1).or(`team_a_id.eq.${loser},team_b_id.eq.${loser}`).maybeSingle();
      const row = r1 as { team_a_id: string | null; team_b_id: string | null } | null;
      first = !!row && (!row.team_a_id || !row.team_b_id);
    }
    if (first && (await enterInto(c.id, loser, null))) {
      await tell(loser, `Into the consolation draw · ${nameOf(c)}`, `You play on in ${nameOf(c)} — you’ll see the draw when it’s made.`, c.id);
    }
  }

  // T7: this is a qualifying draw — its last round puts the winner through.
  const q = settingsOf(t).qualifying;
  if (!q || m.next_match_id || m.third_place) return { final: false };
  const { data: mainRow } = await supabase.from('tournaments').select(COLS).eq('id', q.into).maybeSingle();
  const main = mainRow as T | null;
  if (main && loser) await takeOut(main, loser, 'Q'); // re-decided
  if (main && (await enterInto(main.id, m.winner_team_id, 'Q'))) {
    await tell(m.winner_team_id, `Qualified · ${nameOf(main)}`, `You’re through to the main draw of ${nameOf(main)}.`, main.id);
  }
  // All the last round decided: the qualifying draw is complete (no champion).
  const last = await allRows<{ status: string; winner_team_id: string | null }>(() => supabase.from('matches').select('status, winner_team_id')
    .eq('tournament_id', t.id).is('next_match_id', null).is('voided_at', null));
  if (last.length && last.every((x) => !!x.winner_team_id)) {
    await supabase.from('tournaments').update({ status: 'completed' }).eq('id', t.id);
  }
  return { final: true };
}

/** T7: the qualifying draws still to finish before this main draw can be made (their names). */
export async function qualifyingPending(t: { id: string; parent_id: string | null }): Promise<string[]> {
  return (await siblingsOf(t)).filter((s) => settingsOf(s).qualifying?.into === t.id && s.status !== 'completed').map(nameOf);
}

/** T7: the lucky losers of the qualifying draws into this main draw — final-round losers, not already in. */
export async function luckyLosers(t: { id: string; parent_id: string | null }): Promise<Array<{ team_id: string; name: string; from: string }>> {
  const out: Array<{ team_id: string; name: string; from: string }> = [];
  const { data: inMain } = await supabase.from('tournament_entries').select('team_id').eq('tournament_id', t.id).in('status', ['approved', 'pending']);
  const taken = new Set(((inMain ?? []) as Array<{ team_id: string }>).map((r) => r.team_id));
  for (const s of await siblingsOf(t)) {
    if (settingsOf(s).qualifying?.into !== t.id) continue;
    const last = await allRows<{ winner_team_id: string | null; team_a_id: string | null; team_b_id: string | null; team_a_name: string | null; team_b_name: string | null }>(() => supabase.from('matches')
      .select('winner_team_id, team_a_id, team_b_id, team_a_name, team_b_name').eq('tournament_id', s.id).is('next_match_id', null).is('voided_at', null).order('match_no'));
    for (const x of last) {
      if (!x.winner_team_id) continue;
      const l = x.winner_team_id === x.team_a_id ? { id: x.team_b_id, name: x.team_b_name } : { id: x.team_a_id, name: x.team_a_name };
      if (l.id && !taken.has(l.id)) out.push({ team_id: l.id, name: l.name ?? 'A player', from: nameOf(s) });
    }
  }
  return out;
}

/** T8: why a consolation draw can't be made yet (its main draw's feeding rounds not all decided), or null. */
export async function consolationWaiting(t: { id: string; parent_id: string | null; settings: unknown }): Promise<string | null> {
  const link = settingsOf(t).consolation;
  if (!link) return null;
  const { data: mainRow } = await supabase.from('tournaments').select(COLS).eq('id', link.from).maybeSingle();
  const main = mainRow as T | null;
  if (!main) return null;
  if (!main.fixtures_generated) return `Make the draw of ${nameOf(main)} first: its losers fill this one.`;
  const rounds = link.kind === 'first_match' ? [1, 2] : [1];
  const ms = await allRows<{ winner_team_id: string | null; team_a_id: string | null; team_b_id: string | null }>(() => supabase.from('matches')
    .select('winner_team_id, team_a_id, team_b_id').eq('tournament_id', main.id).in('round', rounds).is('group_label', null).is('voided_at', null));
  if (ms.some((x) => !x.winner_team_id && !!x.team_a_id && !!x.team_b_id)) return `Wait until ${link.kind === 'first_match' ? 'everyone has played a match' : 'the first round'} of ${nameOf(main)} is decided.`;
  return null;
}

/**
 * T7 / T8: a draw's link must be another event of the same tournament, a
 * knockout (and not linked back) — or null when it's fine.
 */
export async function drawLinkProblem(t: { id: string; parent_id: string | null }, settings: unknown): Promise<string | null> {
  const s = settingsOf({ settings });
  const target = s.qualifying?.into ?? s.consolation?.from;
  if (!target) return null;
  if (target === t.id) return 'A draw can’t feed itself.';
  const sib = (await siblingsOf(t)).find((x) => x.id === target);
  if (!sib) return 'Pick another event of this tournament as the main draw.';
  const { data: f } = await supabase.from('tournaments').select('format').eq('id', target).maybeSingle();
  if ((f as { format?: string } | null)?.format !== 'knockout') return 'The main draw is a knockout.';
  const back = settingsOf(sib);
  if (back.qualifying || back.consolation) return `${nameOf(sib)} is itself a qualifying or consolation draw.`;
  return null;
}
