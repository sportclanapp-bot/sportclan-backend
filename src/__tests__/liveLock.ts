/**
 * Live integration suites share QA accounts on the deployed backend. Several
 * WRITE shared state and then assert exact values: the invite suites all
 * invite z19empty from z326agra for the same sports, follow toggles the same
 * follow, the like suite likes one post. Jest runs suites in parallel workers,
 * so whenever two of those overlapped, each saw the other's half-done state —
 * reproduced by running the integration suites twice at once: the invite,
 * follow and like suites failed every time (5–6 tests), and in a single run it
 * came down to scheduling (the "3 failed right after a deploy" run, where a
 * fresh instance made every suite slower and overlaps likelier).
 *
 * A suite that touches shared state holds a NAMED lock for its whole run, so
 * suites on the same state take turns — across jest workers and across
 * concurrent jest processes on this machine. Suites on different state, and all
 * the read-only ones, still run in parallel.
 *
 * The lock is a directory (mkdir is atomic). Its holder refreshes it every few
 * seconds; one not refreshed for STALE_MS is a crashed holder and is taken over.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const STALE_MS = 60_000;
const BEAT_MS = 5_000;

export async function acquireLiveLock(name: string, timeoutMs = 10 * 60_000): Promise<() => void> {
  const dir = path.join(os.tmpdir(), `sportclan-live-lock-${name}`);
  const started = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'owner'), `${process.pid} ${new Date().toISOString()}`);
      const beat = setInterval(() => {
        try { const t = new Date(); fs.utimesSync(dir, t, t); } catch { /* released */ }
      }, BEAT_MS);
      beat.unref();
      return () => {
        clearInterval(beat);
        fs.rmSync(dir, { recursive: true, force: true });
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs > STALE_MS) fs.rmSync(dir, { recursive: true, force: true });
      } catch { /* released between stat and rm */ }
      if (Date.now() - started > timeoutMs) throw new Error(`live lock "${name}" not acquired in ${timeoutMs} ms`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

/**
 * Wait until the deployed backend answers /health with the SAME commit three
 * times in a row. Right after a deploy, Render can still route some requests to
 * the old instance while /health already shows the new one.
 */
export async function waitForStableDeploy(base: string, timeoutMs = 3 * 60_000): Promise<void> {
  const started = Date.now();
  let last = '';
  let same = 0;
  while (Date.now() - started < timeoutMs) {
    const commit = await fetch(`${base}/health`).then((r) => r.json()).then((j: { commit?: string }) => j.commit ?? '').catch(() => '');
    same = commit && commit === last ? same + 1 : commit ? 1 : 0;
    last = commit;
    if (same >= 3) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** beforeAll/afterAll wiring for a suite: `useLiveLock('qa-pair')` at the top of a describe file. */
export function useLiveLock(name: string): void {
  let release: (() => void) | null = null;
  beforeAll(async () => {
    await waitForStableDeploy(process.env.SC_BASE || 'https://sportclan-backend.onrender.com');
    release = await acquireLiveLock(name);
  }, 15 * 60_000);
  afterAll(() => { release?.(); });
}
