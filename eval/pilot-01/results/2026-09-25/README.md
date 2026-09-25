# pilot-01 results — 2026-09-25

Batch of 27 scored runs (claude-opus-5-5, Claude Code 2.1.281, harness commit 2909c2a plus the two
analysis fixes noted below), EVAL_ROOT created under /tmp and discarded after this snapshot.

| file | content |
|---|---|
| `report.md` | the unblinded report from `score/analyze.ts` |
| `records.jsonl`, `records.sha256` | blinded scorer output, frozen before unblinding |
| `key.csv` | opaque run id → task, arm, k (joined only after the freeze) |
| `preflight/` | per-run P3/P4 checks and `batch.json` (27/27 isolation, batch valid); `p*.json` are the three probes |
| `process/` | per-run replay metrics (S14) |
| `manifest.json` | pins, tree hashes and tool versions |

Headline: violations B 6/9, C 5/9, D 4/9 (T1 3/3, 3/3, 2/3; T2 0/3, 0/3, 1/3; T3 3/3, 2/3, 1/3) — no detectable
difference; the pilot sees only differences of about 55 percentage points. Interpretation and decision:
[wyx DEC-025](https://github.com/jlifyio/wyx/blob/main/docs/DECISIONS.md).

Notes:

- **Not published:** the stream-json logs, InstructionsLoaded logs and END trees. They carry the maintainer's local
  environment (global configuration, plugin set, paths). `preflight/` and `manifest.json` are redacted copies
  (`$HOME`, `<workspace>`, `<user>`).
- **Analysis fixes after the run** (no model was re-run; `records.jsonl` is unchanged): the replay now applies
  successful Bash deletions (`rm` of scratch files), and "bash write to src" counts only successful writes under
  `src/`. Both changed secondary rows only (§5 replay_incomplete, §7); the primary table is unchanged. The selftest
  passed before and after (86, then 89 cases).
- **Also run, not scored here:** an 18-run design screen (B-only task calibration plus one C and one D smoke run)
  summarised in `../../calibration/`, and three Haiku probes (`preflight/p*.json`).
