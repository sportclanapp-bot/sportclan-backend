/**
 * Re-report after a handled report (decided 29 Sep 2026).
 * A fresh report on content whose earlier report by the same person was already
 * handled (dismissed, removed, restored) opens a NEW row in the moderation
 * queue. Only a still-open report by the same person is de-duplicated.
 * content_reports is an in-memory table here; filters are applied for real.
 */
type Row = Record<string, unknown>;
let reports: Row[] = [];
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let insertRow: Row | null = null;
    const q: any = {};
    const rows = () => (table === 'content_reports' ? reports : [{ id: 'target-user' }])
      .filter((r) => filters.every(([k, v]) => r[k] === v || (table !== 'content_reports' && k === 'id')));
    q.select = jest.fn(() => q);
    q.eq = jest.fn((k: string, v: unknown) => { filters.push([k, v]); return q; });
    q.limit = jest.fn(() => q);
    q.insert = jest.fn((r: Row) => { insertRow = { id: `r${reports.length + 1}`, resolved: false, ...r }; return q; });
    q.maybeSingle = jest.fn(async () => {
      const m = rows();
      // PostgREST's maybeSingle errors on more than one row.
      return m.length > 1 ? { data: null, error: { code: 'PGRST116' } } : { data: m[0] ?? null, error: null };
    });
    q.single = jest.fn(async () => {
      if (insertRow) { reports.push(insertRow); return { data: insertRow, error: null }; }
      return { data: rows()[0] ?? null, error: null };
    });
    return q;
  };
  return { supabase: { from: jest.fn(from) } };
});

// eslint-disable-next-line import/first
import { reportContent } from '../controllers/community.controller';

const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const report = async (reporter: string) => {
  const r = res();
  await reportContent({ userId: reporter, body: { target_type: 'user', target_id: 'target-user', reason: 'spam' } } as any, r);
  return r;
};
const open = () => reports.filter((r) => r.resolved === false);

beforeEach(() => { reports = []; });

describe('re-report after a handled report', () => {
  test('a report that was handled → a fresh report opens a new row', async () => {
    expect((await report('u1')).statusCode).toBe(201);
    reports[0].resolved = true; reports[0].resolved_action = 'dismissed';
    const again = await report('u1');
    expect(again.statusCode).toBe(201);
    expect(again.body.alreadyReported).toBeUndefined();
    expect(reports).toHaveLength(2);
    expect(open()).toHaveLength(1);
  });
  test('handled twice, then reported a third time → still a new open row (no maybeSingle error from the old rows)', async () => {
    await report('u1'); reports[0].resolved = true;
    await report('u1'); reports[1].resolved = true;
    expect((await report('u1')).statusCode).toBe(201);
    expect(open()).toHaveLength(1);
    expect(reports).toHaveLength(3);
  });
  test('the same person\'s report still OPEN → de-duplicated, no second row', async () => {
    await report('u1');
    const dup = await report('u1');
    expect(dup.statusCode).toBe(200);
    expect(dup.body).toMatchObject({ alreadyReported: true, data: { id: 'r1' } });
    expect(reports).toHaveLength(1);
  });
  test('a different reporter → a new row even while the first is open', async () => {
    await report('u1');
    expect((await report('u2')).statusCode).toBe(201);
    expect(open()).toHaveLength(2);
  });
});
