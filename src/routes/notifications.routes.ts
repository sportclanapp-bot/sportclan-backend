import { Router } from 'express';
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

router.post('/token', authenticateToken, savePushToken);
router.get('/', authenticateToken, listNotifications);
router.get('/digest', authenticateToken, weeklyDigest);
router.patch('/read-all', authenticateToken, markAllRead);
router.patch('/:id/read', authenticateToken, markRead);
router.delete('/:id', authenticateToken, deleteNotification);

export default router;
