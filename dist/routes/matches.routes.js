"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const matches_controller_1 = require("../controllers/matches.controller");
const features_controller_1 = require("../controllers/features.controller");
const matchFeatures_controller_1 = require("../controllers/matchFeatures.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post('/', auth_middleware_1.authenticateToken, matches_controller_1.createMatch);
router.get('/', auth_middleware_1.authenticateToken, matches_controller_1.listMatches);
// /open and /nearby must come before /:id so they aren't captured as a match id.
router.get('/open', auth_middleware_1.authenticateToken, matches_controller_1.listOpenMatches);
router.get('/nearby', auth_middleware_1.authenticateToken, features_controller_1.getNearbyMatches);
router.get('/:id/commentary', auth_middleware_1.authenticateToken, matches_controller_1.getCommentary);
router.get('/:id', auth_middleware_1.authenticateToken, matches_controller_1.getMatch);
router.patch('/:id', auth_middleware_1.authenticateToken, matches_controller_1.updateMatch);
router.delete('/:id', auth_middleware_1.authenticateToken, matches_controller_1.cancelMatch);
router.post('/:id/cancel', auth_middleware_1.authenticateToken, matches_controller_1.cancelMatch); // alias for frontend compatibility
router.post('/:id/participants', auth_middleware_1.authenticateToken, matches_controller_1.addParticipants);
router.post('/:id/umpire/self-assign', auth_middleware_1.authenticateToken, matches_controller_1.selfAssignUmpire);
router.post('/:id/complete', auth_middleware_1.authenticateToken, matches_controller_1.completeMatch);
router.post('/:id/join', auth_middleware_1.authenticateToken, matches_controller_1.joinOpenMatch);
router.post('/:id/rate', auth_middleware_1.authenticateToken, matches_controller_1.rateMatchHandler);
router.patch('/:id/toss', auth_middleware_1.authenticateToken, matches_controller_1.setMatchTossHandler);
router.get('/:id/mvp', auth_middleware_1.authenticateToken, matchFeatures_controller_1.getMatchMVP);
router.get('/:id/availability', auth_middleware_1.authenticateToken, matchFeatures_controller_1.getMatchAvailability);
router.patch('/:id/availability', auth_middleware_1.authenticateToken, matchFeatures_controller_1.setMatchAvailability);
router.post('/:id/dls', auth_middleware_1.authenticateToken, matchFeatures_controller_1.applyDLS);
router.post('/:id/edit-event', auth_middleware_1.authenticateToken, matchFeatures_controller_1.editMatchEvent);
router.delete('/:id/events/:eventId', auth_middleware_1.authenticateToken, matchFeatures_controller_1.deleteMatchEvent);
router.post('/:id/innings-stats', auth_middleware_1.authenticateToken, matchFeatures_controller_1.upsertInningsStats);
exports.default = router;
//# sourceMappingURL=matches.routes.js.map