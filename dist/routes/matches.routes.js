"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const matches_controller_1 = require("../controllers/matches.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post('/', auth_middleware_1.authenticateToken, matches_controller_1.createMatch);
router.get('/', auth_middleware_1.authenticateToken, matches_controller_1.listMatches);
router.get('/:id', auth_middleware_1.authenticateToken, matches_controller_1.getMatch);
router.patch('/:id', auth_middleware_1.authenticateToken, matches_controller_1.updateMatch);
router.delete('/:id', auth_middleware_1.authenticateToken, matches_controller_1.cancelMatch);
router.post('/:id/participants', auth_middleware_1.authenticateToken, matches_controller_1.addParticipants);
router.post('/:id/umpire/self-assign', auth_middleware_1.authenticateToken, matches_controller_1.selfAssignUmpire);
exports.default = router;
//# sourceMappingURL=matches.routes.js.map