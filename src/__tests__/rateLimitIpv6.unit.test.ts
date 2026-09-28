/**
 * Rate-limit keys group IPv6 addresses by network. Every custom keyGenerator
 * keyed on the raw `req.ip`, so an IPv6 user — who normally holds a whole block
 * of addresses — could switch addresses and never reach a per-IP limit, and
 * express-rate-limit warned about it (ERR_ERL_KEY_GEN_IPV6) for the data-export
 * limiter. Keys now go through the library's ipKeyGenerator (a /56 per key).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Request } from 'express';

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

// eslint-disable-next-line import/first
import { rateLimitKey } from '../middleware/rateLimitKey';

const reqFrom = (ip: string | undefined) => ({ ip, headers: {} } as unknown as Request);

describe('IPv6-safe rate-limit keys', () => {
  it('two addresses in the same IPv6 /56 share one key', () => {
    expect(rateLimitKey(reqFrom('2001:db8:abcd:1200::1'))).toBe(rateLimitKey(reqFrom('2001:db8:abcd:12ff:ffff::9')));
  });

  it('different IPv6 networks keep separate keys', () => {
    expect(rateLimitKey(reqFrom('2001:db8:abcd:1200::1'))).not.toBe(rateLimitKey(reqFrom('2001:db8:abcd:1300::1')));
  });

  it('IPv4 keys are unchanged, so existing counts keep their keys', () => {
    expect(rateLimitKey(reqFrom('203.0.113.7'))).toBe('ip:203.0.113.7');
    expect(rateLimitKey(reqFrom(undefined))).toBe('ip:unknown');
  });

  it('the data-export limiter is built without the ERR_ERL_KEY_GEN_IPV6 warning', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      jest.isolateModules(() => { require('../routes/account.routes'); });
      const said = [...err.mock.calls, ...warn.mock.calls].map((c) => c.map(String).join(' ')).join('\n');
      expect(said).not.toMatch(/ERR_ERL_KEY_GEN_IPV6/);
    } finally {
      err.mockRestore();
      warn.mockRestore();
    }
  });

  it("no limiter in index.ts or the routes keys on the raw req.ip (the library's own check)", () => {
    // index.ts can't be imported in a test (it starts the server), so apply the
    // check express-rate-limit runs on each keyGenerator to the source instead.
    const files = ['index.ts', 'routes/account.routes.ts', 'middleware/rateLimitKey.ts'];
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const gens = src.match(/keyGenerator:\s*\([^)]*\)\s*=>\s*(\{[\s\S]*?\n\s*\}|[^\n]*)/g) ?? [];
      for (const g of gens) if (/\breq\.ip\b/.test(g) && !g.includes('ipKeyGenerator')) offenders.push(`${f}: ${g.trim().slice(0, 80)}`);
      // rateLimitKey is passed as a keyGenerator by name; its body counts too.
      const body = /export function rateLimitKey[\s\S]*?\n\}/.exec(src)?.[0];
      if (body && /\breq\.ip\b/.test(body)) offenders.push(`${f}: rateLimitKey`);
    }
    expect(offenders).toEqual([]);
  });
});
