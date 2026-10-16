/**
 * N-RWG2-15 (launch test plan): the server's /terms.html still described paid
 * Premium via Razorpay and a 5-post monthly limit, which the app no longer has.
 * It is now built from the app's own terms text (src/legal/termsOfService.ts).
 */
import fs from 'fs';
import path from 'path';
import { termsOfServiceHtml } from '../legal/termsPage';
import { TERMS_OF_SERVICE } from '../legal/termsOfService';

const html = termsOfServiceHtml();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
it('every paragraph of the shared terms is on the page, under its heading', () => {
  for (const s of TERMS_OF_SERVICE.sections) {
    expect(html).toContain(esc(s.label));
    for (const p of s.paragraphs) expect(html).toContain(esc(p));
  }
  expect(html).toContain(`Effective ${TERMS_OF_SERVICE.effectiveDate}`);
});
it('nothing the app doesn’t have: no Premium, no payments, no post limit', () => {
  expect(html).not.toMatch(/Premium|Razorpay|subscription|auto-renew|in-app purchase|5 text-only posts|11 April 2026/i);
});
it('the stale static copy is gone and the route is served before the static files', () => {
  expect(fs.existsSync(path.join(__dirname, '../../public/terms.html'))).toBe(false);
  const idx = fs.readFileSync(path.join(__dirname, '../index.ts'), 'utf8');
  expect(idx.indexOf("app.get('/terms.html'")).toBeGreaterThan(-1);
  expect(idx.indexOf("app.get('/terms.html'")).toBeLessThan(idx.indexOf('express.static'));
});
