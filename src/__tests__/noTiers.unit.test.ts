/**
 * SC-434 / SC-435 · there are no tiers, and no column left to grow one back from.
 *
 * SC-434 opened eight gates by flipping one helper to `true`. SC-435 deleted the
 * helper and the columns it read — `is_premium`, `premium_expires_at`,
 * `trial_used`, `last_premium_reminder_at` — which migration 091 drops from prod.
 *
 * So this reads the SOURCE. A query that still selects a dropped column does not
 * fail at compile time; it fails at runtime, on whichever screen happens to call
 * it, in production. That is exactly the failure a test can cheaply prevent and a
 * type-checker cannot.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
    return p.endsWith('.ts') ? [p] : [];
  });

/** Source lines with comments stripped — the notes explaining a removal are the
 *  one place these names are allowed to survive. */
const codeLines = (file: string): Array<{ n: number; line: string }> => {
  const out: Array<{ n: number; line: string }> = [];
  let inBlock = false;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (inBlock) { if (t.includes('*/')) inBlock = false; return; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return; }
    if (t.startsWith('//') || t.startsWith('*')) return;
    out.push({ n: i + 1, line });
  });
  return out;
};

const files = walk(SRC);
const rel = (f: string) => path.relative(SRC, f);
const hits = (re: RegExp) =>
  files.flatMap((f) => codeLines(f).filter(({ line }) => re.test(line))
    .map(({ n, line }) => `${rel(f)}:${n}  ${line.trim()}`));

describe('SC-435 · nothing reads the dropped columns', () => {
  test('no query selects or writes is_premium', () => {
    expect(hits(/\bis_premium\b/).filter((h) => !h.includes('p_is_premium'))).toEqual([]);
  });

  test('no query selects or writes premium_expires_at', () => {
    expect(hits(/\bpremium_expires_at\b/)).toEqual([]);
  });

  test('no query selects or writes trial_used', () => {
    expect(hits(/\btrial_used\b/)).toEqual([]);
  });

  test('no query selects or writes last_premium_reminder_at', () => {
    expect(hits(/\blast_premium_reminder_at\b/)).toEqual([]);
  });

  test('nothing reads the payment-only tables', () => {
    // subscriptions / coupon_codes / coupon_usages are dropped by 091. A live
    // read of any of them is a 500 waiting for whoever opens that screen.
    expect(hits(/from\(['"](subscriptions|coupon_codes|coupon_usages)['"]\)/)).toEqual([]);
    expect(hits(/exportAll\(['"](subscriptions|coupon_codes|coupon_usages)['"]/)).toEqual([]);
  });

  test('the isPremiumActive helper is gone', () => {
    expect(fs.existsSync(path.join(SRC, 'utils', 'premium.ts'))).toBe(false);
    expect(hits(/isPremiumActive/)).toEqual([]);
  });
});

describe('SC-435 · the p_is_premium fallback is deliberate, and bounded', () => {
  test('it appears ONLY as a legacy fallback, never as the first call', () => {
    // Migration 091 drops the parameter. Until it is applied everywhere, the
    // controllers ask for the new signature first and retry with the old one on
    // PGRST202. Any OTHER use would mean something still depends on the column.
    const uses = hits(/p_is_premium/);
    expect(uses).toHaveLength(2);
    expect(uses.every((u) => /community\.controller|profilePosts\.controller/.test(u))).toBe(true);
  });

  test('both call sites retry on PGRST202 rather than assuming a shape', () => {
    for (const f of ['controllers/community.controller.ts', 'controllers/profilePosts.controller.ts']) {
      const src = fs.readFileSync(path.join(SRC, f), 'utf8');
      expect(src).toMatch(/PGRST202/);
    }
  });
});

describe('SC-434 · what did NOT change', () => {
  // The opposite failure: a cleanup so keen it takes the economy with the tiers.
  it('gifts cost what they always cost', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getCatalogue } = require('../controllers/gifts.controller');
    let payload: { gifts: Array<{ id: string; cost: number }> } | undefined;
    getCatalogue({}, { json: (p: never) => { payload = p; return undefined; } });
    const byId = Object.fromEntries((payload?.gifts ?? []).map((g) => [g.id, g.cost]));
    expect(byId).toEqual({
      gold_trophy: 15, silver_trophy: 10, gold_medal: 12, silver_medal: 8,
      best_player: 10, flowers: 5, star_player: 12, appreciation: 5,
      fire: 5, crown: 8,
    });
  });

  it('the coin ledger is untouched — it is NOT payment machinery', () => {
    // transactions / coin_events / gift_transactions and coin_balance all stay.
    // Coins are earned and spent; they were never bought.
    const coins = fs.readFileSync(path.join(SRC, 'utils', 'coins.ts'), 'utf8');
    expect(coins).toMatch(/coin_events/);
    expect(coins).toMatch(/increment_coins/);
    expect(coins).toMatch(/from\('transactions'\)/);
  });
});
