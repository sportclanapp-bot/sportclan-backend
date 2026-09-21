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
/**
 * `match_events.client_key` is a `uuid` column, and a key that is not one is not
 * stored — the insert falls back to a keyless row and that op silently loses its
 * idempotency. Every op the app produces uses `crypto.randomUUID()`, so this only
 * bites a crafted payload; but carrying ops that CANNOT dedupe is precisely the
 * double-count this feature exists to prevent, so they are refused at the door
 * rather than applied and hoped over. Found while verifying on prod.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksWellFormed(env: unknown): env is HandoffEnvelope {
  const e = env as HandoffEnvelope | null;
  if (!e || typeof e !== 'object' || typeof e.sig !== 'string' || !e.p) return false;
  const p = e.p;
  if (p.v !== 1) return false;
  for (const f of ['m', 'd', 'u', 'n'] as const) if (typeof p[f] !== 'string' || !p[f]) return false;
  if (typeof p.t !== 'number' || !Number.isFinite(p.t)) return false;
  if (!Array.isArray(p.o) || p.o.length === 0 || p.o.length > 500) return false;
  return p.o.every(
    (o) => o && typeof o.k === 'string' && UUID_RE.test(o.k) && typeof o.s === 'number'
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

  /**
   * Every key this device has ever registered, newest first — not just the live
   * one.
   *
   * Taking only the newest row was wrong in the exact case the revoked rows exist
   * for. A phone reinstalls, registers a fresh pair, and a code it signed an hour
   * earlier then fails to match the new key and comes back as "altered or not
   * signed by that phone" — accusing a scorer of tampering when all they did was
   * reinstall. Found live, on prod, with a real rotation.
   *
   * Ten is plenty: it is a per-device key history, and a phone that has rotated
   * ten times has a problem no error message can help with.
   */
  const { data: keyRows } = await supabase
    .from('device_signing_keys')
    .select('public_key, revoked_at, revoked_reason')
    .eq('user_id', p.u)
    .eq('device_id', p.d)
    .order('created_at', { ascending: false })
    .limit(10);
  if (!keyRows?.length) {
    return { ok: false, reason: 'UNKNOWN_DEVICE', detail: 'That phone has never registered a signing key.' };
  }

  type KeyRow = { public_key: string; revoked_at?: string | null; revoked_reason?: string | null };
  const rows = keyRows as KeyRow[];
  const live = rows.find((r) => !r.revoked_at);
  if (live && verifySignature(p, sig, live.public_key)) return { ok: true, payload: p };

  // Only claim "revoked" when the signature genuinely verifies against a revoked
  // key. Saying it on any failure would turn this into an oracle and would be a
  // guess dressed up as a fact.
  const revoked = rows.find((r) => r.revoked_at && verifySignature(p, sig, r.public_key));
  if (revoked) {
    return {
      ok: false,
      reason: 'DEVICE_REVOKED',
      detail: revoked.revoked_reason === 'rotated'
        ? 'That phone has signed in again since this code was made, so the code is out of date. Ask for a new one.'
        : 'That phone’s signing key was revoked.',
    };
  }

  return { ok: false, reason: 'BAD_SIGNATURE', detail: 'This code was altered or was not signed by that phone.' };
}


/**
 * Whether a VERIFIED handoff may actually be applied, and if not, what to tell
 * the person holding the phone.
 *
 * Kept out of the controller for two reasons. It is the security precedence — a
 * mismatched match id must outrank a moved lease, which must outrank a finished
 * match — and precedence written inline is precedence nobody can test. And the
 * reader is the COURIER, a stranger who has done nothing wrong, so the wording is
 * about the code rather than about them.
 *
 * The signature has already been checked by the time this runs. This decides only
 * what the world looks like now.
 */
export interface HandoffGuardInput {
  /** The match id in the URL, which the payload must agree with. */
  routeMatchId: string;
  payloadMatchId: string;
  /** Verdict from the SAME authorisation the direct scoring path uses, asked
   *  about the signer. `null` means it passed. */
  authFailure: { status: number; error: string; code?: string } | null;
  match: { status?: string | null; voided_at?: string | null } | null;
  sportInactive: boolean;
  isTerminal: (status?: string | null) => boolean;
}

export interface HandoffRefusal { status: number; code: string; error: string }

export function handoffRefusal(input: HandoffGuardInput): HandoffRefusal | null {
  // First, because a code valid for match A being POSTed at match B is the one
  // failure here that is an attack rather than an accident.
  if (input.payloadMatchId !== input.routeMatchId) {
    return { status: 400, code: 'MATCH_MISMATCH', error: 'This code is for a different match.' };
  }
  if (!input.match) {
    return { status: 404, code: 'MATCH_NOT_FOUND', error: 'Match not found.' };
  }
  if (input.authFailure) {
    const { status } = input.authFailure;
    if (status === 409) {
      return {
        status: 409, code: 'LEASE_MOVED',
        error: 'Someone else took over scoring this match, so this code can no longer be applied.',
      };
    }
    if (status === 403) {
      return { status: 403, code: 'NOT_A_SCORER', error: 'That phone is not a scorer for this match.' };
    }
    return { status, code: input.authFailure.code ?? 'NOT_ALLOWED', error: input.authFailure.error };
  }
  if (input.isTerminal(input.match.status)) {
    return { status: 409, code: 'MATCH_FINISHED', error: 'This match is finished and can no longer be scored.' };
  }
  if (input.sportInactive) {
    return { status: 400, code: 'SPORT_INACTIVE', error: 'This sport is not available.' };
  }
  // Deliberately STRICTER than the direct scoring path: a voided match is one
  // somebody has already ruled does not count, so adding to it by proxy — with
  // its scorer out of signal and unable to see it happen — is worth refusing.
  if (input.match.voided_at) {
    return { status: 409, code: 'MATCH_VOIDED', error: 'This match was voided, so it can no longer be scored.' };
  }
  return null;
}
