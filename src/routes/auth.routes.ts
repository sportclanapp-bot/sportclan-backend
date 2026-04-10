import { Router } from 'express';
import {
  sendOtp,
  verifyOtp,
  register,
  registerEmail,
  login,
  otpLogin,
  refresh,
  logout,
  googleAuth,
  resetPassword,
  changePhone,
  checkUsername,
  validateCoupon,
} from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/register', register);
router.post('/register-email', registerEmail);
router.post('/login', login);
router.post('/otp/login', otpLogin);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.post('/google', googleAuth);
router.post('/reset-password', resetPassword);
router.post('/change-phone', authenticateToken, changePhone);

// Helpers used during registration
router.get('/username/check', checkUsername);
router.get('/coupon/validate', validateCoupon);

export default router;
