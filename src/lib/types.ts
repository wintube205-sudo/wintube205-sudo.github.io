// Type definitions for WinTube
export type Bindings = {
  DB: D1Database;
  YT_API_KEY: string;
  JWT_SECRET: string;
  ADMIN_UIDS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  RESEND_API_KEY: string;
  ADMIN_EMAIL: string;
  ADMIN_SECRET: string;
};

export type Variables = {
  user: UserRow | null;
  userId: number | null;
};

export type HonoEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

export interface UserRow {
  id: number;
  uid: string;
  name: string;
  email: string;
  password_hash: string | null;
  avatar_url: string | null;
  auth_provider: string;
  points: number;
  ref_code: string;
  referred_by: string | null;
  is_banned: number;
  email_verified: number;
  vip_until: string | null;
  first_withdraw_done: number;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  user_id: number;
  token: string;
  expires_at: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface PointTransaction {
  id: number;
  user_id: number;
  amount: number;
  type: string;
  description: string | null;
  metadata: string | null;
  created_at: string;
}

export interface WatchSession {
  id: number;
  user_id: number;
  video_id: string;
  started_at: string;
  last_heartbeat: string;
  total_seconds: number;
  points_earned: number;
  is_active: number;
}

export interface WithdrawalRow {
  id: number;
  user_id: number;
  amount: number;
  usd_value: string;
  method: string;
  address: string;
  status: string;
  admin_note: string | null;
  created_at: string;
  processed_at: string | null;
}

// Config constants (server-side only)
export const CONFIG = {
  SIGNUP_BONUS: 100,
  EARN_INTERVAL_SECS: 60,
  POINTS_PER_WATCH: 1,
  SMART_OFFER_POINTS: 50,
  SMART_OFFER_COOLDOWN_SECS: 300,
  SMART_OFFER_MIN_WAIT_SECS: 25,
  AD_WATCH_POINTS: 20,
  AD_WATCH_MIN_SECS: 25,
  AD_WATCH_COOLDOWN_SECS: 120,
  PTS_PER_USD: 1000,
  MIN_WITHDRAW: 50000,
  VIP_DURATION_DAYS: 30,
  VIP_PRICE_USD: 5,
  REFERRAL_BONUS_REFERRER: 50,
  REFERRAL_BONUS_REFERRED: 150,
  SESSION_DURATION_HOURS: 72,
  MAX_WATCH_EARN_PER_HOUR: 120,  // Max 120 pts/hour from watching
  MAX_HEARTBEATS_PER_MIN: 3,     // Anti-spam
  MAX_LOGIN_ATTEMPTS: 10,        // Per hour
};
