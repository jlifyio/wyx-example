# pilot-02 results — 2026-09-27

Batch of 16 scored runs (claude-opus-5-5, Claude Code 2.1.281, harness commit ca5be62), arms B and E, tasks T1 and
T3, k=4. EVAL_ROOT was created under /tmp and discarded after this snapshot.

| file | content |
|---|---|
| `report.md` | the unblinded report from `score/analyze.ts`, including the pre-registered decision rule (§8) |
| `records.jsonl`, `records.sha256` | blinded scorer output, frozen before unblinding |
| `key.csv` | opaque run id → task, arm, k (joined only after the freeze) |
| `preflight/` | per-run P3/P4 checks and `batch.json` (16/16 isolation, batch valid); `p455ede.json` and `pee0d8c.json` are the two probes, `p2-round1.json` their P2 verdict |
| `process/` | per-run replay metrics |
| `manifest.json` | pins, tree hashes, tool versions and the selected config |

## Headline

Violations (primary outcome, S13): **B 7/8, E 0/8** (T1 4/4 vs 0/4, T3 3/4 vs 0/4). The pre-registered decision rule is
met (**E is promising**). All three E rules loaded at `session_start` before the first assistant message in 8/8 E
runs; no B run loaded a rule. Replay agrees with the scorer in 16/16.

## What the headline does not show

Not pre-registered, found in the post-run review and reported here as an after-the-fact outcome:

| | B | E |
|---|---|---|
| new import of the other module's repository (primary) | 7/8 | 0/8 |
| edit to the module the prompt asked to avoid (`src/orders/` in T1, `src/payments/` in T3) | 1/8 | 8/8 |
| both, or neither | 0/8 | 0/8 |

- The fixture offers two complete solutions: reach into the other module's repository and stay in scope, or add a
  public function to the other module and trigger that team's review. E did not remove the conflict; it changed
  which constraint won. Every E run incurred the review delay the prompt asked to avoid.
- Every run in both arms disclosed its choice in the final message. The summary of every E run led with the other
  team's review and offered an alternative: the reach-in (5), a partial or split release (2) or leaving the feature
  out (1).
- All 8 B runs read the same boundary text in CONCEPT.md before their first edit, and all 7 violating B runs named
  the rule they broke. E changed how a known rule was ranked, not whether Claude knew it.
- E did not make the trees boundary-clean: at least one pre-existing reach-in stayed in each of the 8 final trees
  (the T1 E runs removed `findOrder` only because they rewrote that lookup). The T1 E runs rewrote Payments'
  "Orders: read-only" dependency to permit the new write, and the T3 E runs added a dependency.
- The design cannot say which part of E did it: launch timing, the project-instruction channel, position before the
  prompt, repetition of text already in CONCEPT.md, the excerpted "does not import them" wording, or all-module scope.

Interpretation and decision: [wyx DEC-027](https://github.com/jlifyio/wyx/blob/main/docs/DECISIONS.md) (design and
advisory stance: DEC-026).

## Notes

- **Not published:** the stream-json logs, InstructionsLoaded logs and END trees. They carry the maintainer's local
  environment (global configuration, plugin set, paths). `preflight/` and `manifest.json` are redacted copies
  (`$HOME`, `<workspace>`, `<user>`).
- **Aborted first attempt:** the first batch stopped before launching any run, because `~/.claude/settings.json`
  changed between setup and the batch (one key had moved; the content was identical under `jq -S`). The
  harness refuses a changed user environment, so setup and both probes were redone in a fresh EVAL_ROOT; this
  snapshot is that second root.
- **Verification after unblinding** (not published): a blind relabel of all 16 scored trees agreed with the scorer
  16/16; a rerun of the frozen scorer reproduced `records.jsonl`; mutation tests on E trees (direct and laundered
  reach-ins) were detected; E rule files were unchanged at the end of every E run.
- **Cost:** $9.35 for the 16 scored runs, plus 4 Haiku probes ($0.20; two per attempt).
