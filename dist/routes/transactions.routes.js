"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const transactions_controller_1 = require("../controllers/transactions.controller");
const router = (0, express_1.Router)();
router.get('/', auth_middleware_1.authenticateToken, transactions_controller_1.getTransactions);
exports.default = router;
//# sourceMappingURL=transactions.routes.js.map