/**
 * B2-a · the 30-day purge, which now never deletes anything.
 *
 * The original issued `DELETE FROM users WHERE id IN (expired)` on the strength
 * of a comment reading "FK cascades on user_id SHOULD clear content
 * automatically". The dry run showed CASCADE on teams/tournaments/matches
 * created_by and on posts, comments, messages and reviews — a departing founder
 * would have taken their team, its tournaments and other people's matches with
 * them — and ten NO ACTION links that would have thrown for the whole batch
 * anyway, from the first account that had ever given kudos.
 *
 * It is a scrub now. These tests exist to keep it one.
 */
import fs from 'fs';
import path from 'path';
import { tombstoneFields } from '../controllers/account.controller';

const ID = '3f0a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const NOW = '2026-09-23T10:00:00.000Z';

describe('what a purged row keeps', () => {
  const row = tombstoneFields(ID, NOW) as Record<string, unknown>;

  it('keeps nothing that identifies a person', () => {
    for (const field of [
      'email', 'password_hash', 'google_id', 'profile_picture_url', 'bio',
      'gender', 'dob', 'city_id', 'state', 'referral_code', 'referred_by',
      'last_active_at', 'last_match_date', 'last_checkin_date',
    ]) {
      expect(`${field}=${String(row[field])}`).toBe(`${field}=null`);
    }
  });

  it('zeroes the counters that describe a person’s habits', () => {
    expect(row.coin_balance).toBe(0);
    expect(row.streak_count).toBe(0);
    expect(row.checkin_streak).toBe(0);
    expect(row.is_available).toBe(false);
  });

  it('uses the SAME phone sentinel re-registration already writes', () => {
    // auth.controller frees a dead account's number with `deleted:<id>` so it
    // can be signed up again. A second shape for the same idea is how one of
    // them ends up unhandled.
    expect(row.phone).toBe(`deleted:${ID}`);
  });

  it('cannot null the phone, because the column is NOT NULL', () => {
    // migration 001: `phone text not null unique`. This is why the sentinel
    // exists at all, and why a future "just null everything" rewrite breaks.
    expect(row.phone).not.toBeNull();
  });

  it('leaves a name to render content under, not a blank', () => {
    expect(row.name).toBe('Deleted User');
    expect(String(row.username)).toMatch(/^deleted_/);
  });

  it('stamps purged_at — the whole idempotency key', () => {
    expect(row.purged_at).toBe(NOW);
  });

  it('does not touch preference columns, which say nothing about a person', () => {
    for (const pref of ['discoverability', 'message_privacy', 'tag_privacy']) {
      expect(Object.prototype.hasOwnProperty.call(row, pref)).toBe(false);
    }
  });

  it('never sets deleted_at — the lockout stays exactly as it was', () => {
    expect(Object.prototype.hasOwnProperty.call(row, 'deleted_at')).toBe(false);
  });
});

describe('the job itself', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'account.controller.ts'),
    'utf8',
  );
  // A guard its own documentation can fail is a guard people delete: the
  // comments above this function describe the DELETE it replaced, at length.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const core = code.slice(
    code.indexOf('export async function purgeExpiredAccountsCore'),
    code.indexOf('export async function purgeExpiredAccounts('),
  );

  it('issues no delete of any kind', () => {
    expect(core).not.toMatch(/\.delete\(/);
    expect(core).not.toMatch(/\bDELETE\b/);
  });

  it('is idempotent on purged_at, not on deleted_at', () => {
    // deleted_at stays set for ever. A job keyed on it alone would re-scrub the
    // same rows every hour until the end of time.
    expect(core).toContain("is('purged_at', null)");
  });

  it('repeats the guard on the WRITE, so two instances cannot double-scrub', () => {
    expect(core.match(/is\('purged_at', null\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('still cannot reach a live account', () => {
    expect(core).toContain("not('deleted_at', 'is', null)");
    expect(core).toContain("lt('deleted_at', cutoff)");
  });

  it('fails one row at a time, not the whole batch', () => {
    // The DELETE version was one statement for every expired account: a single
    // blocking row failed all of them, for ever, and a retry rebuilt the same
    // batch. Per-row means one bad account costs one account.
    expect(core).toMatch(/for \(const \{ id \} of expired/);
    expect(core).toContain('continue;');
  });

  it('holds accounts for 30 days', () => {
    expect(src).toContain('const PURGE_AFTER_MS = 30 * 86400000;');
  });
});

describe('it is actually called', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');

  it('runs on the existing in-process hourly scheduler — no new service (D2)', () => {
    // It was imported into index.ts and never called from the day it was
    // written, which is why "erased after 30 days" had never happened once.
    expect(index).toContain('purgeExpiredAccountsCore()');
    expect(index).toContain('setInterval(runAccountPurge, 60 * 60 * 1000)');
  });

  it('runs once at boot too, so a restart catches up', () => {
    expect(index).toContain('void runAccountPurge();');
  });

  it('a failure is logged, never thrown into the boot path', () => {
    expect(index).toMatch(/\[purge-accounts\] failed/);
  });
});

describe('the migration that makes it possible', () => {
  const migRaw = fs.readFileSync(
    path.join(__dirname, '..', '..', 'supabase', 'migrations', '092_account_purge_tombstone.sql'),
    'utf8',
  );
  // Same rule as the JS guards: the header explains at length the DELETE this
  // migration exists to replace, so a check for the word DELETE has to read the
  // STATEMENTS, not the prose that documents them.
  const mig = migRaw.replace(/^\s*--.*$/gm, '');

  it('adds purged_at additively, so it is safe to apply before the deploy', () => {
    expect(mig).toContain('ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ');
  });

  it('indexes only the rows the sweep looks at', () => {
    expect(mig).toContain('WHERE deleted_at IS NOT NULL AND purged_at IS NULL');
  });

  it('drops nothing and deletes nothing', () => {
    expect(mig).not.toMatch(/\bDROP\b/i);
    expect(mig).not.toMatch(/\bDELETE\b/i);
  });
});
