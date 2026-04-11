"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dev_controller_1 = require("../controllers/dev.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post('/load-test-data', auth_middleware_1.authenticateToken, dev_controller_1.loadTestData);
exports.default = router;
//# sourceMappingURL=dev.routes.js.map