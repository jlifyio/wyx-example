# Pilot-02 report

Generated 2026-09-27T02:32:15.351Z by score/analyze.ts. records.jsonl sha256 `0656cdb7861e01a6ea5040b597dbdd71ed39d6c6737ef6fc5ac01b9259a08904` (frozen: `0656cdb7861e01a6ea5040b597dbdd71ed39d6c6737ef6fc5ac01b9259a08904`). Runs: 16 of 16 expected. Aborts and budget stops are kept and scored; there are no post-hoc exclusions.

**Limits.** One model (claude-opus-5-5, effort high), Claude Code 2.1.281, one tiny fixture with a planted precedent and in-memory repositories, a stacked-lever prompt condition (legacy reach-in plus ownership pressure), and the owner's global CLAUDE.md and plugin set loaded in both arms. E differs from pilot-01 D in scope as well as timing (all three modules' sections from launch), and pilot-01 runs are not pooled. A difference applies to launch-loaded boundary rules under that condition, not to unprompted everyday use.

The pilot has k=4 per cell (8 per arm pooled); every contrast below is descriptive, and the pre-registered decision rule (section 8) is a screening threshold, not a significance test.

## 1. All runs

| run | task | arm | k | violation | crit runtime | crit type | laundered | passthrough | undecl concept | undecl symbol | declared by run | complete | transient | surfaced | delivered | cost | turns |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 79d4e3 | T1 | B | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | — | $0.60 | 20 |
| 501a2c | T1 | B | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | — | $0.55 | 15 |
| e174eb | T1 | B | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 1 | — | $0.56 | 11 |
| 1eb145 | T1 | B | 4 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | — | $0.58 | 15 |
| a245b6 | T1 | E | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 1 | 1 | $0.65 | 21 |
| 03e598 | T1 | E | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 1 | 1 | $0.58 | 18 |
| 875446 | T1 | E | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 1 | 1 | $0.65 | 21 |
| 99e217 | T1 | E | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 1 | 1 | $0.61 | 13 |
| 32c6f4 | T3 | B | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | — | $0.55 | 16 |
| bf8780 | T3 | B | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | — | $0.57 | 19 |
| 6396af | T3 | B | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 1 | — | $0.52 | 20 |
| b245c4 | T3 | B | 4 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | — | $0.53 | 17 |
| 7c44b6 | T3 | E | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 1 | 1 | $0.61 | 21 |
| a08774 | T3 | E | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 1 | 1 | $0.67 | 26 |
| 3f00cb | T3 | E | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 1 | 1 | $0.57 | 21 |
| 038f20 | T3 | E | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 1 | 1 | $0.55 | 19 |

delivered: E = e_delivered (all three rules loaded on the main thread at session_start, before the first assistant message).

## 2. Primary outcome: violation (S13)

Per task × arm as x/4 with exact Clopper–Pearson 95% intervals.

| task | B x/n | E x/n | B 95% CI | E 95% CI |
|---|---|---|---|---|
| T1 | 4/4 | 0/4 | [.40, 1.00] | [.00, .60] |
| T3 | 3/4 | 0/4 | [.19, .99] | [.00, .60] |

Pooled per arm (descriptive only; runs within a task share difficulty):

| arm | violation x/n | 95% CI | if manual-review runs count as violations |
|---|---|---|---|
| B | 7/8 | [.47, 1.00] | 7/8 |
| E | 0/8 | [.00, .37] | 0/8 |

No run needed manual review.

## 3. Contrasts (descriptive)

Risk differences per task, and the Mantel–Haenszel pooled RD over tasks. The exact stratified (conditional CMH) p-value is shown for information and supports no claim.

| contrast | T1 RD | T3 RD | MH pooled RD | exact stratified p |
|---|---|---|---|---|
| E−B | -1.00 (0/4 vs 4/4) | -.75 (0/4 vs 3/4) | -.88 | 0.002 |

## 4. Sensitivity analyses S1–S4

S1 adds critical_type; S2 adds SERVICE_PASSTHROUGH; S3 adds TEST_REACH_IN and OUTSIDE_REACH_IN (all three from the scorer); S4 is per-protocol and drops E runs with E_RULE_NOT_LOADED.

| task | arm | primary | S1 | S2 | S3 | S4 |
|---|---|---|---|---|---|---|
| T1 | B | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |
| T1 | E | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 |
| T3 | B | 3/4 | 3/4 | 3/4 | 3/4 | 3/4 |
| T3 | E | 0/4 | 0/4 | 0/4 | 0/4 | 0/4 |

| arm (pooled) | primary | S1 | S2 | S3 | S4 |
|---|---|---|---|---|---|
| B | 7/8 | 7/8 | 7/8 | 7/8 | 7/8 |
| E | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 |

