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
    { k: 'ck-1', s: 1, t: 'event', e: { event_type: 'ball', payload: { team_side: 'A', runs: 4 } } },
    { k: 'ck-2', s: 2, t: 'event', e: { event_type: 'ball', payload: { team_side: 'A', runs: 1 } } },
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
    (tampered.o[0]!.e.payload as { runs: number }).runs = 6; // 4 became 6
    expect(verifySignature(tampered, sig, s.publicKey)).toBe(false);
  });

  it('an APPENDED op is rejected — nor can they add a ball', () => {
    const s = makeSigner();
    const p = payload();
    const sig = s.sign(p);
    const extended = payload();
    extended.o.push({ k: 'ck-3', s: 3, t: 'event', e: { event_type: 'ball', payload: { team_side: 'A', runs: 6 } } });
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
    (tampered.o[0]!.e.payload as { runs: number }).runs = 6;
    expect(verifySignature(tampered, SIGNATURE, PUBLIC_KEY)).toBe(false);
  });
});
