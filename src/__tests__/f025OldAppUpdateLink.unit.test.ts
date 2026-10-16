/**
 * F025 (launch test plan) · testers on 2.13.0 or older who tapped 'Update' were sent to
 * a Play Store page that doesn't exist yet: those apps open `storeUrl || <Play link>`,
 * and /app/version sends storeUrl null until a download link is set or the listing is
 * live. An older app (X-Client-Version below 2.14.0) is now sent this server's own
 * /app/get-update page instead; newer apps' answer is unchanged, and so are
 * APP_LATEST_VERSION and who is gated.
 */
import express from 'express';
import http from 'http';
import appRoutes, * as routes from '../routes/app.routes';

// Loosely typed so this file also compiles against the old one-argument version (the proof run).
const appVersionBody = routes.appVersionBody as unknown as (env: unknown, opts?: unknown) => ReturnType<typeof routes.appVersionBody>;
const base = 'https://api.example.test';

describe('appVersionBody', () => {
  it('2.13.0 with no store page and no link: the get-update page, never null', () => {
    const v = appVersionBody({ APP_LATEST_VERSION: '2.17.0' }, { clientVersion: '2.13.0', baseUrl: base });
    expect(v).toMatchObject({ latestVersion: '2.17.0', storeLive: false, storeUrl: `${base}/app/get-update` });
    expect(appVersionBody({}, { clientVersion: '2.9.0', baseUrl: base }).storeUrl).toBe(`${base}/app/get-update`);
  });

  it('2.14.0 and newer: unchanged (null; they say "Get the new version from the SportClan team")', () => {
    for (const cv of ['2.14.0', '2.17.0', null]) {
      expect(appVersionBody({ APP_LATEST_VERSION: '2.17.0' }, { clientVersion: cv, baseUrl: base }).storeUrl).toBeNull();
    }
  });

  it('a download link, or the live listing, still wins for old apps', () => {
    expect(appVersionBody({ APP_STORE_URL: 'https://example.org/sc.apk' }, { clientVersion: '2.13.0', baseUrl: base }).storeUrl).toBe('https://example.org/sc.apk');
    expect(appVersionBody({ APP_STORE_LIVE: 'true' }, { clientVersion: '2.13.0', baseUrl: base }).storeUrl).toBe(routes.PLAY_STORE_URL);
  });
});

describe('the routes', () => {
  const ENV = { ...process.env };
  let srv: http.Server; let url = '';
  beforeAll(() => {
    process.env.APP_LATEST_VERSION = '2.17.0';
    delete process.env.APP_STORE_URL; delete process.env.APP_STORE_LIVE;
    const app = express();
    app.use('/app', appRoutes);
    srv = http.createServer(app).listen(0);
    url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  });
  afterAll(() => { srv.close(); process.env = ENV; });

  it('GET /app/version from 2.13.0 sends a link to a page that exists', async () => {
    const r = await fetch(`${url}/app/version`, { headers: { 'X-Client-Version': '2.13.0' } });
    const body = await r.json();
    expect(body.storeUrl).toBe(`${url}/app/get-update`);
    expect(r.headers.get('vary') ?? '').toMatch(/X-Client-Version/i);
    const page = await fetch(body.storeUrl);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Get the new version from the SportClan team');
  });

  it('GET /app/version from 2.17.0 is unchanged', async () => {
    const r = await fetch(`${url}/app/version`, { headers: { 'X-Client-Version': '2.17.0' } });
    expect(await r.json()).toEqual({ latestVersion: '2.17.0', minVersion: '1.0.0', forceUpdate: false, storeUrl: null, storeLive: false });
  });

  it('once a download link is set, the page forwards to it', async () => {
    process.env.APP_STORE_URL = 'https://example.org/sc.apk';
    const r = await fetch(`${url}/app/get-update`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://example.org/sc.apk');
    delete process.env.APP_STORE_URL;
  });
});
