import { Router } from 'express';
import {
  sendOtp,
  verifyOtp,
  register,
  login,
  refresh,
  logout,
  googleAuth,
  resetPassword,
  changePhone,
} from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.post('/google', googleAuth);
router.post('/reset-password', resetPassword);
router.post('/change-phone', authenticateToken, changePhone);

export default router;
