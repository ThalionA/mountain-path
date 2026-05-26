---
title: About the training analyses
description: How the multi-year training analyses are structured — what's measured, what's modelled, and what stays private.
date: 2026-05-26
tags:
  - training
  - meta
  - telemetry
---

The training analyses on this site sit on top of a longer-running personal data pipeline: a multi-year spreadsheet of session-by-session entries (lifts, climbs, runs, football, body weight, nutrition) cross-referenced with Garmin telemetry (HRV, RHR, sleep stages, VO2max estimates, stress channel) and the occasional perturbation event (illness, PR, hard trip).

## What's measured

The session log holds, for each training day:

- **Sessions** — discipline (climb, lift, run, football, hike), duration, perceived intensity, key sets/loads.
- **Body composition** — weight (most days), occasional DEXA-style spot-checks.
- **Nutrition** — protein intake (the binding constraint), total kcal when relevant.
- **Subjective state** — sleep quality, niggles, mood.

Garmin handles the autonomic and sleep-architecture layer: resting heart rate, overnight HRV, sleep stages and continuity, stress score, VO2max, training load.

## What's modelled

The analysis pipeline produces a small set of named questions:

- **Autonomic state** — what HRV and RHR are doing on a rolling basis, and how they couple to recent training load.
- **Body weight coupling** — does weight follow training load and nutrition the way it should?
- **Strength and CNS** — how heavy lifts move with measures of central-nervous-system readiness.
- **Climbing** — output across sessions, projects, and grade exposure.
- **Football recovery** — what a 90-minute football session costs across the following days.
- **Nutrition** — protein floors, deficit windows, association with recovery.
- **Running and VO2max** — what training mix predicts changes in the modelled VO2max.
- **Perturbation events** — what illness, injury, or peak performances do to all of the above.
- **Stress channel** — what Garmin's stress score actually tracks, and when to ignore it.
- **Sleep stages** — the architecture beyond total sleep time.
- **Data sources and coverage** — where the data comes from and where the gaps are.
- **Body composition targets** — alignment with the demands of an actual climbing season.

## What's published

Methodology, headline findings, and the occasional figure. **Specific day-by-day numbers, the live decision system, and the per-session injury log stay private** — partly because they're not interesting outside their original use, and partly because publishing the live decision-making layer would degrade it (more on this in [[index|the training section overview]]).

Expect this section to fill out as I lift specific analyses out of the private layer and rewrite them for a public reader.
