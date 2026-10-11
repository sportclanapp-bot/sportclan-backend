/**
 * Release prep 2.16.0 (11 Oct 2026): testers on 2.15.0 meet the new backend first.
 * Where 2.15.0 can't do what the server now asks, it hears "Update SportClan to …".
 */
import fs from 'fs';
import path from 'path';
import { compareVersions, isOlderApp, updateRequired } from '../utils/clientVersion';

const h = (v?: string) => ({ headers: v ? { 'x-client-version': v } : {} }) as never;

test('which app is older', () => {
  expect([isOlderApp(h('2.15.0')), isOlderApp(h('2.14.2')), isOlderApp(h('2.16.0')), isOlderApp(h('2.17.1')), isOlderApp(h())]).toEqual([true, true, false, false, false]);
  expect(compareVersions('v2.15.0', '2.15.0')).toBe(0);
});

test('the message', () => {
  expect(updateRequired('delete your account')).toEqual({ status: 403, body: { error: 'Update SportClan to delete your account.', code: 'UPDATE_REQUIRED' } });
});

test('the three places: change phone, delete account, offer to officiate', () => {
  const c = (f: string) => fs.readFileSync(path.join(__dirname, '../controllers', f), 'utf8');
  expect(c('auth.controller.ts')).toContain("re.body.code === 'REAUTH_REQUIRED' && isOlderApp(req)) { const u = updateRequired('change your phone number');");
  // …and before any code is texted for a change it can't finish
  expect(c('auth.controller.ts')).toContain("if (purpose === 'change_phone' && isOlderApp(req)) { const u = updateRequired('change your phone number');");
  expect(c('account.controller.ts')).toContain("re.body.code === 'REAUTH_REQUIRED' && isOlderApp(req)) { const u = updateRequired('delete your account');");
  expect(c('matches.controller.ts')).toContain("if (isOlderApp(req)) { const u = updateRequired(`offer to be this match’s ${off.toLowerCase()}`);");
});
