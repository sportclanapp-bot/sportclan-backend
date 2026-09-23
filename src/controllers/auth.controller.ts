import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import axios from 'axios';
import { supabase } from '../utils/supabase';
import { isValidIndianPhone, canonicalisePhone, phoneVariants } from '../utils/phone';
import { resolveSportId } from '../utils/sportId';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../utils/jwt';
import { setOtp, getOtp, deleteOtp } from '../utils/otpStore';
import { normalizeAccountTypes } from '../constants/accountTypes';
import { awardCoins } from '../utils/coins';

const OTP_TTL_SECONDS = 300; // 5 minutes

// ─── Welcome coins ───────────────────────────────────────────────────────────
// Every NEW signup (phone, email or Google) gets 50 coins, on top of the 10 for
// first_registration — 60 in total.
//
// SC-434: this grant used to ALSO set is_premium + a 3-month expiry, because
// there were tiers and new users were given the paid one for free. There are no
// tiers now, so the premium half is gone and the coins are just coins. The event
// key stays `early_bird_grant` deliberately: it is the idempotency key on
// coin_events, and renaming it would hand a second 50 to every existing user the
// next time anything called this.
const EARLY_BIRD_COINS = 50;

/** Award the 50 welcome coins to a freshly-created user. Best-effort. */
async function grantEarlyBirdCoins(userId: string): Promise<void> {
  try {
    await awardCoins(userId, 'early_bird_grant', EARLY_BIRD_COINS, 'Welcome bonus');
  } catch {
    // non-critical — premium is already set on the row
  }
}

// ─── Dev-only test OTP bypass ────────────────────────────────────────────────
// Lets QA / automated walkthroughs sign into seeded accounts without a real SMS
// (SportClan is OTP-only; seeded accounts have no email/password to fall back on).
//
// STRICT double gate — isTestOtp() returns false, and the bypass is a complete
// no-op, unless BOTH of these hold:
//   1. ALLOW_TEST_OTP === 'true'   — explicit opt-in env flag (off by default)
//   2. NODE_ENV !== 'production'   — fail-safe: never active in prod even if (1)
//                                    is accidentally left set there.
// When active, TEST_OTP_CODE is accepted for ANY phone on /auth/verify-otp and
// /auth/otp/login. Keep it OFF (flag unset) on the production service.
const TEST_OTP_CODE = '123456';
function isTestOtp(code: string): boolean {
  return (
    process.env.ALLOW_TEST_OTP === 'true' &&
    process.env.NODE_ENV !== 'production' &&
    code === TEST_OTP_CODE
  );
}

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, '');
}

// Send OTP via 2Factor.in — SMS or voice call.
//
// SC-399: SMS is the primary channel. It used to be voice ("to dodge SMS
// deliverability"), but the account's Voice OTP balance was 0.00 while SMS had
// 2,197 credits — so every voice send failed and phone login was dead. Balance,
// not deliverability, is what actually decides whether a code arrives.
//
// On dev with no API key, all channels fall through to console.
// SC-441 (P1) · WhatsApp removed entirely, decision D1. It was billed per
// message and we are not paying for it. Both routes are gone: the user-facing
// "Send via WhatsApp" button in the app, and the automatic server-side fallback
// that silently retried over WhatsApp whenever SMS or voice failed — the second
// one cost money without anyone ever asking for it.
type OtpChannel = 'sms' | 'voice';

/**
 * SC-401 · what 2Factor reported for the most recent send.
 *
 * Dipak received a VOICE CALL from a request this server made as SMS, while an
 * explicit voice request returns 503. Both cannot be true of our own code, so
 * the answer is on 2Factor's side — and we were throwing away the only evidence
 * (their session id) on the success path. This is deliberately in-memory and
 * single-slot: it is a live diagnostic for an open question, not a log store.
 */
let lastSend: {
  channel: OtpChannel;
  status: string;
  details: string | null;
  at: string;
} | null = null;

export function getLastOtpSend() {
  return lastSend;
}

