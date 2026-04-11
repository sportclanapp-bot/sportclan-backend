"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const kudos_controller_1 = require("../controllers/kudos.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post('/', auth_middleware_1.authenticateToken, kudos_controller_1.sendKudos);
router.get('/received/:userId', auth_middleware_1.authenticateToken, kudos_controller_1.listReceivedKudos);
router.get('/count/:userId', auth_middleware_1.authenticateToken, kudos_controller_1.getKudosCount);
exports.default = router;
//# sourceMappingURL=kudos.routes.js.map