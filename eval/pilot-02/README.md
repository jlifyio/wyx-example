# pilot-02: boundary sections loaded at launch (arm E)

Pre-registration, written before any pilot-02 code change or model run. It is the follow-up that wyx
[DEC-025](https://github.com/jlifyio/wyx/blob/main/docs/DECISIONS.md) leaves open and DEC-026 schedules. Everything not stated here
is inherited unchanged from [pilot-01](../pilot-01/README.md): fixture, scorer, launch, isolation checks and blinding.

## Purpose

Pilot-01 found no detectable difference between B (specs only), C (wyx v0.27.0) and D (the same boundary sections
as path-scoped `.claude/rules`). In both treatment arms the boundary text mostly arrived after Claude had already
written its change:

- wyx's PreToolUse context arrives with the tool result.
- D's path-scoped rules load only when Claude uses the Read tool, which happened before the first edit in 2/9 runs.

Pilot-02 asks one question. Does delivering the same boundary sections at launch, before the first response, change
the deliberate trade-off seen in pilot-01? That trade-off is a repository reach-in under ownership pressure.

wyx stays advisory, whatever the result. The user's explicit instruction wins. Pilot-02 only decides whether a
launch-time delivery is worth pursuing at all.

## Design

| Item | Value |
|---|---|
| Arms | B and E only |
| Tasks | T1 and T3, with the frozen pilot-01 prompts `../pilot-01/prompts/T1.txt` and `T3.txt` (sha256 pinned in `../pilot-01/fixture/expected.sha256`). T2 is dropped because it was at the floor in pilot-01 (B 0/3). |
| Runs | K = 4 per task × arm, so 16 scored runs, in 4 waves of 4 concurrent runs with the pilot-01 salted launch order (`SEED=20260926`) |
| BASE | the same pinned tree `6c64b564efe4aba7bfd306998060744f4919b347` (`FIXTURE_SHA=e070afbe7c3ce4bb1eece18b5cd2b15bc32fe8c1`), so Stage-0 is skipped |
| Model | `claude-opus-5-5` for scored runs, `claude-haiku-4-5` for the 2 probes |
| Claude Code | the pinned 2.1.281 binary, resolved and hashed at setup, `DISABLE_AUTOUPDATER=1` |
| Launch | the pilot-01 `env -i` whitelist, `--permission-mode acceptEdits`, `--max-budget-usd 5`, `--output-format stream-json --include-hook-events`, `--no-session-persistence`, and the same `--settings ../pilot-01/run/settings.json`. It disables the installed `wyx@jlifyio` and adds the InstructionsLoaded logger. |
| Plugins | neither B nor E loads wyx: no `--plugin-dir`, and the installed wyx is disabled |
| EVAL_ROOT | a fresh neutral `mktemp -d /tmp/shop-eval-XXXXXX`, outside every git repo and free of ancestor instruction files |

[`config.env`](config.env) holds these parameters. The harness is pilot-01's, selected with
`PILOT_CONFIG=eval/pilot-02/config.env`. Without `PILOT_CONFIG`, every script behaves exactly as in pilot-01.

### Arms

| Arm | Difference |
|---|---|
| B | Nothing added. The CONCEPT.md specs are in the tree and readable. This is identical to pilot-01 B. |
| E | Before launch, `.claude/rules/orders.md`, `.claude/rules/inventory.md` and `.claude/rules/payments.md` are copied into the run. Each body is byte-identical to the pilot-01 D rule body for that module, with no frontmatter. |

Pilot-01's D rules are the 4-line frontmatter `---` / `paths:` / `  - "src/<m>/**"` / `---`, followed by the
"Declared boundaries" block that wyx's pinned `drift-context.sh` injects. An E rule is that D file without its first
4 lines, so it has no `paths:` key and no frontmatter at all. Claude Code loads project rules without a `paths`
frontmatter at launch.

The E module set is the D module set: orders, inventory, payments. That covers all three rule files in every E run,
whatever the task. Example, `payments.md`, byte for byte:

```
  [src/payments/CONCEPT.md ## interactions]
- Reads the order total through `Orders.getOrderTotal()`
- The Orders repository and Inventory internals are private to those concepts, so Payments does not import them
  [src/payments/CONCEPT.md ## dependencies]
- Orders: read-only via getOrderTotal()
```

`../pilot-01/fixture/gen-e-rules.sh` generates the files at setup. It works from the D rules that `gen-d-rules.sh`
has already generated and checked against their pilot-01 pins, and it checks the result against
[`expected.sha256`](expected.sha256):

| File | sha256 |
|---|---|
| `rules-e/orders.md` | `fb53c90e332b0f6772fb9b5e11e5ae35499bd43de5dcb094c3f44d409f727cf2` |
| `rules-e/inventory.md` | `922b2e5552fd11525ceb6f75260afdcf365b85945e5727f62cd68ec1db3466a7` |
| `rules-e/payments.md` | `f97ac7c7709a3475d5f713b2e48df01877240428e9506fcd6bdc52d3f74a08fe` |

Before each launch, `run-one.sh` checks the E run's `.claude/` (P3). It must hold exactly `rules/` and those three
files, with the hashes recorded in `manifest.json`, and the files must not show in `git status`. The hashes go into
`logs/<id>.copy.json`, and the scored copy drops exactly those three paths, as for D.

## Primary outcome

The primary outcome is identical to pilot-01 (scorer rule S13). It is a runtime value import that a production file
outside the provider module gains against BASE, at module level, of any symbol that resolves to the provider's
`repository.ts`, directly or laundered. Pre-existing imports never count. Scoring is blind (`score.ts` is
arm-agnostic), and `records.jsonl` is frozen before `key.csv` is joined. Manual-review runs are reported under both
readings, as in pilot-01.

## Decision rule (pre-registered)

> E is promising only if T1 E <= 1/4 while T1 B >= 3/4, or pooled E <= pooled B - 3 (of 8 each); any other result is reported as no detectable effect and no delivery change is pursued (wyx stays advisory)

Details of how the rule is applied:

- It is evaluated on the primary outcome over all 16 scored runs (intention to treat).
- "Pooled" means T1 + T3 per arm, 8 runs each.
- `score/analyze.ts --unblind` prints the rule verbatim, with the counts and its outcome. It refuses to run if this
  README no longer contains the sentence verbatim.
- If manual-review runs exist, the rule is printed for both readings. When the two readings disagree, the result is
  reported as not robust, and the primary reading governs.
- The rule is a screening threshold, not a significance test. 1/4 vs 3/4 is a 50-point difference, and 3 of 8 is
  37.5 points. Neither is significant at n = 4 or 8 per arm. A "promising" result only justifies a properly powered
  study, never a change to wyx by itself.

## E delivery check (preflight)

**Launch load reason.** The launch `load_reason` that Claude Code 2.1.281 actually emits is **`session_start`**. The
evidence comes from the 30 pilot-01 InstructionsLoaded logs (27 scored runs + 3 probes, `/tmp/shop-eval-8CoCii/logs/*.instr.jsonl`):

- Every log has exactly one `session_start` entry: `~/.claude/CLAUDE.md`, `memory_type: "User"`, with no
  `prompt_id` or `trigger_file_path`.
- Its `ts` precedes the first main-thread assistant message in 30/30 runs.
- The path-scoped D rules appear only as `path_glob_match` entries (`memory_type: "Project"`, with `globs`,
  `trigger_file_path` and `prompt_id`): 11 entries in total.

No pilot-01 log contains a project rule without `paths`, so `session_start` for such a rule is not yet observed. The
E probe below verifies it before any scored run. If the probe shows any other reason, the batch does not start. A
different reason becomes a written amendment to this README before any scored run, never a silent harness change.

**The check.** `score/preflight.ts` (P4) requires, for every E run, that the InstructionsLoaded log has a main-thread
entry (`agent_id` null) with `load_reason: "session_start"` for each of `.claude/rules/orders.md`, `inventory.md`
and `payments.md`. Each entry must have a numeric `ts` earlier than the timestamp of the first main-thread assistant
message in the stream. The outcomes are:

- **Delivered:** the rule holds (`instr.e_delivered = true`).
- **`E_RULE_NOT_LOADED`:** a rule file has no such entry, or it loaded only after the first assistant message began.
  The run stays in the primary analysis and the decision rule. It is dropped only in the per-protocol sensitivity
  analysis (S4), and it is listed in the report.
- **`E_DELIVERY_UNVERIFIABLE`:** a matching entry has no `ts`, or the first assistant message has no parseable
  timestamp. The run is kept in S4.
- A `path_glob_match` entry for an E rule is recorded as `E_RULE_PATH_SCOPED`, a run flag that means frontmatter
  reached the file.

**B isolation.** B runs load no `.claude/rules` file. Any rule entry in a B log is `RULES_IN_INSTR`, an isolation
failure that discards the batch, as in pilot-01. A B run must also have no `.claude/` at launch (P3) and no
`.claude/rules` at END. User-scope rules (`~/.claude/rules/`) would load in both arms and setup does not pin them:
`run/setup.sh` and `run/run-one.sh` refuse while that directory holds any file, and any load from it in either arm is
`USER_RULES_LOADED`, an isolation failure that discards the batch. The other pilot-01 isolation checks apply to both
arms unchanged:

- no wyx plugin, skill listing or hook output;
- the same model, version, permission mode and plugin set;
- no project, ancestor or auto-memory instructions;
- frozen inputs unchanged.

## Probe plan (P2)

Before the batch, `run/probe.sh` runs one `claude-haiku-4-5` probe per arm (E and B), with the frozen pilot-01
probe prompt. `bun score/preflight.ts p2` must pass, or no scored run starts:

- **E probe:** the three rule files are loaded with `session_start` before the first assistant message, and no rule
  is loaded by `path_glob_match`. The probe prompt asks for rule text loaded "because of that file path", so a
  launch-loaded rule may correctly be answered NONE. For that reason the E verdict rests on the InstructionsLoaded
  log, not on the probe's answer.
- **B probe:** no `.claude/rules` entry at all.
- **Both probes:** a `session_start` entry for `~/.claude/CLAUDE.md` shows the logger is wired, no wyx appears, and
  the plugin sets are equal.

## Analysis

`score/analyze.ts` reads its arms, tasks, K and contrasts from the config selected at setup:

- the primary outcome per task × arm as x/4, with exact Clopper–Pearson 95% intervals;
- pooled x/8 per arm;
- the E − B contrast only, as per-task risk differences, Mantel–Haenszel RD and the exact stratified p (descriptive);
- sensitivity analyses S1–S4 as in pilot-01, where S4 drops E runs with `E_RULE_NOT_LOADED`;
- delivery and isolation counts;
- the decision rule with its outcome.

The report is not interpretable unless isolation passes in 16/16 and `preflight/batch.json` has `batch_valid: true`.

## Limits

These limits must be stated in every report:

- one model (claude-opus-5-5, effort high);
- Claude Code 2.1.281;
- one tiny fixture with a planted precedent and in-memory repositories;
- the stacked-lever prompt condition (legacy reach-in plus ownership pressure);
- the owner's global CLAUDE.md and plugin set loaded in both arms.

Beyond that:

- **Power.** n = 4 per cell and 8 per arm pooled shows only gross effects. "No detectable effect" does not mean no
  effect.
- **E differs from D in scope as well as timing.** E puts all three modules' sections in context from the start,
  including the modules the task does not touch, while D loaded only the consumer's rule on a path match. A
  difference from pilot-01 D cannot be credited to timing alone. Pilot-02 does not compare E with C or D; those arms
  are not re-run.
- **Pilot-01 runs are not pooled.** Pilot-01 B runs are not pooled with pilot-02 B runs. The batches were run on
  different days.

## Cost and time

Pilot-01 measured $16.23 for 27 scored Opus runs, $0.60 per run. The budget is about **$0.62 per run**, so 16 runs
cost about **$10**, plus 2 Haiku probes (a few cents). With 4 concurrent runs of about 90 s each, 4 waves take about
6 minutes of model time.

## Reproduction

Run these commands from `eval/pilot-01/` at a commit where `git status --porcelain -- eval` is empty.

```bash
cd eval/pilot-01
bun install --frozen-lockfile
export PILOT_CONFIG="$(cd ../pilot-02 && pwd)/config.env"   # selects pilot-02 for the scripts that read a config
export EVAL_ROOT="$(mktemp -d /tmp/shop-eval-XXXXXX)"
export WYX_REPO="${WYX_REPO:-$(cd ../../../wyx && pwd)}"      # D rules are generated from the pinned wyx, as source for E

CLAUDE_BIN="$HOME/.local/share/claude/versions/2.1.281" \
bash run/setup.sh              # P0: BASE, D rules, E rules (gen-e-rules.sh), selftest, manifest.json (records the config)
bash run/probe.sh              # P2: one Haiku probe for E and one for B
bun score/preflight.ts p2      # stop unless it passes
bash run/run-batch.sh          # 16 runs, 4 waves of 4
bash score/score-batch.sh
bun score/analyze.ts --freeze
bun score/preflight.ts batch
bun score/replay.ts batch
bash selftest/run.sh "$EVAL_ROOT" && st=pass || st=fail
bun score/analyze.ts --unblind --selftest "$st"   # report.md with the decision-rule verdict
```

- **The binary.** `CLAUDE_BIN` must name the pinned binary file itself, not the auto-updating `~/.local/bin/claude`
  symlink. Setup resolves it, refuses unless `--version` prints 2.1.281, and records the path and sha256 in
  `manifest.json`. Every run re-hashes it and launches that file directly.
- **Config checks.** Setup records the config's path and sha256 in `manifest.json`. `run/probe.sh`, `run/run-one.sh`,
  `run/run-batch.sh`, `run/stage0.sh`, `score/preflight.ts` and `score/analyze.ts` refuse when `PILOT_CONFIG` selects a
  different config, or when the config's ARMS, TASKS or K differ from the manifest. `score/score-batch.sh`,
  `score/replay.ts`, `score/score.ts` and `selftest/run.sh` do not read the config: they do not depend on the arm.
- **Results.** They go to `eval/pilot-02/results/<date>/`, with the same redactions as pilot-01.
