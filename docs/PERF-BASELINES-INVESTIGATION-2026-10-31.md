# Performance Baselines investigation — are the budgets wrong, or the code?

**Date:** 2026-10-31 · **Investigator:** Lane 6 (Vivienne) · **Type:** evidence only — no
budget, test or code was changed by this investigation. **Question (owner, via main chat):**
the Performance Baselines job keeps missing its budgets on GitHub runners — most recently
the CU-1 customers-list `rent-desc` sort at ~151.7 ms against a 150 ms budget. Prove whether
the budgets or the code are wrong.

## Verdict in one page

**The failures are a measurement/budget artifact, not a code defect — with one named
exception that becomes a code problem as the book grows.**

- The measurement itself is precise: within any single CI run, the five samples behind each
  median agree to within ~1–3 %. Nothing is "noisy" inside a run.
- What varies is the **machine**: identical code and fixture, run on different GitHub
  runner instances, produce medians that differ by 2–3×, and every measurement in a run
  scales together. The runners fall into visible classes (fast / mid / slow). The 150 ms
  budget line sits **between** the fast and slow classes for the `name`, `rent-desc` and
  `owed-desc` sorts, so the same commit passes or fails by runner draw — 5 of the 9 sampled
  CI runs failed, every failure an overshoot of 1.0–2.5 % (151.7–153.4 ms vs 150).
- The code's cost is real but honest: each sort pays one full-population ordering pass
  (the CU1-PERF design: order all matching ids, then read the page). Query plans are the
  efficient shape for that design (hash joins/aggregates, in-memory sorts, cache-hit
  buffers), and cost grows **linearly** with population — measured at 20,000 and 40,000
  customers. There is no missing-index smoking gun and no blow-up.
- **The exception is `owed-desc`.** It is the most expensive 150 ms sort on every machine
  (its aggregate scans 100,000 invoices), with only ~20–30 % headroom even on fast runners,
  and at 40,000 customers its database phase alone (175 ms) exceeds the entire 150 ms
  budget on the fastest hardware measured. It only looks innocent in CI because slower
  runs fail earlier in the test's sort order and never reach it. If any measurement earns
  a code fix, it is this one — first, before the book grows.
- `attention` (300 ms, owner-amended 2026-10-30) passes on every CI runner class but with
  only ~10 % headroom on the slow class; segment counts, searches, `newest`/`since`, and
  every other perf file are comfortably inside their budgets everywhere measured.

## How the measurement works (so the numbers mean something)

`tests/perf/customers-list.perf.test.ts` builds the CU-1 design fixture — 20,000 customers,
60,000 addresses, 30,000 agreements, 120,000 invoices, 40,000 jobs — on a fresh PostgreSQL
17, then times the real `getCustomerList` / `getCustomerSegmentCounts` calls.
`measuredMedian` warms up once, then takes 5 samples of 20 calls each and reports the
**median of the five per-call means**. Budgets: sorts 150 ms (`attention` 300 ms by the
2026-10-30 owner amendment), segment counts 300 ms, searches 150 ms. The sort loop asserts
in order (`attention`, `name`, `rent-desc`, `owed-desc`, `newest`, `since`) and stops at
the first failure — so in failed runs, later sorts have no reading († below). The job is
not a required merge check; it runs in `.github/workflows/perf.yml` and as a job inside
the main CI workflow.

## Evidence

### 1 · CI history — the same code at the same heads, three machine speeds

Medians (ms) from the `[batch-f-perf]` lines in 9 sampled Performance Baselines runs,
all 2026-10-31, all against the fixture above. Budgets: attention ≤ 300, counts ≤ 300,
the rest ≤ 150.

| Head | Result | attention | name | rent-desc | owed-desc | counts |
|---|---|---:|---:|---:|---:|---:|
| 0f4a1f83 | pass | 92.1 | 73.4 | 82.1 | 100.4 | 58.4 |
| bdd549c2 | pass | 96.5 | 75.0 | 83.6 | 103.1 | 59.3 |
| 40921fbb | pass | 107.5 | 83.3 | 104.9 | 121.7 | 79.5 |
| 7f21bbbe | pass | 119.4 | 82.2 | 102.3 | 122.1 | 81.1 |
| 02174e7b | **fail rent 151.7** | 166.5 | 139.6 | 151.7 | † | 108.6 |
| 2073b534 | **fail rent 153.4** | 170.7 | 134.1 | 153.4 | † | 111.4 |
| 731c14df | **fail name 152.3** | 267.4 | 152.3 | † | † | 199.1 |
| f591fcd9 | **fail name 152.8** | 270.4 | 152.8 | † | † | 200.0 |
| 66599ada | **fail name 152.3** | 267.9 | 152.3 | † | † | 199.3 |

