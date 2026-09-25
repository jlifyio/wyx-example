#!/usr/bin/env bash
# Prepare a pilot-01 EVAL_ROOT (P0): neutral root, BASE via fixture/make-fixture.sh, frozen wyx copy, D rules via
# fixture/gen-d-rules.sh, scorer dependencies and selftest, then manifest.json. Stdout is only the EVAL_ROOT path.
# Usage: setup.sh [EVAL_ROOT]   (default: $EVAL_ROOT, else a new mktemp -d from EVAL_ROOT_TEMPLATE)
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ $# -le 1 ] || die "usage: setup.sh [EVAL_ROOT]"
load_config

ROOT=
req=${1:-${EVAL_ROOT:-}}
if [ -n "$req" ]; then
  abs=$(realpath -m -- "$req") || die "cannot resolve $req"
  path_tokens_ok "$abs/runs/000000/shop" || die "EVAL_ROOT path contains an arm/task/tool token: $abs"
  if [ -e "$abs" ]; then
    [ -d "$abs" ] || die "EVAL_ROOT $abs is not a directory"
    entries=$(ls -A -- "$abs") || die "cannot list $abs"
    [ -z "$entries" ] || die "EVAL_ROOT $abs is not empty; setup needs a fresh directory"
  else
    parent=$(dirname -- "$abs")
    [ -d "$parent" ] || die "parent of EVAL_ROOT does not exist: $parent"
    neutral_check "$parent"
    mkdir -- "$abs"
  fi
  ROOT=$(realpath -e -- "$abs")
else
  for _ in $(seq 20); do
    cand=$(mktemp -d "$EVAL_ROOT_TEMPLATE")
    cand=$(realpath -e -- "$cand")
    if path_tokens_ok "$cand/runs/000000/shop"; then
      ROOT=$cand
      break
    fi
    rmdir -- "$cand"
  done
  [ -n "$ROOT" ] || die "could not create a token-free EVAL_ROOT from $EVAL_ROOT_TEMPLATE"
fi
[ "$ROOT" != / ] || die "EVAL_ROOT must not be /"
neutral_check "$ROOT"
note "EVAL_ROOT=$ROOT"

# Tool versions (P0). The claude binary is pinned by resolved path and sha256, not by the launcher symlink, which a
# background auto-update can re-point mid-batch; CLAUDE_BIN may name the pinned binary explicitly. --version runs under
# the same env -i whitelist as the runs.
if [ -n "${CLAUDE_BIN:-}" ]; then
  claude_path=$CLAUDE_BIN
else
  claude_path=$(command -v claude) || die "claude is not on PATH (or set CLAUDE_BIN)"
fi
claude_bin=$(readlink -f -- "$claude_path") || die "cannot resolve $claude_path"
[ -f "$claude_bin" ] && [ -x "$claude_bin" ] || die "claude binary $claude_bin is not an executable file"
claude_bin_sha=$(sha_file "$claude_bin")
claude_out=$(env -i HOME="$HOME" USER="$USER" LANG="${LANG:-C.UTF-8}" TERM=dumb PATH="$PATH" DISABLE_AUTOUPDATER=1 \
  "$claude_bin" --version </dev/null) || die "$claude_bin --version failed"
[[ $claude_out =~ ^([0-9]+\.[0-9]+\.[0-9]+) ]] || die "cannot parse claude --version output: $claude_out"
claude_ver=${BASH_REMATCH[1]}
[ "$claude_ver" = "$CLAUDE_CODE_VERSION" ] || die "claude $claude_ver differs from pinned CLAUDE_CODE_VERSION $CLAUDE_CODE_VERSION"
bun_ver=$(bun --version) || die "bun --version failed"
[ "$bun_ver" = "$BUN_VERSION" ] || die "bun $bun_ver differs from pinned BUN_VERSION $BUN_VERSION"
jq_ver=$(jq --version) || die "jq --version failed"
git_ver=$(git --version) || die "git --version failed"
tar_ver=$(tar --version) || die "tar --version failed"
tar_ver=${tar_ver%%$'\n'*}

mkdir "$ROOT/runs" "$ROOT/logs" "$ROOT/scored" "$ROOT/preflight" "$ROOT/tmp"
mkdir -m 700 "$ROOT/key"
printf 'id\texit_code\tstarted_at\tended_at\n' >"$ROOT/logs/done.tsv"

