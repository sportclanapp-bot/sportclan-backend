/**
 * Stage 14 · the volleyball tournament journey on the server: the FIVB table
 * order (VB5), how a point was won and basketball's stats on the boards (VB8),
 * the timeline's new lines (VB1 / VB2 / VB3 / VB7 / VB12), each sport's extra
 * officials (VB10), women on court (VB11) and the new rules (VB2 / VB4 / VB12).
 */
import { rankTeams } from '../utils/standings';
import { tiebreakPresetsFor, tiebreakLabel, tiebreaksFor, categoryRefusal, categoryLabel, womenOnCourtProblem, storedCategory } from '../utils/tournamentSettings';
import { sportCommentary } from '../utils/commentary';
import { aggregateRallyPlayers, aggregatePointPlayers } from '../controllers/scoring.controller';
import { sportBoards } from '../utils/sportLeaders';
import { sportTerms as termsFor } from '../utils/sportTerms';
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';

/** sets: each set's points ([25, 20] = A won 25-20). */
const vb = (id: string, a: string, b: string, sets: Array<[number, number]>) => {
  const sa = sets.filter(([x, y]) => x > y).length; const sb = sets.length - sa;
  return { id, team_a_id: a, team_b_id: b, winner_team_id: sa > sb ? a : b, status: 'completed', score_summary: { A: { score: sa, sets: sets.map((s) => s[0]) }, B: { score: sb, sets: sets.map((s) => s[1]) } } } as any;
};
const won = (n: number, lost = 0, w: [number, number] = [25, 20], l: [number, number] = [20, 25]): Array<[number, number]> => [...Array.from({ length: lost }, () => l), ...Array.from({ length: n }, () => w)];
const FIVB_POINTS = { win: 3, draw: 1.5, loss: 0, noResult: null, walkoverWin: null, walkoverLoss: null, sets: { straight: [3, 0], decider: [2, 1] } } as never;

describe('VB5 · the FIVB table order', () => {
  // X wins three, all 3-2 (6 points); Y wins two 3-0 and loses 2-3 to X (7 points).
  const m = [vb('1', 'X', 'Z', won(3, 2)), vb('2', 'X', 'W', won(3, 2)), vb('3', 'X', 'Y', won(3, 2)), vb('4', 'Y', 'Z', won(3)), vb('5', 'Y', 'W', won(3))];
  it('points first (the standard): Y; FIVB full — matches won first: X', () => {
    expect(rankTeams(['X', 'Y', 'Z', 'W'], m, ['head_to_head'], FIVB_POINTS).slice(0, 2)).toEqual(['Y', 'X']);
    const full = tiebreakPresetsFor('volleyball').find((p) => p.key === 'fivb_full')!;
    expect(full.order).toEqual(['wins', 'match_points', 'score_ratio', 'points_ratio', 'head_to_head']);
    expect(rankTeams(['X', 'Y', 'Z', 'W'], m, full.order, FIVB_POINTS).slice(0, 2)).toEqual(['X', 'Y']);
  });
  it('the overall points ratio splits a tie on wins, points and set ratio', () => {
    // P and Q each beat R and S 3-0; P's sets were closer to lose? No — P won every set 25-23, Q 25-10.
    const t = [vb('1', 'P', 'R', won(3, 0, [25, 23])), vb('2', 'P', 'S', won(3, 0, [25, 23])), vb('3', 'Q', 'R', won(3, 0, [25, 10])), vb('4', 'Q', 'S', won(3, 0, [25, 10])), vb('5', 'R', 'S', won(3))];
    expect(rankTeams(['P', 'Q', 'R', 'S'], t, ['wins', 'match_points', 'score_ratio', 'points_ratio'], FIVB_POINTS).slice(0, 2)).toEqual(['Q', 'P']);
  });
  it('the ratios preset for badminton, table tennis and pickleball pools; the words', () => {
    for (const s of ['badminton', 'table-tennis', 'pickleball']) expect(tiebreakPresetsFor(s).some((p) => p.key === 'ratios')).toBe(true);
    expect(tiebreaksFor('volleyball')).toEqual(expect.arrayContaining(['points_ratio', 'match_points']));
    expect(tiebreaksFor('football')).not.toContain('points_ratio');
    expect(tiebreakLabel('volleyball', 'points_ratio')).toBe('Points ratio');
    expect(tiebreakLabel('volleyball', 'match_points')).toBe('Match points (the table’s points)');
  });
});

