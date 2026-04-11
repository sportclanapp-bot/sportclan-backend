"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const account_controller_1 = require("../controllers/account.controller");
const router = (0, express_1.Router)();
router.post('/delete', auth_middleware_1.authenticateToken, account_controller_1.deleteAccount);
router.post('/export-data', auth_middleware_1.authenticateToken, account_controller_1.exportData);
router.get('/sessions', auth_middleware_1.authenticateToken, account_controller_1.getSessions);
router.delete('/sessions/all', auth_middleware_1.authenticateToken, account_controller_1.revokeAllSessions);
router.delete('/sessions/:sessionId', auth_middleware_1.authenticateToken, account_controller_1.revokeSession);
router.post('/feedback', auth_middleware_1.authenticateToken, account_controller_1.submitFeedback);
exports.default = router;
//# sourceMappingURL=account.routes.js.map