/**
 * Q5 (Dipak, 21 Nov 2026, F011) · the privacy policy and the "delete my account" pages stay on
 * the backend's own pages, worded like the current app: no payments, no premium, and the
 * Pvt Ltd company details a clearly marked placeholder.
 */
import fs from 'fs';
import path from 'path';
import { privacyPolicyHtml } from '../legal/privacyPage';
import { termsOfServiceHtml } from '../legal/termsPage';
import { deleteAccountHtml } from '../legal/deleteAccountPage';
import { COMPANY_DETAILS_PLACEHOLDER } from '../legal/companyDetails';

const pages = { privacy: privacyPolicyHtml(), terms: termsOfServiceHtml(), delete: deleteAccountHtml() };
const text = (h: string) => h.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ');

it.each(Object.entries(pages))('%s: no premium, subscription or paid plan is offered', (_n, h) => {
  const t = text(h);
  expect(t).not.toMatch(/premium|razorpay|subscri(be|ption)|per month|₹|upgrade|buy coins|coin pack|5 posts/i);
});
it.each(Object.entries(pages))('%s: ends with the company details, clearly marked as a placeholder', (_n, h) => {
  expect(COMPANY_DETAILS_PLACEHOLDER).toBe(true);
  expect(h).toContain('<h2>Who runs SportClan</h2>');
  expect(h).toContain('class="company placeholder"');
  expect(h).toMatch(/\[PLACEHOLDER — company not registered yet\] SportClan _+ Private Limited/);
  expect(h).toMatch(/\[PLACEHOLDER\] CIN: _+/);
  expect(h).toContain('These company details are a placeholder and will be filled in once the company is registered.');
});
it('privacy: says there are no payments, and links the deletion page', () => {
  expect(text(pages.privacy)).toContain('There are no payments: coins can’t be bought and have no cash value.');
  expect(pages.privacy).toContain('<a href="/delete-account.html">How to delete your account</a>');
});
it('delete page: the app’s steps and what happens, nothing to cancel, a way without the app', () => {
  const t = text(pages.delete);
  expect(t).toContain('Go to Profile → Settings → Delete account.');
  expect(t).toContain('Type DELETE, tap “Delete my account”, then confirm it’s you with your password or a sign-in code.');
  expect(t).toContain('Your account is deleted straight away.');
  expect(t).toContain('Your phone number is held for 30 days so nobody can sign back in to the account.');
  expect(t).toContain('Posts and messages you wrote stay, shown as “Deleted User”');
  expect(t).toContain('SportClan has no payments and no paid plans: there is nothing to cancel or refund.');
  expect(t).toMatch(/Can’t open the app\?/);
  expect(t).not.toMatch(/within 30 days|72 hours|support@sportclan\.in/);
});
it('the delete page is served before the static files, like the policy', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
  expect(idx).toMatch(/app\.get\('\/delete-account\.html', \(_req, res\) => \{ res\.type\('html'\)\.send\(deleteAccountHtml\(\)\); \}\);/);
  expect(idx.indexOf("app.get('/delete-account.html'")).toBeLessThan(idx.indexOf('express.static'));
});
