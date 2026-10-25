/**
 * N-R7-S53 (Step 2 Batch 14, SCR-M-228) · a match payload never carries the official's
 * report: GET /matches/:id, /matches, /matches/history and /matches/next selected the
 * whole row, so any signed-in user (a player, a stranger) read the referee's report text
 * and its author's id. The report is read only through GET /matches/:id/assistants.
 */
import fs from 'fs';
import path from 'path';
import { hideOfficialReport } from '../middleware/hideOfficialReport.middleware';

function send(body: unknown) {
  let out: unknown;
  const res: any = { json: (b: unknown) => { out = b; return res; } };
  hideOfficialReport({} as any, res, () => undefined);
  res.json(body);
  return out as any;
}
const report = { text: 'Yellow card #7, dissent', by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', at: '2026-10-25T03:00:00Z' };

test('the match of GET /matches/:id loses official_report, the rest stays', () => {
  const out = send({ match: { id: 'm1', status: 'completed', official_report: report }, participants: [] });
  expect(out.match).toEqual({ id: 'm1', status: 'completed' });
  expect(out.participants).toEqual([]);
});
test('every row of a match list loses official_report', () => {
  const out = send({ matches: [{ id: 'a', official_report: report }, { id: 'b', official_report: null }, { id: 'c' }], has_more: false });
  expect(out.matches).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  expect(JSON.stringify(out)).not.toContain('dissent');
});
test('other bodies pass through untouched (the assistants sheet sends its own `report`)', () => {
  const body = { roles: [], report: { text: 'x', at: null, by: null }, official: 'Referee' };
  expect(send(body)).toEqual(body);
  expect(send(null)).toBeNull();
});
test('the matches router applies it to every route', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/matches.routes.ts'), 'utf8');
  expect(src).toMatch(/router\.use\(hideOfficialReport\);/);
  expect(src.indexOf('router.use(hideOfficialReport);')).toBeLessThan(src.indexOf("router.get('/', "));
});
