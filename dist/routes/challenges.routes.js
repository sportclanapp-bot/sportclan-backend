"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const challenges_controller_1 = require("../controllers/challenges.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.get('/', auth_middleware_1.authenticateToken, challenges_controller_1.listChallenges);
exports.default = router;
//# sourceMappingURL=challenges.routes.js.map