"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const venues_controller_1 = require("../controllers/venues.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.get('/', auth_middleware_1.authenticateToken, venues_controller_1.searchVenues);
router.post('/', auth_middleware_1.authenticateToken, venues_controller_1.createVenue);
exports.default = router;
//# sourceMappingURL=venues.routes.js.map