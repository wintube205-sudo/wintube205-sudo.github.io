// Profile routes — history, VIP
import { Hono } from 'hono';
import type { HonoEnv } from '../lib/types';
import { CONFIG } from '../lib/types';
import { requireAuth } from '../middleware/auth';
import { generateToken } from '../lib/crypto';

const profile = new Hono<HonoEnv>();

// ═══ GET FULL PROFILE ═══
profile.get('/me', requireAuth, async (c) => {
  const user = c.get('user')!;
  const db = c.env.DB;

  const full = await db.prepare(
    `SELECT uid, name, email, points, ref_code, avatar_url, auth_provider,
            email_verified, vip_until, first_withdraw_done, created_at
     FROM users WHERE id = ?`
  ).bind(user.id).first<any>();

  const isVip = full?.vip_until ? new Date(full.vip_until) > new Date() : false;

  return c.json({ user: { ...full, isVip } });
});

// ═══ POINTS HISTORY ═══
profile.get('/history', requireAuth, async (c) => {
  const user = c.get('user')!;
  const rows = await c.env.DB.prepare(
    `SELECT amount, type, description, created_at
     FROM point_transactions WHERE user_id = ?
     ORDER BY created_at DESC LIMIT 50`
  ).bind(user.id).all();
  return c.json({ history: rows.results || [] });
});

// ═══ MY WITHDRAWALS ═══
profile.get('/withdrawals', requireAuth, async (c) => {
  const user = c.get('user')!;
  const rows = await c.env.DB.prepare(
    `SELECT id, amount, usd_value, method, status, admin_note, created_at, processed_at
     FROM withdrawals WHERE user_id = ?
     ORDER BY created_at DESC LIMIT 20`
  ).bind(user.id).all();
  return c.json({ withdrawals: rows.results || [] });
});

// ═══ RESEND VERIFY EMAIL ═══
profile.post('/resend-verify', requireAuth, async (c) => {
  const user = c.get('user')!;
  const db = c.env.DB;

  const fresh = await db.prepare('SELECT email_verified, email, name FROM users WHERE id = ?')
    .bind(user.id).first<{ email_verified: number; email: string; name: string }>();

  if (!fresh || fresh.email_verified) {
    return c.json({ error: 'Already verified' }, 400);
  }

  const proto = c.req.header('x-forwarded-proto') || 'https';
  const host = c.req.header('host') || 'wintube.win';
  const baseUrl = `${proto}://${host}`;
  await sendVerifyEmail(db, user.id, fresh.email, fresh.name, c.env.RESEND_API_KEY, baseUrl);
  return c.json({ success: true });
});

// ═══ VIP REQUEST ═══
profile.post('/vip/request', requireAuth, async (c) => {
  const user = c.get('user')!;
  const db = c.env.DB;
  const { txHash } = await c.req.json<{ txHash?: string }>();

  if (!txHash || txHash.length < 10) {
    return c.json({ error: 'Transaction hash required' }, 400);
  }

  // Check no pending request
  const pending = await db.prepare(
    `SELECT id FROM vip_requests WHERE user_id = ? AND status = 'pending'`
  ).bind(user.id).first();
  if (pending) return c.json({ error: 'You already have a pending VIP request' }, 400);

  await db.prepare(
    `INSERT INTO vip_requests (user_id, tx_hash, amount_usd) VALUES (?, ?, ?)`
  ).bind(user.id, txHash.trim(), CONFIG.VIP_PRICE_USD.toString()).run();

  // Notify admin
  const resendKey = c.env.RESEND_API_KEY;
  const adminEmail = c.env.ADMIN_EMAIL;
  if (resendKey && adminEmail) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: 'WinTube <onboarding@resend.dev>',
          to: [adminEmail],
          subject: `⭐ New VIP Request`,
          html: `<h2>New VIP Request</h2><p>User ID: ${user.id}</p><p>TX Hash: <code>${txHash}</code></p><p>Login to admin panel to activate.</p>`,
        }),
      });
    } catch (_) {}
  }

  return c.json({ success: true, message: 'VIP request submitted! We will activate within 24h.' });
});

// ═══ HELPER: Send Verification Email ═══
export async function sendVerifyEmail(
  db: D1Database, userId: number, email: string, name: string, resendKey: string, baseUrl?: string
) {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db.prepare(
    `DELETE FROM email_verifications WHERE user_id = ?`
  ).bind(userId).run();

  await db.prepare(
    `INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?, ?, ?)`
  ).bind(userId, token, expiresAt).run();

  if (!resendKey) return;

  const verifyUrl = baseUrl
    ? `${baseUrl}/api/auth/verify-email?token=${token}`
    : `https://wintube.win/api/auth/verify-email?token=${token}`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify({
      from: 'WinTube <onboarding@resend.dev>',
      to: [email],
      subject: '✅ Verify your WinTube email',
      html: `
        <h2>Welcome to WinTube, ${name}!</h2>
        <p>Click the link below to verify your email and unlock withdrawals:</p>
        <p><a href="${verifyUrl}" style="background:#ef4444;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Verify Email</a></p>
        <p>This link expires in 24 hours.</p>
      `,
    }),
  }).catch(() => {});
}

export default profile;
