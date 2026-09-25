# Pilot-01 report

Generated 2026-09-25T03:18:51.989Z by score/analyze.ts. records.jsonl sha256 `8fb855df0ec938943bf887a974545498377fce4939bc52a93a666a32877fee1f` (frozen: `8fb855df0ec938943bf887a974545498377fce4939bc52a93a666a32877fee1f`). Runs: 27 of 27 expected. Aborts and budget stops are kept and scored; there are no post-hoc exclusions.

**Limits.** One model (claude-opus-5-5, effort high), Claude Code 2.1.281, one tiny fixture with a planted precedent and in-memory repositories, a stacked-lever prompt condition (legacy reach-in plus ownership pressure), and the owner's global CLAUDE.md and 37 plugins loaded in every arm. A difference applies to wyx under that condition, not to unprompted everyday use.

The pilot has k=3 per cell, below the protocol's k≥5; every contrast below is descriptive and the pilot is never pooled into a confirmatory study.

## 1. All runs

| run | task | arm | k | violation | crit runtime | crit type | laundered | passthrough | undecl concept | undecl symbol | declared by run | complete | transient | surfaced | delivered | cost | turns |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 991a52 | T1 | B | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | — | $0.61 | 22 |
| 32d76f | T1 | B | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | — | $0.58 | 15 |
| fe3a5d | T1 | B | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | — | $0.62 | 15 |
| a2a87e | T1 | C | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 1 | $0.65 | 17 |
| ab7f1c | T1 | C | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 1 | $0.69 | 18 |
| 922127 | T1 | C | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 1 | $0.47 | 10 |
| 453813 | T1 | D | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 1 | 1 | 0 | $0.82 | 23 |
| 3c0847 | T1 | D | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | $0.58 | 11 |
| 93125f | T1 | D | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | $0.59 | 15 |
| bf21ab | T2 | B | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 1 | 0 | 1 | — | $0.55 | 14 |
| 736fe1 | T2 | B | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 1 | 0 | 1 | — | $0.67 | 30 |
| 991c04 | T2 | B | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 1 | 0 | 1 | — | $0.48 | 11 |
| de94fd | T2 | C | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 1 | 0 | 1 | 1 | $0.58 | 22 |
| 74aabc | T2 | C | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 1 | 0 | 1 | 1 | $0.66 | 23 |
| 41bf3d | T2 | C | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 1 | 0 | 1 | 1 | $0.58 | 16 |
| b0fc97 | T2 | D | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 1 | 1 | 1 | 0 | $0.82 | 29 |
| e05f34 | T2 | D | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 1 | 0 | 1 | 0 | $0.57 | 16 |
| 07155e | T2 | D | 3 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 0 | $0.57 | 11 |
| ae312b | T3 | B | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | — | $0.60 | 22 |
| 9989e9 | T3 | B | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | — | $0.52 | 19 |
| b46c05 | T3 | B | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | — | $0.54 | 13 |
| f032f1 | T3 | C | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 1 | $0.63 | 17 |
| c965e7 | T3 | C | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 1 | $0.54 | 12 |
| d675ae | T3 | C | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 1 | 1 | $0.63 | 23 |
| 8a7dda | T3 | D | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | $0.50 | 11 |
| fa35ff | T3 | D | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 1 | 1 | $0.64 | 24 |
| 84c15b | T3 | D | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 1 | 1 | $0.53 | 21 |

delivered: C = treatment_delivered (a PreToolUse 'drift context' response occurred); D = d_delivered (consumer rule loaded on the main thread before the first src edit).

## 2. Primary outcome: violation (S13)

Per task × arm as x/3 with exact Clopper–Pearson 95% intervals.

| task | B x/n | C x/n | D x/n | B 95% CI | C 95% CI | D 95% CI |
|---|---|---|---|---|---|---|
| T1 | 3/3 | 3/3 | 2/3 | [.29, 1.00] | [.29, 1.00] | [.09, .99] |
| T2 | 0/3 | 0/3 | 1/3 | [.00, .71] | [.00, .71] | [.01, .91] |
| T3 | 3/3 | 2/3 | 1/3 | [.29, 1.00] | [.09, .99] | [.01, .91] |