async function sendOtpViaChannel(
  phone: string,
  code: string,
  channel: OtpChannel,
): Promise<boolean> {
  const apiKey = process.env.TWOFACTOR_API_KEY;
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log(`[OTP DEV] channel=${channel} phone=${phone} code=${code}`);
    return true;
  }
  try {
    const cleanPhone = phone.replace(/^\+91/, '');
    let url: string;
    if (channel === 'voice') {
      url = `https://2factor.in/API/V1/${apiKey}/VOICE/${cleanPhone}/${code}`;
    } else {
      // SMS with OUR generated code (not AUTOGEN — the code is already stored,
      // so letting 2Factor mint a different one would never verify).
      // ENV: TWOFACTOR_SMS_TEMPLATE_ID — optional; omitted uses the account default.
      const tpl = process.env.TWOFACTOR_SMS_TEMPLATE_ID;
      url = tpl
        ? `https://2factor.in/API/V1/${apiKey}/SMS/${cleanPhone}/${code}/${tpl}`
        : `https://2factor.in/API/V1/${apiKey}/SMS/${cleanPhone}/${code}`;
    }
    const { data } = await axios.get(url, { timeout: 8000 }); // SC-150: fail fast if 2Factor.in hangs
    // SC-399: 2Factor answers 200 with {"Status":"Error"} for things like an
    // exhausted balance or a bad template. The old code returned true on any
    // non-throw, so a refused send was reported to the user as "OTP sent" and
    // they waited for a code that was never going to arrive.
    const status = (data as { Status?: string } | null)?.Status;
    if (status && status.toLowerCase() !== 'success') {
      // eslint-disable-next-line no-console
      console.error(`[2Factor.in] ${channel} refused:`, JSON.stringify(data));
      lastSend = { channel, status: status ?? 'unknown', details: JSON.stringify(data), at: new Date().toISOString() };
      return false;
    }
    // SC-401: record what 2Factor said on SUCCESS as well. We used to discard it,
    // which is why "the server sent SMS but the user got a voice call" was
    // un-diagnosable — the session id in `Details` is the only handle on what the
    // vendor actually did with the request.
    // eslint-disable-next-line no-console
    console.log(`[2Factor.in] ${channel} accepted:`, JSON.stringify(data));
    lastSend = {
      channel,
      status: status ?? 'unknown',
      details: (data as { Details?: string } | null)?.Details ?? null,
      at: new Date().toISOString(),
    };
    return true;
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(`[2Factor.in] ${channel} send failed:`, err?.response?.status, err?.message);
    return false;
  }
}

// Legacy alias retained so other call sites don't break
async function sendSmsOtp(phone: string, code: string): Promise<boolean> {
  return sendOtpViaChannel(phone, code, 'sms');
}

// POST /auth/send-otp  { phone, purpose?, channel? }

/**
 * SC-442 (M9/F-02) · accept sport SLUGS as well as ids.
 *
 * The register screen holds its selection as slugs ('cricket', 'badminton') and
 * posts them as `sport_ids`, which are UUIDs everywhere else. The insert into
 * user_sports therefore wrote values no sport row matched, and the account came
 * out with NO sports — so a step that enforces "pick at least one" was silently
 * discarded and the profile-completion card then asked the new user to add the
 * sports they had just picked.
 *
 * Resolved here rather than in the app because resolveSportId already accepts
 * either form (it is how match creation has always taken 'cricket'), and doing
 * it server-side also fixes every build already installed.
 *
 * Unknown values are dropped rather than inserted: a bad slug should cost one
 * sport, not the whole registration.
 */