describe('VB8 · how a point was won, and basketball’s stats', () => {
  it('counted per player; the boards list the ways said', () => {
    const evs = [
      { event_type: 'score', payload: { team_side: 'A', kind: 'point', value: 1, how: 'attack', player_id: 'u1', player_name: 'Ravi' } },
      { event_type: 'score', payload: { team_side: 'A', kind: 'point', value: 1, how: 'attack', player_id: 'u1', player_name: 'Ravi' } },
      { event_type: 'score', payload: { team_side: 'A', kind: 'point', value: 1, how: 'block', player_id: 'u2', player_name: 'Sana' } },
      { event_type: 'score', payload: { team_side: 'A', kind: 'ace', value: 2, super_serve: true, player_id: 'u2', player_name: 'Sana' } },
    ];
    const players = aggregateRallyPlayers(evs);
    expect(players.u1).toMatchObject({ points: 2, how_attack: 2 });
    expect(players.u2).toMatchObject({ points: 3, how_block: 1, how_ace: 1 });
    const boards = sportBoards('volleyball', [{ id: 'm1', team_a_id: 'T', team_b_id: 'U', winner_team_id: 'T', score_summary: { players } as never }], { T: 'Kings', U: 'Hawks' });
    expect(boards.map((b) => b.title)).toEqual(['Most wins', 'Top scorers', 'Attack points', 'Block points', 'Aces', 'Sets won', 'Points difference']);
    expect(boards.find((b) => b.title === 'Aces')!.rows[0]).toMatchObject({ name: 'Sana', value: 1 });
  });
  it('basketball: rebounds, steals, blocks on the scorecard and the boards (only once someone has one)', () => {
    const evs = [
      { event_type: 'note', payload: { team_side: 'A', kind: 'stat', stat: 'rebound', player_id: 'u1', player_name: 'Ravi' } },
      { event_type: 'note', payload: { team_side: 'A', kind: 'stat', stat: 'rebound', player_id: 'u1', player_name: 'Ravi' } },
      { event_type: 'note', payload: { team_side: 'A', kind: 'stat', stat: 'steal', player_id: 'u1', player_name: 'Ravi' } },
      { event_type: 'score', payload: { team_side: 'A', kind: '2pt', value: 2, player_id: 'u1', player_name: 'Ravi' } },
    ];
    const players = aggregatePointPlayers(evs);
    expect(players.u1).toMatchObject({ points: 2, rebounds: 2, steals: 1 });
    expect(players.u1!.blocks).toBeUndefined();
    const titles = sportBoards('basketball', [{ id: 'm1', team_a_id: 'T', team_b_id: 'U', winner_team_id: 'T', score_summary: { players } as never }], { T: 'Kings', U: 'Hawks' }).map((b) => b.title);
    expect(titles).toEqual(['Top scorers', 'Assists', 'Rebounds', 'Steals']);
  });
});

describe('the timeline', () => {
  const ctx = { sport: 'volleyball', teamA: 'Kings', teamB: 'Hawks', period: 1, move: 0, clockSeconds: null, regulation: 5, periodMinutes: null } as never;
  const say = (t: string, p: Record<string, unknown>) => sportCommentary(t, p, ctx);
  it('VB1 / VB7 / VB12: line-ups, the libero, positional faults, Super Point and Super Serve', () => {
    expect(say('note', { kind: 'rotation', team_side: 'A', set: 2, slots: [{ name: 'Ravi' }, { name: 'Sana' }], liberos: [{ name: 'Libby' }] })).toBe('📋 Kings line-up for set 2: I Ravi, II Sana · libero Libby');
    expect(say('note', { kind: 'libero', team_side: 'B', libero: { name: 'Libby' }, replaced: { name: 'Arjun' } })).toBe('🔄 Libero Libby in for Arjun — Hawks');
    expect(say('note', { kind: 'libero', team_side: 'B', out: true })).toBe('🔄 Libero off — Hawks');
    expect(say('score', { team_side: 'B', kind: 'fault', fault: 'positional', by: 'A', value: 1 })).toBe('🔢 Positional fault by Kings — point to Hawks');
    expect(say('note', { kind: 'super_point', team_side: 'A' })).toBe('⚡ Super Point called — Kings');
    expect(say('score', { team_side: 'B', kind: 'point', value: 2, super_point: true })).toBe('⚡ Super Point won — Point to Hawks (+2)');
    expect(say('score', { team_side: 'A', kind: 'ace', value: 2, super_serve: true, player_name: 'Ravi' })).toBe('🎯 Super Serve — an ace by Ravi (Kings), +2');
  });
  it('VB8: how it was won; an opponent’s error', () => {
    expect(say('score', { team_side: 'A', kind: 'point', value: 1, how: 'block', player_name: 'Sana' })).toBe('Point to Kings — block by Sana');
    expect(say('score', { team_side: 'A', kind: 'point', value: 1, how: 'error' })).toBe('Point to Kings — Hawks error');
  });
  it('VB2: volleyball and basketball subs, and an injury substitution', () => {
    expect(say('sub', { team_side: 'A', player_name: 'Sub', off_name: 'Ravi' })).toBe('🔁 Kings: Sub on for Ravi');
    expect(say('sub', { team_side: 'A', player_name: 'Sub', off_name: 'Ravi', injury: true })).toBe('🩹 Injury sub — Kings: Sub on for Ravi');
    expect(sportCommentary('sub', { team_side: 'B', player_name: 'Neha', off_name: 'Om' }, { ...(ctx as object), sport: 'basketball' } as never)).toBe('🔁 Hawks: Neha on for Om');
    expect(sportCommentary('note', { team_side: 'B', kind: 'stat', stat: 'block', player_name: 'Neha' }, { ...(ctx as object), sport: 'basketball' } as never)).toBe('🏀 Block — Neha (Hawks)');
  });
});

