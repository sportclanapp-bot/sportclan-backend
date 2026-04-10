"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const gifts_controller_1 = require("../controllers/gifts.controller");
const router = (0, express_1.Router)();
router.get('/catalogue', gifts_controller_1.getCatalogue); // Public
router.post('/send', auth_middleware_1.authenticateToken, gifts_controller_1.sendGift);
router.get('/received', auth_middleware_1.authenticateToken, gifts_controller_1.getReceivedGifts);
router.get('/sent', auth_middleware_1.authenticateToken, gifts_controller_1.getSentGifts);
exports.default = router;
//# sourceMappingURL=gifts.routes.js.map