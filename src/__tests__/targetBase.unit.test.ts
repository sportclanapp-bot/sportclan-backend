/** Audit #150: test suites default to the local server; live needs SC_LIVE=1. */
import { resolveBase, isLocalBase, LOCAL_BASE } from './targetBase';

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
