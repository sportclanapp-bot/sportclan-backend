import { Router } from 'express';
import { loadFullData } from '../controllers/dev.controller';
import {
  triggerSmartMatchNotifications,
  triggerReEngagement,
  triggerWeeklyDigest,
  publishScheduledPosts,
} from '../controllers/features.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin.middleware';

const router = Router();

// SC-105: /dev/* exposes mass-seeding (loadFullData) + scheduled-job triggers.
// Gate the whole router behind auth + admin so ordinary authed users can't call it.
router.use(authenticateToken, requireAdmin);

// POST /dev/load-full-data — comprehensive test-data seeder.
// Remove before the production Store build.
router.post('/load-full-data', authenticateToken, loadFullData);

// Trigger scheduled jobs manually for testing
router.get('/trigger-smart-match-notifications', authenticateToken, triggerSmartMatchNotifications);
router.get('/trigger-reengagement', authenticateToken, triggerReEngagement);
router.get('/trigger-weekly-digest', authenticateToken, triggerWeeklyDigest);
router.get('/publish-scheduled-posts', authenticateToken, publishScheduledPosts);

export default router;