A tenth reading at head 66599ada from the twin capacity-baselines job inside the CI
workflow (a different runner again): attention 212.9, **owed-desc 151.3 — failed**; that
is the run where owed-desc's failure is directly observed.

Read the columns as machine classes, not code changes: the passing four cluster together,
the mid two cluster together, the slow three land within 0.5 ms of each other on `name`
(152.3 / 152.8 / 152.3). Between the fastest and slowest class, `name` moves 2.1×,
`attention` 2.9×, counts 3.4× — while **within** a run the five samples behind each median
spread by only ~1–3 %. A code regression cannot produce that signature; a heterogeneous
runner fleet produces exactly it.

### 2 · Local reproduction — two more environments, same ordering

The same test file, same fixture, run four times each on two controlled machines
(2026-10-31). Medians (ms):

| Environment | attention ≤300 | name ≤150 | rent-desc ≤150 | owed-desc ≤150 | counts ≤300 | searches ≤150 |
|---|---:|---:|---:|---:|---:|---:|
| Workshop (i7-12700K, PostgreSQL 17, CI-identical shape) | 100.9–115.7 | 87.3–96.4 | 96.3–99.3 | 116.2–123.4 | 60.6–66.6 | 49–60 |
| Lane VM (4 vCPU EPYC, PostgreSQL 16.2, shared multi-lane box, load 3.6–7.1) | 300.0–369.0 ✗ | 128.9 (1 reading) | 219.6 ✗ (1 reading) | † | 167.6–271.6 | 95–132 |

The Workshop — a known, idle, modern machine running the CI shape exactly — passes
everything, four of four runs, landing in CI's "fast class" band. The loaded shared lane
VM is slower than every CI class and noisier (one attention sample hit 785 ms under
contention), which is why local numbers on it were recorded as noise-family evidence in
earlier dispositions and should stay that way. Environment ordering is consistent across
every measurement: Workshop ≈ CI-fast < CI-mid < CI-slow < loaded lane VM.

### 3 · Query profiling — where the milliseconds actually go

