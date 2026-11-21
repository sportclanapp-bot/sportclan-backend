#!/usr/bin/env node
/**
 * Q9 (Dipak, 21 Nov 2026: "make their accounts locally so they run before a deploy").
 * Seeds the accounts and data the 14 `src/__tests__/*.integration.test.ts` files need on the
 * LOCAL stack (backend http://localhost:4100 + the local DB through ~/SportClan/localdb/q), then
 * writes `src/__tests__/.local-fixtures.json` (git-ignored) with the local ids the tests read
 * (Aarav's id, the inactive kabaddi / athletics sport ids).
 *
 * Idempotent: an account that signs in is reused, data already there is not made again.
 * Local only: refuses any other server. Sign-up codes are read from the local otp_codes table
 * (the local server sends no SMS; the numbers are local test numbers +91 90000 9xxxx
 * that no local account holds).
 * Writes only through the API, except the reads of otp_codes / existing rows.
 *
 *   node scripts/seed-local-integration.mjs
 *   npx jest --runInBand $(ls src/__tests__/*.integration.test.ts)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.SC_BASE || 'http://localhost:4100').replace(/\/+$/, '');
const host = new URL(BASE).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`Refusing to seed ${BASE}: this script is for the local stack only.`);
  process.exit(1);
}
const QBIN = path.join(os.homedir(), 'SportClan', 'localdb', 'q');
const q = (sql) => execFileSync(QBIN, ['-Atc', sql]).toString().trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const OUT = path.join(HERE, '..', 'src', '__tests__', '.local-fixtures.json');

// The local server's rate-limit bypass (start-backend.sh hands it .env's SC_RATE_LIMIT_BYPASS),
// sent the same way the integration tests send it. Never printed.
const envFile = path.join(HERE, '..', '.env');
const envLine = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('SC_RATE_LIMIT_BYPASS=')) : undefined;
const BYPASS = (process.env.SC_RATE_LIMIT_BYPASS ?? (envLine ? envLine.slice(envLine.indexOf('=') + 1) : '')).replace(/^"|"$/g, '');

async function call(method, p, body, token) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(BYPASS ? { 'x-ratelimit-bypass': BYPASS } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: r.status, json };
}
function must(label, r) {
  if (r.status >= 300) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.json;
}

const sport = (slug) => q(`select id from sports where slug=${lit(slug)}`);
const S = { cricket: sport('cricket'), badminton: sport('badminton'), chess: sport('chess'), tt: sport('table-tennis') };
const AGRA = q(`select id from cities where name='Agra' limit 1`);
if (!AGRA || !S.cricket) throw new Error('local DB has no Agra city / cricket sport — rebuild the local DB first');

// The fixed QA accounts the tests sign in with, plus Aarav (the "well-played Agra cricketer") and
// three opponents. Passwords are the tests' own local QA passwords (no secrets).
const ACCOUNTS = [
  { key: 'agra', email: 'z326agra.qa@sportclan.test', pw: 'SportClanZ326pass', name: 'Z326 Agra QA', username: 'z326agra_qa', city: AGRA, sports: [S.cricket, S.badminton, S.chess, S.tt] },
  { key: 'empty', email: 'z19empty.qa@sportclan.test', pw: 'SportClanZ19pass', name: 'Z19 Empty QA', username: 'z19empty_qa', sports: [S.cricket] },
  { key: 'recap', email: 'z16recap.qa@sportclan.test', pw: 'SportClanZ16pass', name: 'Z16 Recap QA', username: 'z16recap_qa', sports: [S.cricket] },
  { key: 'aarav', email: 'aarav.ali.qa@sportclan.test', pw: 'SportClanAarav9pass', name: 'Aarav Ali', username: 'aarav_ali_qa', city: AGRA, sports: [S.cricket, S.badminton, S.chess, S.tt] },
  { key: 'opp1', email: 'zint.opp1.qa@sportclan.test', pw: 'SportClanOpp1pass', name: 'Zint Opp One', username: 'zint_opp1_qa', city: AGRA, sports: [S.cricket, S.badminton, S.chess, S.tt] },
  { key: 'opp2', email: 'zint.opp2.qa@sportclan.test', pw: 'SportClanOpp2pass', name: 'Zint Opp Two', username: 'zint_opp2_qa', city: AGRA, sports: [S.cricket] },
  { key: 'opp3', email: 'zint.opp3.qa@sportclan.test', pw: 'SportClanOpp3pass', name: 'Zint Opp Three', username: 'zint_opp3_qa', city: AGRA, sports: [S.cricket] },
];

const A = {};
for (const [i, a] of ACCOUNTS.entries()) {
  let r = await call('POST', '/auth/login', { email: a.email, password: a.pw });
  if (r.status !== 200) {
    const taken = q(`select id from users where lower(email)=lower(${lit(a.email)}) and deleted_at is null`);
    if (taken) throw new Error(`${a.email} exists locally but its password differs; fix it by hand (no deletes)`);
    // The first local test number no account (live or deleted) holds.
    let phone = '';
    for (let n = 9001 + i * 37; !phone; n++) {
      const cand = `+91900009${String(n % 10000).padStart(4, '0')}`;
      if (!q(`select 1 from users where phone=${lit(cand)} limit 1`)) phone = cand;
    }
    must(`send-otp ${a.key}`, await call('POST', '/auth/send-otp', { phone, purpose: 'register' }));
    const code = q(`select code from otp_codes where phone=${lit(phone)} order by created_at desc limit 1`);
    must(`register ${a.key}`, await call('POST', '/auth/register', {
      phone, code, name: a.name, username: a.username, email: a.email, password: a.pw,
      account_types: ['player'], sport_ids: a.sports, gender: 'male', dob: '1995-01-01', ...(a.city ? { city_id: a.city } : {}),
    }));
    r = await call('POST', '/auth/login', { email: a.email, password: a.pw });
  }
  const j = must(`login ${a.key}`, r);
  const token = j.accessToken ?? j.access_token ?? j.token;
  const me = must(`me ${a.key}`, await call('GET', '/users/me', undefined, token));
  A[a.key] = { token, id: me.user.id };
  if (a.city && me.user.city_id !== a.city) must(`city ${a.key}`, await call('PATCH', '/users/me', { city_id: a.city }, token));
}
const as = (k, m, p, b) => call(m, p, b, A[k].token);

// A ranked singles match won by `winner` side, between a (side A, creator) and b.
async function rankedSingles(sportId, a, b, winner) {
  const m = must('singles', await as(a, 'POST', '/matches', { sport_id: sportId, mode: 'singles', opponent_id: A[b].id, is_ranked: true, scheduled_at: new Date().toISOString(), venue: 'Zint Local Hall' })).match;
  must('accept', await as(b, 'PATCH', `/matches/${m.id}/availability`, { status: 'available' }));
  must('complete', await as(a, 'POST', `/matches/${m.id}/complete`, { winner_side: winner }));
}
const historyIn = (k, sportId) => Number(q(`select count(*) from rating_history where user_id=${lit(A[k].id)} and sport_id=${lit(sportId)}`));

// Badminton, chess and table tennis: one ranked match each (rating history in that sport).
for (const sid of [S.badminton, S.chess, S.tt]) {
  if (historyIn('aarav', sid) === 0) await rankedSingles(sid, 'aarav', 'opp1', 'A');
}

// Cricket: two registered teams; Aarav needs 5+ ranked matches (advanced stats is not lowData).
async function teamOf(owner, name, members) {
  let id = q(`select id from teams where name=${lit(name)} and created_by=${lit(A[owner].id)} and deleted_at is null limit 1`);
  if (!id) id = must('team', await as(owner, 'POST', '/teams', { sport_id: S.cricket, name })).team.id;
  for (const k of members) {
    const there = q(`select 1 from team_members where team_id=${lit(id)} and user_id=${lit(A[k].id)}`);
    if (!there) must(`member ${k}`, await as(owner, 'POST', `/teams/${id}/members`, { user_id: A[k].id }));
  }
  return id;
}
const TA = await teamOf('aarav', 'Zint Agra Strikers', ['opp1']);
const TB = await teamOf('opp2', 'Zint Agra Rivals', ['opp3']);
const wins = ['A', 'A', 'B', 'A', 'A', 'B'];
for (let n = historyIn('aarav', S.cricket); n < wins.length; n++) {
  const m = must('cricket', await as('aarav', 'POST', '/matches', {
    sport_id: S.cricket, team_a_id: TA, team_b_id: TB, team_a_name: 'Zint Agra Strikers', team_b_name: 'Zint Agra Rivals',
    scheduled_at: new Date().toISOString(), venue: 'Zint Local Ground', city_id: AGRA, is_ranked: true,
  })).match;
  must('lineup', await as('aarav', 'POST', `/matches/${m.id}/participants`, { participants: [
    { user_id: A.aarav.id, team_side: 'A' }, { user_id: A.opp1.id, team_side: 'A' },
    { user_id: A.opp2.id, team_side: 'B' }, { user_id: A.opp3.id, team_side: 'B' },
  ] }));
  for (const k of ['aarav', 'opp2']) must(`in ${k}`, await as(k, 'PATCH', `/matches/${m.id}/availability`, { status: 'available' }));
  must('complete', await as('aarav', 'POST', `/matches/${m.id}/complete`, { winner_side: wins[n] }));
}

// z16recap: exactly one (casual) cricket match.
if (!q(`select 1 from match_participants mp join matches m on m.id=mp.match_id where mp.user_id=${lit(A.recap.id)} and m.sport_id=${lit(S.cricket)} limit 1`)) {
  const m = must('recap', await as('recap', 'POST', '/matches', { sport_id: S.cricket, team_a_name: 'Zint Recap A', team_b_name: 'Zint Recap B', scheduled_at: new Date().toISOString(), venue: 'Zint Local Ground' })).match;
  must('recap lineup', await as('recap', 'POST', `/matches/${m.id}/participants`, { participants: [{ user_id: A.recap.id, team_side: 'A' }, { user_id: A.opp1.id, team_side: 'B' }] }));
  must('recap complete', await as('recap', 'POST', `/matches/${m.id}/complete`, { winner_side: 'A' }));
}

// Aarav is followed and follows (the follower / following count check), and has a post in the feed.
for (const [who, whom] of [['opp1', 'aarav'], ['opp2', 'aarav'], ['aarav', 'opp3']]) {
  if (!q(`select 1 from follow_relationships where follower_id=${lit(A[who].id)} and following_id=${lit(A[whom].id)}`)) {
    must(`follow ${who}`, await as(who, 'POST', `/users/${A[whom].id}/follow`));
  }
}
if (!q(`select 1 from community_posts where author_id=${lit(A.aarav.id)} and deleted_at is null limit 1`)) {
  must('post', await as('aarav', 'POST', '/community/posts', { content: 'Zint local seed: good game at the ground today.' }));
}

const fixtures = {
  aarav: A.aarav.id,
  kabaddi: q(`select id from sports where slug='kabaddi'`),
  athletics: q(`select id from sports where slug='athletics'`),
};
fs.writeFileSync(OUT, JSON.stringify(fixtures, null, 1) + '\n');
console.log('seeded:', Object.keys(A).join(' '), '· fixtures →', path.relative(process.cwd(), OUT));
