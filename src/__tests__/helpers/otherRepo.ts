/**
 * N-R4-6 (launch test plan): where the app checkout is, for the tests that
 * hold a shared file byte for byte to the app's copy or read an app file.
 *
 * Those tests used a fixed `../sportclan-v2`, which is not there beside a git
 * worktree (~/SportClan/wt/<x>-be), so they failed with ENOENT there — or
 * skipped without a word. Now, in order:
 *   1. SPORTCLAN_APP_DIR, when set (a path that isn't there fails loudly:
 *      someone asked for that checkout);
 *   2. ../sportclan-v2 (the usual side-by-side checkout);
 *   3. the paired worktree: <name>-be → <name>-app beside it.
 * When none is there (a lone-repo CI checkout), the test is skipped and its
 * name says why.
 */
import fs from 'fs';
import path from 'path';

export const OTHER_REPO_ENV = 'SPORTCLAN_APP_DIR';
const OTHER_REPO_NAME = 'sportclan-v2';
const SERVER_ROOT = path.join(__dirname, '..', '..', '..');

const isRepo = (dir: string) => fs.existsSync(path.join(dir, 'src')) && fs.existsSync(path.join(dir, 'package.json'));

/** The app checkout for a server checkout at `root`, or null when there is none. */
export function findOtherRepo(root: string = SERVER_ROOT, env: Record<string, string | undefined> = process.env): string | null {
  const set = env[OTHER_REPO_ENV]?.trim();
  if (set) {
    const dir = path.resolve(root, set);
    if (!isRepo(dir)) throw new Error(`${OTHER_REPO_ENV}=${set} is not an app checkout (no src/ and package.json there)`);
    return dir;
  }
  const beside = path.join(root, '..', OTHER_REPO_NAME);
  if (isRepo(beside)) return beside;
  const name = path.basename(path.resolve(root));
  if (name.endsWith('-be')) {
    const pair = path.join(root, '..', `${name.slice(0, -'-be'.length)}-app`);
    if (isRepo(pair)) return pair;
  }
  return null;
}

export const OTHER_REPO_DIR = findOtherRepo();

export const NO_OTHER_REPO =
  `skipped: no app checkout found (set ${OTHER_REPO_ENV}, or check it out at ../${OTHER_REPO_NAME})`;

/** A path inside the app checkout, or null when there is none. */
export const otherRepoPath = (rel: string): string | null => (OTHER_REPO_DIR ? path.join(OTHER_REPO_DIR, rel) : null);

/** An app file's text. Only call it inside testWithOtherRepo. */
export const readOtherRepo = (rel: string): string => {
  if (!OTHER_REPO_DIR) throw new Error(NO_OTHER_REPO);
  return fs.readFileSync(path.join(OTHER_REPO_DIR, rel), 'utf8');
};

/** A test that needs the app checkout: run it when there is one, else skip it and say why. */
export function testWithOtherRepo(name: string, fn: () => void): void {
  if (OTHER_REPO_DIR) test(name, fn);
  else test.skip(`${name} — ${NO_OTHER_REPO}`, fn);
}
