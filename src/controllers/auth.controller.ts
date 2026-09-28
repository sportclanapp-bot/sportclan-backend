import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import axios from 'axios';
import { supabase } from '../utils/supabase';
import { isValidIndianPhone, canonicalisePhone, phoneVariants } from '../utils/phone';
import { testCodeFor, maskPhone } from '../utils/otpTestNumbers';
import { checkOtpCode, otpCheckError, verifiedMarker, clearWrongCodes } from '../utils/otpCheck';
import { deletedNumberState, deletedResponse, holdUntil, releaseNumber } from '../utils/deletedNumber';
import { resolveSportId } from '../utils/sportId';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../utils/jwt';
import { setOtp, getOtp, deleteOtp, bumpCounter, readCounter } from '../utils/otpStore';
import { normalizeAccountTypes } from '../constants/accountTypes';
import { signupProfileProblem, USERNAME_RE, RESERVED_USERNAMES, GENDERS, GENDER_ERROR } from '../utils/profileRules';
import { escapeLike } from '../utils/likeSearch';
import { awardCoins } from '../utils/coins';
import { denySessions } from '../utils/sessionDeny';
import { insertRefreshToken, refreshedDeviceFields } from '../utils/sessionDevice';
import { revokeSessionsNow } from '../utils/sessionRevocation';

const OTP_TTL_SECONDS = 300; // 5 minutes
/** Codes sent to one number (28 Sep): per hour and per day, whoever asks. */
export const SEND_PER_NUMBER_HOUR = 5;
export const SEND_PER_NUMBER_DAY = 10;

// ─── Welcome coins ───────────────────────────────────────────────────────────
// Every NEW signup (phone or email) gets 50 coins, on top of the 10 for
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
    // F-17: the label, not the grant. The wallet showed "Welcome bonus +50" and
    // "Welcome to SportClan +10" one above the other — two near-identical names
    // that sum to the promised 60 and read like the same row charged twice. The
    // EVENT KEYS are untouched (they are the idempotency keys on coin_events;
    // renaming one hands every existing user a second grant), so only what a
    // person reads changes, and it now says which is which.
    await awardCoins(userId, 'early_bird_grant', EARLY_BIRD_COINS, 'Early supporter bonus');
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

/** The one answer for a phone that isn't a usable number (send-otp's, SC-398). */
const INVALID_PHONE_BODY = { error: 'Enter a valid 10-digit Indian mobile number.', code: 'INVALID_PHONE' } as const;

