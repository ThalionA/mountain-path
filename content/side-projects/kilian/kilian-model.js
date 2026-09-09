/* kilian-model.js — "How fast would Kilian run this?"
 *
 * Pure functions, no DOM. Loads in the browser (window.KJ) and in node
 * (module.exports) so the calibration can be checked headless.
 *
 * Model in one paragraph: a runner has a metabolic power budget P (W/kg)
 * that decays with effort duration T as P(T) = P1 · (T/1h)^-k. Moving along
 * a segment of length L at gradient i costs C(i) J/kg per metre (Minetti et
 * al. 2002 uphill, an empirical braking curve downhill), multiplied by a
 * terrain factor and divided by an altitude factor f(alt) on the power side.
 * Time = Σ L·C / (P·f). Because P depends on T only through the total, the
 * fixed point has a closed form. P1 and k are fitted to Kilian's real
 * recorded efforts (REFS below); everything else is fixed a priori and the
 * residual table is shown so you can see where the model is honest and where
 * it is not.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KJ = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- cost
  // Minetti, Moia, Roi, Susta & Ferretti (2002) J Appl Physiol 93:1039.
  // Energy cost of running / walking on gradient i (rise/run), J·kg⁻¹·m⁻¹.
  function minettiRun(i) {
    return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
  }
  function minettiWalk(i) {
    return 280.5 * i ** 5 - 58.7 * i ** 4 - 76.8 * i ** 3 + 51.9 * i ** 2 + 19.6 * i + 2.5;
  }

  // Downhill: the metabolic cost keeps falling to about −20 % but nobody runs
  // at P/C there — braking, eccentric load and footing cap the speed. This is
  // an *effective* cost curve (flat = 3.6): the speed ratio to flat it implies
  // is ≈ +16 % at −5 % and −10 %, +9 % at −15 %, level at about −19 %, then
  // increasingly slow. Calibrated on Kilian — he is an exceptional descender.
  const DOWN = [
    [0.0, 3.6], [-0.05, 3.1], [-0.10, 3.1], [-0.15, 3.3], [-0.20, 3.8],
    [-0.30, 5.2], [-0.40, 7.5], [-0.60, 13.0], [-1.00, 26.0],
  ];
  function costDown(i) {
    if (i >= 0) return 3.6;
    for (let n = 1; n < DOWN.length; n++) {
      const [g1, c1] = DOWN[n - 1], [g0, c0] = DOWN[n];
      if (i >= g0) return c0 + (c1 - c0) * (i - g0) / (g1 - g0);
    }
    return DOWN[DOWN.length - 1][1];
  }

  // Uphill: running cost, blending into power-hiking (walking cost) between
  // +15 % and +35 % where elites switch to hands-on-knees.
  // `u` is the athlete's uphill economy relative to Minetti's treadmill
  // subjects (fitted; < 1 means the extra cost of climbing is smaller).
  function costUp(i, u = 1) {
    const cr = minettiRun(i), cw = minettiWalk(i);
    const w = Math.min(1, Math.max(0, (i - 0.15) / 0.20));
    const c = cr - w * (cr - cw);
    return 3.6 + (c - 3.6) * u;
  }

  // Terrain multipliers on cost: [flat, up, down].
  const TERRAIN = {
    road:      { label: 'Road / track',                    m: [0.97, 0.97, 0.97] },
    trail:     { label: 'Runnable trail',                  m: [1.00, 1.00, 1.00] },
    technical: { label: 'Technical trail (rocky, fell)',   m: [1.08, 1.08, 1.12] },
    alpine:    { label: 'Alpine (scrambling, fixed ropes)',m: [1.15, 1.20, 1.20] },
    glacier:   { label: 'Snow / glacier',                  m: [1.15, 1.20, 1.15] },
  };

  // `d` is descent skill: multiplies the extra cost of descending relative to
  // flat (1 = Kilian's calibrated curve; mortals are 1.2–2).
  function cost(i, terrain, u = 1, d = 1) {
    const m = (TERRAIN[terrain] || TERRAIN.trail).m;
    const down = i => 3.6 + (costDown(i) - 3.6) * d;
    if (i > 0.02) return costUp(i, u) * m[1];
    if (i < -0.02) return down(i) * m[2];
    // near-flat: blend so there is no step at ±2 %
    const c = i >= 0 ? costUp(i, u) : down(i);
    const mm = i >= 0 ? m[0] + (m[1] - m[0]) * (i / 0.02) : m[0] + (m[2] - m[0]) * (-i / 0.02);
    return c * mm;
  }

  // ---------------------------------------------------------------- altitude
  // Aerobic power available vs altitude. Wehrlin & Hallén (2006): VO2max
  // falls ≈6.3 % per 1000 m from 300 m to 2800 m; steeper above 4000 m.
  function altFactor(alt) {
    if (!(alt > 300)) return 1;
    if (alt <= 4000) return 1 - 0.063 * (alt - 300) / 1000;
    return 1 - 0.063 * 3.7 - 0.11 * (alt - 4000) / 1000;
  }

  // ---------------------------------------------------------------- core
  // segments: [{len, grade, alt}] with len in metres along the path.
  // Returns the "work" A = Σ len·C/f (J/kg-equivalent seconds·W/kg) and the
  // per-segment contributions so the caller can allocate time.
  function work(segments, terrain, u = 1, d = 1) {
    let A = 0;
    const per = new Array(segments.length);
    for (let n = 0; n < segments.length; n++) {
      const s = segments[n];
      const a = s.len * cost(s.grade, terrain, u, d) / altFactor(s.alt);
      per[n] = a; A += a;
    }
    return { A, per };
  }

  // T = A / P(T),  P(T) = P1·(T/3600)^-k  ⇒  T^(1-k) = A·3600^-k / P1
  function solveTime(A, P1, k) {
    return Math.pow(A * Math.pow(3600, -k) / P1, 1 / (1 - k));
  }

  function power(T, P1, k) { return P1 * Math.pow(T / 3600, -k); }

  // Full prediction: total time, per-segment seconds, per-segment speed.
  function predict(segments, terrain, athlete) {
    const { P1, k, u = 1, d = 1, effort = 1 } = athlete;
    const { A, per } = work(segments, terrain, u, d);
    const T = solveTime(A / effort, P1, k);
    const P = power(T, P1, k) * effort;
    const secs = per.map(a => a / P);
    return { T, P, secs, A };
  }

  // ---------------------------------------------------------------- refs
  // Kilian Jornet's recorded efforts. Distances/gains as published by the
  // race or FKT page (see the page notes for sources); grades gu/gd are the
  // typical climb/descent gradient used to build a synthetic profile when no
  // GPX is available. `fit` = used to fit P1/k; others are validation only.
  // alt: [start, top, finish]. conf: how sure we are of the course numbers.
  const REFS = [
    { key: 'hytteplanmila', name: 'Hytteplanmila 10 km road (2020)', time: '29:59', km: 10.0, gain: 50, loss: 50, gu: 0.03, gd: 0.03, alt: [150, 200, 150], terrain: 'road', fit: true, w: 1, conf: 'high',
      note: 'His first road 10 km; rolling course.' },
    { key: 'track10h', name: '24 h track attempt, first 10 h 20 (2020)', time: '10:20:00', km: 134.8, gain: 0, loss: 0, gu: 0, gd: 0, alt: [20, 20, 20], terrain: 'road', fit: true, w: 0.5, conf: 'high',
      note: 'Paced for 24 h, stopped at 10 h 20 with chest pain — a sub-maximal 10 h point, weighted ½.' },
    { key: 'fullyvk', name: 'Fully Vertical Kilometre (2020)', time: '29:51', km: 1.92, gain: 1000, loss: 0, gu: 0.52, gd: 0, alt: [500, 1500, 1500], terrain: 'trail', fit: true, w: 1, conf: 'high',
      note: '1.92 km for 1000 m — the steepest homologated VK.' },
    { key: 'sierrezinal', name: 'Sierre-Zinal (2019, CR)', time: '2:25:35', km: 31.0, gain: 2200, loss: 1100, gu: 0.18, gd: 0.15, alt: [570, 2430, 1675], terrain: 'trail', fit: true, w: 1, conf: 'high', gpx: 'courses/sierre-zinal.gpx',
      note: 'Course record. 2200 m up in the first 8 km, high balcony, 5 km plunge to Zinal. Real course profile.' },
    { key: 'geiranger', name: 'Geiranger Fra Fjord Til Fjell (2019)', time: '1:26:48', km: 21, gain: 1500, loss: 150, gu: 0.10, gd: 0.05, alt: [0, 1500, 1450], terrain: 'road', fit: true, w: 0.5, conf: 'medium',
      note: 'Uphill road half marathon, from his 2019 training blog; effort level not stated, weighted ½.' },
    { key: 'mefjellet', name: 'Mefjellet uphill (2019)', time: '40:52', km: 7, gain: 1100, loss: 0, gu: 0.17, gd: 0, alt: [50, 1150, 1150], terrain: 'trail', fit: true, w: 0.5, conf: 'medium',
      note: 'From his 2019 training blog; a hard training climb, not a race — weighted ½.' },
    { key: 'pikes2019', name: 'Pikes Peak Marathon (2019)', time: '3:27:28', km: 42.2, gain: 2382, loss: 2382, gu: 0.113, gd: 0.113, alt: [1920, 4302, 1920], terrain: 'technical', fit: true, w: 0.5, conf: 'high', gpx: 'courses/pikes-peak-marathon.gpx',
      note: 'His faster Pikes; 13 min quicker than 2012, whose splits are also in the fit — weighted ½.' },
    { key: 'zegama', name: 'Zegama-Aizkorri (2022, CR)', time: '3:36:40', km: 42.2, gain: 2736, loss: 2736, gu: 0.20, gd: 0.20, alt: [300, 1550, 300], terrain: 'technical', fit: true, w: 1, conf: 'high', gpx: 'courses/zegama.gpx',
      note: 'Muddy, rocky Basque classic; record by 9 min.' },
    { key: 'mdmb', name: 'Marathon du Mont-Blanc (2018)', time: '3:54:54', km: 42.0, gain: 2730, loss: 1700, gu: 0.18, gd: 0.18, alt: [1035, 2200, 2000], terrain: 'trail', fit: true, w: 1, conf: 'medium',
      note: 'Chamonix → Flégère on the post-2017 course.' },
    { key: 'pikes_up', name: 'Pikes Peak Marathon ascent (2012)', time: '2:18:45', km: 21.1, gain: 2382, loss: 0, gu: 0.113, gd: 0, alt: [1920, 4302, 4302], terrain: 'technical', fit: true, w: 0.75, conf: 'high',
      note: 'Summit split. Upper 5 km above the treeline at 3600–4300 m.' },
    { key: 'pikes_down', name: 'Pikes Peak Marathon descent (2012)', time: '1:21:41', km: 21.1, gain: 0, loss: 2382, gu: 0, gd: 0.113, alt: [4302, 4302, 1920], terrain: 'technical', fit: true, w: 0.75, conf: 'high',
      note: 'Descent split, run on already-tired legs after the 2 h 18 climb.' },
    { key: 'bgr', name: 'Bob Graham Round (2018, FKT at the time)', time: '12:52:00', km: 106, gain: 8200, loss: 8200, gu: 0.22, gd: 0.22, alt: [100, 950, 100], terrain: 'technical', fit: true, w: 1, conf: 'high',
      note: '42 Lakeland fells; pathless, wet, steep.' },
    { key: 'ws2025', name: 'Western States 100 (2025, 3rd)', time: '14:19:22', km: 161.3, gain: 5500, loss: 7000, gu: 0.12, gd: 0.12, alt: [1900, 2650, 200], terrain: 'trail', fit: true, w: 0.5, conf: 'high',
      note: 'Controlled, negative-split race in canyon heat — not his ceiling; weighted ½.' },
    { key: 'utmb2022', name: 'UTMB (2022, CR)', time: '19:49:30', km: 170.3, gain: 10050, loss: 10050, gu: 0.15, gd: 0.15, alt: [1000, 2500, 1000], terrain: 'trail', fit: true, w: 1, conf: 'high', gpx: 'courses/utmb.gpx',
      note: 'Course record on the 170 km loop.' },
    { key: 'hardrock2022', name: 'Hardrock 100 (2022, CR)', time: '21:36:24', km: 161.8, gain: 10365, loss: 10365, gu: 0.15, gd: 0.15, alt: [2800, 4200, 2800], terrain: 'technical', fit: true, w: 1, conf: 'high', gpx: 'courses/hardrock-cw.gpx',
      note: 'Clockwise record; average altitude ≈ 3400 m, Handies Peak 4280 m.' },
    // ---- validation set: alpine / high-altitude FKTs, not used in the fit
    { key: 'matterhorn_up', name: 'Matterhorn ascent, Cervinia → summit (2013)', time: '1:56:00', km: 8.7, gain: 2470, loss: 0, gu: 0.30, gd: 0, alt: [2007, 4478, 4478], terrain: 'alpine', fit: false, w: 1, conf: 'medium',
      note: 'Lion Ridge with fixed ropes; running to the Carrel hut then climbing.' },
    { key: 'matterhorn_down', name: 'Matterhorn descent, summit → Cervinia (2013)', time: '56:02', km: 8.7, gain: 0, loss: 2470, gu: 0, gd: 0.30, alt: [4478, 4478, 2007], terrain: 'alpine', fit: false, w: 1, conf: 'medium',
      note: 'Down-climbing the Lion Ridge, then the trail.' },
    { key: 'montblanc', name: 'Mont Blanc, Chamonix church round trip (2013)', time: '4:57:40', km: 29, gain: 3775, loss: 3775, gu: 0.27, gd: 0.27, alt: [1035, 4810, 1035], terrain: 'glacier', fit: false, w: 1, conf: 'medium',
      note: 'Grands Mulets route, glaciated above 2400 m.' },
    { key: 'monterosa', name: 'Monte Rosa Skymarathon (2018)', time: '5:03:56', km: 35, gain: 3490, loss: 3490, gu: 0.25, gd: 0.25, alt: [1200, 4554, 1200], terrain: 'glacier', fit: false, w: 1, conf: 'high',
      note: 'Alagna → Punta Gnifetti → Alagna, roped in pairs on the glacier.' },
    { key: 'grandteton', name: 'Grand Teton, Lupine Meadows round trip (2012)', time: '2:54:01', km: 22, gain: 2140, loss: 2140, gu: 0.22, gd: 0.22, alt: [2060, 4199, 2060], terrain: 'alpine', fit: false, w: 1, conf: 'medium',
      note: 'Owen-Spalding, soloed.' },
    { key: 'kima', name: 'Trofeo Kima (2014, record until 2024)', time: '6:09:19', km: 52, gain: 4200, loss: 4200, gu: 0.28, gd: 0.28, alt: [1000, 2900, 1000], terrain: 'alpine', fit: false, w: 1, conf: 'high',
      note: 'Seven passes on chains and ladders.' },
    { key: 'denali', name: 'Denali, base camp round trip (2014)', time: '11:48:00', km: 53, gain: 4000, loss: 4000, gu: 0.16, gd: 0.16, alt: [2200, 6190, 2200], terrain: 'glacier', fit: false, w: 1, conf: 'medium',
      note: 'Skis on the lower glacier, crampons above; summit ridge at −20 °C.' },
    { key: 'aconcagua', name: 'Aconcagua, Horcones round trip (2014)', time: '12:49:00', km: 64, gain: 4062, loss: 4062, gu: 0.12, gd: 0.12, alt: [2950, 6962, 2950], terrain: 'technical', fit: false, w: 1, conf: 'low',
      note: 'Published distance "35–50 miles"; 64 km assumed. Scree walk-up at extreme altitude.' },
    { key: 'kili', name: 'Kilimanjaro, Umbwe up / Mweka down (2010)', time: '7:14:00', km: 48, gain: 4255, loss: 4255, gu: 0.18, gd: 0.14, alt: [1640, 5895, 1640], terrain: 'technical', fit: false, w: 1, conf: 'low',
      note: 'Distance not published; 48 km assumed.' },
  ];

  // Courses with Kilian's real finishing time, for "race him on his course".
  const COURSES = [
    { key: 'sierrezinal', name: 'Sierre-Zinal', file: 'courses/sierre-zinal.gpx', time: '2:25:35', year: 2019, terrain: 'trail',
      note: 'Official runners\' course (31 km, +2200/−1100). His 2019 course record.' },
    { key: 'zegama', name: 'Zegama-Aizkorri', file: 'courses/zegama.gpx', time: '3:36:40', year: 2022, terrain: 'technical',
      note: 'Official marathon track (42 km, +2700). His 2022 course record.' },
    { key: 'pikes', name: 'Pikes Peak Marathon', file: 'courses/pikes-peak-marathon.gpx', time: '3:27:28', year: 2019, terrain: 'technical',
      note: 'Barr Trail to the 4302 m summit and back; the official ascent track mirrored for the descent. His 2019 time.' },
    { key: 'bgr', name: 'Bob Graham Round', file: 'courses/bob-graham.gpx', time: '12:52:00', year: 2018, terrain: 'technical',
      note: 'FKT route file, clockwise from Keswick. It is a simplified 96 km trace of a 106 km round, so paces here read ~10 % quick. His 2018 record.' },
    { key: 'utmb', name: 'UTMB', file: 'courses/utmb.gpx', time: '19:49:30', year: 2022, terrain: 'trail',
      note: 'Official 2026 track (174 km); the 2022 course he set the record on was 170 km. His 2022 course record.' },
    { key: 'hardrock', name: 'Hardrock 100 (clockwise)', file: 'courses/hardrock-cw.gpx', time: '21:36:24', year: 2022, terrain: 'technical',
      note: 'Official clockwise track; the file has no elevation, so heights come from SRTM 30 m terrain data. His 2022 clockwise record.' },
  ];

  function parseTime(s) {
    const p = s.split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  }

  // Build a synthetic profile for a reference: up-legs at gu, down-legs at
  // gd, flat for the remainder, altitude interpolated along each leg.
  function syntheticSegments(ref) {
    const D = ref.km * 1000;
    let gu = ref.gu, gd = ref.gd;
    let upRun = gu > 0 ? ref.gain / gu : 0;
    let dnRun = gd > 0 ? ref.loss / gd : 0;
    let flat = D - upRun - dnRun;
    if (flat < 0) { // steeper than assumed: scale grades so it fits the distance
      const s = (upRun + dnRun) / D;
      gu *= s; gd *= s; upRun /= s; dnRun /= s; flat = 0;
    }
    const [a0, a1, a2] = ref.alt;
    const segs = [];
    const N = 20;
    const leg = (run, grade, altA, altB) => {
      if (run <= 0) return;
      const len = run * Math.sqrt(1 + grade * grade) / N;
      for (let n = 0; n < N; n++) segs.push({ len, grade, alt: altA + (altB - altA) * (n + 0.5) / N });
    };
    // order: flat/2, up, flat/2… but for point-to-point with a big early
    // climb (Sierre-Zinal) the order does not change the total, only the
    // altitude exposure, which is interpolated per leg anyway.
    leg(flat * 0.5, 0, a0, a0);
    leg(upRun, gu, a0, a1);
    leg(dnRun, -gd, a1, a2);
    leg(flat * 0.5, 0, a2, a2);
    return segs;
  }

  // Weighted least squares on log time. For a fixed k the optimum log P1 is
  // closed-form (see solveTime); grid-search k.
  // profiles: optional {refKey: segments} built from real course GPX files;
  // refs without one use the synthetic profile.
  function fit(refs = REFS, profiles = {}) {
    const base = refs.filter(r => r.fit).map(r => ({ r, T: parseTime(r.time), segs: profiles[r.key] || syntheticSegments(r) }));
    const wsum = base.reduce((s, x) => s + x.r.w, 0);
    let best = null;
    for (let u = 0.5; u <= 1.0001; u += 0.01) {
      const rows = base.map(x => ({ ...x, A: work(x.segs, x.r.terrain, u).A }));
      for (let k = 0.0; k <= 0.25; k += 0.0025) {
        let num = 0;
        for (const { r, T, A } of rows) num += r.w * (Math.log(A) - k * Math.log(3600) - (1 - k) * Math.log(T));
        const P1 = Math.exp(num / wsum);
        let sse = 0;
        for (const { r, T, A } of rows) sse += r.w * Math.log(solveTime(A, P1, k) / T) ** 2;
        if (!best || sse < best.sse) best = { P1, k, u, sse };
      }
    }
    return { P1: best.P1, k: best.k, u: best.u, rmsLog: Math.sqrt(best.sse / wsum) };
  }

  function calibrationTable(athlete, refs = REFS, profiles = {}) {
    return refs.map(r => {
      const T = parseTime(r.time);
      const p = predict(profiles[r.key] || syntheticSegments(r), r.terrain, athlete);
      return { ...r, actual: T, pred: p.T, err: p.T / T - 1, real: !!profiles[r.key] };
    });
  }

  // An athlete from a flat 10 km time (for "you" when the GPX has no times).
  function athleteFrom10k(secs, k) {
    // T^(1-k) = A·3600^-k / P1  ⇒ P1 = A·3600^-k / T^(1-k), with A for 10 km road
    const A = 10000 * cost(0, 'road');
    return { P1: A * Math.pow(3600, -k) / Math.pow(secs, 1 - k), k, effort: 1 };
  }

  // ---------------------------------------------------------------- you
  // Race-effort heart rate as a fraction of max, by duration (≈95 % at
  // 30 min, 92 % at 1 h, 89 % at 2.5 h, 85 % at 5 h, 80 % at 10 h).
  function raceHRfrac(T) { return Math.min(0.97, Math.max(0.72, 0.92 - 0.036 * Math.log2(T / 3600))); }

  // Fit an athlete from their own timestamped runs (routes from buildRoute).
  // 1. Uphill economy u and descent skill d: the cost curve under which the
  //    runner's implied power is most constant across gradients within a run.
  // 2. Each run's implied power P̄ (time-weighted geometric mean), normalised
  //    to race effort via heart rate when present: P ∝ (HR − rest).
  // 3. Power curve P1, k across runs (k fitted if ≥3 runs spanning ≥2×
  //    duration, else fixed).
  function fitYou(routes, opts = {}) {
    const terrain = opts.terrain || 'trail';
    const runs = routes.filter(r => r.hasTime && r.segs.length > 20);
    if (!runs.length) return null;
    const hrRest = opts.hrRest || 55;
    let hrMax = opts.hrMax || 0;
    if (!hrMax) for (const r of runs) if (r.maxHR > hrMax) hrMax = r.maxHR;
    // usable segments per run: {len, grade, alt, dt, hr}; stops and GPS glitches dropped
    const data = runs.map(r => {
      const segs = [];
      let prev = 0;
      for (const s of r.segs) {
        const dt = s.tYou - prev; prev = s.tYou;
        const v = s.len / dt;
        if (dt > 0 && v > 0.4 && v < 8) segs.push({ len: s.len, grade: s.grade, alt: s.alt, dt, hr: s.hr });
      }
      const useHR = r.hasHR && hrMax > hrRest + 40 && segs.filter(x => x.hr > hrRest + 15).length > segs.length * 0.8;
      return { r, segs, T: segs.reduce((a, x) => a + x.dt, 0), useHR };
    });
    // y_s = log(P_s / (HR_s − rest)) with HR, else log P_s. Objective: the
    // time-weighted median of y in each gradient bin should equal the flat bin's.
    const BINS = [-1, -0.15, -0.07, -0.02, 0.02, 0.07, 0.13, 0.22, 1];
    const wmedian = arr => { // arr of [y, w]
      arr.sort((a, b) => a[0] - b[0]);
      const tot = arr.reduce((a, x) => a + x[1], 0); let c = 0;
      for (const [y, w] of arr) { c += w; if (c >= tot / 2) return y; }
      return arr.length ? arr[arr.length - 1][0] : NaN;
    };
    const ys = (x, u, d) => x.segs.map(s => {
      const P = s.len * cost(s.grade, terrain, u, d) / altFactor(s.alt) / s.dt;
      return x.useHR ? Math.log(P / (s.hr - hrRest)) : Math.log(P);
    });
    const objective = (u, d) => {
      let sse = 0;
      for (const x of data) {
        const y = ys(x, u, d);
        const bins = BINS.slice(0, -1).map(() => []);
        x.segs.forEach((s, i) => { let b = 0; while (b < BINS.length - 2 && s.grade >= BINS[b + 1]) b++; bins[b].push([y[i], s.dt]); });
        const flat = bins[3].length ? wmedian(bins[3]) : NaN;
        if (!Number.isFinite(flat)) continue;
        bins.forEach((b, i) => { if (i !== 3 && b.length >= 4) { const w = b.reduce((a, q) => a + q[1], 0); sse += w * (wmedian(b) - flat) ** 2; } });
      }
      return sse;
    };
    let best = null;
    for (let u = 0.55; u <= 1.2501; u += 0.025) for (let d = 1.0; d <= 2.6001; d += 0.05) {
      const sse = objective(u, d);
      if (!best || sse < best.sse) best = { u, d, sse };
    }
    const { u, d } = best;
    // per-run race-equivalent power: each segment scaled to race HR for that duration
    const rows = data.map(x => {
      const target = raceHRfrac(x.T) * hrMax;
      let sw = 0, slog = 0, slogRaw = 0;
      for (const s of x.segs) {
        const P = s.len * cost(s.grade, terrain, u, d) / altFactor(s.alt) / s.dt;
        const ratio = x.useHR ? Math.min(1.25, Math.max(0.7, (target - hrRest) / (s.hr - hrRest))) : 1;
        sw += s.dt; slog += s.dt * Math.log(P * ratio); slogRaw += s.dt * Math.log(P);
      }
      const hrFrac = x.r.avgHR / hrMax;
      // power rises sub-linearly with HR near threshold, so scaling an easy run to race
      // effort over-estimates: runs below ~85 % of max HR get progressively less say
      const wInt = x.useHR ? (hrFrac >= 0.85 ? 1 : Math.exp(-(((0.85 - hrFrac) / 0.06) ** 2))) : 0.5;
      return { name: x.r.name, km: x.r.total / 1000, gain: x.r.gain, loss: x.r.loss, T: x.T, avgHR: x.r.avgHR, hrFrac,
        useHR: x.useHR, P: Math.exp(slogRaw / sw), Prace: Math.exp(slog / sw), ratio: Math.exp((slog - slogRaw) / sw), wInt };
    });
    // power curve across runs
    let k = opts.k || 0.10;
    const Ts = rows.map(r => r.T), span = Math.max(...Ts) / Math.min(...Ts);
    const kFitted = rows.length >= 3 && span >= 2;
    if (kFitted) {
      const xs = rows.map(r => Math.log(r.T / 3600)), yv = rows.map(r => Math.log(r.Prace));
      const mx = xs.reduce((a, b) => a + b) / xs.length, my = yv.reduce((a, b) => a + b) / yv.length;
      let sxy = 0, sxx = 0; xs.forEach((xx, i) => { sxy += (xx - mx) * (yv[i] - my); sxx += (xx - mx) ** 2; });
      k = Math.min(0.16, Math.max(0.06, -sxy / sxx));
    }
    let num = 0, den = 0;
    for (const r of rows) { const w = r.T * r.wInt; num += w * Math.log(r.Prace * Math.pow(r.T / 3600, k)); den += w; }
    const P1hr = den > 0 ? Math.exp(num / den) : NaN;
    // optional anchor: a real race result {km, secs, gain?} pins the engine
    let P1 = P1hr, P1anchor = NaN;
    if (opts.anchor && opts.anchor.km > 0 && opts.anchor.secs > 0) {
      const a = opts.anchor, g = a.gain || 0, run = a.km * 1000;
      const A = g > 0 ? work([{ len: run - g / 0.08, grade: 0, alt: 200 }, { len: g / 0.08, grade: 0.08, alt: 200 }], 'road', u, d).A : run * cost(0, 'road', u, d);
      P1anchor = A * Math.pow(3600, -k) / Math.pow(a.secs, 1 - k); P1 = P1anchor;
    }
    return { P1, P1hr, P1anchor, k, u, d, hrMax, hrRest, runs: rows, kFitted, anyHR: data.some(x => x.useHR),
      intense: rows.filter(r => r.wInt >= 0.5).length };
  }

  // ---------------------------------------------------------------- gpx
  function haversine(la1, lo1, la2, lo2) {
    const R = 6371000, d = Math.PI / 180;
    const dLa = (la2 - la1) * d, dLo = (lo2 - lo1) * d;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * d) * Math.cos(la2 * d) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // Parse GPX text → {name, pts:[{lat,lon,ele,t}], hasTime}. Uses DOMParser in
  // the browser, a regex fallback in node.
  function parseGPX(text) {
    const pts = [];
    let name = '', type = '';
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      const nm = doc.querySelector('trk > name, metadata > name');
      if (nm) name = nm.textContent.trim();
      const ty = doc.querySelector('trk > type'); if (ty) type = ty.textContent.trim().toLowerCase();
      const nodes = doc.querySelectorAll('trkpt, rtept');
      nodes.forEach(n => {
        const e = n.querySelector('ele'), t = n.querySelector('time');
        const h = n.getElementsByTagNameNS('*', 'hr')[0], cd = n.getElementsByTagNameNS('*', 'cad')[0];
        pts.push({ lat: +n.getAttribute('lat'), lon: +n.getAttribute('lon'),
          ele: e ? +e.textContent : NaN, t: t ? Date.parse(t.textContent) / 1000 : NaN, hr: h ? +h.textContent : NaN, cad: cd ? +cd.textContent : NaN });
      });
    } else {
      const m = text.match(/<name>([^<]*)<\/name>/); if (m) name = m[1];
      const ty = text.match(/<type>([^<]*)<\/type>/); if (ty) type = ty[1].trim().toLowerCase();
      // handles <trkpt ...>…</trkpt> and self-closing <trkpt ... /> (no elevation)
      const re = /<(?:trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:trkpt|rtept)>)/g;
      let x;
      while ((x = re.exec(text))) {
        const la = x[1].match(/\blat="([^"]+)"/), lo = x[1].match(/\blon="([^"]+)"/);
        if (!la || !lo) continue;
        const body = x[2] || '';
        const e = body.match(/<ele>([^<]+)<\/ele>/), t = body.match(/<time>([^<]+)<\/time>/), h = body.match(/<(?:[\w-]+:)?hr>(\d+)/), cd = body.match(/<(?:[\w-]+:)?cad>(\d+)/);
        pts.push({ lat: +la[1], lon: +lo[1], ele: e ? +e[1] : NaN, t: t ? Date.parse(t[1]) / 1000 : NaN, hr: h ? +h[1] : NaN, cad: cd ? +cd[1] : NaN });
      }
    }
    const hasTime = pts.length > 1 && pts.every(p => Number.isFinite(p.t));
    const hasEle = pts.length > 1 && pts.every(p => Number.isFinite(p.ele));
    const hasHR = pts.length > 1 && pts.filter(p => p.hr > 30).length > pts.length / 2;
    const hasCad = pts.length > 1 && pts.filter(p => p.cad > 0).length > pts.length / 2;
    return { name, type, pts, hasTime, hasEle, hasHR, hasCad };
  }

  // Build the route: cumulative distance, smoothed elevation, resampled
  // segments of ~step metres, cumulative "your" time if timestamps exist.
  function buildRoute(gpx, opts = {}) {
    const step = opts.step || 50;      // m per model segment
    const smoothM = opts.smooth || 80; // elevation smoothing half-window, m
    const pts = gpx.pts.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const n = pts.length;
    const dist = new Float64Array(n);
    for (let i = 1; i < n; i++) dist[i] = dist[i - 1] + haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
    const total = dist[n - 1];
    // elevation: fill gaps, then distance-window mean
    const eleRaw = pts.map(p => p.ele);
    for (let i = 0; i < n; i++) if (!Number.isFinite(eleRaw[i])) eleRaw[i] = i ? eleRaw[i - 1] : 0;
    const ele = new Float64Array(n);
    let lo = 0, hi = 0, sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      while (hi < n && dist[hi] <= dist[i] + smoothM) { sum += eleRaw[hi]; cnt++; hi++; }
      while (dist[lo] < dist[i] - smoothM) { sum -= eleRaw[lo]; cnt--; lo++; }
      ele[i] = sum / cnt;
    }
    // your elapsed time (seconds from start), optionally with long stops removed
    let tYou = null;
    if (gpx.hasTime) {
      tYou = new Float64Array(n);
      const t0 = pts[0].t;
      let removed = 0;
      for (let i = 0; i < n; i++) {
        if (opts.stripStops && i > 0) {
          const dt = pts[i].t - pts[i - 1].t, dd = dist[i] - dist[i - 1];
          if (dt > 60 && dd / dt < 0.3) removed += dt - 5;
        }
        tYou[i] = pts[i].t - t0 - removed;
      }
    }
    // resample
    const segs = [];
    const interp = (arr, d) => { // linear interpolation of arr at distance d
      let a = 0, b = n - 1;
      while (b - a > 1) { const m = (a + b) >> 1; if (dist[m] <= d) a = m; else b = m; }
      const w = dist[b] > dist[a] ? (d - dist[a]) / (dist[b] - dist[a]) : 0;
      return arr[a] + (arr[b] - arr[a]) * w;
    };
    const cadArr = gpx.hasCad ? pts.map(p => p.cad >= 0 ? p.cad : NaN) : null;
    if (cadArr) for (let i = 0; i < n; i++) if (!Number.isFinite(cadArr[i])) cadArr[i] = i ? cadArr[i - 1] : 0;
    const hrArr = gpx.hasHR ? pts.map(p => p.hr > 30 ? p.hr : NaN) : null;
    if (hrArr) for (let i = 0; i < n; i++) if (!Number.isFinite(hrArr[i])) hrArr[i] = i ? hrArr[i - 1] : 100;
    const nSeg = Math.max(1, Math.round(total / step));
    const L = total / nSeg;
    let gain = 0, loss = 0;
    for (let s = 0; s < nSeg; s++) {
      const d0 = s * L, d1 = (s + 1) * L;
      const e0 = interp(ele, d0), e1 = interp(ele, d1);
      let grade = (e1 - e0) / L;
      grade = Math.max(-0.8, Math.min(0.8, grade));
      if (e1 > e0) gain += e1 - e0; else loss += e0 - e1;
      segs.push({ d0, d1, len: L * Math.sqrt(1 + grade * grade), grade, alt: (e0 + e1) / 2, e0, e1,
        lat: interp(pts.map(p => p.lat), (d0 + d1) / 2), lon: interp(pts.map(p => p.lon), (d0 + d1) / 2),
        tYou: tYou ? interp(tYou, d1) : NaN, hr: hrArr ? interp(hrArr, Math.min(total, d1 + 60)) : NaN, cad: cadArr ? interp(cadArr, (d0 + d1) / 2) : NaN });
    }
    let altMin = Infinity, altMax = -Infinity;
    for (let i = 0; i < n; i++) { if (ele[i] < altMin) altMin = ele[i]; if (ele[i] > altMax) altMax = ele[i]; }
    // time-weighted average HR and max HR over the run
    let avgHR = NaN, maxHR = NaN;
    if (hrArr && tYou) {
      let sum = 0, tt = 0;
      for (let i = 1; i < n; i++) { const dt = tYou[i] - tYou[i - 1]; if (dt > 0 && dt < 60) { sum += hrArr[i] * dt; tt += dt; } }
      avgHR = tt ? sum / tt : NaN;
      const sorted = Array.from(hrArr).filter(Number.isFinite).sort((a, b) => a - b);
      maxHR = sorted.length ? sorted[Math.floor(sorted.length * 0.995)] : NaN; // 99.5th percentile: single-sample spikes ignored
    }
    return { name: gpx.name, type: gpx.type || '', pts, dist, ele, total, gain, loss, segs, tYou, hasTime: gpx.hasTime, hasHR: !!hrArr, hasCad: !!cadArr, avgHR, maxHR,
      movingTime: tYou ? tYou[n - 1] : NaN, altMin, altMax };
  }

  // Split the route into climbs / descents / flats for the segment table.
  // Turning points need ≥ minVert of vertical change and ≥ minLen metres.
  function splitLegs(route, minVert = 40, minLen = 400) {
    const segs = route.segs;
    const legs = [];
    let start = 0;
    const kind = g => g > 0.03 ? 'climb' : g < -0.03 ? 'descent' : 'flat';
    const legOf = (a, b) => {
      let gain = 0, loss = 0;
      for (let i = a; i <= b; i++) { const d = segs[i].e1 - segs[i].e0; if (d > 0) gain += d; else loss -= d; }
      const d0 = segs[a].d0, d1 = segs[b].d1;
      return { a, b, d0, d1, len: d1 - d0, gain, loss, grade: (segs[b].e1 - segs[a].e0) / (d1 - d0), kind: kind((segs[b].e1 - segs[a].e0) / (d1 - d0)) };
    };
    // 1. greedy monotone runs on the smoothed profile
    let dir = 0;
    for (let i = 1; i < segs.length; i++) {
      const d = Math.sign(segs[i].e1 - segs[i].e0);
      if (dir === 0) { dir = d; continue; }
      if (d !== 0 && d !== dir) {
        const leg = legOf(start, i - 1);
        if (leg.len >= minLen && Math.max(leg.gain, leg.loss) >= minVert) { legs.push(leg); start = i; dir = d; }
        else if (legs.length === 0 && leg.len >= minLen) { legs.push(leg); start = i; dir = d; }
      }
    }
    legs.push(legOf(start, segs.length - 1));
    // 2. merge same-kind neighbours and swallow tiny legs
    const out = [];
    for (const leg of legs) {
      const prev = out[out.length - 1];
      if (prev && (prev.kind === leg.kind || leg.len < minLen || Math.max(leg.gain, leg.loss) < minVert)) {
        const merged = legOf(prev.a, leg.b); out[out.length - 1] = merged;
      } else out.push(leg);
    }
    return out;
  }

  return { minettiRun, minettiWalk, costUp, costDown, cost, altFactor, TERRAIN, REFS, COURSES, parseTime,
    syntheticSegments, work, solveTime, power, predict, fit, calibrationTable, athleteFrom10k, fitYou, raceHRfrac,
    parseGPX, buildRoute, splitLegs, haversine };
});