async function resolveSportIds(raw: unknown): Promise<string[]> {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const id = await resolveSportId(v);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export async function sendOtp(req: Request, res: Response) {
  const { phone, purpose = 'login', channel: rawChannel } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone is required' });
  // SC-398: a non-string phone (e.g. {"phone": 12345}) used to reach
  // normalizePhone -> .trim() -> TypeError -> 500. Same wrong-type class the
  // param guard closed on ids; here it gets the same 400 the validator gives.
  if (typeof phone !== 'string') {
    return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.', code: 'INVALID_PHONE' });
  }
  // SC-399: SMS is the default; voice remains explicitly requestable.
  // SC-441 (P1): 'whatsapp' is no longer accepted — an old build still asking for
  // it gets SMS rather than an error, so upgrading is not forced.
  const channel: OtpChannel = rawChannel === 'voice' ? 'voice' : 'sms';
  const p = canonicalisePhone(phone) ?? normalizePhone(phone);
  // SC-385: reuse the SAME rule register already enforces (SC-72). It was only
  // applied at registration, so the number could afterwards be replaced with
  // anything — "notaphone" was accepted live. In production that strands the
  // account: the OTP for the new value can never be delivered.
  if (!isValidIndianPhone(p)) {
    return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.', code: 'INVALID_PHONE' });
  }
  // SC-441 (P2) · refuse a deleted account BEFORE sending anything.
  //
  // The deleted check existed only on the verify paths, so requesting a code for
  // a deleted number succeeded, the screen said "Code sent by SMS", an SMS was
  // actually paid for, and only after the user typed the code were they told the
  // account was gone. Every retry billed again.
  //
  // Decision P2 accepts the trade: answering before sending is a small account
  // enumeration signal, but the same fact is already disclosed a step later at
  // verify, and the alternative is charging for messages nobody can ever use.
  // Failing open on a query error is deliberate — a database hiccup must not
  // block login for everyone.
  try {
    const { data: deletedRows } = await supabase
      .from('users')
      .select('deleted_at')
      .in('phone', phoneVariants(p))
      .not('deleted_at', 'is', null)
      .limit(1);
    if (deletedRows && deletedRows.length > 0) {
      return res.status(403).json({ error: 'This account has been deleted.', code: 'ACCOUNT_DELETED' });
    }
  } catch {
    // fall through and send — see above
  }

  const code = generateOtp();

  // SC-398: storing the code is the step that used to throw when Upstash was
  // unconfigured, and sendOtp had no try/catch — so an unset env var turned the
  // app's primary login path into a bare 500. otpStore now falls back through
  // Postgres to memory, but the guard stays: if EVERY backend is down the user
  // gets a clear, retryable message instead of "Internal server error".
  try {
    await setOtp(p, code, purpose, OTP_TTL_SECONDS);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[send-otp] OTP storage unavailable:', err?.message);
    return res.status(503).json({
      error: 'We could not send a code just now. Please try again in a moment.',
      code: 'OTP_STORE_UNAVAILABLE',
    });
  }

  // SC-398 wired an automatic WhatsApp fallback here when the requested channel
  // failed. SC-441 (P1, decision D1) removes it: it billed per message and it
  // fired without the user ever choosing it, so the cost was invisible.
  //
  // A failed send is now terminal and SAID SO — the 503 below carries a message
  // the app shows, and Resend stays available so the user can try again. That is
  // the honest trade for not paying for a channel we do not want.
  const usedChannel: OtpChannel = channel;
  const sent = await sendOtpViaChannel(p, code, channel);
  if (!sent) {
    return res.status(503).json({
      error: 'We could not send a code to that number. Please try again.',
      code: 'OTP_SEND_FAILED',
    });
  }
  // Report the channel used, so the app can say where to look for the code
  // ("answer the call" vs "check your messages").
  return res.json({ success: true, message: 'OTP sent', channel: usedChannel });
}

// Best-effort suspension check used by all login paths. Tolerates the
// suspended_at column not existing yet (pre-migration 029) by treating any
// query error as "not suspended", so login never breaks on a missing column.
async function isSuspended(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('users').select('suspended_at').eq('id', userId).maybeSingle();
    if (error) return false;
    return !!(data && (data as { suspended_at?: string | null }).suspended_at);
  } catch {
    return false;
  }
}

/** True once an account has been soft-deleted via POST /account/delete
 * (deleted_at set). Deletion is FINAL — a deleted account cannot be logged into
 * (its data is scrubbed and it is purged after the 30-day grace). Mirrors
 * isSuspended, including the fail-open on a transient DB error. */
async function isDeleted(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('users').select('deleted_at').eq('id', userId).maybeSingle();
    if (error) return false;
    return !!(data && (data as { deleted_at?: string | null }).deleted_at);
  } catch {
    return false;
  }
}

// POST /auth/verify-otp  { phone, code }
export async function verifyOtp(req: Request, res: Response) {
  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: 'phone and code are required' });
  const p = canonicalisePhone(phone) ?? normalizePhone(phone);
  // Dev-only bypass (see isTestOtp): accept the fixed test code without a real OTP.
  if (isTestOtp(code)) {
    await setOtp(p, 'VERIFIED', 'login', OTP_TTL_SECONDS);
    return res.json({ success: true, verified: true });
  }
  const entry = await getOtp(p);
  if (!entry) return res.status(400).json({ error: 'No OTP requested or OTP expired' });
  if (entry.code !== code) return res.status(400).json({ error: 'Invalid OTP' });
  // Mark verified — store VERIFIED with fresh TTL
  await setOtp(p, 'VERIFIED', entry.purpose, OTP_TTL_SECONDS);
  return res.json({ success: true, verified: true });
}

