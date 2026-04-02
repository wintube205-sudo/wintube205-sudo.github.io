// Auth routes - server-side authentication
import { Hono } from 'hono';
import type { HonoEnv } from '../lib/types';
import { CONFIG } from '../lib/types';
import { hashPassword, verifyPassword, generateToken, generateId, generateRefCode } from '../lib/crypto';
import { checkRateLimit } from '../lib/rateLimit';
import { sendVerifyEmail } from './profile';

// ═══ GOOGLE OAUTH HELPER ═══
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

function getRedirectUri(req: Request): string {
  const host = req.headers.get('host') || '';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}/api/auth/google/callback`;
}

const auth = new Hono<HonoEnv>();

// ═══ REGISTER ═══
auth.post('/register', async (c) => {
  const body = await c.req.json<{
    name?: string; email?: string; password?: string; referralCode?: string;
  }>();

  const { name, email, password, referralCode } = body;
  if (!name || !email || !password) {
    return c.json({ error: 'Name, email and password required' }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Invalid email format' }, 400);
  }
  if (name.length > 50 || email.length > 100) {
    return c.json({ error: 'Name or email too long' }, 400);
  }

  const db = c.env.DB;

  // Check if email exists
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first();
  if (existing) {
    return c.json({ error: 'Email already registered' }, 409);
  }

  const uid = generateId();
  const passwordHash = await hashPassword(password);
  const refCode = generateRefCode(uid);

  // Create user
  const result = await db.prepare(
    `INSERT INTO users (uid, name, email, password_hash, auth_provider, points, ref_code)
     VALUES (?, ?, ?, ?, 'email', ?, ?)`
  ).bind(uid, name.trim(), email.toLowerCase().trim(), passwordHash, CONFIG.SIGNUP_BONUS, refCode).run();

  const userId = result.meta.last_row_id;

  // Record signup bonus
  await db.prepare(
    `INSERT INTO point_transactions (user_id, amount, type, description)
     VALUES (?, ?, 'signup_bonus', 'Welcome bonus')`
  ).bind(userId, CONFIG.SIGNUP_BONUS).run();

  // Handle referral
  if (referralCode) {
    const referrer = await db.prepare(
      'SELECT id FROM users WHERE ref_code = ?'
    ).bind(referralCode.toUpperCase().trim()).first<{ id: number }>();

    if (referrer && referrer.id !== userId) {
      // Give bonus to both
      await db.batch([
        db.prepare('UPDATE users SET points = points + ? WHERE id = ?')
          .bind(CONFIG.REFERRAL_BONUS_REFERRER, referrer.id),
        db.prepare('UPDATE users SET points = points + ?, referred_by = ? WHERE id = ?')
          .bind(CONFIG.REFERRAL_BONUS_REFERRED, referralCode.toUpperCase(), userId),
        db.prepare(`INSERT INTO point_transactions (user_id, amount, type, description) VALUES (?, ?, 'referral_bonus', 'Referral bonus')`)
          .bind(referrer.id, CONFIG.REFERRAL_BONUS_REFERRER),
        db.prepare(`INSERT INTO point_transactions (user_id, amount, type, description) VALUES (?, ?, 'referral_bonus', 'Referred signup bonus')`)
          .bind(userId, CONFIG.REFERRAL_BONUS_REFERRED),
      ]);
    }
  }

  // Send verification email (non-blocking)
  const proto = c.req.header('x-forwarded-proto') || 'https';
  const host = c.req.header('host') || 'wintube.win';
  const baseUrl = `${proto}://${host}`;
  sendVerifyEmail(db, userId as number, email.toLowerCase(), name.trim(), c.env.RESEND_API_KEY, baseUrl).catch(() => {});

  // Create session
  const session = await createSession(db, userId as number, c.req.raw);

  return c.json({
    success: true,
    user: { uid, name: name.trim(), email: email.toLowerCase(), points: CONFIG.SIGNUP_BONUS, refCode, emailVerified: false },
    token: session.token,
  }, 201);
});

// ═══ LOGIN ═══
auth.post('/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const { email, password } = body;

  if (!email || !password) {
    return c.json({ error: 'Email and password required' }, 400);
  }

  const db = c.env.DB;

  const user = await db.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(email.toLowerCase().trim()).first<{
    id: number; uid: string; name: string; email: string;
    password_hash: string; points: number; ref_code: string; is_banned: number;
  }>();

  if (!user) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  if (user.is_banned) {
    return c.json({ error: 'Account suspended' }, 403);
  }

  // Rate limit login attempts
  const rl = await checkRateLimit(db, user.id, 'login', CONFIG.MAX_LOGIN_ATTEMPTS, 60);
  if (!rl.allowed) {
    return c.json({ error: `Too many attempts. Try again in ${rl.resetIn}s` }, 429);
  }

  if (!user.password_hash || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const session = await createSession(db, user.id, c.req.raw);

  return c.json({
    success: true,
    user: {
      uid: user.uid, name: user.name, email: user.email,
      points: user.points, refCode: user.ref_code,
    },
    token: session.token,
  });
});

