"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const admin_controller_1 = require("../controllers/admin.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const admin_middleware_1 = require("../middleware/admin.middleware");
const router = (0, express_1.Router)();
// All admin routes require authentication AND admin gating
router.use(auth_middleware_1.authenticateToken);
router.use(admin_middleware_1.requireAdmin);
router.get('/stats', admin_controller_1.getStats);
router.get('/reports', admin_controller_1.getReports);
router.patch('/reports/:id', admin_controller_1.resolveReport);
router.post('/broadcast', admin_controller_1.broadcastAnnouncement);
exports.default = router;
//# sourceMappingURL=admin.routes.js.map