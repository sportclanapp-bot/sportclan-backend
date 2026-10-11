/**
 * Audit #11 (11 Oct 2026): changing the phone number, and deleting the
 * account, needed only an access token — so a stolen 15-minute token could
 * move the number to the thief (then reset the password and keep the account)
 * or delete the account. Both now need a fresh check: the current password, or
 * a code texted to the account's CURRENT number (purpose 'reauth').
 */
import bcrypt from 'bcryptjs';
import type { Request } from 'express';
import { supabase } from './supabase';
import { checkOtpCode, otpCheckError } from './otpCheck';
import { canonicalisePhone, isValidIndianPhone } from './phone';
import { clientIpKey } from '../middleware/rateLimitKey';
import { deleteOtp } from './otpStore';

export type ReauthRefusal = { status: number; body: { error: string; code: string; methods?: string[] } };

export async function reauthRefusal(req: Request, userId: string): Promise<ReauthRefusal | null> {
  const { current_password: password, reauth_code: code } = (req.body || {}) as { current_password?: unknown; reauth_code?: unknown };
  const { data: user } = await supabase.from('users').select('phone, password_hash').eq('id', userId).maybeSingle();
  const u = (user ?? {}) as { phone?: string | null; password_hash?: string | null };
  // An email sign-up holds a placeholder number ('+0…') that can't get a text.
  const realPhone = !!u.phone && isValidIndianPhone(canonicalisePhone(u.phone) ?? u.phone);
  const methods = [...(u.password_hash ? ['password'] : []), ...(realPhone ? ['code'] : [])];
  // Nothing to check with (a Google sign-up with no password and no number yet):
  // allowed, so such an account can still add its first number. Written down as
  // a judgement call in BATCH1_FOR_DIPAK.md.
  if (methods.length === 0) return null;
  if (typeof password === 'string' && password) {
    if (u.password_hash && (await bcrypt.compare(password, u.password_hash))) return null;
    return { status: 403, body: { error: 'That password isn’t right.', code: 'REAUTH_WRONG', methods } }; // 403, not 401: the app signs out on a 401
  }
  if (typeof code === 'string' && code && realPhone && u.phone) {
    const p = canonicalisePhone(u.phone) ?? u.phone;
    const chk = await checkOtpCode(p, code, { purpose: 'reauth', requester: clientIpKey(req) });
    if (chk === 'ok') { await deleteOtp(p); return null; }
    const e = otpCheckError(chk);
    return { status: e.status, body: { ...e.body, methods } };
  }
  return {
    status: 403, // not 401: the app treats a 401 as a dead session and signs out
    body: { error: 'Confirm it’s you first: your password, or a code we text to your current number.', code: 'REAUTH_REQUIRED', methods },
  };
}
