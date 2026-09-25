#!/bin/bash
# Scorer self-test (spec S15): every real screen patch and every synthetic case must score as expected, and
# BASE vs BASE must yield no findings. Exit 0 only when everything matches.
# Usage: selftest/run.sh [EVAL_ROOT | --base <dir>]
#   EVAL_ROOT: use the BASE already built at EVAL_ROOT/base/shop (as run/setup.sh does).
#   default BASE: built by fixture/make-fixture.sh into a temporary EVAL_ROOT that is removed afterwards.
# Real cases: selftest/real/<id>.patch + a row of selftest/real/expected.tsv (id task arm prompt critical_runtime complete note).
#   A task without score/complete/<task>.test.ts (the T2ship screen variant) uses selftest/real/<task>.test.ts.
# Synthetic cases: selftest/synthetic/<case>/ with exactly one *.patch or *.diff (a git diff against BASE) and expected.json,
#   or a flat selftest/synthetic/<case>.patch + <case>.json. The expected.json format is documented in selftest/assert.ts.
# Process cases (S14 replay, P4 preflight): selftest/process/<case>/ with stream.jsonl, optional instr.jsonl and end.diff
#   (END = BASE + end.diff, or BASE), and expected.json {kind, arm, task, assert}; run through selftest/process.ts.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PILOT=$(dirname "$HERE")
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

BASE=""
case $# in
  0) ;;
  1) BASE="${1%/}/base/shop" ;;
  2) [ "$1" = --base ] || { echo "usage: selftest/run.sh [EVAL_ROOT | --base <dir>]" >&2; exit 2; }; BASE=$2 ;;
  *) echo "usage: selftest/run.sh [EVAL_ROOT | --base <dir>]" >&2; exit 2 ;;
esac

WORK=$(mktemp -d "${TMPDIR:-/tmp}/pilot-selftest-XXXXXX")
cleanup() { chmod -R u+w "${WORK:?}" 2>/dev/null || true; rm -rf "${WORK:?}"; }
trap cleanup EXIT

if [ -z "$BASE" ]; then
  bash "$PILOT/fixture/make-fixture.sh" "$WORK/eval" > "$WORK/make-fixture.out" \
    || { echo "selftest: make-fixture.sh failed; pass --base <dir> to use an existing BASE" >&2; exit 1; }
  BASE="$WORK/eval/base/shop"
fi
[ -d "$BASE/src" ] || { echo "selftest: BASE has no src/: $BASE" >&2; exit 1; }
BASE=$(cd "$BASE" && pwd)
tree=$(git -C "$BASE" rev-parse 'HEAD^{tree}' 2>/dev/null) || tree="(not a git tree)"
echo "BASE $BASE tree $tree"

pass=0
fail=0
t_start=$(date +%s.%N)

# Copies BASE without .git into $1 and applies patch $2 there (a throwaway git repo makes the apply cwd-safe).
make_tree() {
  local dest=$1 patch=$2
  mkdir -p "$dest" || return 1
  tar -C "$BASE" --exclude=./.git -cf - . | tar -C "$dest" -xf - || return 1
  chmod -R u+w "$dest" || return 1
  git -C "$dest" init -q || return 1
  git -C "$dest" apply --whitespace=nowarn "$patch" || return 1
  rm -rf "${dest:?}/.git"
}

# score <label> <tree> <task> [extra args...]: writes $WORK/out/<label>.json; returns non-zero on scorer error.
score() {
  local label=$1 dir=$2 task=$3
  shift 3
  local extra=()
  if [ ! -f "$PILOT/score/complete/$task.test.ts" ] && [ -f "$HERE/real/$task.test.ts" ]; then
    extra=(--complete-test "$HERE/real/$task.test.ts")
  fi
  mkdir -p "$WORK/out"
  bun "$PILOT/score/score.ts" --base "$BASE" --run "$dir" --task "$task" "${extra[@]}" "$@" \
    > "$WORK/out/$label.json" 2> "$WORK/out/$label.err"
}

result() {
  local name=$1 rc=$2 secs=$3
  if [ "$rc" -eq 0 ]; then pass=$((pass + 1)); printf 'ok    %-28s %5.2fs\n' "$name" "$secs"
  else fail=$((fail + 1)); printf 'FAIL  %-28s %5.2fs\n' "$name" "$secs"; fi
}

now() { date +%s.%N; }
elapsed() { awk -v a="$1" -v b="$(now)" 'BEGIN { printf "%.2f", b - a }'; }

# (iii) BASE vs BASE, once per task, including the documented BASE completion failures.
for spec in T1:2 T2:1 T3:3; do
  task=${spec%%:*}
  t0=$(now)
  rc=0
  if score "base-$task" "$BASE" "$task"; then
    bun "$HERE/assert.ts" base "$WORK/out/base-$task.json" "${spec##*:}" || rc=1
  else
    echo "  scorer error:"; sed 's/^/    /' "$WORK/out/base-$task.err"; rc=1
  fi
  result "base-vs-base $task" "$rc" "$(elapsed "$t0")"
