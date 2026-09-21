/**
 * SC-433 · the organiser's phone as an offline tournament hub.
 *
 * Three things the server has to provide. Everything else the hub does — advance
 * the bracket, rank the table, decide who plays next — is a LOCAL VIEW over data
 * it downloaded here, and syncs back through paths that already exist.
 */
import type { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { deviceIdOf } from '../utils/deviceHeader';
import { isTournamentOrganiser } from '../utils/tournamentAuth';
import {
  getHubLease, claimHubLease, heartbeatHubLease, releaseHubLease, takeOverHubLease,
  isStale, STALE_AFTER_MS,
} from '../utils/hubLease';

const withStale = <T extends { heartbeat_at: string }>(lease: T | null) =>
  lease ? { ...lease, stale: isStale(lease), stale_after_ms: STALE_AFTER_MS } : null;

async function mustOrganise(tournamentId: string, userId: string, res: Response): Promise<boolean> {
  if (await isTournamentOrganiser(tournamentId, userId)) return true;
  res.status(403).json({ error: 'Only a tournament organiser can do this.', code: 'NOT_AN_ORGANISER' });
  return false;
}

/**
 * GET /tournaments/:id/offline-pack — everything the hub needs for a day with no
 * signal, in ONE response.
 *
 * One call rather than four, for two reasons that both come from where it is
 * used. It is downloaded in a car park on a bad connection, where four round
 * trips are four chances to half-fail; and it is a SNAPSHOT — fixtures and
 * entries that disagree with each other would give the hub a bracket it cannot
 * advance.
 *
 * `next_match_id` / `next_slot` are the fields that make a local advance possible
 * at all: they say where each winner goes, so the hub can show the next round
 * without inventing a bracket algorithm the server would then disagree with.
 *
 * Signing keys travel so the hub can verify a scanned result AT THE VENUE rather
 * than collecting junk all day. Public keys are not secrets.
 */
export async function getOfflinePack(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    if (!(await mustOrganise(id!, userId, res))) return;

    const { data: tournament } = await supabase
      .from('tournaments')
      .select('id, name, format, status, sport_id, tiebreaker_rules, fixtures_generated, champion_team_id, start_date, end_date, venue, created_by, updated_at')
      .eq('id', id).maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    const [{ data: entries }, { data: fixtures }, { data: organisers }] = await Promise.all([
      supabase.from('tournament_entries')
        .select('id, team_id, team:teams(id, name, logo_url)')
        .eq('tournament_id', id),
      supabase.from('matches')
        .select('id, team_a_id, team_b_id, team_a_name, team_b_name, status, winner_team_id, score_summary, round, match_no, group_label, scheduled_at, venue, ground_label, voided_at, next_match_id, next_slot, overs, umpire_id, updated_at')
        .eq('tournament_id', id)
        .order('round', { ascending: true })
        .order('match_no', { ascending: true }),
      supabase.from('tournament_organisers').select('user_id').eq('tournament_id', id),
    ]);

    // Who might sign a result today: the organisers, plus every fixture's umpire.
    // Narrow on purpose — this is not a directory dump, it is the set of phones
    // whose codes this hub should be able to verify.
    const signerIds = new Set<string>([
      (tournament as { created_by?: string }).created_by ?? '',
      ...((organisers ?? []) as { user_id: string }[]).map((o) => o.user_id),
      ...((fixtures ?? []) as { umpire_id?: string | null }[]).map((f) => f.umpire_id ?? ''),
    ].filter(Boolean));

    const { data: keys } = signerIds.size
      ? await supabase.from('device_signing_keys')
        .select('user_id, device_id, public_key')
        .in('user_id', [...signerIds])
        .is('revoked_at', null)
      : { data: [] as unknown[] };

    return res.json({
      pack_version: 1,
      packed_at: new Date().toISOString(),
      tournament,
      entries: entries ?? [],
      fixtures: fixtures ?? [],
      signing_keys: keys ?? [],
      lease: withStale(await getHubLease(id!)),
    });
  } catch (e) {
    console.error('getOfflinePack error:', e instanceof Error ? e.message : e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Hub lease ───────────────────────────────────────────────────────────────

export async function claimHub(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const deviceId = deviceIdOf(req);
    if (!deviceId) return res.status(400).json({ error: 'A device id is required to run a hub.' });
    if (!(await mustOrganise(id!, userId, res))) return;

    const result = await claimHubLease(id!, userId, deviceId);
    if (!result.taken) {
      const held = result.heldBy!;
      const { data: holder } = await supabase
        .from('users').select('id, name, username').eq('id', held.user_id).maybeSingle();
      return res.status(409).json({
        error: 'Another phone is already running this tournament.',
        code: 'HUB_HELD',
        lease: { ...withStale(held), holder },
      });
    }
    return res.json({ lease: withStale(result.lease) });
  } catch (e) {
    console.error('claimHub error:', e instanceof Error ? e.message : e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function heartbeatHub(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const deviceId = deviceIdOf(req);
    if (!deviceId) return res.status(400).json({ error: 'A device id is required.' });
    const beat = await heartbeatHubLease(id!, userId, deviceId);
    if (!beat.ok) {
      // Not ours any more. Say so rather than quietly reinstating it — the hub
      // has results on it and its holder needs to know before they collect more.
      const held = await getHubLease(id!);
      return res.status(409).json({ error: 'Another phone is running this tournament now.', code: 'HUB_LOST', lease: withStale(held) });
    }
    return res.json({ lease: withStale(beat.lease) });
  } catch (e) {
    console.error('heartbeatHub error:', e instanceof Error ? e.message : e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function releaseHub(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const deviceId = deviceIdOf(req);
    if (!deviceId) return res.status(400).json({ error: 'A device id is required.' });
    const released = await releaseHubLease(id!, userId, deviceId);
    return res.json({ released });
  } catch (e) {
    console.error('releaseHub error:', e instanceof Error ? e.message : e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function takeOverHub(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const deviceId = deviceIdOf(req);
    if (!deviceId) return res.status(400).json({ error: 'A device id is required.' });
    if (!(await mustOrganise(id!, userId, res))) return;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'A reason is required to take over a hub.' });

    const result = await takeOverHubLease(id!, userId, deviceId, reason, { force: !!req.body?.force });
    if (!result.ok) {
      return res.status(409).json({
        error: 'That phone is still running this tournament. Ask them to hand over from their own phone.',
        code: 'HUB_ACTIVE',
        lease: withStale(result.lease),
      });
    }
    return res.json({ lease: withStale(result.lease) });
  } catch (e) {
    console.error('takeOverHub error:', e instanceof Error ? e.message : e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Result disagreements ────────────────────────────────────────────────────

/**
 * GET /tournaments/:id/discrepancies — fixtures whose recorded result and whose
 * play do not agree.
 *
 * The server never picks a side; this is the list of arguments waiting for a
 * human. Open ones only by default, because a resolved argument is history.
 */
export async function listDiscrepancies(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    if (!(await mustOrganise(id!, userId, res))) return;
    const { data } = await supabase
      .from('result_discrepancies')
      .select('*, match:matches(id, team_a_name, team_b_name, round, match_no, status, winner_team_id)')
      .eq('tournament_id', id)
      .is('resolved_at', null)
      .order('detected_at', { ascending: false });
    return res.json({ discrepancies: data ?? [] });
  } catch (e) {
    console.error('listDiscrepancies error:', e instanceof Error ? e.message : e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /tournaments/:id/discrepancies/:discrepancyId/resolve
 *
 * Records WHICH answer the organiser chose and that they chose it. Keeping the
 * recorded result is a decision too, and one somebody may have to account for
 * later, so it is written down exactly like the other one.
 *
 * This endpoint does not change the match. Correcting a result is the fixture
 * editor's job and already has its own guards, notifications and audit — routing
 * it through here would be a second way to do the same thing.
 */
export async function resolveDiscrepancy(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id, discrepancyId } = req.params;
    if (!(await mustOrganise(id!, userId, res))) return;
    const resolution = req.body?.resolution;
    if (resolution !== 'kept_recorded' && resolution !== 'took_derived') {
      return res.status(400).json({ error: "resolution must be 'kept_recorded' or 'took_derived'." });
    }
    const { data } = await supabase
      .from('result_discrepancies')
      .update({ resolved_at: new Date().toISOString(), resolved_by: userId, resolution })
      .eq('id', discrepancyId).eq('tournament_id', id).is('resolved_at', null)
      .select('*').maybeSingle();
    if (!data) return res.status(404).json({ error: 'No open discrepancy with that id.' });
    return res.json({ discrepancy: data });
  } catch (e) {
    console.error('resolveDiscrepancy error:', e instanceof Error ? e.message : e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
