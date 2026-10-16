/**
 * N-R4-6 (launch test plan, Round 4): server tests read the app checkout by a
 * fixed `../sportclan-v2`, so in any git worktree one failed with ENOENT and the
 * rest skipped their byte-for-byte check without a word. They now find the app
 * through src/__tests__/helpers/otherRepo.ts.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findOtherRepo, OTHER_REPO_ENV } from './helpers/otherRepo';

const mkRepo = (dir: string) => {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  return dir;
};

describe('finding the app checkout', () => {
  let base: string;
  beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'nr46-')); });
  afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

  test('the usual side-by-side checkout', () => {
    const be = mkRepo(path.join(base, 'sportclan-backend'));
    const app = mkRepo(path.join(base, 'sportclan-v2'));
    expect(findOtherRepo(be, {})).toBe(app);
  });

  test('a git worktree pair: <name>-be finds <name>-app', () => {
    const be = mkRepo(path.join(base, 'r5-x-be'));
    const app = mkRepo(path.join(base, 'r5-x-app'));
    mkRepo(path.join(base, 'r5-y-app')); // another pair's is not ours
    expect(findOtherRepo(be, {})).toBe(app);
  });

  test('the env var wins, and a wrong one fails loudly rather than skipping', () => {
    const be = mkRepo(path.join(base, 'sportclan-backend'));
    mkRepo(path.join(base, 'sportclan-v2'));
    const elsewhere = mkRepo(path.join(base, 'elsewhere', 'app'));
    expect(findOtherRepo(be, { [OTHER_REPO_ENV]: elsewhere })).toBe(elsewhere);
    expect(() => findOtherRepo(be, { [OTHER_REPO_ENV]: path.join(base, 'nope') })).toThrow(OTHER_REPO_ENV);
  });

  test('no app anywhere → null (the tests that need it skip and say why)', () => {
    const be = mkRepo(path.join(base, 'lonely-be'));
    fs.mkdirSync(path.join(base, 'lonely-app')); // an empty folder is not a checkout
    expect(findOtherRepo(be, {})).toBeNull();
  });
});

test('no server test reads the app by a fixed path', () => {
  const offenders: string[] = [];
  for (const f of fs.readdirSync(__dirname)) {
    if (!/\.test\.ts$/.test(f) || f === path.basename(__filename)) continue;
    const code = fs.readFileSync(path.join(__dirname, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    if (/['"`](?:\.\.\/)+sportclan-v2|['"]sportclan-v2['"]/.test(code)) offenders.push(f);
  }
  expect(offenders).toEqual([]);
});
