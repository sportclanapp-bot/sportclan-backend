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
import messagesRoutes from './routes/messages.routes';
import searchRoutes from './routes/search.routes';
import availabilityRoutes from './routes/availability.routes';
import subscriptionsRoutes from './routes/subscriptions.routes';
import giftsRoutes from './routes/gifts.routes';
import transactionsRoutes from './routes/transactions.routes';
import accountRoutes from './routes/account.routes';
import webhooksRoutes from './routes/webhooks.routes';
import badgesRoutes from './routes/badges.routes';
import challengesRoutes from './routes/challenges.routes';
import seasonsRoutes from './routes/seasons.routes';
import kudosRoutes from './routes/kudos.routes';
import venuesRoutes from './routes/venues.routes';
import referralsRoutes from './routes/referrals.routes';
import devRoutes from './routes/dev.routes';
import adminRoutes from './routes/admin.routes';
import jobsRoutes from './routes/jobs.routes';
import { sweepExpiredPremium } from './controllers/subscriptions.controller';
import { sweepStaleLiveMatches } from './controllers/matches.controller';
import {
  runPublishScheduledPosts,
  runSmartMatchNotifications,
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
app.use(express.json({ limit: '12mb' }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const sendOtpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'sportclan-backend' });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
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
app.use('/cities', cacheFor(86400), citiesRoutes);      // 24h
app.use('/sports', cacheFor(86400), sportsRoutes);      // 24h
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
app.use('/messages', messagesRoutes);
app.use('/search', searchRoutes);
app.use('/availability', availabilityRoutes);
app.use('/subscriptions', subscriptionsRoutes);
app.use('/gifts', cacheFor(3600), giftsRoutes);         // 1h
app.use('/transactions', transactionsRoutes);
app.use('/account', accountRoutes);
app.use('/webhooks', webhooksRoutes);
app.use('/badges', badgesRoutes);
app.use('/challenges', challengesRoutes);
app.use('/seasons', seasonsRoutes);
app.use('/kudos', kudosRoutes);
app.use('/venues', venuesRoutes);
app.use('/referrals', referralsRoutes);
app.use('/dev', devRoutes);
app.use('/internal/jobs', jobsRoutes);
app.use('/admin', adminRoutes);

const PORT = parseInt(process.env.PORT || '4000', 10);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[sportclan-backend] listening on :${PORT}`);
  // Payment webhook HMAC verification silently 500s every hit without this —
  // surface it loudly at boot so it's impossible to ship without noticing.
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    // eslint-disable-next-line no-console
    console.warn(
      '[sportclan-backend] \u26A0\uFE0F  RAZORPAY_WEBHOOK_SECRET is not set. ' +
      'Razorpay webhook signature verification will fail. ' +
      'Add it to the hosting provider env (Render/Railway) before launch.',
    );
  }

  // Premium expiry sweep — flips lapsed users to free tier in bulk so expiry
  // doesn't depend on the user opening the app (lazy check in /users/me still
  // runs too). Hourly; once on boot. Idempotent, so multiple instances are safe.
  const runSweep = async () => {
    try {
      const { users, subs } = await sweepExpiredPremium();
      if (users > 0 || subs > 0) {
        // eslint-disable-next-line no-console
        console.log(`[premium-sweep] expired ${users} user(s), ${subs} subscription(s)`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[premium-sweep] failed', e instanceof Error ? e.message : e);
    }
    // SC-16 · auto-abandon matches stuck 'live' with no scoring activity.
    try {
      const { abandoned } = await sweepStaleLiveMatches();
      if (abandoned > 0) {
        // eslint-disable-next-line no-console
        console.log(`[stale-live-sweep] abandoned ${abandoned} stale live match(es)`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[stale-live-sweep] failed', e instanceof Error ? e.message : e);
    }
  };
  void runSweep();
  setInterval(runSweep, 60 * 60 * 1000).unref();

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

  // Daily notification jobs at ~09:00 IST; weekly digest additionally on Monday.
  // The hourly tick acts only when the IST hour is 9; the per-user/day dedupe
  // guarantees at-most-once even if a tick overlaps or the process restarts.
  const runDailyWeekly = async () => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false, weekday: 'short',
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? -1);
    const weekday = parts.find((p) => p.type === 'weekday')?.value; // 'Mon'…
    if (hour !== 9) return;
    try { const { sent } = await runSmartMatchNotifications(); if (sent) console.log(`[smart-match] sent ${sent}`); } // eslint-disable-line no-console
    catch (e) { console.warn('[smart-match] failed', e instanceof Error ? e.message : e); } // eslint-disable-line no-console
    try { const { sent } = await runReEngagement(); if (sent) console.log(`[reengagement] sent ${sent}`); } // eslint-disable-line no-console
    catch (e) { console.warn('[reengagement] failed', e instanceof Error ? e.message : e); } // eslint-disable-line no-console
    if (weekday === 'Mon') {
      try { const { sent } = await runWeeklyDigest(); if (sent) console.log(`[weekly-digest] sent ${sent}`); } // eslint-disable-line no-console
      catch (e) { console.warn('[weekly-digest] failed', e instanceof Error ? e.message : e); } // eslint-disable-line no-console
    }
  };
  setInterval(runDailyWeekly, 60 * 60 * 1000).unref();
});
// Sat Apr 11 01:56:26 IST 2026
