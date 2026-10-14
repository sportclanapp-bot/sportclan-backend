/** F011-a (launch test plan, Round 1): /privacy-policy.html says what the app says (one shared text). */
import fs from 'fs';
import path from 'path';
import { privacyPolicyHtml } from '../legal/privacyPage';
import { PRIVACY_POLICY } from '../legal/privacyPolicy';

const html = privacyPolicyHtml();
it('every paragraph of the shared policy is on the page', () => {
  for (const s of PRIVACY_POLICY.sections) for (const p of s.paragraphs) {
    expect(html).toContain(p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  }
});
it('none of the old promises the app doesn’t keep', () => {
  expect(html).not.toMatch(/72 hours|within 30 days|Firebase Analytics|Request Data Export|support@sportclan\.in/i);
});
it('the stale static copy is gone and the route is served before the static files', () => {
  expect(fs.existsSync(path.join(__dirname, '../../public/privacy-policy.html'))).toBe(false);
  const idx = fs.readFileSync(path.join(__dirname, '../index.ts'), 'utf8');
  expect(idx.indexOf("app.get('/privacy-policy.html'")).toBeGreaterThan(-1);
  expect(idx.indexOf("app.get('/privacy-policy.html'")).toBeLessThan(idx.indexOf('express.static'));
});