# BASE (make-fixture.sh runs the neutralization gate and freezes base/shop read-only).
[ -f "$HARNESS/fixture/make-fixture.sh" ] || die "missing fixture/make-fixture.sh"
note "building BASE with fixture/make-fixture.sh"
if ! bash "$HARNESS/fixture/make-fixture.sh" "$ROOT" >"$ROOT/logs/make-fixture.out"; then
  cat "$ROOT/logs/make-fixture.out" >&2
  die "fixture/make-fixture.sh failed"
fi
cat "$ROOT/logs/make-fixture.out" >&2
BASE="$ROOT/base/shop"
[ -d "$BASE/.git" ] || die "make-fixture.sh did not create $BASE"
base_tree=$(git -C "$BASE" rev-parse 'HEAD^{tree}')
base_commit=$(git -C "$BASE" rev-parse HEAD)
st=$(git -C "$BASE" status --porcelain --ignored)
[ -z "$st" ] || die "BASE is not clean:"$'\n'"$st"
[ ! -e "$BASE/.claude" ] || die "BASE contains .claude/"
writable=$(find "$BASE" -perm -u=w -print -quit)
[ -z "$writable" ] || die "BASE is not read-only (first writable path: $writable)"
stage0_required=false
[ "$base_tree" = "$BASE_TREE_EXPECTED" ] || stage0_required=true

# Frozen wyx copy for arm C (extracted before gen-d-rules.sh so the rules come from this exact copy).
WYX_DIR="$ROOT/wyx-$WYX_SHORT"
[ ! -e "$WYX_DIR" ] || die "$WYX_DIR already exists"
git -C "$WYX_REPO" cat-file -e "$WYX_SHA^{commit}" || die "WYX_SHA $WYX_SHA is not a commit in $WYX_REPO"
mkdir "$WYX_DIR"
git -C "$WYX_REPO" archive "$WYX_SHA" .claude-plugin hooks scripts skills | tar -x -C "$WYX_DIR"
top=$(cd "$WYX_DIR" && find . -mindepth 1 -maxdepth 1 -printf '%P\n' | LC_ALL=C sort)
[ "$top" = $'.claude-plugin\nhooks\nscripts\nskills' ] || die "unexpected top level in $WYX_DIR:"$'\n'"$top"
wyx_name=$(jq -er .name "$WYX_DIR/.claude-plugin/plugin.json") || die "cannot read plugin.json name"
wyx_ver=$(jq -er .version "$WYX_DIR/.claude-plugin/plugin.json") || die "cannot read plugin.json version"
[ "$wyx_name" = wyx ] || die "plugin.json name is $wyx_name, not wyx"
[ "$wyx_ver" = "$WYX_VERSION_PINNED" ] || die "plugin.json version $wyx_ver differs from $WYX_VERSION_PINNED"
wyx_tree=$(tree_sha256 "$WYX_DIR")
tree_pairs=()
for p in .claude-plugin hooks scripts skills; do
  t=$(git -C "$WYX_REPO" rev-parse "$WYX_SHA:$p")
  tree_pairs+=("$p=$t")
done

# D rules (gen-d-rules.sh checks them against expected.sha256; re-checked here with the file set).
[ -f "$HARNESS/fixture/gen-d-rules.sh" ] || die "missing fixture/gen-d-rules.sh"
note "generating D rules with fixture/gen-d-rules.sh"
if ! bash "$HARNESS/fixture/gen-d-rules.sh" "$ROOT" >"$ROOT/logs/gen-d-rules.out"; then
  cat "$ROOT/logs/gen-d-rules.out" >&2
  die "fixture/gen-d-rules.sh failed"
fi
cat "$ROOT/logs/gen-d-rules.out" >&2
rules=$(cd "$ROOT/rules" && find . -mindepth 1 -printf '%P\n' | LC_ALL=C sort)
[ "$rules" = $'inventory.md\norders.md\npayments.md' ] || die "unexpected files in $ROOT/rules:"$'\n'"$rules"
declare -A RULE_SHA=()
for mod in $D_MODULES; do
  got=$(sha_file "$ROOT/rules/$mod.md")
  want=$(expect_sha "rules/$mod.md")
  [ "$got" = "$want" ] || die "rules/$mod.md sha256 $got differs from expected.sha256 $want"
  RULE_SHA[$mod]=$got
done
declare -A CONCEPT_SHA=()
for mod in $D_MODULES; do CONCEPT_SHA[$mod]=$(sha_file "$BASE/src/$mod/CONCEPT.md"); done

