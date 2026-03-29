-- WinTube v2 Upgrade Migration

-- Add email_verified, vip, and first-withdraw tracking to users
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN vip_until TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN first_withdraw_done INTEGER NOT NULL DEFAULT 0;

-- Email verification tokens
CREATE TABLE IF NOT EXISTS email_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- VIP purchase requests
CREATE TABLE IF NOT EXISTS vip_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  amount_usd TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Mark existing Google users as email_verified
UPDATE users SET email_verified = 1 WHERE auth_provider = 'google';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_verif_token ON email_verifications(token);
CREATE INDEX IF NOT EXISTS idx_vip_requests_user ON vip_requests(user_id);
