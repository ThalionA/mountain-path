// Open comments API — Cloudflare Worker + D1.
// POST /api/comments  -> store a comment as unapproved
// GET  /api/comments?slug=... -> list approved comments for a page

const MAX_AUTHOR = 60
const MAX_BODY = 4000
const RATE_LIMIT = 5 // comments per IP...
const RATE_WINDOW = 3600 // ...per hour

async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(salt + "|" + ip)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function corsHeaders(env, req) {
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const origin = req.headers.get("Origin") || ""
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  }
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const headers = corsHeaders(env, req)

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers })
    if (url.pathname !== "/api/comments") return json({ error: "not found" }, 404, headers)

    if (req.method === "GET") {
      const slug = url.searchParams.get("slug")
      if (!slug) return json({ error: "slug required" }, 400, headers)
      const { results } = await env.DB.prepare(
        "SELECT id, author, body, created_at FROM comments WHERE slug = ? AND approved = 1 ORDER BY created_at ASC LIMIT 200",
      )
        .bind(slug)
        .all()
      return json({ comments: results || [] }, 200, headers)
    }

    if (req.method === "POST") {
      let payload
      try {
        payload = await req.json()
      } catch {
        return json({ error: "malformed request" }, 400, headers)
      }

      const slug = String(payload.slug || "").trim()
      const author = String(payload.author || "").trim()
      const body = String(payload.body || "").trim()
      const honeypot = String(payload.website || "").trim()

      // Honeypot tripped: report success, store nothing. Bots get no signal.
      if (honeypot) return json({ ok: true, pending: true }, 201, headers)

      if (!slug || !author || !body) {
        return json({ error: "name and comment are required" }, 400, headers)
      }
      if (author.length > MAX_AUTHOR) return json({ error: "name too long" }, 400, headers)
      if (body.length > MAX_BODY) return json({ error: "comment too long" }, 400, headers)

      const ip = req.headers.get("CF-Connecting-IP") || "0.0.0.0"
      const ipHash = await hashIp(ip, env.IP_SALT || "unsalted")
      const now = Math.floor(Date.now() / 1000)

      const { results } = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM comments WHERE ip_hash = ? AND created_at > ?",
      )
        .bind(ipHash, now - RATE_WINDOW)
        .all()
      if ((results && results[0] && results[0].n) >= RATE_LIMIT) {
        return json({ error: "too many comments — try again later" }, 429, headers)
      }

      await env.DB.prepare(
        "INSERT INTO comments (slug, author, body, ip_hash, created_at, approved) VALUES (?, ?, ?, ?, ?, 0)",
      )
        .bind(slug, author, body, ipHash, now)
        .run()

      return json({ ok: true, pending: true }, 201, headers)
    }

    return json({ error: "method not allowed" }, 405, headers)
  },
}
