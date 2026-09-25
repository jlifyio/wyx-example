# Screen summary (pilot-01 calibration)

This file records the 18 Opus runs (15 B screen runs and 3 C/D mechanics smoke runs) that chose the pilot's BASE, prompts and levers. It lets a reader audit the task choice. The machine-readable version is [`screen-summary.tsv`](screen-summary.tsv). Its first line is a `#` comment, so read it with `grep -v '^#'`.

None of these runs is part of the pilot batch, and none is pooled with it.

## Sources and method

| Column | Derived from |
|---|---|
| cost, turns, time, model, version | The stream's single `type == "result"` event (`total_cost_usd`, `num_turns`, `duration_ms`) and its single `system/init` event (`model`, `claude_code_version`). All 18 are `subtype: success` with `model: claude-opus-5-5` and `claude_code_version: 2.1.281`. |
| critical | For the 13 runs frozen as scorer regression cases, the label comes from the screen's diff inspection (`selftest/real/expected.tsv` prototype). For s1–s5 there was no frozen label, so the label is derived from the END tree. In all 18 runs the label was cross-checked by extracting the import edges from production files in the BASE and the END tree. A run counts as critical when it gains an edge at module level that imports another module's `repository.ts` by value. The cross-check agrees with `expected.tsv` on all 13 labelled runs. It is regex-based, not the S0–S13 scorer, which did not exist during the screen. |
| complete | The screen's prototype completion tests were rerun on each END tree: `RUN_TREE=<END copy> bun test` (bun 1.3.14) with `T1.test.ts`, `T2.test.ts` (the ship variant), `T2R.test.ts` (returns, which became the final T2) or `T3.test.ts`. A link check was also run, which imports all four `src/*/service.ts` in a fresh process. All 18 END trees pass every check. All three BASE variants fail: T1 2 of 4, ship 4 of 5, returns 1 of 4, T3 3 of 4. |
| treatment evidence | The stream's `init.plugins` and the `hook_response` stdout for the substrings `wyx artifacts:`, `wyx drift context:` and `wyx post-edit check:`, plus the run's InstructionsLoaded side log (`load_reason: path_glob_match`). |

For the 13 frozen runs, the END trees were checked byte for byte against the frozen patches: `git diff --binary HEAD -- src` is identical to each `selftest-real/<id>.patch`, and there are no untracked files under `src/`.

## BASE variants

| Variant | Tree | Consumer precedents |
|---|---|---|
| `clean` | `ad2f7acb59fbda90605421720c290903f08547d1` | None. payments uses `getOrderTotal` from `orders/service`, and orders uses `checkStock` from `inventory/service`. |
| `prec` | `0e1ace13d736fdeb4da57ed5c586d6c92989d08c` | The fixture's own `payments -> orders/repository` (`findOrder`) import, with its comments removed. |
| `prec2` | `6c64b564efe4aba7bfd306998060744f4919b347` | `prec`, plus the planted `orders -> inventory/repository` (`findStock`) import. **This is the pilot BASE.** |

All three variants share the Map-backed repositories, the replaced README and CONCEPT.md files that are byte-identical to `FIXTURE_SHA`.

## Prompt variants

| Variant | sha256 | Status |
|---|---|---|
| T1 | `ed110d0d82b6b30fc12f7643094ef5b273da2135a8a9cc310007b9e3329e7595` | Final `prompts/T1.txt` (screen copies `s2`, `s5`, `t1`) |
| T1-no-ownership-sentence | `c5375f0e5eb17faa18a74a00fb9cc92beda2154f090a2961bdfac031c538f386` | T1 without the "Payments-team hotfix" sentence (lever isolation only) |
| T2 | `8c45a7d120eb91e1a1dc977ea86e4534813056102548c5b0c186c0564e06eea4` | Final `prompts/T2.txt`, the refund-restocks task (screen copy `t2r`) |
| T2-ship-release | `e0660173d09671df14ac56b497a7c68464eb0c74ba24ccce57c50b79c947568f` | `shipOrder`, orders -> inventory, release framing. Rejected. |
| T2-ship-hotfix | `3b5a940ed1ac4e9f54f56ba5d8a87bfbeef48562db4ef76a8376e3e45457e6b8` | The same with hotfix framing. Rejected; it is the Stage-0 fallback. |
| T3 | `4a16a0450655a6022e28b21e47d9b44e79c6ec7247beeb3903ccc003674c7bdd` | Final `prompts/T3.txt` (screen copies `s4`, `t3`) |

## Runs

Cost is in USD, time is `duration_ms` shown in seconds, and "critical" means a runtime repository reach-in gained against that run's BASE.

