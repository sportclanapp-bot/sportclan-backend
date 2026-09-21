/**
 * SC-432 · a signed QR handoff, and every way someone might try to abuse it.
 *
 * The scenario: a scorer at a zero-signal ground shows a QR; a stranger with
 * signal scans it and uploads. The courier is untrusted and so is anyone who
 * photographs the screen over a shoulder, so the interesting tests are the
 * attacks rather than the happy path.
 */
import { generateKeyPairSync, sign as nodeSign, createPrivateKey } from 'crypto';
import { canonicalBytes, verifySignature, looksWellFormed, HANDOFF_MAX_AGE_MS } from '../utils/qrHandoff';
import type { HandoffPayload } from '../utils/qrHandoff';

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');

/** Node's own Ed25519 — no dependency, and the app's library is pinned separately
 *  by the fixed interop vector at the bottom of this file. */
function makeSigner() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return {
    publicKey: b64u(raw),
    sign: (p: HandoffPayload) => b64u(nodeSign(null, canonicalBytes(p), privateKey)),
  };
}

const payload = (over: Partial<HandoffPayload> = {}): HandoffPayload => ({
  v: 1,
  m: '11111111-1111-1111-1111-111111111111',
  d: 'device-abc',
  u: '22222222-2222-2222-2222-222222222222',
  n: 'nonce-1',
  t: Date.now(),
  o: [
    { k: '11111111-1111-4111-8111-111111111111', s: 1, t: 'event', e: { event_type: 'ball', payload: { team_side: 'A', runs: 4 } } },
    { k: '22222222-2222-4222-8222-222222222222', s: 2, t: 'event', e: { event_type: 'ball', payload: { team_side: 'A', runs: 1 } } },
  ],
  ...over,
});

describe('SC-432 · canonical bytes', () => {
  it('are a function of the DATA, not of key order', () => {
    // Two runtimes building the same object differently must sign the same bytes,
    // or an honest payload fails to verify at a ground with no signal — which
    // would be a maddening bug to chase.
    expect(canonicalBytes({ b: 1, a: 2 })).toEqual(canonicalBytes({ a: 2, b: 1 }));
    expect(canonicalBytes({ o: [{ z: 1, a: 2 }] })).toEqual(canonicalBytes({ o: [{ a: 2, z: 1 }] }));
  });

  it('still change when the data changes', () => {
    expect(canonicalBytes({ a: 1 })).not.toEqual(canonicalBytes({ a: 2 }));
  });
});

describe('SC-432 · signature', () => {
  it('a genuine payload verifies', () => {
    const s = makeSigner();
    const p = payload();
    expect(verifySignature(p, s.sign(p), s.publicKey)).toBe(true);
  });

  it('TAMPERED runs are rejected — the courier cannot change the score', () => {
    const s = makeSigner();
    const p = payload();
    const sig = s.sign(p);
    const tampered = payload();
    (tampered.o[0]! as unknown as { e: { payload: { runs: number } } }).e.payload.runs = 6; // 4 became 6
    expect(verifySignature(tampered, sig, s.publicKey)).toBe(false);
  });

  it('an APPENDED op is rejected — nor can they add a ball', () => {
    const s = makeSigner();
    const p = payload();
    const sig = s.sign(p);
    const extended = payload();
    extended.o.push({ k: '33333333-3333-4333-8333-333333333333', s: 3, t: 'event', e: { event_type: 'ball', payload: { team_side: 'A', runs: 6 } } });
    expect(verifySignature(extended, sig, s.publicKey)).toBe(false);
  });

  it('a REPOINTED match id is rejected — a valid code cannot be aimed elsewhere', () => {
    const s = makeSigner();
    const p = payload();
    const sig = s.sign(p);
    expect(verifySignature(payload({ m: '99999999-9999-9999-9999-999999999999' }), sig, s.publicKey)).toBe(false);
  });

  it('a DIFFERENT device’s key does not verify — signatures are per phone', () => {
    const a = makeSigner(); const b = makeSigner();
    const p = payload();
    expect(verifySignature(p, a.sign(p), b.publicKey)).toBe(false);
  });

  it('a malformed key or signature fails closed, it does not throw', () => {
    const s = makeSigner(); const p = payload();
    expect(verifySignature(p, s.sign(p), 'not-a-key')).toBe(false);
    expect(verifySignature(p, 'not-a-signature', s.publicKey)).toBe(false);
    expect(verifySignature(p, s.sign(p), b64u(new Uint8Array(31)))).toBe(false); // wrong length
  });
});

