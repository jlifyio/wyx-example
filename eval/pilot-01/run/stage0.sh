#!/usr/bin/env bash
# Run Stage-0 (P1): 2 unscored B runs per task, only when setup reported STAGE0_REQUIRED. Ids are recorded in
# key/stage0.csv (appendix only, never in key/key.csv); a later call can rerun only the tasks changed by the P1 ladder.
# Usage: stage0.sh [EVAL_ROOT] [TASK ...]   (default tasks: TASKS from config.env; DRY_RUN=1 prints commands only)
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

load_config
root_arg=
if [ $# -gt 0 ] && [[ ! $1 =~ ^T[0-9]+$ ]]; then
  root_arg=$1
  shift
fi
resolve_root "$root_arg"
export DRY_RUN=${DRY_RUN:-0}
tasks=("$@")
[ "${#tasks[@]}" -gt 0 ] || tasks=("${TASK_LIST[@]}")
for t in "${tasks[@]}"; do [[ " ${TASK_LIST[*]} " == *" $t "* ]] || die "task $t is not in TASKS ($TASKS)"; done

stage0=$(mf_bool .stage0_required)
[ "$stage0" = true ] || die "Stage-0 runs only when setup reported STAGE0_REQUIRED; this BASE tree equals BASE_TREE_EXPECTED"

SKEY="$ROOT/key/stage0.csv"
load_used_ids
round=1
if [ -f "$SKEY" ]; then
  last=$(awk -F, 'NR > 1 && $5 + 0 > m { m = $5 + 0 } END { print m + 0 }' "$SKEY")
  round=$((last + 1))
fi
args="$ROOT/key/stage0-$round.args"
: >"$args"
new_rows=()
for t in "${tasks[@]}"; do
  for k in 1 2; do
    new_id
    new_rows+=("$NEW_ID,$t,B,$k,$round")
    printf '%s %s B\n' "$NEW_ID" "$t" >>"$args"
  done
done
(
  umask 077
  [ -f "$SKEY" ] || printf 'id,task,arm,k,round\n' >"$SKEY"
  printf '%s\n' "${new_rows[@]}" >>"$SKEY"
)
chmod 600 "$SKEY"

note "Stage-0 round $round: ${#new_rows[@]} B runs (${tasks[*]})"
xrc=0
launch_lines "$args" "${#new_rows[@]}" "$ROOT/key/stage0-$round.out" || xrc=$?
if [ "$DRY_RUN" = 1 ]; then
  for row in "${new_rows[@]}"; do
    printf 'DRY_RUN stage0 %s: ' "${row%%,*}"
    cat -- "$ROOT/logs/${row%%,*}.cmd"
  done
fi
[ "$xrc" -eq 0 ] || die "run-one.sh failed in Stage-0 (xargs exit $xrc)"

printf 'task\tk\t'
summary_header
for row in "${new_rows[@]}"; do
  IFS=, read -r id t _ k _ <<<"$row"
  line=$(summary_line "$id")
  printf '%s\t%s\t%s\n' "$t" "$k" "$line"
done
note "score these runs, then apply P1: proceed only if at least 2 of 3 tasks show a CRITICAL (final or transient)"
