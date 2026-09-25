#!/bin/bash
# Generate arm D's rule files $EVAL_ROOT/rules/{orders,inventory,payments}.md from the pinned wyx drift-context.sh
# over $EVAL_ROOT/base/shop (spec.arm_setup.d_rule_template) and check them against expected.sha256.
# Extracts the frozen plugin copy $EVAL_ROOT/wyx-<WYX_SHA:0:7> from WYX_REPO when it is absent.
# Usage: gen-d-rules.sh EVAL_ROOT   (run make-fixture.sh first)
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PILOT=$(dirname "$HERE")
source "$PILOT/config.env"
EXPECTED="$HERE/expected.sha256"

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

die() { echo "gen-d-rules: $*" >&2; exit 1; }
sha() { [ -f "$1" ] || die "missing file: $1"; local h; h=$(sha256sum < "$1"); printf '%s' "${h%% *}"; }
expect() {
  local v
  v=$(awk -v k="$1" '$2 == k && $1 ~ /^[0-9a-f]+$/ && length($1) == 64 { print $1; n++ } END { exit n == 1 ? 0 : 1 }' "$EXPECTED") \
    || die "expected.sha256 needs exactly one valid entry for $1"
  printf '%s' "$v"
}

[ $# -eq 1 ] || die "usage: gen-d-rules.sh EVAL_ROOT"
EVAL_ROOT=$(cd "$1" && pwd)
BASE="$EVAL_ROOT/base/shop"
[ -d "$BASE/src" ] || die "no BASE at $BASE; run make-fixture.sh first"
PLUGIN="$EVAL_ROOT/wyx-${WYX_SHA:0:7}"
HOOK="$PLUGIN/scripts/drift-context.sh"

if [ ! -e "$PLUGIN" ]; then
  git -C "$WYX_REPO" cat-file -e "$WYX_SHA^{commit}" 2>/dev/null || die "WYX_SHA $WYX_SHA is not a commit in $WYX_REPO"
  mkdir "$PLUGIN"
  git -C "$WYX_REPO" archive "$WYX_SHA" .claude-plugin hooks scripts skills | tar -x -C "$PLUGIN"
fi
pinned=$(git -C "$WYX_REPO" show "$WYX_SHA:scripts/drift-context.sh" | sha256sum)
hook_sha=$(sha "$HOOK")
[ "$hook_sha" = "${pinned%% *}" ] || die "$HOOK differs from $WYX_SHA:scripts/drift-context.sh"

gen() {
  local ctx
  ctx=$(printf '{"tool_name":"Edit","tool_input":{"file_path":"%s/src/%s/service.ts"}}' "$BASE" "$1" \
    | CLAUDE_PROJECT_DIR="$BASE" bash "$HOOK" | jq -r .hookSpecificOutput.additionalContext)
  awk '/^Declared boundaries:$/{f=1;next} /^Before adding an import/{exit} f' <<<"$ctx" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
}

mkdir -p "$EVAL_ROOT/rules"
for m in orders inventory payments; do
  out="$EVAL_ROOT/rules/$m.md"
  { printf -- '---\npaths:\n  - "src/%s/**"\n---\n' "$m"; gen "$m"; } > "$out"
  for s in interactions dependencies; do
    n=$(/usr/bin/grep -acxF -- "  [src/$m/CONCEPT.md ## $s]" "$out") || [ "$?" -eq 1 ] || die "could not scan $out"
    [ "$n" = 1 ] || die "$out: expected one '[src/$m/CONCEPT.md ## $s]' header, got $n"
  done
  got=$(sha "$out")
  want=$(expect "rules/$m.md")
  [ "$got" = "$want" ] || die "$out sha256 $got differs from expected.sha256 $want"
  echo "RULE $m $got ok"
done
echo "PLUGIN=$PLUGIN"
echo "RULES=$EVAL_ROOT/rules"