// ═══ GOOGLE OAUTH — REDIRECT ═══
auth.get('/google', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  if (!clientId) return c.json({ error: 'Google auth not configured' }, 500);

  const state = generateToken(16);
  const redirectUri = getRedirectUri(c.req.raw);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  const res = c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  res.headers.set('Set-Cookie', `g_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
  return res;
});

// ═══ GOOGLE OAUTH — CALLBACK ═══
auth.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const cookieHeader = c.req.header('cookie') || '';
  const cookieState = cookieHeader.match(/g_state=([^;]+)/)?.[1];

  if (!code) return c.html('<script>window.location="/";alert("Google login cancelled")</script>');
  if (state && cookieState && state !== cookieState) {
    return c.html('<script>window.location="/";alert("Invalid state")</script>');
  }

  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = getRedirectUri(c.req.raw);

  // Exchange code for token
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });

  const tokenData = await tokenRes.json<{ access_token?: string; error?: string }>();
  if (!tokenData.access_token) {
    return c.html('<script>window.location="/";alert("Google login failed")</script>');
  }

  // Get user info
  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const gUser = await userRes.json<{ sub?: string; name?: string; email?: string; picture?: string }>();

  if (!gUser.email || !gUser.sub) {
    return c.html('<script>window.location="/";alert("Could not get Google profile")</script>');
  }

  const db = c.env.DB;
  const email = gUser.email.toLowerCase();
  const name = gUser.name || email.split('@')[0];

  // Find or create user
  let user = await db.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(email).first<{ id: number; uid: string; name: string; email: string; points: number; ref_code: string; is_banned: number }>();

  let isNew = false;
  if (!user) {
    isNew = true;
    const uid = generateId();
    const refCode = generateRefCode(uid);
    const result = await db.prepare(
      `INSERT INTO users (uid, name, email, auth_provider, points, ref_code, avatar_url)
       VALUES (?, ?, ?, 'google', ?, ?, ?)`
    ).bind(uid, name, email, CONFIG.SIGNUP_BONUS, refCode, gUser.picture || null).run();
    const userId = result.meta.last_row_id as number;
    await db.prepare(
      `INSERT INTO point_transactions (user_id, amount, type, description) VALUES (?, ?, 'signup_bonus', 'Welcome bonus')`
    ).bind(userId, CONFIG.SIGNUP_BONUS).run();
    user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId)
      .first<{ id: number; uid: string; name: string; email: string; points: number; ref_code: string; is_banned: number }>();
  } else {
    // Update avatar if from Google
    await db.prepare('UPDATE users SET avatar_url = ?, auth_provider = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(gUser.picture || null, 'google', user.id).run();
  }

  if (!user || user.is_banned) {
    return c.html('<script>window.location="/";alert("Account suspended")</script>');
  }

  const session = await createSession(db, user.id, c.req.raw);

  // Redirect to frontend with token in hash (never in query string)
  const payload = encodeURIComponent(JSON.stringify({
    token: session.token,
    user: { uid: user.uid, name: user.name, email: user.email, points: user.points, refCode: user.ref_code },
    isNew,
  }));

  return c.html(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><script>
    try {
      const d = JSON.parse(decodeURIComponent("${payload}"));
      localStorage.setItem('wt_token', d.token);
      localStorage.setItem('wt_google_login', JSON.stringify(d));
    } catch(e) {}
    window.location.replace('/');
  </script></body></html>`);
});

// ═══ VERIFY EMAIL ═══
auth.get('/verify-email', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.html('<script>window.location="/";alert("Invalid link")</script>');

  const db = c.env.DB;
  const row = await db.prepare(
    `SELECT user_id FROM email_verifications WHERE token = ? AND expires_at > datetime('now')`
  ).bind(token).first<{ user_id: number }>();

  if (!row) {
    return c.html('<script>window.location="/";alert("Link expired or invalid. Please request a new one.")</script>');
  }

  await db.batch([
    db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).bind(row.user_id),
    db.prepare(`DELETE FROM email_verifications WHERE user_id = ?`).bind(row.user_id),
  ]);

  return c.html(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><script>
    alert('✅ Email verified! You can now make withdrawals.');
    window.location.replace('/');
  </script></body></html>`);
});

// ═══ LOGOUT ═══
auth.post('/logout', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  return c.json({ success: true });
});

// ═══ GET CURRENT USER ═══
auth.get('/me', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ user: null });

  const db = c.env.DB;
  const session = await db.prepare(
    `SELECT u.uid, u.name, u.email, u.points, u.ref_code, u.avatar_url, u.auth_provider,
            u.email_verified, u.vip_until, u.is_banned
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.token = ? AND s.expires_at > datetime('now') AND u.is_banned = 0`
  ).bind(token).first<any>();

  if (!session) return c.json({ user: null });

  const isVip = session.vip_until ? new Date(session.vip_until) > new Date() : false;

  return c.json({ user: { ...session, isVip } });
});

// ═══ Helper: Create Session ═══
async function createSession(db: D1Database, userId: number, req: Request) {
  const token = generateToken(48);
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + CONFIG.SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();
  const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'unknown';
  const ua = req.headers.get('User-Agent') || 'unknown';

  // Clean old sessions (keep max 5 per user)
  await db.prepare(
    `DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
      SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 4
    )`
  ).bind(userId, userId).run();

  await db.prepare(
    `INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(sessionId, userId, token, expiresAt, ip, ua).run();

  return { token, expiresAt };
}

export default auth;
