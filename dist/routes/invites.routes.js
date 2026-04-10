"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const invites_controller_1 = require("../controllers/invites.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post('/', auth_middleware_1.authenticateToken, invites_controller_1.createInvite);
router.get('/', auth_middleware_1.authenticateToken, invites_controller_1.listInvites);
router.patch('/:id', auth_middleware_1.authenticateToken, invites_controller_1.respondToInvite);
exports.default = router;
//# sourceMappingURL=invites.routes.js.map