import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const workdir = path.join(repoRoot, 'workdir');
const dbPath = path.join(workdir, 'state.db');
const nextWakeFile = path.join(workdir, 'next-wake.txt');

let _db = null;

export function getDb() {
  if (_db) return _db;
  if (!existsSync(workdir)) mkdirSync(workdir, { recursive: true });
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      sport TEXT,
      iterations INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      posted_at TEXT NOT NULL,
      sport TEXT,
      content TEXT NOT NULL,
      media_path TEXT,
      x_post_id TEXT,
      likes INTEGER DEFAULT 0,
      replies INTEGER DEFAULT 0,
      reposts INTEGER DEFAULT 0,
      is_draft INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

export function checkBudget() {
  const db = getDb();
  const dailyPostCap = parseInt(process.env.DAILY_POST_CAP ?? '6', 10);
  const dailyBudget = parseFloat(process.env.DAILY_API_BUDGET_USD ?? '5');
  const today = new Date().toISOString().slice(0, 10);

  const postsToday = db
    .prepare(`SELECT COUNT(*) as cnt FROM posts WHERE posted_at LIKE ? AND is_draft = 0`)
    .get(`${today}%`).cnt;

  const draftsToday = db
    .prepare(`SELECT COUNT(*) as cnt FROM posts WHERE posted_at LIKE ? AND is_draft = 1`)
    .get(`${today}%`).cnt;

  const spendToday = db
    .prepare(`SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM shifts WHERE started_at LIKE ?`)
    .get(`${today}%`).total;

  return {
    posts_today: postsToday,
    drafts_today: draftsToday,
    posts_remaining: Math.max(0, dailyPostCap - postsToday),
    daily_post_cap: dailyPostCap,
    estimated_spend_usd: Math.round(spendToday * 10000) / 10000,
    budget_remaining_usd: Math.round((dailyBudget - spendToday) * 10000) / 10000,
    daily_budget_usd: dailyBudget,
    at_budget_warning: spendToday >= dailyBudget * 0.8,
  };
}

export function recordShift({ startedAt, endedAt, sport, iterations, inputTokens, outputTokens, estimatedCostUsd, notes }) {
  const db = getDb();
  return db
    .prepare(`
      INSERT INTO shifts (started_at, ended_at, sport, iterations, input_tokens, output_tokens, estimated_cost_usd, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(startedAt, endedAt ?? new Date().toISOString(), sport ?? null, iterations ?? 0, inputTokens ?? 0, outputTokens ?? 0, estimatedCostUsd ?? 0, notes ?? null);
}

export function recordPost({ postedAt, sport, content, mediaPath, xPostId, isDraft }) {
  const db = getDb();
  return db
    .prepare(`
      INSERT INTO posts (posted_at, sport, content, media_path, x_post_id, is_draft)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(postedAt ?? new Date().toISOString(), sport ?? null, content, mediaPath ?? null, xPostId ?? null, isDraft ? 1 : 0);
}

export function getRecentPosts(limit = 10) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM posts ORDER BY posted_at DESC LIMIT ?`)
    .all(limit);
}

export function getConfig(key) {
  // next_wake_at is stored in a committed text file so it survives across
  // fresh environments (GitHub Actions, new clones, etc.)
  if (key === 'next_wake_at' && existsSync(nextWakeFile)) {
    const val = readFileSync(nextWakeFile, 'utf8').trim();
    if (val) return val;
  }
  const db = getDb();
  const row = db.prepare(`SELECT value FROM config WHERE key = ?`).get(key);
  return row?.value ?? null;
}

export function setConfig(key, value) {
  if (key === 'next_wake_at') {
    if (!existsSync(workdir)) mkdirSync(workdir, { recursive: true });
    writeFileSync(nextWakeFile, String(value), 'utf8');
  }
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`).run(key, String(value));
}
