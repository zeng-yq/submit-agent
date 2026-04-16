import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  url          TEXT NOT NULL,
  tagline      TEXT NOT NULL DEFAULT '',
  short_desc   TEXT NOT NULL DEFAULT '',
  long_desc    TEXT NOT NULL DEFAULT '',
  categories   TEXT NOT NULL DEFAULT '[]',
  anchor_texts TEXT NOT NULL DEFAULT '[]',
  logo_url     TEXT NOT NULL DEFAULT '',
  social_links TEXT NOT NULL DEFAULT '{}',
  founder_name  TEXT NOT NULL DEFAULT '',
  founder_email TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backlinks (
  id           TEXT PRIMARY KEY,
  source_url   TEXT NOT NULL,
  source_title TEXT NOT NULL DEFAULT '',
  domain       TEXT NOT NULL,
  page_ascore  INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','publishable','not_publishable','skipped','error')),
  analysis     TEXT,
  added_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_backlinks_status ON backlinks(status);
CREATE INDEX IF NOT EXISTS idx_backlinks_domain ON backlinks(domain);
CREATE UNIQUE INDEX IF NOT EXISTS idx_backlinks_source_url ON backlinks(source_url);

CREATE TABLE IF NOT EXISTS sites (
  id              TEXT PRIMARY KEY,
  domain          TEXT NOT NULL,
  url             TEXT NOT NULL,
  submit_url      TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT '',
  comment_system  TEXT NOT NULL DEFAULT '',
  antispam        TEXT NOT NULL DEFAULT '[]',
  rel_attribute   TEXT NOT NULL DEFAULT '',
  product_id      TEXT NOT NULL DEFAULT '',
  pricing         TEXT NOT NULL DEFAULT 'free',
  monthly_traffic TEXT NOT NULL DEFAULT '',
  lang            TEXT NOT NULL DEFAULT 'en',
  dr              INTEGER,
  notes           TEXT NOT NULL DEFAULT '',
  added_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain);
CREATE INDEX IF NOT EXISTS idx_sites_product_id ON sites(product_id);

CREATE TABLE IF NOT EXISTS submissions (
  id           TEXT PRIMARY KEY,
  site_name    TEXT NOT NULL,
  site_url     TEXT NOT NULL,
  product_id   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'submitted'
               CHECK(status IN ('submitted','failed','skipped')),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  result       TEXT NOT NULL DEFAULT '',
  fields       TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_product_id ON submissions(product_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);

CREATE TABLE IF NOT EXISTS site_experience (
  domain               TEXT PRIMARY KEY,
  aliases              TEXT NOT NULL DEFAULT '[]',
  updated              TEXT NOT NULL DEFAULT (datetime('now')),
  submit_type          TEXT NOT NULL DEFAULT '',
  form_framework       TEXT NOT NULL DEFAULT '',
  antispam             TEXT NOT NULL DEFAULT '',
  fill_strategy        TEXT NOT NULL DEFAULT '',
  post_submit_behavior TEXT NOT NULL DEFAULT '',
  effective_patterns   TEXT NOT NULL DEFAULT '[]',
  known_traps          TEXT NOT NULL DEFAULT '[]'
);
`

export function createDb(dbPath) {
  const db = new Database(dbPath)
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')
  }
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  return db
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = resolve(__dirname, '../data/backlink.db')
export default createDb(DB_PATH)
