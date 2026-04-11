"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushToTokens = void 0;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
// Lazy-init Firebase Admin SDK from environment variables.
// Real credentials live in Railway env. If env vars are missing,
// sendPush() becomes a graceful no-op so the rest of the API still works.
let _app = null;
let _disabled = false;
function app() {
    if (_disabled)
        return null;
    if (_app)
        return _app;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    // Railway stores the private key with literal \n — convert to real newlines.
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) {
        _disabled = true;
        // eslint-disable-next-line no-console
        console.warn('[fcm] Firebase env vars missing — push notifications disabled');
        return null;
    }
    _app = firebase_admin_1.default.initializeApp({
        credential: firebase_admin_1.default.credential.cert({ projectId, clientEmail, privateKey }),
    });
    return _app;
}
// Sends a push to many tokens. Returns count of successful deliveries.
// Failures are logged but never throw — pushes are best-effort.
async function sendPushToTokens(tokens, payload) {
    const a = app();
    if (!a || tokens.length === 0)
        return 0;
    try {
        const res = await firebase_admin_1.default.messaging(a).sendEachForMulticast({
            tokens,
            notification: { title: payload.title, body: payload.body },
            data: payload.data,
        });
        return res.successCount;
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error('[fcm] sendPush failed', err);
        return 0;
    }
}
exports.sendPushToTokens = sendPushToTokens;
//# sourceMappingURL=fcm.js.map