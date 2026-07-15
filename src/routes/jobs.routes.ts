import { Router } from 'express';
import { requireCronSecret } from '../middleware/cron.middleware';
import {
  runPublishScheduledPosts,
  runSmartMatchNotifications,
  runMatchReminderSweep,
  runReEngagement,
  runWeeklyDigest,
} from '../controllers/features.controller';

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

export default router;
