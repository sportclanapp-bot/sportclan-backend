import { Router } from 'express';
import {
  sendOtp,
  verifyOtp,
  register,
  login,
  otpLogin,
  refresh,
  logout,
  resetPassword,
  changePhone,
  checkUsername,
} from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/register', register);
router.post('/login', login);
router.post('/otp/login', otpLogin);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.post('/reset-password', resetPassword);
router.post('/change-phone', authenticateToken, changePhone);

// Helpers used during registration
router.get('/username/check', checkUsername);
// SC-434: 'GET /coupon/validate' was here. Coupons are gone with the rest of the
// paid machinery; coupon_codes stays on prod, read-only.

export default router;
