/**
 * Audit #62 (11 Oct 2026): when a Swiss round couldn't pair cleanly, every rule
 * was dropped at once, so a rematch could be chosen when dropping the colour
 * rule alone would do. Rules are now relaxed one at a time (FIDE order).
 * Property over 4,000 random fields: whenever a rematch-free round exists, the
 * round made has no rematch. (The old code failed seeds 33, 69 and 79.)
 */
import { dutchRound, dutchHistory } from '../utils/swissDutch';

function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }

describe('audit #62: no rematch when a rematch-free round exists', () => {
  it('holds over 4,000 random fields (4–8 players, 2–4 rounds played, colours on)', () => {
    const bad: number[] = [];
    for (let seed = 1; seed < 4000; seed++) {
      const r = rng(seed); const n = 4 + 2 * Math.floor(r() * 3); const ids = Array.from({ length: n }, (_, i) => `P${i}`);
      const rows: Array<{ round: number; white: string; black: string; bye: boolean; byeKind: null; forfeit: boolean; winner: string }> = [];
      const pts = new Map(ids.map((id) => [id, 0]));
      const rounds = 2 + Math.floor(r() * 3);
      for (let rd = 1; rd <= rounds; rd++) {
        const sh = ids.slice().sort(() => r() - 0.5);
        for (let i = 0; i < sh.length; i += 2) { const w = r() < 0.5 ? sh[i]! : sh[i + 1]!; rows.push({ round: rd, white: sh[i]!, black: sh[i + 1]!, bye: false, byeKind: null, forfeit: false, winner: w }); pts.set(w, pts.get(w)! + 1); }
      }
      const history = dutchHistory(ids, rows, (id) => pts.get(id) ?? 0);
      const res = dutchRound({ players: ids, tpn: new Map(ids.map((id, i) => [id, i + 1])), points: pts, history, colours: true, lastRound: false, winPoints: 1, roundsPlayed: rounds });
      const played = new Set(rows.map((g) => [g.white, g.black].sort().join('-')));
      const rematch = res.pairs.some((p) => played.has([p.white, p.black].sort().join('-')));
      const free = (left: string[]): boolean => { if (!left.length) return true; const [a, ...rest] = left; return rest.some((b) => !played.has([a!, b].sort().join('-')) && free(rest.filter((x) => x !== b))); };
      if (rematch && free(ids)) bad.push(seed);
    }
    expect(bad).toEqual([]);
  });
});