`EXPLAIN (ANALYZE, BUFFERS)` of the exact Phase A ordering queries from
`src/domains/customers/list.ts` (segment = active, the perf test's call), PostgreSQL 17
on the Workshop, warm cache:

| Sort | Phase A SQL, 20k customers | Phase A SQL, 40k customers | What the plan shows |
|---|---:|---:|---|
| name | 53.3 ms | 113.2 ms (2.1×) | segment semi-join + user hash join over ~17k rows, in-memory quicksort on `lower(coalesce(...))` |
| rent-desc | 70.5 ms | 140.5 ms (2.0×) | name's pass + a hash aggregate over 30k rental lines/agreements (+17 ms) |
| owed-desc | 85.0 ms | 174.8 ms (2.1×) | name's pass + a hash aggregate over 100k invoices (+32 ms) |
| attention | 91.4 ms | 203.7 ms (2.2×) | three population aggregates (agreements, invoices, jobs) + a 4-key sort |

Every plan is the right shape for its question: sequential scans are correct for
whole-population aggregates at this scale, all join keys carry indexes (the planner
rightly prefers hashes here), sorts are in-memory (1.5–2.0 MB), buffers are ~all cache
hits. The full-call medians exceed Phase A by ~25–35 ms — the page-window facts read,
hydration, and Prisma/Node overhead — a bounded, constant-ish remainder, not a second
problem. Doubling the population doubles every Phase A time: the cost is the design's
known trade (a full ordering pass per list call, in exchange for cursor-stable ordering
and exact segment semantics), priced linearly, with no cliff.

## Verdict per measurement

| Measurement | Budget | Verdict |
|---|---|---|
| name | 150 ms | **Budget/machine artifact.** Real cost 73–96 ms on fast hardware; fails only on slow-class runners (152–153). No code defect; plan is optimal for the design. |
| rent-desc | 150 ms | **Budget/machine artifact.** Same mechanism; fails most often because its fast-class cost (82–105) sits closest to the line. No code defect. |
| owed-desc | 150 ms | **Artifact today, code problem tomorrow.** Most expensive 150 ms sort everywhere; ~20–30 % headroom on fast runners, already observed failing at 151.3 on a mid runner, and its database phase alone breaks 150 ms at 40k customers on the fastest hardware here. First candidate for a code fix when the owner wants one. |
| attention | 300 ms | **Budget artifact on CI** (passes all classes; ~10 % headroom on the slow class — thin). Fails only on the loaded lane VM, which is not a CI environment. The 2026-10-30 amendment already priced its real cost once. |
| segment counts | 300 ms | **Healthy.** 58–200 ms across every CI class; 67 % of budget worst-case. |
| searches (name/phone/address) | 150 ms | **Healthy.** 49–84 ms in CI. The scoped-CTE design (candidates first, aggregates over candidates only) works as intended. |
| newest / since | 150 ms | **Healthy.** 27–36 ms everywhere measured. |
| leads queue, large account, large invoices, regression guard | various | **Healthy.** No failures in any sampled run; medians ≤ 72 ms. |

## What the owner is actually choosing between

Nothing here blocks merging (the job is not a required check), and nothing here needs a
decision tonight — the desk is prelaunch and the real book is nowhere near 20,000
customers. The choice is about what the budgets should *mean*:

**Door 1 — re-base the budgets on the fleet, not the fastest machine.** From this data,
budgets that pass on every observed CI runner class are roughly: name ≥ 160 ms,
rent-desc ≥ 160 ms, owed-desc ≥ 225 ms (slow-class estimate 190–215 from the fast-class
owed/name ratio of ~1.35–1.4 plus the one direct mid-class reading of 151.3), attention
≥ 300 ms (already there, thin). A stronger variant of the same idea: express the sort
budgets relative to a same-job machine-speed probe (the `newest` median is a pure
population pass with no aggregates — 27–36 ms on fast runners — and predicts the other
sorts within ~15 % in this dataset), so the line moves with the machine instead of
pretending the fleet is uniform.

**Door 2 — buy the cost down in code (each its own card, each re-measured the same way).**
In leverage order: (a) `owed-desc` — stop re-aggregating 100k invoices per call: a
maintained per-customer owed total (updated on invoice writes) or a partial covering
index for the open-status aggregate; (b) `rent-desc` — the same treatment for the
per-customer rent total; (c) window Phase A in SQL (order + limit per page instead of
materializing all ids) — bounded gain (~the sort/transfer share), does not remove the
aggregate passes; (d) an expression index for the name ordering — helps the sort, not
the joins. Honest sizing: (a)+(b) attack 17–32 ms of database time per call on fast
hardware; nothing in code makes a slow-class runner fast — Door 2 alone does not stop
slow-runner failures at a 150 ms line.

**What not to do:** more samples or iterations (the measurement is already precise —
variance lives between machines, not within runs); re-running failed jobs until they
pass (that just re-rolls the runner draw and teaches nothing); quietly widening the
numbers without a record (the 2026-10-30 attention amendment is the model: a dated,
reasoned owner ruling, recorded where the budget lives).

## Method notes and limits

- CI sample: 9 perf-workflow runs + 1 CI-workflow twin reading, all 2026-10-31, chosen
  as the most recent consecutive runs with both outcomes represented; medians and sample
  spreads are quoted from the jobs' own `[batch-f-perf]` log lines.
- Local runs: the exact CI test file and fixture. The Workshop leg mirrors `perf.yml`
  (fresh PostgreSQL 17, migrate + seed, serial file run). The lane-VM leg used Lane 6's
  own database on port 5435 (PostgreSQL 16.2; its seed adds a few hundred customers,
  <2 % of the fixture population) on a shared box under load — included as a fourth,
  deliberately hostile environment, not as a CI predictor.
- The owed-desc slow-class figure (190–215 ms) is an extrapolation from fast-class
  ratios, labelled as such; its one direct over-budget observation is 151.3 ms.
- 40k profiling used a second copy of the same fixture (40,000 customers total);
  Phase A queries were re-run verbatim. Fixture data was deleted afterwards.
