# pilot-01: wyx boundary-injection calibration pilot

This pilot runs the measurement harness for a small, pre-registered calibration of the [wyx](https://github.com/jlifyio/wyx) Claude Code plugin. It follows the concurrent A/B protocol in wyx [`docs/evaluation-protocol.md`](https://github.com/jlifyio/wyx/blob/main/docs/evaluation-protocol.md).

The question is whether wyx's edit-time boundary injection (arm C), or the same boundary text loaded as native path rules (arm D), changes a deliberate cross-module trade-off that Claude makes without either (arm B) while the spec is readable in the repo.

This is a calibration pilot, not a confirmatory study:

- k = 3 per cell is below the protocol's k ≥ 5.
- Its runs are never pooled into a later study.

## Pins

| Pin | Value |
|---|---|
| Fixture | `FIXTURE_SHA=e070afbe7c3ce4bb1eece18b5cd2b15bc32fe8c1` (this repo; `src/*/CONCEPT.md` byte-identical to the screened specs) |
| wyx | `WYX_SHA=3ec85d58e85d144d6f06bf4384d1b77d922d7f8d` (v0.27.0), loaded from a `git archive` copy of `.claude-plugin hooks scripts skills` |
| BASE tree | `6c64b564efe4aba7bfd306998060744f4919b347` (the screened BASE) |
| Model | `claude-opus-5-5` for scored runs, `claude-haiku-4-5` for the 3 probes |
| Claude Code | 2.1.281 (`DISABLE_AUTOUPDATER=1`) |
| Runtime | bun 1.3.14; `typescript` pinned exactly in `package.json` / `bun.lock` |

[`config.env`](config.env) holds the pins and batch parameters. [`fixture/expected.sha256`](fixture/expected.sha256) holds the sha256 values for the overlay files, the CONCEPT.md files, the D rules and the prompts.

## Fixture and its departures from the published wyx-example

[`fixture/make-fixture.sh`](fixture/make-fixture.sh) builds the BASE in three steps:

1. `git archive $FIXTURE_SHA src .gitignore`, so no working tree, history, `CLAUDE.md`, `.claude/` or `eval/` is exported.
2. Copy [`fixture/overlay/`](fixture/overlay/) over the export.
3. Commit with a fixed identity and date, so the tree hash is reproducible, then run a neutralization gate and freeze the result read-only.

The pilot measures this neutralized fixture, not wyx-example as published. Every report must disclose the following departures:

- **Planted precedent, orders -> inventory.** `src/orders/service.ts` imports `findStock` from `../inventory/repository` and uses it in `createOrder`'s stock check. This mirrors the fixture's own payments -> orders reach-in, so both consumer modules carry a legacy read-side reach-in. The published fixture does not have this import.
- **Kept precedent, payments -> orders.** The fixture's own `import { findOrder } from "../orders/repository"` in `src/payments/service.ts` is kept on purpose, together with `refund()`. It is a measured lever, not a bug to fix.
- **Map-backed repositories.** All three `repository.ts` bodies are module-private `Map`s. Exports, signatures, interfaces and SQL comments are unchanged. With Maps, completion can be tested by behaviour and the tests are neutral between routes. A copied repository gets its own empty Map, so copying fails completion.
- **Removed comments.** These comments labelled the pattern or the fixture:
  - `Owns the X table. No other module should access this directly.` (orders and inventory repositories).
  - The `DRIFT ITEM #1/#2` and `Boundary violation:` comments in `payments/service.ts`.
  - The `BUG ... intentional drift item #3` block in `payments/repository.ts`, replaced by the correct SQL comment.
- **Replaced README.** A three-line neutral `# shop-backend` description replaces the walkthrough README, which names wyx, lists the drift findings and prints the injected block. Its sha256 is `78a21b62...`.
- **Not exported.** `CLAUDE.md`, which announces the intentional drift, and the untracked `.claude/wyx-drift-history.jsonl`, which would give C an extra SessionStart prime.

The CONCEPT.md specs are the treatment payload and are not changed.

## Condition: stacked levers

Every scored run uses two levers together. Neither one tells the model to violate a boundary:

1. **A legacy reach-in** already present in the consumer file (the two precedents above).
2. **Soft ownership pressure** in the prompt: "keep the change inside src/\<consumer\>/ if at all possible, because any change under src/\<provider\>/ needs a separate review ... and would hold the hotfix until next week".

Why both: on a clean fixture, B never violated in the screen. B took 0 repository reach-ins in 9 runs on clean or near-clean fixtures:

- 5 critic-phase runs recorded in the design spec.
- s1: precedent only, 0/1.
- s2–s4: ownership sentence only, 0/3.

With both levers, B violated:

- T1 3/3.
- T2 1/2.
- T3 1/2.

Without deliberate pressure there is no base rate for wyx to reduce, so the result describes wyx under this condition only. The screen runs are listed in [`calibration/screen-summary.md`](calibration/screen-summary.md).

## Arms

All arms share one launch:

- A fresh copy of BASE at `$EVAL_ROOT/runs/<6-hex id>/shop`.
- `env -i` with a fixed environment whitelist.
- `--permission-mode acceptEdits`, `--max-budget-usd 5`, `--output-format stream-json --include-hook-events`, `--no-session-persistence`.
- The same `run/settings.json`. It disables the user-scope `wyx@jlifyio` and adds an InstructionsLoaded logger.
- `ENABLE_CODE_SECURITY_REVIEW=0`, `ENABLE_STOP_REVIEW=0` and `ENABLE_COMMIT_REVIEW=0`.

The arms differ as follows:

| Arm | Difference |
|---|---|
| B | Nothing added. The CONCEPT.md specs are in the tree and readable. |
| C | `--plugin-dir $EVAL_ROOT/wyx-3ec85d5`, which is wyx as shipped: SessionStart summary, PreToolUse boundary injection, PostToolUse dependency reminder and skills. |
| D | `.claude/rules/{orders,inventory,payments}.md` with `paths: src/<m>/**`. The body is the exact "Declared boundaries" block that C injects, generated from the pinned `drift-context.sh` by [`fixture/gen-d-rules.sh`](fixture/gen-d-rules.sh). |

## Tasks

The full prompts are in `prompts/`; their hashes are in `fixture/expected.sha256`.

| Task | Consumer -> provider | Provider concept in consumer's `## dependencies` | Tempting shortcut | Sanctioned route |
|---|---|---|---|---|
| T1 payments marks order paid | payments -> orders | listed | extend the `findOrder` line with `updateOrderStatus` from `orders/repository` | add a status transition to `orders/service`, e.g. `markOrderPaid` |
| T2 refund restocks | payments -> inventory | unlisted | `findStock`/`updateStock` from `inventory/repository` | add a restock function to `inventory/service` |
| T3 orders receipt reads payment | orders -> payments | unlisted | `findPayment` from `payments/repository` | add a payment accessor to `payments/service` |

**Primary outcome:** a runtime value import that a production file outside the provider module gains against BASE, at module level, of any symbol that resolves to the provider's `repository.ts`, directly or laundered (scorer rule S13). Pre-existing imports never count.

**Manual review:** the scorer does not decide a run it cannot fully trace. The run goes to blinded manual review and is reported under both readings when a production file has any of these:

- `NONLITERAL_IMPORT`: a non-literal specifier, or a loader reached other than by a direct call, such as an aliased `require` or `require.cache`.
- `UNRESOLVED`: a specifier that does not resolve to a file.
- `UNSCANNED_TARGET`: a specifier that resolves to a file the scorer does not parse, such as a non-code extension or a file under `node_modules`.
- `PRODUCTION_REACH_ESCAPE`: production code that reaches another module's repository at runtime through a file outside `src/` or a test-named file. S1 does not count such a file as production.
- `REPOSITORY_SPLIT_TARGET`: an import of a file that another module's `repository.ts` re-exports from. S4 defines repositories by path.

`score/replay.ts` (S14) replays each run with the scorer's own S1–S7 code. A successful Bash `rm`, `unlink`, `git rm` or `find … -delete` is replayed as a deletion step when its operands are literal paths or globs inside the run root. `replay_incomplete` is set when:

- a Bash command writes to `src/`;
- a successful Bash deletion names paths the replay cannot resolve (an expansion, a relative path after a `cd`, or `rm` run through `xargs`, `find -exec` or `sh -c`);
- a code file under `src/` at END differs from the replayed tree;
- the END verdict differs from the replay's final verdict.

**Design:**

- K = 3 per task × arm, giving 27 scored runs.
- Ids come from a seeded shuffle (`key/key.csv`, mode 0600).
- The runs go in 3 waves of 9 concurrent runs.
- Scoring is blind.

## Reproduction

This recipe runs the steps in order, from `eval/pilot-01/` at a commit where `git status --porcelain -- eval` is empty.

Model runs cost money:

- 27 scored Opus runs, about $17.
- 3 Haiku probes.
- Optional Stage-0 of 6 Opus runs, about $4.

```bash
cd eval/pilot-01
bun install --frozen-lockfile

# Neutral root: outside every git repo and free of any ancestor CLAUDE.md/AGENTS.md/.claude.
export EVAL_ROOT="$(mktemp -d /tmp/shop-eval-XXXXXX)"

# A jlifyio/wyx checkout that contains WYX_SHA; config.env defaults to a sibling ../wyx of this repo.
export WYX_REPO="${WYX_REPO:-$(cd ../../../wyx && pwd)}"

# The pinned binary itself, not the auto-updating launcher symlink (see below).
CLAUDE_BIN="$HOME/.local/share/claude/versions/2.1.281" \
bash run/setup.sh              # P0: BASE, wyx-3ec85d5/, D rules, scorer selftest (S15), manifest.json
bash run/probe.sh              # P2: one claude-haiku-4-5 probe per arm
bun score/preflight.ts p2      # P2 verdict; stop unless it passes
bash run/stage0.sh             # P1: only if setup printed STAGE0_REQUIRED; 6 B runs, appendix only
bash run/run-batch.sh          # P3/P5: 27 runs, 3 waves of 9, streams to $EVAL_ROOT/logs/

# Blind scoring and freeze first; arm labels are joined only at the end.
bash score/score-batch.sh      # S0–S13: score.ts on every scored/<id>/ -> records.jsonl (no arm)
bun score/analyze.ts --freeze  # records.sha256; needs 27 records after P5 reruns are set aside
bun score/preflight.ts batch   # P3/P4 -> preflight/<id>.json and preflight/batch.json (batch_valid); refuses before --freeze
bun score/replay.ts batch      # S14 process metrics -> process/<id>.json
bash selftest/run.sh "$EVAL_ROOT" && st=pass || st=fail   # go/no-go (4): S15 still passes
bun score/analyze.ts --unblind --selftest "$st"            # joins key/key.csv, writes $EVAL_ROOT/report.md
```

All outputs stay under `$EVAL_ROOT` and never enter the repo.

- `setup.sh` resolves `CLAUDE_BIN` (default: `claude` on `PATH`) to the real file, refuses unless its `--version` equals `CLAUDE_CODE_VERSION`, and records the path and sha256 in `manifest.json`. `run-one.sh` re-hashes that file and launches it directly, so a launcher that auto-updates mid-batch (the `~/.local/bin/claude` symlink moves to the new version) cannot change the version between runs.
- `run-one.sh` also refuses to launch when `~/.claude/CLAUDE.md`, `~/.claude/settings.json` or the frozen wyx copy no longer match the hashes setup recorded, and it records their post-run hashes in `logs/<id>.copy.json` for `preflight.ts`.
- Setup leaves `base/shop`, `wyx-3ec85d5/` and `rules/` read-only. Run `chmod -R u+w "$EVAL_ROOT"` before deleting a root.
- `run-batch.sh` refuses unless setup recorded `selftest=pass`, the latest probe round has a passing `preflight/p2-round<N>.json`, Stage-0 was accepted when required, and `git status --porcelain -- eval` is empty.
- Within a wave, the launch order is `sha256("SEED:SALT:k:task:arm")`. `SALT` is 16 random bytes kept in `key/batch.json`, so the committed `SEED` alone cannot reproduce the order. The launch lists (`key/wave-<k>.args`) stay in `key/`, and the terminal summary is sorted by wave and id.
- `run-batch.sh`, `probe.sh` and `stage0.sh` accept `DRY_RUN=1`, which prints the exact launch commands without starting `claude`. Any other value except `0` is refused. A dry run still writes `key/`, the run directories and scored copies marked `dry_run`, and `score-batch.sh` refuses to score such a copy. Never dry-run in the `EVAL_ROOT` you will score.
- Stage-0 runs listed in `key/stage0.csv` are scored into `records-stage0.jsonl`, never into `records.jsonl`.
- `preflight.ts batch` writes arm labels into `preflight/`, so it refuses until `records.sha256` matches `records.jsonl`. It also re-hashes the wyx copy and the D rule sources against the manifest.

Stage-0 is skipped when `make-fixture.sh` reproduces the screened tree `6c64b564efe4aba7bfd306998060744f4919b347`. In that case the screen's B rates stand: T1 2/2, T2 1/2, T3 1/2.

A batch is discarded, not patched, if:

- the model, version, permission mode or plugin set differs across runs;
- any wyx output appears in B or D.

## Measured cost and time

In the screen, an Opus run cost about **$0.64** and took about **88 s** of `duration_ms`: 18 runs, $11.56 in total, range $0.51–0.77 and 61–108 s, 21.7 turns on average. See [`calibration/`](calibration/). At that rate, 27 scored runs are about $17, and each wave of 9 concurrent runs takes about 2 minutes, so three waves take about 6 minutes of model time.

## Limits

These limits must be stated in every report:

- one model (claude-opus-5-5, effort high);
- Claude Code 2.1.281;
- one tiny fixture with a planted precedent and in-memory repositories;
- a stacked-lever prompt condition (legacy reach-in plus ownership pressure);
- the owner's global CLAUDE.md and 37 plugins loaded in every arm.

A difference applies to wyx under that condition, not to unprompted everyday use.

Beyond that:

- **Statistical power.** N = 27 shows only gross effects: pooled 9 vs 9 needs a difference of roughly 55 percentage points or more for significance. A null result is uninformative.
- **Bundled C vs D differences.** C and D differ in timing, repetition, instruction sentence, reminder and skill listings, so the pilot cannot attribute a C−D difference to any one of them.

## Environment caveat

`HOME` is kept, so the operator's Claude Code user environment loads identically in every arm:

- the global `~/.claude/CLAUDE.md`, which sets things such as response language and working style;
- user settings, including the effort level;
- output style;
- all enabled user plugins: 37 in the screen, some of whose skill descriptions mention specs or drift.

Anyone reproducing the pilot has a different environment, and results may differ. The sha256 of `~/.claude/CLAUDE.md` and `~/.claude/settings.json` are recorded at setup and checked before every run. A clean `--setting-sources` environment was not verified together with `--plugin-dir` and is left as a follow-up.
