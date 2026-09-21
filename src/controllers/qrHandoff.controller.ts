/**
 * SC-432 · signed QR handoff — register a device key, and accept a handoff.
 */
import type { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { deviceIdOf } from '../utils/deviceHeader';
import {
  verifyHandoff, handoffRefusal, isEventOp, isResultOp,
  type HandoffResultOp,
} from '../utils/qrHandoff';
import { checkAndRecordDiscrepancy, recordUnsentPlayForFinalMatch } from '../utils/discrepancy';
import { invokeController } from '../utils/invokeController';
import { completeMatch } from './matches.controller';
import { authorizeScorer, recordEventIdempotent, recomputeSummary } from './scoring.controller';
import { isTerminalMatchStatus } from '../utils/validation';
import { isSportInactive } from '../utils/sports';

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

    // Everything below the signature is decided in one place, so the precedence
    // of refusals is testable rather than a reading of this function top to bottom.
    // A code aimed at a different match is answered without touching the
    // database at all — `handoffRefusal` ranks that first either way, and there is
    // nothing to look up on a match this payload was never about.
    const wrongMatch = p.m !== id;
    const { data: match } = wrongMatch
      ? { data: null }
      : await supabase
        .from('matches')
        .select('id, created_by, umpire_id, tournament_id, sport_id, status, voided_at')
        .eq('id', id!).maybeSingle();
    const auth = match ? await authorizeScorer(id!, p.u, p.d) : null;
    const refusal = handoffRefusal({
      routeMatchId: id!,
      payloadMatchId: p.m,
      authFailure: auth && !auth.ok ? { status: auth.status, error: auth.error, code: auth.code } : null,
      match: match as { status?: string | null; voided_at?: string | null } | null,
      sportInactive: match ? await isSportInactive((match as { sport_id: string }).sport_id) : false,
      isTerminal: isTerminalMatchStatus,
    });
    if (refusal) {
      // SC-433: a finished match refusing a scorer's unsent play is correct — a
      // completed match is immutable — but refusing QUIETLY would leave a
      // recorded result with play behind it and nobody the wiser. Record the
      // argument for the organiser; change nothing.
      if (refusal.code === 'MATCH_FINISHED' && p.o.some(isEventOp)) {
        await recordUnsentPlayForFinalMatch(id!, p.o.filter(isEventOp).length);
        return res.status(refusal.status).json({
          error: 'This match is already final, so these actions were not applied. The organiser has been told there is unsent play for it.',
          code: 'MATCH_FINISHED_WITH_UNSENT_PLAY',
        });
      }
      return res.status(refusal.status).json({ error: refusal.error, code: refusal.code });
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
    // SC-433: a result op is applied AFTER every event op in the same payload,
    // whatever its seq says. Completing a match first would freeze it and the
    // events behind it would be refused — the result is the end of the story by
    // definition, so it goes last.
    const eventOps = ops.filter(isEventOp);
    const resultOps = ops.filter(isResultOp);

    for (const op of eventOps) {
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

    // Recompute BEFORE any result op, so the comparison below is against the
    // play including whatever this very payload just delivered.
    try { await recomputeSummary(id); } catch { /* the events are in; the summary self-heals */ }

    /**
     * SC-433 · the result op.
     *
     * Applied through `completeMatch`'s own engine rather than a second copy of
     * it, so the server's bracket advance, record deltas and champion logic run
     * exactly as they do when an organiser taps the button. The op carries a
     * winner and a score; it carries nothing that could reshape a draw.
     */
    let resultOutcome: ResultOutcome | undefined;
    for (const op of resultOps) {
      resultOutcome = await applyResultOp(id!, p.u, p.d, op);
      if (resultOutcome.status === 'uploaded') applied += 1; else alreadyHad += 1;
      // A disagreement stops the payload here. The rest of this code's promise is
      // that nothing is silently overwritten, and carrying on to write a
      // `qr_handoffs` row would mark the whole thing done.
      if (resultOutcome.status === 'disagrees') break;
    }

    await supabase.from('qr_handoffs').insert({
      nonce: p.n, match_id: id, scorer_id: p.u, device_id: p.d,
      uploaded_by: uploaderId, op_count: ops.length, applied_count: applied,
      issued_at: new Date(p.t).toISOString(),
    });
    await supabase.from('device_signing_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('user_id', p.u).eq('device_id', p.d).is('revoked_at', null);

    if (resultOutcome?.status === 'disagrees') {
      return res.status(409).json({
        status: 'result_disputed',
        code: 'RESULT_DISPUTED',
        error: resultOutcome.message,
        applied,
        already_had: alreadyHad,
        total: ops.length,
        recorded_side: resultOutcome.recordedSide,
        derived_side: resultOutcome.derivedSide,
      });
    }

    return res.json({
      status: 'uploaded',
      applied,
      already_had: alreadyHad,
      total: ops.length,
      ...(resultOutcome?.status === 'already' ? { result: 'already_recorded' } : {}),
      ...(resultOutcome?.status === 'uploaded' ? { result: 'recorded' } : {}),
    });
  } catch (e) {
    console.error('uploadHandoff error:', e instanceof Error ? e.message : e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}


interface ResultOutcome {
  status: 'uploaded' | 'already' | 'disagrees';
  message?: string;
  recordedSide?: string | null;
  derivedSide?: string | null;
}

/**
 * SC-433 · apply one signed result op.
 *
 * Two things make this safe, and both are deliberate.
 *
 * It goes through `completeMatch` itself — see utils/invokeController for why a
 * second copy of that engine was not acceptable — authored as the SCORER, whose
 * authority was already checked against this match. So the bracket advance, the
 * record deltas and the champion logic all run exactly as they do when an
 * organiser taps the button, and the server stays the only thing that touches a
 * draw.
 *
 * And afterwards it asks whether the result agrees with the play. A hub can
 * carry "A won 21-19" while the scorer's own phone is still holding the
 * ball-by-ball; the two can arrive in either order and can disagree. When they
 * do, nothing is overwritten in either direction — the argument is recorded and
 * an organiser decides.
 */
async function applyResultOp(
  matchId: string,
  scorerId: string,
  deviceId: string,
  op: HandoffResultOp,
): Promise<ResultOutcome> {
  const { data: before } = await supabase
    .from('matches').select('status, winner_team_id').eq('id', matchId).maybeSingle();
  const wasTerminal = isTerminalMatchStatus((before as { status?: string } | null)?.status);
  const priorWinner = (before as { winner_team_id?: string | null } | null)?.winner_team_id ?? null;

  // Already final with a DIFFERENT winner: this is the disagreement the brief
  // calls out, and `idempotent: true` would answer 200 and swallow it. Caught
  // here, before the completion runs, so nothing is touched at all.
  if (wasTerminal && priorWinner !== op.r.w) {
    await checkAndRecordDiscrepancy(matchId, 'result_op');
    return {
      status: 'disagrees',
      message: 'This match already has a different result on the server. Nothing was changed — an organiser needs to decide.',
      recordedSide: null,
      derivedSide: null,
    };
  }

  if (!wasTerminal) {
    const done = await invokeController<{ error?: string }>(completeMatch, {
      userId: scorerId,
      params: { id: matchId },
      headers: { 'x-device-id': deviceId },
      body: {
        winner_team_id: op.r.w,
        is_draw: op.r.w === null,
        idempotent: true,
        ...(op.r.summary ? { score_summary: op.r.summary } : {}),
      },
    });
    if (done.status >= 400) {
      return { status: 'disagrees', message: done.body?.error ?? 'The server would not accept this result.' };
    }
  }

  // Now ask the other question: does the play agree with what was just recorded?
  const verdict = await checkAndRecordDiscrepancy(matchId, 'result_op');
  if (verdict.disagrees) {
    return {
      status: 'disagrees',
      message: 'This result does not match the ball-by-ball on the server. Nothing was overwritten — an organiser needs to decide.',
      recordedSide: verdict.recordedSide,
      derivedSide: verdict.derivedSide,
    };
  }
  return { status: wasTerminal ? 'already' : 'uploaded' };
}
