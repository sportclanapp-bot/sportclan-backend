/**
 * SC-341 · read receipts (sent → delivered → seen) — LIVE integration test.
 *
 * Proves against the deployed backend that a sender (A) can tell the three states
 * apart from real data, driven by the recipient (B)'s actions:
 *   1. A sends → from A's view the message is SENT (B not in delivered_to/read_by).
 *   2. B lists chats (their app receives it) → A now sees it DELIVERED (B in
 *      delivered_to, not read_by).
 *   3. B opens the thread (markAsRead) → A now sees it SEEN (B in read_by).
 *
 * Also asserts B never leaks into read_by before opening (delivered ≠ seen).
 *
 * Self-cleaning: A deletes the test message in afterAll (noted for teardown too).
 * Fixtures: z326agra.qa (A / sender) · z19empty.qa (B / recipient).
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
const arr = (v: any): string[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v) : []);

describe('SC-341 read receipts flip the sender view', () => {
  let aTok: string, bTok: string, aId: string, bId: string, chatId: string, msgId: string;

  // A's view of the test message (delivered_to / read_by as A sees it).
  async function senderView(): Promise<{ delivered: string[]; read: string[] } | null> {
    const msgs = (await call('GET', `/messages/chats/${chatId}/messages`, aTok)).data.messages || [];
    const m = msgs.find((x: any) => x.id === msgId);
    return m ? { delivered: arr(m.delivered_to), read: arr(m.read_by) } : null;
  }

  beforeAll(async () => {
    aTok = await login('z326agra.qa@sportclan.test', 'SportClanZ326pass');
    bTok = await login('z19empty.qa@sportclan.test', 'SportClanZ19pass');
    aId = (await call('GET', '/users/me', aTok)).data.user.id;
    bId = (await call('GET', '/users/me', bTok)).data.user.id;
    const dm = await call('POST', '/messages/dm', aTok, { user_id: bId });
    chatId = (dm.data.chat ?? dm.data.data ?? dm.data).id;
    // Clear any prior unread so B's earlier state can't mask this run.
    await call('POST', `/messages/chats/${chatId}/read`, bTok);
  });

  afterAll(async () => {
    if (msgId) await call('DELETE', `/messages/messages/${msgId}`, aTok);
  });

  it('sent → delivered → seen, each visible from the sender side', async () => {
    // 1) A sends. From A's view it is SENT: B in neither list.
    const send = await call('POST', `/messages/chats/${chatId}/messages`, aTok, { text: `SC-341 receipts ${aId.slice(0, 6)}` });
    expect(send.status).toBeLessThan(400);
    msgId = (send.data.message ?? send.data.data ?? send.data).id;

    let v = await senderView();
    expect(v).not.toBeNull();
    expect(v!.delivered).not.toContain(bId); // SENT
    expect(v!.read).not.toContain(bId);

    // 2) B's app receives it via a chat-list poll → DELIVERED (not yet read).
    await call('GET', '/messages/chats', bTok);
    v = await senderView();
    expect(v!.delivered).toContain(bId);     // DELIVERED
    expect(v!.read).not.toContain(bId);      // …but NOT read (delivered ≠ seen)

    // 3) B opens the thread → SEEN.
    const read = await call('POST', `/messages/chats/${chatId}/read`, bTok);
    expect(read.status).toBeLessThan(400);
    v = await senderView();
    expect(v!.read).toContain(bId);          // SEEN
    expect(v!.delivered).toContain(bId);     // read implies delivered (monotonic)
  });
});
