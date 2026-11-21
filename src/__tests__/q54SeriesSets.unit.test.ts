/**
 * Q54 (Dipak, 21 Nov 2026: A) · N-R7-S37: a volleyball league played as best-of-3 series counts every
 * set inside the games in the table's set columns (7–5 here), not the games (2–1); points stay 2 / 1.
 */
import { computeStats, type GMatch } from "../utils/standings";

const series = (winner: string): GMatch => ({
  team_a_id: "C1", team_b_id: "C2", winner_team_id: winner, status: "completed",
  score_summary: {
    A: { score: 2, sets: [25, 25, 25] }, B: { score: 1, sets: [20, 20, 20] },
    tie: { win: "first", rubbersA: 2, rubbersB: 1, unitsA: 210, unitsB: 195, decided: "A", decider: true },
    rubbers: [{ key: "G1", A: 3, B: 1, winner: "A" }, { key: "G2", A: 2, B: 3, winner: "B" }, { key: "G3", A: 2, B: 1, winner: "A" }],
  },
} as GMatch);

test("sets 7–5 from the games; points 2 / 1", () => {
  const pts = { win: 3, draw: 1.5, loss: 0, sets: { straight: [3, 0] as [number, number], decider: [2, 1] as [number, number] } };
  const s = computeStats(["C1", "C2"], [series("C1")], undefined, pts as never);
  const a = s.get("C1")!; const b = s.get("C2")!;
  expect([a.scored, a.conceded, a.points, b.scored, b.conceded, b.points]).toEqual([7, 5, 2, 5, 7, 1]);
});

test("a team tie (rubbers MS, WS…) still counts rubbers won", () => {
  const m = series("C1"); m.score_summary.rubbers = [{ key: "MS", A: 2, B: 0 }, { key: "WS", A: 0, B: 2 }, { key: "MD", A: 2, B: 1 }];
  const s = computeStats(["C1", "C2"], [m], undefined, { win: 3, draw: 1, loss: 0 } as never);
  expect([s.get("C1")!.scored, s.get("C1")!.conceded]).toEqual([2, 1]);
});
