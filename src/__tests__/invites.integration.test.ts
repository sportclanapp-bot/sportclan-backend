/**
 * SC-331 · Per-sport play invites — LIVE integration test (real round-trip).
 *
 * Proves against the deployed backend that a play-invite is sport-scoped, not a
 * global one-shot:
 *   1. sending an invite creates a PENDING row scoped to that sport, and the sport
 *      surfaces in getUser.pending_invite_sport_ids (the state the button reads);
 *   2. a duplicate PENDING invite for the SAME sport is rejected (ALREADY_INVITED)
 *      with no second row;
 *   3. an invite for a DIFFERENT sport succeeds independently (both pending);
 *   4. after the invitee declines, re-inviting for that same sport is allowed
 *      (the resolved row reopens).
 *
 * Self-contained: captures every invite it creates and withdraws them in afterAll,
 * restoring the fixtures to their pre-test state. No seed data modified.
 *
 * Fixtures (QA accounts, pre-provisioned):
 *   z326agra.qa — the inviter / viewer (A)
 *   z19empty.qa — the invitee (B)
 */
import https from 'https';

const BASE = process.env.SC_BASE || 'https://sportclan-backend.onrender.com';

function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
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

describe('SC-331 per-sport play invites', () => {
  let aToken: string;
  let aId: string;
  let bToken: string;
  let bId: string;
  let cricketId: string;
  let badmintonId: string;
  const createdIds = new Set<string>();

  // Withdraw A→B pending invites for THIS suite's sports only (cricket+badminton),
  // so it can run in parallel with the withdraw suite (which owns tennis) without
  // stomping on its rows.
  async function clearPending(): Promise<void> {
    const inbox = (await call('GET', '/invites', bToken)).data.invites || [];
    for (const inv of inbox) {
      if (inv.sender_id === aId && inv.status === 'pending' && [cricketId, badmintonId].includes(inv.sport_id)) {
        await call('DELETE', `/invites/${inv.id}`, aToken);
      }
    }
  }

  async function pendingSports(): Promise<string[]> {
    const prof = await call('GET', `/users/${bId}`, aToken);
    return prof.data.pending_invite_sport_ids || [];
  }

  beforeAll(async () => {
    aToken = await login('z326agra.qa@sportclan.test', 'SportClanZ326pass');
    aId = (await call('GET', '/users/me', aToken)).data.user.id;
    bToken = await login('z19empty.qa@sportclan.test', 'SportClanZ19pass');
    bId = (await call('GET', '/users/me', bToken)).data.user.id;
    const sports = (await call('GET', '/sports', aToken)).data.sports as any[];
    cricketId = sports.find((s) => s.name === 'Cricket').id;
    badmintonId = sports.find((s) => s.name === 'Badminton').id;
    await clearPending();
  });

  afterAll(async () => {
    // Withdraw everything this suite created, plus any leftover A→B pending.
    for (const id of createdIds) await call('DELETE', `/invites/${id}`, aToken);
    await clearPending();
  });

  it('an invite creates a pending row scoped to the sport (surfaces in pending_invite_sport_ids)', async () => {
    const res = await call('POST', '/invites', aToken, { receiver_id: bId, sport_id: cricketId });
    expect(res.status).toBeLessThan(400);
    expect(res.data.invite.status).toBe('pending');
    expect(res.data.invite.sport_id).toBe(cricketId);
    createdIds.add(res.data.invite.id);

    const pend = await pendingSports();
    expect(pend).toContain(cricketId);
    expect(pend).not.toContain(badmintonId); // scoped — not a global flag
  });

  it('a duplicate same-sport pending invite is rejected (ALREADY_INVITED), no second row', async () => {
    const res = await call('POST', '/invites', aToken, { receiver_id: bId, sport_id: cricketId });
    expect(res.status).toBe(400);
    expect(res.data.code).toBe('ALREADY_INVITED');

    // Exactly one pending cricket invite A→B exists (B's inbox is the source of truth).
    const inbox = (await call('GET', '/invites', bToken)).data.invites || [];
    const pendingCricket = inbox.filter(
      (i: any) => i.sender_id === aId && i.sport_id === cricketId && i.status === 'pending',
    );
    expect(pendingCricket.length).toBe(1);
  });

  it('a different-sport invite succeeds independently (both pending)', async () => {
    const res = await call('POST', '/invites', aToken, { receiver_id: bId, sport_id: badmintonId });
    expect(res.status).toBeLessThan(400);
    createdIds.add(res.data.invite.id);

    const pend = await pendingSports();
    expect(pend).toEqual(expect.arrayContaining([cricketId, badmintonId]));
  });

  it('after the invitee declines, re-inviting for that sport is allowed (row reopens)', async () => {
    // Decline the cricket invite as B.
    const inbox = (await call('GET', '/invites', bToken)).data.invites || [];
    const cricketInv = inbox.find(
      (i: any) => i.sender_id === aId && i.sport_id === cricketId && i.status === 'pending',
    );
    expect(cricketInv).toBeTruthy();
    const dec = await call('PATCH', `/invites/${cricketInv.id}`, bToken, { status: 'declined' });
    expect(dec.status).toBeLessThan(400);

    // Cricket is no longer pending for the viewer.
    expect(await pendingSports()).not.toContain(cricketId);

    // Re-invite cricket → allowed (reopens the resolved row).
    const res = await call('POST', '/invites', aToken, { receiver_id: bId, sport_id: cricketId });
    expect(res.status).toBeLessThan(400);
    createdIds.add(res.data.invite.id);
    expect(await pendingSports()).toContain(cricketId);
  });
});
