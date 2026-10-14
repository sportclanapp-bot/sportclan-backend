/**
 * N-SPP1-PKB-3 (launch test plan, Round 2): undoing a side-out pickleball rally was written in the
 * edit history as a point for the receiving team, though that rally gave nobody a point.
 */
import { editLine } from '../utils/editLog';

const ctx = { sport: 'pickleball', teamA: 'Lions', teamB: 'Tigers' } as never;
const at = '2026-10-14T10:00:00Z';
const same = { A: { score: 0, points: 4 }, B: { score: 0, points: 2 } };
test('a marked side out (F167 on)', () => {
  expect(editLine({ id: '1', action: 'undo', changed_by: 'u', created_at: at,
    old_payload: { id: 'e', event_type: 'score', payload: { team_side: 'B', kind: 'rally', side_out: true } },
    score_before: same, score_after: same } as never, 'QA B', ctx)).toBe('QA B undid: Tigers won the rally — side out, no point');
});
test('an older one (no mark) that moved no score', () => {
  expect(editLine({ id: '2', action: 'undo', changed_by: 'u', created_at: at,
    old_payload: { id: 'e', event_type: 'score', payload: { team_side: 'B', kind: 'rally' } },
    score_before: same, score_after: same } as never, 'QA B', ctx)).toBe('QA B undid: Tigers won the rally — side out, no point');
});
test('a serving side’s rally is still its point', () => {
  expect(editLine({ id: '3', action: 'undo', changed_by: 'u', created_at: at,
    old_payload: { id: 'e', event_type: 'score', payload: { team_side: 'A', kind: 'rally' } },
    score_before: same, score_after: { A: { score: 0, points: 3 }, B: { score: 0, points: 2 } } } as never, 'QA B', ctx)).toBe('QA B undid: Lions point, 4–2 → 3–2');
});
