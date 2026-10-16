/**
 * N-RWG2-2 (launch test plan) · after the pad showed a winner but before End match was
 * tapped, the ⋯ menu still offered Abandon, and the server accepted it (it checked only
 * the status) — the result on screen was wiped. A live match its own rules say is decided
 * is now refused with words (409 MATCH_DECIDED); the app no longer offers it either.
 */
import fs from 'fs';
import path from 'path';
import * as mc from '../controllers/matches.controller';

jest.mock('../utils/supabase', () => ({ supabase: {} }));

const refusal = (o: { side: 'A' | 'B' | null } | null) => {
  const f = (mc as unknown as { decidedAbandonRefusal?: (o: unknown) => unknown }).decidedAbandonRefusal;
  expect(typeof f).toBe('function');
  return f!(o) as { status: number; body: { error: string; code: string } } | null;
};

it('a decided match (a winner) is refused with what to do instead', () => {
  const chess = mc.staleMatchOutcome('chess', { chess: { result: 'White wins' } }, {}, []);
  expect(refusal(chess)).toEqual({
    status: 409,
    body: { error: 'This match already has a winner. Tap End match to save the result, or undo the last point first.', code: 'MATCH_DECIDED' },
  });
});

it('a decided draw too', () => {
  expect(refusal({ side: null })?.body.error).toBe('This match is already decided as a draw. Tap End match to save it, or undo the last point first.');
});

it('an undecided match may still be abandoned', () => {
  expect(refusal(mc.staleMatchOutcome('chess', { chess: {} }, {}, []))).toBeNull();
});

it('abandonMatch asks before it writes, for a live match', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export async function abandonMatch'));
  const ask = fn.indexOf('decidedAbandonRefusal(await staleOutcomeOf(id)');
  expect(ask).toBeGreaterThan(-1);
  expect(ask).toBeLessThan(fn.indexOf("status: 'abandoned'"));
  expect(fn.slice(0, ask)).toMatch(/if \(match\.status === 'live'\) \{\s*const refusal = $/);
});
