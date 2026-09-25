#!/bin/bash
# Generate arm E's rule files $EVAL_ROOT/rules-e/{orders,inventory,payments}.md (pilot-02): each is the pilot-01 D rule
# $EVAL_ROOT/rules/<m>.md minus its exact 4-line paths frontmatter, so the body is byte-identical and no frontmatter is
# left (Claude Code loads such a rule at launch). Checks the D sources against fixture/expected.sha256 and the E files
# against the given pins file (keys rules-e/<m>.md).
# Usage: gen-e-rules.sh EVAL_ROOT E_EXPECTED   (run gen-d-rules.sh first)
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
D_EXPECTED="$HERE/expected.sha256"

die() { echo "gen-e-rules: $*" >&2; exit 1; }
sha() { [ -f "$1" ] || die "missing file: $1"; local h; h=$(sha256sum < "$1"); printf '%s' "${h%% *}"; }
expect() {
  local v
  v=$(awk -v k="$2" '$2 == k && $1 ~ /^[0-9a-f]+$/ && length($1) == 64 { print $1; n++ } END { exit n == 1 ? 0 : 1 }' "$1") \
    || die "$1 needs exactly one valid entry for $2"
  printf '%s' "$v"
}

[ $# -eq 2 ] || die "usage: gen-e-rules.sh EVAL_ROOT E_EXPECTED"
EVAL_ROOT=$(cd "$1" && pwd)
E_EXPECTED=$2
[ -f "$E_EXPECTED" ] || die "missing E pins file: $E_EXPECTED"
SRC="$EVAL_ROOT/rules"
OUT="$EVAL_ROOT/rules-e"
[ -d "$SRC" ] || die "no D rules at $SRC; run gen-d-rules.sh first"
[ ! -e "$OUT" ] && [ ! -L "$OUT" ] || die "$OUT already exists; use a fresh EVAL_ROOT"

mkdir "$OUT"
for m in orders inventory payments; do
  src="$SRC/$m.md"
  out="$OUT/$m.md"
  got=$(sha "$src")
  want=$(expect "$D_EXPECTED" "rules/$m.md")
  [ "$got" = "$want" ] || die "$src sha256 $got differs from the pilot-01 pin $want"
  front=$(head -n 4 -- "$src")
  [ "$front" = $'---\npaths:\n  - "src/'"$m"$'/**"\n---' ] || die "$src does not start with the expected 4-line paths frontmatter"
  tail -n +5 -- "$src" > "$out"
  # Byte identity: frontmatter + E body must reproduce the D file exactly.
  cmp -s -- "$src" <(printf '%s\n' "$front"; cat -- "$out") || die "$out is not the D body of $src"
  first=$(head -n 1 -- "$out")
  [ "$first" != --- ] || die "$out still starts with a frontmatter fence"
  n=$(/usr/bin/grep -ac '^paths:' "$out") || [ "$?" -eq 1 ] || die "could not scan $out"
  [ "$n" = 0 ] || die "$out contains a paths: line"
  got=$(sha "$out")
  want=$(expect "$E_EXPECTED" "rules-e/$m.md")
  [ "$got" = "$want" ] || die "$out sha256 $got differs from $E_EXPECTED $want"
  echo "E_RULE $m $got ok"
done
echo "RULES_E=$OUT"
