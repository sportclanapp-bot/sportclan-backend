/**
 * Visual review B15 (backend) · sessions you can tell apart (V072, D17,
 * migration 100), "Who can tag you" enforced (V069), the admin tile (no Premium).
 */
import fs from 'fs';
import path from 'path';

jest.mock('../utils/supabase', () => ({ supabase: {} }));
// eslint-disable-next-line import/first
import { deviceFields, sessionLabel } from '../utils/sessionDevice';
// eslint-disable-next-line import/first
import { mayTag } from '../utils/tagPrivacy';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('V072 · sessions', () => {
  it('reads the device headers, trimmed and capped', () => {
    expect(deviceFields({ headers: { 'x-device-name': ' Google Pixel 7 ', 'x-device-os': 'Android 14', 'x-app-version': '2.0.0 (3)' } } as never))
      .toEqual({ device_name: 'Google Pixel 7', device_os: 'Android 14', app_version: '2.0.0 (3)' });
    expect(deviceFields({ headers: { 'x-device-name': 'x'.repeat(200) } } as never).device_name).toHaveLength(80);
    expect(deviceFields({ headers: {} } as never)).toEqual({ device_name: null, device_os: null, app_version: null });
  });
  it('labels a session by device, or "Unknown device" for an old one', () => {
    expect(sessionLabel({ device_name: 'Google Pixel 7', device_os: 'Android 14', app_version: '2.0.0 (3)' }))
      .toBe('Google Pixel 7 · Android 14 · SportClan 2.0.0 (3)');
    expect(sessionLabel({})).toBe('Unknown device');
  });
  it('every sign-in stores the device; a refresh marks last used; the list hides signed-out sessions', () => {
    const a = code('controllers/auth.controller.ts');
    expect((a.match(/await insertRefreshToken\(user\.id, refreshToken, req\);/g) ?? []).length).toBe(3);
    expect(a).toMatch(/update\(\{ last_used_at: new Date\(\)\.toISOString\(\) \}\)\.eq\('id', row\.id\)/);
    const s = code('controllers/account.controller.ts');
    expect((s.match(/\.eq\('revoked', false\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('a sign-in never fails over a label (falls back before migration 100)', () => {
    // Decision 15: the fallback also reads the row's id back (the session id).
    expect(code('utils/sessionDevice.ts')).toMatch(/if \(!first\.error\) return[\s\S]*?await supabase\.from\('refresh_tokens'\)\.insert\(\{ user_id: userId, token \}\)\.select\('id'\)/);
  });
  it('migration 100 adds the four columns', () => {
    const m = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/100_session_device_info.sql'), 'utf8');
    for (const c of ['device_name  text', 'device_os    text', 'app_version  text', 'last_used_at timestamptz']) {
      expect(m).toContain(`ADD COLUMN IF NOT EXISTS ${c}`);
    }
  });
});

describe('V069 · who can tag you', () => {
  it('everyone / followers / nobody', () => {
    expect(mayTag('everyone', false)).toBe(true);
    expect(mayTag(null, false)).toBe(true);
    expect(mayTag('followers', true)).toBe(true);
    expect(mayTag('followers', false)).toBe(false);
    expect(mayTag('nobody', true)).toBe(false);
  });
  it('post and chat mentions both go through it', () => {
    expect(code('controllers/community.controller.ts')).toMatch(/const taggable = await taggableBy\(userId, mentionIds\);/);
    expect(code('controllers/messages.controller.ts')).toMatch(/await taggableBy\(userId, \(mentioned \?\? \[\]\)\.map/);
  });
});

it('admin stats count new users (the old "premium" tile)', () => {
  expect(code('controllers/admin.controller.ts')).toMatch(/new_users_this_week: newUsers,/);
});