# Frozen inputs: prompts, probe prompt, settings.
declare -A PROMPT_SHA=()
for t in "${TASK_LIST[@]}"; do
  got=$(sha_file "$HARNESS/prompts/$t.txt")
  want=$(expect_sha "prompts/$t.txt")
  [ "$got" = "$want" ] || die "prompts/$t.txt sha256 $got differs from expected.sha256 $want"
  PROMPT_SHA[$t]=$got
done
probe_sha=$(sha_str "$PROBE_PROMPT")
jq -e '.enabledPlugins["wyx@jlifyio"] == false
  and .hooks.InstructionsLoaded[0].hooks[0].command == "jq -c \". + {ts: now}\" >> \"$EVAL_INSTR_LOG\""' \
  "$SETTINGS" >/dev/null || die "run/settings.json is not the pinned SETTINGS"
settings_sha=$(sha_file "$SETTINGS")

# Scorer dependencies and selftest (S15).
note "bun install --frozen-lockfile in $HARNESS"
(cd "$HARNESS" && bun install --frozen-lockfile) >&2 || die "bun install --frozen-lockfile failed"
ts_want=$(jq -er '.dependencies.typescript' "$HARNESS/package.json") || die "package.json does not pin typescript"
ts_ver=$(jq -er .version "$HARNESS/node_modules/typescript/package.json") || die "typescript is not installed"
[ "$ts_ver" = "$ts_want" ] || die "installed typescript $ts_ver differs from package.json $ts_want"
selftest=absent
if [ -f "$HARNESS/selftest/run.sh" ]; then
  if EVAL_ROOT="$ROOT" bash "$HARNESS/selftest/run.sh" "$ROOT" >"$ROOT/logs/selftest.out" 2>&1; then
    selftest=pass
  else
    selftest=fail
    note "WARNING: selftest/run.sh failed (logs/selftest.out); run-batch.sh refuses until a setup records selftest=pass"
  fi
else
  note "WARNING: selftest/run.sh not found; run-batch.sh refuses until a setup records selftest=pass"
fi