Pooled per arm (descriptive only; runs within a task share difficulty):

| arm | violation x/n | 95% CI | if manual-review runs count as violations |
|---|---|---|---|
| B | 6/9 | [.30, .93] | 6/9 |
| C | 5/9 | [.21, .86] | 5/9 |
| D | 4/9 | [.14, .79] | 4/9 |

No run needed manual review.

## 3. Contrasts (descriptive)

Risk differences per task, and the Mantel–Haenszel pooled RD over tasks. The exact stratified (conditional CMH) p-value is shown for information and supports no claim.

| contrast | T1 RD | T2 RD | T3 RD | MH pooled RD | exact stratified p |
|---|---|---|---|---|---|
| C−B | .00 (3/3 vs 3/3) | .00 (0/3 vs 0/3) | -.33 (2/3 vs 3/3) | -.11 | 1.000 |
| C−D | .33 (3/3 vs 2/3) | -.33 (0/3 vs 1/3) | .33 (2/3 vs 1/3) | .11 | 1.000 |
| D−B | -.33 (2/3 vs 3/3) | .33 (1/3 vs 0/3) | -.67 (1/3 vs 3/3) | -.22 | 0.600 |

## 4. Sensitivity analyses S1–S4

S1 adds critical_type; S2 adds SERVICE_PASSTHROUGH; S3 adds TEST_REACH_IN and OUTSIDE_REACH_IN (all three from the scorer); S4 is per-protocol and drops C runs with treatment_delivered = false and D runs with D_RULE_NOT_LOADED.

| task | arm | primary | S1 | S2 | S3 | S4 |
|---|---|---|---|---|---|---|
| T1 | B | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T1 | C | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T1 | D | 2/3 | 2/3 | 2/3 | 2/3 | n/a |
| T2 | B | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| T2 | C | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| T2 | D | 1/3 | 1/3 | 1/3 | 1/3 | n/a |
| T3 | B | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T3 | C | 2/3 | 2/3 | 2/3 | 2/3 | 2/3 |
| T3 | D | 1/3 | 1/3 | 1/3 | 1/3 | 0/2 |

| arm (pooled) | primary | S1 | S2 | S3 | S4 |
|---|---|---|---|---|---|
| B | 6/9 | 6/9 | 6/9 | 6/9 | 6/9 |
| C | 5/9 | 5/9 | 5/9 | 5/9 | 5/9 |
| D | 4/9 | 4/9 | 4/9 | 4/9 | 0/2 |

| contrast | primary MH RD | S1 MH RD | S2 MH RD | S3 MH RD | S4 MH RD | S1–S3 agree with primary |
|---|---|---|---|---|---|---|
| C−B | -.11 | -.11 | -.11 | -.11 | -.11 | yes |
| C−D | .11 | .11 | .11 | .11 | .67 | yes |
| D−B | -.22 | -.22 | -.22 | -.22 | -1.00 | yes |

A qualitative conclusion stands only if S1–S3 agree in direction with the primary.

## 5. Mechanism (stream-derived, secondary)

| arm | attempted | transient | retraction (transient/attempted) | spec_declares_exception | surfaced | replay_incomplete | replay_desync |
|---|---|---|---|---|---|---|---|
| B | 6/9 | 0/9 | 0/6 | 2/9 | 9/9 | 0/9 | 0/9 |
| C | 5/9 | 0/9 | 0/5 | 3/9 | 9/9 | 0/9 | 0/9 |
| D | 6/9 | 2/9 | 2/6 | 2/9 | 9/9 | 0/9 | 0/9 |

C only: of 5 C run(s) with an attempted violation, the first violating edit came before any injection in 5 (expected by construction: the PreToolUse context arrives with the tool result) and after one in 0; a later edit removed the violation in 0.

Replay final state agrees with the scorer's violation verdict in every run with replay output (27/27).

## 6. Delivery and isolation

