#!/bin/bash
# Build the pilot-01 BASE at $EVAL_ROOT/base/shop: export FIXTURE_SHA (src, .gitignore), apply the overlay,
# run the neutralization gate, commit deterministically, compare the tree to BASE_TREE_EXPECTED and freeze it.
# Usage: make-fixture.sh [EVAL_ROOT]   (default: a new mktemp -d from EVAL_ROOT_TEMPLATE)
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PILOT=$(dirname "$HERE")
source "$PILOT/config.env"
EXPECTED="$HERE/expected.sha256"
OVERLAY="$HERE/overlay"

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

die() { echo "make-fixture: $*" >&2; exit 1; }
warn() { echo "make-fixture: WARNING: $*" >&2; }
sha() { [ -f "$1" ] || die "missing file: $1"; local h; h=$(sha256sum < "$1"); printf '%s' "${h%% *}"; }
expect() {
  local v
  v=$(awk -v k="$1" '$2 == k && $1 ~ /^[0-9a-f]+$/ && length($1) == 64 { print $1; n++ } END { exit n == 1 ? 0 : 1 }' "$EXPECTED") \
    || die "expected.sha256 needs exactly one valid entry for $1"
  printf '%s' "$v"
}
# Fails on any match (grep exit 0) and on any scan error (exit >1); only exit 1 means "nothing found".
gate_absent() {
  local label=$1 rc=0
  shift
  /usr/bin/grep "$@" >&2 || rc=$?
  case $rc in
    1) ;;
    0) die "gate: $label found (matches above)" ;;
    *) die "gate: could not scan for $label (grep exit $rc)" ;;
  esac
}
# The exact line must occur once in its file and nowhere else in the tree.
gate_once() {
  local file=$1 line=$2 n counts total
  n=$(/usr/bin/grep -acxF -- "$line" "$B/$file") || [ "$?" -eq 1 ] || die "gate: could not scan $file"
  counts=$(/usr/bin/grep -ahrxcF -- "$line" "$B") || [ "$?" -eq 1 ] || die "gate: could not scan $B"
  total=$(awk '{ s += $1 } END { print s + 0 }' <<<"$counts")
  [ "$n" = 1 ] && [ "$total" = 1 ] || die "gate: expected once in $file and once in the tree, got $n and $total: $line"
}

REPO=$(git -C "$HERE" rev-parse --show-toplevel)
git -C "$REPO" cat-file -e "$FIXTURE_SHA^{commit}" 2>/dev/null || die "FIXTURE_SHA $FIXTURE_SHA is not a commit in $REPO"

EVAL_ROOT=${1:-$(mktemp -d "$EVAL_ROOT_TEMPLATE")}
mkdir -p "$EVAL_ROOT"
EVAL_ROOT=$(cd "$EVAL_ROOT" && pwd)
B="$EVAL_ROOT/base/shop"
[ ! -e "$B" ] && [ ! -L "$B" ] || die "$B already exists; use a fresh EVAL_ROOT"

# Neutrality is asserted by preflight P0; warn early so a bad root is not discovered after the build.
case "$EVAL_ROOT" in *[Ww][Yy][Xx]* | *[Cc][Ll][Aa][Uu][Dd][Ee]*) warn "EVAL_ROOT path contains a wyx/claude token: $EVAL_ROOT" ;; esac
if git -C "$EVAL_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then warn "EVAL_ROOT is inside a git work tree"; fi
d=$EVAL_ROOT
while :; do
  for n in CLAUDE.md CLAUDE.local.md AGENTS.md .claude; do
    if [ -e "$d/$n" ]; then warn "$d/$n exists at or above EVAL_ROOT"; fi
  done
  if [ "$d" = / ]; then break; fi
  d=$(dirname "$d")
done

mkdir -p "$B"
git -C "$REPO" archive "$FIXTURE_SHA" src .gitignore | tar -x -C "$B"

want=$(awk '$2 ~ /^fixture\/overlay\// { print substr($2, 17) }' "$EXPECTED" | LC_ALL=C sort)
have=$(cd "$OVERLAY" && find . -type f -printf '%P\n' | LC_ALL=C sort)
[ -n "$want" ] && [ "$want" = "$have" ] || die "overlay file set differs from expected.sha256"$'\n'"expected:"$'\n'"$want"$'\n'"found:"$'\n'"$have"
while IFS= read -r rel; do
  install -m 0644 -D -- "$OVERLAY/$rel" "$B/$rel"
done <<<"$want"
find "$B" -type d -exec chmod 0755 {} +
find "$B" -type f -exec chmod 0644 {} +

# Post-condition gate (spec.neutralization), run before git init so .git is never scanned.
gate_absent "fixture meta-language" -arniE 'drift|intentional|violation|should access|wyx|BUG|Should be|No other module' "$B"
gate_once src/payments/service.ts 'import { findOrder } from "../orders/repository";'
gate_once src/orders/service.ts 'import { findStock } from "../inventory/repository";'
gate_absent "bracketed '## dependencies]' header" -arF '## dependencies]' "$B"
hits=$(find "$B" \( -name .claude -o -name CLAUDE.md -o -name CLAUDE.local.md -o -name AGENTS.md \) -print)
[ -z "$hits" ] || die "gate: instruction files present in BASE:"$'\n'"$hits"
concept_note=""
for m in orders inventory payments; do
  f="src/$m/CONCEPT.md"
  pinned=$(git -C "$REPO" show "$FIXTURE_SHA:$f" | sha256sum)
  got=$(sha "$B/$f")
  screened=$(expect "base/shop/$f")
  [ "$got" = "${pinned%% *}" ] || die "gate: $f differs from $FIXTURE_SHA:$f"
  [ "$got" = "$screened" ] || concept_note="$concept_note $f"
done
while IFS= read -r rel; do
  got=$(sha "$B/$rel")
  pin=$(expect "fixture/overlay/$rel")
  [ "$got" = "$pin" ] || die "gate: overlay $rel sha256 $got differs from expected.sha256 $pin"
done <<<"$want"

export GIT_AUTHOR_NAME=dev GIT_AUTHOR_EMAIL=dev@example.com GIT_COMMITTER_NAME=dev GIT_COMMITTER_EMAIL=dev@example.com
export GIT_AUTHOR_DATE=2026-01-01T00:00:00Z GIT_COMMITTER_DATE=2026-01-01T00:00:00Z
git -C "$B" init -q -b main
git -C "$B" add -A
git -C "$B" -c commit.gpgsign=false commit -q --no-verify -m 'initial commit'
tree=$(git -C "$B" rev-parse 'HEAD^{tree}')
commit=$(git -C "$B" rev-parse HEAD)
st=$(git -C "$B" status --porcelain --ignored)
[ -z "$st" ] || die "BASE is not clean after the commit:"$'\n'"$st"
chmod -R a-w "$B"

echo "EVAL_ROOT=$EVAL_ROOT"
echo "BASE=$B"
echo "BASE_TREE=$tree"
echo "BASE_COMMIT=$commit"
if [ "$tree" = "$BASE_TREE_EXPECTED" ]; then
  echo "STAGE0=skip (BASE tree equals the screened tree $BASE_TREE_EXPECTED)"
else
  [ -z "$concept_note" ] || echo "NOTE: spec wording differs from the screened CONCEPT.md:$concept_note"
  echo "STAGE0_REQUIRED base_tree=$tree screened=$BASE_TREE_EXPECTED (run Stage-0, P1: 2 B runs per task, before the batch)"
fi
