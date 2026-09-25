#!/usr/bin/env bash
# Launch one pilot-01 run: fresh BASE copy, P3 checks, arm setup, env -i claude launch (spec.arm_setup),
# blinded scored copy and a logs/done.tsv line. DRY_RUN=1 prints the exact command instead of launching claude.
# Usage: run-one.sh EVAL_ROOT ID TASK ARM [MODEL]   (TASK T1|T2|T3, or P2 for a harness probe)
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ $# -ge 4 ] && [ $# -le 5 ] || die "usage: run-one.sh EVAL_ROOT ID TASK ARM [MODEL]"
load_config
resolve_root "$1"
ID=$2 TASK=$3 ARM=$4 RUN_MODEL=${5:-$MODEL}
[[ $ID =~ ^p?[0-9a-f]{6}$ ]] || die "id must be 6 hex digits, optionally prefixed with p: $ID"
case $ARM in B | C | D) ;; *) die "arm must be B, C or D: $ARM" ;; esac
[[ $RUN_MODEL =~ ^[A-Za-z0-9._-]+$ ]] || die "bad model name: $RUN_MODEL"

# Frozen inputs must match what setup recorded.
case $TASK in
  T1 | T2 | T3)
    prompt_file="$HARNESS/prompts/$TASK.txt"
    got=$(sha_file "$prompt_file")
    want=$(mf ".prompts.$TASK")
    PROMPT=$(cat -- "$prompt_file")
    ;;
  P2)
    PROMPT=$PROBE_PROMPT
    got=$(sha_str "$PROMPT")
    want=$(mf .probe_prompt_sha256)
    ;;
  *) die "task must be T1, T2, T3 or P2: $TASK" ;;
esac
[ "$got" = "$want" ] || die "prompt $TASK sha256 $got differs from manifest $want"
got=$(sha_file "$SETTINGS")
want=$(mf .settings_sha256)
[ "$got" = "$want" ] || die "run/settings.json sha256 $got differs from manifest $want"
BASE=$(mf .base_dir)
base_tree=$(mf .base_tree)
WYX_DIR=$(mf .wyx_dir)
got=$(tree_sha256 "$WYX_DIR")
want=$(mf .wyx_tree_sha256)
[ "$got" = "$want" ] || die "$WYX_DIR tree sha256 $got differs from manifest $want"
CLAUDE_BIN=$(mf .tools.claude_bin)
got=$(sha_file "$CLAUDE_BIN")
want=$(mf .tools.claude_bin_sha256)
[ "$got" = "$want" ] || die "claude binary $CLAUDE_BIN sha256 $got differs from manifest $want (pinned at setup)"
got=$(home_sha "$HOME/.claude/CLAUDE.md")
want=$(mf .home.claude_md_sha256)
[ "$got" = "$want" ] || die "~/.claude/CLAUDE.md sha256 $got differs from setup's $want; the batch needs one user environment"
got=$(home_sha "$HOME/.claude/settings.json")
want=$(mf .home.settings_json_sha256)
[ "$got" = "$want" ] || die "~/.claude/settings.json sha256 $got differs from setup's $want; the batch needs one user environment"

# P3: fresh copy, BASE tree, clean status, arm-specific .claude/, neutral path, absent projects slug.
RUN_PARENT="$ROOT/runs/$ID"
RUN="$RUN_PARENT/shop"
OUT="$ROOT/logs/$ID.jsonl"
ERR="$ROOT/logs/$ID.err"
INSTR="$ROOT/logs/$ID.instr.jsonl"
DEST="$ROOT/scored/$ID"
for p in "$RUN_PARENT" "$OUT" "$ERR" "$INSTR" "$DEST" "$ROOT/logs/$ID.cmd"; do
  [ ! -e "$p" ] && [ ! -L "$p" ] || die "$p already exists; ids are single-use"
done
path_tokens_ok "$RUN" || die "run path contains an arm, task or tool token: $RUN"
slug_dir="$HOME/.claude/projects/$(slug "$RUN")"
[ ! -e "$slug_dir" ] || die "projects slug already exists: $slug_dir"
mkdir -- "$RUN_PARENT"
neutral_check "$RUN_PARENT"
cp -a -- "$BASE" "$RUN"
chmod -R u+w -- "$RUN"
tree=$(git -C "$RUN" rev-parse 'HEAD^{tree}')
[ "$tree" = "$base_tree" ] || die "run HEAD^{tree} $tree differs from BASE tree $base_tree"
st=$(git -C "$RUN" status --porcelain --ignored)
[ -z "$st" ] || die "fresh copy is not clean:"$'\n'"$st"
if [ "$ARM" = D ]; then
  mkdir -p -- "$RUN/.claude/rules"
  for mod in $D_MODULES; do
    cp -- "$ROOT/rules/$mod.md" "$RUN/.claude/rules/$mod.md"
    chmod u+w -- "$RUN/.claude/rules/$mod.md"
  done
  listing=$(cd "$RUN/.claude" && find . -mindepth 1 -printf '%P\n' | LC_ALL=C sort)
  [ "$listing" = $'rules\nrules/inventory.md\nrules/orders.md\nrules/payments.md' ] \
    || die "D .claude/ is not exactly the three rule files:"$'\n'"$listing"
  for mod in $D_MODULES; do
    got=$(sha_file "$RUN/.claude/rules/$mod.md")
    want=$(mf ".d_rules.$mod")
    [ "$got" = "$want" ] || die "D rule $mod.md sha256 $got differs from manifest $want"
  done
  st=$(git -C "$RUN" status --porcelain)
  [ -z "$st" ] || die "D rules show in git status (expected gitignored):"$'\n'"$st"
