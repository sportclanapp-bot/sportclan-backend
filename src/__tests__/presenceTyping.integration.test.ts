/**
 * SC-344 · real presence + real typing — LIVE integration test.
 *
 * Presence: after A heartbeats, A's public profile (viewed by B) reports is_online.
 * Typing: while A pings /typing in a DM, B's message poll surfaces A in `typing`;
 * once the ~8s TTL lapses (no more pings), B's poll no longer lists A.
 *
 * Read-mostly: heartbeat/typing only bump A's own timestamps (no content created).
 * Fixtures: z326agra.qa (A) · z19empty.qa (B).
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('SC-344 presence + typing', () => {
  let aTok: string, bTok: string, aId: string, bId: string, chatId: string;

  beforeAll(async () => {
    aTok = await login('z326agra.qa@sportclan.test', 'SportClanZ326pass');
    bTok = await login('z19empty.qa@sportclan.test', 'SportClanZ19pass');
    aId = (await call('GET', '/users/me', aTok)).data.user.id;
    bId = (await call('GET', '/users/me', bTok)).data.user.id;
    const dm = await call('POST', '/messages/dm', aTok, { user_id: bId });
    chatId = (dm.data.chat ?? dm.data.data ?? dm.data).id;
  });

  it('presence: after A heartbeats, B sees A as online', async () => {
    const hb = await call('POST', '/users/me/heartbeat', aTok);
    expect(hb.status).toBe(200);
    expect(hb.data.last_active_at).toBeTruthy();
    const profile = await call('GET', `/users/${aId}`, bTok);
    expect(profile.status).toBe(200);
    expect(profile.data.user.is_online).toBe(true); // real, from last_active_at
    expect(profile.data.user.last_active_at).toBeTruthy();
  });

  it('typing: B sees A typing while A pings, then it clears after the TTL', async () => {
    const t = await call('POST', `/messages/chats/${chatId}/typing`, aTok);
    expect(t.status).toBe(200);

    const during = await call('GET', `/messages/chats/${chatId}/messages`, bTok);
    expect(during.status).toBe(200);
    expect(Array.isArray(during.data.typing)).toBe(true);
    expect(during.data.typing.some((x: any) => x.user_id === aId)).toBe(true); // REAL typing

    // A's OWN poll must never list A as typing (only OTHERS).
    const selfView = await call('GET', `/messages/chats/${chatId}/messages`, aTok);
    expect(selfView.data.typing.some((x: any) => x.user_id === aId)).toBe(false);

    // Stop pinging; after the ~8s server TTL the signal lapses.
    await sleep(9000);
    const after = await call('GET', `/messages/chats/${chatId}/messages`, bTok);
    expect(after.data.typing.some((x: any) => x.user_id === aId)).toBe(false); // cleared on idle
  }, 20000);
});
