---
title: Trail Profile
description: Drop a batch of your trail-run GPX files and get a coach's report card — engine, climbing, descending, durability, intensity — in your own units, with one thing to do for each.
tags: [side-project, running, tool]
---

Companion to [Race Kilian](race-kilian). Drop a batch of your own runs (GPX with timestamps; heart rate and cadence if you have them) and the page reads them the way a coach would:

- **Engine**: flat-equivalent pace at 80 % of your max heart rate, and whether it is moving.
- **Climbing**: vertical speed per gradient band at the heart rate you did it, whether you run or walk the steep stuff (from cadence) and what walking costs you.
- **Descending**: pace on gentle and steep descents against your flat pace, and how much you brake.
- **Durability**: second-half versus first-half power per heartbeat, and climb rate late in runs.
- **Intensity mix**: where your recorded time actually sits, by heart-rate band.

Each card has a sparkline of your own history, one concrete thing to do, and a grey line saying where Kilian Jornet and a synthetic club runner would be. Below the cards: a one-sentence race-day read on a real course (which capacity the minutes are hiding in) and your personal bests in the batch. Everything else — gradient signature, best-effort curve, any metric over time, weekly volume, every climb and run — is folded under "explore".

No GPX to hand? The page loads a sample batch of six invented runs by a simulated runner, so you can see what it does before feeding it your own.

Nothing is uploaded; runs are remembered in your browser, and a calibration made here is picked up by Race Kilian automatically.

Because that simulated runner has known qualities, the page can be marked against an answer sheet, and it says so in its own "how accurate is this?" section: the engine lands within about 3 % when it is given a real max heart rate, and roughly 17 % low when it has to guess one from training runs. The measured halves — pace by gradient, climb rates, heart-rate mix, personal bests, trends — carry none of that modelling risk.

<p style="margin:1.4rem 0"><a href="/side-projects/kilian/profile.htm" style="display:inline-block;padding:.7rem 1.2rem;border-radius:10px;background:var(--secondary);color:var(--light);font-weight:600;text-decoration:none">Open Trail Profile →</a></p>

<p style="font-size:.9em;opacity:.75">Opens as its own full-width page. Bring a batch of GPX files, or press "Load a sample batch" to see it work first.</p>
