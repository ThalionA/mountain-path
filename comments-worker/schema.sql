-- Open comments store. One table, moderation-by-default.
CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL,
  author      TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  ip_hash     TEXT    NOT NULL,   -- salted SHA-256, never the raw IP
  created_at  INTEGER NOT NULL,   -- unix seconds
  approved    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_comments_slug ON comments(slug, approved, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_rate ON comments(ip_hash, created_at);
