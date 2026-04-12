"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const leaderboard_controller_1 = require("../controllers/leaderboard.controller");
const features_controller_1 = require("../controllers/features.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.get('/', auth_middleware_1.authenticateToken, leaderboard_controller_1.getLeaderboard);
router.get('/player-of-week', auth_middleware_1.authenticateToken, features_controller_1.getPlayerOfWeek);
exports.default = router;
//# sourceMappingURL=leaderboard.routes.js.map