/** Visual review B16 (backend) · services counts, provider rows, officials, venue sport. */
import fs from 'fs';
import path from 'path';
import { OFFICIATING_TYPES, VALID_ACCOUNT_TYPES } from '../constants/accountTypes';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

it('official is a role, and may officiate', () => {
  expect(VALID_ACCOUNT_TYPES).toContain('official');
  expect(OFFICIATING_TYPES).toContain('official');
  expect(code('controllers/matches.controller.ts')).toMatch(/\.in\('account_type', \[\.\.\.OFFICIATING_TYPES\]\)/);
  expect(code('controllers/search.controller.ts')).toMatch(/\.in\('account_type', \[\.\.\.OFFICIATING_TYPES\]\)/);
  expect(code('controllers/users.controller.ts')).toMatch(/new Set\(\['umpire', 'official', 'organiser'\]\)/);
});

it('V079: /services/counts filters like the list (deleted, blocked, test)', () => {
  const r = code('routes/services.routes.ts');
  const i = r.indexOf("router.get('/counts'");
  const body = r.slice(i, i + 1200);
  expect(body).toMatch(/\.is\('users\.deleted_at', null\)/);
  expect(body).toMatch(/excludeIds\(q, 'user_id', blocked\)/);
  expect(body).toMatch(/excludeTestEmbed\(q, 'users'\)/);
});

it('V089: provider rows carry city and sports; a city filter', () => {
  const r = code('routes/services.routes.ts');
  expect(r).toMatch(/city:cities!city_id\(name\), sports:user_sports\(sport:sports\(slug, name\)\)/);
  expect(r).toMatch(/if \(cityId\) q = q\.eq\('users\.city_id', cityId\);/);
});

it('V091: venues carry their sport', () => {
  expect(code('controllers/venues.controller.ts')).toMatch(/sport_slug: sport\?\.slug \?\? null/);
});
