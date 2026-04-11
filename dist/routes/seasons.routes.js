"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const seasons_controller_1 = require("../controllers/seasons.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.get('/current', auth_middleware_1.authenticateToken, seasons_controller_1.getCurrentSeason);
// POST /seasons/end is protected via the X-Admin-Key header check inside
// the controller itself — no auth middleware needed.
router.post('/end', seasons_controller_1.endSeason);
exports.default = router;
//# sourceMappingURL=seasons.routes.js.map