// POST /auth/register
// OTP-only multi-step registration. Body shape:
//   {
//     phone, code,                       // required — OTP gate
//     name, username,                    // required identity
//     email?, gender?, dob?, link?,      // optional profile
//     city_id?, bio?,
//     account_types?: string[],          // → user_account_types
//     sport_ids?: string[],              // → user_sports
//     coupon_code?: string               // → coupon_usages (best-effort)
//   }
//
// Notes:
//   * No password — OTP is the credential. password_hash stays null.
//   * Username uniqueness is enforced case-insensitively.
//   * account_types and sport_ids inserts are best-effort; a partial failure
//     does NOT roll back the user row (we'd rather have a half-populated
//     account than no account at all on a transient DB blip).
export async function register(req: Request, res: Response) {
  const {
    phone, code,
    name, username, email, gender, dob, link, city_id, bio,
    account_types, sport_ids, coupon_code,
  } = req.body || {};

  if (!phone || !code) return res.status(400).json({ error: 'phone and code are required' });
  if (!name || !username) return res.status(400).json({ error: 'name and username are required' });

  const p = canonicalisePhone(phone) ?? normalizePhone(phone);
  // SC-72: reject a malformed phone up front so no account is created for junk
  // like "12"/letters/too-short/too-long. Mirrors the client-side check.
  if (!isValidIndianPhone(p)) {
    return res.status(400).json({
      error: 'Enter a valid 10-digit Indian mobile number.',
      code: 'INVALID_PHONE',
    });
  }
  // Honor the dev-only test bypass exactly as verifyOtp does: when ALLOW_TEST_OTP
  // is on and the fixed test code is used, sendOtp has stored the *real* voice
  // code (not 123456), so the entry.code check below would always fail. Skip it.
  // In production isTestOtp() is always false, so the real OTP check still runs.
  if (!isTestOtp(code)) {
    const entry = await getOtp(p);
    if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
      return res.status(400).json({ error: 'OTP not verified' });
    }
  }

  // Phone must be free — EXCEPT a soft-deleted account still holds its phone.
  // Deletion is final (the old account is gone, not restorable), so we let the
  // number be reused for a BRAND-NEW signup instead of stranding the user
  // ("can't log in AND can't re-register"). Release the phone from the dead row
  // first; that row keeps its content + deleted_at and is hard-purged after the
  // 30-day grace.
  // SC-386: match ANY stored form of this number, not just the exact string.
  // A raw compare let the same human register twice — once as +919876543210 and
  // once as 9876543210 — because those are different strings. Checking every
  // variant also keeps this correct before migration 083 canonicalises the data.
  const { data: existingRows } = await supabase
    .from('users').select('id, deleted_at').in('phone', phoneVariants(p));
  const existingPhone = (existingRows ?? [])[0];
  if (existingPhone) {
    if ((existingPhone as { deleted_at?: string | null }).deleted_at) {
      const { error: freeErr } = await supabase
        .from('users')
        .update({ phone: `deleted:${existingPhone.id}` })
        .eq('id', existingPhone.id);
      if (freeErr) return res.status(500).json({ error: 'Could not free the number for re-registration' });
    } else {
      return res.status(400).json({
        code: 'PHONE_ALREADY_REGISTERED',
        error: 'This mobile number is already registered. Please login instead.',
      });
    }
  }

  // Email must be free (if provided)
  if (email) {
    const { data: existingEmail } = await supabase
      .from('users').select('id').eq('email', email).maybeSingle();
    if (existingEmail) {
      return res.status(400).json({
        code: 'EMAIL_ALREADY_REGISTERED',
        error: 'This email is already registered.',
      });
    }
  }

  // Username must be free (case-insensitive)
  const { data: existingUsername } = await supabase
    .from('users').select('id').ilike('username', username).maybeSingle();
  if (existingUsername) return res.status(409).json({ error: 'Username already taken' });

  if (gender && !['male', 'female', 'other'].includes(gender)) {
    return res.status(400).json({ error: 'gender must be male, female, or other' });
  }

  // Validate + normalize account types against the shared whitelist — the same
  // contract PATCH /users/me/account-types enforces (lowercased, de-duped,
  // invalid dropped, 'player' first). Empty/garbage input falls back to
  // ['player']. (Registration previously stored the raw client strings
  // unvalidated and defaulted to the non-canonical 'fan'.)
  const normalizedAccountTypes = normalizeAccountTypes(account_types);
  // The legacy users.account_type column is kept for backward compat — store
  // the primary (first) type so existing code that reads it still works.
  const primaryAccountType = normalizedAccountTypes[0];

  // Generate a unique referral code (retry a couple of times on collision).
  const { generateReferralCode } = await import('./referrals.controller');
  let referralCode = generateReferralCode();
  for (let i = 0; i < 3; i++) {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('referral_code', referralCode)
      .maybeSingle();
    if (!existing) break;
    referralCode = generateReferralCode();
  }

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      phone: p,
      name,
      username,
      email: email || null,
      gender: gender || null,
      dob: dob || null,
      link: link || null,
      bio: bio || null,
      city_id: city_id || null,
      account_type: primaryAccountType,
      coin_balance: 0,
      referral_code: referralCode,
    })
    .select('id, phone, name, username, email, gender, dob, link, bio, city_id, account_type, profile_picture_url, coin_balance, referral_code, created_at')
    .single();
  if (error || !user) {
    return res.status(500).json({ error: error?.message || 'Failed to create user' });
  }

  // Best-effort multi-row inserts.
  {
    const rows = normalizedAccountTypes.map((t) => ({ user_id: user.id, account_type: t }));
    await supabase.from('user_account_types').insert(rows);
  }
  {
    // SC-442 (M9/F-02): the app sends slugs here; resolve them to ids.
    const resolvedSportIds = await resolveSportIds(sport_ids);
    if (resolvedSportIds.length > 0) {
      const rows = resolvedSportIds.map((sid) => ({ user_id: user.id, sport_id: sid }));
      await supabase.from('user_sports').insert(rows);
    }
  }

  // SC-434: a coupon block stood here. It could grant premium months and OVERWRITE
  // coin_balance outright — the one place in the app that set a balance rather
  // than adding to it. Coupons are gone with the rest of the paid machinery; the
  // coupon_codes and coupon_usages tables stay on prod, read-only.

  // Welcome bonus — 10 coins on first registration. Idempotent via
  // the (user_id, event_type) unique key on coin_events.
  try {
    await awardCoins(user.id, 'first_registration', 10, 'Welcome to SportClan');
  } catch {
    // non-critical
  }

  // Welcome coins: 50, on top of the 10 above.
  await grantEarlyBirdCoins(user.id);

  await deleteOtp(p);
  // The `user` row was captured BEFORE the coin grants ran, so its coin_balance
  // is still 0 — re-read it so the signup response reflects the real total (A4-009).
  {
    const { data: fb } = await supabase
      .from('users').select('coin_balance').eq('id', user.id).maybeSingle();
    if (fb) Object.assign(user, fb);
  }
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
  return res.json({ user, accessToken, refreshToken, isNewUser: true });
}

