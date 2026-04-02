// Authentication middleware - server-side session validation
import { createMiddleware } from 'hono/factory';
import type { HonoEnv, SessionRow, UserRow } from '../lib/types';

// Middleware: require authenticated user
export const requireAuth = createMiddleware<HonoEnv>(async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '') ||
                getCookie(c.req.raw, 'wt_session');

  if (!token) {
    return c.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, 401);
  }

  const db = c.env.DB;
  const session = await db.prepare(
    `SELECT s.*, u.id as uid_num, u.uid, u.name, u.email, u.points, u.ref_code, 
            u.is_banned, u.auth_provider, u.avatar_url,
            u.email_verified, u.vip_until, u.first_withdraw_done
     FROM sessions s 
     JOIN users u ON s.user_id = u.id 
     WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first<SessionRow & Partial<UserRow> & { uid_num: number }>();

  if (!session) {
    return c.json({ error: 'Session expired', code: 'SESSION_EXPIRED' }, 401);
  }

  if (session.is_banned) {
    return c.json({ error: 'Account suspended', code: 'BANNED' }, 403);
  }

  // Set user data in context
  c.set('user', {
    id: session.uid_num,
    uid: session.uid!,
    name: session.name!,
    email: session.email!,
    password_hash: null,
    avatar_url: session.avatar_url || null,
    auth_provider: session.auth_provider!,
    points: session.points!,
    ref_code: session.ref_code!,
    referred_by: null,
    is_banned: session.is_banned!,
    email_verified: session.email_verified || 0,
    vip_until: session.vip_until || null,
    first_withdraw_done: session.first_withdraw_done || 0,
    created_at: '',
    updated_at: '',
  });
  c.set('userId', session.uid_num);

  await next();
});

// Middleware: optional auth (doesn't fail if not logged in)
export const optionalAuth = createMiddleware<HonoEnv>(async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '') ||
                getCookie(c.req.raw, 'wt_session');

  if (token) {
    const db = c.env.DB;
    const session = await db.prepare(
      `SELECT s.*, u.id as uid_num, u.uid, u.name, u.email, u.points, u.ref_code, 
              u.is_banned, u.auth_provider, u.avatar_url,
              u.email_verified, u.vip_until, u.first_withdraw_done
       FROM sessions s 
       JOIN users u ON s.user_id = u.id 
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    ).bind(token).first<SessionRow & Partial<UserRow> & { uid_num: number }>();

    if (session && !session.is_banned) {
      c.set('user', {
        id: session.uid_num,
        uid: session.uid!,
        name: session.name!,
        email: session.email!,
        password_hash: null,
        avatar_url: session.avatar_url || null,
        auth_provider: session.auth_provider!,
        points: session.points!,
        ref_code: session.ref_code!,
        referred_by: null,
        is_banned: 0,
        email_verified: session.email_verified || 0,
        vip_until: session.vip_until || null,
        first_withdraw_done: session.first_withdraw_done || 0,
        created_at: '',
        updated_at: '',
      });
      c.set('userId', session.uid_num);
    }
  }

  c.set('user', c.get('user') || null);
  c.set('userId', c.get('userId') || null);
  await next();
});

// Helper to read cookies from request
function getCookie(req: Request, name: string): string | null {
  const cookies = req.headers.get('Cookie') || '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
