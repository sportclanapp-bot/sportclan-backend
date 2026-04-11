import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import {
  getPlans, getMySubscription, initiate, verify,
  appleVerify, redeemCoupon, cancel, startTrial,
} from '../controllers/subscriptions.controller';

const router = Router();

router.get('/plans', getPlans);                        // Public — show plans
router.get('/me', authenticateToken, getMySubscription);
router.post('/initiate', authenticateToken, initiate);
router.post('/verify', authenticateToken, verify);
router.post('/apple/verify', authenticateToken, appleVerify);
router.post('/coupon', authenticateToken, redeemCoupon);
router.post('/cancel', authenticateToken, cancel);
router.post('/trial', authenticateToken, startTrial);

export default router;
