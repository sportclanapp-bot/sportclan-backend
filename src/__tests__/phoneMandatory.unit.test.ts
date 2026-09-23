/**
 * Phone is mandatory at signup. Email is optional and unverified.
 *
 * Decision of 23 Sep 2026, made because there is no email provider: nothing
 * can ever be sent to an address, so an account whose only credential is an
 * email has no recovery route at all. The phone-less signup path made exactly
 * that account, with a `+0…` placeholder phone nobody held.
 */
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('there is no phone-less signup', () => {
  it('POST /auth/register-email is gone', () => {
    expect(code('routes/auth.routes.ts')).not.toContain('register-email');
    expect(code('controllers/auth.controller.ts')).not.toContain('registerEmail');
  });

  it('and so is the placeholder phone it minted', () => {
    // `+0${Date.now()}` was how a NOT-NULL column took an account with no number.
    expect(code('controllers/auth.controller.ts')).not.toMatch(/\+0\$\{Date\.now\(\)\}/);
  });

  it('the one path still requires a verified phone', () => {
    const a = code('controllers/auth.controller.ts');
    expect(a).toContain("if (!phone || !code) return res.status(400).json({ error: 'phone and code are required' });");
  });
});

describe('email + password ride on the phone signup as extras', () => {
  const a = code('controllers/auth.controller.ts');

  it('register accepts an optional password and hashes it', () => {
    expect(a).toMatch(/password_hash: password \? await bcrypt\.hash\(password, 10\) : null/);
  });

  it('a short password is refused, an absent one is fine', () => {
    expect(a).toContain("if (password != null && (typeof password !== 'string' || password.length < 8))");
  });

  it('email stays optional on that path', () => {
    expect(a).toContain('email: email || null,');
  });
});

describe('recovery is by phone, and only by phone', () => {
  it('resetPassword takes a phone and an OTP code', () => {
    const a = code('controllers/auth.controller.ts');
    const fn = a.slice(a.indexOf('export async function resetPassword'));
    expect(fn).toContain('const { phone, code, newPassword } = req.body || {};');
    expect(fn.slice(0, 1200)).not.toMatch(/email/i);
  });

  it('no email-sending library exists anywhere — this is a decision, not an omission', () => {
    const pkg = JSON.parse(read('../package.json'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(' ');
    expect(deps).not.toMatch(/nodemailer|sendgrid|@aws-sdk\/client-ses|resend|postmark|mailgun/i);
  });
});

describe('accounts without a number are told, not locked out', () => {
  const u = code('controllers/users.controller.ts');
  const fn = u.slice(u.indexOf('export async function getProfileCompleteness'));

  it('the completeness score reads the phone', () => {
    expect(fn).toContain("'phone, name, email, city_id, profile_picture_url, bio'");
    expect(fn).toContain("!String(user.phone).startsWith('+0')");
  });

  it('phone is the FIRST item in the list', () => {
    // Missing fields are reported in check order; this is the one that is not
    // cosmetic, so it is the one a person sees first.
    expect(fn).toMatch(/const checks[^\]]*\[\s*\{ field: 'phone'/);
  });

  it('and the weights still sum to 100 with sports', () => {
    const weights = [...fn.matchAll(/weight: (\d+)/g)].map((m) => Number(m[1]));
    expect(weights.reduce((s, w) => s + w, 0) + 15).toBe(100);
  });

  it('the email-only accounts can still sign in — login is untouched', () => {
    const a = code('controllers/auth.controller.ts');
    expect(a).toContain('export async function login(');
    expect(code('routes/auth.routes.ts')).toContain("'/login'");
  });
});