else
  [ ! -e "$RUN/.claude" ] && [ ! -L "$RUN/.claude" ] || die "arm $ARM run has a .claude/"
fi

# Launch (spec.arm_setup.B; C adds --plugin-dir).
cmd=(env -i HOME="$HOME" USER="$USER" LANG="${LANG:-C.UTF-8}" TERM=dumb PATH="$PATH" EVAL_INSTR_LOG="$INSTR"
  ENABLE_CODE_SECURITY_REVIEW=0 ENABLE_STOP_REVIEW=0 ENABLE_COMMIT_REVIEW=0 DISABLE_AUTOUPDATER=1
  timeout 1200 "$CLAUDE_BIN" -p "$PROMPT" --model "$RUN_MODEL" --output-format stream-json --verbose --include-hook-events
  --no-session-persistence --max-budget-usd 5 --permission-mode acceptEdits --settings "$SETTINGS")
if [ "$ARM" = C ]; then cmd+=(--plugin-dir "$WYX_DIR"); fi
quoted=$(printf '%q ' "${cmd[@]}")
cmdline="cd $(printf '%q' "$RUN") && ${quoted% } </dev/null > $(printf '%q' "$OUT") 2> $(printf '%q' "$ERR")"
printf '%s\n' "$cmdline" >"$ROOT/logs/$ID.cmd"

started=$(now_utc)
rc=0
if [ "${DRY_RUN:-0}" = 1 ]; then
  printf 'DRY_RUN %s: %s\n' "$ID" "$cmdline"
  rc=DRY
else
  note "$ID launching"
  (cd "$RUN" && exec "${cmd[@]}") </dev/null >"$OUT" 2>"$ERR" || rc=$?
fi
ended=$(now_utc)
{
  flock 9
  printf '%s\t%s\t%s\t%s\n' "$ID" "$rc" "$started" "$ended" >&9
} 9>>"$ROOT/logs/done.tsv"

# Blinded scored copy (S0): drop .git/, .remember/ and exactly the three D rule paths; keep and list other .claude/ files.
list="$ROOT/tmp/$ID.all"
keep="$ROOT/tmp/$ID.keep"
(cd "$RUN" && find . \( -path ./.git -o -path ./.remember \) -prune -o \( -type f -o -type l \) -print0) >"$list"
: >"$keep"
excluded=()
other=()
while IFS= read -r -d '' f; do
  rel=${f#./}
  case $rel in
    .claude/rules/orders.md | .claude/rules/inventory.md | .claude/rules/payments.md)
      excluded+=("$rel")
      continue
      ;;
    .claude/*) other+=("$rel") ;;
  esac
  printf '%s\0' "$f" >>"$keep"
done <"$list"
mkdir -- "$DEST"
tar -C "$RUN" --null --no-recursion -T "$keep" -cf - | tar -C "$DEST" -xf -
[ ! -e "$DEST/.git" ] && [ ! -e "$DEST/.remember" ] || die "scored copy still holds .git or .remember"
excluded_lines=()
for rel in "${excluded[@]}"; do
  h=$(sha_file "$RUN/$rel")
  excluded_lines+=("$rel"$'\t'"$h")
done
other_json=$(jq -n '$ARGS.positional' --args "${other[@]}")
remember=false
[ ! -e "$RUN/.remember" ] || remember=true
dry=false
[ "$rc" != DRY ] || dry=true
jq -n --arg id "$ID" --arg task "$TASK" --arg orig_root "$RUN" --argjson other "$other_json" --argjson dry "$dry" \
  '{id: $id, task: $task, orig_root: $orig_root, claude_other_files: $other, dry_run: $dry}' >"$ROOT/scored/$ID.meta.json"
# Post-run hashes of the frozen inputs (preflight.ts compares them with the manifest).
post_md=$(home_sha "$HOME/.claude/CLAUDE.md")
post_settings=$(home_sha "$HOME/.claude/settings.json")
post_wyx=$(tree_sha256 "$WYX_DIR")
printf '%s\n' "${excluded_lines[@]}" | jq -R -n --arg id "$ID" --argjson remember "$remember" \
  --argjson other "$other_json" --arg md "$post_md" --arg settings "$post_settings" --arg wyx "$post_wyx" \
  '{id: $id, excluded: [inputs | select(length > 0) | split("\t") | {path: .[0], sha256: .[1]}],
    claude_other_files: $other, remember_present: $remember,
    home_post: {claude_md_sha256: $md, settings_json_sha256: $settings}, wyx_tree_sha256_post: $wyx}' >"$ROOT/logs/$ID.copy.json"
safe_rm "$list" "$keep"
[ "${#other[@]}" -eq 0 ] || note "$ID: kept other .claude/ files in the scored copy: ${other[*]}"
note "$ID finished (exit $rc)"
