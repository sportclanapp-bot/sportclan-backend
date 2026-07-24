/**
 * SC-347 · single-choice vs multiple-choice polls — LIVE integration test.
 *
 *  - single-choice REJECTS 2 picks (400 SINGLE_CHOICE_ONE); a 1-pick vote works and
 *    percentages are share of distinct voters (sum to 100%).
 *  - multiple-choice ACCEPTS 2 picks from one voter, both count, and the math is per
 *    DISTINCT voter (poll_voter_count), so option %s can sum to >100%.
 *  - changing a vote works in both modes; a multi voter removing all picks → no vote.
 *
 * Self-cleaning: the author deletes both test polls in afterAll (also noted for
 * teardown). Fixtures: z326agra.qa (author + voter A) · z19empty.qa (voter B).
 */
import https from 'https';

const BASE = process.env.SC_BASE || 'https://sportclan-backend.onrender.com';

function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const u = new URL(BASE + path);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve({ status: res.statusCode || 0, data: JSON.parse(b || '{}') }); } catch { resolve({ status: res.statusCode || 0, data: {} }); } }); },
    );
    req.on('error', () => resolve({ status: 0, data: {} }));
    if (payload) req.write(payload);
    req.end();
  });
}
async function login(email: string, password: string): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const { status, data } = await call('POST', '/auth/login', undefined, { email, password });
    if (status === 200 && data.accessToken) return data.accessToken as string;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`login failed for ${email}`);
}
const countOf = (post: any, id: string) => (post.poll_options.find((o: any) => o.id === id)?.vote_count ?? 0);

describe('SC-347 poll single vs multiple choice', () => {
  let aTok: string, bTok: string;
  const created: string[] = [];

  async function makePoll(allow_multiple: boolean): Promise<string> {
    const res = await call('POST', '/community/posts', aTok, {
      type: 'poll',
      text: `SC-347 ${allow_multiple ? 'multi' : 'single'} ${Math.round(Date.now() % 1e6)}`,
      poll_options: ['Alpha', 'Bravo', 'Charlie'],
      allow_multiple,
    });
    const id = (res.data.post ?? res.data.data ?? res.data).id;
    created.push(id);
    return id;
  }

  beforeAll(async () => {
    aTok = await login('z326agra.qa@sportclan.test', 'SportClanZ326pass');
    bTok = await login('z19empty.qa@sportclan.test', 'SportClanZ19pass');
  });
  afterAll(async () => {
    for (const id of created) await call('DELETE', `/community/posts/${id}`, aTok);
  });

  it('SINGLE: rejects 2 picks; 1 pick tallies per distinct voter (sum 100%)', async () => {
    const id = await makePoll(false);
    // 2 picks on a single-choice poll → 400.
    const two = await call('POST', `/community/posts/${id}/vote`, aTok, { option_ids: ['opt_1', 'opt_2'] });
    expect(two.status).toBe(400);
    expect(two.data.code).toBe('SINGLE_CHOICE_ONE');

    // A picks opt_1, B picks opt_2.
    await call('POST', `/community/posts/${id}/vote`, aTok, { option_ids: ['opt_1'] });
    const afterB = (await call('POST', `/community/posts/${id}/vote`, bTok, { option_ids: ['opt_2'] })).data.post;
    expect(afterB.poll_voter_count).toBe(2);
    expect(countOf(afterB, 'opt_1')).toBe(1);
    expect(countOf(afterB, 'opt_2')).toBe(1);
    // share-of-voters: 1/2 + 1/2 = 100%
    expect(countOf(afterB, 'opt_1') + countOf(afterB, 'opt_2')).toBe(afterB.poll_voter_count);

    // A changes vote opt_1 → opt_2 (replace, still one vote).
    const changed = (await call('POST', `/community/posts/${id}/vote`, aTok, { option_ids: ['opt_2'] })).data.post;
    expect(countOf(changed, 'opt_1')).toBe(0);
    expect(countOf(changed, 'opt_2')).toBe(2);
    expect(changed.poll_voter_count).toBe(2);
  });

  it('MULTIPLE: accepts 2 picks; math is per distinct voter (option %s can exceed 100%)', async () => {
    const id = await makePoll(true);
    // A picks opt_1 AND opt_2.
    const a2 = (await call('POST', `/community/posts/${id}/vote`, aTok, { option_ids: ['opt_1', 'opt_2'] })).data.post;
    expect(countOf(a2, 'opt_1')).toBe(1);
    expect(countOf(a2, 'opt_2')).toBe(1);
    expect(a2.poll_voter_count).toBe(1); // one distinct voter, two picks

    // B picks opt_1.
    const withB = (await call('POST', `/community/posts/${id}/vote`, bTok, { option_ids: ['opt_1'] })).data.post;
    expect(countOf(withB, 'opt_1')).toBe(2);
    expect(countOf(withB, 'opt_2')).toBe(1);
    expect(withB.poll_voter_count).toBe(2); // distinct voters
    // per-distinct-voter %s: opt_1 = 100%, opt_2 = 50% → sum 150% (honest for multi).
    const sumCounts = countOf(withB, 'opt_1') + countOf(withB, 'opt_2') + countOf(withB, 'opt_3');
    expect(sumCounts).toBeGreaterThan(withB.poll_voter_count);

    // A changes selection to just opt_3 (drops opt_1+opt_2).
    const a3 = (await call('POST', `/community/posts/${id}/vote`, aTok, { option_ids: ['opt_3'] })).data.post;
    expect(countOf(a3, 'opt_1')).toBe(1); // only B now
    expect(countOf(a3, 'opt_2')).toBe(0);
    expect(countOf(a3, 'opt_3')).toBe(1);
    expect(a3.poll_voter_count).toBe(2);

    // A removes ALL picks → no vote from A; only B remains.
    const none = (await call('POST', `/community/posts/${id}/vote`, aTok, { option_ids: [] })).data.post;
    expect(countOf(none, 'opt_3')).toBe(0);
    expect(none.poll_voter_count).toBe(1);
  });
});
