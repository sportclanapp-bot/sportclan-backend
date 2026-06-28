import { Router } from 'express';
import {
  getStats,
  getReports,
  resolveReport,
  broadcastAnnouncement,
  adminListUsers,
  adminUpdateUser,
} from '../controllers/admin.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin.middleware';

const router = Router();

// All admin routes require authentication AND admin gating
router.use(authenticateToken);
router.use(requireAdmin);

router.get('/stats', getStats);
router.get('/reports', getReports);
router.patch('/reports/:id', resolveReport);
router.post('/broadcast', broadcastAnnouncement);
router.get('/users', adminListUsers);
router.patch('/users/:id', adminUpdateUser);

export default router;
