import 'dotenv/config';

import path from 'path';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.routes';
import citiesRoutes from './routes/cities.routes';
import sportsRoutes from './routes/sports.routes';
import usersRoutes from './routes/users.routes';
import notificationsRoutes from './routes/notifications.routes';
import uploadsRoutes from './routes/uploads.routes';
import appRoutes from './routes/app.routes';
import invitesRoutes from './routes/invites.routes';
import servicesRoutes from './routes/services.routes';
import teamsRoutes from './routes/teams.routes';
import tournamentsRoutes from './routes/tournaments.routes';
import matchesRoutes from './routes/matches.routes';
import scoringRoutes from './routes/scoring.routes';
import leaderboardRoutes from './routes/leaderboard.routes';
import communityRoutes from './routes/community.routes';
import profilePostsRoutes from './routes/profilePosts.routes';
import messagesRoutes from './routes/messages.routes';
import searchRoutes from './routes/search.routes';
import availabilityRoutes from './routes/availability.routes';
import giftsRoutes from './routes/gifts.routes';
import transactionsRoutes from './routes/transactions.routes';
import accountRoutes from './routes/account.routes';
import badgesRoutes from './routes/badges.routes';
import challengesRoutes from './routes/challenges.routes';
import seasonsRoutes from './routes/seasons.routes';
import kudosRoutes from './routes/kudos.routes';
import venuesRoutes from './routes/venues.routes';
import referralsRoutes from './routes/referrals.routes';
import devRoutes from './routes/dev.routes';
import adminRoutes from './routes/admin.routes';
import jobsRoutes from './routes/jobs.routes';
import { authenticateToken } from './middleware/auth.middleware';
import { rateLimitKey, verifiedUserId } from './middleware/rateLimitKey';
import { rateLimitBypassed } from './middleware/rateLimitBypass';

import { sanitizeErrorResponses, globalErrorHandler } from './middleware/errorSanitizer';
import { queryAliases } from './middleware/queryAliases.middleware';
import { sweepStaleLiveMatches } from './controllers/matches.controller';
import { purgeExpiredAccountsCore } from './controllers/account.controller';
import {
  runPublishScheduledPosts,
  runSmartMatchNotifications,
  runMatchReminderSweep,
  runReEngagement,
  runWeeklyDigest,
} from './controllers/features.controller';

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));
// 12mb cap supports base64-encoded profile photos (Change #4: no client size limit;
// server compresses). Larger uploads should switch to multipart in a future module.
// SC-351: 14mb, not 12mb. Uploads arrive base64-encoded, which inflates 4/3 — so a
// 12mb body cap made the REAL image ceiling ~8.9MB and Express rejected a genuine
// 9-10MB photo with a raw 413 "Request payload too large" before the upload
// controller's own 10MB check could return its friendly "Image too large (max
// 10MB)". 14mb covers base64 of a full 10MB image (13.34MB) so the controller is
// what actually enforces the limit, with the message the user should see.
app.use(express.json({ limit: '14mb' }));
// SC-403: make snake_case/camelCase query params interchangeable, so a filter
// spelled the other way is applied rather than silently dropped (which returned
// an unfiltered list with a 200).
app.use(queryAliases);

// Backstop: scrub internal/DB detail from any 5xx response (SC-44).
app.use(sanitizeErrorResponses);

/**
 * SC-431 · budgets that survive a real venue.
 *
 * The old limiter was a flat 200 requests per 15 minutes keyed on IP. At a ground
 * — one Wi-Fi, or a carrier putting thousands of subscribers behind one address
 * via CGNAT — that is a shared budget, so a handful of spectators watching a live
 * match locked everyone else out. The limit meant to stop one abuser silenced a
 * whole venue instead.
 *
 * Authenticated traffic is now keyed and budgeted PER USER, so one heavy viewer
 * can only ever exhaust their own allowance. Unauthenticated traffic keeps the
 * per-IP budget, because there is no identity to key on and that is precisely
 * where abuse protection belongs.
 *
 * The number is raised deliberately and modestly, alongside the client-side fix
 * that cut a live viewer from ~1200 requests per 15 minutes to well under 200:
 * PER_USER_MAX is headroom for a long session, not permission to be chatty.
 */
const PER_USER_MAX = 600;
const PER_IP_MAX = 200;
/** Abuse ceiling for AUTHENTICATED traffic from one address, so per-user keying
 *  cannot be farmed by minting many accounts behind one IP. Generous enough that
 *  a full team on one Wi-Fi never reaches it. */
