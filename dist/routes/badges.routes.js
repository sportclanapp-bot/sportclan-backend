"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const badges_controller_1 = require("../controllers/badges.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.get('/users/:id/badges', badges_controller_1.getUserBadges);
router.post('/evaluate/:userId', auth_middleware_1.authenticateToken, badges_controller_1.evaluateBadges);
exports.default = router;
//# sourceMappingURL=badges.routes.js.map