/** What a code can be sent for. Anything else was stored as-is (Phase 3 B01-F14). */
export const OTP_PURPOSES = ['login', 'register', 'reset', 'change_phone'] as const;

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
  if (!(OTP_PURPOSES as readonly unknown[]).includes(purpose)) {
    return res.status(400).json({ error: 'Unknown code purpose.', code: 'INVALID_PURPOSE' });
  }
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
  // Decided 28 Sep: the refusal lasts 30 days from deletion and says when the
  // number is free again; after that the number sends like any other (the old
  // row is released at sign-up / Change phone, or by the hourly purge).
  try {
    const { heldUntil } = await deletedNumberState(p);
    if (heldUntil) return res.status(403).json(deletedResponse(heldUntil));
  } catch {
    // fall through and send — see above
  }

  // Phase 3 B01-F5: a reset code for a number no live account uses was sent
  // (and paid for), and the user only learnt at the end — after typing the
  // code and a new password — that there was nothing to reset. Same trade as
  // the deleted check above: resetPassword already says this a step later.
  // Fails open on a query error, like the check above.
  if (purpose === 'reset') {
    try {
      const { data: live, error: liveErr } = await supabase
        .from('users').select('id').in('phone', phoneVariants(p)).is('deleted_at', null).limit(1);
      if (!liveErr && Array.isArray(live) && live.length === 0) {
        return res.status(404).json({ error: 'No SportClan account uses this number.', code: 'PHONE_NOT_REGISTERED' });
      }
    } catch {
      // fall through and send
    }
  }
  // Phase 3 B11-F16: the same for Change phone the other way round — a number
  // a live account already uses can never be moved to, and change-phone said so
  // only after the code (a paid SMS nobody could use) was typed.
  if (purpose === 'change_phone') {
    try {
      const { data: taken, error: takenErr } = await supabase
        .from('users').select('id').in('phone', phoneVariants(p)).is('deleted_at', null).limit(1);
      if (!takenErr && Array.isArray(taken) && taken.length > 0) {
        return res.status(409).json({ error: 'That number is already on another SportClan account.', code: 'PHONE_IN_USE' });
      }
    } catch {
      // fall through and send
    }
  }

  // 28 Sep: a per-number send limit on top of the per-IP one — it stops
  // SMS-bombing someone else's number from many IPs and caps what we pay.
  // Counted in the OTP store (survives restarts / instances). Allowlisted
  // numbers are counted too: the limit is about the number, not the SMS.
  const [sentHour, sentDay] = await Promise.all([
    readCounter(`sendh:${p}`),
    readCounter(`sendd:${p}`),
  ]);
  if (sentHour >= SEND_PER_NUMBER_HOUR || sentDay >= SEND_PER_NUMBER_DAY) {
    return res.status(429).json({
      error: sentDay >= SEND_PER_NUMBER_DAY
        ? 'Too many codes sent to this number today. Try again tomorrow.'
        : 'Too many codes sent to this number. Try again in an hour.',
      code: 'OTP_SEND_LIMIT',
    });
  }
  await Promise.all([bumpCounter(`sendh:${p}`, 3600), bumpCounter(`sendd:${p}`, 86400)]);

  // OTP test-number allowlist (utils/otpTestNumbers): a listed number gets the
  // fixed test code and no SMS; every other number is unchanged.
  const testCode = testCodeFor(p);
  const code = testCode ?? generateOtp();

  // SC-398: storing the code is the step that used to throw when Upstash was
  // unconfigured, and sendOtp had no try/catch — so an unset env var turned the
  // app's primary login path into a bare 500. otpStore now falls back through
  // Postgres to memory, but the guard stays: if EVERY backend is down the user
  // gets a clear, retryable message instead of "Internal server error".
  try {
    await setOtp(p, code, purpose, OTP_TTL_SECONDS);
    await clearWrongCodes(p); // a new code, a new count of wrong guesses
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
  if (testCode) {
    // eslint-disable-next-line no-console
    console.info(`[otp-test] ${maskPhone(p)} purpose=${purpose}: test code stored, no SMS sent`);
    return res.json({ success: true, message: 'OTP sent', channel: usedChannel });
  }
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
  if (typeof phone !== 'string') return res.status(400).json(INVALID_PHONE_BODY); // B01-F12: was a 500
  const p = canonicalisePhone(phone) ?? normalizePhone(phone);
  // Dev-only bypass (see isTestOtp): accept the fixed test code without a real OTP.
  if (isTestOtp(code)) {
    await setOtp(p, verifiedMarker(code), 'login', OTP_TTL_SECONDS);
    return res.json({ success: true, verified: true });
  }
  // 28 Sep: one shared check — 5 wrong codes and the code is gone.
  const chk = await checkOtpCode(p, code);
  if (chk !== 'ok') { const e = otpCheckError(chk); return res.status(e.status).json(e.body); }
  const entry = await getOtp(p);
  if (!entry) return res.status(400).json({ error: 'No OTP requested or OTP expired', code: 'OTP_EXPIRED' });
  // Mark verified — store VERIFIED with fresh TTL
  // The marker only stands in for THIS code (it used to be a bare 'VERIFIED'
  // that reset-password accepted with any code).
  await setOtp(p, verifiedMarker(code), entry.purpose, OTP_TTL_SECONDS);
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
    name, username, email, password, gender, dob, link, city_id, bio,
    account_types, sport_ids, coupon_code, profile_picture_url,
  } = req.body || {};

  if (!phone || !code) return res.status(400).json({ error: 'phone and code are required' });
  if (typeof phone !== 'string') return res.status(400).json(INVALID_PHONE_BODY); // B01-F12: was a 500
  if (!name || !username) return res.status(400).json({ error: 'name and username are required' });
  // Phase 3 B01-F3: the rules Edit profile enforces, checked before the code
  // is used up. Sign-up checked none of them.
  const rule = signupProfileProblem({ name, username, email, dob, bio, link, profile_picture_url });
  if (rule) return res.status(rule.status).json({ error: rule.error, ...(rule.code ? { code: rule.code } : {}) });
  const cleanEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
  // A password is OPTIONAL on signup, and it is the only way one is ever set at
  // signup now: the phone-less email+password path (registerEmail) is gone.
  // Phone is mandatory because a verified number is the only recovery route
  // this app has — there is no email provider, so nothing can be sent to an
  // address. Email + password are extras that let someone sign in without an
  // SMS; they are never a substitute for the number.
  if (password != null && (typeof password !== 'string' || password.length < 8)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

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
    const chk = await checkOtpCode(p, code);
    if (chk !== 'ok') { const e = otpCheckError(chk); return res.status(e.status).json(e.body); }
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
      // Decided 28 Sep: only after the 30 days — until then the number is held
      // (and sendOtp won't have sent a code, but the rule lives here too).
      const held = holdUntil((existingPhone as { deleted_at?: string | null }).deleted_at);
      if (held) return res.status(403).json(deletedResponse(held));
      const freed = await releaseNumber((existingRows ?? []).filter((r: any) => r.deleted_at).map((r: any) => r.id));
      if (!freed) return res.status(500).json({ error: 'Could not free the number for re-registration' });
    } else {
      return res.status(400).json({
        code: 'PHONE_ALREADY_REGISTERED',
        error: 'This mobile number is already registered. Please login instead.',
      });
    }
  }

  // Email must be free (if provided)
  // B01-F3: case-insensitive, like Edit profile — `Foo@x.com` and `foo@x.com`
  // could both register, and email sign-in (ilike) then failed for both.
  if (cleanEmail) {
    const { data: existingEmail } = await supabase
      .from('users').select('id').ilike('email', escapeLike(cleanEmail)).limit(1).maybeSingle();
    if (existingEmail) {
      return res.status(400).json({
        code: 'EMAIL_ALREADY_REGISTERED',
        error: 'This email is already registered.',
      });
    }
  }

  // Username must be free (case-insensitive)
  const { data: existingUsername } = await supabase
    .from('users').select('id').ilike('username', escapeLike(username.trim())).limit(1).maybeSingle(); // B01-F11
  if (existingUsername) return res.status(409).json({ error: 'Username already taken' });

  if (gender && !(GENDERS as readonly string[]).includes(gender)) {
    return res.status(400).json({ error: GENDER_ERROR });
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
      name: name.trim(),
      username: username.trim(),
      email: cleanEmail,
      password_hash: password ? await bcrypt.hash(password, 10) : null,
      gender: gender || null,
      dob: dob || null,
      link: link || null,
      bio: bio || null,
      // B01-F2: the photo picked at sign-up was uploaded, then dropped here.
      // Checked against the storage allowlist by signupProfileProblem above.
      profile_picture_url: profile_picture_url || null,
      city_id: city_id || null,
      account_type: primaryAccountType,
      coin_balance: 0,
      referral_code: referralCode,
      // V048 (D19): a new account's date of birth is private until they choose
      // to show it (Settings › Privacy). Existing accounts keep their setting.
      show_dob: false,
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
    await awardCoins(user.id, 'first_registration', 10, 'Signup bonus');
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
  const refreshToken = generateRefreshToken(user.id);
  const sid = await insertRefreshToken(user.id, refreshToken, req); // B15 (D17): with its device
  const accessToken = generateAccessToken(user.id, sid); // decision 15: tied to this sign-in
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
  if (typeof phone !== 'string') return res.status(400).json(INVALID_PHONE_BODY); // B01-F12: was a 500
  const p = canonicalisePhone(phone) ?? normalizePhone(phone);
  // Dev-only bypass (see isTestOtp): skip OTP validation for the fixed test code.
  // The user must still exist (seeded) — otherwise we fall through to the 404 below.
  if (!isTestOtp(code)) {
    const chk = await checkOtpCode(p, code);
    if (chk !== 'ok') { const e = otpCheckError(chk); return res.status(e.status).json(e.body); }
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, phone, name, username, email, gender, dob, link, bio, city_id, account_type, profile_picture_url, coin_balance, is_admin, created_at, deleted_at')
    // SC-386: look up EVERY form. Deliberately permissive — an account still
    // stored the legacy way must keep logging in, both in the window before
    // migration 083 runs and afterwards if a value could not be canonicalised.
    .in('phone', phoneVariants(p))
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  // Decided 28 Sep: a deleted account past its 30 days no longer owns the
  // number — this person is new, and goes to sign-up like anyone else.
  const deletedAt = (user as { deleted_at?: string | null } | null)?.deleted_at ?? null;
  if (!user || (deletedAt && !holdUntil(deletedAt))) {
    return res.status(404).json({ error: 'Phone not registered', needsRegistration: true });
  }
  if (await isSuspended(user.id)) {
    return res.status(403).json({ error: 'This account has been suspended. Please contact support.' });
  }
  if (deletedAt || (await isDeleted(user.id))) {
    return res.status(403).json(deletedResponse(holdUntil(deletedAt)));
  }
  delete (user as { deleted_at?: unknown }).deleted_at;

  await deleteOtp(p);
  const refreshToken = generateRefreshToken(user.id);
  const sid = await insertRefreshToken(user.id, refreshToken, req); // B15 (D17): with its device
  const accessToken = generateAccessToken(user.id, sid); // decision 15: tied to this sign-in
  return res.json({ user, accessToken, refreshToken, isNewUser: false });
}

// POST /auth/login  { phone, password } or { email, password }
export async function login(req: Request, res: Response) {
  const { phone, email, password } = req.body || {};
  if (!password || (!phone && !email)) {
    return res.status(400).json({ error: 'password and either phone or email are required' });
  }
  // B01-F12: a number or object here reached .trim() / phoneVariants → 500.
  if (typeof password !== 'string' || (email && typeof email !== 'string') || (!email && typeof phone !== 'string')) {
    return res.status(400).json({ error: 'password and either phone or email are required' });
  }

  let query = supabase
    .from('users')
    .select('id, phone, name, username, email, password_hash, city_id, account_type, profile_picture_url, coin_balance, is_admin, created_at, deleted_at');

  if (email) {
    query = query.ilike('email', escapeLike(email.trim())); // B01-F11: `_` is a literal
  } else {
    query = query.in('phone', phoneVariants(phone)).limit(1);  // SC-386: any stored form
  }

  const { data: user } = await query.maybeSingle();
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  // Decision 12 (29 Sep 2026): the app's password form now signs in by mobile
  // too. Deletion clears the password, so a held number used to answer "OTP
  // login only". It gets the same refusal send-otp gives that number (which
  // already says so without a password); past the 30-day hold it's no account.
  if (!email && user.deleted_at) {
    const held = holdUntil(user.deleted_at);
    return held
      ? res.status(403).json(deletedResponse(held))
      : res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!user.password_hash) return res.status(401).json({ error: 'Account uses OTP login only' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  if (await isSuspended(user.id)) {
    return res.status(403).json({ error: 'This account has been suspended. Please contact support.' });
  }
  if (await isDeleted(user.id)) {
    return res.status(403).json({ error: 'This account has been deleted.', code: 'ACCOUNT_DELETED' });
  }
  const refreshToken = generateRefreshToken(user.id);
  const sid = await insertRefreshToken(user.id, refreshToken, req); // B15 (D17): with its device
  const accessToken = generateAccessToken(user.id, sid); // decision 15: tied to this sign-in
  const { password_hash: _ph, deleted_at: _da, ...safe } = user;
  return res.json({ user: safe, accessToken, refreshToken });
}

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
      return res.status(403).json({ error: 'This account has been deleted.', code: 'ACCOUNT_DELETED' });
    }
    // B15 (D17): "last active" on Active sessions. Best-effort; a missing
    // column (before migration 100) must not fail a refresh.
    void Promise.resolve(
      supabase.from('refresh_tokens').update({ last_used_at: new Date().toISOString(), ...refreshedDeviceFields(req) }).eq('id', row.id),
    ).catch(() => undefined);
    const accessToken = generateAccessToken(payload.userId, row.id); // decision 15: this sign-in's sid
    return res.json({ accessToken });
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
}

// POST /auth/logout  { refreshToken }
export async function logout(req: Request, res: Response) {
  const { refreshToken, pushToken } = req.body || {};
  if (refreshToken) {
    const { data: signedOut } = await supabase.from('refresh_tokens').update({ revoked: true }).eq('token', refreshToken).select('id');
    // Decision 15: the access token this phone still holds stops now too.
    await denySessions(((signedOut ?? []) as Array<{ id: string }>).map((r) => r.id));
  }
  // Phase 3 B09-F2: a signed-out phone stops getting this account's pushes. The
  // token itself is the proof — only the phone that holds it can send it.
  if (typeof pushToken === 'string' && pushToken) {
    await supabase.from('push_tokens').delete().eq('token', pushToken);
  }
  return res.json({ success: true });
}

// GET /auth/username/check?username=
// Returns { available: boolean }. Used by RegisterStep1 before submit.
export async function checkUsername(req: Request, res: Response) {
  const username = ((req.query.username as string) || '').trim();
  if (!username) return res.status(400).json({ error: 'username is required' });
  if (username.length < 3) return res.json({ available: false });
  // B01-F3: what sign-up refuses isn't "available" (`admin`, 31+ characters).
  if (!USERNAME_RE.test(username) || RESERVED_USERNAMES.has(username.toLowerCase())) return res.json({ available: false });
  const { data } = await supabase
    .from('users').select('id').ilike('username', escapeLike(username)).limit(1).maybeSingle(); // B01-F11
  return res.json({ available: !data });
}

// SC-434: validateCoupon lived here. Removed with coupons; the table stays.

export async function resetPassword(req: Request, res: Response) {
  const { phone, code, newPassword } = req.body || {};
  if (!phone || !code || !newPassword) {
    return res.status(400).json({ error: 'phone, code, newPassword are required' });
  }
  if (typeof phone !== 'string') return res.status(400).json(INVALID_PHONE_BODY); // B01-F12
  // B01-F4: the app's 8-character rule, on the server too — checked before the
  // code so a guess isn't spent on a password that would be refused.
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const p = canonicalisePhone(phone) ?? normalizePhone(phone);
  // Honor the dev-only test bypass uniformly with verifyOtp/otpLogin/register
  // (see isTestOtp). In production isTestOtp() is always false, so the real
  // OTP check still runs.
  if (!isTestOtp(code)) {
    const chk = await checkOtpCode(p, code, { purpose: 'reset' });
    if (chk !== 'ok') { const e = otpCheckError(chk); return res.status(e.status).json(e.body); }
  }
  const password_hash = await bcrypt.hash(newPassword, 10);
  // 28 Sep: this said "success" when no account matched (an update of zero
  // rows is not an error to PostgREST), and it could reach a deleted account's
  // row. Live accounts only, and zero rows is an answer, not a success.
  const { data: updated, error } = await supabase
    .from('users')
    .update({ password_hash })
    .in('phone', phoneVariants(p))
    .is('deleted_at', null)
    .select('id');
  if (error) return res.status(500).json({ error: error.message });
  await deleteOtp(p);
  if (!updated || updated.length === 0) {
    return res.status(404).json({ error: 'No SportClan account uses this number.', code: 'PHONE_NOT_REGISTERED' });
  }
  // Decision 8 (Dipak, 29 Sep 2026): a reset signs every device out — a reset
  // is often because someone else got in. The device resetting isn't signed in,
  // so nothing is kept: refresh tokens go (no renewing), the access tokens
  // already out stop on their next request (SC-384), and no more pushes.
  for (const { id } of updated as Array<{ id: string }>) {
    await supabase.from('refresh_tokens').delete().eq('user_id', id);
    await revokeSessionsNow(id);
    try {
      await supabase.from('push_tokens').delete().eq('user_id', id);
    } catch { /* best-effort: the password is already changed */ }
  }
  return res.json({ success: true });
}

// POST /auth/change-phone  { newPhone, code }  (requires auth — verifies OTP sent to NEW phone)
export async function changePhone(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { newPhone, code } = req.body || {};
  if (!newPhone || !code) return res.status(400).json({ error: 'newPhone and code are required' });
  if (typeof newPhone !== 'string') return res.status(400).json(INVALID_PHONE_BODY); // B01-F12
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
    const chk = await checkOtpCode(p, code, { purpose: 'change_phone' });
    if (chk !== 'ok') { const e = otpCheckError(chk); return res.status(e.status).json(e.body); }
  }
  // Decided 28 Sep: a deleted account's number is held for 30 days, then free —
  // an expired row still carrying it (purge not run yet) is released here.
  const del = await deletedNumberState(p);
  if (del.heldUntil) return res.status(403).json(deletedResponse(del.heldUntil));
  if (del.expiredIds.length && !(await releaseNumber(del.expiredIds))) {
    return res.status(500).json({ error: 'Could not free the number' });
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
