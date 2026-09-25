/**
 * Per-step wall-clock timings for one request (completion took ~10 s and nobody
 * could say where). `mark(name)` closes the step that has been running since the
 * previous mark. The result goes out two ways:
 *   - a `Server-Timing` response header, readable by any client without logs;
 *   - one log line, so Render's logs have it too.
 */
export interface StepTimer {
  mark(name: string): void;
  steps(): Array<{ name: string; ms: number }>;
  total(): number;
  header(): string;
}

export function stepTimer(now: () => number = Date.now): StepTimer {
  const start = now();
  let last = start;
  const list: Array<{ name: string; ms: number }> = [];
  return {
    mark(name) {
      const t = now();
      list.push({ name, ms: t - last });
      last = t;
    },
    steps: () => list.slice(),
    total: () => last - start,
    header: () => [...list.map((s) => `${s.name};dur=${s.ms}`), `total;dur=${last - start}`].join(', '),
  };
}