describe('VB10 · each sport’s extra officials', () => {
  it('scorers and reserves', () => {
    expect(termsFor('volleyball').assistants.map((a) => a.label)).toEqual(['Second referee', 'Line judge', 'Scorer', 'Assistant scorer', 'Challenge referee', 'Reserve referee']);
    expect(termsFor('basketball').assistants.map((a) => a.key)).toEqual(expect.arrayContaining(['scorer', 'assistant_scorer', 'timer', 'shot_clock_operator']));
    expect(termsFor('hockey').assistants.map((a) => a.key)).toEqual(expect.arrayContaining(['judge', 'reserve_umpire']));
    expect(termsFor('cricket').assistants.map((a) => a.key)).toContain('fourth_umpire');
    expect(termsFor('football').assistants.map((a) => a.key)).toContain('reserve_assistant_referee');
    expect(termsFor('badminton').assistants.map((a) => a.key)).toContain('reserve_umpire');
  });
});

describe('VB11 · women on court', () => {
  it('a number, 1 or more; not in a men’s or women’s event; said in the category', () => {
    expect(categoryRefusal({ gender: 'mixed', minWomen: 2 })).toBeNull();
    expect(categoryRefusal({ minWomen: 2 })).toBeNull();
    expect(categoryRefusal({ gender: 'men', minWomen: 2 })).not.toBeNull();
    expect(categoryRefusal({ gender: 'mixed', minWomen: 0 })).not.toBeNull();
    expect(storedCategory({ gender: 'mixed', minWomen: 2 })).toEqual({ gender: 'mixed', minWomen: 2 });
    expect(categoryLabel({ gender: 'mixed', minWomen: 2 })).toBe('Mixed · At least 2 women on court');
  });
  it('the starters: too few women is refused, naming the team; a profile without a gender isn’t counted', () => {
    const c = { gender: 'mixed' as const, minWomen: 2 };
    expect(womenOnCourtProblem(c, [{ gender: 'female' }, { gender: 'female' }, { gender: 'male' }], 'Kings')).toBeNull();
    expect(womenOnCourtProblem(c, [{ gender: 'female' }, { gender: 'male' }, { gender: null }], 'Kings')).toBe('Kings have 1 woman starting — this event needs at least 2 on court. One profile doesn’t list a gender, so it isn’t counted.');
    expect(womenOnCourtProblem({ gender: 'mixed' }, [{ gender: 'male' }], 'Kings')).toBeNull();
  });
});

describe('VB2 / VB4 / VB12 · the new rules', () => {
  it('subs per sport, the beach, the PVL', () => {
    expect(standardRules('volleyball')).toMatchObject({ maxSubs: 6, subsPer: 'set', reentry: 'same_spot', liberos: 2, superPoint: false, superServe: false });
    expect(standardRules('basketball')).toMatchObject({ maxSubs: null, subsPer: 'match', reentry: 'free' });
    expect(rulesRefusal('hockey', { maxSubs: 10 })).toBeNull();
    expect(rulesRefusal('hockey', { subsPer: 'set' })?.field).toBe('subsPer');
    expect(rulesRefusal('volleyball', { subsPer: 'period' })?.field).toBe('subsPer');
    expect(rulesRefusal('volleyball', { reentry: 'sometimes' })?.field).toBe('reentry');
    expect(rulesRefusal('tennis', { maxSubs: 3 })?.field).toBe('maxSubs');
    expect(rulesRefusal('volleyball', { sideSwitchEvery: 0 })?.field).toBe('sideSwitchEvery');
    expect(timedRulesLabel('volleyball', { ...standardRules('volleyball'), target: 15, cap: 21, superPoint: true, superServe: true })).toBe('sets to 15 · cap 21 · Super Point before 11 · Super Serve (an ace is 2)');
    expect(timedRulesLabel('hockey', { ...standardRules('hockey'), maxSubs: 4 })).toBe('4 subs');
  });
});
