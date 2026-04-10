import admin from 'firebase-admin';

// Lazy-init Firebase Admin SDK from environment variables.
// Real credentials live in Railway env. If env vars are missing,
// sendPush() becomes a graceful no-op so the rest of the API still works.
let _app: admin.app.App | null = null;
let _disabled = false;

function app(): admin.app.App | null {
  if (_disabled) return null;
  if (_app) return _app;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Railway stores the private key with literal \n — convert to real newlines.
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  console.log('[fcm-debug] PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? 'SET' : 'MISSING');
  console.log('[fcm-debug] CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? 'SET' : 'MISSING');
  console.log('[fcm-debug] PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? 'SET (len:' + process.env.FIREBASE_PRIVATE_KEY.length + ')' : 'MISSING');
  if (!projectId || !clientEmail || !privateKey) {
    _disabled = true;
    // eslint-disable-next-line no-console
    console.warn('[fcm] Firebase env vars missing — push notifications disabled');
    return null;
  }
  _app = admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
  return _app;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

// Sends a push to many tokens. Returns count of successful deliveries.
// Failures are logged but never throw — pushes are best-effort.
export async function sendPushToTokens(
  tokens: string[],
  payload: PushPayload,
): Promise<number> {
  const a = app();
  if (!a || tokens.length === 0) return 0;
  try {
    const res = await admin.messaging(a).sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
    });
    return res.successCount;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[fcm] sendPush failed', err);
    return 0;
  }
}
