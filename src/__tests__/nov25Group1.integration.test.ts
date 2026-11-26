/**
 * Fix list 25 Nov 2026 · Group 1 on the LOCAL stack (backend 4100 + local DB through ~/SportClan/localdb/q):
 * item 2 sign-in answers, item 3 sweep → reopen → manual switch, items 4–6 referral stats, item 1 Services.
 * Makes its own two local accounts (fixed ids, upserted; nothing is deleted).
 */
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import { isLocalBase, resolveBase } from './targetBase';
import { useLiveLock } from './liveLock';

const BASE = resolveBase();
const local = isLocalBase(BASE);
const d = local ? describe : describe.skip;
useLiveLock('qa-pair');
const q = (sql: string) => execFileSync(path.join(os.homedir(), 'SportClan', 'localdb', 'q'), ['-Atc', sql]).toString().trim();
const A = 'a5250000-0000-4000-8000-000000000001'; // the referrer / the one who goes away
const B = 'a5250000-0000-4000-8000-000000000002'; // the friend, later purged
const PW = 'SportClanZ326pass';
const H = () => ({ 'content-type': 'application/json', ...(process.env.SC_RATE_LIMIT_BYPASS ? { 'x-ratelimit-bypass': process.env.SC_RATE_LIMIT_BYPASS } : {}) });
const api = async (method: string, p: string, body?: unknown, token?: string, extra: Record<string, string> = {}) => {
  const r = await fetch(BASE + p, { method, headers: { ...H(), ...extra, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};
const login = async (email: string) => (await api('POST', '/auth/login', { email, password: PW })).body;

d('Group 1 on the local stack', () => {
  beforeAll(() => {
    for (const [id, n, phone] of [[A, 'nov25a', '+919000098001'], [B, 'nov25b', '+919000098002']]) {
      q(`insert into users (id, phone, email, name, username, password_hash, account_type, referral_code) values ('${id}', '${phone}', '${n}.qa@sportclan.test', 'Nov25 ${n}', '${n}_qa', (select password_hash from users where email='z326agra.qa@sportclan.test'), 'player', 'SC${n.toUpperCase()}') on conflict (id) do nothing`);
      q(`update users set deleted_at=null, purged_at=null, referred_by=null, is_available=true, is_available_auto_off=false, last_active_at=now(), email='${n}.qa@sportclan.test', name='Nov25 ${n}', referral_code='SC${n.toUpperCase()}' where id='${id}'`);
    }
    q(`insert into coin_events (user_id, event_type, coins) values ('${A}', 'referral_applied_${A}', 20), ('${A}', 'referral_reward_${B}', 20) on conflict do nothing`);
  });

  // The sweep is the real one: whoever it switched off on the local database is put back.
  afterAll(() => { q('update users set is_available=true, is_available_auto_off=false where is_available_auto_off and deleted_at is null'); });

  it('item 2: the password sign-in answer carries is_available', async () => {
    const r = await login('nov25a.qa@sportclan.test');
    expect(r.user.is_available).toBe(true);
    expect(r.user).not.toHaveProperty('password_hash');
    expect(r.user).not.toHaveProperty('is_available_auto_off');
  });

  it('item 3: away 30 days → off (others untouched) → the next open puts it back; switched off by hand → stays off', async () => {
    const secret = { 'x-cron-secret': 'local-cron-secret' };
    expect((await api('POST', '/internal/jobs/availability-auto-off', {})).status).toBe(403);
    const state = (id: string) => q(`select is_available||','||is_available_auto_off from users where id='${id}'`);
    q(`update users set last_active_at=now()-interval '31 days' where id='${A}'`);
    q(`update users set last_active_at=now()-interval '29 days' where id='${B}'`);
    const swept = await api('POST', '/internal/jobs/availability-auto-off', {}, undefined, secret);
    expect(swept.status).toBe(200);
    expect(swept.body.switchedOff).toBeGreaterThanOrEqual(1);
    expect(state(A)).toBe('false,true');
    expect(state(B)).toBe('true,false');
    expect((await api('POST', '/internal/jobs/availability-auto-off', {}, undefined, secret)).body.switchedOff).toBe(0); // idempotent
    const a = await login('nov25a.qa@sportclan.test'); // opens the app again
    expect(a.user.is_available).toBe(true);
    expect(state(A)).toBe('true,false');
    // GET /users/me restores too (an app that stayed signed in).
    q(`update users set is_available=false, is_available_auto_off=true where id='${A}'`);
    expect((await api('GET', '/users/me', undefined, a.accessToken)).body.user.is_available).toBe(true);
    // The person's own choice survives an absence and a reopen.
    expect((await api('PATCH', '/users/me', { is_available: false }, a.accessToken)).body.user.is_available).toBe(false);
    q(`update users set last_active_at=now()-interval '60 days' where id='${A}'`);
    await api('POST', '/internal/jobs/availability-auto-off', {}, undefined, secret);
    expect(state(A)).toBe('false,false');
    expect((await api('GET', '/users/me', undefined, a.accessToken)).body.user.is_available).toBe(false);
    await api('PATCH', '/users/me', { is_available: true }, a.accessToken);
    expect(state(A)).toBe('true,false');
  });

  it('items 5 + 6: the friend count and coins are the same before and after the friend is purged', async () => {
    q(`update users set referred_by='${A}' where id='${B}'`);
    const t = (await login('nov25a.qa@sportclan.test')).accessToken;
    const before = (await api('GET', '/referrals/stats', undefined, t)).body;
    expect(before).toMatchObject({ referralCode: 'SCNOV25A', referralCount: 1, totalCoinsEarned: 40 });
    q(`update users set referred_by=null, name='Deleted User', deleted_at=now() where id='${B}'`);
    const after = (await api('GET', '/referrals/stats', undefined, t)).body;
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain(B);
    q(`update users set deleted_at=null, name='Nov25 nov25b' where id='${B}'`);
  });

  it('item 1: an old official row is listed once, under the one group, and counted once', async () => {
    const t = (await login('nov25a.qa@sportclan.test')).accessToken;
    for (const ty of ['umpire', 'official']) q(`insert into user_account_types (user_id, account_type) values ('${B}', '${ty}') on conflict do nothing`);
    const readAll = async (path2: string) => { const out: string[] = []; for (let o = 0; ; o += 50) { const r = (await api('GET', `${path2}&limit=50&offset=${o}`, undefined, t)).body; out.push(...r.providers.map((p: any) => p.id)); if (!r.has_more) return out; } };
    const u = await readAll('/services?type=umpire'); const o = await readAll('/services?type=official'); const c = await readAll('/services?category=umpires');
    const counts = (await api('GET', '/services/counts', undefined, t)).body;
    expect(o).toEqual(u);
    expect(u.filter((x) => x === B)).toHaveLength(1);
    expect(c.filter((x) => x === B)).toHaveLength(1);
    expect(await readAll('/services?category=referees')).not.toContain(B);
    expect([counts.counts.umpire, counts.counts.official, counts.categories.umpires]).toEqual([u.length, u.length, c.length]);
    q(`update users set deleted_at=now() where id='${B}'`); // soft: off every list again
  });
});
