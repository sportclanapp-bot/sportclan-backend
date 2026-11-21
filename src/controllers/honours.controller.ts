/** Q51 (Dipak, 21 Nov 2026): the "Honours" line on a team's page and a player's profile (utils/honours). */
import type { Request, Response } from 'express';
import { honoursOfTeams, honoursOfUser } from '../utils/honours';
import { targetUserHidden } from '../utils/blocks';
import { supabase } from '../utils/supabase';
import { captureError } from '../utils/sentry';

// GET /teams/:id/honours — a closed or disbanded team keeps its history, so its honours too.
export async function getTeamHonours(req: Request, res: Response) {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    const { data: team } = await supabase.from('teams').select('id').eq('id', id).maybeSingle();
    if (!team) return res.status(404).json({ error: 'Team not found' });
    return res.json({ honours: await honoursOfTeams([id]) });
  } catch (err) {
    captureError(err as Error, { where: 'getTeamHonours' });
    return res.status(500).json({ error: 'Could not load the honours.' });
  }
}

// GET /users/:id/honours — hidden like the profile when deleted or blocked either way.
export async function getUserHonours(req: Request, res: Response) {
  const viewer = req.userId;
  if (!viewer) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (await targetUserHidden(id, viewer)) return res.status(404).json({ error: 'User not found' });
    return res.json({ honours: await honoursOfUser(id) });
  } catch (err) {
    captureError(err as Error, { where: 'getUserHonours' });
    return res.status(500).json({ error: 'Could not load the honours.' });
  }
}
