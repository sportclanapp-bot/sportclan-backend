/**
 * Push delivery: the backend's half must match the token the app produces.
 *
 * The old sender (firebase-admin, direct FCM) rejected every Expo token the
 * app registered, swallowed the rejection, and the in-app row written first
 * meant nobody noticed. These pin the replacement.
 */
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the sender speaks Expo, not raw FCM', () => {
  const s = code('utils/expoPush.ts');

  it('loads expo-server-sdk lazily - it is pure ESM', () => {
    // A static import fails under ts-jest and makes a plain require() depend
    // on the host Node version. Dynamic import works in both worlds.
    expect(s).toContain("await import('expo-server-sdk')");
    expect(s).not.toMatch(/^import \{ Expo[ ,}]/m);
  });

  it('only accepts Expo-shaped tokens, checked without loading the SDK', () => {
    expect(s).toMatch(/\^Expo\(nent\)\?PushToken/);
  });

  it('cleanup and ticket recording can never throw into the caller', () => {
    const del = s.slice(s.indexOf('async function deleteTokens'));
    expect(del).toMatch(/try \{[\s\S]*from\('push_tokens'\)\.delete\(\)[\s\S]*\} catch/);
    expect(s).toMatch(/try \{[\s\S]*from\('push_tickets'\)\.insert\(pending\)[\s\S]*\} catch/);
  });

  it('fcm.ts is gone and nothing imports it', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'utils', 'fcm.ts'))).toBe(false);
    expect(code('utils/notify.ts')).toContain("from './expoPush'");
    expect(code('utils/notify.ts')).not.toContain("from './fcm'");
  });

  it('firebase-admin is not a dependency', () => {
    const pkg = JSON.parse(read('../package.json'));
    expect(pkg.dependencies['firebase-admin']).toBeUndefined();
  });

  it('no FIREBASE_* env var is read anywhere', () => {
    const files = fs.readdirSync(path.join(__dirname, '..', 'utils')).map((f) => `utils/${f}`)
      .concat(['index.ts']);
    for (const f of files) expect(code(f)).not.toMatch(/process\.env\.FIREBASE_/);
    expect(read('../.env.example')).not.toContain('FIREBASE_');
  });
});

describe('tickets and receipts are kept distinct', () => {
  const s = code('utils/expoPush.ts');

  it('a DeviceNotRegistered TICKET deletes the token at once', () => {
    expect(s).toContain("if (code === 'DeviceNotRegistered') dead.push(token);");
  });

  it('InvalidCredentials is logged, never treated as a bad token', () => {
    // That code means the FCM key is missing from EAS. Deleting tokens for a
    // configuration fault would empty the table while the fault stays.
    const ticketBlock = s.slice(s.indexOf('tickets.forEach'), s.indexOf('if (dead.length > 0)'));
    expect(ticketBlock).not.toMatch(/InvalidCredentials[\s\S]{0,80}dead\.push/);
  });

  it('ok tickets are persisted for the receipt check', () => {
    expect(s).toContain("from('push_tickets').insert(pending)");
  });

  it('the receipt check waits 15 minutes, deletes on DeviceNotRegistered, and marks tickets checked once', () => {
    expect(s).toContain('15 * 60_000');
    expect(s).toContain("r.details?.error === 'DeviceNotRegistered'");
    expect(s).toContain("is('checked_at', null)");
    expect(s).toContain("update({ checked_at: new Date().toISOString() })");
  });

  it('a send never throws into the caller', () => {
    const fn = s.slice(s.indexOf('export async function sendPushToTokens'), s.indexOf('export async function checkPushReceipts'));
    expect(fn).toMatch(/catch \(err\)/);
    expect(fn).not.toMatch(/\bthrow\b/);
  });
});

describe('the receipt check is scheduled', () => {
  it('runs hourly on the existing in-process scheduler', () => {
    const idx = code('index.ts');
    expect(idx).toContain("import { checkPushReceipts } from './utils/expoPush';");
    expect(idx).toContain('setInterval(runPushReceipts, 60 * 60 * 1000)');
  });

  it('the table it needs is an additive migration', () => {
    const mig = read('../supabase/migrations/094_push_tickets.sql').replace(/^\s*--.*$/gm, '');
    expect(mig).toContain('CREATE TABLE IF NOT EXISTS push_tickets');
    expect(mig).not.toMatch(/\bDROP\b/i);
  });
});
