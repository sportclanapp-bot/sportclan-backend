"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const cities_routes_1 = __importDefault(require("./routes/cities.routes"));
const sports_routes_1 = __importDefault(require("./routes/sports.routes"));
const users_routes_1 = __importDefault(require("./routes/users.routes"));
const notifications_routes_1 = __importDefault(require("./routes/notifications.routes"));
const uploads_routes_1 = __importDefault(require("./routes/uploads.routes"));
const app_routes_1 = __importDefault(require("./routes/app.routes"));
const invites_routes_1 = __importDefault(require("./routes/invites.routes"));
const services_routes_1 = __importDefault(require("./routes/services.routes"));
const teams_routes_1 = __importDefault(require("./routes/teams.routes"));
const tournaments_routes_1 = __importDefault(require("./routes/tournaments.routes"));
const matches_routes_1 = __importDefault(require("./routes/matches.routes"));
const scoring_routes_1 = __importDefault(require("./routes/scoring.routes"));
const leaderboard_routes_1 = __importDefault(require("./routes/leaderboard.routes"));
const community_routes_1 = __importDefault(require("./routes/community.routes"));
const messages_routes_1 = __importDefault(require("./routes/messages.routes"));
const search_routes_1 = __importDefault(require("./routes/search.routes"));
const availability_routes_1 = __importDefault(require("./routes/availability.routes"));
const subscriptions_routes_1 = __importDefault(require("./routes/subscriptions.routes"));
const gifts_routes_1 = __importDefault(require("./routes/gifts.routes"));
const transactions_routes_1 = __importDefault(require("./routes/transactions.routes"));
const account_routes_1 = __importDefault(require("./routes/account.routes"));
const webhooks_routes_1 = __importDefault(require("./routes/webhooks.routes"));
const badges_routes_1 = __importDefault(require("./routes/badges.routes"));
const challenges_routes_1 = __importDefault(require("./routes/challenges.routes"));
const seasons_routes_1 = __importDefault(require("./routes/seasons.routes"));
const kudos_routes_1 = __importDefault(require("./routes/kudos.routes"));
const venues_routes_1 = __importDefault(require("./routes/venues.routes"));
const referrals_routes_1 = __importDefault(require("./routes/referrals.routes"));
const dev_routes_1 = __importDefault(require("./routes/dev.routes"));
const admin_routes_1 = __importDefault(require("./routes/admin.routes"));
const app = (0, express_1.default)();
app.set('trust proxy', 1);
app.use((0, helmet_1.default)({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
        },
    },
}));
app.use((0, cors_1.default)());
app.use(express_1.default.static(path_1.default.join(__dirname, '..', 'public')));
// 12mb cap supports base64-encoded profile photos (Change #4: no client size limit;
// server compresses). Larger uploads should switch to multipart in a future module.
app.use(express_1.default.json({ limit: '12mb' }));
const globalLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(globalLimiter);
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
});
const sendOtpLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
});
app.get('/', (_req, res) => {
    res.json({ ok: true, service: 'sportclan-backend' });
});
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});
// Stricter limit on /auth/send-otp must be mounted BEFORE the general /auth limiter
// Cache-Control middleware for static / near-static endpoints. These
// payloads change infrequently and benefit from edge/client caching.
const cacheFor = (seconds) => (_req, res, next) => {
    res.set('Cache-Control', `public, max-age=${seconds}`);
    next();
};
app.use('/auth/send-otp', sendOtpLimiter);
app.use('/auth', authLimiter, auth_routes_1.default);
app.use('/cities', cacheFor(86400), cities_routes_1.default); // 24h
app.use('/sports', cacheFor(86400), sports_routes_1.default); // 24h
app.use('/users', users_routes_1.default);
app.use('/notifications', notifications_routes_1.default);
app.use('/uploads', uploads_routes_1.default);
app.use('/app', cacheFor(300), app_routes_1.default); // 5m
app.use('/invites', invites_routes_1.default);
app.use('/services', services_routes_1.default);
app.use('/teams', teams_routes_1.default);
app.use('/tournaments', tournaments_routes_1.default);
app.use('/matches', matches_routes_1.default);
app.use('/scoring', scoring_routes_1.default);
app.use('/leaderboard', leaderboard_routes_1.default);
app.use('/community', community_routes_1.default);
app.use('/messages', messages_routes_1.default);
app.use('/search', search_routes_1.default);
app.use('/availability', availability_routes_1.default);
app.use('/subscriptions', subscriptions_routes_1.default);
app.use('/gifts', cacheFor(3600), gifts_routes_1.default); // 1h
app.use('/transactions', transactions_routes_1.default);
app.use('/account', account_routes_1.default);
app.use('/webhooks', webhooks_routes_1.default);
app.use('/badges', badges_routes_1.default);
app.use('/challenges', challenges_routes_1.default);
app.use('/seasons', seasons_routes_1.default);
app.use('/kudos', kudos_routes_1.default);
app.use('/venues', venues_routes_1.default);
app.use('/referrals', referrals_routes_1.default);
app.use('/dev', dev_routes_1.default);
app.use('/admin', admin_routes_1.default);
const PORT = parseInt(process.env.PORT || '4000', 10);
app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[sportclan-backend] listening on :${PORT}`);
    // Payment webhook HMAC verification silently 500s every hit without this —
    // surface it loudly at boot so it's impossible to ship without noticing.
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
        // eslint-disable-next-line no-console
        console.warn('[sportclan-backend] \u26A0\uFE0F  RAZORPAY_WEBHOOK_SECRET is not set. ' +
            'Razorpay webhook signature verification will fail. ' +
            'Add it to the hosting provider env (Render/Railway) before launch.');
    }
});
// Sat Apr 11 01:56:26 IST 2026
//# sourceMappingURL=index.js.map