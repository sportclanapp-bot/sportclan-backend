"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const referrals_controller_1 = require("../controllers/referrals.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post('/apply', auth_middleware_1.authenticateToken, referrals_controller_1.applyReferral);
router.get('/stats', auth_middleware_1.authenticateToken, referrals_controller_1.getStats);
exports.default = router;
//# sourceMappingURL=referrals.routes.js.map