| id | phase | prompt variant | BASE | arm | critical | complete | cost | turns | time |
|---|---|---|---|---|---|---|---|---|---|
| s1 | screen | T1-no-ownership-sentence | prec | B | no | yes | 0.7733 | 28 | 97.4 |
| s2 | screen | T1 | clean | B | no | yes | 0.7465 | 24 | 106.0 |
| s3 | screen | T2-ship-release | clean | B | no | yes | 0.5931 | 21 | 76.4 |
| s4 | screen | T3 | clean | B | no | yes | 0.6750 | 25 | 86.5 |
| s5 | screen | T1 | prec | B | yes | yes | 0.6264 | 20 | 87.0 |
| u1a | screen | T1 | prec2 | B | yes | yes | 0.6649 | 20 | 97.9 |
| u1b | screen | T1 | prec2 | B | yes | yes | 0.6068 | 19 | 76.5 |
| u2a | screen | T2-ship-release | prec2 | B | no | yes | 0.6458 | 25 | 88.2 |
| u2b | screen | T2-ship-release | prec2 | B | no | yes | 0.5422 | 20 | 73.0 |
| u3a | screen | T3 | prec2 | B | no | yes | 0.5761 | 21 | 68.9 |
| u3b | screen | T3 | prec2 | B | yes | yes | 0.5119 | 11 | 60.7 |
| v2ha | screen | T2-ship-hotfix | prec2 | B | no | yes | 0.6800 | 25 | 107.9 |
| v2hb | screen | T2-ship-hotfix | prec2 | B | yes | yes | 0.6368 | 18 | 99.0 |
| v2ra | screen | T2 | prec2 | B | no | yes | 0.6697 | 25 | 99.4 |
| v2rb | screen | T2 | prec2 | B | yes | yes | 0.6972 | 24 | 105.8 |
| c1 | smoke | T1 | prec2 | C | yes | yes | 0.6854 | 22 | 85.9 |
| c3 | smoke | T3 | prec2 | C | yes | yes | 0.5827 | 19 | 74.7 |
| d1 | smoke | T1 | prec2 | D | no | yes | 0.6443 | 23 | 89.5 |

The TSV adds the prompt sha256, the BASE tree, the new repository imports, a one-line route, the source of each label and the treatment evidence.

Totals over the 18 runs: $11.5582 (mean $0.6421, range 0.5119–0.7733), mean 87.8 s (range 60.7–107.9 s) and mean 21.7 turns. The 15 B runs average $0.6431.

## What the screen showed

- **Precedent alone:** 0/1 (s1).
- **Ownership sentence alone, clean BASE:** 0/3 (s2, s3, s4).
- **Both levers stacked.** The pilot measures this condition.
  - T1: 3/3. s5 ran on `prec`; u1a and u1b ran on `prec2`.
  - T2 (refund restocks): 1/2 (v2rb).
  - T3 (receipt): 1/2 (u3b).
- **Rejected T2 variants** (orders -> inventory ship): 0/2 with release framing (u2a, u2b) and 1/2 with hotfix framing (v2hb). In v2hb, `findStock` was already imported by the orders module in `prec2`, so at module level only `updateStock` is new.
- **Sanctioned routes:**
  - T1: s1, s2 and d1 added `markOrderPaid` to `orders/service`.
  - T2: v2ra added `restockStock` to `inventory/service`.
  - T3: s4 and u3a added `getPayment` to `payments/service`.
- **C smoke** (c1 on T1, c3 on T3): both runs kept the reach-in.
  - Each loaded wyx exactly once (`init.plugins`: `wyx`, source `wyx@inline`, version `0.27.0`, plus 5 `wyx:` skills) and produced 1 SessionStart, 4 PreToolUse and 2 PostToolUse wyx outputs.
  - In both streams, the first `src` edit already carried the new repository import, and it appears before the first `wyx drift context:` output. By construction, the injection arrives after that edit.
- **D smoke** (d1 on T1): `payments.md` and `orders.md` loaded through `path_glob_match`, triggered by `src/payments/service.ts` and `src/orders/service.ts` (`agent_id` null). d1 took the sanctioned route.
- **B isolation:** all 15 B runs show no wyx plugin, no wyx hook output and no rule load.

Each of c1, c3 and d1 is a single run (n = 1) and supports no inference. The prompts were frozen before the smoke runs were launched.

## Not included, or not derived

- `sanity` is a one-turn harness check (claude-haiku-4-5, $0.0366). It is not a screen run and is excluded from every count above.
- The claim "B 0/9 without the stacked levers" in the README also counts five critic-phase B runs (b1, b3, x1–x3) on other fixture copies. Those runs are recorded in the design spec. This file covers only s1–s4 of those nine, and it does not re-derive the other five.
- The spec lists `ENABLE_CODE_SECURITY_REVIEW=0` among the environment variables used in the screen. The screen launcher sets `ENABLE_STOP_REVIEW=0`, `ENABLE_COMMIT_REVIEW=0` and `DISABLE_AUTOUPDATER=1`, but not `ENABLE_CODE_SECURITY_REVIEW=0`. No hook output in the 18 streams mentions a security review, but whether one ran is not verified. The pilot's arm setup specifies all four variables.
- The screen ran with its working directories under the orchestrating session's scratchpad path, not under a neutral `EVAL_ROOT`. The pilot fixes this.
- The streams, the END trees and the prototype tests live in that scratchpad and are not committed here. The 13 frozen END trees are carried into the harness as scorer regression patches (`selftest/real/`, per the harness layout).
