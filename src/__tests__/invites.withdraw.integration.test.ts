/**
 * SC-332 · Withdraw a sent play-invite — LIVE integration test.
 *
 * Proves against the deployed backend that withdrawing a pending invite:
 *   - removes the pending row (getUser.pending_invite_sport_ids frees the sport, and
 *     pending_invites drops the id → the sender's button returns to "Invite to play");
 *   - clears the invite from the RECEIVER's list (not left dangling);
 *   - is race-safe (a second withdraw of the same id is a clean 4xx, not a 500).
 *
 * Self-contained: withdrawal IS the cleanup, and afterAll clears any stray pending.
 *
 * Fixtures: z326agra.qa (sender A) · z19empty.qa (receiver B).
 */
import https from 'https';

const BASE = process.env.SC_BASE || 'https://sportclan-backend.onrender.com';

function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const u = new URL(BASE + path);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(buf || '{}') });
          } catch {
            resolve({ status: res.statusCode || 0, data: {} });
          }
        });
      },
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

describe('SC-332 withdraw a sent play-invite', () => {
  let aToken: string;
  let aId: string;
  let bToken: string;
  let bId: string;
  let tennisId: string;

  // Scope cleanup to THIS suite's sport (tennis) so it can run in parallel with the
  // SC-331 suite (cricket+badminton) without deleting its rows.
  async function clearPending(): Promise<void> {
    const inbox = (await call('GET', '/invites', bToken)).data.invites || [];
    for (const inv of inbox) {
      if (inv.sender_id === aId && inv.status === 'pending' && inv.sport_id === tennisId) {
        await call('DELETE', `/invites/${inv.id}`, aToken);
      }
    }
  }
  async function getProfile(): Promise<any> {
    return (await call('GET', `/users/${bId}`, aToken)).data;
  }

  beforeAll(async () => {
    aToken = await login('z326agra.qa@sportclan.test', 'SportClanZ326pass');
    aId = (await call('GET', '/users/me', aToken)).data.user.id;
    bToken = await login('z19empty.qa@sportclan.test', 'SportClanZ19pass');
    bId = (await call('GET', '/users/me', bToken)).data.user.id;
    const sports = (await call('GET', '/sports', aToken)).data.sports as any[];
    tennisId = sports.find((s) => s.name === 'Tennis').id;
    await clearPending();
  });

  afterAll(async () => {
    await clearPending();
  });

  it('withdraw removes the pending row, frees the button, and clears the receiver’s invite', async () => {
    // Send → pending.
    const send = await call('POST', '/invites', aToken, { receiver_id: bId, sport_id: tennisId });
    expect(send.status).toBeLessThan(400);
    const inviteId = send.data.invite.id;

    const before = await getProfile();
    expect(before.pending_invite_sport_ids).toContain(tennisId);
    // getUser now exposes the invite id so the button can withdraw.
    expect((before.pending_invites || []).some((p: any) => p.id === inviteId && p.sport_id === tennisId)).toBe(true);
    // Receiver sees it pending.
    let inbox = (await call('GET', '/invites', bToken)).data.invites || [];
    expect(inbox.some((i: any) => i.id === inviteId && i.status === 'pending')).toBe(true);

    // Withdraw.
    const wd = await call('DELETE', `/invites/${inviteId}`, aToken);
    expect(wd.status).toBeLessThan(400);
    expect(wd.data.success).toBe(true);

    // Button freed: sport gone from both projections.
    const after = await getProfile();
    expect(after.pending_invite_sport_ids).not.toContain(tennisId);
    expect((after.pending_invites || []).some((p: any) => p.id === inviteId)).toBe(false);

    // Receiver's list no longer carries a pending invite from A for this sport.
    inbox = (await call('GET', '/invites', bToken)).data.invites || [];
    expect(inbox.some((i: any) => i.id === inviteId)).toBe(false);
  });

  it('withdrawing an already-withdrawn invite is a clean 4xx, not a 500', async () => {
    const send = await call('POST', '/invites', aToken, { receiver_id: bId, sport_id: tennisId });
    const inviteId = send.data.invite.id;
    const first = await call('DELETE', `/invites/${inviteId}`, aToken);
    expect(first.status).toBeLessThan(400);
    const second = await call('DELETE', `/invites/${inviteId}`, aToken);
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500); // 404/400, never a raw 500
  });
});
