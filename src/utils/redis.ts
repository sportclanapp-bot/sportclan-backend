import { Redis } from '@upstash/redis';

let _client: Redis | null = null;

function client(): Redis {
  if (_client) return _client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set');
  }
  _client = new Redis({ url, token });
  return _client;
}

function otpKey(phone: string): string {
  return `otp:${phone}`;
}

interface OtpData {
  code: string;
  purpose: string;
}

export async function setOtp(
  phone: string,
  code: string,
  purpose: string,
  ttlSeconds = 300,
): Promise<void> {
  await client().set(otpKey(phone), JSON.stringify({ code, purpose }), { ex: ttlSeconds });
}

export async function getOtp(phone: string): Promise<OtpData | null> {
  const raw = await client().get<string>(otpKey(phone));
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed as OtpData;
  } catch {
    return null;
  }
}

export async function deleteOtp(phone: string): Promise<void> {
  await client().del(otpKey(phone));
}
