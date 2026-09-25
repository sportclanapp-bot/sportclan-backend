/**
 * Per-request database timing, on every response as Server-Timing:
 *
 *   db;desc="9 calls, 7 rounds";dur=2100, app;dur=2250
 *
 * `rounds` counts how many times the database went from idle to busy during the
 * request — i.e. sequential round-trips. From Render each costs ~300 ms, so a
 * high `rounds` is the signature of the slowness found in completion and match
 * detail (~25 and ~11 rounds). `dur` on db is wall time with at least one call
 * in flight. Measured through Supabase's fetch hook, so every query counts
 * without touching a handler.
 */
import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';

interface Store {
  start: number;
  calls: number;
  rounds: number;
  active: number;
  busySince: number;
  wall: number;
}

const als = new AsyncLocalStorage<Store>();

export function timedFetch(base: typeof fetch = fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const st = als.getStore();
    if (!st) return base(input, init);
    st.calls += 1;
    if (st.active === 0) { st.rounds += 1; st.busySince = Date.now(); }
    st.active += 1;
    try {
      return await base(input, init);
    } finally {
      st.active -= 1;
      if (st.active === 0) st.wall += Date.now() - st.busySince;
    }
  }) as typeof fetch;
}

/** The Server-Timing entries for a store (exported for tests). */
export function timingEntries(st: Pick<Store, 'calls' | 'rounds' | 'wall' | 'start'>, now = Date.now()): string {
  return `db;desc="${st.calls} calls, ${st.rounds} rounds";dur=${st.wall}, app;dur=${now - st.start}`;
}

export function dbTimingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const st: Store = { start: Date.now(), calls: 0, rounds: 0, active: 0, busySince: 0, wall: 0 };
  const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => Response;
  (res as unknown as { writeHead: (...a: unknown[]) => Response }).writeHead = (...args: unknown[]) => {
    try {
      const prev = res.getHeader('Server-Timing');
      const mine = timingEntries(st);
      res.setHeader('Server-Timing', prev ? `${String(prev)}, ${mine}` : mine);
    } catch { /* headers already sent — nothing to add */ }
    return writeHead(...args);
  };
  als.run(st, () => next());
}
