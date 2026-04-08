import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { supabase } from '../utils/supabase';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../utils/jwt';

// In-memory OTP store for dev — replace with Redis/Twilio in a later part.
// Map<phone, { code, expiresAt, purpose }>
type OtpPurpose = 'login' | 'register' | 'reset' | 'change_phone';
interface OtpEntry {
  code: string;
  expiresAt: number;
  purpose: OtpPurpose;
}
const otpStore = new Map<string, OtpEntry>();

const OTP_TTL_MS = 5 * 60 * 1000;

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, '');
}

// POST /auth/send-otp  { phone, purpose? }
export async function sendOtp(req: Request, res: Response) {
  const { phone, purpose = 'login' } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone is required' });
  const p = normalizePhone(phone);
  const code = generateOtp();
  otpStore.set(p, { code, expiresAt: Date.now() + OTP_TTL_MS, purpose });
  // MOCK: log to console instead of sending SMS
  // eslint-disable-next-line no-console
  console.log(`[OTP MOCK] phone=${p} purpose=${purpose} code=${code}`);
  return res.json({ success: true, message: 'OTP sent (mock — see server logs)' });
}

// POST /auth/verify-otp  { phone, code }
export async function verifyOtp(req: Request, res: Response) {
  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: 'phone and code are required' });
  const p = normalizePhone(phone);
  const entry = otpStore.get(p);
  if (!entry) return res.status(400).json({ error: 'No OTP requested' });
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(p);
    return res.status(400).json({ error: 'OTP expired' });
  }
  if (entry.code !== code) return res.status(400).json({ error: 'Invalid OTP' });
  // Mark verified by re-storing with a short verified window
  otpStore.set(p, { ...entry, code: 'VERIFIED', expiresAt: Date.now() + OTP_TTL_MS });
  return res.json({ success: true, verified: true });
}

function isOtpVerified(phone: string): boolean {
  const e = otpStore.get(normalizePhone(phone));
  return !!e && e.code === 'VERIFIED' && Date.now() < e.expiresAt;
}

// POST /auth/register  { phone, code, name, password, city_id?, account_type? }
export async function register(req: Request, res: Response) {
  const { phone, code, name, password, city_id, account_type } = req.body || {};
  if (!phone || !code || !name || !password) {
    return res.status(400).json({ error: 'phone, code, name, password are required' });
  }
  const p = normalizePhone(phone);
  const entry = otpStore.get(p);
  if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
    return res.status(400).json({ error: 'OTP not verified' });
  }
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('phone', p)
    .maybeSingle();
  if (existing) return res.status(409).json({ error: 'Phone already registered' });

  const password_hash = await bcrypt.hash(password, 10);
  const { data: user, error } = await supabase
    .from('users')
    .insert({
      phone: p,
      name,
      password_hash,
      city_id: city_id || null,
      account_type: account_type || 'fan',
      is_premium: false,
      coin_balance: 0,
    })
    .select('id, phone, name, city_id, account_type, is_premium, coin_balance')
    .single();
  if (error || !user) return res.status(500).json({ error: error?.message || 'Failed to create user' });

  otpStore.delete(p);
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
  return res.json({ user, accessToken, refreshToken });
}

// POST /auth/login  { phone, password }
export async function login(req: Request, res: Response) {
  const { phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ error: 'phone and password are required' });
  const p = normalizePhone(phone);
  const { data: user } = await supabase
    .from('users')
    .select('id, phone, name, password_hash, city_id, account_type, is_premium, coin_balance')
    .eq('phone', p)
    .maybeSingle();
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
  const { password_hash: _ph, ...safe } = user;
  return res.json({ user: safe, accessToken, refreshToken });
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

// POST /auth/google — placeholder
export async function googleAuth(_req: Request, res: Response) {
  return res.status(501).json({ error: 'Google Sign-In coming soon' });
}

// POST /auth/reset-password  { phone, code, newPassword }
export async function resetPassword(req: Request, res: Response) {
  const { phone, code, newPassword } = req.body || {};
  if (!phone || !code || !newPassword) {
    return res.status(400).json({ error: 'phone, code, newPassword are required' });
  }
  const p = normalizePhone(phone);
  const entry = otpStore.get(p);
  if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
    return res.status(400).json({ error: 'OTP not verified' });
  }
  const password_hash = await bcrypt.hash(newPassword, 10);
  const { error } = await supabase.from('users').update({ password_hash }).eq('phone', p);
  if (error) return res.status(500).json({ error: error.message });
  otpStore.delete(p);
  return res.json({ success: true });
}

// POST /auth/change-phone  { newPhone, code }  (requires auth — verifies OTP sent to NEW phone)
export async function changePhone(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { newPhone, code } = req.body || {};
  if (!newPhone || !code) return res.status(400).json({ error: 'newPhone and code are required' });
  const p = normalizePhone(newPhone);
  const entry = otpStore.get(p);
  if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
    return res.status(400).json({ error: 'OTP not verified' });
  }
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('phone', p)
    .maybeSingle();
  if (existing) return res.status(409).json({ error: 'Phone already in use' });
  const { error } = await supabase.from('users').update({ phone: p }).eq('id', userId);
  if (error) return res.status(500).json({ error: error.message });
  otpStore.delete(p);
  return res.json({ success: true });
}
