import { Router } from 'express';
import {
  savePushToken,
  listNotifications,
  markRead,
  markAllRead,
} from '../controllers/notifications.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/token', authenticateToken, savePushToken);
router.get('/', authenticateToken, listNotifications);
router.patch('/read-all', authenticateToken, markAllRead);
router.patch('/:id/read', authenticateToken, markRead);

export default router;
