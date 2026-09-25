/**
 * The four device-test QA accounts (roles A, B, C umpire, D spectator) belong to
 * people tapping on phones. The live integration suites must never use them:
 * a suite writing to an account that someone is testing with on a device is how
 * a device session and a suite run disturb each other (z19empty was both a suite
 * fixture and spectator D). Suites keep their own fixtures — z326agra, z19empty,
 * z16recap, … — and this test fails if any test file mentions a device account.
 */
import fs from 'fs';
import path from 'path';

// Emails qa.device.<a-d>@qa.sportclan.test · usernames qadev_<a-d>_qa.
const DEVICE_ACCOUNT = /qa\.device\.[a-d]@|qadev_[a-d]_qa/i;

function testFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return testFiles(p);
    return /\.(ts|js)$/.test(e.name) ? [p] : [];
  });
}

test('no test file uses a device-test QA account', () => {
  const self = path.basename(__filename);
  const offenders = testFiles(__dirname)
    .filter((f) => path.basename(f) !== self)
    .filter((f) => DEVICE_ACCOUNT.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(__dirname, f));
  expect(offenders).toEqual([]);
});

test('the pattern catches the device accounts and nothing else', () => {
  for (const s of ['qa.device.a@qa.sportclan.test', 'qa.device.d@qa.sportclan.test', 'qadev_c_qa', 'QADEV_B_QA']) {
    expect(DEVICE_ACCOUNT.test(s)).toBe(true);
  }
  for (const s of ['z19empty.qa@sportclan.test', 'z326agra.qa@sportclan.test', 'sc434fresh.qa@sportclan.test']) {
    expect(DEVICE_ACCOUNT.test(s)).toBe(false);
  }
});
