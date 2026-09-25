#!/usr/bin/env bash
# Blind batch scoring (S0): runs score/score.ts on every scored/<id>/ copy of a T1-T3 run and writes records.jsonl
# ({run_id, task, score}). Stage-0 ids (key/stage0.csv) go to records-stage0.jsonl; probes (task P2) are skipped.
# Reads scored/<id>.meta.json (id, task, orig_root) and the id column of key/stage0.csv; never key.csv, logs or preflight.
# Usage: score-batch.sh [EVAL_ROOT]   (EVAL_ROOT may come from the environment)
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../run/lib.sh"

[ $# -le 1 ] || die "usage: score-batch.sh [EVAL_ROOT]"
resolve_root "${1:-}"
[ ! -e "$ROOT/records.sha256" ] || die "records.jsonl is frozen ($ROOT/records.sha256); scoring cannot be redone"
BASE=$(mf .base_dir)
[ -d "$BASE/src" ] || die "BASE has no src/: $BASE"

declare -A STAGE0=()
if [ -f "$ROOT/key/stage0.csv" ]; then
  while IFS=, read -r id _; do
    [ "$id" != id ] || continue
    [ -z "$id" ] || STAGE0[$id]=1
  done <"$ROOT/key/stage0.csv"
fi

WORK=$(mktemp -d "$ROOT/tmp/score-batch.XXXXXX")
trap 'rm -rf -- "$WORK"' EXIT
: >"$WORK/records.jsonl"
: >"$WORK/records-stage0.jsonl"
n=0
n0=0
printf 'id\ttask\tviolation\tcritical_runtime_n\tcomplete\tmanual_review\n'
for meta in "$ROOT"/scored/*.meta.json; do
  [ -f "$meta" ] || continue
  id=$(jq -er .id "$meta") || die "cannot read id from $meta"
  task=$(jq -er .task "$meta") || die "cannot read task from $meta"
  orig=$(jq -er .orig_root "$meta") || die "cannot read orig_root from $meta"
  [ "$meta" = "$ROOT/scored/$id.meta.json" ] || die "$meta names id $id"
  case $task in
    P2) continue ;;
    T1 | T2 | T3) ;;
    *) die "$meta has unknown task $task" ;;
  esac
  dry=$(jq -r '.dry_run | tostring' "$meta") || die "cannot read dry_run from $meta"
  case $dry in
    false) ;;
    true) die "$meta is a DRY_RUN copy (no claude run); score only an EVAL_ROOT without dry runs" ;;
    *) die "$meta lacks a boolean dry_run" ;;
  esac
  [ -d "$ROOT/scored/$id/src" ] || die "scored copy missing or without src/: $ROOT/scored/$id"
  if ! bun "$HARNESS/score/score.ts" --base "$BASE" --run "$ROOT/scored/$id" --task "$task" --orig-root "$orig" \
    >"$WORK/$id.json" 2>"$WORK/$id.err"; then
    cat -- "$WORK/$id.err" >&2
    die "score.ts failed for $id; no records written"
  fi
  out="$WORK/records.jsonl"
  if [ -n "${STAGE0[$id]-}" ]; then out="$WORK/records-stage0.jsonl"; n0=$((n0 + 1)); else n=$((n + 1)); fi
  jq -c --arg id "$id" --arg task "$task" '{run_id: $id, task: $task, score: .}' "$WORK/$id.json" >>"$out" \
    || die "score.ts output for $id is not JSON"
  jq -r --arg id "$id" --arg task "$task" \
    '[$id, $task, .violation, .critical_runtime_n, .completion.complete, .manual_review_required] | map(tostring) | join("\t")' \
    "$WORK/$id.json" || die "cannot summarise $id"
done
[ $((n + n0)) -gt 0 ] || die "no scored T1-T3 runs under $ROOT/scored"
mv -- "$WORK/records.jsonl" "$ROOT/records.jsonl"
if [ "$n0" -gt 0 ]; then mv -- "$WORK/records-stage0.jsonl" "$ROOT/records-stage0.jsonl"; fi
note "wrote $n records to $ROOT/records.jsonl$([ "$n0" -eq 0 ] || printf '; %s Stage-0 records to records-stage0.jsonl' "$n0")"
