/**
 * N-R7-S121 (Batch 10, SCR-M-S03): two phones tapping Score within a second both got the pad.
 * claim() read "no lease", then UPSERTED its own — so the second upsert silently replaced the
 * first, and each phone was told it holds the lease (the first then had its points refused).
 * Now a claim with no lease INSERTS (the row's unique key decides), so exactly one phone wins
 * and the other is told who holds it; refreshing your own lease still works.
 */
type Row = { match_id: string; user_id: string; device_id: string; claimed_at: string; heartbeat_at: string };
const rows = new Map<string, Row>();
let pendingReads = 0; let release: () => void = () => {}; let gate: Promise<void> = Promise.resolve();
const armRace = () => { pendingReads = 0; gate = new Promise((r) => { release = r; }); };
function table() {
  const st: { op: string; val?: any; eqs: Record<string, any> } = { op: 'select', eqs: {} };
  const b: any = {
    select: () => b, eq: (k: string, v: any) => { st.eqs[k] = v; return b; },
    insert: (v: any) => { st.op = 'insert'; st.val = v; return b; },
    upsert: (v: any) => { st.op = 'upsert'; st.val = v; return b; },
    update: (v: any) => { st.op = 'update'; st.val = v; return b; },
    delete: () => { st.op = 'delete'; return b; },
    maybeSingle: () => run(), single: () => run(),
  };
  async function run() {
    const id = st.eqs.match_id ?? st.val?.match_id;
    if (st.op === 'select') { pendingReads += 1; if (pendingReads >= 2) release(); await gate; return { data: rows.get(id) ?? null, error: null }; }
    if (st.op === 'upsert') { rows.set(id, { ...st.val }); return { data: { ...st.val }, error: null }; }
    if (st.op === 'insert') { if (rows.has(id)) return { data: null, error: { code: '23505', message: 'duplicate key' } }; rows.set(id, { ...st.val }); return { data: { ...st.val }, error: null }; }
    if (st.op === 'update') { const r = rows.get(id); if (!r || Object.entries(st.eqs).some(([k, v]) => (r as any)[k] !== v)) return { data: null, error: null }; Object.assign(r, st.val); return { data: { ...r }, error: null }; }
    return { data: null, error: null };
  }
  return b;
}
jest.mock('../utils/supabase', () => ({ supabase: { from: () => table() } }));
// eslint-disable-next-line import/first
import { claimLease } from '../utils/scoringLease';

const M = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
beforeEach(() => { rows.clear(); });

test('two phones claiming at once: exactly one gets the pad, the other is told who holds it', async () => {
  armRace();
  const [a, b] = await Promise.all([claimLease(M, 'creator', 'phone-1'), claimLease(M, 'scorer', 'phone-2')]);
  expect([a.taken, b.taken].filter(Boolean)).toHaveLength(1);
  const loser = a.taken ? b : a; const winner = a.taken ? a : b;
  expect(loser.heldBy?.user_id).toBe(winner.lease?.user_id);
  expect(rows.get(M)?.user_id).toBe(winner.lease?.user_id);
});

test('the holder refreshing their own claim keeps it', async () => {
  armRace(); release();
  const first = await claimLease(M, 'creator', 'phone-1');
  const again = await claimLease(M, 'creator', 'phone-1');
  expect(first.taken).toBe(true);
  expect(again.taken).toBe(true);
  expect(again.lease?.user_id).toBe('creator');
});

test('someone else holding it is refused without a write', async () => {
  armRace(); release();
  await claimLease(M, 'creator', 'phone-1');
  const other = await claimLease(M, 'scorer', 'phone-2');
  expect(other.taken).toBe(false);
  expect(other.heldBy?.user_id).toBe('creator');
});