done

# (i) real screen cases.
n_real=0
while IFS=$'\t' read -r id task _arm _prompt crit complete _note; do
  [ "$id" = id ] && continue
  [ -n "$id" ] || continue
  n_real=$((n_real + 1))
  t0=$(now)
  rc=0
  patch="$HERE/real/$id.patch"
  if [ ! -f "$patch" ]; then
    echo "  missing $patch"; rc=1
  elif ! make_tree "$WORK/real/$id/shop" "$patch" > "$WORK/apply-$id.log" 2>&1; then
    echo "  patch did not apply:"; sed 's/^/    /' "$WORK/apply-$id.log"; rc=1
  elif ! score "real-$id" "$WORK/real/$id/shop" "$task"; then
    echo "  scorer error:"; sed 's/^/    /' "$WORK/out/real-$id.err"; rc=1
  else
    bun "$HERE/assert.ts" real "$WORK/out/real-$id.json" "$crit" "$complete" || rc=1
  fi
  result "real $id ($task)" "$rc" "$(elapsed "$t0")"
done < "$HERE/real/expected.tsv"
[ "$n_real" -gt 0 ] || { echo "selftest: no real cases in expected.tsv"; fail=$((fail + 1)); }

# (ii) synthetic cases.
n_syn=0
if [ -d "$HERE/synthetic" ]; then
  for entry in "$HERE"/synthetic/*; do
    [ -e "$entry" ] || continue
    if [ -d "$entry" ]; then
      name=$(basename "$entry")
      exp="$entry/expected.json"
      patches=()
      for f in "$entry"/*.patch "$entry"/*.diff; do [ -f "$f" ] && patches+=("$f"); done
    else
      case $entry in *.patch) ;; *) continue ;; esac
      name=$(basename "$entry" .patch)
      exp="${entry%.patch}.json"
      patches=("$entry")
    fi
    n_syn=$((n_syn + 1))
    t0=$(now)
    rc=0
    if [ "${#patches[@]}" -ne 1 ] || [ ! -f "$exp" ]; then
      echo "  case needs exactly one .patch or .diff and an expected json: $entry"; rc=1
    elif ! task=$(jq -er '.task // "T1"' "$exp") || ! orig=$(jq -er '.orig_root // ""' "$exp"); then
      echo "  unreadable $exp"; rc=1
    elif ! make_tree "$WORK/syn/$name/shop" "${patches[0]}" > "$WORK/apply-syn-$name.log" 2>&1; then
      echo "  patch did not apply:"; sed 's/^/    /' "$WORK/apply-syn-$name.log"; rc=1
    else
      args=()
      [ -z "$orig" ] || args=(--orig-root "$orig")
      if ! score "syn-$name" "$WORK/syn/$name/shop" "$task" "${args[@]}"; then
        echo "  scorer error:"; sed 's/^/    /' "$WORK/out/syn-$name.err"; rc=1
      else
        bun "$HERE/assert.ts" synthetic "$WORK/out/syn-$name.json" "$exp" || rc=1
      fi
    fi
    result "synthetic $name" "$rc" "$(elapsed "$t0")"
  done
fi

# (iv) process-metric cases.
n_proc=0
if [ -d "$HERE/process" ]; then
  for entry in "$HERE"/process/*/; do
    [ -f "$entry/expected.json" ] || continue
    name=$(basename "$entry")
    n_proc=$((n_proc + 1))
    t0=$(now)
    rc=0
    end="$WORK/proc/$name/shop"
    mkdir -p "$WORK/proc/$name/tmp"
    if [ -f "$entry/end.diff" ]; then
      make_tree "$end" "$entry/end.diff" > "$WORK/apply-proc-$name.log" 2>&1 || rc=1
    else
      { mkdir -p "$end" && tar -C "$BASE" --exclude=./.git -cf - . | tar -C "$end" -xf -; } > "$WORK/apply-proc-$name.log" 2>&1 || rc=1
    fi
    if [ "$rc" -ne 0 ]; then
      echo "  END tree could not be built:"; sed 's/^/    /' "$WORK/apply-proc-$name.log"
    elif ! bun "$HERE/process.ts" "$entry" "$BASE" "$end" "$WORK/proc/$name/tmp" "$WORK/out/proc-$name.json" > "$WORK/out/proc-$name.err" 2>&1; then
      echo "  process error:"; sed 's/^/    /' "$WORK/out/proc-$name.err"; rc=1
    else
      bun "$HERE/assert.ts" synthetic "$WORK/out/proc-$name.json" "$entry/expected.json" || rc=1
    fi
    result "process $name" "$rc" "$(elapsed "$t0")"
  done
fi

echo "selftest: $pass passed, $fail failed (real $n_real, synthetic $n_syn, process $n_proc, base 3) in $(elapsed "$t_start")s"
[ "$fail" -eq 0 ]
