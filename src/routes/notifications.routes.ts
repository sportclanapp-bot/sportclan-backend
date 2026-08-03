import { Router } from 'express';
import { guardIdParams } from '../middleware/uuidParams.middleware';
import {
  savePushToken,
  listNotifications,
  markRead,
  markAllRead,
  deleteNotification,
  weeklyDigest,
} from '../controllers/notifications.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
// SC-397: 400 on a malformed id instead of letting it reach Postgres and 500.
guardIdParams(router);

router.post('/token', authenticateToken, savePushToken);
router.get('/', authenticateToken, listNotifications);
router.get('/digest', authenticateToken, weeklyDigest);
router.patch('/read-all', authenticateToken, markAllRead);
router.patch('/:id/read', authenticateToken, markRead);
router.delete('/:id', authenticateToken, deleteNotification);

export default router;