| contrast | primary MH RD | S1 MH RD | S2 MH RD | S3 MH RD | S4 MH RD | S1–S3 agree with primary |
|---|---|---|---|---|---|---|
| E−B | -.88 | -.88 | -.88 | -.88 | -.88 | yes |

A qualitative conclusion stands only if S1–S3 agree in direction with the primary.

## 5. Mechanism (stream-derived, secondary)

| arm | attempted | transient | retraction (transient/attempted) | spec_declares_exception | surfaced | replay_incomplete | replay_desync |
|---|---|---|---|---|---|---|---|
| B | 7/8 | 0/8 | 0/7 | 2/8 | 8/8 | 0/8 | 0/8 |
| E | 0/8 | 0/8 | n/a | 0/8 | 8/8 | 0/8 | 0/8 |

Replay final state agrees with the scorer's violation verdict in every run with replay output (16/16).

## 6. Delivery and isolation

| item | value |
|---|---|
| isolation_ok (preflight) | 16/16 |
| batch_valid (preflight/batch.json) | true |
| E e_delivered | 8/8 |
| E E_RULE_NOT_LOADED | none |
| E E_DELIVERY_UNVERIFIABLE (kept in S4) | none |
| B runs with a .claude/rules load or directory | none |
| runs with preflight failures | none |
| runs without preflight output | none |
| runs without replay output | none |

## 7. Other secondary outcomes

| metric | B | E | T1 B | T1 E | T3 B | T3 E |
|---|---|---|---|---|---|---|
| UNDECLARED_CONCEPT ≥1 | 0/8 | 0/8 | 0/4 | 0/4 | 0/4 | 0/4 |
| UNDECLARED_SYMBOL ≥1 | 1/8 | 0/8 | 1/4 | 0/4 | 0/4 | 0/4 |
| DECLARED_BY_RUN | 1/8 | 8/8 | 0/4 | 4/4 | 1/4 | 4/4 |
| REPAIR_SWAP | 1/8 | 0/8 | 1/4 | 0/4 | 0/4 | 0/4 |
| deps changed | 4/8 | 8/8 | 2/4 | 4/4 | 2/4 | 4/4 |
| interactions changed | 5/8 | 8/8 | 2/4 | 4/4 | 3/4 | 4/4 |
| complete | 8/8 | 8/8 | 4/4 | 4/4 | 4/4 | 4/4 |
| tsc_ok | 8/8 | 8/8 | 4/4 | 4/4 | 4/4 | 4/4 |
| transpile_ok | 8/8 | 8/8 | 4/4 | 4/4 | 4/4 | 4/4 |
| REPO_CLONE | 0/8 | 0/8 | 0/4 | 0/4 | 0/4 | 0/4 |
| TABLE_SQL | 0/8 | 0/8 | 0/4 | 0/4 | 0/4 | 0/4 |
| bash write to src | 0/8 | 0/8 | 0/4 | 0/4 | 0/4 | 0/4 |
| subagent used | 0/8 | 0/8 | 0/4 | 0/4 | 0/4 | 0/4 |
| skill invoked | 0/8 | 0/8 | 0/4 | 0/4 | 0/4 | 0/4 |

Completion per check, task × arm:

| task | arm | link | c1 | c2 | c3 | c4 | complete |
|---|---|---|---|---|---|---|---|
| T1 | B | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |
| T1 | E | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |
| T3 | B | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |
| T3 | E | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |

| arm | cost (USD) | turns | duration (s) | total cost |
|---|---|---|---|---|
| B | mean 0.56, median 0.55 | mean 16.63, median 16.00 | mean 74.12, median 69.31 | $4.47 |
| E | mean 0.61, median 0.61 | mean 20.00, median 21.00 | mean 78.15, median 77.00 | $4.89 |

## 8. Pre-registered decision rule

| validity item | value |
|---|---|
| isolation | 16/16 isolation_ok; batch_valid true |
| E delivered (all three rules at session_start before the first assistant message) | 8/8 |
| manual review | 0 |
| selftest | pass (--selftest flag) |

> E is promising only if T1 E <= 1/4 while T1 B >= 3/4, or pooled E <= pooled B - 3 (of 8 each); any other result is reported as no detectable effect and no delivery change is pursued (wyx stays advisory)

| reading | counts | outcome |
|---|---|---|
| primary (scorer verdict) | T1 E 0/4, T1 B 4/4; pooled E 0/8, pooled B 7/8; T1 clause (E <= 1/4 while B >= 3/4) met; pooled clause (E <= B - 3) met | E IS PROMISING |

**Decision: E IS PROMISING**

