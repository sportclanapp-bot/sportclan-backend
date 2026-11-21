/** Audit #150: test suites default to the local server; live needs SC_LIVE=1. */
import { resolveBase, isLocalBase, LOCAL_BASE, fixtureId } from './targetBase';

describe('test target (audit #150)', () => {
  it('defaults to the local server', () => {
    expect(resolveBase({} as NodeJS.ProcessEnv)).toBe(LOCAL_BASE);
  });
  it('refuses live without SC_LIVE=1', () => {
    expect(() => resolveBase({ SC_BASE: 'https://sportclan-backend.onrender.com' } as NodeJS.ProcessEnv)).toThrow(/Refusing/);
  });
  it('allows live only with SC_LIVE=1', () => {
    expect(resolveBase({ SC_BASE: 'https://sportclan-backend.onrender.com/', SC_LIVE: '1' } as NodeJS.ProcessEnv)).toBe('https://sportclan-backend.onrender.com');
  });
  it('treats localhost, 127.0.0.1 and the emulator host as local', () => {
    expect(isLocalBase('http://localhost:4100')).toBe(true);
    expect(isLocalBase('http://127.0.0.1:4200')).toBe(true);
    expect(isLocalBase('http://10.0.2.2:4100')).toBe(true);
    expect(isLocalBase('https://example.com')).toBe(false);
  });
});

describe('Q9 · fixtureId: local twins of the live QA fixture ids', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  afterEach(() => jest.restoreAllMocks());
  test('against live (SC_BASE + SC_LIVE=1) the live id is kept and no local file is read', () => {
    const spy = jest.spyOn(fs, 'readFileSync');
    expect(fixtureId('aarav', 'live-id', { SC_BASE: 'https://example.com', SC_LIVE: '1' } as any)).toBe('live-id');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  test('on the local stack the seeded id is used', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValueOnce(true);
    jest.spyOn(fs, 'readFileSync').mockReturnValueOnce(JSON.stringify({ aarav: 'local-aarav' }) as any);
    expect(fixtureId('aarav', 'live-id', {} as any)).toBe('local-aarav');
  });
  test('on the local stack with no seed it says to run the seed script', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);
    expect(() => fixtureId('aarav', 'live-id', {} as any)).toThrow(/seed-local-integration\.mjs/);
  });
});