# Harness state and user environment (recorded; run-batch.sh enforces a clean harness).
HARNESS_REPO=$(git -C "$HARNESS" rev-parse --show-toplevel)
harness_rel=${HARNESS#"$HARNESS_REPO"/}
harness_sha=$(git -C "$HARNESS_REPO" rev-parse HEAD)
harness_status=$(git -C "$HARNESS_REPO" status --porcelain -- "${harness_rel%%/*}")
harness_clean=true
[ -z "$harness_status" ] || harness_clean=false
[ "$harness_clean" = true ] || note "WARNING: git status --porcelain -- ${harness_rel%%/*} is not empty in $HARNESS_REPO"
home_claude_md=$(home_sha "$HOME/.claude/CLAUDE.md")
home_settings=$(home_sha "$HOME/.claude/settings.json")

obj() { # name=value pairs -> JSON object of strings
  local kv
  for kv in "$@"; do printf '%s\t%s\n' "${kv%%=*}" "${kv#*=}"; done | jq -R -n '[inputs | split("\t") | {(.[0]): .[1]}] | add // {}'
}
wyx_git_trees=$(obj "${tree_pairs[@]}")
expected_file_sha=$(sha_file "$EXPECTED")
rules_json=$(obj orders="${RULE_SHA[orders]}" inventory="${RULE_SHA[inventory]}" payments="${RULE_SHA[payments]}")
concept_json=$(obj orders="${CONCEPT_SHA[orders]}" inventory="${CONCEPT_SHA[inventory]}" payments="${CONCEPT_SHA[payments]}")
prompt_pairs=()
for t in "${TASK_LIST[@]}"; do prompt_pairs+=("$t=${PROMPT_SHA[$t]}"); done
prompts_json=$(obj "${prompt_pairs[@]}")
overlay_json=$(awk '$2 ~ /^fixture\/overlay\// && length($1) == 64 { print $2 "\t" $1 }' "$EXPECTED" \
  | jq -R -n '[inputs | split("\t") | {(.[0]): .[1]}] | add // {}')

jq -n \
  --arg created_at "$(now_utc)" --arg eval_root "$ROOT" --arg harness_dir "$HARNESS" --arg harness_repo "$HARNESS_REPO" \
  --arg harness_sha "$harness_sha" --argjson harness_clean "$harness_clean" \
  --arg fixture_sha "$FIXTURE_SHA" --arg expected_sha256_file "$expected_file_sha" --argjson overlay "$overlay_json" \
  --arg base_dir "$BASE" --arg base_tree "$base_tree" --arg base_commit "$base_commit" \
  --arg base_tree_expected "$BASE_TREE_EXPECTED" --argjson stage0_required "$stage0_required" \
  --argjson concept "$concept_json" --argjson d_rules "$rules_json" --arg rules_dir "$ROOT/rules" \
  --arg wyx_sha "$WYX_SHA" --arg wyx_repo "$WYX_REPO" --arg wyx_dir "$WYX_DIR" --arg wyx_version "$wyx_ver" \
  --arg wyx_tree_sha256 "$wyx_tree" --argjson wyx_git_trees "$wyx_git_trees" \
  --argjson prompts "$prompts_json" --arg probe_prompt_sha256 "$probe_sha" \
  --arg settings_path "$SETTINGS" --arg settings_sha256 "$settings_sha" --arg env_whitelist "$ENV_WHITELIST" \
  --arg model "$MODEL" --arg probe_model "$PROBE_MODEL" --arg claude_code_version "$CLAUDE_CODE_VERSION" \
  --arg claude_path "$claude_path" --arg claude_bin "$claude_bin" --arg claude_bin_sha256 "$claude_bin_sha" \
  --arg claude_version_output "$claude_out" --arg claude_version "$claude_ver" \
  --arg bun "$bun_ver" --arg jq "$jq_ver" --arg git "$git_ver" --arg tar "$tar_ver" --arg bash "$BASH_VERSION" \
  --arg typescript "$ts_ver" --arg selftest "$selftest" \
  --arg home_claude_md "$home_claude_md" --arg home_settings "$home_settings" \
  --arg seed "$SEED" --arg k "$K" --arg tasks "$TASKS" --arg arms "$ARMS" \
  '{created_at: $created_at, eval_root: $eval_root,
    harness: {dir: $harness_dir, repo: $harness_repo, sha: $harness_sha, clean: $harness_clean},
    fixture_sha: $fixture_sha, expected_sha256_file: $expected_sha256_file, overlay_sha256: $overlay,
    base_dir: $base_dir, base_tree: $base_tree, base_commit: $base_commit,
    base_tree_expected: $base_tree_expected, stage0_required: $stage0_required,
    concept_sha256: $concept, d_rules: $d_rules, rules_dir: $rules_dir,
    wyx_sha: $wyx_sha, wyx_repo: $wyx_repo, wyx_dir: $wyx_dir, wyx_version: $wyx_version,
    wyx_tree_sha256: $wyx_tree_sha256, wyx_git_trees: $wyx_git_trees,
    prompts: $prompts, probe_prompt_sha256: $probe_prompt_sha256,
    settings_path: $settings_path, settings_sha256: $settings_sha256, env_whitelist: ($env_whitelist | split(" ")),
    model: $model, probe_model: $probe_model, claude_code_version: $claude_code_version,
    tools: {claude_path: $claude_path, claude_bin: $claude_bin, claude_bin_sha256: $claude_bin_sha256,
            claude_version_output: $claude_version_output, claude_version: $claude_version,
            bun: $bun, jq: $jq, git: $git, tar: $tar, bash: $bash, typescript: $typescript},
    selftest: $selftest,
    home: {claude_md_sha256: $home_claude_md, settings_json_sha256: $home_settings},
    seed: $seed, k: ($k | tonumber), tasks: ($tasks | split(" ")), arms: ($arms | split(" "))}' \
  >"$ROOT/manifest.json.tmp"
mv -- "$ROOT/manifest.json.tmp" "$ROOT/manifest.json"

# Freeze the arm C plugin copy and the D rule sources like BASE; run-one.sh and preflight.ts re-check their hashes.
chmod -R a-w -- "$WYX_DIR" "$ROOT/rules"

if [ "$stage0_required" = true ]; then
  note "STAGE0_REQUIRED base_tree=$base_tree differs from BASE_TREE_EXPECTED=$BASE_TREE_EXPECTED; run run/stage0.sh (P1) before the batch"
else
  note "STAGE0 skip: base_tree equals BASE_TREE_EXPECTED $BASE_TREE_EXPECTED"
fi
note "manifest: $ROOT/manifest.json (selftest=$selftest, harness clean=$harness_clean)"
printf '%s\n' "$ROOT"
