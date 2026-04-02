// Points system - ALL points logic runs server-side
import { Hono } from 'hono';
import type { HonoEnv } from '../lib/types';
import { CONFIG } from '../lib/types';
import { requireAuth } from '../middleware/auth';
import { checkRateLimit, getWatchEarningsInLastHour } from '../lib/rateLimit';

const points = new Hono<HonoEnv>();

// All points routes require authentication
points.use('/*', requireAuth);

// ═══ GET BALANCE ═══
points.get('/balance', async (c) => {
  const user = c.get('user')!;
  // Always fetch fresh from DB
  const fresh = await c.env.DB.prepare(
    'SELECT points FROM users WHERE id = ?'
  ).bind(user.id).first<{ points: number }>();

  return c.json({
    points: fresh?.points || 0,
    usdValue: ((fresh?.points || 0) / CONFIG.PTS_PER_USD).toFixed(2),
  });
});

// ═══ START WATCH SESSION ═══
points.post('/watch/start', async (c) => {
  const user = c.get('user')!;
  const { videoId } = await c.req.json<{ videoId: string }>();

  if (!videoId || videoId.length > 20) {
    return c.json({ error: 'Invalid video ID' }, 400);
  }

  const db = c.env.DB;

  // Deactivate old sessions
  await db.prepare(
    `UPDATE watch_sessions SET is_active = 0 WHERE user_id = ? AND is_active = 1`
  ).bind(user.id).run();

  // Create new session
  const result = await db.prepare(
    `INSERT INTO watch_sessions (user_id, video_id) VALUES (?, ?)`
  ).bind(user.id, videoId).run();

  const sessionId = String(result.meta.last_row_id);
  return c.json({ sessionId, earnInterval: CONFIG.EARN_INTERVAL_SECS });
});

