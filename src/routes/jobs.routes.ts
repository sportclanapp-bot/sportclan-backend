import { Router } from 'express';
import { requireCronSecret } from '../middleware/cron.middleware';
import {
  runPublishScheduledPosts,
  runSmartMatchNotifications,
  runMatchReminderSweep,
  runReEngagement,
  runWeeklyDigest,
} from '../controllers/features.controller';
import { sweepExpiredInvites } from '../controllers/invites.controller';
import {
  sweepStaleLiveMatches,
  sweepUnplayedScheduledMatches,
} from '../controllers/matches.controller';

// Scheduled-job trigger endpoints. Gated by CRON_SECRET (X-Cron-Secret header),
// NOT a user JWT — these survive the pre-launch deletion of dev.routes and can
// be driven by an external scheduler (Render Cron) as well as the in-process
// scheduler in index.ts. The core run* fns are idempotent / deduped, so firing
// them more than once is safe.
const router = Router();

router.use(requireCronSecret);

router.post('/publish-scheduled-posts', async (_req, res) => {
  try {
    return res.json(await runPublishScheduledPosts());
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/smart-match', async (_req, res) => {
  try {
    return res.json(await runSmartMatchNotifications());
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Fire the 15-min pre-match reminder sweep on demand (also runs on a 5-min
// in-process interval). Idempotent via notification_sends.
router.post('/match-reminders', async (_req, res) => {
  try {
    return res.json(await runMatchReminderSweep());
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reengagement', async (_req, res) => {
  try {
    return res.json(await runReEngagement());
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/weekly-digest', async (_req, res) => {
  try {
    return res.json(await runWeeklyDigest());
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// SC-332: flip stale (>48h) pending play-invites to 'expired'. Hygiene only —
// correctness is already enforced by created_at freshness on every read/write, so
// this endpoint being unfired pre-launch (no CRON_SECRET) changes no behaviour.
router.post('/expire-invites', async (_req, res) => {
  try {
    return res.json(await sweepExpiredInvites());
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// SC-441 (M3): fire the two match sweepers on demand. Both also run hourly in
// process (see index.ts). Idempotent and bulk, so firing them by hand — or from
// an external scheduler alongside the in-process one — is safe.
router.post('/sweep-matches', async (_req, res) => {
  const live = await sweepStaleLiveMatches();
  const unplayed = await sweepUnplayedScheduledMatches();
  res.json({ staleLiveAbandoned: live.abandoned, unplayedAbandoned: unplayed.abandoned });
});

export default router;