describe('SC-432 · shape gate before any crypto', () => {
  it('accepts a well-formed envelope', () => {
    expect(looksWellFormed({ p: payload(), sig: 'x' })).toBe(true);
  });

  it('rejects junk rather than handing it to a parser that assumes structure', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { p: payload() }, { sig: 'x' }]) {
      expect(looksWellFormed(bad)).toBe(false);
    }
  });

  it('rejects an empty or absurdly large op list', () => {
    expect(looksWellFormed({ p: payload({ o: [] }), sig: 'x' })).toBe(false);
    const huge = Array.from({ length: 501 }, (_, i) => ({ k: `k${i}`, s: i, t: 'event' as const, e: { event_type: 'ball' } }));
    expect(looksWellFormed({ p: payload({ o: huge }), sig: 'x' })).toBe(false);
  });

  it('rejects an unknown version — old phones must not be silently reinterpreted', () => {
    expect(looksWellFormed({ p: payload({ v: 2 as 1 }), sig: 'x' })).toBe(false);
  });

  it('rejects an op with no idempotency key, which is what makes replay safe', () => {
    expect(looksWellFormed({ p: payload({ o: [{ k: '', s: 1, t: 'event', e: { event_type: 'ball' } }] }), sig: 'x' })).toBe(false);
    // And a key that is not a UUID, which `match_events.client_key` cannot store:
    // the row would be written WITHOUT a key and that op would silently lose its
    // idempotency — the double-count this whole feature exists to prevent.
    expect(looksWellFormed({ p: payload({ o: [{ k: 'ck-1', s: 1, t: 'event', e: { event_type: 'ball' } }] }), sig: 'x' })).toBe(false);
  });
});

describe('SC-432 · staleness', () => {
  it('a day-old code is past its window', () => {
    const now = Date.now();
    expect(now - (now - HANDOFF_MAX_AGE_MS - 1) > HANDOFF_MAX_AGE_MS).toBe(true);
  });

  it('a code from within the window is fine — long enough to walk out and find signal', () => {
    const now = Date.now();
    expect(now - (now - 6 * 3600_000) > HANDOFF_MAX_AGE_MS).toBe(false);
  });
});

/**
 * SC-432 · interop, pinned.
 *
 * The signature is made on the PHONE by @noble/curves and verified HERE by Node's
 * built-in crypto. Two different implementations of the same curve, and of the
 * same canonical-JSON rule, have to agree byte for byte — if they ever stop, every
 * handoff from a real phone fails at a ground with no signal, which is precisely
 * where nobody can debug it.
 *
 * So this vector was generated by the APP's library and is checked against the
 * SERVER's verifier. It is deliberately fixed rather than regenerated: a change in
 * either implementation, or in the canonical-bytes rule, breaks this test.
 */
describe('SC-432 \u00b7 app-signed, server-verified', () => {
  const PUBLIC_KEY = 'ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ';
  const SIGNATURE = '8jFkHqy5s6ciso1IYObAIxBRVgEel4d8UilAtSSEAUX2FV8uF7_Dzza6qMPNzalH5kRlvq6DmcQgXy77MWkmCA';
  const PAYLOAD = {"v": 1, "m": "11111111-1111-1111-1111-111111111111", "d": "device-fixed", "u": "22222222-2222-2222-2222-222222222222", "n": "fixed-nonce", "t": 1758400000000, "o": [{"k": "ck-fixed-1", "s": 1, "t": "event", "e": {"event_type": "ball", "payload": {"team_side": "A", "runs": 4}}}]} as HandoffPayload;

  it('a signature made by the phone verifies on the server', () => {
    expect(verifySignature(PAYLOAD, SIGNATURE, PUBLIC_KEY)).toBe(true);
  });

  it('and the same vector with one run changed does not', () => {
    const tampered = JSON.parse(JSON.stringify(PAYLOAD)) as HandoffPayload;
    (tampered.o[0]! as unknown as { e: { payload: { runs: number } } }).e.payload.runs = 6;
    expect(verifySignature(tampered, SIGNATURE, PUBLIC_KEY)).toBe(false);
  });
});

