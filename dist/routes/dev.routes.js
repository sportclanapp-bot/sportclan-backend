"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dev_controller_1 = require("../controllers/dev.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// POST /dev/load-full-data — comprehensive test-data seeder.
// Remove before the production Store build.
router.post('/load-full-data', auth_middleware_1.authenticateToken, dev_controller_1.loadFullData);
exports.default = router;
//# sourceMappingURL=dev.routes.js.map