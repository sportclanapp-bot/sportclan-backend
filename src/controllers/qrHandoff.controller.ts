/**
 * SC-432 · signed QR handoff — register a device key, and accept a handoff.
 */
import type { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { deviceIdOf } from '../utils/deviceHeader';
import { canOfficiateMatch } from '../utils/tournamentAuth';
import { checkLease } from '../utils/scoringLease';
import { verifyHandoff } from '../utils/qrHandoff';
import { recordEventIdempotent, recomputeSummary } from './scoring.controller';

/**
 * POST /devices/signing-key — register (or rotate) this phone's public key.
 *
 * Called while the phone HAS signal, so that later, when it does not, its
 * signatures can still be checked. Rotation revokes the previous live key rather
 * than overwriting it, so an old QR is rejected with a reason instead of silently
 * matching nothing.
 */
export async function registerSigningKey(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const deviceId = deviceIdOf(req);
    if (!deviceId) return res.status(400).json({ error: 'A device id is required.' });
    const publicKey = typeof req.body?.public_key === 'string' ? req.body.public_key.trim() : '';
    // 32 raw bytes, base64url — 43 chars unpadded. Reject anything else rather
    // than storing a key that can never verify.
    if (!publicKey || Buffer.from(publicKey, 'base64url').length !== 32) {
      return res.status(400).json({ error: 'public_key must be a 32-byte Ed25519 key, base64url.' });
    }

    const { data: existing } = await supabase
      .from('device_signing_keys')
      .select('id, public_key')
      .eq('user_id', userId).eq('device_id', deviceId).is('revoked_at', null)
      .maybeSingle();

    if (existing && (existing as { public_key: string }).public_key === publicKey) {
      // Same key, already registered. Idempotent: re-registering on every launch
      // must not churn rows.
      return res.json({ registered: true, rotated: false });
    }
    if (existing) {
      await supabase.from('device_signing_keys')
        .update({ revoked_at: new Date().toISOString(), revoked_reason: 'rotated' })
        .eq('id', (existing as { id: string }).id);
    }
    const { error } = await supabase.from('device_signing_keys')
      .insert({ user_id: userId, device_id: deviceId, public_key: publicKey });
    if (error) return res.status(500).json({ error: 'Could not register the key.' });
    return res.json({ registered: true, rotated: !!existing });
  } catch (e) {
    console.error('registerSigningKey error:', e instanceof Error ? e.message : e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /matches/:id/handoff — apply a scorer's queued ops, carried by someone else.
 *
 * The caller is a COURIER. They need to be signed in (so an upload is attributable)
 * but they gain no scoring rights whatsoever: authority comes entirely from the
 * signed payload, and every event is authored as the SCORER.
 */
export async function uploadHandoff(req: Request, res: Response) {
  const uploaderId = req.userId;
  if (!uploaderId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const verdict = await verifyHandoff(req.body?.envelope);
    if (!verdict.ok || !verdict.payload) {
      return res.status(400).json({ error: verdict.detail ?? 'This code could not be verified.', code: verdict.reason });
    }
    const p = verdict.payload;

    // The QR must be for the match it is being uploaded against — otherwise a
    // valid code for match A could be replayed onto match B.
    if (p.m !== id) {
      return res.status(400).json({ error: 'This code is for a different match.', code: 'MATCH_MISMATCH' });
    }

    const { data: match } = await supabase
      .from('matches')
      .select('id, created_by, umpire_id, tournament_id, status, voided_at')
      .eq('id', id).maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found', code: 'MATCH_NOT_FOUND' });

    // The SIGNER must have been entitled to score it. The uploader's own rights
    // are irrelevant — they are carrying, not scoring.
    if (!(await canOfficiateMatch(match, p.u))) {
      return res.status(403).json({ error: 'That phone is not a scorer for this match.', code: 'NOT_A_SCORER' });
    }
    // And the lease must not have moved on. If another phone took over, these ops
    // are exactly the ones a human already decided the fate of; silently applying
    // them behind their back is the double-count this whole area exists to stop.
    const lease = await checkLease(id, p.u, p.d);
    if (!lease.ok) {
      return res.status(409).json({
        error: 'Someone else took over scoring this match, so this code can no longer be applied.',
        code: 'LEASE_MOVED',
      });
    }

    // Replay ledger: the ops themselves are idempotent, so a replay is already a
    // safe no-op. This makes it an HONEST one — the second scanner is told.
    const { data: seen } = await supabase
      .from('qr_handoffs').select('nonce, uploaded_by, applied_count, created_at')
      .eq('nonce', p.n).maybeSingle();
    if (seen) {
      return res.json({
        status: 'already_uploaded',
        applied: 0,
        already_had: (seen as { applied_count: number }).applied_count,
        uploaded_at: (seen as { created_at: string }).created_at,
      });
    }

    // Apply in the scorer's own seq order, through the SAME idempotent path the
    // outbox uses, authored as the scorer so their phone's later re-send dedupes
    // instead of double-counting.
    const ops = [...p.o].sort((a, b) => a.s - b.s);
    let applied = 0;
    let alreadyHad = 0;
    for (const op of ops) {
      const rec = await recordEventIdempotent({
        matchId: id,
        createdBy: p.u,
        eventType: op.e.event_type,
        period: op.e.period ?? null,
        clockSeconds: op.e.clock_seconds ?? null,
        payload: op.e.payload ?? {},
        clientKey: op.k,
      });
      if (rec.error) {
        return res.status(500).json({ error: 'Could not apply every action; nothing was skipped.', applied });
      }
      if (rec.wasNew) applied += 1; else alreadyHad += 1;
    }

    try { await recomputeSummary(id); } catch { /* the events are in; the summary self-heals */ }

    await supabase.from('qr_handoffs').insert({
      nonce: p.n, match_id: id, scorer_id: p.u, device_id: p.d,
      uploaded_by: uploaderId, op_count: ops.length, applied_count: applied,
      issued_at: new Date(p.t).toISOString(),
    });
    await supabase.from('device_signing_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('user_id', p.u).eq('device_id', p.d).is('revoked_at', null);

    return res.json({ status: 'uploaded', applied, already_had: alreadyHad, total: ops.length });
  } catch (e) {
    console.error('uploadHandoff error:', e instanceof Error ? e.message : e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