// POST /auth/otp/login  { phone, code }
// Returning users log in with phone + OTP only — no password.
// Validates OTP, looks up user by phone, issues fresh tokens.
// Errors:
//   400 — phone/code missing or OTP invalid/expired
//   404 — phone is not registered (caller should route to register flow)
export async function otpLogin(req: Request, res: Response) {
  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: 'phone and code are required' });
  const p = canonicalisePhone(phone) ?? normalizePhone(phone);
  // Dev-only bypass (see isTestOtp): skip OTP validation for the fixed test code.
  // The user must still exist (seeded) — otherwise we fall through to the 404 below.
  if (!isTestOtp(code)) {
    const entry = await getOtp(p);
    if (!entry) return res.status(400).json({ error: 'No OTP requested or OTP expired' });
    // Accept either the original code or the VERIFIED marker (verify-otp may
    // have already been called separately by the client).
    if (entry.code !== code && entry.code !== 'VERIFIED') {
      return res.status(400).json({ error: 'Invalid OTP' });
    }
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, phone, name, username, email, gender, dob, link, bio, city_id, account_type, profile_picture_url, coin_balance, is_admin, created_at')
    // SC-386: look up EVERY form. Deliberately permissive — an account still
    // stored the legacy way must keep logging in, both in the window before
    // migration 083 runs and afterwards if a value could not be canonicalised.
    .in('phone', phoneVariants(p))
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!user) {
    return res.status(404).json({ error: 'Phone not registered', needsRegistration: true });
  }
  if (await isSuspended(user.id)) {
    return res.status(403).json({ error: 'This account has been suspended. Please contact support.' });
  }
  if (await isDeleted(user.id)) {
    return res.status(403).json({ error: 'This account has been deleted.' });
  }

  await deleteOtp(p);
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
  return res.json({ user, accessToken, refreshToken, isNewUser: false });
}

