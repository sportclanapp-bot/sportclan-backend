/**
 * Audit #18 (11 Oct 2026): the 14mb JSON limit applied to every route, the
 * unauthenticated sign-in routes included. Now 14mb only for uploads and the QR
 * handoff, 100kb for /auth, 2mb elsewhere; uploads get their own budget.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const idx = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
const pos = (needle: string) => { const i = idx.indexOf(needle); expect(i).toBeGreaterThan(-1); return i; };

describe('audit #18: request sizes by route', () => {
  it('14mb only for uploads and the handoff, before the general parser', () => {
    const general = pos("app.use(express.json({ limit: '2mb' }));");
    expect(pos("app.use('/uploads', express.json({ limit: '14mb' }));")).toBeLessThan(general);
    expect(pos("express.json({ limit: '14mb' }));")).toBeLessThan(general);
    expect(idx.match(/express\.json\(\{ limit: '14mb' \}\)/g)).toHaveLength(2);
    expect(idx).not.toMatch(/app\.use\(express\.json\(\{ limit: '14mb' \}\)\)/);
  });
  it('100kb for the pre-sign-in /auth routes', () => {
    expect(pos("app.use('/auth', express.json({ limit: '100kb' }));")).toBeLessThan(pos("app.use(express.json({ limit: '2mb' }));"));
  });
  it('uploads have their own per-user budget', () => {
    expect(idx).toContain("app.use('/uploads', uploadLimiter, uploadsRoutes);");
  });
});
