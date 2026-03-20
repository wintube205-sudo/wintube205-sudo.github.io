// Admin panel — protected by ADMIN_SECRET header
import { Hono } from 'hono';
import type { HonoEnv } from '../lib/types';

const admin = new Hono<HonoEnv>();

// ═══ AUTH MIDDLEWARE ═══
admin.use('/*', async (c, next) => {
  const secret = c.req.header('x-admin-secret') || c.req.query('s');
  if (!secret || secret !== c.env.ADMIN_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

// ═══ DASHBOARD STATS ═══
admin.get('/stats', async (c) => {
  const db = c.env.DB;
  const [users, withdrawals, points] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as total, SUM(points) as totalPts FROM users WHERE is_banned=0`).first<{ total: number; totalPts: number }>(),
    db.prepare(`SELECT COUNT(*) as total, COUNT(CASE WHEN status='pending' THEN 1 END) as pending FROM withdrawals`).first<{ total: number; pending: number }>(),
    db.prepare(`SELECT SUM(amount) as total FROM point_transactions WHERE type='watch'`).first<{ total: number }>(),
  ]);
  return c.json({ users, withdrawals, watchPoints: points });
});

// ═══ LIST WITHDRAWALS ═══
admin.get('/withdrawals', async (c) => {
  const db = c.env.DB;
  const status = c.req.query('status') || 'pending';
  const rows = await db.prepare(
    `SELECT w.id, w.amount, w.usd_value, w.method, w.address, w.status,
            w.admin_note, w.created_at, w.processed_at,
            u.name, u.email, u.uid
     FROM withdrawals w JOIN users u ON w.user_id = u.id
     WHERE w.status = ?
     ORDER BY w.created_at DESC LIMIT 100`
  ).bind(status).all();
  return c.json({ withdrawals: rows.results || [] });
});

// ═══ APPROVE / REJECT WITHDRAWAL ═══
admin.post('/withdrawals/:id/action', async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const { action, note } = await c.req.json<{ action: 'approve' | 'reject'; note?: string }>();

  if (!['approve', 'reject'].includes(action)) {
    return c.json({ error: 'Invalid action' }, 400);
  }

  const w = await db.prepare(
    `SELECT w.*, u.points, u.id as userId FROM withdrawals w JOIN users u ON w.user_id = u.id WHERE w.id = ?`
  ).bind(id).first<{ id: number; status: string; amount: number; userId: number; points: number }>();

  if (!w) return c.json({ error: 'Not found' }, 404);
  if (w.status !== 'pending') return c.json({ error: 'Already processed' }, 400);

  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  const ops: any[] = [
    db.prepare(
      `UPDATE withdrawals SET status=?, admin_note=?, processed_at=datetime('now') WHERE id=?`
    ).bind(newStatus, note || null, id),
  ];

  // If rejected, refund points
  if (action === 'reject') {
    ops.push(
      db.prepare(`UPDATE users SET points = points + ? WHERE id = ?`).bind(w.amount, w.userId),
      db.prepare(
        `INSERT INTO point_transactions (user_id, amount, type, description) VALUES (?, ?, 'refund', 'Withdrawal rejected — refund')`
      ).bind(w.userId, w.amount)
    );
  }

  await db.batch(ops);
  return c.json({ success: true, status: newStatus });
});

// ═══ LIST USERS ═══
admin.get('/users', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT id, uid, name, email, points, auth_provider, is_banned, created_at FROM users ORDER BY created_at DESC LIMIT 200`
  ).all();
  return c.json({ users: rows.results || [] });
});

// ═══ BAN / UNBAN USER ═══
admin.post('/users/:uid/ban', async (c) => {
  const db = c.env.DB;
  const uid = c.req.param('uid');
  const { ban } = await c.req.json<{ ban: boolean }>();
  await db.prepare(`UPDATE users SET is_banned=? WHERE uid=?`).bind(ban ? 1 : 0, uid).run();
  return c.json({ success: true, banned: ban });
});

export default admin;
