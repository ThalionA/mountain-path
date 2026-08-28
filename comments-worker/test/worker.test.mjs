// Tests the Worker against a stub D1. No Cloudflare account, no wrangler, no network.
import { test } from "node:test"
import assert from "node:assert/strict"
import worker from "../src/index.js"

// Minimal D1 stub: records inserts, answers the two queries the worker makes.
function makeDB({ rows = [], rateCount = 0 } = {}) {
  const inserts = []
  return {
    inserts,
    prepare(sql) {
      const stmt = {
        _args: [],
        bind(...args) {
          stmt._args = args
          return stmt
        },
        async all() {
          if (sql.includes("COUNT(*)")) return { results: [{ n: rateCount }] }
          return { results: rows }
        },
        async run() {
          inserts.push({ sql, args: stmt._args })
          return { success: true }
        },
      }
      return stmt
    },
  }
}

const ENV = { ALLOWED_ORIGINS: "https://mountainpath.io", IP_SALT: "test-salt" }

function req(method, path, { body, origin = "https://mountainpath.io", ip = "1.2.3.4" } = {}) {
  return new Request("https://api.example.com" + path, {
    method,
    headers: {
      Origin: origin,
      "CF-Connecting-IP": ip,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

const VALID = { slug: "musings/test", author: "Theo", body: "Nice post." }

test("OPTIONS preflight returns 204 with the allowed origin", async () => {
  const r = await worker.fetch(req("OPTIONS", "/api/comments"), ENV)
  assert.equal(r.status, 204)
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://mountainpath.io")
})

test("unknown origin does not get echoed back", async () => {
  const r = await worker.fetch(
    req("OPTIONS", "/api/comments", { origin: "https://evil.example" }),
    ENV,
  )
  assert.notEqual(r.headers.get("Access-Control-Allow-Origin"), "https://evil.example")
})

test("unknown path 404s", async () => {
  const r = await worker.fetch(req("GET", "/nope"), ENV)
  assert.equal(r.status, 404)
})

test("unsupported method 405s", async () => {
  const r = await worker.fetch(req("DELETE", "/api/comments"), ENV)
  assert.equal(r.status, 405)
})

test("GET without slug is a 400", async () => {
  const r = await worker.fetch(req("GET", "/api/comments"), { ...ENV, DB: makeDB() })
  assert.equal(r.status, 400)
})

test("GET returns the rows D1 gives it", async () => {
  const rows = [{ id: 1, author: "A", body: "hi", created_at: 1000 }]
  const r = await worker.fetch(req("GET", "/api/comments?slug=x"), { ...ENV, DB: makeDB({ rows }) })
  assert.equal(r.status, 200)
  assert.deepEqual((await r.json()).comments, rows)
})

test("GET only ever asks for approved rows", async () => {
  let seen = ""
  const DB = { prepare(sql) { seen = sql; return { bind: () => ({ all: async () => ({ results: [] }) }) } } }
  await worker.fetch(req("GET", "/api/comments?slug=x"), { ...ENV, DB })
  assert.match(seen, /approved = 1/)
})

test("valid POST stores the comment unapproved", async () => {
  const DB = makeDB()
  const r = await worker.fetch(req("POST", "/api/comments", { body: VALID }), { ...ENV, DB })
  assert.equal(r.status, 201)
  assert.equal(DB.inserts.length, 1)
  const { sql, args } = DB.inserts[0]
  assert.match(sql, /INSERT INTO comments/)
  // `approved` is a hardcoded 0 literal, not a bind parameter, so a client
  // cannot submit itself pre-approved. Five placeholders, six columns.
  assert.match(sql, /approved\) VALUES \(\?, \?, \?, \?, \?, 0\)/)
  assert.equal(args.length, 5, "approved must not be bindable")
  assert.equal(args[0], VALID.slug)
  assert.equal(args[1], VALID.author)
  assert.equal(args[2], VALID.body)
})

test("honeypot returns success but stores nothing", async () => {
  const DB = makeDB()
  const r = await worker.fetch(
    req("POST", "/api/comments", { body: { ...VALID, website: "http://spam.example" } }),
    { ...ENV, DB },
  )
  assert.equal(r.status, 201)
  assert.equal((await r.json()).ok, true, "bot must see a normal success")
  assert.equal(DB.inserts.length, 0, "nothing may be written")
})

test("missing fields are rejected", async () => {
  for (const bad of [{}, { slug: "s" }, { slug: "s", author: "A" }, { slug: "s", body: "B" }]) {
    const DB = makeDB()
    const r = await worker.fetch(req("POST", "/api/comments", { body: bad }), { ...ENV, DB })
    assert.equal(r.status, 400, JSON.stringify(bad))
    assert.equal(DB.inserts.length, 0)
  }
})

test("whitespace-only fields are rejected", async () => {
  const DB = makeDB()
  const r = await worker.fetch(
    req("POST", "/api/comments", { body: { slug: "s", author: "   ", body: "  " } }),
    { ...ENV, DB },
  )
  assert.equal(r.status, 400)
  assert.equal(DB.inserts.length, 0)
})

test("oversized name and body are rejected", async () => {
  for (const bad of [
    { ...VALID, author: "x".repeat(61) },
    { ...VALID, body: "x".repeat(4001) },
  ]) {
    const DB = makeDB()
    const r = await worker.fetch(req("POST", "/api/comments", { body: bad }), { ...ENV, DB })
    assert.equal(r.status, 400)
    assert.equal(DB.inserts.length, 0)
  }
})

test("malformed JSON is a 400, not a crash", async () => {
  const bad = new Request("https://api.example.com/api/comments", {
    method: "POST",
    headers: { Origin: "https://mountainpath.io", "Content-Type": "application/json" },
    body: "{not json",
  })
  const r = await worker.fetch(bad, { ...ENV, DB: makeDB() })
  assert.equal(r.status, 400)
})

test("rate limit blocks the 6th comment in an hour", async () => {
  const DB = makeDB({ rateCount: 5 })
  const r = await worker.fetch(req("POST", "/api/comments", { body: VALID }), { ...ENV, DB })
  assert.equal(r.status, 429)
  assert.equal(DB.inserts.length, 0)
})

test("rate limit allows the 5th", async () => {
  const DB = makeDB({ rateCount: 4 })
  const r = await worker.fetch(req("POST", "/api/comments", { body: VALID }), { ...ENV, DB })
  assert.equal(r.status, 201)
  assert.equal(DB.inserts.length, 1)
})

test("the raw IP is never stored, and the hash is salted", async () => {
  const DB = makeDB()
  await worker.fetch(req("POST", "/api/comments", { body: VALID, ip: "9.9.9.9" }), { ...ENV, DB })
  const args = DB.inserts[0].args
  assert.ok(!args.includes("9.9.9.9"), "raw IP must not be stored")
  const hash = args[3]
  assert.match(hash, /^[0-9a-f]{64}$/, "expected a SHA-256 hex digest")

  const DB2 = makeDB()
  await worker.fetch(req("POST", "/api/comments", { body: VALID, ip: "9.9.9.9" }), {
    ...ENV,
    IP_SALT: "different-salt",
    DB: DB2,
  })
  assert.notEqual(hash, DB2.inserts[0].args[3], "a different salt must give a different hash")
})

test("the same IP hashes stably within one salt", async () => {
  const a = makeDB(), b = makeDB()
  await worker.fetch(req("POST", "/api/comments", { body: VALID, ip: "5.5.5.5" }), { ...ENV, DB: a })
  await worker.fetch(req("POST", "/api/comments", { body: VALID, ip: "5.5.5.5" }), { ...ENV, DB: b })
  assert.equal(a.inserts[0].args[3], b.inserts[0].args[3])
})
