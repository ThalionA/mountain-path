/* trail-analysis.js — analyse a batch of your own trail runs.
 *
 * Pure functions on routes built by KJ.buildRoute (kilian-model.js). Loads in
 * the browser (window.TA) and node (module.exports) — needs KJ in scope.
 *
 * Every power figure here is the model's *implied* metabolic power: the cost
 * of the ground you covered (gradient, altitude, terrain) divided by the time
 * you took. "Per beat" divides that by heart-rate reserve used (HR − rest),
 * which removes most of the effort difference between an easy day and a hard
 * one and is the closest thing to a fitness signal these files contain.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./kilian-model.cjs'));
  else root.TA = factory(root.KJ);
})(typeof self !== 'undefined' ? self : this, function (KJ) {
  'use strict';

  // Reference athletes. Kilian comes from the calibrated fit; the club runner
  // is SYNTHETIC: Minetti-average uphill economy, ordinary descending, a
  // ~41 min 10 km engine, normal endurance decay.
  const CLUB = { key: 'club', name: 'Good club runner (synthetic)', P1: 13.5, k: 0.11, u: 1.0, d: 1.6 };

  const GRADE_BINS = [
    { lo: -1, hi: -0.25, label: '< −25 %' }, { lo: -0.25, hi: -0.15, label: '−25…−15 %' }, { lo: -0.15, hi: -0.08, label: '−15…−8 %' },
    { lo: -0.08, hi: -0.03, label: '−8…−3 %' }, { lo: -0.03, hi: 0.03, label: 'flat' }, { lo: 0.03, hi: 0.08, label: '3…8 %' },
    { lo: 0.08, hi: 0.15, label: '8…15 %' }, { lo: 0.15, hi: 0.25, label: '15…25 %' }, { lo: 0.25, hi: 1, label: '> 25 %' },
  ];
  const binOf = g => { for (let i = 0; i < GRADE_BINS.length; i++) if (g < GRADE_BINS[i].hi) return i; return GRADE_BINS.length - 1; };
  const binMid = b => Math.max(-0.35, Math.min(0.35, (b.lo + b.hi) / 2));

  const wmedian = arr => { // [[value, weight]]
    if (!arr.length) return NaN;
    arr.sort((a, b) => a[0] - b[0]);
    const tot = arr.reduce((s, x) => s + x[1], 0); let c = 0;
    for (const [v, w] of arr) { c += w; if (c >= tot / 2) return v; }
    return arr[arr.length - 1][0];
  };

  // Usable 50 m segments of a run with implied power. athlete: {u, d, hrRest, hrMax}
  function segments(route, athlete, terrain = 'trail') {
    const out = [];
    let prev = 0, tcum = 0;
    for (const s of route.segs) {
      const dt = s.tYou - prev; prev = s.tYou;
      const v = s.len / dt;
      if (!(dt > 0 && v > 0.4 && v < 8)) continue;
      const C = KJ.cost(s.grade, terrain, athlete.u, athlete.d);
      const P = s.len * C / KJ.altFactor(s.alt) / dt;
      const hrOK = route.hasHR && s.hr > athlete.hrRest + 15;
      tcum += dt;
      out.push({ len: s.len, grade: s.grade, alt: s.alt, dt, v, P, hr: hrOK ? s.hr : NaN, beat: hrOK ? P / (s.hr - athlete.hrRest) : NaN,
        veq: P / KJ.cost(0, terrain, athlete.u, athlete.d), t: tcum, d: s.d1, cad: s.cad, vam: (s.e1 - s.e0) / dt * 3600 });
    }
    return out;
  }

  const wmean = (segs, f, w = s => s.dt) => { let a = 0, b = 0; for (const s of segs) { const x = f(s); if (Number.isFinite(x)) { a += x * w(s); b += w(s); } } return b ? a / b : NaN; };

  // ---------------------------------------------------------------- per run
  function summarise(route, athlete, terrain = 'trail') {
    const segs = segments(route, athlete, terrain);
    const T = segs.reduce((a, s) => a + s.dt, 0);
    const date = route.pts[0] && Number.isFinite(route.pts[0].t) ? new Date(route.pts[0].t * 1000) : null;
    const P = wmean(segs, s => s.P), beat = wmean(segs, s => s.beat), hr = wmean(segs, s => s.hr);
    const veq = wmean(segs, s => s.veq); // flat-equivalent speed
    // durability: per-beat power, second half of the run vs first half (time halves)
    let drift = NaN;
    if (route.hasHR && T >= 45 * 60) {
      const t0 = 600, mid = (t0 + T) / 2; // first 10 min dropped: HR lags effort at the start
      const h1 = segs.filter(s => s.t > t0 && s.t <= mid), h2 = segs.filter(s => s.t > mid);
      const b1 = wmean(h1, s => s.beat), b2 = wmean(h2, s => s.beat);
      if (b1 > 0 && b2 > 0) drift = b2 / b1 - 1;
    }
    const cl = climbs(route, athlete, terrain);
    const bestVAM = cl.length ? Math.max(...cl.map(c => c.vam)) : NaN;
    return { name: route.name, date, dateStr: date ? date.toISOString().slice(0, 10) : '', km: route.total / 1000, gain: route.gain, loss: route.loss,
      T, pace: T / (route.total / 1000), gapPace: veq > 0 ? 1000 / veq : NaN, P, beat, hr, hrMax: route.maxHR, drift, bestVAM, nClimbs: cl.length,
      hasHR: route.hasHR, hasCad: route.hasCad, segs, route };
  }

  // ---------------------------------------------------------------- gradient signature
  // Your speed per gradient bin relative to your flat speed (raw and
  // effort-adjusted by HR), against the reference athletes' cost curves.
  function gradientSignature(runs, athlete, refs = [], terrain = 'trail') {
    const bins = GRADE_BINS.map(b => ({ ...b, v: [], beat: [], hr: [], time: 0, n: 0 }));
    for (const r of runs) for (const s of r.segs) {
      const b = bins[binOf(s.grade)];
      b.v.push([s.v, s.dt]); b.time += s.dt; b.n++;
      if (Number.isFinite(s.beat)) { b.beat.push([s.beat, s.dt]); b.hr.push([s.hr, s.dt]); }
    }
    const rows = bins.map(b => ({ label: b.label, lo: b.lo, hi: b.hi, mid: binMid(b), v: wmedian(b.v), beat: wmedian(b.beat), hr: wmedian(b.hr), time: b.time, n: b.n }));
    const flat = rows[4];
    for (const r of rows) {
      r.rel = r.v / flat.v;
      // effort-adjusted: scale speed by (flat HR reserve / this bin's HR reserve)
      r.relAdj = Number.isFinite(r.hr) && Number.isFinite(flat.hr) ? r.rel * (flat.hr - athlete.hrRest) / (r.hr - athlete.hrRest) : NaN;
      r.ref = {};
      for (const ref of refs) r.ref[ref.key] = KJ.cost(0, terrain, ref.u, ref.d) / KJ.cost(r.mid, terrain, ref.u, ref.d);
      r.model = KJ.cost(0, terrain, athlete.u, athlete.d) / KJ.cost(r.mid, terrain, athlete.u, athlete.d);
    }
    return rows;
  }

  // ---------------------------------------------------------------- power–duration
  const WINDOWS = [5, 10, 20, 30, 45, 60, 90, 120, 180];
  function powerDuration(runs, windows = WINDOWS) {
    const out = windows.map(m => ({ min: m, P: NaN, beat: NaN, run: null, runBeat: null }));
    for (const r of runs) {
      const s = r.segs; if (!s.length) continue;
      // prefix sums of time, energy, beat-weighted energy
      const n = s.length, ct = new Float64Array(n + 1), ce = new Float64Array(n + 1), cb = new Float64Array(n + 1), cbt = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) {
        ct[i + 1] = ct[i] + s[i].dt; ce[i + 1] = ce[i] + s[i].P * s[i].dt;
        const ok = Number.isFinite(s[i].beat);
        cb[i + 1] = cb[i] + (ok ? s[i].P * s[i].dt : 0); cbt[i + 1] = cbt[i] + (ok ? (s[i].hr - r.hrRestUsed) * s[i].dt : 0);
      }
      for (const w of out) {
        const W = w.min * 60; if (ct[n] < W) continue;
        let j = 0, bestP = 0, bestB = 0;
        for (let i = 0; i < n; i++) {
          while (j <= n && ct[j] - ct[i] < W) j++;
          if (j > n) break;
          const P = (ce[j] - ce[i]) / (ct[j] - ct[i]);
          if (P > bestP) bestP = P;
          const bt = cbt[j] - cbt[i];
          if (bt > 0 && (cbt[j] - cbt[i]) / (ct[j] - ct[i]) > 20) { const B = (cb[j] - cb[i]) / bt; if (B > bestB) bestB = B; }
        }
        if (bestP > (w.P || 0)) { w.P = bestP; w.run = r; }
        if (bestB > (w.beat || 0)) { w.beat = bestB; w.runBeat = r; }
      }
    }
    // fit P1, k on the raw best-power points that exist
    const pts = out.filter(w => w.P > 0);
    let P1 = NaN, k = NaN;
    if (pts.length >= 3) {
      const xs = pts.map(w => Math.log(w.min / 60)), ys = pts.map(w => Math.log(w.P));
      const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
      let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
      k = -sxy / sxx; P1 = Math.exp(my + k * mx);
    }
    return { points: out, P1, k };
  }

  // ---------------------------------------------------------------- climbs
  function climbs(route, athlete, terrain = 'trail', minGain = 100) {
    const legs = KJ.splitLegs(route, 40, 300).filter(l => l.kind === 'climb' && l.gain >= minGain);
    const rows = [];
    for (const l of legs) {
      const t0 = l.a ? route.segs[l.a - 1].tYou : 0, t1 = route.segs[l.b].tYou, T = t1 - t0;
      if (!(T > 0)) continue;
      const segs = route.segs.slice(l.a, l.b + 1);
      let hrs = 0, hrw = 0, prev = t0;
      for (const s of segs) { const dt = s.tYou - prev; prev = s.tYou; if (route.hasHR && s.hr > 0 && dt > 0) { hrs += s.hr * dt; hrw += dt; } }
      const hr = hrw ? hrs / hrw : NaN;
      rows.push({ run: route.name, date: route.pts[0] && Number.isFinite(route.pts[0].t) ? new Date(route.pts[0].t * 1000).toISOString().slice(0, 10) : '',
        atKm: l.d0 / 1000, len: l.len, gain: l.gain, grade: l.grade, T, vam: l.gain / (T / 3600), hr,
        vamBeat: Number.isFinite(hr) ? l.gain / (T / 3600) / (hr - athlete.hrRest) : NaN });
    }
    return rows;
  }

  // ---------------------------------------------------------------- trends
  const METRICS = [
    { key: 'beat', label: 'Power per heartbeat (W/kg per bpm above rest)', fmt: v => v.toFixed(3), higher: true, hr: true },
    { key: 'gapPace', label: 'Flat-equivalent pace (min/km)', fmt: v => Math.floor(v / 60) + ':' + String(Math.round(v % 60)).padStart(2, '0'), higher: false },
    { key: 'P', label: 'Implied power (W/kg)', fmt: v => v.toFixed(1), higher: true },
    { key: 'hr', label: 'Average HR (bpm)', fmt: v => v.toFixed(0), higher: null, hr: true },
    { key: 'drift', label: 'Durability: 2nd half vs 1st half per-beat power (%)', fmt: v => (v * 100).toFixed(1), higher: true, hr: true },
    { key: 'bestVAM', label: 'Best climb VAM in the run (m/h)', fmt: v => v.toFixed(0), higher: true },
    { key: 'km', label: 'Distance (km)', fmt: v => v.toFixed(1), higher: null },
    { key: 'gain', label: 'Ascent (m)', fmt: v => v.toFixed(0), higher: null },
    { key: 'T', label: 'Moving time (min)', fmt: v => (v / 60).toFixed(0), higher: null },
  ];
  function trends(runs) {
    const dated = runs.filter(r => r.date).sort((a, b) => a.date - b.date);
    const series = {};
    for (const m of METRICS) {
      const pts = dated.map(r => ({ x: r.date, y: r[m.key], run: r })).filter(p => Number.isFinite(p.y));
      // rolling median of 5
      pts.forEach((p, i) => { const w = pts.slice(Math.max(0, i - 4), i + 1).map(q => [q.y, 1]); p.roll = wmedian(w); });
      series[m.key] = pts;
    }
    // weekly volume
    const weeks = new Map();
    for (const r of dated) {
      const d = new Date(r.date); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); d.setUTCHours(0, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      const w = weeks.get(key) || { week: key, x: d, km: 0, gain: 0, hours: 0, n: 0 };
      w.km += r.km; w.gain += r.gain; w.hours += r.T / 3600; w.n++; weeks.set(key, w);
    }
    return { series, weeks: [...weeks.values()].sort((a, b) => a.x - b.x) };
  }

  // ---------------------------------------------------------------- gap decomposition
  // Minutes between you and a reference on a course, attributed to engine
  // (P1), endurance (k), climbing economy (u) and descending (d). Two orders
  // of sequential substitution, averaged (cheap Shapley).
  function gapDecomposition(courseSegs, terrain, you, ref) {
    const T = a => KJ.predict(courseSegs, terrain, { P1: a.P1, k: a.k, u: a.u, d: a.d, effort: 1 }).T;
    const keys = ['P1', 'k', 'u', 'd'];
    const orders = [keys, keys.slice().reverse()];
    const contrib = { P1: 0, k: 0, u: 0, d: 0 };
    for (const order of orders) {
      let cur = { ...you }, tPrev = T(cur);
      for (const key of order) { cur = { ...cur, [key]: ref[key] }; const t = T(cur); contrib[key] += (tPrev - t) / orders.length; tPrev = t; }
    }
    return { you: T(you), ref: T(ref), parts: [
      { key: 'P1', label: 'engine (flat power)', secs: contrib.P1 }, { key: 'k', label: 'endurance (decay with duration)', secs: contrib.k },
      { key: 'u', label: 'climbing economy', secs: contrib.u }, { key: 'd', label: 'descending', secs: contrib.d } ] };
  }

  // ---------------------------------------------------------------- everything
  const HIKE_TYPES = /hik|walk|mountaineer|trek|ski/;
  function isHike(route) {
    if (HIKE_TYPES.test(route.type || '')) return true;
    // no type: a "run" whose implied power is below ~6.5 W/kg for its duration is a walk
    const T = route.movingTime; if (!(T > 0)) return false;
    const P = KJ.work(route.segs, 'trail', 0.8, 1.3).A / T;
    return P < 6.5;
  }
  function analyse(routes, opts = {}) {
    const dropped = [];
    const usable = routes.filter(r => { if (!(r.hasTime && r.segs.length > 20)) { dropped.push({ name: r.name, why: 'no timestamps' }); return false; }
      if (!opts.keepHikes && isHike(r)) { dropped.push({ name: r.name, why: 'looks like a hike' }); return false; } return true; });
    if (!usable.length) return null;
    const fit = KJ.fitYou(usable, { hrMax: opts.hrMax || 0, hrRest: opts.hrRest || 55, k: opts.k, anchor: opts.anchor });
    const athlete = { P1: fit.P1, k: fit.k, u: fit.u, d: fit.d, hrRest: fit.hrRest, hrMax: fit.hrMax };
    const terrain = opts.terrain || 'trail';
    const runs = usable.map(r => { const s = summarise(r, athlete, terrain); s.hrRestUsed = fit.hrRest; return s; });
    const pd = powerDuration(runs);
    // endurance decay k is better defined by your best efforts by duration than by whole-run means
    if (Number.isFinite(pd.k) && pd.k > 0.06 && pd.k < 0.16) { athlete.k = pd.k; athlete.kFrom = 'your best efforts by duration'; }
    else { athlete.k = 0.10; athlete.kFrom = 'assumed — your best efforts do not fall off cleanly with duration, which needs hard efforts at several durations'; athlete.kWeak = true; }
    if (Number.isFinite(fit.P1anchor)) { // re-anchor with the final k
      const a = opts.anchor, run = a.km * 1000, g = a.gain || 0;
      const A = g > 0 ? KJ.work([{ len: run - g / 0.08, grade: 0, alt: 200 }, { len: g / 0.08, grade: 0.08, alt: 200 }], 'road', fit.u, fit.d).A : run * KJ.cost(0, 'road', fit.u, fit.d);
      athlete.P1 = A * Math.pow(3600, -athlete.k) / Math.pow(a.secs, 1 - athlete.k); athlete.P1From = 'your race result';
    } else athlete.P1From = 'HR-scaled runs';
    athlete.hrMaxTyped = !!opts.hrMax;
    const refs = [{ key: 'kilian', name: 'Kilian', ...(opts.kilian || {}), d: 1 }, CLUB];
    return { fit, athlete, runs, dropped, terrain, refs,
      signature: gradientSignature(runs, athlete, refs, terrain),
      pd,
      climbs: usable.flatMap(r => climbs(r, athlete, terrain)).sort((a, b) => b.vam - a.vam),
      trends: trends(runs) };
  }

  // Plain-language reading of the gradient signature vs a reference's shape.
  function verdicts(sig, refKey = 'kilian') {
    const grp = (lo, hi) => { const rows = sig.filter(b => b.mid >= lo && b.mid <= hi && Number.isFinite(b.relAdj) && b.n >= 30); if (!rows.length) return null;
      const w = rows.reduce((a, b) => a + b.time, 0); return rows.reduce((a, b) => a + (b.relAdj / b.ref[refKey]) * b.time, 0) / w; };
    const groups = [
      { key: 'steepUp', label: 'steep climbing (> 15 %)', r: grp(0.15, 1) }, { key: 'up', label: 'runnable climbing (3–15 %)', r: grp(0.03, 0.15) },
      { key: 'down', label: 'runnable descending (−3…−15 %)', r: grp(-0.15, -0.03) }, { key: 'steepDown', label: 'steep descending (< −15 %)', r: grp(-1, -0.15) },
    ].filter(g => g.r);
    groups.sort((a, b) => b.r - a.r);
    return groups.map(g => ({ ...g, pct: (g.r - 1) * 100 }));
  }
  // ---------------------------------------------------------------- report card
  const paceStr = secPerKm => { if (!Number.isFinite(secPerKm)) return '–'; const t = Math.round(secPerKm); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const vamOf = (v, g) => v * g / Math.sqrt(1 + g * g) * 3600;
  const WALK_CAD = 62; // Garmin cadence is one foot: < 62 (124 steps/min) is walking

  // dt-weighted linear fit y = b0 + b1·x
  function wfit(pts) { let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0; for (const [x, y, w] of pts) { sw += w; sx += w * x; sy += w * y; sxx += w * x * x; sxy += w * x * y; }
    if (sw <= 0) return null; const mx = sx / sw, my = sy / sw, vx = sxx / sw - mx * mx; if (vx <= 0) return null; const b1 = (sxy / sw - mx * my) / vx; return { b0: my - b1 * mx, b1, n: pts.length, mx }; }

  function report(A, opts = {}) {
    const a = A.athlete, runs = A.runs, terrain = A.terrain;
    const refFrac = opts.refFrac || 0.80, refHR = Math.round(refFrac * a.hrMax);
    const kil = A.refs[0], club = A.refs[1];
    const refPace = (ath, g) => { const P = KJ.power(3600, ath.P1, ath.k); return 1000 / (P / KJ.cost(g, terrain, ath.u, ath.d)); };
    const refVam = (ath, g) => { const P = KJ.power(3600, ath.P1, ath.k); return vamOf(P / KJ.cost(g, terrain, ath.u, ath.d), g); };
    const all = runs.flatMap(r => r.segs.map(s => ({ ...s, run: r })));

    // ---- engine: flat-equivalent pace at the reference HR
    const engPts = r => r.segs.filter(s => Number.isFinite(s.hr) && s.hr > a.hrRest + 30 && Math.abs(s.grade) < 0.12).map(s => [s.hr, s.veq, s.dt]);
    const paceAt = (fit, hr, lo, hi) => (fit && hr >= lo - 8 && hr <= hi + 8 && fit.b1 > 0) ? 1000 / (fit.b0 + fit.b1 * hr) : NaN;
    const pooled = wfit(runs.flatMap(engPts));
    // Per run: fit speed against heart rate and read it at the reference HR. A steady
    // run has too little HR spread for its own slope, so fall back to the pooled slope
    // applied to that run's own mean — a short, honest adjustment rather than no point.
    const engineSeries = runs.filter(r => r.date && r.hasHR).map(r => { const pts = engPts(r); if (pts.length < 20) return null;
      const hrs = pts.map(p => p[0]); const f = wfit(pts);
      let pace = paceAt(f, refHR, Math.min(...hrs), Math.max(...hrs)), how = 'own slope';
      if (!Number.isFinite(pace) && pooled) {
        let sw = 0, sh = 0, sv = 0; for (const [hr, v, w] of pts) { sw += w; sh += w * hr; sv += w * v; }
        const mh = sh / sw, mv = sv / sw;
        if (Math.abs(refHR - mh) <= 15) { const v = mv + pooled.b1 * (refHR - mh); pace = v > 0 ? 1000 / v : NaN; how = 'pooled slope'; }
      }
      return Number.isFinite(pace) && pace > 120 && pace < 1200 ? { date: r.date, dateStr: r.dateStr, y: pace, run: r, how } : null; }).filter(Boolean).sort((x, y) => x.date - y.date);
    const engPace = pooled ? paceAt(pooled, refHR, 0, 999) : NaN;
    const recent = engineSeries.slice(-4), early = engineSeries.slice(0, Math.max(1, Math.min(4, engineSeries.length - 4)));
    const med = arr => wmedian(arr.map(x => [x.y, 1]));
    const engine = { refHR, refFrac, pace: engPace, series: engineSeries, recent: recent.length ? med(recent) : NaN, early: early.length && engineSeries.length >= 6 ? med(early) : NaN,
      hrPerSecPerKm: pooled ? pooled.b1 : NaN, kilian: refPace(kil, 0), club: refPace(club, 0) };

    // ---- climbing: per grade band from climbing segments; walk/run from cadence
    const bands = [{ key: 'run', lo: 0.08, hi: 0.15, label: '8–15 %' }, { key: 'steep', lo: 0.15, hi: 0.25, label: '15–25 %' }, { key: 'vsteep', lo: 0.25, hi: 1, label: '> 25 %' }];
    const anyCad = runs.some(r => r.hasCad);
    const climbing = { bands: bands.map(b => {
      const segs = all.filter(s => s.grade >= b.lo && s.grade < b.hi);
      const time = segs.reduce((x, s) => x + s.dt, 0);
      const vam = wmedian(segs.map(s => [s.vam, s.dt])), hr = wmedian(segs.filter(s => Number.isFinite(s.hr)).map(s => [s.hr, s.dt]));
      const walk = anyCad ? segs.filter(s => Number.isFinite(s.cad)) : [];
      const walkTime = walk.filter(s => s.cad < WALK_CAD).reduce((x, s) => x + s.dt, 0), cadTime = walk.reduce((x, s) => x + s.dt, 0);
      const vamRun = wmedian(walk.filter(s => s.cad >= WALK_CAD).map(s => [s.vam, s.dt])), vamWalk = wmedian(walk.filter(s => s.cad < WALK_CAD).map(s => [s.vam, s.dt]));
      const hrRun = wmedian(walk.filter(s => s.cad >= WALK_CAD && Number.isFinite(s.hr)).map(s => [s.hr, s.dt])), hrWalk = wmedian(walk.filter(s => s.cad < WALK_CAD && Number.isFinite(s.hr)).map(s => [s.hr, s.dt]));
      // paired within-gradient comparison
      const diffs = [];
      for (let g = b.lo; g < Math.min(b.hi, 0.5); g += 0.02) {
        const sub = walk.filter(s => s.grade >= g && s.grade < g + 0.02);
        const rr = sub.filter(s => s.cad >= WALK_CAD), ww = sub.filter(s => s.cad < WALK_CAD);
        const tr = rr.reduce((x, s) => x + s.dt, 0), tw = ww.reduce((x, s) => x + s.dt, 0);
        if (tr > 60 && tw > 60) diffs.push([wmedian(rr.map(s => [s.vam, s.dt])) - wmedian(ww.map(s => [s.vam, s.dt])), Math.min(tr, tw)]);
      }
      const walkCost = diffs.length ? wmedian(diffs) : NaN;   // m/h lost by hiking, gradient held
      const g = (b.lo + Math.min(b.hi, 0.35)) / 2;
      return { ...b, time, n: segs.length, vam, hr, walkShare: cadTime ? walkTime / cadTime : NaN, vamRun, vamWalk, hrRun, hrWalk, walkCost, kilian: refVam(kil, g), club: refVam(club, g) };
    }), anyCad };
    const bestClimbs = { small: A.climbs.filter(c => c.gain < 200)[0] || null, mid: A.climbs.filter(c => c.gain >= 200 && c.gain < 400)[0] || null, big: A.climbs.filter(c => c.gain >= 400)[0] || null };
    climbing.best = bestClimbs;
    climbing.series = runs.filter(r => r.date && Number.isFinite(r.bestVAM)).sort((x, y) => x.date - y.date).map(r => ({ date: r.date, dateStr: r.dateStr, y: r.bestVAM, run: r }));
    const w = climbing.bands.filter(b => Number.isFinite(b.walkShare) && b.time > 300);
    const wf = w.find(b => b.walkShare > 0.5);
    climbing.walkFrom = wf ? wf.label : null; climbing.runsAll = !wf && w.length > 0 && w.every(b => b.walkShare < 0.2);

    // ---- descending: pace vs flat, braking (speed variability within descent legs)
    const flatV = wmedian(all.filter(s => Math.abs(s.grade) < 0.03).map(s => [s.v, s.dt]));
    const dband = (lo, hi) => { const segs = all.filter(s => s.grade >= lo && s.grade < hi); const v = wmedian(segs.map(s => [s.v, s.dt]));
      return { v, pace: 1000 / v, ratio: v / flatV, hr: wmedian(segs.filter(s => Number.isFinite(s.hr)).map(s => [s.hr, s.dt])), time: segs.reduce((x, s) => x + s.dt, 0), n: segs.length }; };
    const gentle = dband(-0.15, -0.08), steep = dband(-1, -0.15);
    const refRatio = (ath, g) => KJ.cost(0, terrain, ath.u, ath.d) / KJ.cost(g, terrain, ath.u, ath.d);
    let cvs = [];
    for (const r of runs) { const legs = KJ.splitLegs(r.route, 40, 300).filter(l => l.kind === 'descent' && l.loss >= 80);
      for (const l of legs) { const segs = r.segs.filter(s => s.d > l.d0 && s.d <= l.d1); if (segs.length < 6) continue;
        const m = wmean(segs, s => s.v); let v2 = 0, sw = 0; for (const s of segs) { v2 += s.dt * (s.v - m) ** 2; sw += s.dt; } cvs.push(Math.sqrt(v2 / sw) / m); } }
    const descending = { flatPace: 1000 / flatV, gentle, steep, braking: cvs.length ? wmedian(cvs.map(c => [c, 1])) : NaN, nLegs: cvs.length,
      kilianGentle: refRatio(kil, -0.11), kilianSteep: refRatio(kil, -0.22), clubGentle: refRatio(club, -0.11), clubSteep: refRatio(club, -0.22),
      series: runs.filter(r => r.date).sort((x, y) => x.date - y.date).map(r => { const segs = r.segs.filter(s => s.grade < -0.08), f = r.segs.filter(s => Math.abs(s.grade) < 0.03);
        if (segs.length < 10 || f.length < 10) return null; return { date: r.date, dateStr: r.dateStr, y: wmedian(segs.map(s => [s.v, s.dt])) / wmedian(f.map(s => [s.v, s.dt])), run: r }; }).filter(Boolean) };

    // ---- durability
    const drifts = runs.filter(r => Number.isFinite(r.drift));
    const lateClimb = (() => { const first = [], last = []; for (const r of runs) { if (!r.hasHR || r.T < 3600) continue; const T = r.T;
      for (const s of r.segs) { if (s.grade < 0.06 || !Number.isFinite(s.hr) || s.hr < a.hrRest + 40) continue; const vb = s.vam / (s.hr - a.hrRest); if (s.t < T / 3) first.push([vb, s.dt]); else if (s.t > 2 * T / 3) last.push([vb, s.dt]); } }
      return first.length > 20 && last.length > 20 ? wmedian(last) / wmedian(first) - 1 : NaN; })();
    const durability = { drift: drifts.length ? wmedian(drifts.map(r => [r.drift, 1])) : NaN, n: drifts.length, lateClimb, longest: Math.max(...runs.map(r => r.T)),
      series: drifts.filter(r => r.date).sort((x, y) => x.date - y.date).map(r => ({ date: r.date, dateStr: r.dateStr, y: r.drift * 100, run: r })) };

    // ---- intensity mix (time in HR bands, % of max)
    const IB = [{ lo: 0, hi: 0.7, label: 'easy < 70 %' }, { lo: 0.7, hi: 0.78, label: '70–78 %' }, { lo: 0.78, hi: 0.88, label: '78–88 % (moderate)' }, { lo: 0.88, hi: 0.95, label: '88–95 % (hard)' }, { lo: 0.95, hi: 2, label: '> 95 %' }];
    const hrSegs = all.filter(s => Number.isFinite(s.hr)); const hrTot = hrSegs.reduce((x, s) => x + s.dt, 0);
    const intensity = { total: hrTot, bands: IB.map(b => { const t = hrSegs.filter(s => s.hr / a.hrMax >= b.lo && s.hr / a.hrMax < b.hi).reduce((x, s) => x + s.dt, 0); return { ...b, time: t, share: hrTot ? t / hrTot : NaN }; }),
      runs: runs.filter(r => Number.isFinite(r.hr)).map(r => ({ dateStr: r.dateStr, name: r.name, frac: r.hr / a.hrMax, T: r.T })) };

    // ---- personal bests
    const pd = A.pd.points;
    const pbs = { efforts: pd.filter(p => p.P > 0 && [5, 10, 20, 60].includes(p.min)).map(p => ({ min: p.min, pace: 1000 / (p.P / KJ.cost(0, terrain, a.u, a.d)), run: p.run })),
      climbs: bestClimbs, longest: runs.slice().sort((x, y) => y.T - x.T)[0], mostVert: runs.slice().sort((x, y) => y.gain - x.gain)[0],
      bestDescent: (() => { let best = null; for (const r of runs) for (const l of KJ.splitLegs(r.route, 40, 300)) { if (l.kind !== 'descent' || l.loss < 100) continue;
        const t0 = l.a ? r.route.segs[l.a - 1].tYou : 0, T = r.route.segs[l.b].tYou - t0; if (!(T > 0)) continue; const pace = T / (l.len / 1000);
        if (!best || pace < best.pace) best = { run: r, pace, len: l.len, loss: l.loss, grade: l.grade, T }; } return best; })() };

    // ---- readings and prescriptions (plain language, rule-based)
    const readings = {};
    readings.engine = Number.isFinite(engine.pace) ? `Flat-equivalent pace ${paceStr(engine.pace)} /km at ${refHR} bpm (${Math.round(refFrac * 100)} % of max).` + (Number.isFinite(engine.early) && Number.isFinite(engine.recent) ? ` Last four runs ${paceStr(engine.recent)}, first four ${paceStr(engine.early)}: ${engine.recent < engine.early - 5 ? 'faster at the same heart rate — fitness is up.' : engine.recent > engine.early + 5 ? 'slower at the same heart rate — fatigue, heat, or lost fitness.' : 'unchanged.'}` : '') : 'Needs runs with heart rate.';
    const modShare = intensity.bands[2].share, hardShare = (intensity.bands[3].share || 0) + (intensity.bands[4].share || 0);
    readings.engineDo = hardShare < 0.1 ? `Only ${Math.round(hardShare * 100)} % of your recorded time is above 88 % of max: one session a week of 20–30 min at 88–92 % (or 5 × 4 min) is what moves this number.` : 'You already do hard work; hold it and let volume grow.';
    const sb = climbing.bands[1], rb = climbing.bands[0];
    readings.climbing = Number.isFinite(sb.vam) ? `On 15–25 % you climb at ${Math.round(sb.vam)} m/h${Number.isFinite(sb.hr) ? ` at ${Math.round(sb.hr)} bpm` : ''}; on 8–15 % ${Math.round(rb.vam)} m/h.` + (climbing.runsAll ? ' Cadence says you run everything, even above 25 %.' : '') + (climbing.walkFrom ? ` Cadence says you switch to hiking from ${climbing.walkFrom}${Number.isFinite(sb.walkCost) ? `; at the same gradient, hiking is ${Math.abs(Math.round(sb.walkCost)) < 30 ? 'worth about the same as running it' : Math.abs(Math.round(sb.walkCost)) + ' m/h ' + (sb.walkCost > 0 ? 'slower than running it' : 'faster than running it — on this ground hiking is the right call')}${Number.isFinite(sb.hrWalk) && Number.isFinite(sb.hrRun) ? `, for ${Math.abs(Math.round(sb.hrRun - sb.hrWalk))} bpm ${sb.hrRun > sb.hrWalk ? 'less' : 'more'}` : ''}.` : '.'}` : '') : 'Not enough climbing in these runs.';
    readings.climbingDo = 'Hill repeats on the grade you lose most: 6–8 × 3–4 min at 88–92 % of max, jog down. Practise a fast hands-on-knees hike on > 20 %: it should be within ~15 % of your running climb rate at the same heart rate.';
    const vs = r => `${Math.abs(Math.round((r - 1) * 100))} % ${r >= 1 ? 'faster' : 'slower'} than flat`;
    readings.descending = Number.isFinite(gentle.ratio) ? `Gentle descents (−8…−15 %) at ${paceStr(gentle.pace)} /km, ${vs(gentle.ratio)} (${paceStr(descending.flatPace)}); steep (< −15 %) at ${paceStr(steep.pace)}, ${vs(steep.ratio)}.` + (Number.isFinite(descending.braking) ? ` Speed varies ${Math.round(descending.braking * 100)} % within descents (${descending.nLegs} legs) — ${descending.braking > 0.28 ? 'a lot of braking and re-accelerating.' : descending.braking > 0.2 ? 'some braking.' : 'smooth.'}` : '') : 'Not enough descending in these runs.';
    readings.descendingDo = steep.ratio < 0.85 || descending.braking > 0.25 ? 'Short technique reps on a steep, rough descent you know: 6 × 1 min relaxed and quick-footed, walk back up. Look 3–4 m ahead, shorter steps, let the hips fall.' : 'Descending is not where your time goes. Keep the skill with one rough descent a week.';
    readings.durability = Number.isFinite(durability.drift) ? `Per-beat power in the second half of runs is ${durability.drift >= 0 ? '+' : ''}${Math.round(durability.drift * 100)} % vs the first (median of ${durability.n} runs over 45 min).` + (Number.isFinite(lateClimb) ? ` Climb rate per heartbeat in the last third of runs over an hour: ${lateClimb >= 0 ? '+' : ''}${Math.round(lateClimb * 100)} % vs the first third.` : '') + ` Longest run in the batch ${Math.round(durability.longest / 60)} min.` : 'Needs runs over 45 min with heart rate.';
    readings.durabilityDo = durability.drift < -0.05 ? 'You fade. One long run every 1–2 weeks at 70–78 % of max, fuelled from the first hour, is the fix; extend it by 15 min a time.' : durability.longest < 2 * 3600 ? 'You hold together, but nothing here is longer than two hours. The curve past that is a guess until you run it.' : 'Solid. Keep the long run in.';
    readings.intensity = hrTot ? `${Math.round((intensity.bands[0].share + intensity.bands[1].share) * 100)} % of your recorded time is below 78 % of max, ${Math.round(modShare * 100)} % is 78–88 %, ${Math.round(hardShare * 100)} % is above 88 %.` : 'Needs heart rate.';
    readings.intensityDo = modShare > 0.5 ? 'More than half of your trail time sits in the moderate band: hard enough to tire you, too easy to change much. Make easy days easier (under 78 %) and one day properly hard.' : hardShare > 0.25 ? 'A lot of hard time: make sure the easy days are easy.' : 'A sensible split.';

    return { refHR, refFrac, engine, climbing, descending, durability, intensity, pbs, readings };
  }

  return { CLUB, GRADE_BINS, METRICS, WINDOWS, segments, summarise, gradientSignature, powerDuration, climbs, trends, gapDecomposition, analyse, verdicts, isHike, wmedian, report, paceStr };
});
