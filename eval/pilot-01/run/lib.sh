# Shared helpers for the pilot-01 runner scripts (sourced by setup.sh, run-one.sh, run-batch.sh, probe.sh, stage0.sh).

shopt -s inherit_errexit
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

HARNESS=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
RUNNER="$HARNESS/run"
SETTINGS="$RUNNER/settings.json"
EXPECTED="$HARNESS/fixture/expected.sha256"
WYX_VERSION_PINNED=0.27.0
D_MODULES="orders inventory payments"
ENV_WHITELIST="HOME USER LANG TERM PATH EVAL_INSTR_LOG ENABLE_CODE_SECURITY_REVIEW ENABLE_STOP_REVIEW ENABLE_COMMIT_REVIEW DISABLE_AUTOUPDATER"
PROBE_PROMPT='Do exactly these steps and nothing else. 1) Use the Read tool on src/payments/service.ts. 2) Use the Edit tool to append the line // probe to that file. 3) Quote verbatim, inside a fenced block, any rule or instruction text loaded into your context because of that file path (not the file content); write NONE if there was none.'

die() { printf '%s: ERROR: %s\n' "${0##*/}" "$*" >&2; exit 1; }
note() { printf '%s: %s\n' "${0##*/}" "$*" >&2; }

# DRY_RUN is 0 (launch claude) or 1 (print commands only); anything else would launch, so it is refused.
case ${DRY_RUN:-0} in 0 | 1) ;; *) die "DRY_RUN must be 0 or 1, got '$DRY_RUN'" ;; esac
USER=${USER:-$(id -un)} || die "cannot determine USER"
export USER
now_utc() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }

sha_file() {
  [ -f "$1" ] || die "missing file: $1"
  local h
  h=$(sha256sum < "$1") || die "cannot hash $1"
  printf '%s' "${h%% *}"
}
sha_str() {
  local h
  h=$(printf '%s' "$1" | sha256sum) || die "cannot hash string"
  printf '%s' "${h%% *}"
}
# Deterministic hash over the relative paths and contents of every regular file under $1.
tree_sha256() {
  local h
  h=$(cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum) || die "cannot hash tree $1"
  printf '%s' "${h%% *}"
}
home_sha() { if [ -f "$1" ]; then sha_file "$1"; else printf absent; fi; }
expect_sha() {
  local v
  v=$(awk -v k="$1" '$2 == k && $1 ~ /^[0-9a-f]+$/ && length($1) == 64 { print $1; n++ } END { exit n == 1 ? 0 : 1 }' "$EXPECTED") \
    || die "fixture/expected.sha256 needs exactly one entry for $1"
  printf '%s' "$v"
}

load_config() {
  [ -f "$HARNESS/config.env" ] || die "missing $HARNESS/config.env"
  # shellcheck source=/dev/null
  . "$HARNESS/config.env"
  local v t a
  for v in FIXTURE_SHA WYX_SHA WYX_REPO MODEL PROBE_MODEL CLAUDE_CODE_VERSION BUN_VERSION SEED K TASKS ARMS \
    BASE_TREE_EXPECTED EVAL_ROOT_TEMPLATE; do
    [ -n "${!v-}" ] || die "config.env does not set $v"
  done
  [[ $FIXTURE_SHA =~ ^[0-9a-f]{40}$ ]] || die "FIXTURE_SHA is not a 40-hex sha"
  [[ $WYX_SHA =~ ^[0-9a-f]{40}$ ]] || die "WYX_SHA is not a 40-hex sha"
  [[ $BASE_TREE_EXPECTED =~ ^[0-9a-f]{40}$ ]] || die "BASE_TREE_EXPECTED is not a 40-hex sha"
  [[ $K =~ ^[1-9][0-9]*$ ]] || die "K must be a positive integer"
  read -r -a TASK_LIST <<<"$TASKS"
  read -r -a ARM_LIST <<<"$ARMS"
  for t in "${TASK_LIST[@]}"; do case $t in T1 | T2 | T3) ;; *) die "unknown task in TASKS: $t" ;; esac; done
  for a in "${ARM_LIST[@]}"; do case $a in B | C | D) ;; *) die "unknown arm in ARMS: $a" ;; esac; done
  WYX_SHORT=${WYX_SHA:0:7}
}

# Sets ROOT from $1, else $EVAL_ROOT; requires a completed setup (manifest.json).
resolve_root() {
  local r=${1:-${EVAL_ROOT:-}}
  [ -n "$r" ] || die "EVAL_ROOT not given (argument or environment)"
  [ -d "$r" ] || die "EVAL_ROOT $r is not a directory"
  ROOT=$(realpath -e -- "$r") || die "cannot resolve $r"
  [ "$ROOT" != / ] || die "EVAL_ROOT must not be /"
  [ -f "$ROOT/manifest.json" ] || die "$ROOT/manifest.json missing; run setup.sh first"
}
mf() {
  local v
  v=$(jq -r "$1 // empty" "$ROOT/manifest.json") || die "cannot read manifest.json"
  [ -n "$v" ] || die "manifest.json lacks $1"
  printf '%s' "$v"
}
mf_bool() {
  local v
  v=$(jq -r "$1 | tostring" "$ROOT/manifest.json") || die "cannot read manifest.json"
  case $v in true | false) printf '%s' "$v" ;; *) die "manifest.json $1 is not a boolean: $v" ;; esac
}

