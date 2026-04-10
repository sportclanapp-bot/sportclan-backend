"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const subscriptions_controller_1 = require("../controllers/subscriptions.controller");
const router = (0, express_1.Router)();
router.get('/plans', subscriptions_controller_1.getPlans); // Public — show plans
router.get('/me', auth_middleware_1.authenticateToken, subscriptions_controller_1.getMySubscription);
router.post('/initiate', auth_middleware_1.authenticateToken, subscriptions_controller_1.initiate);
router.post('/verify', auth_middleware_1.authenticateToken, subscriptions_controller_1.verify);
router.post('/apple/verify', auth_middleware_1.authenticateToken, subscriptions_controller_1.appleVerify);
router.post('/coupon', auth_middleware_1.authenticateToken, subscriptions_controller_1.redeemCoupon);
router.post('/cancel', auth_middleware_1.authenticateToken, subscriptions_controller_1.cancel);
exports.default = router;
//# sourceMappingURL=subscriptions.routes.js.map