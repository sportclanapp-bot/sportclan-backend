/**
 * Audit #150: the integration suites talk to the LOCAL server by default.
 * Reaching any other server (live) needs SC_LIVE=1 as well as SC_BASE, so
 * `npx jest` with no settings can never write to live.
 */
export const LOCAL_BASE = 'http://localhost:4100';

export function isLocalBase(base: string): boolean {
  try {
    const h = new URL(base).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '10.0.2.2' || h === '::1';
  } catch {
    return false;
  }
}

export function resolveBase(env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.SC_BASE || LOCAL_BASE).replace(/\/+$/, '');
  if (!isLocalBase(base) && env.SC_LIVE !== '1') {
    throw new Error(`Refusing to run against ${base}: not a local server. Set SC_LIVE=1 too if you really mean live.`);
  }
  return base;
}

/** http for a local server, https for anything else. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
export function transportFor(u: URL): typeof import('https') | typeof import('http') {
  return u.protocol === 'http:' ? require('http') : require('https');
}
