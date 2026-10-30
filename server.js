import './src/logBuffer.js'; // সবার আগে — লগ ক্যাপচার চালু করে
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './bot/config.js';
import { flush } from './bot/lib/store.js';
import { bot } from './src/botManager.js';
import { getLogs } from './src/logBuffer.js';
import { groupsRouter } from './src/groupsApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

/* ------------------------------ অথ ------------------------------ */
const PASSWORD = process.env.ADMIN_PASSWORD || '';
if (PASSWORD.length < 8) {
  console.error('❌ ADMIN_PASSWORD সেট করা নেই বা ৮ অক্ষরের কম। Railway → Variables এ সেট করুন।');
  process.exit(1);
}
const SECRET = process.env.SESSION_SECRET || PASSWORD;
const COOKIE = 'wa_host_session';
const TTL = 7 * 24 * 3600 * 1000; // ৭ দিন

const sha = (v) => crypto.createHash('sha256').update(v).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');

function makeToken() {
  const exp = String(Date.now() + TTL);
  return `${exp}.${sign(exp)}`;
}

function validToken(token) {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookiesOf(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const requireAuth = (req, res, next) =>
  validToken(cookiesOf(req)[COOKIE]) ? next() : res.status(401).json({ error: 'লগইন করুন' });

// ভুল পাসওয়ার্ডের চেষ্টা সীমিত করা (আইপি প্রতি ১৫ মিনিটে ৮ বার)
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  let rec = attempts.get(ip);
  if (!rec || rec.reset < now) {
    rec = { n: 0, reset: now + 15 * 60_000 };
    attempts.set(ip, rec);
  }
  return rec.n >= 8;
}

/* ------------------------------ অ্যাপ ------------------------------ */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Railway প্রক্সির পেছনে
app.use(express.json({ limit: '64kb' })); // গ্রুপ-সেটিংয়ের তালিকাগুলোর জন্য একটু বড়
app.use((req, res, next) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
  next();
});

// Railway হেলথচেক (অথ লাগে না)
app.get('/health', (_req, res) => res.type('text').send('ok'));

app.post('/api/login', (req, res) => {
  if (tooMany(req.ip)) {
    return res.status(429).json({ error: 'অনেকবার ভুল চেষ্টা হয়েছে। ১৫ মিনিট পরে আবার চেষ্টা করুন।' });
  }
  if (!safeEqual(String(req.body?.password ?? ''), PASSWORD)) {
    attempts.get(req.ip).n += 1;
    return res.status(401).json({ error: 'পাসওয়ার্ড ভুল' });
  }
  attempts.delete(req.ip);
  res.cookie(COOKIE, makeToken(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    maxAge: TTL,
  });
  res.json({ ok: true });
});

app.use('/api', requireAuth);
app.use('/api', groupsRouter); // গ্রুপ-সেটিং, নোটিশ-প্রিভিউ, প্রাইভেট মোড (লগইন-সুরক্ষিত)

const handle = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => res.status(400).json({ error: e.message }));

const onRailway = Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_NAME);

app.get(
  '/api/status',
  handle((_req, res) => {
    res.json({
      ...bot.snapshot(),
      server: {
        uptimeSec: Math.round(process.uptime()),
        dataDir: config.dataDir,
        // Railway-তে Volume না থাকলে রিডিপ্লয়ে সেশন হারিয়ে যায়
        volumeWarning: onRailway && !process.env.RAILWAY_VOLUME_MOUNT_PATH,
      },
      config: {
        botName: config.botName,
        prefix: config.prefix,
        owners: config.owners.length,
        youtube: Boolean(config.youtubeKey),
        spotify: Boolean(config.spotifyId && config.spotifySecret),
        ai: Boolean(config.geminiKey),
        aiModel: config.geminiModel,
      },
    });
  }),
);

app.get('/api/logs', handle((req, res) => res.json({ logs: getLogs(Number(req.query.n) || 120) })));

app.post('/api/bot/start', handle(async (_req, res) => { await bot.start(); res.json({ ok: true }); }));
app.post('/api/bot/stop', handle(async (_req, res) => { await bot.stop(); res.json({ ok: true }); }));
app.post('/api/bot/restart', handle(async (_req, res) => { await bot.restart(); res.json({ ok: true }); }));
app.post('/api/bot/logout', handle(async (_req, res) => { await bot.logout(); res.json({ ok: true }); }));
app.post(
  '/api/bot/pair',
  handle(async (req, res) => res.json({ code: await bot.requestPairing(req.body?.phone) })),
);

app.post('/api/signout', (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 ড্যাশবোর্ড চালু: পোর্ট ${PORT} | ডাটা ফোল্ডার: ${config.dataDir}`);
  bot.autoStart().catch((e) => console.error('[autoStart]', e.message));
});

/* ------------------------- গ্রেসফুল শাটডাউন ------------------------- */
// Railway রিডিপ্লয়ে SIGTERM পাঠায় — সেশন সেভ করে পরিষ্কারভাবে বন্ধ হই
let closing = false;
async function shutdown(sig) {
  if (closing) return;
  closing = true;
  console.log(`${sig} পেয়েছি — বন্ধ হচ্ছে…`);
  try {
    await bot.stop();
  } catch {
    /* উপেক্ষা */
  }
  flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
