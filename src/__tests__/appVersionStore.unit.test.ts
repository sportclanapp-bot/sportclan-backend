/**
 * Release prep · GET /app/version says "no store page yet": a blank (or "none")
 * APP_STORE_URL is null, not the Play link; storeLive only with APP_STORE_LIVE=true.
 */
import { appVersionBody, PLAY_STORE_URL } from '../routes/app.routes';

test('no listing yet: blank or "none" is null, and storeLive is false', () => {
  expect(appVersionBody({ APP_LATEST_VERSION: '2.14.0' } as never)).toEqual({ latestVersion: '2.14.0', minVersion: '1.0.0', forceUpdate: false, storeUrl: null, storeLive: false });
  expect(appVersionBody({ APP_STORE_URL: '' } as never).storeUrl).toBeNull();
  expect(appVersionBody({ APP_STORE_URL: '  none ' } as never).storeUrl).toBeNull();
});

test('a download link before the listing is passed on; still not live', () => {
  expect(appVersionBody({ APP_STORE_URL: 'https://example.org/sportclan.apk' } as never)).toMatchObject({ storeUrl: 'https://example.org/sportclan.apk', storeLive: false });
});

test('the listing live: the Play link (or the set URL), storeLive true', () => {
  expect(appVersionBody({ APP_STORE_LIVE: 'true' } as never)).toMatchObject({ storeUrl: PLAY_STORE_URL, storeLive: true });
  expect(appVersionBody({ APP_STORE_LIVE: 'true', APP_STORE_URL: 'https://play.google.com/x' } as never).storeUrl).toBe('https://play.google.com/x');
});