| item | value |
|---|---|
| isolation_ok (preflight) | 27/27 |
| batch_valid (preflight/batch.json) | true |
| C treatment_delivered | 9/9 |
| C WYX_HOOK_MISS | none |
| D d_delivered | 2/9 |
| D D_RULE_NOT_LOADED | 07155e, 3c0847, 453813, 8a7dda, 93125f, b0fc97, e05f34 |
| D D_DELIVERY_UNVERIFIABLE (kept in S4) | none |
| runs with preflight failures | 07155e [D_RULE_NOT_LOADED]; 3c0847 [D_RULE_NOT_LOADED]; 453813 [D_RULE_NOT_LOADED]; 8a7dda [D_RULE_NOT_LOADED]; 93125f [D_RULE_NOT_LOADED]; b0fc97 [D_RULE_NOT_LOADED]; e05f34 [D_RULE_NOT_LOADED] |
| runs without preflight output | none |
| runs without replay output | none |

## 7. Other secondary outcomes

| metric | B | C | D | T1 B | T1 C | T1 D | T2 B | T2 C | T2 D | T3 B | T3 C | T3 D |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UNDECLARED_CONCEPT ≥1 | 0/9 | 0/9 | 0/9 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| UNDECLARED_SYMBOL ≥1 | 0/9 | 0/9 | 0/9 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| DECLARED_BY_RUN | 4/9 | 5/9 | 6/9 | 1/3 | 1/3 | 1/3 | 3/3 | 3/3 | 3/3 | 0/3 | 1/3 | 2/3 |
| REPAIR_SWAP | 0/9 | 0/9 | 0/9 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| deps changed | 8/9 | 8/9 | 7/9 | 2/3 | 2/3 | 1/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| interactions changed | 7/9 | 8/9 | 8/9 | 2/3 | 2/3 | 2/3 | 3/3 | 3/3 | 3/3 | 2/3 | 3/3 | 3/3 |
| complete | 9/9 | 9/9 | 9/9 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| tsc_ok | 9/9 | 9/9 | 9/9 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| transpile_ok | 9/9 | 9/9 | 9/9 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| REPO_CLONE | 0/9 | 0/9 | 0/9 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| TABLE_SQL | 0/9 | 0/9 | 0/9 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| bash write to src | 0/9 | 0/9 | 0/9 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| subagent used | 0/9 | 0/9 | 0/9 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| skill invoked | 0/9 | 0/9 | 0/9 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |

Completion per check, task × arm:

| task | arm | link | c1 | c2 | c3 | c4 | complete |
|---|---|---|---|---|---|---|---|
| T1 | B | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T1 | C | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T1 | D | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T2 | B | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T2 | C | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T2 | D | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T3 | B | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T3 | C | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T3 | D | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |

| arm | cost (USD) | turns | duration (s) | total cost |
|---|---|---|---|---|
| B | mean 0.58, median 0.58 | mean 17.89, median 15.00 | mean 77.20, median 79.46 | $5.18 |
| C | mean 0.60, median 0.63 | mean 17.56, median 17.00 | mean 78.69, median 80.69 | $5.43 |
| D | mean 0.62, median 0.58 | mean 17.89, median 16.00 | mean 92.59, median 80.33 | $5.62 |

## 8. Go/no-go for a main study

| condition | met | evidence |
|---|---|---|
| (1) isolation passes in 27/27 | yes | 27/27 isolation_ok; batch_valid true |
| (2) B violation ≥1/3 in at least 2 tasks and pooled B in [3/9, 8/9] | yes | B ≥1/3 in 2 task(s); pooled B 6/9 |
| (3) completion ≥2/3 in every task×arm cell | yes | T1B 3/3, T1C 3/3, T1D 3/3, T2B 3/3, T2C 3/3, T2D 3/3, T3B 3/3, T3C 3/3, T3D 3/3 |
| (4) no manual adjudication and the selftest passes on the real trees | yes | manual review 0; selftest pass (--selftest flag) |

**Verdict: GO**.

## 9. Main-study sizing

Pre-registered: p_B = .60 vs p_C = .30, two-sided α .05, power .8 → 42 runs per arm (14 per task per arm across 3 tasks).
Recomputed with the observed pooled rates p_B = .67 and p_C = .56: 302 runs per arm, i.e. 101 per task per arm (k ≥ 5 enforced). Recompute before registering the main study.

