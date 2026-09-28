import { Router } from 'express';
import { guardIdParams } from '../middleware/uuidParams.middleware';
import {
  getStats,
  otpDiagnostics,
  getReports,
  resolveReport,
  broadcastAnnouncement,
  adminListUsers,
  adminUpdateUser,
  adminListFeedback,
  adminUpdateFeedback,
} from '../controllers/admin.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin.middleware';

const router = Router();
// SC-397: 400 on a malformed id instead of letting it reach Postgres and 500.
guardIdParams(router);

// All admin routes require authentication AND admin gating
router.use(authenticateToken);
router.use(requireAdmin);

router.get('/stats', getStats);
router.get('/otp-diagnostics', otpDiagnostics);
router.get('/reports', getReports);
router.patch('/reports/:id', resolveReport);
router.post('/broadcast', broadcastAnnouncement);
router.get('/users', adminListUsers);
router.patch('/users/:id', adminUpdateUser);
// Decision 10: Admin › Feedback.
router.get('/feedback', adminListFeedback);
router.patch('/feedback/:id', adminUpdateFeedback);

export default router;