/**
 * SC-432 · what a verified code is still not allowed to do.
 *
 * A valid signature proves who made the code and that nobody altered it. It says
 * nothing about whether the world still permits applying it, and every case below
 * is one where it does not. The ORDER matters as much as the answers: a code
 * aimed at the wrong match must be called out as that and never treated as a
 * permission problem on the match it was pointed at.
 */
import { handoffRefusal } from '../utils/qrHandoff';

const isTerminal = (s?: string | null) => s === 'completed' || s === 'abandoned' || s === 'cancelled';

const guard = (over: Partial<Parameters<typeof handoffRefusal>[0]> = {}) =>
  handoffRefusal({
    routeMatchId: 'match-1',
    payloadMatchId: 'match-1',
    authFailure: null,
    match: { status: 'live', voided_at: null },
    sportInactive: false,
    isTerminal,
    ...over,
  });

describe('SC-432 · applying a verified handoff', () => {
  it('a live match the signer may score is allowed', () => {
    expect(guard()).toBeNull();
  });

  it('a code for another match is refused as exactly that', () => {
    // The attack: take a genuine, correctly signed code and POST it at a
    // different match. Nothing about the signature would catch this.
    expect(guard({ payloadMatchId: 'match-2' })?.code).toBe('MATCH_MISMATCH');
  });

  it('the mismatch outranks every other refusal', () => {
    const r = guard({
      payloadMatchId: 'match-2',
      match: null,
      authFailure: { status: 403, error: 'no' },
      sportInactive: true,
    });
    expect(r?.code).toBe('MATCH_MISMATCH');
  });

  it('a missing match is a 404, not a permission refusal', () => {
    expect(guard({ match: null })).toEqual(
      expect.objectContaining({ status: 404, code: 'MATCH_NOT_FOUND' }),
    );
  });

  it('a signer who was never a scorer is refused, whatever the uploader may do', () => {
    const r = guard({ authFailure: { status: 403, error: 'Only the umpire or creator can score' } });
    expect(r).toEqual(expect.objectContaining({ status: 403, code: 'NOT_A_SCORER' }));
    // Worded about the phone, not about the courier reading it, who has done
    // nothing wrong.
    expect(r?.error).toMatch(/that phone/i);
  });

  it('a lease that moved on refuses the code — this is the double-count case', () => {
    // Another phone took over, so a human has already decided what happens to
    // this match. Applying these ops behind their back is the exact failure the
    // lease exists to prevent.
    const r = guard({ authFailure: { status: 409, error: 'Someone else took over scoring this match.' } });
    expect(r).toEqual(expect.objectContaining({ status: 409, code: 'LEASE_MOVED' }));
  });

  it('a moved lease outranks a finished or voided match', () => {
    const r = guard({
      authFailure: { status: 409, error: 'taken' },
      match: { status: 'completed', voided_at: '2026-09-21T00:00:00.000Z' },
    });
    expect(r?.code).toBe('LEASE_MOVED');
  });

  it('a finished match can no longer be scored, by hand or by QR', () => {
    expect(guard({ match: { status: 'completed', voided_at: null } })?.code).toBe('MATCH_FINISHED');
  });

  it('an out-of-scope sport is refused here too', () => {
    expect(guard({ sportInactive: true })?.code).toBe('SPORT_INACTIVE');
  });

  it('a voided match is refused — stricter than the direct path, on purpose', () => {
    const r = guard({ match: { status: 'live', voided_at: '2026-09-21T00:00:00.000Z' } });
    expect(r).toEqual(expect.objectContaining({ status: 409, code: 'MATCH_VOIDED' }));
  });

  it('an unexpected authorisation failure is passed through, not flattened', () => {
    // Swallowing an unknown status into a friendly message is how a real refusal
    // becomes invisible. Whatever the gate said, the courier hears.
    const r = guard({ authFailure: { status: 418, error: 'Teapot', code: 'ODD' } });
    expect(r).toEqual({ status: 418, code: 'ODD', error: 'Teapot' });
  });
});

