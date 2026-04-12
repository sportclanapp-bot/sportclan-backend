import { Router } from 'express';
import { loadFullData } from '../controllers/dev.controller';
import {
  triggerSmartMatchNotifications,
  triggerReEngagement,
  triggerWeeklyDigest,
} from '../controllers/features.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// POST /dev/load-full-data — comprehensive test-data seeder.
// Remove before the production Store build.
router.post('/load-full-data', authenticateToken, loadFullData);

// Trigger scheduled jobs manually for testing
router.get('/trigger-smart-match-notifications', authenticateToken, triggerSmartMatchNotifications);
router.get('/trigger-reengagement', authenticateToken, triggerReEngagement);
router.get('/trigger-weekly-digest', authenticateToken, triggerWeeklyDigest);

export default router;