const PER_IP_AUTHED_CEILING = 4000;

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => (verifiedUserId(req) ? PER_USER_MAX : PER_IP_MAX),
  keyGenerator: rateLimitKey,
  skip: rateLimitBypassed,
  standardHeaders: true,
  legacyHeaders: false,
});

const ipCeilingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: PER_IP_AUTHED_CEILING,
  keyGenerator: (req) => `ipc:${req.ip ?? 'unknown'}`,
  skip: (req) => rateLimitBypassed(req) || !verifiedUserId(req),
  standardHeaders: false,
  legacyHeaders: false,
});

app.use(globalLimiter);
app.use(ipCeilingLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  // Stays per-IP on purpose: there is no verified identity on a login attempt,
  // and this is the limiter that actually stops credential stuffing.
  skip: rateLimitBypassed,
  standardHeaders: true,
  legacyHeaders: false,
});

const sendOtpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  skip: rateLimitBypassed,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'sportclan-backend' });
});

/**
 * SC-427 · /health says WHICH build is answering.
 *
 * Confirming a deploy used to mean probing for a route that only exists in the
 * new code — SC-424 was verified by watching `POST /matches/:id/void` go 404 →
 * 401. That works, but it needs a new route every time and tells you nothing when
 * a release adds none. Render injects RENDER_GIT_COMMIT into the running service,
 * so the build can simply say who it is.
 *
 * Short SHA rather than the full one: seven characters identify the commit for
 * anyone who has the repo and reveal nothing more to anyone who does not.
 * `startedAt` distinguishes "redeployed" from "same build, still up" when the SHA
 * has not moved. Both are null off-Render (local, tests), never undefined, so the
 * shape is stable for callers.
 */
const BOOT_ISO = new Date().toISOString();
const GIT_COMMIT = process.env.RENDER_GIT_COMMIT ?? null;

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    commit: GIT_COMMIT ? GIT_COMMIT.slice(0, 7) : null,
    branch: process.env.RENDER_GIT_BRANCH ?? null,
    startedAt: BOOT_ISO,
  });
});

// Stricter limit on /auth/send-otp must be mounted BEFORE the general /auth limiter
// Cache-Control middleware for static / near-static endpoints. These
// payloads change infrequently and benefit from edge/client caching.
const cacheFor = (seconds: number) => (_req: any, res: any, next: any) => {
  res.set('Cache-Control', `public, max-age=${seconds}`);
  next();
};

