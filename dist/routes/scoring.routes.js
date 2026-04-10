"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const scoring_controller_1 = require("../controllers/scoring.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post('/:matchId/event', auth_middleware_1.authenticateToken, scoring_controller_1.createEvent);
router.get('/:matchId/events', auth_middleware_1.authenticateToken, scoring_controller_1.listEvents);
router.post('/:matchId/undo', auth_middleware_1.authenticateToken, scoring_controller_1.undoEvent);
exports.default = router;
//# sourceMappingURL=scoring.routes.js.map