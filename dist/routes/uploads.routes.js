"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uploads_controller_1 = require("../controllers/uploads.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post('/profile-photo', auth_middleware_1.authenticateToken, uploads_controller_1.uploadProfilePhoto);
exports.default = router;
//# sourceMappingURL=uploads.routes.js.map