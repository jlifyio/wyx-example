#!/usr/bin/env bash
# Run the pilot-01 scored batch (P5): key/key.csv with opaque ids and a seeded within-wave launch order, then K waves
# of TASKS x ARMS cells launched concurrently through xargs -P; a stream without an init event is rerun once.
# Usage: run-batch.sh [EVAL_ROOT]   (EVAL_ROOT may come from the environment; DRY_RUN=1 prints commands only)
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ $# -le 1 ] || die "usage: run-batch.sh [EVAL_ROOT]"
load_config
resolve_root "${1:-}"
export DRY_RUN=${DRY_RUN:-0}
PAR=$((${#TASK_LIST[@]} * ${#ARM_LIST[@]}))
gate() { if [ "$DRY_RUN" = 1 ]; then note "DRY_RUN: a real batch would refuse: $*"; else die "$*"; fi; }

# Gates: Stage-0 (P1), selftest (S15), P2 probes of the latest round, committed harness (P0).
stage0=$(mf_bool .stage0_required)
if [ "$stage0" = true ] && [ "${STAGE0_ACCEPTED:-0}" != 1 ]; then
  gate "setup reported STAGE0_REQUIRED; run stage0.sh, apply P1, then rerun with STAGE0_ACCEPTED=1"
fi
selftest=$(mf .selftest)
[ "$selftest" = pass ] || gate "setup recorded selftest=$selftest; S15 must pass before any scored run"
p2_round=0
if [ -f "$ROOT/key/probes.csv" ]; then
  p2_round=$(awk -F, 'NR > 1 && $4 + 0 > m { m = $4 + 0 } END { print m + 0 }' "$ROOT/key/probes.csv") \
    || die "cannot read $ROOT/key/probes.csv"
fi
p2_file="$ROOT/preflight/p2-round$p2_round.json"
if [ "$p2_round" -eq 0 ] || [ ! -f "$p2_file" ]; then
  gate "no P2 verdict for the latest probe round; run probe.sh, then bun score/preflight.ts p2"
else
  p2_pass=$(jq -r '.pass | tostring' "$p2_file") || die "cannot read $p2_file"
  [ "$p2_pass" = true ] || gate "P2 probes of round $p2_round did not pass ($p2_file)"
fi
HARNESS_REPO=$(git -C "$HARNESS" rev-parse --show-toplevel)
harness_rel=${HARNESS#"$HARNESS_REPO"/}
hstatus=$(git -C "$HARNESS_REPO" status --porcelain -- "${harness_rel%%/*}")
harness_clean=true
[ -z "$hstatus" ] || harness_clean=false
[ "$harness_clean" = true ] || gate "git status --porcelain -- ${harness_rel%%/*} is not empty in $HARNESS_REPO"
harness_sha=$(git -C "$HARNESS_REPO" rev-parse HEAD)
setup_sha=$(mf .harness.sha)
[ "$harness_sha" = "$setup_sha" ] || note "WARNING: harness HEAD $harness_sha differs from setup's $setup_sha (inputs are still hash-checked per run)"

# Key: ids from /dev/urandom; within each wave, cells are ordered by ascending sha256("SEED:SALT:k:task:arm"). SEED is
# the committed config.env value and SALT 16 random bytes kept in key/batch.json (0600), so neither the ids nor the
# launch order can be recovered from committed files; the shuffle is reproducible once key/ is opened at unblinding.
KEY="$ROOT/key/key.csv"
[ ! -e "$KEY" ] || die "$KEY exists: this EVAL_ROOT already holds a batch; use a fresh EVAL_ROOT"
SALT=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n') || die "cannot read /dev/urandom"
[[ $SALT =~ ^[0-9a-f]{32}$ ]] || die "bad salt from /dev/urandom"
load_used_ids
rows=()
order=0
for ((k = 1; k <= K; k++)); do
  cells=()
  for t in "${TASK_LIST[@]}"; do
    for a in "${ARM_LIST[@]}"; do
      h=$(sha_str "$SEED:$SALT:$k:$t:$a")
      cells+=("$h $t $a")
    done
  done
  sorted=$(printf '%s\n' "${cells[@]}" | LC_ALL=C sort)
  while read -r _ t a; do
    new_id
    order=$((order + 1))
    rows+=("$NEW_ID,$t,$a,$k,$k,$order,")
  done <<<"$sorted"
done
(
  umask 077
  {
    printf 'id,task,arm,k,wave,launch_order,rerun_of\n'
    printf '%s\n' "${rows[@]}"
  } >"$KEY.tmp"
)
chmod 600 "$KEY.tmp"
mv -- "$KEY.tmp" "$KEY"
(
  umask 077
  jq -n --arg seed "$SEED" --arg salt "$SALT" --arg generated_at "$(now_utc)" --arg harness_sha "$harness_sha" \
    --argjson harness_clean "$harness_clean" --arg dry_run "$DRY_RUN" --argjson k "$K" --argjson parallel "$PAR" \
    --arg tasks "$TASKS" --arg arms "$ARMS" \
    '{seed: $seed, salt: $salt, generated_at: $generated_at, harness_sha: $harness_sha, harness_clean: $harness_clean,
      dry_run: ($dry_run == "1"), k: $k, parallel: $parallel, tasks: ($tasks | split(" ")), arms: ($arms | split(" ")),
      ids: "3 bytes from /dev/urandom, unique within EVAL_ROOT",
      launch_order: "waves k = 1..K; within a wave, cells sorted by ascending sha256(\"SEED:SALT:k:task:arm\")",
      reruns: "a run whose stream has no system/init event is rerun once under a new id (rerun_of)"}' \
    >"$ROOT/key/batch.json"
)
note "key: ${#rows[@]} runs in $K waves written to $KEY (0600); launch order salted (salt in key/batch.json)"

# P0: every planned run path is token-free and has no ~/.claude/projects slug yet.
for row in "${rows[@]}"; do
  id=${row%%,*}
  run="$ROOT/runs/$id/shop"
  path_tokens_ok "$run" || die "planned run path contains a token: $run"
  s=$(slug "$run")
  [ ! -e "$HOME/.claude/projects/$s" ] || die "projects slug exists for planned run $run"
done

# Rows are printed sorted by wave, then id: key.csv order is the launch order, which must not show on the terminal.
print_summary() {
  local row id rerun_of wave lines
  lines=$(
    for row in "${rows[@]}"; do
      IFS=, read -r id _ _ _ wave _ rerun_of <<<"$row"
      printf '%s\t%s\t' "$wave" "${rerun_of:--}"
      summary_line "$id"
    done | LC_ALL=C sort -t $'\t' -k1,1n -k3,3
  )
  printf 'wave\trerun_of\t'
  summary_header
  printf '%s\n' "$lines"
  awk -F'\t' '{ n++; if ($4 == "-") { notrun++; next } if ($4 != "0" && $4 != "DRY") bad++; if ($5 == "0") noinit++
      if ($7 ~ /^[0-9.]+$/) cost += $7 }
    END { printf "runs %d, not launched %d, nonzero exit %d, no init %d, total cost_usd %.4f\n", n, notrun, bad, noinit, cost }' \
    <<<"$lines"
}

# Launch lists name task and arm, so they live in key/ (0700) like key.csv.
for ((k = 1; k <= K; k++)); do
  args="$ROOT/key/wave-$k.args"
  : >"$args"
  wave_rows=()
  for row in "${rows[@]}"; do
    IFS=, read -r id t a _ wave _ _ <<<"$row"
    [ "$wave" = "$k" ] || continue
    printf '%s %s %s\n' "$id" "$t" "$a" >>"$args"
    wave_rows+=("$row")
  done
  note "wave $k: launching ${#wave_rows[@]} runs concurrently (xargs -P $PAR)"
  xrc=0
  launch_lines "$args" "$PAR" "$ROOT/key/wave-$k.out" || xrc=$?
  if [ "$DRY_RUN" = 1 ]; then
    for row in "${wave_rows[@]}"; do
      id=${row%%,*}
      printf 'DRY_RUN wave %s %s: ' "$k" "$id"
      cat -- "$ROOT/logs/$id.cmd"
    done
  fi
  if [ "$xrc" -ne 0 ]; then
    print_summary
    die "wave $k: run-one.sh failed (xargs exit $xrc); batch stopped before the next wave"
  fi
  [ "$DRY_RUN" != 1 ] || continue

  rargs="$ROOT/key/wave-$k.rerun.args"
  : >"$rargs"
  reruns=()
  for row in "${wave_rows[@]}"; do
    IFS=, read -r id t a _ _ _ _ <<<"$row"
    n=$(init_count "$ROOT/logs/$id.jsonl")
    [ "$n" -eq 0 ] || continue
    new_id
    order=$((order + 1))
    rrow="$NEW_ID,$t,$a,$k,$k,$order,$id"
    printf '%s\n' "$rrow" >>"$KEY"
    rows+=("$rrow")
    printf '%s %s %s\n' "$NEW_ID" "$t" "$a" >>"$rargs"
    reruns+=("$NEW_ID")
    note "$id: stream has no init event; rerunning once as $NEW_ID"
  done
  if [ "${#reruns[@]}" -gt 0 ]; then
    xrc=0
    launch_lines "$rargs" "$PAR" "$ROOT/key/wave-$k.rerun.out" || xrc=$?
    if [ "$xrc" -ne 0 ]; then
      print_summary
      die "wave $k reruns: run-one.sh failed (xargs exit $xrc); batch stopped"
    fi
    for id in "${reruns[@]}"; do
      n=$(init_count "$ROOT/logs/$id.jsonl")
      [ "$n" -gt 0 ] || note "WARNING: rerun $id has no init event either; both are reported, no further rerun"
    done
  fi
done

print_summary
note "batch done; key rows (incl. reruns): ${#rows[@]}"
