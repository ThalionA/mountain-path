# comments-worker

Login-free comments for The Mountain Path. Cloudflare Worker + D1, free tier.

Paired with the Quartz plugin at `../plugins/open-comments`.

## Deploy (one-off)

Wrangler is a devDependency here, so use `npx wrangler` — no global install.

```bash
npm install
npx wrangler login
npx wrangler d1 create mountainpath-comments   # paste database_id into wrangler.toml
npx wrangler d1 execute mountainpath-comments --remote --file=./schema.sql
npx wrangler secret put IP_SALT                # paste: openssl rand -hex 32
npx wrangler deploy
```

`wrangler deploy` prints the worker URL. Put it in `quartz.config.yaml` under the
`./plugins/open-comments` entry as `apiUrl`, and set `enabled: true`.

## Tests

```bash
npm test
```

17 tests against a stubbed D1 — no Cloudflare account or network needed.

## Moderation

Nothing appears on the site until you approve it — `approved` defaults to `0`.

```bash
# See what's waiting
npx wrangler d1 execute mountainpath-comments --remote \
  --command "SELECT id, slug, author, body FROM comments WHERE approved = 0 ORDER BY created_at"

# Approve one
npx wrangler d1 execute mountainpath-comments --remote \
  --command "UPDATE comments SET approved = 1 WHERE id = 42"

# Bin the spam
npx wrangler d1 execute mountainpath-comments --remote \
  --command "DELETE FROM comments WHERE approved = 0 AND id IN (7, 8, 9)"
```

## What's in v1

- Moderation by default — nothing renders unapproved
- Honeypot field (`website`); tripping it returns success and stores nothing
- 5 comments per IP per hour, counted against a salted SHA-256 hash
- Raw IPs are never stored
- Length caps: name 60, body 4000
- CORS locked to `ALLOWED_ORIGINS` in `wrangler.toml`

## Not in v1

- Turnstile (add if bots get through the honeypot)
- Threading / replies
- Email notification on a new comment
- A web moderation UI — it's `wrangler` commands for now

## When you move to a custom domain

Add the new origin to `ALLOWED_ORIGINS` in `wrangler.toml` and `wrangler deploy`.
Comments key off the Quartz page slug, not the URL, so existing threads survive
the move.
