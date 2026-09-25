#!/usr/bin/env bash
# Run the P2 harness probes: one run per arm with PROBE_MODEL and the fixed probe prompt, prepared exactly like scored
# runs (run-one.sh, task P2). Probe ids are 'p' + 6 hex, recorded in key/probes.csv and never in key/key.csv.
# Usage: probe.sh [EVAL_ROOT]   (EVAL_ROOT may come from the environment; DRY_RUN=1 prints commands only)
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ $# -le 1 ] || die "usage: probe.sh [EVAL_ROOT]"
load_config
resolve_root "${1:-}"
export DRY_RUN=${DRY_RUN:-0}
PKEY="$ROOT/key/probes.csv"

load_used_ids
round=1
if [ -f "$PKEY" ]; then
  last=$(awk -F, 'NR > 1 && $4 + 0 > m { m = $4 + 0 } END { print m + 0 }' "$PKEY")
  round=$((last + 1))
fi
args="$ROOT/key/probe-$round.args"
: >"$args"
ids=()
new_rows=()
for a in "${ARM_LIST[@]}"; do
  new_id
  id="p$NEW_ID"
  ids+=("$id")
  new_rows+=("$id,$a,$PROBE_MODEL,$round")
  printf '%s P2 %s %s\n' "$id" "$a" "$PROBE_MODEL" >>"$args"
done
(
  umask 077
  [ -f "$PKEY" ] || printf 'id,arm,model,round\n' >"$PKEY"
  printf '%s\n' "${new_rows[@]}" >>"$PKEY"
)
chmod 600 "$PKEY"

note "probe round $round: ${#ids[@]} runs with $PROBE_MODEL"
xrc=0
launch_lines "$args" "${#ids[@]}" "$ROOT/key/probe-$round.out" || xrc=$?
if [ "$DRY_RUN" = 1 ]; then
  for id in "${ids[@]}"; do
    printf 'DRY_RUN probe %s: ' "$id"
    cat -- "$ROOT/logs/$id.cmd"
  done
fi
[ "$xrc" -eq 0 ] || die "run-one.sh failed for a probe (xargs exit $xrc)"

# Quick triage only; the P2 verdict comes from score/preflight.ts.
printf 'arm\t'
summary_header | tr -d '\n'
printf '\tperm_mode\twyx_plugins\twyx_hook_stdout\tuser_claude_md\tpath_glob_match\n'
for row in "${new_rows[@]}"; do
  IFS=, read -r id a _ _ <<<"$row"
  line=$(summary_line "$id")
  tri=$'-\t-\t-'
  instr=$'-\t-'
  if [ "$DRY_RUN" != 1 ] && [ -e "$ROOT/logs/$id.jsonl" ]; then
    tri=$(jq -R -n -r '[inputs | fromjson? | select(type == "object")] as $e
      | ($e | map(select(.type == "system" and .subtype == "init"))) as $i
      | ($e | map(select(.type == "system" and .subtype == "hook_response") | ((.stdout // "") + (.output // "")))) as $h
      | [($i[0].permissionMode // "-"), ([$i[0].plugins[]? | select(.name == "wyx")] | length),
         ([$h[] | select(contains("wyx drift context:") or contains("wyx post-edit check:") or contains("wyx artifacts:"))] | length)]
      | map(tostring) | join("\t")' "$ROOT/logs/$id.jsonl") || die "could not scan $ROOT/logs/$id.jsonl"
  fi
  if [ "$DRY_RUN" != 1 ] && [ -e "$ROOT/logs/$id.instr.jsonl" ]; then
    instr=$(jq -R -n -r --arg md "$HOME/.claude/CLAUDE.md" '[inputs | fromjson? | select(type == "object")] as $l
      | [([$l[] | select(.load_reason == "session_start" and .file_path == $md)] | length),
         ([$l[] | select(.load_reason == "path_glob_match")] | length)] | map(tostring) | join("\t")' \
      "$ROOT/logs/$id.instr.jsonl") || die "could not scan $ROOT/logs/$id.instr.jsonl"
  fi
  printf '%s\t%s\t%s\t%s\n' "$a" "$line" "$tri" "$instr"
done
note "probes are in key/probes.csv; judge P2 with score/preflight.ts before the batch"
