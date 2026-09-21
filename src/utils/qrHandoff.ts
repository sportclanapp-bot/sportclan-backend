/**
 * SC-432 · verifying a signed QR handoff.
 *
 * A scorer stuck at a zero-signal venue shows a QR; any nearby phone WITH signal
 * scans it and uploads. The courier is untrusted — they must not be able to change
 * what they carry, and neither must anyone who photographs the screen over a
 * shoulder.
 *
 * The envelope is `{ p, sig }`: `sig` is Ed25519 over the CANONICAL JSON bytes of
 * `p`, made on the scorer's phone with a private key that never leaves it. We hold
 * only the public half (device_signing_keys), registered while that phone had
 * signal.
 *
 * CANONICAL JSON, not "whatever JSON.stringify did". Key order has to be identical
 * on both sides or a perfectly honest payload fails to verify, which would be a
 * maddening bug to chase at a ground with no signal. Sorting keys makes the bytes
 * a function of the DATA rather than of how two runtimes happened to build the
 * object.
 *
 * WHAT VERIFICATION DOES NOT DO: it does not grant authority. A valid signature
 * proves only "this device produced these bytes". Whether that device may score
 * THIS match is a separate question answered by the lease and by
 * canOfficiateMatch, and the scanner's own permissions never enter into it — they
 * are a courier, not a scorer.
 */

import { createPublicKey, verify as nodeVerify } from 'crypto';
import { supabase } from './supabase';

/** Ed25519 SPKI DER prefix; the raw 32-byte key is appended to it. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** How long a handoff QR stays acceptable. Long enough to walk out of a ground
 *  and find a phone with signal; short enough that a photographed code is not a
 *  standing licence. */
export const HANDOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface HandoffOp {
  /** The outbox's own clientKey — the idempotency key the scorer's phone will
   *  re-send under, which is exactly why this must survive the trip unchanged. */
  k: string;
  /** Outbox seq, so ops apply in the order they were tapped. */
  s: number;
  t: 'event';
  e: { event_type: string; period?: string | null; clock_seconds?: number | null; payload?: Record<string, unknown> };
}

export interface HandoffPayload {
  v: 1;
  /** match id */
  m: string;
  /** signing device id */
  d: string;
  /** the SCORER — events are authored as this user, never as the scanner */
  u: string;
  /** replay nonce */
  n: string;
  /** issued-at, epoch ms */
  t: number;
  o: HandoffOp[];
}

export interface HandoffEnvelope { p: HandoffPayload; sig: string }

/**
 * Deterministic bytes for a payload: JSON with object keys sorted, recursively.
 * Both signer and verifier must produce byte-identical output for the same data.
 */
export function canonicalBytes(value: unknown): Buffer {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = canon((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return Buffer.from(JSON.stringify(canon(value)), 'utf8');
}

export function verifySignature(payload: HandoffPayload, sigB64: string, publicKeyB64: string): boolean {
  try {
    const raw = Buffer.from(publicKeyB64, 'base64url');
    if (raw.length !== 32) return false;
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
    return nodeVerify(null, canonicalBytes(payload), key, Buffer.from(sigB64, 'base64url'));
  } catch {
    // A malformed key or signature is a failed verification, not a 500.
    return false;
  }
}

export type HandoffRejection =
  | 'MALFORMED'
  | 'BAD_SIGNATURE'
  | 'UNKNOWN_DEVICE'
  | 'DEVICE_REVOKED'
  | 'EXPIRED'
  | 'MATCH_NOT_FOUND'
  | 'NOT_A_SCORER'
  | 'LEASE_MOVED';

export interface VerifyResult {
  ok: boolean;
  reason?: HandoffRejection;
  detail?: string;
}

/** Shape check before any crypto: never hand attacker-controlled junk to a parser
 *  that assumes structure. */
export function looksWellFormed(env: unknown): env is HandoffEnvelope {
  const e = env as HandoffEnvelope | null;
  if (!e || typeof e !== 'object' || typeof e.sig !== 'string' || !e.p) return false;
  const p = e.p;
  if (p.v !== 1) return false;
  for (const f of ['m', 'd', 'u', 'n'] as const) if (typeof p[f] !== 'string' || !p[f]) return false;
  if (typeof p.t !== 'number' || !Number.isFinite(p.t)) return false;
  if (!Array.isArray(p.o) || p.o.length === 0 || p.o.length > 500) return false;
  return p.o.every(
    (o) => o && typeof o.k === 'string' && o.k.length > 0 && typeof o.s === 'number'
      && o.t === 'event' && o.e && typeof o.e.event_type === 'string',
  );
}

/**
 * Every check a handoff must pass, in the order that leaks least: shape, then
 * signature, then authority. We do not tell an unverified caller whether a match
 * exists or who holds its lease.
 */
export async function verifyHandoff(env: unknown, now = Date.now()): Promise<VerifyResult & { payload?: HandoffPayload }> {
  if (!looksWellFormed(env)) return { ok: false, reason: 'MALFORMED' };
  const { p, sig } = env;

  if (now - p.t > HANDOFF_MAX_AGE_MS) {
    return { ok: false, reason: 'EXPIRED', detail: 'This code is more than a day old.' };
  }
  // A clock running ahead should not mint a code that outlives its window.
  if (p.t - now > 60 * 60 * 1000) {
    return { ok: false, reason: 'EXPIRED', detail: 'This code is dated in the future.' };
  }

  const { data: keyRow } = await supabase
    .from('device_signing_keys')
    .select('public_key, revoked_at')
    .eq('user_id', p.u)
    .eq('device_id', p.d)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!keyRow) return { ok: false, reason: 'UNKNOWN_DEVICE', detail: 'That phone has never registered a signing key.' };
  if ((keyRow as { revoked_at?: string | null }).revoked_at) {
    return { ok: false, reason: 'DEVICE_REVOKED', detail: 'That phone’s signing key was revoked.' };
  }

  if (!verifySignature(p, sig, (keyRow as { public_key: string }).public_key)) {
    return { ok: false, reason: 'BAD_SIGNATURE', detail: 'This code was altered or was not signed by that phone.' };
  }

  return { ok: true, payload: p };
}