// POST /auth/login  { phone, password } or { email, password }
export async function login(req: Request, res: Response) {
  const { phone, email, password } = req.body || {};
  if (!password || (!phone && !email)) {
    return res.status(400).json({ error: 'password and either phone or email are required' });
  }

  let query = supabase
    .from('users')
    .select('id, phone, name, username, email, password_hash, city_id, account_type, profile_picture_url, coin_balance, is_admin, created_at');

  if (email) {
    query = query.ilike('email', email.trim());
  } else {
    query = query.in('phone', phoneVariants(phone)).limit(1);  // SC-386: any stored form
  }

  const { data: user } = await query.maybeSingle();
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.password_hash) return res.status(401).json({ error: 'Account uses OTP login only' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  if (await isSuspended(user.id)) {
    return res.status(403).json({ error: 'This account has been suspended. Please contact support.' });
  }
  if (await isDeleted(user.id)) {
    return res.status(403).json({ error: 'This account has been deleted.' });
  }
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
  const { password_hash: _ph, ...safe } = user;
  return res.json({ user: safe, accessToken, refreshToken });
}

// POST /auth/register-email
//   { email, password, name, username,
//     gender?, dob?, link?, city_id?, bio?, account_types?, sport_ids? }
// Email+password registration. This is now a first-class signup path (not just
// for reviewer/test accounts) so the onboarding flow is reachable without a
// verified phone — phone-OTP signup is the primary path but OTP delivery is a
// known launch gate, and email signup unblocks onboarding regardless (A1-003).
export async function registerEmail(req: Request, res: Response) {
  const {
    email, password, name, username,
    gender, dob, link, city_id, bio, account_types, sport_ids,
  } = req.body || {};
  if (!email || !password || !name || !username) {
    return res.status(400).json({ error: 'email, password, name, and username are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (gender && !['male', 'female', 'other'].includes(gender)) {
    return res.status(400).json({ error: 'gender must be male, female, or other' });
  }

  // Email must be free
  const { data: existingEmail } = await supabase
    .from('users').select('id').ilike('email', email.trim()).maybeSingle();
  if (existingEmail) return res.status(409).json({ error: 'Email already registered' });

  // Username must be free (case-insensitive)
  const { data: existingUsername } = await supabase
    .from('users').select('id').ilike('username', username).maybeSingle();
  if (existingUsername) return res.status(409).json({ error: 'Username already taken' });

  const password_hash = await bcrypt.hash(password, 10);

  // Validate + normalize account types against the shared whitelist — same
  // contract as phone register and PATCH /users/me/account-types. Empty/garbage
  // falls back to ['player']. (Previously this path hardcoded the non-canonical
  // 'fan' and skipped the join table — see A6-001.)
  const normalizedAccountTypes = normalizeAccountTypes(account_types);
  const primaryAccountType = normalizedAccountTypes[0];

  // Generate a unique referral code (retry a couple of times on collision),
  // matching the phone-register path so invite-a-friend works for email users.
  const { generateReferralCode } = await import('./referrals.controller');
  let referralCode = generateReferralCode();
  for (let i = 0; i < 3; i++) {
    const { data: existing } = await supabase
      .from('users').select('id').eq('referral_code', referralCode).maybeSingle();
    if (!existing) break;
    referralCode = generateReferralCode();
  }

  // phone is NOT NULL in the schema — generate a unique placeholder for email-only accounts
  const placeholderPhone = `+0${Date.now()}`;

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      phone: placeholderPhone,
      email: email.trim(),
      name,
      username,
      password_hash,
      gender: gender || null,
      dob: dob || null,
      link: link || null,
      bio: bio || null,
      city_id: city_id || null,
      account_type: primaryAccountType,
      coin_balance: 0,
      referral_code: referralCode,
    })
    .select('id, phone, name, username, email, gender, dob, link, bio, city_id, account_type, profile_picture_url, coin_balance, referral_code, created_at')
    .single();
  if (error || !user) {
    return res.status(500).json({ error: error?.message || 'Failed to create user' });
  }

  // Best-effort multi-row inserts (mirrors phone register).
  {
    const rows = normalizedAccountTypes.map((t) => ({ user_id: user.id, account_type: t }));
    await supabase.from('user_account_types').insert(rows);
  }
  {
    // SC-442 (M9/F-02): same on the email path — the app sends slugs.
    const resolvedSportIds = await resolveSportIds(sport_ids);
    if (resolvedSportIds.length > 0) {
      const rows = resolvedSportIds.map((sid) => ({ user_id: user.id, sport_id: sid }));
      await supabase.from('user_sports').insert(rows);
    }
  }

  // Welcome bonus — 10 coins on first registration (parity with phone signup;
  // previously missing on email/Google, see A4-008). Idempotent via coin_events.
  try {
    await awardCoins(user.id, 'first_registration', 10, 'Welcome to SportClan');
  } catch {
    // non-critical
  }

  // Early-bird launch perk: 50 coins (premium set on the insert above).
  await grantEarlyBirdCoins(user.id);

  // Re-read post-grant balance so the response isn't a stale coin_balance:0 (A4-009).
  {
    const { data: fb } = await supabase
      .from('users').select('coin_balance').eq('id', user.id).maybeSingle();
    if (fb) Object.assign(user, fb);
  }
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
  return res.json({ user, accessToken, refreshToken, isNewUser: true });
}

// POST /auth/refresh  { refreshToken }
export async function refresh(req: Request, res: Response) {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken is required' });
  try {
    const payload = verifyRefreshToken(refreshToken);
    const { data: row } = await supabase
      .from('refresh_tokens')
      .select('id, revoked')
      .eq('token', refreshToken)
      .maybeSingle();
    if (!row || row.revoked) return res.status(401).json({ error: 'Refresh token revoked' });
    // SC-213: a ban/deletion must bite mid-session — a suspended or soft-deleted
    // user must NOT be able to mint fresh access tokens off an old refresh token.
    // (Login/verify-otp already gate this; refresh was the evasion path.)
    if (await isSuspended(payload.userId)) {
      return res.status(403).json({ error: 'This account has been suspended. Please contact support.' });
    }
    if (await isDeleted(payload.userId)) {
      return res.status(403).json({ error: 'This account has been deleted.' });
    }
    const accessToken = generateAccessToken(payload.userId);
    return res.json({ accessToken });
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
}

// POST /auth/logout  { refreshToken }
export async function logout(req: Request, res: Response) {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    await supabase.from('refresh_tokens').update({ revoked: true }).eq('token', refreshToken);
  }
  return res.json({ success: true });
}

// GET /auth/username/check?username=
// Returns { available: boolean }. Used by RegisterStep1 before submit.
export async function checkUsername(req: Request, res: Response) {
  const username = ((req.query.username as string) || '').trim();
  if (!username) return res.status(400).json({ error: 'username is required' });
  if (username.length < 3) return res.json({ available: false });
  const { data } = await supabase
    .from('users').select('id').ilike('username', username).maybeSingle();
  return res.json({ available: !data });
}

// SC-434: validateCoupon lived here. Removed with coupons; the table stays.

// POST /auth/google  { idToken }
// Verifies the Google ID token, extracts email/name/picture, and either
// logs in an existing user or creates a new one. Returns JWT tokens.
//
// Requires GOOGLE_CLIENT_ID in .env. Without it, all requests return 503.
export async function googleAuth(req: Request, res: Response) {
  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ error: 'idToken is required' });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: 'Google Sign-In not configured. Set GOOGLE_CLIENT_ID in .env.' });
  }

  try {
    // Verify the token with Google. google-auth-library is optional —
    // if not installed, we decode the JWT payload directly (less secure
    // but functional for development; install google-auth-library for
    // production-grade verification).
    // SC-149: verify the ID token cryptographically (signature + audience). There is
    // NO decode-without-verification fallback — a missing library or a failed
    // verification FAILS CLOSED. A missing crypto library must never downgrade to
    // "trust the input" (that let anyone forge a Google identity).
    let payload: { email?: string; name?: string; picture?: string; sub?: string };
    try {
      const { OAuth2Client } = await import('google-auth-library');
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload() as typeof payload;
    } catch (err: any) {
      const code = err?.code ?? '';
      if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND' || /Cannot find module/i.test(err?.message ?? '')) {
        // The verification library is unavailable — do NOT trust the token. Fail closed, loudly.
        // eslint-disable-next-line no-console
        console.error('[google-auth] google-auth-library unavailable — OAuth verification cannot run', err?.message);
        return res.status(503).json({ error: 'Google Sign-In temporarily unavailable' });
      }
      // Token failed verification (bad signature / audience / expiry) → reject.
      // eslint-disable-next-line no-console
      console.warn('[google-auth] ID token verification failed', err?.message);
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    if (!payload?.email) return res.status(400).json({ error: 'Token missing email' });

    // Check if user exists by google_id or email
    const { data: existing } = await supabase
      .from('users')
      .select('id, phone, name, username, email, google_id, coin_balance, referral_code, created_at')
      .or(`google_id.eq.${payload.sub},email.eq.${payload.email}`)
      .maybeSingle();

    let user: Record<string, unknown>;

    if (existing) {
      // Update google_id if missing
      if (!existing.google_id && payload.sub) {
        await supabase.from('users').update({ google_id: payload.sub }).eq('id', existing.id);
      }
      user = existing;
    } else {
      // Create new user
      const username = payload.email!.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') + Math.floor(Math.random() * 100);
      const { data: newUser, error } = await supabase
        .from('users')
        .insert({
          name: payload.name ?? 'Google User',
          username,
          email: payload.email,
          google_id: payload.sub ?? null,
          profile_picture_url: payload.picture ?? null,
          account_type: 'player',
          coin_balance: 0,
        })
        .select('id, phone, name, username, email, google_id, coin_balance, referral_code, created_at')
        .single();
      if (error || !newUser) return res.status(500).json({ error: 'Could not create account' });
      // Welcome bonus — 10 coins on first registration, for parity with the
      // phone and email paths (Google previously got only the 50-coin early-bird
      // grant = 50 instead of 60, A4-008). Idempotent via coin_events.
      try {
        await awardCoins(newUser.id, 'first_registration', 10, 'Welcome to SportClan');
      } catch {
        // non-critical
      }
      // Early-bird launch perk: 50 coins (premium set on the insert above).
      await grantEarlyBirdCoins(newUser.id);
      // Seed the multi-type join table so the new account is consistent with
      // phone signups (which populate user_account_types).
      await supabase
        .from('user_account_types')
        .insert({ user_id: newUser.id, account_type: 'player' })
        .then(undefined, () => undefined);
      user = newUser;
    }

    const { generateAccessToken, generateRefreshToken } = await import('../utils/jwt');
    const accessToken = generateAccessToken(user.id as string);
    const refreshToken = generateRefreshToken(user.id as string);

    await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });

    // New Google users had their grants applied after `user` was captured —
    // re-read so the response isn't a stale coin_balance:0 (A4-009).
    {
      const { data: fb } = await supabase
        .from('users').select('coin_balance').eq('id', user.id as string).maybeSingle();
      if (fb) Object.assign(user, fb);
    }
    return res.json({ accessToken, refreshToken, user, isNewUser: !existing });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Google auth failed';
    return res.status(500).json({ error: msg });
  }
}