under_root() {
  local p
  p=$(realpath -m -- "$1") || return 1
  case $p in "$ROOT"/?*) return 0 ;; *) return 1 ;; esac
}
safe_rm() {
  local p
  for p in "$@"; do
    under_root "$p" || die "refusing to remove $p: not strictly under $ROOT"
    rm -rf -- "$p"
  done
}

# A run path must not reveal the arm or the task (P3).
path_tokens_ok() {
  local lc=${1,,} tok part
  local -a parts
  for tok in t1 t2 t3 wyx claude arm task treat control probe stage rule; do
    case $lc in *"$tok"*) return 1 ;; esac
  done
  IFS=/ read -r -a parts <<<"$lc"
  for part in "${parts[@]}"; do case $part in b | c | d) return 1 ;; esac; done
  return 0
}
slug() { printf '%s' "${1//[^A-Za-z0-9]/-}"; }

# Fails unless $1 and every ancestor are free of .git, CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude.
neutral_check() {
  local d=$1 n out rc=0
  while :; do
    for n in .git CLAUDE.md CLAUDE.local.md AGENTS.md .claude; do
      if [ -e "$d/$n" ] || [ -L "$d/$n" ]; then die "neutrality: $d/$n exists at or above $1"; fi
    done
    [ "$d" != / ] || break
    d=$(dirname -- "$d")
  done
  out=$(git -C "$1" rev-parse --show-toplevel 2>&1) || rc=$?
  [ "$rc" -ne 0 ] || die "neutrality: $1 is inside the git work tree $out"
  case $out in *"not a git repository"*) ;; *) die "neutrality: could not determine git state of $1: $out" ;; esac
}

# Ids are 3 random bytes, unique across runs/ and key/*.csv (probe ids share the space without their 'p').
declare -A USED_IDS=()
load_used_ids() {
  local f id
  for f in "$ROOT"/runs/*; do
    [ -e "$f" ] || continue
    id=${f##*/}
    USED_IDS[${id#p}]=1
  done
  for f in "$ROOT"/key/*.csv; do
    [ -f "$f" ] || continue
    while IFS=, read -r id _; do
      [ "$id" != id ] || continue
      USED_IDS[${id#p}]=1
    done <"$f"
  done
}
new_id() {
  local id
  while :; do
    id=$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n') || die "cannot read /dev/urandom"
    [[ $id =~ ^[0-9a-f]{6}$ ]] || die "bad id from /dev/urandom: $id"
    [ -z "${USED_IDS[$id]-}" ] || continue
    [ ! -e "$ROOT/runs/$id" ] && [ ! -e "$ROOT/runs/p$id" ] || continue
    USED_IDS[$id]=1
    NEW_ID=$id
    return 0
  done
}

# Number of system/init events in a stream; a missing stream counts 0, an unreadable one fails.
init_count() {
  local f=$1 n
  if [ ! -e "$f" ]; then
    printf 0
    return 0
  fi
  n=$(jq -R -n '[inputs | fromjson? | select(type == "object" and .type == "system" and .subtype == "init")] | length' "$f") \
    || die "could not scan $f"
  [[ $n =~ ^[0-9]+$ ]] || die "could not count init events in $f"
  printf '%s' "$n"
}

# Launch "id task arm [model]" lines from file $1 through run-one.sh with $2 parallel slots; returns xargs' status.
launch_lines() {
  local args=$1 par=$2 out=$3 rc=0
  xargs -P "$par" -L 1 bash "$RUNNER/run-one.sh" "$ROOT" <"$args" >"$out" || rc=$?
  return "$rc"
}

# Blinded per-id summary (no task or arm): id, exit, init events, result subtype, cost, turns, duration.
summary_header() { printf 'id\texit\tinit\tresult\tcost_usd\tturns\tduration_s\n'; }
summary_line() {
  local id=$1 exit_code init res
  exit_code=$(awk -F'\t' -v id="$id" '$1 == id { v = $2 } END { print (v == "" ? "-" : v) }' "$ROOT/logs/done.tsv") \
    || die "cannot read done.tsv"
  if [ "${DRY_RUN:-0}" = 1 ]; then
    printf '%s\t%s\t-\t-\t-\t-\t-\n' "$id" "$exit_code"
    return 0
  fi
  init=$(init_count "$ROOT/logs/$id.jsonl")
  res=$'-\t-\t-\t-'
  if [ -e "$ROOT/logs/$id.jsonl" ]; then
    res=$(jq -R -n -r '[inputs | fromjson? | select(type == "object" and .type == "result")] | last
      | if . == null then "-\t-\t-\t-"
        else [(.subtype // "-"), (.total_cost_usd // "-"), (.num_turns // "-"),
              (if .duration_ms then (.duration_ms / 1000 | floor) else "-" end)] | map(tostring) | join("\t") end' \
      "$ROOT/logs/$id.jsonl") || die "could not scan $ROOT/logs/$id.jsonl"
  fi
  printf '%s\t%s\t%s\t%s\n' "$id" "$exit_code" "$init" "$res"
}
