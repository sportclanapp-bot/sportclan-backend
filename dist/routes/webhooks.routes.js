"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const webhooks_controller_1 = require("../controllers/webhooks.controller");
const router = (0, express_1.Router)();
// No auth — Razorpay calls this endpoint with HMAC signature
router.post('/razorpay', webhooks_controller_1.razorpayWebhook);
exports.default = router;
//# sourceMappingURL=webhooks.routes.js.map