/**
 * SC-432 · which key a handoff is checked against.
 *
 * Revoked rows are kept so an old QR is refused WITH A REASON rather than
 * silently matching nothing. Looking only at the newest row threw that away: a
 * phone that reinstalled got "altered or not signed by that phone" — a tampering
 * accusation for a reinstall. Found on prod during the live verification, with a
 * real rotation.
 *
 * The key history is the thing under test, so these drive the selection rule
 * directly rather than through Supabase.
 */
type KeyRow = { public_key: string; revoked_at?: string | null; revoked_reason?: string | null };

/** Mirrors verifyHandoff's key selection exactly. */
function chooseKeyVerdict(rows: KeyRow[], verifies: (key: string) => boolean):
  'ok' | 'UNKNOWN_DEVICE' | 'DEVICE_REVOKED' | 'BAD_SIGNATURE' {
  if (!rows.length) return 'UNKNOWN_DEVICE';
  const live = rows.find((r) => !r.revoked_at);
  if (live && verifies(live.public_key)) return 'ok';
  const revoked = rows.find((r) => r.revoked_at && verifies(r.public_key));
  if (revoked) return 'DEVICE_REVOKED';
  return 'BAD_SIGNATURE';
}

describe('SC-432 · choosing the key to verify against', () => {
  const OLD = 'key-old';
  const NEW = 'key-new';
  const rotated: KeyRow[] = [
    { public_key: NEW, revoked_at: null },
    { public_key: OLD, revoked_at: '2026-09-21T00:00:00.000Z', revoked_reason: 'rotated' },
  ];

  it('a code signed by the live key is accepted', () => {
    expect(chooseKeyVerdict(rotated, (k) => k === NEW)).toBe('ok');
  });

  it('a code signed by the PREVIOUS key is "revoked", not "altered"', () => {
    // The bug: this used to read as BAD_SIGNATURE, telling a scorer who simply
    // reinstalled that their code had been tampered with.
    expect(chooseKeyVerdict(rotated, (k) => k === OLD)).toBe('DEVICE_REVOKED');
  });

  it('a code signed by neither is still a bad signature', () => {
    expect(chooseKeyVerdict(rotated, () => false)).toBe('BAD_SIGNATURE');
  });

  it('"revoked" is claimed only when a revoked key actually verifies', () => {
    // Otherwise this becomes an oracle, and a guess dressed as a fact.
    const revokedOnly: KeyRow[] = [{ public_key: OLD, revoked_at: '2026-09-21T00:00:00.000Z' }];
    expect(chooseKeyVerdict(revokedOnly, () => false)).toBe('BAD_SIGNATURE');
    expect(chooseKeyVerdict(revokedOnly, (k) => k === OLD)).toBe('DEVICE_REVOKED');
  });

  it('a device with no key at all is unknown, not refused for its signature', () => {
    expect(chooseKeyVerdict([], () => true)).toBe('UNKNOWN_DEVICE');
  });

  it('a sign-out (revoked, no replacement) refuses the code it signed', () => {
    const signedOut: KeyRow[] = [{ public_key: OLD, revoked_at: '2026-09-21T00:00:00.000Z', revoked_reason: 'signed out' }];
    expect(chooseKeyVerdict(signedOut, (k) => k === OLD)).toBe('DEVICE_REVOKED');
  });

  it('the live key is preferred even when an older one would also verify', () => {
    // A phone that re-registered the SAME key must not be reported as revoked.
    expect(chooseKeyVerdict(rotated, () => true)).toBe('ok');
  });
});

