"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const availability_controller_1 = require("../controllers/availability.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.get('/', auth_middleware_1.authenticateToken, availability_controller_1.getAvailability);
router.put('/', auth_middleware_1.authenticateToken, availability_controller_1.updateAvailability);
exports.default = router;
//# sourceMappingURL=availability.routes.js.map