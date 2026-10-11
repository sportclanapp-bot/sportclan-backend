/**
 * Release prep 2.16.0 (11 Oct 2026) · which app is asking. Testers on 2.15.0
 * meet the new backend before they update; where 2.15.0 can't do what the
 * server now asks (it has no screen for it), the server says so plainly —
 * "Update SportClan to …" — instead of a refusal the old app can't act on, or
 * a success the old app would misdescribe.
 *
 * The app sends X-Client-Version (every version since 2.x). No header (a
 * script, the web, a test) is treated as current.
 */
import type { Request } from 'express';

/** The first app version that has every batch 1–4 screen. */
export const CURRENT_APP = '2.16.0';

const parts = (v: string) => (v.match(/\d+(?:\.\d+)*/)?.[0] ?? '0').split('.').map((x) => parseInt(x, 10) || 0);

/** -1 / 0 / 1, like a sort. "v2.15.0" and "2.15.0-b3" read as 2.15.0. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a); const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function clientVersionOf(req: Pick<Request, 'headers'>): string | null {
  const v = req.headers?.['x-client-version'];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

/** An app older than `min` (default 2.16.0). No header → not old. */
export function isOlderApp(req: Pick<Request, 'headers'>, min: string = CURRENT_APP): boolean {
  const v = clientVersionOf(req);
  return !!v && compareVersions(v, min) < 0;
}

/**
 * The answer an older app gets for something only the update can do. A 403:
 * 2.15.0 shows a 403's words as they are on every screen these reach (a 409 at
 * "send code" it rewrites as "That number is already on another account", and
 * a 401 signs it out).
 */
export function updateRequired(what: string): { status: number; body: { error: string; code: 'UPDATE_REQUIRED' } } {
  return { status: 403, body: { error: `Update SportClan to ${what}.`, code: 'UPDATE_REQUIRED' } };
}