app.use('/auth/send-otp', sendOtpLimiter);
app.use('/auth', authLimiter, authRoutes);
app.use('/cities', cacheFor(86400), citiesRoutes);      // 24h — pure static reference (id/name/state)
// SC-269: /sports was 24h, but it now carries OPERATIONAL config (is_active
// deactivations, allows_draw, default_duration_minutes), not just static
// reference. 24h meant a config change took a day to reach existing installs
// (a deactivated sport lingered in pickers; the duration prefill read a stale
// pre-migration payload). 5m keeps the caching benefit — sport config changes
// ~never — while letting real changes propagate promptly.
app.use('/sports', cacheFor(300), sportsRoutes);        // 5m (SC-269)
app.use('/users', usersRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/uploads', uploadsRoutes);
app.use('/app', cacheFor(300), appRoutes);             // 5m
app.use('/invites', invitesRoutes);
app.use('/services', servicesRoutes);
app.use('/teams', teamsRoutes);
app.use('/tournaments', tournamentsRoutes);
app.use('/matches', matchesRoutes);
app.use('/scoring', scoringRoutes);
app.use('/leaderboard', leaderboardRoutes);
app.use('/community', communityRoutes);
// SC-356: personal profile-wall posts (separate from community posts).
app.use('/profile-posts', profilePostsRoutes);
app.use('/messages', messagesRoutes);
app.use('/search', searchRoutes);
app.use('/availability', availabilityRoutes);
app.use('/gifts', cacheFor(3600), giftsRoutes);         // 1h
app.use('/transactions', transactionsRoutes);
app.use('/account', accountRoutes);
app.use('/badges', badgesRoutes);
app.use('/challenges', challengesRoutes);
app.use('/seasons', seasonsRoutes);
app.use('/kudos', kudosRoutes);
app.use('/venues', venuesRoutes);
app.use('/referrals', referralsRoutes);
app.use('/dev', devRoutes);
app.use('/internal/jobs', jobsRoutes);
app.use('/admin', adminRoutes);

// Final backstop for uncaught throws (must be last).
app.use(globalErrorHandler);

const PORT = parseInt(process.env.PORT || '4000', 10);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[sportclan-backend] listening on :${PORT}`);

  // SC-434: an hourly premium-expiry sweep ran here, flipping lapsed users to the
  // free tier and firing "your Premium expires in 3 days" reminders. There are no
  // tiers and nothing expires, so it is gone — which is also what guarantees that
  // the 2,501 complimentary rows dated 1 Oct 2026 pass without a single user being
  // told anything or losing anything.

  // ── Scheduled feature jobs (in-process, independent of dev.routes which is
  //    deleted pre-launch). All jobs are idempotent / deduped via
  //    notification_sends, so a double-fire (restart / multi-instance) is safe.

  // Publish due scheduled (Premium) posts frequently so they appear on time.
  const runPublish = async () => {
    try {
      const { published } = await runPublishScheduledPosts();
      if (published > 0) console.log(`[publish-scheduled-posts] published ${published}`); // eslint-disable-line no-console
    } catch (e) {
      console.warn('[publish-scheduled-posts] failed', e instanceof Error ? e.message : e); // eslint-disable-line no-console
    }
  };
  void runPublish();
  setInterval(runPublish, 2 * 60 * 1000).unref();

  // 15-min pre-match reminder sweep. Runs every 5 min so a participant NOT in the
  // app still gets reminded (the app-open trigger alone missed them). Idempotent
  // via notification_sends, so a double-fire (restart / multi-instance) is safe.
  const runReminders = async () => {
    try {
      const { sent } = await runMatchReminderSweep();
      if (sent > 0) console.log(`[match-reminder] sent ${sent}`); // eslint-disable-line no-console
    } catch (e) {
      console.warn('[match-reminder] failed', e instanceof Error ? e.message : e); // eslint-disable-line no-console
    }
  };
  void runReminders();
  setInterval(runReminders, 5 * 60 * 1000).unref();

  // Daily notification jobs at ~09:00 IST; weekly digest additionally on Monday.
  // The hourly tick acts only when the IST hour is 9; the per-user/day dedupe
  // guarantees at-most-once even if a tick overlaps or the process restarts.
  // SC-139: run at the FIRST opportunity at/after 09:00 IST each day — on BOOT and
  // on the hourly tick — so a spin-down/restart/deploy across 09:00 still catches up
  // the same day (was: fired only if a tick landed exactly at hour==9, silently
  // skipped otherwise). The per-user notification_sends dedup makes every run
  // at-most-once-per-day, so a boot-time run can NEVER double-send. An in-memory
  // once-per-day guard keeps the 09:00-23:00 ticks from redoing the full scan; a
  // restart resets it, so a post-restart boot re-runs (dedup-protected).
  let lastDailyRun: string | null = null;
  const runDailyWeekly = async () => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: 'numeric', hour12: false, weekday: 'short',
    }).formatToParts(new Date());
    const val = (t: string) => parts.find((p) => p.type === t)?.value;
    const hour = Number(val('hour') ?? -1);
    const weekday = val('weekday'); // 'Mon'…
    const istDate = `${val('year')}-${val('month')}-${val('day')}`;
    if (hour < 9) return;                    // don't send before 09:00 IST
    if (lastDailyRun === istDate) return;    // already ran today in this process
    lastDailyRun = istDate;
    try { const { sent } = await runSmartMatchNotifications(); if (sent) console.log(`[smart-match] sent ${sent}`); } // eslint-disable-line no-console
    catch (e) { console.warn('[smart-match] failed', e instanceof Error ? e.message : e); } // eslint-disable-line no-console
    try { const { sent } = await runReEngagement(); if (sent) console.log(`[reengagement] sent ${sent}`); } // eslint-disable-line no-console
    catch (e) { console.warn('[reengagement] failed', e instanceof Error ? e.message : e); } // eslint-disable-line no-console
    if (weekday === 'Mon') {
      try { const { sent } = await runWeeklyDigest(); if (sent) console.log(`[weekly-digest] sent ${sent}`); } // eslint-disable-line no-console
      catch (e) { console.warn('[weekly-digest] failed', e instanceof Error ? e.message : e); } // eslint-disable-line no-console
    }
  };
  void runDailyWeekly();
  setInterval(runDailyWeekly, 60 * 60 * 1000).unref();
});
// Sat Apr 11 01:56:26 IST 2026
