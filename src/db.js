import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

let dbInstance = null;

export function getDatabase(dbPath = config.dbPath) {
  if (dbInstance && dbInstance.path === dbPath) {
    return dbInstance.db;
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  initSchema(db);

  dbInstance = { path: dbPath, db };
  return db;
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL CHECK (plan_id IN ('free', 'pro')),
      interval TEXT NOT NULL CHECK (interval IN ('none', 'monthly', 'yearly')),
      status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'incomplete')),
      current_period_start INTEGER NOT NULL,
      current_period_end INTEGER NOT NULL,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
      cancellation_reason TEXT,
      scheduled_plan_id TEXT,
      scheduled_interval TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id TEXT,
      provider_event_id TEXT NOT NULL,
      stage TEXT NOT NULL CHECK (stage IN ('initiation', 'verification', 'fulfilment', 'failure')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'duplicate')),
      metadata TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_payment_logs_provider_event ON payment_logs(provider_event_id);
    CREATE INDEX IF NOT EXISTS idx_payment_logs_user_id ON payment_logs(user_id);
  `);
}

export function closeDatabase() {
  if (dbInstance) {
    try { dbInstance.db.close(); } catch (e) {}
    dbInstance = null;
  }
}