// POST /auth/reset-password  { phone, code, newPassword }
export async function resetPassword(req: Request, res: Response) {
  const { phone, code, newPassword } = req.body || {};
  if (!phone || !code || !newPassword) {
    return res.status(400).json({ error: 'phone, code, newPassword are required' });
  }
  const p = canonicalisePhone(phone) ?? normalizePhone(phone);
  // Honor the dev-only test bypass uniformly with verifyOtp/otpLogin/register
  // (see isTestOtp). In production isTestOtp() is always false, so the real
  // OTP check still runs.
  if (!isTestOtp(code)) {
    const entry = await getOtp(p);
    if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
      return res.status(400).json({ error: 'OTP not verified or expired' });
    }
  }
  const password_hash = await bcrypt.hash(newPassword, 10);
  const { error } = await supabase.from('users').update({ password_hash }).in('phone', phoneVariants(p));
  if (error) return res.status(500).json({ error: error.message });
  await deleteOtp(p);
  return res.json({ success: true });
}

// POST /auth/change-phone  { newPhone, code }  (requires auth — verifies OTP sent to NEW phone)
export async function changePhone(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { newPhone, code } = req.body || {};
  if (!newPhone || !code) return res.status(400).json({ error: 'newPhone and code are required' });
  const p = canonicalisePhone(newPhone) ?? normalizePhone(newPhone);
  // SC-385: reuse the SAME rule register already enforces (SC-72). It was only
  // applied at registration, so the number could afterwards be replaced with
  // anything — "notaphone" was accepted live. In production that strands the
  // account: the OTP for the new value can never be delivered.
  if (!isValidIndianPhone(p)) {
    return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number.', code: 'INVALID_PHONE' });
  }
  // Honor the dev-only test bypass uniformly (see isTestOtp). Production runs
  // the real OTP check since isTestOtp() is always false there.
  if (!isTestOtp(code)) {
    const entry = await getOtp(p);
    if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
      return res.status(400).json({ error: 'OTP not verified or expired' });
    }
  }
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    // SC-386: any stored form of the number counts as "already in use".
    .in('phone', phoneVariants(p))
    .limit(1)
    .maybeSingle();
  if (existing) return res.status(409).json({ error: 'Phone already in use' });
  // Store the canonical form so the table converges on one shape.
  const { error } = await supabase
    .from('users')
    .update({ phone: canonicalisePhone(p) ?? p })
    .eq('id', userId);
  if (error) return res.status(500).json({ error: error.message });
  await deleteOtp(p);
  return res.json({ success: true });
}
