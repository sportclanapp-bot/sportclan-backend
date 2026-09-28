/**
 * TEMPORARY (29 Sep 2026): why isn't the backend reaching Upstash? Reports
 * whether both env vars are present, the URL's host, and one PING's result or
 * error. Never the token, never the full URL. Remove once answered.
 */
export async function redisDiagnostic(): Promise<Record<string, unknown>> {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
  let host: string | null = null;
  let scheme: string | null = null;
  try { const u = new URL(url.trim()); host = u.host; scheme = u.protocol; } catch { /* not a URL */ }
  const out: Record<string, unknown> = {
    url_present: !!url,
    token_present: !!token,
    url_scheme: scheme,
    url_host: host,
    url_has_whitespace_or_quotes: /[\s"']/.test(url),
    token_length: token.length,
    token_has_whitespace_or_quotes: /[\s"']/.test(token),
  };
  if (!url || !token) return { ...out, ping: null, error: 'env var missing' };
  const t0 = Date.now();
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Redis } = require('@upstash/redis');
    const r = new Redis({ url, token, retry: false });
    const times: number[] = [];
    let pong: unknown = null;
    for (let i = 0; i < 3; i++) {
      const t1 = Date.now();
      pong = await Promise.race([
        r.ping(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 5000 ms')), 5000)),
      ]);
      times.push(Date.now() - t1);
    }
    return { ...out, ping: pong, ms: Date.now() - t0, ping_ms_same_client: times };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    return {
      ...out,
      ping: null,
      ms: Date.now() - t0,
      error: e?.name + ': ' + String(e?.message ?? err).replace(token, '<token>').slice(0, 300),
      cause: e?.cause ? `${e.cause.code ?? ''} ${e.cause.message ?? ''}`.trim().slice(0, 200) : null,
    };
  }
}
