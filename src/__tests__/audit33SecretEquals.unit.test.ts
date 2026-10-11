/** Audit #33 (11 Oct 2026): cron and admin secrets are compared in constant time. */
import fs from 'fs';
import path from 'path';
import { secretEquals } from '../utils/secretEqual';

describe('audit #33', () => {
  it('matches only the exact secret; unset never matches', () => {
    expect(secretEquals('s3cret-value', 's3cret-value')).toBe(true);
    expect(secretEquals('s3cret-valuX', 's3cret-value')).toBe(false);
    expect(secretEquals('short', 's3cret-value')).toBe(false);
    expect(secretEquals('', '')).toBe(false);
    expect(secretEquals('anything', undefined)).toBe(false);
    expect(secretEquals(undefined, 'x')).toBe(false);
  });
  it('no secret is compared with !== any more', () => {
    for (const f of ['middleware/cron.middleware.ts', 'controllers/account.controller.ts', 'controllers/seasons.controller.ts']) {
      const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      expect(s).not.toMatch(/!== process\.env\.(CRON_SECRET|ADMIN_KEY)/);
      expect(s).toContain('secretEquals(');
    }
  });
});
