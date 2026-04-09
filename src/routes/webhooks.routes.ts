import { Router } from 'express';
import { razorpayWebhook } from '../controllers/webhooks.controller';

const router = Router();

// No auth — Razorpay calls this endpoint with HMAC signature
router.post('/razorpay', razorpayWebhook);

export default router;