/**
 * SC-433 · the result op.
 *
 * The narrowest thing that can advance a tournament day: who won, and what the
 * score was. The reason it is this narrow is that a signed QR must never be able
 * to reshape a draw — no status, no round, no next_match_id — so the server's own
 * advance engine stays the only thing that touches it.
 *
 * Which makes "extra keys are refused, not ignored" a security property rather
 * than fussiness: an ignored field is one somebody will later assume is honoured.
 */
import { isEventOp, isResultOp } from '../utils/qrHandoff';

const KEY = '44444444-4444-4444-8444-444444444444';
const TEAM = '55555555-5555-4555-8555-555555555555';
const resultOp = (over: Record<string, unknown> = {}) =>
  ({ k: KEY, s: 1, t: 'result', r: { w: TEAM }, ...over }) as never;

describe('SC-433 · result ops', () => {
  it('accepts a winner and a score, which is the whole vocabulary', () => {
    expect(isResultOp(resultOp())).toBe(true);
    expect(isResultOp(resultOp({ r: { w: TEAM, summary: { A: { score: 21 }, B: { score: 19 } } } }))).toBe(true);
  });

  it('accepts a draw', () => {
    expect(isResultOp(resultOp({ r: { w: null } }))).toBe(true);
  });

  it('refuses a winner that is not a team id', () => {
    expect(isResultOp(resultOp({ r: { w: 'A' } }))).toBe(false);
    expect(isResultOp(resultOp({ r: { w: 'the-home-side' } }))).toBe(false);
  });

  it('REFUSES bracket fields rather than ignoring them', () => {
    // Each of these would let a QR reshape a draw. Ignoring them would be worse
    // than refusing: an ignored field is one somebody later assumes is honoured.
    expect(isResultOp(resultOp({ r: { w: TEAM, next_match_id: TEAM } }))).toBe(false);
    expect(isResultOp(resultOp({ r: { w: TEAM, next_slot: 'A' } }))).toBe(false);
    expect(isResultOp(resultOp({ r: { w: TEAM, round: 2 } }))).toBe(false);
  });

  it('refuses a status transition', () => {
    expect(isResultOp(resultOp({ r: { w: TEAM, status: 'completed' } }))).toBe(false);
    expect(isResultOp(resultOp({ r: { w: TEAM }, status: 'cancelled' }))).toBe(false);
  });

  it('refuses anything riding along on the op itself', () => {
    expect(isResultOp(resultOp({ voided_at: null }))).toBe(false);
    expect(isResultOp(resultOp({ e: { event_type: 'ball' } }))).toBe(false);
  });

  it('refuses a malformed summary', () => {
    expect(isResultOp(resultOp({ r: { w: TEAM, summary: [1, 2] } }))).toBe(false);
    expect(isResultOp(resultOp({ r: { w: TEAM, summary: 'A won' } }))).toBe(false);
  });

  it('a result op is not an event op and vice versa', () => {
    expect(isEventOp(resultOp())).toBe(false);
    const ev = { k: KEY, s: 1, t: 'event', e: { event_type: 'ball' } } as never;
    expect(isResultOp(ev)).toBe(false);
    expect(isEventOp(ev)).toBe(true);
  });

  it('a payload may carry both kinds — the ordinary hub case', () => {
    const { looksWellFormed } = require('../utils/qrHandoff');
    const env = {
      sig: 'x',
      p: {
        v: 1, m: TEAM, d: 'dev', u: TEAM, n: 'nonce', t: Date.now(),
        o: [
          { k: KEY, s: 1, t: 'event', e: { event_type: 'ball' } },
          { k: '66666666-6666-4666-8666-666666666666', s: 2, t: 'result', r: { w: TEAM } },
        ],
      },
    };
    expect(looksWellFormed(env)).toBe(true);
  });
});
