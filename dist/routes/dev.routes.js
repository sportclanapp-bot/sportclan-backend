"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ════════════════════════════════════════════════════════════════════════════
// ⚠️  REMOVE BEFORE PRODUCTION LAUNCH ⚠️
//
// This router mounts /dev/load-test-data which seeds 50 users, 22 teams,
// 55 tournaments, ~385 matches, etc. It is authenticated but anyone with a
// valid JWT can trigger it. For the final Play Store / App Store submission:
//   1. Delete this file and src/controllers/dev.controller.ts
//   2. Remove the `import devRoutes` and `app.use('/dev', devRoutes)` lines
//      from src/index.ts
//   3. Remove the "Load Test Data" button from HamburgerMenuScreen.tsx
//      (frontend already gates it behind __DEV__ but strip it entirely).
// ════════════════════════════════════════════════════════════════════════════
const express_1 = require("express");
const dev_controller_1 = require("../controllers/dev.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post('/load-test-data', auth_middleware_1.authenticateToken, dev_controller_1.loadTestData);
exports.default = router;
//# sourceMappingURL=dev.routes.js.map