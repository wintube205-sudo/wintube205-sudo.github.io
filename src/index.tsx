// WinTube - Main Application Entry
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { HonoEnv } from './lib/types';
import authRoutes from './routes/auth';
import videoRoutes from './routes/videos';
import pointsRoutes from './routes/points';
import socialRoutes from './routes/social';
import adminRoutes from './routes/admin';
import adminPanelRoute from './routes/adminPanel';
import profileRoutes from './routes/profile';

const app = new Hono<HonoEnv>();

// ═══ MIDDLEWARE ═══
app.use('*', logger());
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// ═══ AUTO-MIGRATE: ensure DB tables exist on first request ═══
let _dbReady = false;
app.use('/api/*', async (c, next) => {
  if (!_dbReady) {
    try {
      await c.env.DB.prepare('SELECT 1 FROM users LIMIT 1').first();
      _dbReady = true;
    } catch (e) {
      // Tables don't exist — create them one by one
      try {
        const tables = [
          `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT,uid TEXT UNIQUE NOT NULL,name TEXT NOT NULL DEFAULT 'User',email TEXT UNIQUE NOT NULL,password_hash TEXT,avatar_url TEXT,auth_provider TEXT NOT NULL DEFAULT 'email',points INTEGER NOT NULL DEFAULT 100,ref_code TEXT UNIQUE NOT NULL,referred_by TEXT,is_banned INTEGER NOT NULL DEFAULT 0,email_verified INTEGER NOT NULL DEFAULT 0,vip_until TEXT DEFAULT NULL,first_withdraw_done INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
          `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,token TEXT UNIQUE NOT NULL,expires_at TEXT NOT NULL,ip_address TEXT,user_agent TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
          `CREATE TABLE IF NOT EXISTS point_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,amount INTEGER NOT NULL,type TEXT NOT NULL,description TEXT,metadata TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
          `CREATE TABLE IF NOT EXISTS rate_limits (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,action TEXT NOT NULL,window_start TEXT NOT NULL DEFAULT (datetime('now')),count INTEGER NOT NULL DEFAULT 1,FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
          `CREATE TABLE IF NOT EXISTS withdrawals (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,amount INTEGER NOT NULL,usd_value TEXT NOT NULL,method TEXT NOT NULL,address TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',admin_note TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),processed_at TEXT,FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
          `CREATE TABLE IF NOT EXISTS watch_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,video_id TEXT NOT NULL,started_at TEXT NOT NULL DEFAULT (datetime('now')),last_heartbeat TEXT NOT NULL DEFAULT (datetime('now')),total_seconds INTEGER NOT NULL DEFAULT 0,points_earned INTEGER NOT NULL DEFAULT 0,is_active INTEGER NOT NULL DEFAULT 1,FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
          `CREATE TABLE IF NOT EXISTS offer_claims (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,offer_type TEXT NOT NULL,claimed_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
          `CREATE TABLE IF NOT EXISTS email_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,token TEXT UNIQUE NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
          `CREATE TABLE IF NOT EXISTS vip_requests (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,tx_hash TEXT NOT NULL,amount_usd TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL DEFAULT (datetime('now')),activated_at TEXT,FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
        ];
        await c.env.DB.batch(tables.map(sql => c.env.DB.prepare(sql)));

        const indexes = [
          `CREATE INDEX IF NOT EXISTS idx_users_uid ON users(uid)`,
          `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
          `CREATE INDEX IF NOT EXISTS idx_users_ref_code ON users(ref_code)`,
          `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`,
          `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
          `CREATE INDEX IF NOT EXISTS idx_point_tx_user ON point_transactions(user_id)`,
          `CREATE INDEX IF NOT EXISTS idx_point_tx_created ON point_transactions(created_at)`,
          `CREATE INDEX IF NOT EXISTS idx_rate_limits_user_action ON rate_limits(user_id, action)`,
          `CREATE INDEX IF NOT EXISTS idx_watch_sessions_user ON watch_sessions(user_id)`,
          `CREATE INDEX IF NOT EXISTS idx_watch_sessions_active ON watch_sessions(is_active)`,
          `CREATE INDEX IF NOT EXISTS idx_offer_claims_user ON offer_claims(user_id, offer_type)`,
          `CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id)`,
          `CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status)`,
          `CREATE INDEX IF NOT EXISTS idx_email_verif_token ON email_verifications(token)`,
          `CREATE INDEX IF NOT EXISTS idx_vip_requests_user ON vip_requests(user_id)`,
        ];
        await c.env.DB.batch(indexes.map(sql => c.env.DB.prepare(sql)));

        _dbReady = true;
        console.log('[WinTube] Database tables created automatically');
      } catch (migrateErr) {
        console.error('[WinTube] Auto-migration failed:', migrateErr);
      }
    }
  }
  await next();
});

// ═══ API ROUTES ═══
app.route('/api/auth', authRoutes);
app.route('/api/videos', videoRoutes);
app.route('/api/points', pointsRoutes);
app.route('/api', socialRoutes);
app.route('/api/admin', adminRoutes);
app.route('/admin', adminPanelRoute);
app.route('/api/profile', profileRoutes);

// ═══ API Health Check ═══
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() });
});

// ═══ MAIN PAGE ═══
app.get('/', (c) => {
  return c.html(getMainHTML());
});

// ═══ CATCH ALL — SPA fallback ═══
app.get('*', (c) => {
  return c.html(getMainHTML());
});

function getMainHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<title>WinTube — Watch & Earn</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--red:#ff2a4a;--dark:#000;--card:#111;--text:#fff;--muted:#888;--green:#22c55e;--yellow:#fbbf24;--purple:#a855f7}
html,body{height:100%;overflow:hidden;background:#000;font-family:'Inter',sans-serif;color:#fff}

/* ═══ FEED ═══ */
#feed{height:100dvh;overflow-y:scroll;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}
#feed::-webkit-scrollbar{display:none}

/* ═══ SLIDE ═══ */
.slide{height:100dvh;width:100%;scroll-snap-align:start;scroll-snap-stop:always;position:relative;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center}
.slide iframe{position:absolute;inset:0;width:100%;height:100%;border:none;pointer-events:auto}
.slide.shorts-slide iframe{width:100%;height:100%}
.slide.long-slide{background:#000}
.slide.long-slide iframe{position:absolute;top:50%;left:0;transform:translateY(-50%);width:100%;height:56.25vw}

/* ═══ OVERLAY ═══ */
.v-overlay{position:absolute;inset:0;pointer-events:none;z-index:10;background:linear-gradient(to top,rgba(0,0,0,.7) 0%,transparent 40%,transparent 70%,rgba(0,0,0,.3) 100%)}
.v-right{position:absolute;right:12px;bottom:120px;display:flex;flex-direction:column;align-items:center;gap:16px;pointer-events:all;z-index:20}
.v-action{display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer}
.v-action-btn{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.15);backdrop-filter:blur(10px);border:1.5px solid rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:1.2rem;transition:transform .15s,background .15s}
.v-action-btn:active{transform:scale(.9)}
.v-action-lbl{font-size:.62rem;color:rgba(255,255,255,.8);font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.8)}
.v-bottom{position:absolute;bottom:0;left:0;right:60px;padding:16px 16px 20px;pointer-events:all;z-index:20}
.v-title{font-size:.85rem;font-weight:700;line-height:1.4;text-shadow:0 1px 4px rgba(0,0,0,.8);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:6px}
.v-channel{font-size:.72rem;color:rgba(255,255,255,.65);text-shadow:0 1px 3px rgba(0,0,0,.7)}

/* ═══ TIMER BADGE ═══ */
.timer-badge{position:fixed;top:72px;right:12px;z-index:100;background:rgba(0,0,0,.7);border:1.5px solid rgba(255,255,255,.15);border-radius:50px;padding:4px 10px 4px 6px;display:flex;align-items:center;gap:6px;backdrop-filter:blur(10px);font-size:.72rem;font-weight:700}
.timer-ring{position:relative;width:26px;height:26px;flex-shrink:0}
.timer-ring svg{transform:rotate(-90deg)}
.ring-bg{fill:none;stroke:rgba(255,255,255,.15);stroke-width:3}
.ring-fill{fill:none;stroke-width:3;stroke-linecap:round;stroke-dasharray:75;stroke-dashoffset:0;transition:stroke-dashoffset .8s,stroke .3s;stroke:#22c55e}
.ring-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:.55rem;font-weight:800;color:#22c55e}
.pts-badge{color:var(--yellow);font-size:.72rem;font-weight:800}

/* ═══ TOPBAR ═══ */
.topbar{position:fixed;top:0;left:0;right:0;z-index:90;padding:10px 14px 28px;display:flex;align-items:center;gap:10px;background:linear-gradient(180deg,rgba(0,0,0,.85) 0%,rgba(0,0,0,.5) 55%,transparent 100%);pointer-events:none}
.topbar>*{pointer-events:all}
.logo-sm{font-size:1.2rem;font-weight:900;letter-spacing:2px;flex-shrink:0;text-shadow:0 2px 8px rgba(0,0,0,.9),0 0 20px rgba(0,0,0,.6)}
.logo-sm .w{color:var(--red)}.logo-sm .t{color:#fff}
.search-wrap{flex:1;display:flex;align-items:center;background:rgba(255,255,255,.12);border-radius:50px;backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.15);padding:0 12px;height:36px;gap:8px}
.search-wrap input{flex:1;background:transparent;border:none;outline:none;color:#fff;font-family:'Inter',sans-serif;font-size:.85rem;caret-color:var(--red)}
.search-wrap input::placeholder{color:rgba(255,255,255,.4)}
.search-wrap button{background:none;border:none;color:rgba(255,255,255,.6);cursor:pointer;font-size:.9rem;display:flex;align-items:center;padding:0}
.user-btn{width:34px;height:34px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,var(--red),#ff6b35);display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:800;cursor:pointer;border:2px solid rgba(255,255,255,.2)}

/* ═══ BOTTOM NAV ═══ */
.bottom-nav{position:fixed;bottom:0;left:0;right:0;z-index:90;display:flex;justify-content:space-around;align-items:center;padding:44px 0 max(8px,env(safe-area-inset-bottom));background:linear-gradient(0deg,rgba(0,0,0,.92) 0%,rgba(0,0,0,.6) 50%,transparent 100%)}
.nav-btn{display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;padding:4px 16px;border-radius:8px;transition:opacity .15s}
.nav-btn:active{opacity:.7}
.nav-icon{font-size:1.3rem;filter:drop-shadow(0 1px 6px rgba(0,0,0,.95)) drop-shadow(0 0 3px rgba(0,0,0,.8))}
.nav-lbl{font-size:.58rem;color:rgba(255,255,255,.7);font-weight:600;text-shadow:0 1px 5px rgba(0,0,0,1),0 0 10px rgba(0,0,0,.9)}
.nav-btn.active .nav-lbl{color:#fff;text-shadow:0 1px 5px rgba(0,0,0,1),0 0 10px rgba(0,0,0,.9)}
.nav-btn.active .nav-icon{filter:drop-shadow(0 0 8px rgba(255,255,255,.7)) drop-shadow(0 1px 6px rgba(0,0,0,.95))}

/* ═══ SKELETON ═══ */
.skeleton-slide{height:100dvh;background:#111;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px}
.sk-spinner{width:40px;height:40px;border:3px solid rgba(255,255,255,.1);border-top-color:var(--red);border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* ═══ AUTH ═══ */
.auth-ov{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.95);backdrop-filter:blur(20px);display:flex;align-items:flex-end;justify-content:center}
.auth-ov.hidden{display:none}
.auth-sheet{background:#111;border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:24px 20px 36px;border-top:1px solid rgba(255,255,255,.08)}
.auth-logo{text-align:center;font-size:2rem;font-weight:900;letter-spacing:3px;margin-bottom:6px}
.auth-logo .w{color:var(--red)}.auth-logo .t{color:#fff}
.auth-sub{text-align:center;font-size:.8rem;color:var(--muted);margin-bottom:20px}
.bonus-chip{display:inline-flex;align-items:center;gap:6px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.25);border-radius:50px;padding:5px 14px;font-size:.78rem;color:var(--yellow);margin-bottom:18px;width:100%;justify-content:center}
.inp{width:100%;background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.1);color:#fff;padding:12px 14px;border-radius:12px;font-family:'Inter',sans-serif;font-size:max(.88rem,16px);outline:none;margin-bottom:10px;transition:border-color .2s}
.inp:focus{border-color:var(--red)}
.inp::placeholder{color:var(--muted)}
.tabs{display:flex;gap:8px;margin-bottom:14px}
.tab-btn{flex:1;padding:9px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:var(--muted);border-radius:10px;cursor:pointer;font-family:'Inter',sans-serif;font-size:.82rem;transition:all .2s}
.tab-btn.active{background:var(--red);border-color:var(--red);color:#fff;font-weight:700}
.submit-btn{width:100%;background:var(--red);border:none;color:#fff;padding:13px;border-radius:12px;font-family:'Inter',sans-serif;font-size:.95rem;font-weight:700;cursor:pointer;transition:opacity .15s}
.submit-btn:active{opacity:.85}
.submit-btn:disabled{opacity:.45;cursor:not-allowed}
.err{color:#ff6b6b;font-size:.78rem;margin-top:8px;text-align:center;min-height:1em}
.google-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#222;border:none;padding:11px 14px;border-radius:12px;font-family:'Inter',sans-serif;font-size:.9rem;font-weight:700;cursor:pointer;margin-bottom:10px;transition:opacity .15s}
.google-btn:active{opacity:.85}
.google-btn svg{width:20px;height:20px;flex-shrink:0}
.auth-divider{display:flex;align-items:center;gap:8px;margin:10px 0;color:rgba(255,255,255,.25);font-size:.72rem}
.auth-divider::before,.auth-divider::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.1)}

/* ═══ MODALS ═══ */
.modal-bg{position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.85);backdrop-filter:blur(16px);display:none;align-items:flex-end;justify-content:center}
.modal-bg.open{display:flex}
.modal-sheet{background:#0a0a0a;border-radius:24px 24px 0 0;width:100%;max-width:480px;padding:20px 18px 36px;border-top:1px solid rgba(255,255,255,.08);max-height:90dvh;overflow-y:auto}
.modal-handle{width:36px;height:4px;background:rgba(255,255,255,.2);border-radius:2px;margin:0 auto 16px}

/* ═══ EARN MODAL ═══ */
.earn-bal{background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.18);border-radius:14px;padding:14px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center}
.earn-offer{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:12px 14px;margin-bottom:10px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:background .15s}
.earn-offer:active{background:rgba(255,255,255,.08)}
.eo-icon{width:42px;height:42px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0}
.eo-info{flex:1}
.eo-name{font-size:.85rem;font-weight:700;margin-bottom:2px}
.eo-desc{font-size:.68rem;color:var(--muted);line-height:1.4}
.eo-pts{font-size:1.1rem;font-weight:900;flex-shrink:0}
.eo-bar{height:3px;background:rgba(255,255,255,.06);margin-top:10px;border-radius:2px}
.eo-fill{height:100%;background:linear-gradient(90deg,#6d28d9,#a855f7);border-radius:2px;transition:width .4s linear}

/* ═══ WITHDRAW ═══ */
.w-lbl{font-size:.75rem;color:var(--muted);margin-bottom:6px;display:block}
.w-inp,.w-sel{width:100%;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);color:#fff;padding:11px 13px;border-radius:11px;font-family:'Inter',sans-serif;font-size:.85rem;outline:none;margin-bottom:12px;display:block;transition:border-color .2s}
.w-inp:focus,.w-sel:focus{border-color:var(--yellow)}
.w-sel option{background:#111}
.w-submit{width:100%;background:linear-gradient(135deg,#f59e0b,#d97706);border:none;color:#fff;padding:13px;border-radius:12px;font-family:'Inter',sans-serif;font-size:.9rem;font-weight:700;cursor:pointer}
.w-submit:disabled{opacity:.45;cursor:not-allowed}
.w-btn{width:100%;background:linear-gradient(135deg,#f59e0b,#d97706);border:none;color:#fff;padding:12px;border-radius:12px;font-family:'Inter',sans-serif;font-size:.9rem;font-weight:700;cursor:pointer;margin-top:6px}

/* ═══ LEADERBOARD ═══ */
.lb-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.lb-rank{width:28px;text-align:center;font-size:.82rem;font-weight:800;flex-shrink:0}
.lb-av{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--red),#ff6b35);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.8rem;flex-shrink:0}
.lb-name{flex:1;font-size:.82rem;font-weight:600}
.lb-pts{font-size:.8rem;font-weight:800;color:var(--yellow)}

/* ═══ TOAST ═══ */
.toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(10px);background:rgba(15,15,15,.95);color:#fff;border:1px solid rgba(255,255,255,.12);padding:8px 18px;border-radius:50px;font-size:.8rem;font-weight:700;z-index:9999;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;white-space:nowrap}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

/* ═══ SECURITY BADGE ═══ */
.sec-badge{position:fixed;top:72px;left:12px;z-index:100;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.25);border-radius:50px;padding:3px 10px;font-size:.6rem;color:var(--green);font-weight:700;display:flex;align-items:center;gap:4px}

@media(min-width:600px){
  .slide.shorts-slide iframe{width:56.25vh;height:100%;left:50%;transform:translateX(-50%)}
}

/* ═══ VIP ═══ */
.vip-badge{display:inline-flex;align-items:center;gap:5px;background:linear-gradient(135deg,rgba(168,85,247,.25),rgba(236,72,153,.2));border:1px solid rgba(168,85,247,.4);border-radius:50px;padding:3px 10px;font-size:.68rem;font-weight:800;color:#c084fc}
.vip-card{background:linear-gradient(135deg,rgba(88,28,135,.5),rgba(168,85,247,.2));border:1px solid rgba(168,85,247,.35);border-radius:14px;padding:14px;margin-bottom:10px}
.vip-btn{background:linear-gradient(135deg,#7c3aed,#a855f7);border:none;color:#fff;padding:10px 16px;border-radius:10px;font-size:.82rem;font-weight:800;cursor:pointer;width:100%;margin-top:8px}
.vip-inp{width:100%;background:rgba(255,255,255,.06);border:1.5px solid rgba(168,85,247,.3);color:#fff;padding:9px 12px;border-radius:9px;font-size:.78rem;outline:none;margin-top:6px;font-family:monospace}
.vip-inp:focus{border-color:#a855f7}

/* ═══ INTERSTITIAL ═══ */
.interstitial-bg{position:fixed;inset:0;z-index:9500;background:#000;display:none;flex-direction:column;align-items:center;justify-content:center}
.interstitial-bg.open{display:flex}
.interstitial-skip{position:absolute;top:20px;right:16px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);color:#fff;padding:6px 14px;border-radius:50px;font-size:.78rem;cursor:pointer;display:flex;align-items:center;gap:6px}
.interstitial-ad{width:100%;max-width:480px;min-height:280px;display:flex;align-items:center;justify-content:center;background:#111;border-radius:12px;overflow:hidden}

/* ═══ PROFILE ═══ */
.tx-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.tx-icon{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:.9rem;flex-shrink:0}
.tx-info{flex:1}
.tx-desc{font-size:.78rem;font-weight:600}
.tx-date{font-size:.63rem;color:var(--muted);margin-top:1px}
.tx-amt{font-size:.85rem;font-weight:800}
.verify-banner{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px;font-size:.78rem}

/* ═══ OFFERS ═══ */
.offers-frame{width:100%;min-height:400px;border:none;border-radius:12px;background:#111}
.captcha-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.captcha-q{flex:1;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.1);color:#fff;padding:10px 14px;border-radius:12px;font-size:.85rem;font-weight:700;text-align:center}
.captcha-inp{width:80px;background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.1);color:#fff;padding:10px 12px;border-radius:12px;font-size:.9rem;text-align:center;outline:none}
.captcha-inp:focus{border-color:var(--red)}
</style>
</head>
<body>

<!-- AUTH OVERLAY -->
<div class="auth-ov hidden" id="authOv">
  <div class="auth-sheet">
    <div class="auth-logo"><span class="w">WIN</span><span class="t">TUBE</span></div>
    <div class="auth-sub">Watch & Earn real rewards</div>
    <div class="bonus-chip">&#127873; Get <strong style="margin:0 3px;">100 pts</strong> on sign-up</div>
    <a class="google-btn" href="/api/auth/google">
      <svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.2H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 2.9l5.7-5.7C34.5 6.5 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.8z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.9C14.7 16 19 13 24 13c3.1 0 5.8 1.1 7.9 2.9l5.7-5.7C34.5 6.5 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.4-5.1l-6.2-5.2C29.2 35.5 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8H6.1C9.5 35.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.2H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.7l6.2 5.2C37 37.3 44 32 44 24c0-1.3-.1-2.6-.4-3.8z"/></svg>
      Continue with Google
    </a>
    <div class="auth-divider">or</div>
    <div class="tabs">
      <button class="tab-btn active" id="tabL" onclick="WT.switchTab('login')">Sign In</button>
      <button class="tab-btn" id="tabR" onclick="WT.switchTab('register')">Sign Up</button>
    </div>
    <div id="fLogin">
      <input class="inp" id="lEmail" type="email" placeholder="Email" autocomplete="email">
      <input class="inp" id="lPass" type="password" placeholder="Password" autocomplete="current-password">
      <button class="submit-btn" id="loginBtn" onclick="WT.doLogin()">Sign In &#8594;</button>
    </div>
    <div id="fRegister" style="display:none">
      <input class="inp" id="rName" type="text" placeholder="Name">
      <input class="inp" id="rEmail" type="email" placeholder="Email" autocomplete="email">
      <input class="inp" id="rPass" type="password" placeholder="Password (min 6)" autocomplete="new-password">
      <input class="inp" id="rRef" type="text" placeholder="Referral code (optional)">
      <div class="captcha-row">
        <div class="captcha-q" id="captchaQ">? + ? = ?</div>
        <input class="captcha-inp" id="captchaAns" type="number" placeholder="=?" autocomplete="off">
      </div>
      <button class="submit-btn" id="regBtn" onclick="WT.doRegister()">Create Account &#8594;</button>
    </div>
    <div class="err" id="authErr"></div>
    <button onclick="WT.closeAuth()" style="width:100%;background:none;border:none;color:var(--muted);padding:12px;font-size:.82rem;cursor:pointer;margin-top:8px;">Maybe later</button>
  </div>
</div>

<!-- TOPBAR -->
<div class="topbar">
  <div class="logo-sm"><span class="w">WIN</span><span class="t">TUBE</span></div>
  <div class="search-wrap">
    <input type="text" id="searchInp" placeholder="Search videos..." onkeydown="if(event.key==='Enter')WT.doSearch()">
    <button onclick="WT.doSearch()">&#128269;</button>
    <button onclick="WT.clearSearch()" id="clearBtn" style="display:none">&#10005;</button>
  </div>
  <div class="user-btn" id="userBtn" onclick="WT.onUserClick()">?</div>
</div>

<!-- TIMER -->
<div class="timer-badge" id="timerBadge">
  <div class="timer-ring">
    <svg viewBox="0 0 26 26" width="26" height="26">
      <circle class="ring-bg" cx="13" cy="13" r="11"/>
      <circle class="ring-fill" id="ringFill" cx="13" cy="13" r="11"/>
    </svg>
    <div class="ring-num" id="ringNum">60</div>
  </div>
  <span class="pts-badge" id="ptsBadge">0 pts &#11088;</span>
</div>

<!-- SECURITY BADGE -->
<div class="sec-badge">&#128274; Secure</div>

<!-- FEED -->
<div id="feed">
  <div class="skeleton-slide"><div class="sk-spinner"></div><div style="color:var(--muted);font-size:.8rem;">Loading...</div></div>
</div>

<!-- BOTTOM NAV -->
<div class="bottom-nav">
  <div class="nav-btn active" id="navHome" onclick="WT.navTo('home')">
    <div class="nav-icon">&#127968;</div><div class="nav-lbl">Home</div>
  </div>
  <div class="nav-btn" id="navEarn" onclick="WT.openEarn()">
    <div class="nav-icon">&#128142;</div><div class="nav-lbl">Earn</div>
  </div>
  <div class="nav-btn" id="navLB" onclick="WT.openLB()">
    <div class="nav-icon">&#127942;</div><div class="nav-lbl">Top</div>
  </div>
  <div class="nav-btn" id="navW" onclick="WT.openWithdraw()" style="display:none">
    <div class="nav-icon">&#128176;</div><div class="nav-lbl">Cash Out</div>
  </div>
  <div class="nav-btn" id="navP" onclick="WT.openProfile()" style="display:none">
    <div class="nav-icon">&#128100;</div><div class="nav-lbl">Profile</div>
  </div>
</div>

<!-- EARN MODAL -->
<div class="modal-bg" id="earnModal" onclick="if(event.target===this)WT.closeEarn()">
  <div class="modal-sheet">
    <div class="modal-handle"></div>
    <div style="font-size:1rem;font-weight:800;margin-bottom:12px">&#128142; Earn Points</div>
    <div class="earn-bal">
      <div>
        <div style="font-size:.72rem;color:var(--muted)">Your Balance</div>
        <div style="font-size:1.4rem;font-weight:900;color:var(--yellow)" id="earnBalNum">0</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:.72rem;color:var(--muted)">USD Value</div>
        <div style="font-size:1.1rem;font-weight:700;color:var(--green)" id="earnUsd">$0.00</div>
      </div>
    </div>
    <div class="earn-offer" onclick="WT.claimSmartOffer()" id="smartOfferCard">
      <div class="eo-icon" style="background:linear-gradient(135deg,#4c1d95,#7c3aed)">&#127873;</div>
      <div class="eo-info">
        <div class="eo-name" id="smartOfferName">Smart Link &#8212; Earn 50 pts</div>
        <div class="eo-desc">Complete offer &#8594; Get points instantly &#10024;</div>
        <div class="eo-bar"><div class="eo-fill" id="smartFill" style="width:100%"></div></div>
      </div>
      <div class="eo-pts" style="color:var(--purple)">+50</div>
    </div>
    <div class="earn-offer" onclick="WT.claimAdWatch()">
      <div class="eo-icon" style="background:linear-gradient(135deg,#92400e,#f59e0b)">&#128250;</div>
      <div class="eo-info">
        <div class="eo-name">Watch Ad &#8212; 20 pts</div>
        <div class="eo-desc">Watch ad for 30s &#8212; limited per hour</div>
      </div>
      <div class="eo-pts" style="color:var(--yellow)">+20</div>
    </div>
    <div class="earn-offer" onclick="WT.openOffers()">
      <div class="eo-icon" style="background:linear-gradient(135deg,#064e3b,#10b981)">&#127381;</div>
      <div class="eo-info">
        <div class="eo-name">Complete Offers &#8212; up to 500 pts</div>
        <div class="eo-desc">Install apps, surveys & more &#8212; earn big!</div>
      </div>
      <div class="eo-pts" style="color:#10b981">+500</div>
    </div>
    <div class="earn-offer" style="cursor:default">
      <div class="eo-icon" style="background:linear-gradient(135deg,#1e3a5f,#2563eb)">&#9654;</div>
      <div class="eo-info">
        <div class="eo-name">Watch Videos <span id="vipWatchBadge" style="display:none" class="vip-badge">&#11088; VIP 2x</span></div>
        <div class="eo-desc">Every 60s = 1 pt (VIP = 2 pts)</div>
      </div>
      <div class="eo-pts" style="color:#60a5fa" id="watchPtsBadge">+1</div>
    </div>

    <!-- VIP SECTION -->
    <div class="vip-card" id="vipCard">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:.85rem;font-weight:800">&#11088; VIP Membership</div>
        <span class="vip-badge" id="vipStatusBadge">Not Active</span>
      </div>
      <div style="font-size:.72rem;color:#c084fc;margin-bottom:10px">
        2x points from watching &bull; Pay <strong>$5</strong> via any method below to activate 30 days
      </div>
      <div id="vipWallet" style="background:rgba(0,0,0,.3);border-radius:8px;padding:8px 10px;font-size:.68rem;font-family:monospace;color:#a78bfa;word-break:break-all;margin-bottom:6px;cursor:pointer" onclick="WT.copyVipAddr()">
        &#128142; USDT TRC20: <span id="vipAddr">TQovQSgQmL6YD9SCDWiMxqhPWC6VkTnVbv</span>
      </div>
      <div style="background:rgba(0,0,0,.3);border-radius:8px;padding:8px 10px;font-size:.68rem;font-family:monospace;color:#f9a8d4;word-break:break-all;margin-bottom:6px;cursor:pointer" onclick="WT.copyVipCard()">
        &#128179; Visa/Mastercard: <span id="vipCardNum">5759527202</span>
      </div>
      <div id="vipForm" style="display:none">
        <input class="vip-inp" id="vipTxHash" placeholder="Paste TxHash or card payment reference...">
        <button class="vip-btn" onclick="WT.submitVipRequest()">&#11088; Submit VIP Request</button>
      </div>
      <div id="vipActive" style="display:none;color:#22c55e;font-size:.78rem;font-weight:700;text-align:center;padding:8px">&#9989; VIP Active until: <span id="vipExpiry"></span></div>
      <button id="vipPayBtn" class="vip-btn" onclick="WT.showVipForm()" style="background:linear-gradient(135deg,#1d4ed8,#3b82f6)">I paid — Submit TX Hash</button>
    </div>

    <div style="margin-top:8px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06)">
      <div style="font-size:.7rem;color:var(--muted);margin-bottom:8px">Referral link</div>
      <div style="display:flex;gap:8px">
        <input id="refInp" readonly style="flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#888;padding:8px 10px;border-radius:9px;font-size:.7rem;direction:ltr;outline:none">
        <button onclick="WT.copyRef()" style="background:var(--green);border:none;color:#fff;padding:8px 14px;border-radius:9px;font-size:.75rem;font-weight:700;cursor:pointer">Copy</button>
      </div>
    </div>
    <button class="w-btn" onclick="WT.closeEarn();WT.openWithdraw()">&#128176; Withdraw Earnings</button>
  </div>
</div>

<!-- LEADERBOARD MODAL -->
<div class="modal-bg" id="lbModal" onclick="if(event.target===this)WT.closeLB()">
  <div class="modal-sheet" style="max-height:80dvh;display:flex;flex-direction:column">
    <div class="modal-handle"></div>
    <div style="font-size:1rem;font-weight:800;margin-bottom:14px;text-align:center">&#127942; Leaderboard</div>
    <div style="flex:1;overflow-y:auto" id="lbBody"><div style="text-align:center;color:var(--muted);padding:2rem">Loading...</div></div>
  </div>
</div>

<!-- WITHDRAW MODAL -->
<div class="modal-bg" id="wModal" onclick="if(event.target===this)WT.closeWithdraw()">
  <div class="modal-sheet">
    <div class="modal-handle"></div>
    <div style="font-size:1rem;font-weight:800;margin-bottom:14px">&#128176; Withdraw</div>
    <div id="wVerifyBanner" class="verify-banner" style="display:none">
      &#9888; Verify your email to withdraw.
      <button onclick="WT.resendVerify()" style="margin-left:auto;background:#ef4444;border:none;color:#fff;padding:4px 10px;border-radius:6px;font-size:.72rem;cursor:pointer;white-space:nowrap">Resend</button>
    </div>
    <div class="earn-bal" style="margin-bottom:14px">
      <div><div style="font-size:.72rem;color:var(--muted)">Balance</div><div style="font-size:1.2rem;font-weight:800;color:var(--yellow)" id="wBal">0</div></div>
      <div style="text-align:right"><div style="font-size:.72rem;color:var(--muted)">= USD</div><div style="font-size:1rem;font-weight:700;color:var(--green)" id="wUsdVal">$0.00</div></div>
    </div>
    <label class="w-lbl">Payment Method</label>
    <select class="w-sel" id="wMethod">
      <option value="">-- Select --</option>
      <optgroup label="&#128142; Crypto"><option value="USDT (TRC20)">USDT TRC20</option><option value="USDT (ERC20)">USDT ERC20</option><option value="Bitcoin">Bitcoin</option></optgroup>
      <optgroup label="&#127974; Bank"><option value="PayPal">PayPal</option><option value="Bank Transfer">Bank Transfer</option></optgroup>
      <optgroup label="&#128241; Mobile"><option value="Asiacell">Asiacell</option><option value="Zain Iraq">Zain Iraq</option></optgroup>
    </select>
    <label class="w-lbl">Amount (pts, min 50,000 = $50)</label>
    <input class="w-inp" type="number" id="wAmt" placeholder="e.g. 50000" min="50000" step="1000" oninput="WT.calcWithdraw()">
    <div style="font-size:.75rem;color:var(--yellow);margin-bottom:10px" id="wCalc"></div>
    <label class="w-lbl">Address / Account</label>
    <input class="w-inp" type="text" id="wAddr" placeholder="Enter your address">
    <button class="w-submit" onclick="WT.submitWithdraw()">Submit Request &#8594;</button>
    <div class="err" id="wErr"></div>
    <div id="wOK" style="display:none;text-align:center;padding:16px"><div style="font-size:2rem">&#9989;</div><div style="font-weight:700;margin-top:6px">Request submitted!</div><div style="font-size:.78rem;color:var(--muted);margin-top:4px">We process within 1-3 business days</div></div>
  </div>
</div>

<!-- PROFILE MODAL -->
<div class="modal-bg" id="profileModal" onclick="if(event.target===this)WT.closeProfile()">
  <div class="modal-sheet" style="max-height:90dvh;display:flex;flex-direction:column">
    <div class="modal-handle"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-size:1rem;font-weight:800">&#128100; My Profile</div>
      <button onclick="WT.logout()" style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);color:#ef4444;padding:5px 12px;border-radius:8px;font-size:.72rem;cursor:pointer">Logout</button>
    </div>
    <div id="profileHead" style="margin-bottom:14px"></div>
    <div style="display:flex;gap:6px;margin-bottom:12px">
      <button id="pTabH" onclick="WT.showPTab('history')" style="flex:1;padding:7px;background:#222;border:none;color:#fff;border-radius:8px;cursor:pointer;font-size:.78rem;font-weight:700">Points History</button>
      <button id="pTabW" onclick="WT.showPTab('withdrawals')" style="flex:1;padding:7px;background:#1a1a1a;border:none;color:#888;border-radius:8px;cursor:pointer;font-size:.78rem">Withdrawals</button>
    </div>
    <div style="flex:1;overflow-y:auto" id="profileBody">
      <div style="text-align:center;color:var(--muted);padding:2rem">Loading...</div>
    </div>
  </div>
</div>

<!-- OFFERS MODAL -->
<div class="modal-bg" id="offersModal" onclick="if(event.target===this)WT.closeOffers()">
  <div class="modal-sheet" style="max-height:92dvh;padding-bottom:20px">
    <div class="modal-handle"></div>
    <div style="font-size:1rem;font-weight:800;margin-bottom:12px">&#127381; Complete Offers</div>
    <div style="font-size:.75rem;color:var(--muted);margin-bottom:12px">Complete tasks and earn up to 500 pts per offer!</div>
    <div id="offersContent" style="min-height:380px;display:flex;align-items:center;justify-content:center;background:#111;border-radius:12px;color:var(--muted);font-size:.82rem;text-align:center;padding:20px">
      &#128738; Offers wall loading...<br><small style="font-size:.68rem;margin-top:8px;display:block">Configure CPAlead publisher ID in admin panel</small>
    </div>
  </div>
</div>

<!-- INTERSTITIAL AD -->
<div class="interstitial-bg" id="interstitialBg">
  <div class="interstitial-skip" id="interstitialSkip" onclick="WT.closeInterstitial()" style="pointer-events:none;opacity:.4">
    <span id="interstitialCount">5</span> Skip &#8594;
  </div>
  <div style="text-align:center;margin-bottom:10px;font-size:.7rem;color:rgba(255,255,255,.35);letter-spacing:.05em">ADVERTISEMENT</div>
  <div class="interstitial-ad" id="interstitialAd">
    <video id="vastVideo" style="width:100%;max-height:62vh;background:#000;display:none" playsinline></video>
    <div id="vastLoading" style="text-align:center;color:#555;font-size:.85rem;padding:32px">
      <div style="font-size:2rem;margin-bottom:8px">&#128250;</div>
      Loading ad...
    </div>
  </div>
</div>

<!-- TOAST -->
<div class="toast" id="toast"></div>

<script>
// ═══════════════════════════════════════════════
// WinTube v2.0 — Secure Client
// All sensitive logic runs on the server
// ═══════════════════════════════════════════════
(function(){
'use strict';

const API = '/api';
const EARN_INTERVAL = 60;
const CIRC = 69;
const VIP_WALLET = 'TQovQSgQmL6YD9SCDWiMxqhPWC6VkTnVbv';
const VIP_CARD = '5759527202';

// ═══ STATE ═══
let _token = localStorage.getItem('wt_token') || '';
let _user = null;
let _points = 0;
let _isVip = false;
let _emailVerified = false;
let _timerSecs = EARN_INTERVAL;
let _timerInt = null;
let _playing = false;
let _watchSessionId = null;
let _activeSlide = null;
let _feedToken = '';
let _isSearch = false;
let _loading = false;
let _hlCoolLeft = 0;
let _hlCoolTimer = null;
let _videoCount = 0;
let _interstitialTimer = null;
let _captchaA = 0;
let _captchaB = 0;
let _pTab = 'history';

const $ = (id) => document.getElementById(id);

// ═══ SECURE API CALLS ═══
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (_token) headers['Authorization'] = 'Bearer ' + _token;
  
  try {
    const res = await fetch(API + path, { ...opts, headers });
    const data = await res.json();
    
    if (res.status === 401 && data.code === 'SESSION_EXPIRED') {
      logout();
      return { error: 'Session expired, please login again' };
    }
    
    if (!res.ok) {
      return { error: data.error || 'Request failed', status: res.status };
    }
    return data;
  } catch (e) {
    console.error('API Error:', e);
    return { error: 'Network error' };
  }
}

// ═══ AUTH ═══
function genCaptcha() {
  _captchaA = Math.floor(Math.random() * 9) + 1;
  _captchaB = Math.floor(Math.random() * 9) + 1;
  const q = $('captchaQ');
  if (q) q.textContent = _captchaA + ' + ' + _captchaB + ' = ?';
  const a = $('captchaAns');
  if (a) a.value = '';
}

function switchTab(tab) {
  $('fLogin').style.display = tab === 'login' ? '' : 'none';
  $('fRegister').style.display = tab === 'register' ? '' : 'none';
  $('tabL').classList.toggle('active', tab === 'login');
  $('tabR').classList.toggle('active', tab === 'register');
  $('authErr').textContent = '';
  if (tab === 'register') genCaptcha();
}

async function doLogin() {
  const email = $('lEmail').value.trim();
  const password = $('lPass').value;
  if (!email || !password) { $('authErr').textContent = 'Fill all fields'; return; }
  
  $('loginBtn').disabled = true;
  $('loginBtn').textContent = 'Signing in...';
  
  const data = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  
  $('loginBtn').disabled = false;
  $('loginBtn').textContent = 'Sign In \\u2192';
  
  if (data.error) { $('authErr').textContent = data.error; return; }
  
  _token = data.token;
  _user = data.user;
  _points = data.user.points;
  localStorage.setItem('wt_token', _token);
  $('authOv').classList.add('hidden');
  updateUI();
  showToast('Welcome back! \\u2728');
}

async function doRegister() {
  const name = $('rName').value.trim();
  const email = $('rEmail').value.trim();
  const password = $('rPass').value;
  const referralCode = $('rRef').value.trim();
  const captchaAns = parseInt($('captchaAns')?.value || '0');
  if (!name || !email || !password) { $('authErr').textContent = 'Fill all fields'; return; }
  if (password.length < 6) { $('authErr').textContent = 'Password min 6 chars'; return; }
  if (captchaAns !== _captchaA + _captchaB) { $('authErr').textContent = 'Wrong answer, try again'; genCaptcha(); return; }
  
  $('regBtn').disabled = true;
  $('regBtn').textContent = 'Creating...';
  
  const data = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, referralCode: referralCode || undefined })
  });
  
  $('regBtn').disabled = false;
  $('regBtn').textContent = 'Create Account \\u2192';
  
  if (data.error) { $('authErr').textContent = data.error; return; }
  
  _token = data.token;
  _user = data.user;
  _points = data.user.points;
  localStorage.setItem('wt_token', _token);
  $('authOv').classList.add('hidden');
  updateUI();
  showToast('+100 pts welcome bonus! \\u2728');
}

function logout() {
  api('/auth/logout', { method: 'POST' });
  _token = '';
  _user = null;
  _points = 0;
  _watchSessionId = null;
  localStorage.removeItem('wt_token');
  stopTimer();
  updateUI();
}

function closeAuth() { $('authOv').classList.add('hidden'); }

async function checkSession() {
  if (!_token) return;
  const data = await api('/auth/me');
  if (data.user) {
    _user = data.user;
    _points = data.user.points;
    _isVip = !!data.user.isVip;
    _emailVerified = !!data.user.email_verified;
    updateUI();
  } else {
    logout();
  }
}

// ═══ UI UPDATE ═══
function updateUI() {
  const ub = $('userBtn');
  if (_user) {
    ub.textContent = _user.name.charAt(0).toUpperCase();
    ub.style.background = _isVip
      ? 'linear-gradient(135deg,#7c3aed,#a855f7)'
      : 'linear-gradient(135deg,#e63946,#ff6b35)';
    ['navW','navP'].forEach(id => { const n = $(id); if(n) n.style.display = ''; });
  } else {
    ub.textContent = '?';
    ub.style.background = 'rgba(255,255,255,.15)';
    ['navW','navP'].forEach(id => { const n = $(id); if(n) n.style.display = 'none'; });
  }
  const pb = $('ptsBadge'); if(pb) pb.textContent = _points.toLocaleString() + ' pts \\u2B50';
  const eb = $('earnBalNum'); if(eb) eb.textContent = _points.toLocaleString();
  const eu = $('earnUsd'); if(eu) eu.textContent = '$' + (_points / 1000).toFixed(2);
  const wb = $('wBal'); if(wb) wb.textContent = _points.toLocaleString();
  const wu = $('wUsdVal'); if(wu) wu.textContent = '$' + (_points / 1000).toFixed(2);
  const ri = $('refInp');
  if(ri && _user) ri.value = location.origin + '/?ref=' + (_user.refCode || '');

  // VIP badge in earn modal
  const vipBadge = $('vipWatchBadge');
  const watchBadge = $('watchPtsBadge');
  if (vipBadge) vipBadge.style.display = _isVip ? '' : 'none';
  if (watchBadge) watchBadge.textContent = _isVip ? '+2' : '+1';

  // VIP card state
  const vipActive = $('vipActive');
  const vipForm = $('vipForm');
  const vipPayBtn = $('vipPayBtn');
  const vipStatusBadge = $('vipStatusBadge');
  const vipAddr = $('vipAddr');
  if (vipAddr) vipAddr.textContent = VIP_WALLET;
  const vipCard = $('vipCardNum'); if (vipCard) vipCard.textContent = VIP_CARD;
  if (_isVip && _user) {
    if(vipActive) { vipActive.style.display = ''; const exp = $('vipExpiry'); if(exp) exp.textContent = (_user.vip_until||'').slice(0,10); }
    if(vipForm) vipForm.style.display = 'none';
    if(vipPayBtn) vipPayBtn.style.display = 'none';
    if(vipStatusBadge) { vipStatusBadge.textContent = '\\u2B50 Active'; vipStatusBadge.style.color = '#22c55e'; }
  } else {
    if(vipActive) vipActive.style.display = 'none';
    if(vipPayBtn) vipPayBtn.style.display = '';
    if(vipStatusBadge) { vipStatusBadge.textContent = 'Not Active'; vipStatusBadge.style.color = ''; }
  }

  // Verify email banner in withdraw
  const wVerify = $('wVerifyBanner');
  if (wVerify) wVerify.style.display = (_user && !_emailVerified) ? '' : 'none';
}

function onUserClick() {
  if (_user) openEarn();
  else $('authOv').classList.remove('hidden');
}

// ═══ FEED ═══
async function loadFeed(pageToken) {
  if (_loading) return;
  _loading = true;
  
  const data = await api('/videos/feed' + (pageToken ? '?pageToken=' + pageToken : ''));
  _loading = false;
  
  if (data.error) { showFeedError(data.error); return; }
  _feedToken = data.nextPageToken || '';
  appendSlides(data.items || [], true);
}

async function doSearch() {
  const q = ($('searchInp').value || '').trim();
  if (!q) return;
  
  _isSearch = true;
  $('clearBtn').style.display = '';
  $('feed').innerHTML = '<div class="skeleton-slide"><div class="sk-spinner"></div><div style="color:var(--muted);font-size:.8rem">Searching...</div></div>';
  
  const data = await api('/videos/search?q=' + encodeURIComponent(q));
  if (data.error || !data.items?.length) { showFeedError('No results for "' + q + '"'); return; }
  _feedToken = data.nextPageToken || '';
  appendSlides(data.items, false);
}

function clearSearch() {
  _isSearch = false;
  $('searchInp').value = '';
  $('clearBtn').style.display = 'none';
  $('feed').innerHTML = '<div class="skeleton-slide"><div class="sk-spinner"></div></div>';
  _feedToken = '';
  _loading = false;
  loadFeed();
}

function appendSlides(items, isShort) {
  const feed = $('feed');
  feed.querySelectorAll('.skeleton-slide').forEach(s => s.remove());
  
  items.forEach((item, idx) => {
    let isShortVid = isShort;
    if (item.duration) {
      const m = item.duration.match(/PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?/);
      if (m) {
        const secs = (parseInt(m[1]||0)*3600) + (parseInt(m[2]||0)*60) + parseInt(m[3]||0);
        if (secs <= 90) isShortVid = true;
      }
    }
    
    const slide = document.createElement('div');
    slide.className = 'slide ' + (isShortVid ? 'shorts-slide' : 'long-slide');
    slide.dataset.vid = item.id;
    slide.dataset.title = item.title;
    slide.dataset.channel = item.channel;
    
    const params = isShortVid
      ? '?autoplay=0&playsinline=1&rel=0&loop=1&playlist=' + item.id + '&controls=1&enablejsapi=1'
      : '?autoplay=0&playsinline=1&rel=0&controls=1&enablejsapi=1';
    
    slide.innerHTML = 
      '<iframe loading="lazy" src="https://www.youtube-nocookie.com/embed/' + item.id + params + '" ' +
      'allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>' +
      '<div class="v-overlay"></div>' +
      '<div class="v-right">' +
      '  <div class="v-action" onclick="WT.onUserClick()">' +
      '    <div class="v-action-btn">&#128142;</div><div class="v-action-lbl">Earn</div>' +
      '  </div>' +
      '  <div class="v-action" onclick="WT.shareVid(\\''+item.id+'\\')">' +
      '    <div class="v-action-btn">&#8599;</div><div class="v-action-lbl">Share</div>' +
      '  </div>' +
      '</div>' +
      '<div class="v-bottom">' +
      '  <div class="v-title">' + escHtml(item.title) + '</div>' +
      '  <div class="v-channel">@' + escHtml(item.channel) + '</div>' +
      '</div>';
    
    feed.appendChild(slide);

    // Register slide with play/pause observer
    observeSlide(slide);

    // Lazy load: observe last item to fetch next page
    if (idx === items.length - 1 && _feedToken) {
      const lazyObs = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) { lazyObs.disconnect(); loadFeed(_feedToken); }
      }, { threshold: 0.5 });
      lazyObs.observe(slide);
    }
  });
}

function showFeedError(msg) {
  $('feed').innerHTML = '<div class="skeleton-slide"><div style="color:var(--muted);font-size:.85rem;text-align:center;padding:2rem">' + msg + '</div></div>';
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══ YOUTUBE IFRAME CONTROL VIA postMessage ═══
function ytCmd(iframe, func) {
  try {
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func: func, args: [] }), '*'
    );
  } catch(e) {}
}

// ═══ INTERSECTION OBSERVER — Play ≥50% / Pause <50% ═══
let _slideObserver = null;

function initSlideObserver() {
  _slideObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const slide = entry.target;
      const iframe = slide.querySelector('iframe');
      if (entry.intersectionRatio >= 0.5) {
        if (iframe) ytCmd(iframe, 'playVideo');
        onSlideEnter(slide);
      } else {
        if (iframe) ytCmd(iframe, 'pauseVideo');
        onSlideLeave(slide);
      }
    });
  }, { root: $('feed'), threshold: 0.5 });
}

function observeSlide(slide) {
  if (_slideObserver) _slideObserver.observe(slide);
}

function onSlideLeave(slide) {
  if (_activeSlide !== slide) return;
  stopTimer();
  _playing = false;
}

async function onSlideEnter(slide) {
  if (_activeSlide === slide) return;
  _activeSlide = slide;

  // Show interstitial every 4 videos
  _videoCount++;
  if (_videoCount > 0 && _videoCount % 4 === 0) {
    showInterstitial();
  }

  if (!_user) return;

  // Start watch session on server
  const data = await api('/points/watch/start', {
    method: 'POST',
    body: JSON.stringify({ videoId: slide.dataset.vid })
  });

  if (data.sessionId) {
    _watchSessionId = data.sessionId;
    _playing = true;
    startTimer();
  }
}

// ═══ TIMER & HEARTBEAT ═══
function drawRing() {
  const f = $('ringFill'), n = $('ringNum');
  if (!f || !n) return;
  const pct = _timerSecs / EARN_INTERVAL;
  f.style.strokeDashoffset = CIRC * (1 - pct);
  f.style.stroke = _timerSecs > 20 ? '#22c55e' : _timerSecs > 10 ? '#fbbf24' : '#ff2a4a';
  n.textContent = _timerSecs;
  n.style.color = f.style.stroke;
}

function startTimer() {
  stopTimer();
  _timerSecs = EARN_INTERVAL;
  drawRing();
  _timerInt = setInterval(async () => {
    if (!_playing || !_watchSessionId) return;
    _timerSecs--;
    drawRing();
    if (_timerSecs <= 0) {
      _timerSecs = EARN_INTERVAL;
      // Send heartbeat to server — server decides if points are earned
      const data = await api('/points/watch/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ sessionId: _watchSessionId })
      });
      if (data.earned) {
        _points = data.points;
        updateUI();
        showToast('+' + data.amount + ' pt \\uD83C\\uDF89', '#22c55e');
      } else if (data.error) {
        showToast(data.error, '#ff6b6b');
      }
      drawRing();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(_timerInt);
  _timerInt = null;
  _playing = false;
  _timerSecs = EARN_INTERVAL;
  drawRing();
}

// ═══ EARN MODAL ═══
function openEarn() {
  if (!_user) { $('authOv').classList.remove('hidden'); return; }
  refreshBalance();
  $('earnModal').classList.add('open');
}
function closeEarn() { $('earnModal').classList.remove('open'); }

async function refreshBalance() {
  const data = await api('/points/balance');
  if (data.points !== undefined) {
    _points = data.points;
    updateUI();
  }
}

// ═══ SMART OFFER CLAIM (server-validated) ═══
async function claimSmartOffer() {
  if (!_user) { $('authOv').classList.remove('hidden'); return; }
  if (_hlCoolLeft > 0) { showToast('Wait ' + fmtT(_hlCoolLeft)); return; }
  
  const data = await api('/points/claim/smart-offer', { method: 'POST' });
  
  if (data.error) {
    if (data.cooldownLeft) {
      startOfferCooldown(data.cooldownLeft);
    }
    showToast(data.error, '#ff6b6b');
    return;
  }
  
  _points = data.points;
  updateUI();
  showToast('+' + data.amount + ' pts! \\uD83C\\uDF89', '#a855f7');
  if (data.cooldown) startOfferCooldown(data.cooldown);
}

function startOfferCooldown(secs) {
  _hlCoolLeft = secs;
  const card = $('smartOfferCard');
  const name = $('smartOfferName');
  if (card) card.style.opacity = '.6';
  
  clearInterval(_hlCoolTimer);
  _hlCoolTimer = setInterval(() => {
    _hlCoolLeft--;
    const fill = $('smartFill');
    if (fill) fill.style.width = ((_hlCoolLeft / 300) * 100) + '%';
    if (name) name.textContent = 'Ready in ' + fmtT(_hlCoolLeft);
    if (_hlCoolLeft <= 0) {
      clearInterval(_hlCoolTimer);
      if (card) card.style.opacity = '1';
      if (name) name.textContent = 'Smart Link \\u2014 Earn 50 pts';
      if (fill) fill.style.width = '100%';
    }
  }, 1000);
}

// ═══ AD WATCH CLAIM (server-validated) ═══
async function claimAdWatch() {
  if (!_user) { $('authOv').classList.remove('hidden'); return; }
  
  const data = await api('/points/claim/ad-watch', { method: 'POST' });
  
  if (data.error) { showToast(data.error, '#ff6b6b'); return; }
  
  _points = data.points;
  updateUI();
  showToast('+' + data.amount + ' pts! \\uD83C\\uDF89', '#fbbf24');
}

// ═══ LEADERBOARD ═══
function openLB() { $('lbModal').classList.add('open'); loadLB(); }
function closeLB() { $('lbModal').classList.remove('open'); }

async function loadLB() {
  const body = $('lbBody');
  body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:1.5rem">Loading...</div>';
  
  const data = await api('/leaderboard');
  if (!data.leaderboard?.length) {
    body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:1.5rem">No users yet</div>';
    return;
  }
  
  const medals = ['\\uD83E\\uDD47','\\uD83E\\uDD48','\\uD83E\\uDD49'];
  body.innerHTML = data.leaderboard.map((r, i) => {
    const isMe = _user && r.name === _user.name;
    return '<div class="lb-row" style="' + (isMe ? 'background:rgba(255,42,74,.08)' : '') + '">' +
      '<div class="lb-rank" style="color:' + (i===0?'#fbbf24':i===1?'#94a3b8':i===2?'#cd7c37':'#fff') + '">' + (medals[i] || (i+1)) + '</div>' +
      '<div class="lb-av">' + r.initial + '</div>' +
      '<div class="lb-name">' + escHtml(r.name) + (isMe ? ' (You)' : '') + '</div>' +
      '<div class="lb-pts">' + r.points + ' pts</div></div>';
  }).join('');
}

// ═══ WITHDRAW ═══
function openWithdraw() {
  if (!_user) { $('authOv').classList.remove('hidden'); return; }
  refreshBalance();
  $('wModal').classList.add('open');
  const ok = $('wOK'); if(ok) ok.style.display = 'none';
  document.querySelector('.w-submit').style.display = '';
}
function closeWithdraw() { $('wModal').classList.remove('open'); }

function calcWithdraw() {
  const v = parseInt($('wAmt').value) || 0;
  $('wCalc').textContent = v ? v + ' pts = $' + (v / 1000).toFixed(2) : '';
}

async function submitWithdraw() {
  const amount = parseInt($('wAmt').value) || 0;
  const method = $('wMethod').value;
  const address = ($('wAddr').value || '').trim();
  const err = $('wErr');

  if (!_emailVerified) { err.textContent = 'Verify your email first!'; return; }
  if (!method || !address || amount < 50000) { err.textContent = 'Min 50,000 pts ($50). Fill all fields'; return; }
  
  const data = await api('/withdraw', {
    method: 'POST',
    body: JSON.stringify({ amount, method, address })
  });
  
  if (data.error) { err.textContent = data.error; return; }
  
  err.textContent = '';
  _points = data.remainingPoints;
  updateUI();
  $('wOK').style.display = 'block';
  document.querySelector('.w-submit').style.display = 'none';
  showToast('Withdrawal submitted! \\u2705');
}

// ═══ SHARE ═══
function shareVid(vid) {
  const url = 'https://youtu.be/' + vid;
  if (navigator.share) navigator.share({ title: 'WinTube', url }).catch(() => {});
  else navigator.clipboard.writeText(url).then(() => showToast('Copied! \\u2705'));
}

// ═══ INTERSTITIAL AD ═══
async function showInterstitial() {
  const bg = $('interstitialBg');
  if (!bg) return;
  bg.classList.add('open');

  const countEl = $('interstitialCount');
  const skipEl = $('interstitialSkip');
  const vid = $('vastVideo');
  const loadingEl = $('vastLoading');

  // Reset state
  let count = 5;
  if (countEl) countEl.textContent = String(count);
  if (skipEl) { skipEl.style.opacity = '.4'; skipEl.style.pointerEvents = 'none'; }
  if (vid) { vid.style.display = 'none'; vid.src = ''; }
  if (loadingEl) loadingEl.style.display = '';

  // Countdown (enables skip after 5s)
  clearInterval(_interstitialTimer);
  _interstitialTimer = setInterval(() => {
    count--;
    if (countEl) countEl.textContent = count > 0 ? String(count) : '\\u2713';
    if (count <= 0) {
      clearInterval(_interstitialTimer);
      if (skipEl) { skipEl.style.opacity = '1'; skipEl.style.pointerEvents = 'auto'; }
    }
  }, 1000);

  // Fetch and parse VAST
  try {
    const vastRes = await fetch('https://vast.yomeno.xyz/vast?spot_id=1486075');
    const vastXml = await vastRes.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(vastXml, 'text/xml');

    // Find best MediaFile (prefer mp4)
    const mediaFiles = Array.from(doc.querySelectorAll('MediaFile'));
    let mediaSrc = '';
    for (const mf of mediaFiles) {
      const t = (mf.getAttribute('type') || '').toLowerCase();
      if (t.includes('mp4') || t.includes('video/mp4')) { mediaSrc = (mf.textContent || '').trim(); break; }
    }
    if (!mediaSrc && mediaFiles.length) mediaSrc = (mediaFiles[0].textContent || '').trim();

    if (mediaSrc && vid) {
      if (loadingEl) loadingEl.style.display = 'none';
      vid.style.display = '';
      vid.src = mediaSrc;
      vid.muted = false;
      const playP = vid.play();
      if (playP) playP.catch(() => { vid.muted = true; vid.play(); });
      vid.onended = () => closeInterstitial();
    }
  } catch (e) {
    // VAST failed — skip button already enabled after 5s
    if (loadingEl) loadingEl.innerHTML = '<div style="font-size:2rem;margin-bottom:8px">&#128250;</div><div style="color:#555">Ad unavailable</div>';
  }
}

function closeInterstitial() {
  const bg = $('interstitialBg');
  if (bg) bg.classList.remove('open');
  clearInterval(_interstitialTimer);
  const vid = $('vastVideo');
  if (vid) { vid.pause(); vid.src = ''; vid.style.display = 'none'; }
  const loadingEl = $('vastLoading');
  if (loadingEl) loadingEl.style.display = '';
}

// ═══ OFFERS ═══
function openOffers() {
  if (!_user) { $('authOv').classList.remove('hidden'); return; }
  closeEarn();
  $('offersModal').classList.add('open');
  // TODO: Replace CPABUILD_ID with your CPAlead/CPAbuild publisher ID
  const CPABUILD_ID = 'YOUR_PUBLISHER_ID';
  const oc = $('offersContent');
  if (oc && CPABUILD_ID !== 'YOUR_PUBLISHER_ID') {
    oc.innerHTML = '<iframe class="offers-frame" src="https://www.cpabuild.com/offerwall.php?app=' +
      CPABUILD_ID + '&aff_sub=' + (_user?.uid || '') + '"></iframe>';
  }
}
function closeOffers() { $('offersModal').classList.remove('open'); }

// ═══ PROFILE ═══
function openProfile() {
  if (!_user) { $('authOv').classList.remove('hidden'); return; }
  $('profileModal').classList.add('open');
  renderProfileHead();
  loadHistory();
}
function closeProfile() { $('profileModal').classList.remove('open'); }

function renderProfileHead() {
  const h = $('profileHead');
  if (!h || !_user) return;
  const verBadge = _emailVerified
    ? '<span style="color:#22c55e;font-size:.68rem;font-weight:700">&#9989; Verified</span>'
    : '<span style="color:#ef4444;font-size:.68rem;font-weight:700;cursor:pointer" onclick="WT.resendVerify()">&#9888; Not verified — click to resend</span>';
  const vipBadge = _isVip
    ? '<span class="vip-badge" style="margin-left:6px">&#11088; VIP</span>'
    : '';
  h.innerHTML = '<div style="display:flex;align-items:center;gap:12px">' +
    '<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#e63946,#ff6b35);display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:800">' +
    _user.name.charAt(0).toUpperCase() + '</div>' +
    '<div><div style="font-weight:800;font-size:.95rem">' + escHtml(_user.name) + vipBadge + '</div>' +
    '<div style="font-size:.72rem;color:var(--muted)">' + escHtml(_user.email) + ' ' + verBadge + '</div>' +
    '<div style="font-size:.75rem;color:var(--yellow);font-weight:700;margin-top:2px">' + _points.toLocaleString() + ' pts = $' + (_points/1000).toFixed(2) + '</div>' +
    '</div></div>';
}

function showPTab(tab) {
  _pTab = tab;
  $('pTabH').style.background = tab === 'history' ? '#222' : '#1a1a1a';
  $('pTabH').style.color = tab === 'history' ? '#fff' : '#888';
  $('pTabH').style.fontWeight = tab === 'history' ? '700' : '400';
  $('pTabW').style.background = tab === 'withdrawals' ? '#222' : '#1a1a1a';
  $('pTabW').style.color = tab === 'withdrawals' ? '#fff' : '#888';
  $('pTabW').style.fontWeight = tab === 'withdrawals' ? '700' : '400';
  if (tab === 'history') loadHistory();
  else loadWithdrawalHistory();
}

async function loadHistory() {
  const body = $('profileBody');
  body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:1.5rem">Loading...</div>';
  const data = await api('/profile/history');
  if (!data.history?.length) { body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:1.5rem">No transactions yet</div>'; return; }
  const typeColors = { signup_bonus:'#22c55e', watch:'#3b82f6', referral_bonus:'#a855f7', withdrawal:'#ef4444', refund:'#22c55e', ad_watch:'#f59e0b', smart_offer:'#c084fc' };
  const typeIcons = { signup_bonus:'&#127873;', watch:'&#9654;', referral_bonus:'&#128101;', withdrawal:'&#128176;', refund:'&#10227;', ad_watch:'&#128250;', smart_offer:'&#127381;' };
  body.innerHTML = data.history.map(tx => {
    const col = typeColors[tx.type] || '#888';
    const icon = typeIcons[tx.type] || '&#9679;';
    const sign = tx.amount > 0 ? '+' : '';
    return '<div class="tx-row"><div class="tx-icon" style="background:' + col + '22;color:' + col + '">' + icon + '</div>' +
      '<div class="tx-info"><div class="tx-desc">' + escHtml(tx.description||tx.type) + '</div>' +
      '<div class="tx-date">' + (tx.created_at||'').slice(0,16).replace('T',' ') + '</div></div>' +
      '<div class="tx-amt" style="color:' + col + '">' + sign + tx.amount + ' pts</div></div>';
  }).join('');
}

async function loadWithdrawalHistory() {
  const body = $('profileBody');
  body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:1.5rem">Loading...</div>';
  const data = await api('/profile/withdrawals');
  if (!data.withdrawals?.length) { body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:1.5rem">No withdrawals yet. Minimum: 50,000 pts ($50)</div>'; return; }
  const statusColors = { pending:'#fbbf24', approved:'#22c55e', rejected:'#ef4444' };
  body.innerHTML = data.withdrawals.map(w => {
    const col = statusColors[w.status] || '#888';
    return '<div class="tx-row"><div class="tx-icon" style="background:' + col + '22;color:' + col + '">&#128176;</div>' +
      '<div class="tx-info"><div class="tx-desc">$' + w.usd_value + ' via ' + escHtml(w.method) + '</div>' +
      '<div class="tx-date">' + (w.created_at||'').slice(0,16).replace('T',' ') + (w.admin_note ? ' · ' + escHtml(w.admin_note) : '') + '</div></div>' +
      '<div class="tx-amt" style="color:' + col + '">' + w.status.toUpperCase() + '</div></div>';
  }).join('');
}

// ═══ VIP ═══
function showVipForm() {
  const vf = $('vipForm');
  const vb = $('vipPayBtn');
  if (vf) vf.style.display = '';
  if (vb) vb.style.display = 'none';
}

async function submitVipRequest() {
  const hash = ($('vipTxHash')?.value || '').trim();
  if (!hash || hash.length < 10) { showToast('Enter a valid TX hash', '#ef4444'); return; }
  const data = await api('/profile/vip/request', { method: 'POST', body: JSON.stringify({ txHash: hash }) });
  if (data.error) { showToast(data.error, '#ef4444'); return; }
  showToast('VIP request sent! We\\'ll activate in 24h \\u2B50');
  const vf = $('vipForm'); if (vf) vf.style.display = 'none';
}

function copyVipAddr() {
  navigator.clipboard.writeText(VIP_WALLET).then(() => showToast('Wallet copied! \\u2B50'));
}

function copyVipCard() {
  navigator.clipboard.writeText(VIP_CARD).then(() => showToast('Card number copied! \\uD83D\\uDCCB'));
}

async function resendVerify() {
  const data = await api('/profile/resend-verify', { method: 'POST' });
  if (data.error) showToast(data.error, '#ef4444');
  else showToast('Verification email sent! Check inbox \\u2709');
}

// ═══ NAV ═══
function navTo(tab) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (tab === 'home') {
    $('navHome').classList.add('active');
    if (_isSearch) clearSearch();
  }
}

// ═══ UTILS ═══
function showToast(msg, color) {
  const t = $('toast'); if(!t) return;
  t.textContent = msg;
  if (color) t.style.borderColor = color + '44';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

function fmtT(s) { const m = Math.floor(s/60), sec = s%60; return m + ':' + (sec<10?'0':'') + sec; }

function copyRef() {
  const v = $('refInp').value;
  if (v) navigator.clipboard.writeText(v).then(() => showToast('Copied! \\u2705'));
}

// ═══ VISIBILITY ═══
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { _playing = false; }
  else { if (_user) refreshBalance(); }
});

// ═══ INIT ═══
initSlideObserver();

// Handle Google OAuth return
(function handleGoogleReturn() {
  try {
    const raw = localStorage.getItem('wt_google_login');
    if (!raw) return;
    localStorage.removeItem('wt_google_login');
    const d = JSON.parse(raw);
    if (!d || !d.token || !d.user) return;
    _token = d.token;
    _user = d.user;
    _points = d.user.points;
    localStorage.setItem('wt_token', _token);
    updateUI();
    $('authOv').classList.add('hidden');
    showToast(d.isNew ? '+100 pts welcome bonus! \u2728' : 'Welcome back! \u2728');
  } catch(e) {}
})();

genCaptcha();
checkSession();
loadFeed();

// ═══ EXPOSE PUBLIC API ═══
window.WT = {
  switchTab, doLogin, doRegister, closeAuth, onUserClick,
  doSearch, clearSearch, shareVid, navTo,
  openEarn, closeEarn, claimSmartOffer, claimAdWatch,
  openLB, closeLB, openWithdraw, closeWithdraw,
  calcWithdraw, submitWithdraw, copyRef, logout,
  openProfile, closeProfile, showPTab,
  openOffers, closeOffers,
  closeInterstitial,
  showVipForm, submitVipRequest, copyVipAddr, copyVipCard,
  resendVerify,
};

})();
</script>
</body>
</html>`;
}

export default app;
