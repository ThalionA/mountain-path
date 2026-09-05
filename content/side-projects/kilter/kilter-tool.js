/* kilter-tool.js — pure logic for the Kilter board tool (no DOM).
   Ports, feature-exactly, the Python in ~/Projects/kilter-analysis:
     kb_beta.Problem            → Problem (Dijkstra over hand states)
     kb_holdmodel explain()     → explainGrade (additive hold model)
     kb_stats.strat_contrast    → stratContrast (grade-stratified permutation)
     kb_stats.bh_fdr            → bhFdr
     boardkit.logbook loaders   → parseLogbook (CSV template / Kilter app JSON / Aurora export)
   Loaded by board.html; also runnable under node for the validation harness. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KT = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- beta model constants (kb_beta.py v1, hand-tuned, never fitted) ----------
  const W = { base: 0.25, bridge_lin: 2.0, bridge: 6.0, ext: 10.0, ext_hard: 8.0, bad: 0.55,
              cross: 1.5, match: 1.0, bump: 0.6, down: 0.8 };
  const BRIDGE_OK = 0.55, EXT_OK = 0.85;
  const HAND_ROLES = new Set([12, 13, 14]);

  function athlete(heightCm, apeCm) {
    const spanIn = (heightCm + apeCm) / 2.54, hIn = heightCm / 2.54;
    return { spanIn, hIn, footMinDrop: 0.10 * hIn, footMaxDrop: 0.80 * spanIn, footLat: 0.55 * spanIn };
  }

  function parseFrames(frames) {
    // "p1129r12p1234r13..." → [[placement, role], ...] in order
    const out = []; const re = /p(\d+)r(\d+)/g; let m;
    while ((m = re.exec(frames)) !== null) out.push([+m[1], +m[2]]);
    return out;
  }

  // ---------- hold badness z (kb_beta._load: mean/std of the shrunk table, ddof=1) ----------
  function badZTable(holds) {
    const vals = [];
    for (const k in holds) if (holds[k].b !== undefined) vals.push(holds[k].b);
    const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / (vals.length - 1));
    const z = {};
    for (const k in holds) if (holds[k].b !== undefined) z[k] = (holds[k].b - mu) / sd;
    return { z, mu, sd };
  }

  // ---------- binary heap for Dijkstra ----------
  class Heap {
    constructor() { this.a = []; }
    push(x) { const a = this.a; a.push(x); let i = a.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
    pop() { const a = this.a; const top = a[0]; const last = a.pop();
      if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
      return top; }
    get size() { return this.a.length; }
  }

  class Problem {
    constructor(frames, holdsTable, badZ, ath) {
      this.holds = {};                       // placement → [x, y, role]; first role wins
      for (const [p, r] of parseFrames(frames)) {
        const h = holdsTable[p];
        if (h && !(p in this.holds)) this.holds[p] = [h.x, h.y, r];
      }
      this.badZ = badZ; this.ath = ath;
      const ids = Object.keys(this.holds).map(Number);
      this.hands = ids.filter(p => HAND_ROLES.has(this.holds[p][2]));
      this.starts = ids.filter(p => this.holds[p][2] === 12).sort((a, b) => this.holds[a][1] - this.holds[b][1] || a - b).slice(0, 2);
      this.finish = new Set(ids.filter(p => this.holds[p][2] === 14));
      if (!this.starts.length) this.starts = [...this.hands].sort((a, b) => this.holds[a][1] - this.holds[b][1] || a - b).slice(0, 2);
      if (!this.finish.size && this.hands.length) {
        let best = this.hands[0]; for (const p of this.hands) if (this.holds[p][1] > this.holds[best][1]) best = p;
        this.finish = new Set([best]);
      }
      this.feetAll = ids;
    }
    xy(p) { const h = this.holds[p]; return [h[0], h[1]]; }
    dist(p, q) { const a = this.holds[p], b = this.holds[q]; return Math.hypot(a[0] - b[0], a[1] - b[1]); }
    bestFootExt(anchor, target) {
      const [ax, ay] = this.xy(anchor), [tx, ty] = this.xy(target);
      const top = Math.min(ay, ty), midx = (ax + tx) / 2, A = this.ath;
      let best = null, good = false;
      for (const f of this.feetAll) {
        const [fx, fy] = this.holds[f]; const drop = top - fy;
        if (drop < A.footMinDrop || drop > A.footMaxDrop || Math.abs(fx - midx) > A.footLat) continue;
        const ext = Math.hypot(fx - tx, fy - ty) / A.spanIn;
        if (best === null || ext < best) best = ext;
        good = true;
      }
      if (best === null) {
        let f = this.feetAll[0]; for (const q of this.feetAll) if (this.holds[q][1] < this.holds[f][1]) f = q;
        const [fx, fy] = this.holds[f]; best = Math.hypot(fx - tx, fy - ty) / A.spanIn;
      }
      return [best, good];
    }
    moveCost(anchor, frm, target) {
      const bridge = this.dist(anchor, target) / this.ath.spanIn;
      if (bridge > 1.25) return null;
      const [ext, good] = this.bestFootExt(anchor, target);
      let c = W.base + W.bridge_lin * bridge * bridge + W.bridge * Math.max(0, bridge - BRIDGE_OK) ** 2
            + W.ext * Math.max(0, ext - EXT_OK) ** 2 + W.ext_hard * Math.max(0, ext - 1.0) ** 2
            + W.bad * Math.max(0, this.badZ[anchor] || 0) + W.bad * Math.max(0, this.badZ[target] || 0);
      const dy = this.holds[target][1] - this.holds[frm][1];
      if (dy < 0) c += W.down * (-dy) / 12;
      if (target === anchor) c += W.match;
      return [c, { bridge, ext, good_foot: good }];
    }
    solve() {
      const s = this.starts; if (!s.length) return null;
      const key = (L, R, last) => L + "," + R + "," + last;
      const start = [s[0], s[s.length - 1], -1];
      const dist = new Map([[key(...start), 0]]); const prev = new Map();
      const pq = new Heap(); pq.push([0, start]); let goal = null; const memo = new Map();
      while (pq.size) {
        const [d, st] = pq.pop(); const k0 = key(...st);
        if (d > (dist.get(k0) ?? Infinity)) continue;
        const [L, R, last] = st;
        if (this.finish.has(L) || this.finish.has(R)) { goal = st; break; }
        for (let hand = 0; hand < 2; hand++) {
          const frm = hand === 0 ? L : R, anchor = hand === 0 ? R : L;
          for (const t of this.hands) {
            if (t === frm) continue;
            if (this.holds[t][1] < this.holds[frm][1] - 16) continue;
            const mk = anchor + "," + frm + "," + t;
            if (!memo.has(mk)) memo.set(mk, this.moveCost(anchor, frm, t));
            const mc = memo.get(mk); if (mc === null) continue;
            let c = mc[0]; const info = mc[1];
            if (last === hand) c += W.bump;
            const nL = hand === 0 ? t : L, nR = hand === 0 ? R : t;
            if (this.holds[nL][0] > this.holds[nR][0] + 4) c += W.cross;
            const nst = [nL, nR, hand], nk = key(...nst), nd = d + c;
            if (nd < (dist.get(nk) ?? Infinity)) { dist.set(nk, nd); prev.set(nk, [st, hand, frm, t, c, info]); pq.push([nd, nst]); }
          }
        }
      }
      if (!goal) return null;
      const moves = []; let st = goal;
      while (prev.has(key(...st))) { const [st0, hand, frm, t, c, info] = prev.get(key(...st));
        moves.push({ hand: "LR"[hand], frm, to: t, cost: c, ...info }); st = st0; }
      moves.reverse(); if (!moves.length) return null;
      const f = { beta_cost_total: moves.reduce((a, m) => a + m.cost, 0), beta_cost_max: Math.max(...moves.map(m => m.cost)),
                  beta_n_moves: moves.length, beta_max_bridge: Math.max(...moves.map(m => m.bridge)),
                  beta_max_ext: Math.max(...moves.map(m => m.ext)),
                  beta_foot_deficit: moves.filter(m => !m.good_foot).length / moves.length };
      return { moves, f };
    }
  }

  // ---------- additive hold model (kb_holdmodel.explain) ----------
  function explainGrade(climb, angle, data) {
    const M = data.model, H = data.holds;
    const hset = [...new Set(parseFrames(climb.f).filter(([p, r]) => HAND_ROLES.has(r) && H[p]).map(([p]) => p))].sort((a, b) => a - b);
    const nFoot = parseFrames(climb.f).filter(([, r]) => r === 15).length;
    const k = hset.length, th = (angle - 40) / 10;
    const parts = { intercept: M.intercept, angle: M.angle_effect[angle] ?? M.theta_lin * th,
                    n_hand: M.n_hand * (k - M.n_hand_mean) / M.n_hand_sd,
                    n_foot: M.n_foot * (nFoot - M.n_foot_mean) / M.n_foot_sd };
    const holds = [];
    for (const p of hset) { const h = H[p]; if (h.w === undefined) continue;
      holds.push({ placement: p, x: h.x, y: h.y, w: h.w, s: h.s, contrib: (h.w + h.s * th) / k }); }
    holds.sort((a, b) => b.contrib - a.contrib);
    const predicted = parts.intercept + parts.angle + parts.n_hand + parts.n_foot + holds.reduce((a, h) => a + h.contrib, 0);
    return { predicted, parts, holds, nHand: k, nFoot };
  }

  // ---------- statistics ----------
  function mulberry32(seed) { let a = seed >>> 0; return function () { a += 0x6D2B79F5; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffleInPlace(arr, idx, rnd) { for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));
    const a = idx[i], b = idx[j]; [arr[a], arr[b]] = [arr[b], arr[a]]; } }
  function mean(v) { return v.reduce((a, b) => a + b, 0) / v.length; }
  function sd(v) { const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)); }

  function stratContrast(z, lab, grade, nPerm = 2000, seed = 714) {
    // mean(z | lab) − mean(z | !lab), labels permuted within exact grade
    const n = z.length; const contrast = (l) => { let s1 = 0, n1 = 0, s0 = 0, n0 = 0;
      for (let i = 0; i < n; i++) { if (l[i]) { s1 += z[i]; n1++; } else { s0 += z[i]; n0++; } }
      return (n1 && n0) ? s1 / n1 - s0 / n0 : NaN; };
    const obs = contrast(lab); if (Number.isNaN(obs)) return { obs: NaN, p: NaN };
    const groups = {}; for (let i = 0; i < n; i++) (groups[grade[i]] ||= []).push(i);
    const gl = Object.values(groups); const rnd = mulberry32(seed); let ge = 0;
    const perm = lab.slice();
    for (let k = 0; k < nPerm; k++) { for (const ix of gl) shuffleInPlace(perm, ix, rnd);
      if (Math.abs(contrast(perm)) >= Math.abs(obs) - 1e-12) ge++; }
    return { obs, p: (1 + ge) / (nPerm + 1) };
  }
  function bhFdr(p) { const n = p.length; const order = p.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const adj = new Array(n); let running = 1;
    for (let r = n - 1; r >= 0; r--) { const v = Math.min(1, order[r][0] * n / (r + 1)); running = Math.min(running, v); adj[order[r][1]] = running; }
    return adj; }

  // ---------- catalog helpers ----------
  function buildIndex(data) {
    const byName = new Map(), byPrefix = new Map();
    for (const c of data.climbs) {
      const k = c.n.trim().toLowerCase(); (byName.get(k) || byName.set(k, []).get(k)).push(c);
      byPrefix.set(c.u, c);
    }
    return { byName, byPrefix };
  }
  function resolveName(index, name) { const l = index.byName.get(String(name).trim().toLowerCase());
    if (!l) return { climb: null, why: "unknown" }; if (l.length > 1) return { climb: null, why: "ambiguous" }; return { climb: l[0], why: "ok" }; }
  function resolveUuid(index, uuid) { const u = String(uuid).replace(/-/g, "").toUpperCase().slice(0, 12); return index.byPrefix.get(u) || null; }

  function gradeAt(climb, angle) { const g = climb.g[angle]; return g ? g[0] : null; }

  // ---------- logbook parsing ----------
  const YES = new Set(["1", "true", "yes", "y", "sent", "topped", "flash"]);
  function parseCSV(text) {
    const rows = []; let cur = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) { const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { cur.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; cur.push(field); rows.push(cur); cur = []; field = ""; }
      else field += ch; }
    if (field.length || cur.length) { cur.push(field); rows.push(cur); }
    return rows.filter(r => r.some(x => x.trim() !== ""));
  }
  function parseLogbook(text, index) {
    // returns { events: [{climb, angle, date, topped, first_go, attempts, source}], dropped: {unknown, ambiguous}, format }
    const events = [], dropped = { unknown: [], ambiguous: [] };
    const t = text.trim(); let format;
    const push = (climb, angle, date, topped, first_go, attempts) => events.push({ climb, angle: +angle || 40, date: date || "", topped: !!topped, first_go: !!first_go, attempts: Math.max(1, +attempts || 1) });
    if (t.startsWith("[") || t.startsWith("{")) {
      const j = JSON.parse(t);
      if (Array.isArray(j) && j.length && j[0].climbUuid !== undefined) {          // new Kilter app logs (portal.kiltergrips.com /api/logs/)
        format = "kilter-app";
        for (const r of j) { const c = resolveUuid(index, r.climbUuid); if (!c) { dropped.unknown.push(r.climbName || r.climbUuid); continue; }
          push(c, r.angle, String(r.createdAt || "").slice(0, 10), r.topped, r.flashed, r.attempts); }
      } else if (j.ascents || j.attempts) {                                          // Aurora data export (name-keyed)
        format = "aurora-export";
        const byKey = new Map();
        for (const [list, isAsc] of [[j.ascents || [], true], [j.attempts || [], false]]) for (const r of list) {
          const res = resolveName(index, r.climb); if (!res.climb) { dropped[res.why].push(r.climb); continue; }
          const date = String(r.climbed_at || "").slice(0, 10), angle = +r.angle || 40, k = res.climb.u + "|" + angle + "|" + date;
          const e = byKey.get(k) || byKey.set(k, { climb: res.climb, angle, date, topped: false, burns: 0, nBid: 0 }).get(k);
          e.topped = e.topped || isAsc; e.burns += +r.count || 1; if (!isAsc) e.nBid++;
        }
        for (const e of byKey.values()) push(e.climb, e.angle, e.date, e.topped, e.topped && e.burns === 1 && e.nBid === 0, e.burns);
      } else throw new Error("JSON is neither a Kilter app log export nor an Aurora data export");
    } else {
      format = "csv";
      const rows = parseCSV(t); if (rows.length < 2) throw new Error("CSV needs a header row and at least one data row");
      const head = rows[0].map(h => h.trim().toLowerCase()); const col = (k) => head.indexOf(k);
      const iName = col("name"), iId = col("problem_id"), iAng = col("angle"), iDate = col("date"), iTop = col("topped"), iFg = col("first_go"), iAtt = col("attempts");
      if (iName < 0 && iId < 0) throw new Error("CSV needs a 'name' (or 'problem_id') column");
      if (iTop < 0) throw new Error("CSV needs a 'topped' column (yes/no)");
      for (const r of rows.slice(1)) { let c = null;
        if (iId >= 0 && r[iId]) c = resolveUuid(index, r[iId]);
        if (!c && iName >= 0) { const res = resolveName(index, r[iName]); if (!res.climb) { dropped[res.why].push(r[iName]); continue; } c = res.climb; }
        if (!c) { dropped.unknown.push(r[iId]); continue; }
        push(c, iAng >= 0 ? r[iAng] : 40, iDate >= 0 ? r[iDate] : "", YES.has(String(r[iTop]).trim().toLowerCase()),
             iFg >= 0 && YES.has(String(r[iFg]).trim().toLowerCase()), iAtt >= 0 ? r[iAtt] : 1); }
    }
    return { events, dropped, format };
  }

  // ---------- career aggregation + profile ----------
  function career(events) {
    // one row per (climb, angle): topped = any, first_go = the earliest event's flag, attempts summed
    const m = new Map();
    for (const e of [...events].sort((a, b) => (a.date > b.date) - (a.date < b.date))) {
      const k = e.climb.u + "@" + e.angle;
      const r = m.get(k) || m.set(k, { climb: e.climb, angle: e.angle, topped: false, first_go: e.first_go, attempts: 0, first: e.date, sessions: 0 }).get(k);
      r.topped = r.topped || e.topped; r.attempts += e.attempts; r.sessions++;
    }
    const rows = [...m.values()];
    for (const r of rows) { r.grade = gradeAt(r.climb, r.angle); r.gradeR = r.grade === null ? null : Math.round(r.grade); }
    return rows;
  }
  function zAgainst(data, key, value, gradeR) { const p = data.pop40[gradeR]; if (!p || value === null || value === undefined) return null;
    const [mu, s] = p[key]; return s > 0 ? (value - mu) / s : null; }
  const AXES = [
    { key: "mb",   label: "hold quality", from: c => c.mb },
    { key: "bmax", label: "hardest move", from: c => c.b6 ? c.b6[1] : null },
    { key: "bext", label: "foot-conditioned reach", from: c => c.b6 ? c.b6[4] : null },
    { key: "mst",  label: "raw reach (largest gap)", from: c => c.mst },
  ];
  function profile(rows, data, opts = {}) {
    const nPerm = opts.nPerm || 2000;
    const graded = rows.filter(r => r.gradeR !== null);
    // modal angle: the style contrasts are single-angle by construction (badness is a 40° table)
    const angCount = {}; for (const r of graded) angCount[r.angle] = (angCount[r.angle] || 0) + 1;
    const modal = +Object.entries(angCount).sort((a, b) => b[1] - a[1])[0]?.[0];
    const styleRows = graded.filter(r => r.angle === modal && data.pop40[r.gradeR]);
    // pyramid by community grade
    const pyr = {}; for (const r of graded) { const g = pyr[r.gradeR] ||= { n: 0, topped: 0, first_go: 0, burnsSent: [] };
      g.n++; if (r.topped) { g.topped++; g.burnsSent.push(r.attempts); } if (r.topped && r.first_go) g.first_go++; }
    const pyramid = Object.keys(pyr).map(Number).sort((a, b) => a - b).map(g => ({ grade: g, name: data.grades[g], ...pyr[g],
      meanBurns: pyr[g].burnsSent.length ? mean(pyr[g].burnsSent) : null }));
    const sentGrades = pyramid.filter(p => p.topped > 0).map(p => p.grade);
    const ceiling = sentGrades.length ? Math.max(...sentGrades) : null;
    const fgGrades = pyramid.filter(p => p.first_go > 0).map(p => p.grade);
    const firstGoCeiling = fgGrades.length ? Math.max(...fgGrades) : null;
    // grade-matched contrasts (first-go vs not) at the modal angle, z vs the 40° population
    const axes = AXES.map(ax => {
      const z = [], lab = [], gr = [];
      for (const r of styleRows) { const v = zAgainst(data, ax.key, ax.from(r.climb), r.gradeR); if (v === null) continue;
        z.push(v); lab.push(r.topped && r.first_go); gr.push(r.gradeR); }
      const res = z.length >= 10 ? stratContrast(z, lab, gr, nPerm) : { obs: NaN, p: NaN };
      return { ...ax, n: z.length, obs: res.obs, p: res.p };
    });
    const q = bhFdr(axes.map(a => Number.isNaN(a.p) ? 1 : a.p)); axes.forEach((a, i) => a.q = q[i]);
    // per-problem z table for the block split and lists
    const table = styleRows.map(r => ({ row: r, z: Object.fromEntries(AXES.map(ax => [ax.key, zAgainst(data, ax.key, ax.from(r.climb), r.gradeR)])) }));
    return { modal, nStyle: styleRows.length, pyramid, ceiling, firstGoCeiling, axes, table,
             nRows: rows.length, nGraded: graded.length, firstGoRate: styleRows.length ? styleRows.filter(r => r.topped && r.first_go).length / styleRows.length : NaN };
  }
  function blockSplit(prof, splitDate, nPerm = 2000) {
    // contrasts before/after a first-encounter date; interaction test shuffles the block label within (grade, outcome) cells
    const out = [];
    for (const ax of AXES) {
      const z = [], lab = [], gr = [], per = [];
      for (const t of prof.table) { const v = t.z[ax.key]; if (v === null || !t.row.first) continue;
        z.push(v); lab.push(t.row.topped && t.row.first_go); gr.push(t.row.gradeR); per.push(t.row.first >= splitDate); }
      const sel = (mask) => { const idx = z.map((_, i) => i).filter(i => mask(i)); return [idx.map(i => z[i]), idx.map(i => lab[i]), idx.map(i => gr[i])]; };
      const [z1, l1, g1] = sel(i => !per[i]), [z2, l2, g2] = sel(i => per[i]);
      const c1 = z1.length >= 8 ? stratContrast(z1, l1, g1, nPerm) : { obs: NaN, p: NaN };
      const c2 = z2.length >= 8 ? stratContrast(z2, l2, g2, nPerm) : { obs: NaN, p: NaN };
      let inter = { obs: NaN, p: NaN };
      if (z1.length >= 8 && z2.length >= 8) {
        const delta = (pp) => { const s = [[0, 0, 0, 0], [0, 0, 0, 0]]; // [block][lab*2 + (0=sum,1=n)] packed below
          const acc = [[[0, 0], [0, 0]], [[0, 0], [0, 0]]];
          for (let i = 0; i < z.length; i++) { const b = pp[i] ? 1 : 0, l = lab[i] ? 1 : 0; acc[b][l][0] += z[i]; acc[b][l][1]++; }
          const m = (b, l) => acc[b][l][1] ? acc[b][l][0] / acc[b][l][1] : NaN;
          return (m(1, 1) - m(1, 0)) - (m(0, 1) - m(0, 0)); };
        const obs = delta(per);
        const cells = {}; for (let i = 0; i < z.length; i++) (cells[gr[i] + "|" + lab[i]] ||= []).push(i);
        const cl = Object.values(cells).filter(c => c.length > 1); const rnd = mulberry32(714); const perm = per.slice(); let ge = 0;
        for (let k = 0; k < nPerm; k++) { for (const ix of cl) shuffleInPlace(perm, ix, rnd); const d = delta(perm); if (!Number.isNaN(d) && Math.abs(d) >= Math.abs(obs) - 1e-12) ge++; }
        inter = { obs, p: (1 + ge) / (nPerm + 1) };
      }
      out.push({ key: ax.key, label: ax.label, n1: z1.length, n2: z2.length, c1, c2, inter });
    }
    return out;
  }
  function recommend(prof, data, index, loggedSet, opts = {}) {
    // data-driven direction (as climbkit.recommend): the user's most adverse significant axis decides what a "trainer" is
    const sig = prof.axes.filter(a => !Number.isNaN(a.p) && a.q < 0.05 && a.obs < 0).sort((a, b) => a.q - b.q || a.obs - b.obs);   // most reliably resolved adverse axis
    const axis = sig[0] || prof.axes.filter(a => !Number.isNaN(a.obs)).sort((a, b) => a.obs - b.obs)[0];
    if (!axis || prof.ceiling === null) return { axis: null, picks: [], trainers: [] };
    const modal = prof.modal, ceil = prof.ceiling;
    const pool = data.climbs.filter(c => c.g[modal] && !loggedSet.has(c.u) && c.g[modal][2] >= (opts.minQuality ?? 2.7) && c.g[modal][1] >= (opts.minAsc ?? 30));
    const withZ = (c) => { const gR = Math.round(c.g[modal][0]); return { c, gR, z: Object.fromEntries(AXES.map(ax => [ax.key, zAgainst(data, ax.key, ax.from(c), gR)])) }; };
    const picks = pool.filter(c => { const g = Math.round(c.g[modal][0]); return g >= ceil && g <= ceil + 1; }).map(withZ)
      .filter(x => x.z[axis.key] !== null).sort((a, b) => a.z[axis.key] - b.z[axis.key]).slice(0, opts.n || 12);
    const trainers = pool.filter(c => { const g = Math.round(c.g[modal][0]); return g >= ceil - 4 && g <= ceil - 2; }).map(withZ)
      .filter(x => x.z[axis.key] !== null && AXES.every(ax => ax.key === axis.key || x.z[ax.key] === null || Math.abs(x.z[ax.key]) < 1.0))
      .sort((a, b) => b.z[axis.key] - a.z[axis.key]).slice(0, opts.n || 12);
    return { axis, picks, trainers, angle: modal, ceiling: ceil };
  }

  return { W, BRIDGE_OK, EXT_OK, athlete, parseFrames, badZTable, Problem, explainGrade, stratContrast, bhFdr, mean, sd,
           buildIndex, resolveName, resolveUuid, gradeAt, parseCSV, parseLogbook, career, profile, blockSplit, recommend, AXES, zAgainst };
});
