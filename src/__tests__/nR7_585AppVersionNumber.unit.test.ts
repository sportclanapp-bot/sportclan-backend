/**
 * N-R7-585 (REG-106): APP_LATEST_VERSION written 'v2.99.0' went out raw, so the app's
 * banner read 'vv2.99.0' (and 2.13–2.16 apps show it the same way). /app/version now
 * sends the plain number.
 */
import { appVersionBody } from '../routes/app.routes';
import { versionNumber } from '../utils/clientVersion';

test("'v2.99.0' / ' V2.99.0-b3 ' go out as 2.99.0; min the same", () => {
  expect(appVersionBody({ APP_LATEST_VERSION: 'v2.99.0', APP_MIN_VERSION: 'v2.10' } as never)).toMatchObject({ latestVersion: '2.99.0', minVersion: '2.10' });
  expect(appVersionBody({ APP_LATEST_VERSION: ' V2.99.0-b3 ' } as never).latestVersion).toBe('2.99.0');
});

test('plain values unchanged; blank or junk falls back to 1.0.0', () => {
  expect(appVersionBody({ APP_LATEST_VERSION: '2.17.0' } as never).latestVersion).toBe('2.17.0');
  expect(appVersionBody({ APP_LATEST_VERSION: 'none', APP_MIN_VERSION: ' ' } as never)).toMatchObject({ latestVersion: '1.0.0', minVersion: '1.0.0' });
  expect(versionNumber(undefined)).toBeNull();
});