// ═══ HEARTBEAT (earn points from watching) ═══
points.post('/watch/heartbeat', async (c) => {
  const user = c.get('user')!;
  const { sessionId } = await c.req.json<{ sessionId: string }>();

  if (!sessionId) {
    return c.json({ error: 'Session ID required' }, 400);
  }

  const db = c.env.DB;

  // Rate limit heartbeats (max 3 per minute = anti-spam)
  const rl = await checkRateLimit(db, user.id, 'heartbeat', CONFIG.MAX_HEARTBEATS_PER_MIN, 1);
  if (!rl.allowed) {
    return c.json({ error: 'Too fast', earned: false, points: user.points }, 429);
  }

  // Check hourly earning limit
  const hourlyEarned = await getWatchEarningsInLastHour(db, user.id);
  if (hourlyEarned >= CONFIG.MAX_WATCH_EARN_PER_HOUR) {
    return c.json({
      error: 'Hourly watch limit reached',
      earned: false,
      points: user.points,
      hourlyLimit: CONFIG.MAX_WATCH_EARN_PER_HOUR,
      hourlyEarned,
    }, 429);
  }

  // Verify watch session exists and is active
  const session = await db.prepare(
    `SELECT * FROM watch_sessions WHERE id = ? AND user_id = ? AND is_active = 1`
  ).bind(parseInt(sessionId) || 0, user.id).first<{
    id: number; last_heartbeat: string; total_seconds: number; points_earned: number;
  }>();

  if (!session) {
    return c.json({ error: 'Invalid or expired watch session', earned: false }, 400);
  }

  // Check time since last heartbeat (must be at least EARN_INTERVAL - 5s tolerance)
  const lastBeat = new Date(session.last_heartbeat + 'Z').getTime();
  const elapsed = (Date.now() - lastBeat) / 1000;
  const minInterval = CONFIG.EARN_INTERVAL_SECS - 5; // 5s tolerance

  if (elapsed < minInterval) {
    return c.json({
      earned: false,
      points: user.points,
      waitSeconds: Math.ceil(minInterval - elapsed),
    });
  }

  // Award point — VIP users get 2x
  const isVip = user.vip_until ? new Date(user.vip_until) > new Date() : false;
  const earnAmount = isVip ? CONFIG.POINTS_PER_WATCH * 2 : CONFIG.POINTS_PER_WATCH;
  const newTotal = session.total_seconds + Math.round(elapsed);
  const newPointsEarned = session.points_earned + earnAmount;

  await db.batch([
    db.prepare('UPDATE users SET points = points + ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(earnAmount, user.id),
    db.prepare(
      `UPDATE watch_sessions SET last_heartbeat = datetime('now'), 
       total_seconds = ?, points_earned = ? WHERE id = ?`
    ).bind(newTotal, newPointsEarned, parseInt(sessionId) || 0),
    db.prepare(
      `INSERT INTO point_transactions (user_id, amount, type, description, metadata)
       VALUES (?, ?, 'watch', ?, ?)`
    ).bind(user.id, earnAmount, isVip ? 'Video watching reward (VIP 2x)' : 'Video watching reward', JSON.stringify({ sessionId: parseInt(sessionId) || 0 })),
  ]);

  // Get updated points
  const updated = await db.prepare('SELECT points FROM users WHERE id = ?')
    .bind(user.id).first<{ points: number }>();

  return c.json({
    earned: true,
    amount: earnAmount,
    points: updated?.points || user.points + earnAmount,
    totalWatchTime: newTotal,
  });
});

// ═══ CLAIM SMART OFFER ═══
points.post('/claim/smart-offer', async (c) => {
  const user = c.get('user')!;
  const db = c.env.DB;

  // Check cooldown
  const lastClaim = await db.prepare(
    `SELECT claimed_at FROM offer_claims 
     WHERE user_id = ? AND offer_type = 'smart_offer' 
     ORDER BY claimed_at DESC LIMIT 1`
  ).bind(user.id).first<{ claimed_at: string }>();

  if (lastClaim) {
    const lastTime = new Date(lastClaim.claimed_at + 'Z').getTime();
    const elapsed = (Date.now() - lastTime) / 1000;
    if (elapsed < CONFIG.SMART_OFFER_COOLDOWN_SECS) {
      return c.json({
        error: 'Cooldown active',
        cooldownLeft: Math.ceil(CONFIG.SMART_OFFER_COOLDOWN_SECS - elapsed),
      }, 429);
    }
  }

  // Rate limit (max 20 per hour)
  const rl = await checkRateLimit(db, user.id, 'smart_offer', 20, 60);
  if (!rl.allowed) {
    return c.json({ error: 'Too many claims' }, 429);
  }

  // Award points
  await db.batch([
    db.prepare('UPDATE users SET points = points + ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(CONFIG.SMART_OFFER_POINTS, user.id),
    db.prepare(
      `INSERT INTO point_transactions (user_id, amount, type, description) VALUES (?, ?, 'smart_offer', 'Smart link offer')`
    ).bind(user.id, CONFIG.SMART_OFFER_POINTS),
    db.prepare(
      `INSERT INTO offer_claims (user_id, offer_type) VALUES (?, 'smart_offer')`
    ).bind(user.id),
  ]);

  const updated = await db.prepare('SELECT points FROM users WHERE id = ?')
    .bind(user.id).first<{ points: number }>();

  return c.json({
    success: true,
    amount: CONFIG.SMART_OFFER_POINTS,
    points: updated?.points || 0,
    cooldown: CONFIG.SMART_OFFER_COOLDOWN_SECS,
  });
});

// ═══ CLAIM AD WATCH ═══
points.post('/claim/ad-watch', async (c) => {
  const user = c.get('user')!;
  const db = c.env.DB;

  // Rate limit (max 30 per hour)
  const rl = await checkRateLimit(db, user.id, 'ad_watch', 30, 60);
  if (!rl.allowed) {
    return c.json({ error: 'Too many ad claims' }, 429);
  }

  // Award points
  await db.batch([
    db.prepare('UPDATE users SET points = points + ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(CONFIG.AD_WATCH_POINTS, user.id),
    db.prepare(
      `INSERT INTO point_transactions (user_id, amount, type, description) VALUES (?, ?, 'ad_watch', 'Ad watch reward')`
    ).bind(user.id, CONFIG.AD_WATCH_POINTS),
  ]);

  const updated = await db.prepare('SELECT points FROM users WHERE id = ?')
    .bind(user.id).first<{ points: number }>();

  return c.json({
    success: true,
    amount: CONFIG.AD_WATCH_POINTS,
    points: updated?.points || 0,
  });
});

// ═══ GET TRANSACTION HISTORY ═══
points.get('/history', async (c) => {
  const user = c.get('user')!;
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);

  const txs = await c.env.DB.prepare(
    `SELECT id, amount, type, description, created_at 
     FROM point_transactions WHERE user_id = ? 
     ORDER BY created_at DESC LIMIT ?`
  ).bind(user.id, limit).all();

  return c.json({ transactions: txs.results || [] });
});

export default points;
