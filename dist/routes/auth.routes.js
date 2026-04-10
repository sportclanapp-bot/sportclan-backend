"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("../controllers/auth.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post('/send-otp', auth_controller_1.sendOtp);
router.post('/verify-otp', auth_controller_1.verifyOtp);
router.post('/register', auth_controller_1.register);
router.post('/login', auth_controller_1.login);
router.post('/otp/login', auth_controller_1.otpLogin);
router.post('/refresh', auth_controller_1.refresh);
router.post('/logout', auth_controller_1.logout);
router.post('/google', auth_controller_1.googleAuth);
router.post('/reset-password', auth_controller_1.resetPassword);
router.post('/change-phone', auth_middleware_1.authenticateToken, auth_controller_1.changePhone);
// Helpers used during registration
router.get('/username/check', auth_controller_1.checkUsername);
router.get('/coupon/validate', auth_controller_1.validateCoupon);
exports.default = router;
//# sourceMappingURL=auth.routes.js.map