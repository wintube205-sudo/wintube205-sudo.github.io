// Leaderboard & Withdraw routes
import { Hono } from 'hono';
import type { HonoEnv } from '../lib/types';
import { CONFIG } from '../lib/types';
import { requireAuth } from '../middleware/auth';

const social = new Hono<HonoEnv>();

// ═══ LEADERBOARD (public) ═══
social.get('/leaderboard', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT uid, name, points, avatar_url FROM users 
     WHERE is_banned = 0 
     ORDER BY points DESC LIMIT 20`
  ).all<{ uid: string; name: string; points: number; avatar_url: string | null }>();

  return c.json({
    leaderboard: (rows.results || []).map((r, i) => ({
      rank: i + 1,
      name: r.name,
      points: r.points,
      initial: r.name.charAt(0).toUpperCase(),
    })),
  });
});

// ═══ WITHDRAW ═══
social.post('/withdraw', requireAuth, async (c) => {
  const user = c.get('user')!;
  const db = c.env.DB;

  const { amount, method, address } = await c.req.json<{
    amount?: number; method?: string; address?: string;
  }>();

  // Check email verified
  const userFull = await db.prepare('SELECT email_verified, first_withdraw_done FROM users WHERE id = ?')
    .bind(user.id).first<{ email_verified: number; first_withdraw_done: number }>();
  if (!userFull?.email_verified) {
    return c.json({ error: 'Please verify your email before withdrawing. Check your inbox.' }, 403);
  }

  // Validation
  if (!amount || !method || !address) {
    return c.json({ error: 'All fields required' }, 400);
  }
  if (typeof amount !== 'number' || amount < CONFIG.MIN_WITHDRAW || amount % 1000 !== 0) {
    return c.json({ error: `Minimum ${CONFIG.MIN_WITHDRAW} pts (=$${CONFIG.MIN_WITHDRAW/CONFIG.PTS_PER_USD}), must be multiple of 1000` }, 400);
  }
  if (address.length > 200 || method.length > 50) {
    return c.json({ error: 'Invalid input' }, 400);
  }

  const validMethods = ['USDT (TRC20)', 'USDT (ERC20)', 'Bitcoin', 'PayPal', 'Bank Transfer', 'Asiacell', 'Zain Iraq'];
  if (!validMethods.includes(method)) {
    return c.json({ error: 'Invalid payment method' }, 400);
  }

  // Check balance (fresh from DB)
  const fresh = await db.prepare('SELECT points FROM users WHERE id = ?')
    .bind(user.id).first<{ points: number }>();

  if (!fresh || fresh.points < amount) {
    return c.json({ error: 'Insufficient points' }, 400);
  }

  // Check pending withdrawals
  const pending = await db.prepare(
    `SELECT COUNT(*) as cnt FROM withdrawals WHERE user_id = ? AND status = 'pending'`
  ).bind(user.id).first<{ cnt: number }>();

  if (pending && pending.cnt >= 3) {
    return c.json({ error: 'Max 3 pending withdrawals allowed' }, 400);
  }

  const usdValue = (amount / CONFIG.PTS_PER_USD).toFixed(2);
  const isFirstWithdraw = userFull.first_withdraw_done === 0;

  // Deduct points and create withdrawal atomically
  const ops: any[] = [
    db.prepare('UPDATE users SET points = points - ?, updated_at = datetime(\'now\') WHERE id = ? AND points >= ?')
      .bind(amount, user.id, amount),
    db.prepare(
      `INSERT INTO withdrawals (user_id, amount, usd_value, method, address)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(user.id, amount, usdValue, method, address.trim()),
    db.prepare(
      `INSERT INTO point_transactions (user_id, amount, type, description)
       VALUES (?, ?, 'withdrawal', ?)`
    ).bind(user.id, -amount, `Withdrawal: $${usdValue} via ${method}`),
  ];
  if (isFirstWithdraw) {
    ops.push(db.prepare(`UPDATE users SET first_withdraw_done = 1 WHERE id = ?`).bind(user.id));
  }
  await db.batch(ops);

  const updated = await db.prepare('SELECT points FROM users WHERE id = ?')
    .bind(user.id).first<{ points: number }>();

  // Send email notification to admin
  const adminEmail = c.env.ADMIN_EMAIL;
  const resendKey = c.env.RESEND_API_KEY;
  if (adminEmail && resendKey) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: 'WinTube <onboarding@resend.dev>',
          to: [adminEmail],
          subject: `💰 New Withdrawal Request — $${usdValue}`,
          html: `
            <h2>New Withdrawal Request</h2>
            <table style="border-collapse:collapse;width:100%">
              <tr><td style="padding:8px;border:1px solid #ddd"><b>User</b></td><td style="padding:8px;border:1px solid #ddd">${user.name} (${user.email})</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd"><b>Amount</b></td><td style="padding:8px;border:1px solid #ddd">${amount} pts = $${usdValue}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd"><b>Method</b></td><td style="padding:8px;border:1px solid #ddd">${method}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd"><b>Address</b></td><td style="padding:8px;border:1px solid #ddd">${address.trim()}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd"><b>Date</b></td><td style="padding:8px;border:1px solid #ddd">${new Date().toISOString()}</td></tr>
            </table>
            <p style="margin-top:16px">Login to your admin panel to approve or reject this request.</p>
          `,
        }),
      });
    } catch (_) {}
  }

  return c.json({
    success: true,
    withdrawal: { amount, usdValue, method, status: 'pending' },
    remainingPoints: updated?.points || 0,
  });
});

// ═══ GET MY WITHDRAWALS ═══
social.get('/withdrawals', requireAuth, async (c) => {
  const user = c.get('user')!;
  const rows = await c.env.DB.prepare(
    `SELECT id, amount, usd_value, method, status, created_at, processed_at
     FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
  ).bind(user.id).all();

  return c.json({ withdrawals: rows.results || [] });
});

export default social;
