"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const teams_controller_1 = require("../controllers/teams.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post('/', auth_middleware_1.authenticateToken, teams_controller_1.createTeam);
router.get('/', auth_middleware_1.authenticateToken, teams_controller_1.listTeams);
router.get('/:id', auth_middleware_1.authenticateToken, teams_controller_1.getTeam);
router.post('/:id/members', auth_middleware_1.authenticateToken, teams_controller_1.addTeamMember);
router.delete('/:id/members/:userId', auth_middleware_1.authenticateToken, teams_controller_1.removeTeamMember);
router.patch('/:id', auth_middleware_1.authenticateToken, teams_controller_1.updateTeam);
exports.default = router;
//# sourceMappingURL=teams.routes.js.map