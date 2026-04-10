"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
// GET /app/version — version gate for the mobile client.
// Configure via env so we can bump without redeploying:
//   APP_LATEST_VERSION, APP_MIN_VERSION, APP_FORCE_UPDATE, APP_STORE_URL
router.get('/version', (_req, res) => {
    return res.json({
        latestVersion: process.env.APP_LATEST_VERSION || '1.0.0',
        minVersion: process.env.APP_MIN_VERSION || '1.0.0',
        forceUpdate: process.env.APP_FORCE_UPDATE === 'true',
        storeUrl: process.env.APP_STORE_URL ||
            'https://play.google.com/store/apps/details?id=com.sportclan.app',
    });
});
exports.default = router;
//# sourceMappingURL=app.routes.js.map