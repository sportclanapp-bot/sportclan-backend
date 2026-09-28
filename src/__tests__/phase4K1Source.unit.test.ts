/**
 * Phase 4 · K1 — early fixes that live in wiring, SQL files, the dev seeder and
 * select strings. Read as source text (comments stripped) — the same approach
 * as sentryWiring.unit.test.ts, for code that can't be run in isolation.
 */
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
const fnBody = (rel: string, name: string) => {
  const s = code(rel);
  const i = s.indexOf(`export async function ${name}(`);
  if (i < 0) throw new Error(`${name} not found`);
  const j = s.indexOf('\nexport ', i + 10);
  return s.slice(i, j < 0 ? undefined : j);
};

describe('K1-1 (e0da9db) · env loads first; Render proxy trusted', () => {
  const index = code('index.ts');
  it('K1-1 (e0da9db): dotenv/config is the first import, before any route or util that reads env', () => {
    const first = index.match(/^import[^\n]*$/m)![0];
    expect(first).toBe("import 'dotenv/config';");
  });
  it('K1-1 (e0da9db): trust proxy is set to one hop (real client IP for rate limits behind Render)', () => {
    expect(index).toMatch(/app\.set\('trust proxy', 1\);/);
    expect(index.indexOf("app.set('trust proxy', 1)")).toBeLessThan(index.indexOf('rateLimit('));
  });
});

describe('K1-2 (ca53c90) · migration 006 has no quotes inside -- comments', () => {
  it('K1-2 (ca53c90): the Supabase SQL editor mis-parses a quote in a comment — 006 must have none', () => {
    const sql = read('../supabase/migrations/006_payments_gifts_settings.sql');
    const commentsWithQuotes = sql.split('\n').filter((l) => /--.*'/.test(l));
    expect(commentsWithQuotes).toEqual([]);
  });
});

describe('K1-12 (413235f) · dev seeder: cricket events without an .in() over every inserted id', () => {
  it('K1-12 (413235f): STEP 9 never passes the inserted match ids to .in() (hundreds of UUIDs overflowed the URL)', () => {
    const s = code('controllers/dev.controller.ts');
    const step9 = s.slice(s.indexOf('const cricketSportId = sportIdByName.get'), s.indexOf("from('match_events').insert"));
    expect(step9.length).toBeGreaterThan(0);
    expect(step9).not.toMatch(/\.in\('id',\s*insertedMatchIds\)/);
  });
});

describe('K1-15 (76e0fa6) · users.name, never the non-existent full_name', () => {
  it('K1-15 (76e0fa6): no controller or route selects, filters, orders or reads full_name', () => {
    const dirs = ['controllers', 'routes', 'utils'];
    const hits: string[] = [];
    for (const d of dirs) {
      for (const f of fs.readdirSync(path.join(__dirname, '..', d))) {
        if (!f.endsWith('.ts')) continue;
        if (/full_name/.test(code(`${d}/${f}`))) hits.push(`${d}/${f}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('K1-25 (0498465) · the timeline gets the computed line as `text`, plus the raw payload', () => {
  it('K1-25 (0498465): getCommentary emits text: commentary and payload alongside commentary', () => {
    const f = fnBody('controllers/matches.controller.ts', 'getCommentary');
    expect(f).toMatch(/\n\s*commentary,\n\s*text: commentary,\n\s*payload: p,/);
  });
});

describe('K1-30i (48f4849, A6-012) · the dev seeder writes canonical lowercase account types', () => {
  it('K1-30i (48f4849): seeded roles are player/umpire/coach/business — no Umpire-Referee style strings', () => {
    const s = code('controllers/dev.controller.ts');
    const block = s.slice(s.indexOf("let accountType = "), s.indexOf('userRows.push('));
    expect(block).toContain("let accountType = 'player';");
    for (const t of ['umpire', 'coach', 'business']) expect(block).toContain(`accountType = '${t}';`);
    expect(block).not.toMatch(/'(Player|Umpire-Referee|Trainer-Coach|Business-Vendor)'/);
  });
});
