// Preflight for the pilot: P3 pre-launch gate (p3), P4 per-run stream and instr-log checks (run), batch comparisons (batch), P2 probe verdict (p2).
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import {
  EDIT_TOOLS, INERT_RE, SPEC_RE, SRC_TOKEN_RE, SUBAGENT_TOOLS, WYX_TOKENS,
  bashChangesCwd, bashWrites, hookResponses, inputPath, isoToEpoch, readJsonl, selectOne, succeeded, toolCalls, toRel, wordRel,
  type ToolCall,
} from "./stream.ts";

type Arm = "B" | "C" | "D";
interface Failure { code: string; detail: string; discards_batch: boolean; isolation: boolean }

const USAGE = `usage:
  bun score/preflight.ts p3    --run-path P --arm B|C|D (--eval-root E | --base DIR [--rules DIR]) [--id ID] [--out FILE]
  bun score/preflight.ts run   --arm B|C|D --task T1|T2|T3 (--eval-root E --id ID | --stream F --instr F --run-path P --base DIR)
                               [--rules DIR] [--wyx-path DIR] [--plugin-ref FILE] [--p3 FILE] [--out FILE]
  bun score/preflight.ts batch --eval-root E [--key FILE] [--plugin-ref FILE]      (default mode; only after analyze.ts --freeze)
  bun score/preflight.ts p2    --eval-root E [--round N]                          (probes in key/probes.csv)
--eval-root defaults to $EVAL_ROOT.
pins default to ../config.env, then to the pre-registered values; override with --model, --cc-version, --wyx-version.`;

const RULE_MODULES = ["orders", "inventory", "payments"] as const;
const CONSUMER: Record<string, string> = { T1: "payments", T2: "payments", T3: "orders", P2: "payments" };
const PAYMENTS_DEPS_HEADER = "[src/payments/CONCEPT.md ## dependencies]";
// run/lib.sh path_tokens_ok tokens (substrings anywhere, whole path components) plus "scratchpad".
const PATH_SUBSTRINGS = ["t1", "t2", "t3", "wyx", "claude", "arm", "task", "treat", "control", "probe", "stage", "rule", "scratchpad"];
const PATH_COMPONENTS = new Set(["b", "c", "d"]);
const SYSTEM_PREFIXES = ["/dev/", "/usr/", "/bin/", "/sbin/", "/lib/", "/lib64/", "/proc/", "/etc/", "/sys/"];

class UsageError extends Error {}

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[a.slice(2)] = "true";
    else { flags[a.slice(2)] = next; i++; }
  }
  return { pos, flags };
}

function readConfig(): Record<string, string> {
  const path = join(import.meta.dir, "..", "config.env");
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function readManifest(E: string | undefined): Record<string, any> {
  if (!E) return {};
  const p = join(E, "manifest.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function git(cwd: string, args: string[]): { ok: boolean; out: string; err: string } {
  const p = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
}

function samePath(a: string, b: string): boolean {
  const real = (p: string) => { try { return realpathSync(p); } catch { return normalize(p); } };
  return normalize(a).replace(/\/$/, "") === normalize(b).replace(/\/$/, "") || real(a) === real(b);
}

function projectSlug(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, "-");
}

function pathTokenHits(path: string): string[] {
  const lc = path.toLowerCase();
  const hits = lc.split("/").filter((part) => PATH_COMPONENTS.has(part));
  for (const s of PATH_SUBSTRINGS) if (lc.includes(s)) hits.push(`*${s}*`);
  return [...new Set(hits)];
}

/** Relative path -> sha256 for every regular file or symlink under root, excluding .git/. */
function manifest(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (rel === "" && name === ".git") continue;
      const abs = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) out.set(r, "symlink");
      else if (st.isDirectory()) walk(abs, r);
      else out.set(r, sha256File(abs));
    }
  };
  walk(root, "");
  return out;
}

/** Same value as run/lib.sh tree_sha256: sha256 of `sha256sum` lines for every regular file, sorted by "./path". */
export function treeSha256(root: string): string {
  const files: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const r = `${rel}/${name}`;
      const st = lstatSync(abs);
      if (st.isDirectory()) walk(abs, r);
      else if (st.isFile()) files.push(r);
    }
  };
  walk(root, ".");
  files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return sha256Text(files.map((f) => `${sha256File(join(root, f))}  ${f}\n`).join(""));
}

/** Refuses unless records.jsonl is frozen (records.sha256 matches): batch output carries arm labels. */
function requireFrozen(E: string) {
  const records = join(E, "records.jsonl");
  const freeze = join(E, "records.sha256");
  if (!existsSync(freeze) || !existsSync(records)) throw new UsageError(`scoring is not frozen (${freeze} missing); batch mode writes arm labels, so run score-batch.sh and analyze.ts --freeze first`);
  const want = readFileSync(freeze, "utf8").split(/\s+/)[0];
  const got = sha256File(records);
  if (want !== got) throw new UsageError(`records.jsonl sha256 ${got} differs from the frozen ${want}`);
}

function specDirs(base: string): string[] {
  const dirs: string[] = [];
  for (const [rel] of manifest(base)) if (SPEC_RE.test(rel)) dirs.push(dirname(rel) === "." ? "" : dirname(rel));
  return dirs;
}

function ruleHashes(rulesDir: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const m of RULE_MODULES) {
    const p = join(rulesDir, `${m}.md`);
    if (!existsSync(p)) return null;
    out[m] = sha256File(p);
  }
  return out;
}

/** D: exactly the three rule files with the reference hashes; returns problems (empty when fine). */
function checkRuleFiles(runPath: string, ref: Record<string, string>): string[] {
  const problems: string[] = [];
  const claude = join(runPath, ".claude");
  const rules = join(claude, "rules");
  if (!existsSync(rules)) return ["missing .claude/rules/"];
  const extraTop = readdirSync(claude).filter((n) => n !== "rules");
  if (extraTop.length) problems.push(`unexpected .claude entries: ${extraTop.join(",")}`);
  const names = readdirSync(rules).sort();
  const want = RULE_MODULES.map((m) => `${m}.md`).sort();
  if (names.join(",") !== want.join(",")) problems.push(`rule files ${names.join(",")} != ${want.join(",")}`);
  for (const m of RULE_MODULES) {
    const p = join(rules, `${m}.md`);
    if (existsSync(p) && sha256File(p) !== ref[m]) problems.push(`${m}.md sha256 ${sha256File(p)} != ${ref[m]}`);
  }
  return problems;
}

function ancestorMemoryHits(runPath: string): string[] {
  const hits: string[] = [];
  let dir = dirname(resolve(runPath));
  for (;;) {
    for (const n of ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".claude"]) {
      const p = join(dir, n);
      if (existsSync(p) && p !== join(homedir(), ".claude")) hits.push(p);
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return hits;
}

// ---------------------------------------------------------------- p3 (pre-launch)

export function p3Check(runPath: string, arm: Arm, base: string, rulesDir: string | null, ruleRef: Record<string, string> | null = null) {
  const failures: string[] = [];
  const checks: Record<string, unknown> = { run_path: runPath, arm };
  if (!existsSync(runPath) || !statSync(runPath).isDirectory()) {
    return { pass: false, failures: [`run path missing: ${runPath}`], checks };
  }
  const baseTree = git(base, ["rev-parse", "HEAD^{tree}"]);
  const runTree = git(runPath, ["rev-parse", "HEAD^{tree}"]);
  checks.base_tree = baseTree.out;
  checks.run_tree = runTree.out;
  if (!baseTree.ok || !runTree.ok) failures.push(`git rev-parse failed: ${baseTree.err || runTree.err}`);
  else if (baseTree.out !== runTree.out) failures.push(`HEAD^{tree} ${runTree.out} != BASE ${baseTree.out}`);
  const status = git(runPath, ["status", "--porcelain"]);
  checks.git_status_porcelain = status.out;
  if (!status.ok) failures.push(`git status failed: ${status.err}`);
  else if (status.out !== "") failures.push("git status --porcelain is not empty");

  const baseM = manifest(base);
  const runM = manifest(runPath);
  const ruleRel = new Set(RULE_MODULES.map((m) => `.claude/rules/${m}.md`));
  const diffs: string[] = [];
  for (const [rel, h] of runM) {
    if (arm === "D" && ruleRel.has(rel)) continue;
    if (baseM.get(rel) !== h) diffs.push(baseM.has(rel) ? `changed ${rel}` : `extra ${rel}`);
  }
  for (const rel of baseM.keys()) if (!runM.has(rel)) diffs.push(`missing ${rel}`);
  checks.fresh_copy_diffs = diffs;
  if (diffs.length) failures.push(`not a fresh copy of BASE: ${diffs.slice(0, 5).join("; ")}`);

  if (arm === "D") {
    const ref = ruleRef ?? (rulesDir ? ruleHashes(rulesDir) : null);
    if (!ref) failures.push(`reference rules unreadable: ${rulesDir}`);
    else {
      checks.d_rule_sha256 = ref;
      const problems = checkRuleFiles(runPath, ref);
      if (problems.length) failures.push(`D rules: ${problems.join("; ")}`);
    }
  } else if (existsSync(join(runPath, ".claude"))) {
    failures.push(`${arm} run has .claude/`);
  }

  const slugDir = join(homedir(), ".claude", "projects", projectSlug(resolve(runPath)));
  checks.project_slug = slugDir;
  if (existsSync(slugDir)) failures.push(`project slug exists: ${slugDir}`);

  const tokens = pathTokenHits(resolve(runPath));
  checks.path_token_hits = tokens;
  if (tokens.length) failures.push(`run path contains arm/task tokens: ${tokens.join(",")}`);

  const outer = git(dirname(resolve(runPath)), ["rev-parse", "--show-toplevel"]);
  if (outer.ok) failures.push(`run directory lies inside git repo ${outer.out}`);
  const mem = ancestorMemoryHits(runPath);
  checks.ancestor_memory = mem;
  if (mem.length) failures.push(`ancestor instruction files: ${mem.join(",")}`);

  return { pass: failures.length === 0, failures, checks };
}

// ---------------------------------------------------------------- run (P4)

export interface RunOpts {
  id: string;
  arm: Arm;
  task: string;
  runPath: string;
  stream: string;
  instr: string;
  base: string;
  rulesDir: string | null;
  ruleRef: Record<string, string> | null;
  wyxPath: string;
  wyxVersion: string;
  model: string;
  ccVersion: string;
  pluginRef: string[] | null;
  p3File: string | null;
  launchCmd: string | null;
  copyJson: string | null;
  homeRef: Record<string, string> | null;
  wyxTreeRef: string | null;
}

function outsideRefs(c: ToolCall, runPath: string): string[] {
  const refs: string[] = [];
  for (const key of ["file_path", "notebook_path", "path"]) {
    const v = c.input?.[key];
    if (typeof v === "string" && toRel(v, runPath) === null && !samePath(v, runPath)) refs.push(v);
  }
  if (c.name === "Bash" && typeof c.input?.command === "string") {
    const cmd: string = c.input.command;
    for (const m of cmd.matchAll(/(?:^|[\s'"=:(<>|;&])((?:\/|~\/|\.\.\/)[^\s'"|;&()<>]*)/g)) {
      const tok = m[1];
      if (tok.startsWith("~/")) { refs.push(tok); continue; }
      if (tok.startsWith("/")) {
        if (tok === "/" || tok.startsWith("//") || SYSTEM_PREFIXES.some((p) => tok.startsWith(p))) continue;
        if (toRel(tok, runPath) === null && !samePath(tok, runPath)) refs.push(tok);
        continue;
      }
      if (toRel(tok, runPath) === null) refs.push(tok);
    }
  }
  return [...new Set(refs)];
}

function stopRounds(events: any[]): number {
  let rounds = 0;
  let inRound = false;
  for (const e of events) {
    if (e.type === "system" && e.subtype === "hook_started" && e.hook_event === "Stop") {
      if (!inRound) rounds++;
      inRound = true;
    } else if (e.type === "assistant" || e.type === "user" || e.type === "result") {
      inRound = false;
    }
  }
  return rounds;
}

export function checkRun(o: RunOpts) {
  const failures: Failure[] = [];
  const warnings: string[] = [];
  const manualReasons: string[] = [];
  const fail = (code: string, detail: string, f: { discards?: boolean; isolation?: boolean } = {}) =>
    failures.push({ code, detail, discards_batch: f.discards ?? false, isolation: f.isolation ?? false });

  const rec: Record<string, any> = {
    run_id: o.id, arm: o.arm, task: o.task, run_path: o.runPath, stream: o.stream, instr_log: o.instr,
    pins: { model: o.model, claude_code_version: o.ccVersion, wyx_path: o.wyxPath, wyx_version: o.wyxVersion },
  };

  if (!existsSync(o.stream)) {
    fail("STREAM_MISSING", o.stream, { isolation: true });
    return finish(rec, failures, warnings, manualReasons);
  }
  const { events, errors } = readJsonl(o.stream);
  rec.telemetry = { stream_events: events.length, parse_errors: errors };
  if (errors.length) fail("STREAM_PARSE_ERROR", `${errors.length} unparseable line(s), first at ${errors[0].line}`);

  // init: selected by type and subtype, exactly one
  const { event: init, count: initCount } = selectOne(events, "system", "init");
  if (initCount === 0) fail("NO_INIT", "no system/init event (process failed before start; rerun once under a new id)", { isolation: true });
  if (initCount > 1) fail("MULTIPLE_INIT", `${initCount} system/init events`, { isolation: true });
  let wyxEntries: any[] = [];
  if (init) {
    const plugins: any[] = Array.isArray(init.plugins) ? init.plugins : [];
    wyxEntries = plugins.filter((p) => p?.name === "wyx");
    const pluginSet = plugins.filter((p) => p?.name !== "wyx").map((p) => `${p.name}@${p.version ?? "unversioned"}`).sort();
    const skills: string[] = (init.skills ?? []).map((s: any) => (typeof s === "string" ? s : s?.name ?? ""));
    rec.init = {
      model: init.model ?? null,
      claude_code_version: init.claude_code_version ?? null,
      permissionMode: init.permissionMode ?? null,
      cwd: init.cwd ?? null,
      per_turn_effort_active: init.per_turn_effort_active ?? null,
      output_style: init.output_style ?? null,
      plugin_set_sorted: pluginSet,
      plugin_set_sha256: sha256Text(pluginSet.join("\n")),
      wyx: wyxEntries.length === 1 ? { name: wyxEntries[0].name, source: wyxEntries[0].source ?? null, path: wyxEntries[0].path ?? null, version: wyxEntries[0].version ?? null } : wyxEntries.length ? wyxEntries : null,
      skills_wyx_n: skills.filter((s) => s.startsWith("wyx:")).length,
      mcp_servers: Object.fromEntries((init.mcp_servers ?? []).map((m: any) => [m.name, m.status])),
    };
    if (init.model !== o.model) fail("MODEL_MISMATCH", `${init.model} != ${o.model}`, { discards: true, isolation: true });
    if (init.claude_code_version !== o.ccVersion) fail("VERSION_MISMATCH", `${init.claude_code_version} != ${o.ccVersion}`, { discards: true, isolation: true });
    if (init.permissionMode !== "acceptEdits") fail("PERMISSION_MODE_MISMATCH", `${init.permissionMode} != acceptEdits`, { discards: true, isolation: true });
    if (typeof init.cwd !== "string" || !samePath(init.cwd, o.runPath)) fail("CWD_MISMATCH", `${init.cwd} != ${o.runPath}`, { isolation: true });
    if (o.pluginRef) {
      const ref = [...o.pluginRef].sort();
      if (ref.join("\n") !== pluginSet.join("\n")) {
        const extra = pluginSet.filter((p) => !ref.includes(p));
        const missing = ref.filter((p) => !pluginSet.includes(p));
        fail("PLUGIN_SET_MISMATCH", `extra [${extra.join(",")}] missing [${missing.join(",")}]`, { discards: true, isolation: true });
      }
    }
    if (o.arm === "C") {
      const w = wyxEntries[0];
      const ok = wyxEntries.length === 1 && w.source === "wyx@inline" && typeof w.path === "string" && samePath(w.path, o.wyxPath) && w.version === o.wyxVersion;
      if (!ok) fail("WYX_PLUGIN_INVALID", `wyx entries: ${JSON.stringify(wyxEntries)}; want 1 x {source wyx@inline, path ${o.wyxPath}, version ${o.wyxVersion}}`, { isolation: true });
    } else {
      if (wyxEntries.length) fail("WYX_CONTAMINATION", `init.plugins has wyx: ${JSON.stringify(wyxEntries)}`, { discards: true, isolation: true });
      if (rec.init.skills_wyx_n > 0) fail("WYX_CONTAMINATION", `${rec.init.skills_wyx_n} wyx: skill listing(s) in init.skills`, { discards: true, isolation: true });
    }
  }

  // hooks
  const hooks = hookResponses(events);
  const has = (t: string) => (h: { text: string }) => h.text.includes(t);
  const pre = hooks.filter((h) => h.event === "PreToolUse" && has(WYX_TOKENS.pre)(h));
  const post = hooks.filter((h) => h.event === "PostToolUse" && has(WYX_TOKENS.post)(h));
  const session = hooks.filter((h) => h.event === "SessionStart" && has(WYX_TOKENS.session)(h));
  const anyWyx = hooks.filter((h) => Object.values(WYX_TOKENS).some((t) => h.text.includes(t)));
  if (o.arm !== "C" && anyWyx.length) {
    fail("WYX_CONTAMINATION", `${anyWyx.length} hook_response(s) contain a wyx token (${[...new Set(anyWyx.map((h) => h.name))].join(",")})`, { discards: true, isolation: true });
  }

  // tool calls
  const calls = toolCalls(events);
  const baseSpecDirs = existsSync(o.base) ? specDirs(o.base) : null;
  if (!baseSpecDirs) fail("BASE_MISSING", o.base, { isolation: true });
  const governing = new Set(baseSpecDirs ?? []);
  const specCreated: { path: string; tool_use_id: string }[] = [];
  const governed = (rel: string) => {
    const d = dirname(rel) === "." ? "" : dirname(rel);
    for (const g of governing) if (g === "" || d === g || d.startsWith(`${g}/`)) return true;
    return false;
  };
  let nearSpecOk = 0, nearSpecDenied = 0, nearSpecSub = 0;
  const editsByResult = calls.filter((c) => EDIT_TOOLS.has(c.name)).sort((a, b) => (a.resultIdx ?? a.useIdx) - (b.resultIdx ?? b.useIdx));
  for (const c of editsByResult) {
    const p = inputPath(c.input);
    const rel = p ? toRel(p, o.runPath) : null;
    if (!rel) continue;
    if (!INERT_RE.test(rel) && governed(rel)) {
      if (c.parent === null && succeeded(c)) nearSpecOk++;
      else if (c.parent === null && c.denied) nearSpecDenied++;
      else if (c.parent !== null && succeeded(c)) nearSpecSub++;
    }
    if (succeeded(c) && SPEC_RE.test(rel) && c.name === "Write" && baseSpecDirs && !existsSync(join(o.base, rel))) {
      specCreated.push({ path: rel, tool_use_id: c.id });
      governing.add(dirname(rel) === "." ? "" : dirname(rel));
    }
  }
  const expectedPre = nearSpecOk + nearSpecDenied;
  const hookMiss = o.arm === "C" ? pre.length !== expectedPre : null;
  rec.hooks = {
    wyx_session_n: session.length,
    wyx_pre_n: pre.length,
    wyx_post_n: post.length,
    wyx_any_token_n: anyWyx.length,
    successful_edits_near_spec_n: nearSpecOk,
    denied_edits_near_spec_n: nearSpecDenied,
    subagent_edits_near_spec_n: nearSpecSub,
    wyx_hook_miss: hookMiss,
    first_wyx_pre_idx: pre.length ? pre[0].idx : null,
    stop_rounds: stopRounds(events),
  };
  if (o.arm === "C") {
    rec.treatment_delivered = pre.length >= 1;
    if (!rec.treatment_delivered) warnings.push("C: treatment_delivered=false (no PreToolUse 'wyx drift context:' response)");
    if (hookMiss) fail("WYX_HOOK_MISS", `wyx PreToolUse ${pre.length} != successful${nearSpecDenied ? "+denied" : ""} main-thread edits near a spec ${expectedPre}`);
    if (session.length !== 1) warnings.push(`C: ${session.length} SessionStart 'wyx artifacts:' responses`);
  } else {
    rec.treatment_delivered = null;
  }
  if (nearSpecSub) manualReasons.push(`${nearSpecSub} subagent edit(s) near a spec; hook-miss count covers the main thread only`);

  // instr log
  const firstSrcEdit = calls
    .filter((c) => EDIT_TOOLS.has(c.name) && succeeded(c))
    .filter((c) => { const p = inputPath(c.input); const r = p ? toRel(p, o.runPath) : null; return r !== null && r.startsWith("src/"); })
    .sort((a, b) => a.useIdx - b.useIdx)[0] ?? null;
  // A rule loaded while the edit's own assistant message was being written (e.g. by a sibling Read) reached the model only
  // after that message, so delivery is judged against the start of the message that holds the first src edit.
  const firstSrcEditTs = firstSrcEdit ? isoToEpoch(firstSrcEdit.msgStartTs) : null;
  rec.instr = { lines: 0, session_start: [], path_glob_match: [], other: [], first_src_edit: firstSrcEdit ? { tool_use_id: firstSrcEdit.id, ts: firstSrcEditTs, message_start_idx: firstSrcEdit.msgStartIdx, file: inputPath(firstSrcEdit.input) } : null, d_delivered: null, d_rule_not_loaded: [], d_rule_modified: null };
  if (!existsSync(o.instr)) {
    fail("INSTR_LOG_MISSING", o.instr, { isolation: true });
  } else {
    const { events: instr, errors: ierr } = readJsonl(o.instr);
    rec.instr.lines = instr.length;
    if (ierr.length) fail("INSTR_PARSE_ERROR", `${ierr.length} unparseable line(s)`, { isolation: true });
    for (const e of instr) {
      const fp: string = e.file_path ?? "";
      const entry = { file_path: fp, rel: toRel(fp, o.runPath), load_reason: e.load_reason ?? null, trigger_file_path: e.trigger_file_path ?? null, agent_id: e.agent_id ?? null, ts: typeof e.ts === "number" ? e.ts : null };
      if (entry.load_reason === "session_start") rec.instr.session_start.push(fp);
      if (entry.load_reason === "path_glob_match") rec.instr.path_glob_match.push({ rule: entry.rel ?? fp, trigger_file_path: entry.trigger_file_path, agent_id: entry.agent_id, ts: entry.ts });
      else if (entry.load_reason !== "session_start") rec.instr.other.push(entry);
      const isRule = entry.rel !== null && /^\.claude\/rules\/[^/]+\.md$/.test(entry.rel);
      if (entry.rel !== null) {
        if (isRule && o.arm !== "D") fail("RULES_IN_INSTR", `${o.arm} loaded ${entry.rel} (${entry.load_reason})`, { discards: true, isolation: true });
        else if (!isRule) fail("PROJECT_INSTRUCTIONS_LOADED", `${entry.rel} (${entry.load_reason})`, { discards: true, isolation: true });
        else if (entry.load_reason === "session_start") fail("D_RULE_UNCONDITIONAL", `${entry.rel} loaded at session_start (frontmatter not applied)`);
      } else if (fp.startsWith(join(homedir(), ".claude", "projects") + "/")) {
        fail("PROJECT_INSTRUCTIONS_LOADED", `auto memory ${fp} (${entry.load_reason})`, { discards: true, isolation: true });
      } else if (fp && !fp.startsWith(join(homedir(), ".claude") + "/") && `${resolve(o.runPath)}/`.startsWith(`${dirname(fp).replace(/\/\.claude(\/.*)?$/, "")}/`)) {
        fail("PROJECT_INSTRUCTIONS_LOADED", `ancestor instructions ${fp} (${entry.load_reason})`, { discards: true, isolation: true });
      }
    }
    const userMemory = join(homedir(), ".claude", "CLAUDE.md");
    if (existsSync(userMemory) && !rec.instr.session_start.some((p: string) => samePath(p, userMemory))) {
      fail("INSTR_LOGGER_NOT_WIRED", `no session_start entry for ${userMemory}`, { isolation: true });
    }
    if (o.arm === "D") {
      const m = CONSUMER[o.task.slice(0, 2)];
      if (!m) fail("TASK_UNKNOWN", o.task);
      else {
        const matches = rec.instr.path_glob_match.filter((g: any) => g.rule === `.claude/rules/${m}.md` && g.agent_id === null);
        const loads = matches.filter((g: any) => g.ts !== null);
        rec.instr.d_consumer_rule = `${m}.md`;
        if (firstSrcEdit === null) {
          rec.instr.d_delivered = loads.length > 0;
        } else if (firstSrcEditTs === null) {
          // No parseable timestamp on the first src edit's message: ordering cannot be checked, so do not pass it.
          rec.instr.d_delivered = null;
        } else {
          rec.instr.d_delivered = loads.some((g: any) => g.ts < firstSrcEditTs);
          if (!rec.instr.d_delivered && matches.length > loads.length) rec.instr.d_delivered = null;
        }
        if (rec.instr.d_delivered === null) {
          fail("D_DELIVERY_UNVERIFIABLE", `${m}: ${firstSrcEditTs === null ? "the first src edit's message has no parseable timestamp" : "a path_glob_match entry has no ts"}`);
        } else if (!rec.instr.d_delivered) {
          rec.instr.d_rule_not_loaded.push(m);
          fail("D_RULE_NOT_LOADED", `${m}: ${loads.length ? "loaded only after the first src edit's message began" : "no main-thread path_glob_match"}`);
        }
      }
    }
  }

  // D rule files unchanged at END; B/C have no rules directory
  if (o.arm === "D") {
    const ref = o.ruleRef ?? (o.rulesDir ? ruleHashes(o.rulesDir) : null);
    if (!ref) fail("D_RULE_REFERENCE_MISSING", `${o.rulesDir}`);
    else {
      const problems = checkRuleFiles(o.runPath, ref);
      rec.instr.d_rule_modified = problems.length > 0;
      if (problems.length) fail("D_RULE_MODIFIED", problems.join("; "));
    }
  } else if (existsSync(join(o.runPath, ".claude", "rules"))) {
    fail("RULES_DIR_PRESENT", `${o.arm} run has .claude/rules at END`, { isolation: true });
  }

  // tools telemetry
  const rel = (p: string) => toRel(p, o.runPath) ?? p;
  const okEdits = calls.filter((c) => EDIT_TOOLS.has(c.name) && succeeded(c) && inputPath(c.input));
  // Only Bash calls that ran and succeeded, and only write targets that resolve under <run>/src/, count; a write whose
  // target cannot be resolved statically is listed separately when the command mentions src/.
  const bashSrcWrites: any[] = [];
  const bashWriteUnresolved: any[] = [];
  let cwdKnown = true;
  for (const c of calls.filter((x) => x.name === "Bash" && typeof x.input?.command === "string" && !x.denied && x.resultIdx !== null).sort((a, b) => a.resultIdx! - b.resultIdx!)) {
    const command = String(c.input.command);
    if (succeeded(c)) {
      const writes = bashWrites(command).map((w) => ({ op: w.op, rel: w.target ? wordRel(w.target, o.runPath, cwdKnown && !w.afterCd) : undefined }));
      const src = writes.filter((w) => typeof w.rel === "string" && (w.rel === "src" || w.rel.startsWith("src/")));
      const entry = { tool_use_id: c.id, command: command.slice(0, 400) };
      if (src.length) bashSrcWrites.push({ ...entry, ops: [...new Set(src.map((w) => w.op))], targets: [...new Set(src.map((w) => w.rel))] });
      else if (writes.some((w) => w.rel === undefined) && SRC_TOKEN_RE.test(command)) {
        bashWriteUnresolved.push({ ...entry, ops: [...new Set(writes.filter((w) => w.rel === undefined).map((w) => w.op))] });
      }
    }
    if (bashChangesCwd(command)) cwdKnown = false;
  }
  const runExists = existsSync(o.runPath);
  if (!runExists) warnings.push("run directory absent: files_written_then_deleted and P3 re-check skipped");
  rec.tools = {
    read_paths: [...new Set(calls.filter((c) => c.name === "Read" && inputPath(c.input)).map((c) => rel(inputPath(c.input)!)))],
    edited_by_tools: {
      main: [...new Set(okEdits.filter((c) => c.parent === null).map((c) => rel(inputPath(c.input)!)))],
      subagent: [...new Set(okEdits.filter((c) => c.parent !== null).map((c) => rel(inputPath(c.input)!)))],
    },
    bash_write_cmds: bashSrcWrites,
    bash_write_unresolved: bashWriteUnresolved,
    files_written_then_deleted: runExists
      ? [...new Set(okEdits.map((c) => inputPath(c.input)!).filter((p) => toRel(p, o.runPath) !== null && !existsSync(isAbsolute(p) ? p : join(o.runPath, p))).map(rel))]
      : null,
    subagent_used: calls.some((c) => SUBAGENT_TOOLS.has(c.name)) || calls.some((c) => c.parent !== null),
    subagent_tool_uses: calls.filter((c) => SUBAGENT_TOOLS.has(c.name)).map((c) => ({ tool: c.name, type: c.input?.subagent_type ?? null })),
    skills_invoked: calls.filter((c) => c.name === "Skill").map((c) => c.input?.skill ?? c.input?.command ?? c.input?.name ?? null),
    outside_cwd_attempts: calls.flatMap((c) => outsideRefs(c, o.runPath).map((ref) => ({ tool: c.name, ref, denied: c.denied, ok: succeeded(c) }))),
    spec_created_mid_run: specCreated,
    tool_use_counts: calls.reduce((acc: Record<string, number>, c) => ((acc[c.name] = (acc[c.name] ?? 0) + 1), acc), {}),
  };

  // result telemetry
  const { event: result, count: resultCount } = selectOne(events, "result");
  if (resultCount !== 1) warnings.push(`${resultCount} result events`);
  rec.result = result
    ? {
        subtype: result.subtype ?? null,
        is_error: result.is_error ?? null,
        num_turns: result.num_turns ?? null,
        total_cost_usd: result.total_cost_usd ?? null,
        duration_ms: result.duration_ms ?? null,
        stop_reason: result.stop_reason ?? null,
        terminal_reason: result.terminal_reason ?? null,
        permission_denials: (result.permission_denials ?? []).map((d: any) => ({
          tool: d.tool_name,
          path_or_command: d.tool_input?.file_path ?? d.tool_input?.notebook_path ?? d.tool_input?.path ?? String(d.tool_input?.command ?? "").slice(0, 300),
        })),
        modelUsage_keys: Object.keys(result.modelUsage ?? {}),
      }
    : null;
  const rate = events.filter((e) => e.type === "rate_limit_event");
  rec.telemetry.rate_limit_events = rate.length;
  rec.telemetry.rate_limit_statuses = [...new Set(rate.map((e) => e.rate_limit_info?.status ?? null))];

  // P3 re-check (what can be verified after the run)
  const p3: Record<string, unknown> = { path_token_hits: pathTokenHits(resolve(o.runPath)) };
  if ((p3.path_token_hits as string[]).length) fail("P3_PATH_TOKEN", (p3.path_token_hits as string[]).join(","), { isolation: true });
  if (runExists && existsSync(o.base)) {
    const baseTree = git(o.base, ["rev-parse", "HEAD^{tree}"]);
    const roots = git(o.runPath, ["rev-list", "--max-parents=0", "HEAD"]);
    const rootTree = roots.ok && roots.out && !roots.out.includes("\n") ? git(o.runPath, ["rev-parse", `${roots.out}^{tree}`]) : null;
    const headTree = git(o.runPath, ["rev-parse", "HEAD^{tree}"]);
    p3.base_tree = baseTree.out;
    p3.run_root_commit_tree = rootTree?.out ?? null;
    p3.run_head_tree = headTree.ok ? headTree.out : null;
    p3.model_committed = headTree.ok && baseTree.ok ? headTree.out !== baseTree.out : null;
    if (!baseTree.ok || !rootTree?.ok) fail("P3_GIT_UNREADABLE", `${baseTree.err || roots.err || "multiple root commits"}`);
    else if (rootTree.out !== baseTree.out) fail("P3_BASE_MISMATCH", `run root commit tree ${rootTree.out} != BASE ${baseTree.out}`, { isolation: true });
    if (existsSync(join(o.runPath, ".claude")) && o.arm !== "D") warnings.push(".claude/ present at END (scorer flags claude_dir_other_files)");
  }
  p3.project_slug_exists_after_run = existsSync(join(homedir(), ".claude", "projects", projectSlug(resolve(o.runPath))));
  if (o.p3File && existsSync(o.p3File)) {
    const pre = JSON.parse(readFileSync(o.p3File, "utf8"));
    p3.prelaunch = pre;
    if (pre.pass !== true) fail("P3_PRELAUNCH_FAILED", (pre.failures ?? []).join("; "), { isolation: true });
  } else if (o.launchCmd && existsSync(o.launchCmd)) {
    p3.prelaunch = `run-one.sh wrote ${o.launchCmd} after its P3 gate`;
  } else {
    p3.prelaunch = null;
    warnings.push(`no pre-launch P3 evidence (${o.p3File ?? "no p3 record"}, ${o.launchCmd ?? "no launch command file"})`);
  }
  rec.p3_recheck = p3;

  // Frozen inputs after the run (run-one.sh records the hashes once claude has exited).
  if (o.copyJson && existsSync(o.copyJson)) {
    const cp = JSON.parse(readFileSync(o.copyJson, "utf8"));
    rec.post_run = { home: cp.home_post ?? null, wyx_tree_sha256: cp.wyx_tree_sha256_post ?? null };
    if (o.wyxTreeRef && cp.wyx_tree_sha256_post && cp.wyx_tree_sha256_post !== o.wyxTreeRef) {
      fail("PLUGIN_COPY_MODIFIED", `wyx copy tree ${cp.wyx_tree_sha256_post} != manifest ${o.wyxTreeRef} after this run`, { discards: true, isolation: true });
    }
    if (o.homeRef && cp.home_post) {
      const changed = Object.keys(o.homeRef).filter((k) => cp.home_post[k] !== undefined && cp.home_post[k] !== o.homeRef![k]);
      if (changed.length) fail("HOME_CONFIG_CHANGED", `${changed.join(",")} changed during the run`);
    }
  }

  return finish(rec, failures, warnings, manualReasons);
}

function finish(rec: Record<string, any>, failures: Failure[], warnings: string[], manualReasons: string[]) {
  rec.pass = failures.length === 0;
  rec.discards_batch = failures.some((f) => f.discards_batch);
  rec.isolation_ok = !failures.some((f) => f.isolation);
  rec.failures = failures;
  rec.warnings = warnings;
  rec.manual_review_required = manualReasons.length > 0;
  rec.manual_review_reasons = manualReasons;
  return rec;
}

// ---------------------------------------------------------------- batch

export function readKey(path: string): Record<string, string>[] {
  const lines = readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new UsageError(`key file has no rows: ${path}`);
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [header[i], v.trim()])));
  for (const r of rows) {
    r.id = r.id ?? r.run_id;
    if (!r.id || !r.task || !r.arm) throw new UsageError(`key row lacks id/task/arm: ${JSON.stringify(r)}`);
  }
  return rows;
}

function readPluginRef(path: string | undefined): string[] | null {
  if (!path) return null;
  const text = readFileSync(path, "utf8").trim();
  return text.startsWith("[") ? JSON.parse(text) : text.split("\n").map((l) => l.trim()).filter(Boolean);
}

function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function batchSummary(all: Record<string, any>[], explicitRef: string[] | null, rerunOf: Set<string>, inputProblems: string[] = []) {
  // An original whose stream has no init event and that was rerun under a new id is reported, not compared.
  const replaced = all.filter((r) => rerunOf.has(r.run_id) && r.failures.some((f: Failure) => f.code === "NO_INIT"));
  const recs = all.filter((r) => !replaced.includes(r));
  const counts = new Map<string, number>();
  for (const r of recs) if (r.init) counts.set(r.init.plugin_set_sha256, (counts.get(r.init.plugin_set_sha256) ?? 0) + 1);
  const refSha = explicitRef ? sha256Text([...explicitRef].sort().join("\n")) : [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const distinct = (f: (r: any) => unknown) => [...new Set(recs.map(f))];
  const pluginMismatch = recs.filter((r) => !r.init || r.init.plugin_set_sha256 !== refSha).map((r) => r.run_id);
  const models = distinct((r) => r.init?.model ?? null);
  const versions = distinct((r) => r.init?.claude_code_version ?? null);
  const modes = distinct((r) => r.init?.permissionMode ?? null);
  const discardReasons: string[] = [];
  if (models.length !== 1) discardReasons.push(`models differ: ${models.join(",")}`);
  if (versions.length !== 1) discardReasons.push(`claude_code_version differs: ${versions.join(",")}`);
  if (modes.length !== 1) discardReasons.push(`permissionMode differs: ${modes.join(",")}`);
  if (pluginMismatch.length) discardReasons.push(`plugin set differs from the ${explicitRef ? "given" : "majority"} reference: ${pluginMismatch.join(",")}`);
  for (const r of recs) for (const f of r.failures) if (f.discards_batch) discardReasons.push(`${r.run_id}: ${f.code} ${f.detail}`);
  discardReasons.push(...inputProblems);
  return {
    n: recs.length,
    replaced_no_init_ids: replaced.map((r) => r.run_id),
    models, claude_code_versions: versions, permission_modes: modes,
    plugin_reference: { source: explicitRef ? "explicit" : "majority", sha256: refSha, set: explicitRef ?? recs.find((r) => r.init?.plugin_set_sha256 === refSha)?.init.plugin_set_sorted ?? null },
    plugin_set_groups: Object.fromEntries(counts),
    plugin_mismatch_ids: pluginMismatch,
    isolation_failed_ids: [...new Set([...recs.filter((r) => !r.isolation_ok).map((r) => r.run_id), ...pluginMismatch])],
    run_flags: recs.flatMap((r) => r.failures.filter((f: Failure) => !f.isolation && !f.discards_batch).map((f: Failure) => `${r.run_id}: ${f.code}`)),
    no_init_ids: recs.filter((r) => r.failures.some((f: Failure) => f.code === "NO_INIT")).map((r) => r.run_id),
    discard_reasons: discardReasons,
    batch_valid: discardReasons.length === 0 && recs.every((r) => r.isolation_ok),
  };
}

// ---------------------------------------------------------------- p2 (harness probes)

/** P2 assertions on top of the per-run checks, for one probe round (one run per arm). */
function p2Check(recs: Record<string, any>[], streams: Map<string, any[]>) {
  const out: Record<string, string[]> = {};
  const userMemory = join(homedir(), ".claude", "CLAUDE.md");
  for (const r of recs) {
    const f: string[] = r.failures.map((x: Failure) => `${x.code}: ${x.detail}`);
    const events = streams.get(r.run_id) ?? [];
    const hooks = hookResponses(events);
    const text = (ev: string, needle: string) => hooks.some((h) => h.event === ev && h.text.includes(needle));
    const assistantText = events
      .filter((e) => e.type === "assistant" && Array.isArray(e.message?.content))
      .flatMap((e) => e.message.content.filter((b: any) => b?.type === "text").map((b: any) => String(b.text)))
      .join("\n") + `\n${events.find((e) => e.type === "result")?.result ?? ""}`;
    const pgm: any[] = r.instr?.path_glob_match ?? [];
    if (!(r.instr?.session_start ?? []).some((p: string) => samePath(p, userMemory))) f.push(`P2: no session_start entry for ${userMemory}`);
    if (r.arm === "C") {
      const skills: string[] = (events.find((e) => e.type === "system" && e.subtype === "init")?.skills ?? []).map((s: any) => (typeof s === "string" ? s : s?.name));
      if (!skills.includes("wyx:concept")) f.push("P2 C: init.skills lacks wyx:concept");
      if (!hooks.some((h) => h.event === "PreToolUse" && h.text.includes(WYX_TOKENS.pre) && h.text.includes(PAYMENTS_DEPS_HEADER))) f.push(`P2 C: no PreToolUse response with '${WYX_TOKENS.pre}' and '${PAYMENTS_DEPS_HEADER}'`);
      if (!text("PostToolUse", "wyx post-edit check: file governed by payments")) f.push("P2 C: no PostToolUse 'wyx post-edit check: file governed by payments'");
      if (!text("SessionStart", "wyx artifacts: CONCEPT(3")) f.push("P2 C: no SessionStart 'wyx artifacts: CONCEPT(3'");
      if (pgm.length) f.push("P2 C: path_glob_match present");
    } else if (r.arm === "B") {
      if (pgm.length) f.push("P2 B: path_glob_match present");
    } else {
      const hit = pgm.some((g) => g.rule === ".claude/rules/payments.md" && String(g.trigger_file_path ?? "").endsWith("/src/payments/service.ts") && g.agent_id === null);
      if (!hit) f.push("P2 D: no main-thread path_glob_match of .claude/rules/payments.md triggered by src/payments/service.ts");
      if (!assistantText.includes(PAYMENTS_DEPS_HEADER)) f.push(`P2 D: assistant text does not quote '${PAYMENTS_DEPS_HEADER}'`);
    }
    out[r.run_id] = f;
  }
  const sets = new Set(recs.map((r) => r.init?.plugin_set_sha256 ?? "no-init"));
  const arms = recs.map((r) => r.arm).sort().join("");
  const batch: string[] = [];
  if (sets.size !== 1) batch.push(`plugin sets (minus wyx) differ across probes: ${[...sets].join(",")}`);
  if (arms !== "BCD") batch.push(`probe round covers arms ${arms}, want BCD`);
  return { pass: batch.length === 0 && Object.values(out).every((f) => f.length === 0), per_probe: out, round_failures: batch };
}

// ---------------------------------------------------------------- CLI

function need(flags: Record<string, string>, k: string): string {
  const v = flags[k];
  if (!v || v === "true") throw new UsageError(`missing --${k}`);
  return v;
}

function armOf(v: string): Arm {
  if (v !== "B" && v !== "C" && v !== "D") throw new UsageError(`bad arm: ${v}`);
  return v;
}

function runOpts(flags: Record<string, string>, cfg: Record<string, string>, id: string, arm: Arm, task: string, runPathOverride?: string): RunOpts {
  const E = flags["eval-root"];
  const mf = readManifest(E);
  const meta = E ? join(E, "scored", `${id}.meta.json`) : null;
  const recordedRun: string | undefined = meta && existsSync(meta) ? JSON.parse(readFileSync(meta, "utf8")).orig_root : undefined;
  const wyxSha = cfg.WYX_SHA ?? "3ec85d58e85d144d6f06bf4384d1b77d922d7f8d";
  const pick = (flag: string, fallback: string | null) => {
    const v = flags[flag];
    if (v && v !== "true") return v;
    if (fallback === null) throw new UsageError(`missing --${flag} (or --eval-root)`);
    return fallback;
  };
  return {
    id, arm, task,
    runPath: runPathOverride ?? pick("run-path", E ? recordedRun ?? join(E, "runs", id, "shop") : null),
    stream: pick("stream", E ? join(E, "logs", `${id}.jsonl`) : null),
    instr: pick("instr", E ? join(E, "logs", `${id}.instr.jsonl`) : null),
    base: pick("base", E ? mf.base_dir ?? join(E, "base", "shop") : null),
    rulesDir: flags.rules ?? (E ? mf.rules_dir ?? join(E, "rules") : null),
    ruleRef: flags.rules ? null : mf.d_rules ?? null,
    wyxPath: pick("wyx-path", E ? mf.wyx_dir ?? join(E, `wyx-${wyxSha.slice(0, 7)}`) : null),
    wyxVersion: flags["wyx-version"] ?? mf.wyx_version ?? "0.27.0",
    model: flags.model ?? mf.model ?? cfg.MODEL ?? "claude-opus-5-5",
    ccVersion: flags["cc-version"] ?? mf.claude_code_version ?? cfg.CLAUDE_CODE_VERSION ?? "2.1.281",
    pluginRef: readPluginRef(flags["plugin-ref"]),
    p3File: flags.p3 ?? (E ? join(E, "preflight", `${id}.p3.json`) : null),
    launchCmd: E ? join(E, "logs", `${id}.cmd`) : null,
    copyJson: E ? join(E, "logs", `${id}.copy.json`) : null,
    homeRef: mf.home ?? null,
    wyxTreeRef: mf.wyx_tree_sha256 ?? null,
  };
}

function main(): number {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  if (!flags["eval-root"] && process.env.EVAL_ROOT) flags["eval-root"] = process.env.EVAL_ROOT;
  const cfg = readConfig();
  const mode = pos[0] ?? "batch";
  if (mode === "p3") {
    const E = flags["eval-root"];
    const mf = readManifest(E);
    const base = flags.base ?? (E ? mf.base_dir ?? join(E, "base", "shop") : null);
    if (!base) throw new UsageError("missing --base (or --eval-root)");
    const r = p3Check(need(flags, "run-path"), armOf(need(flags, "arm")), base, flags.rules ?? (E ? mf.rules_dir ?? join(E, "rules") : null), flags.rules ? null : mf.d_rules ?? null);
    const out = { run_id: flags.id ?? null, checked_at: new Date().toISOString(), ...r };
    const outPath = flags.out ?? (E && flags.id ? join(E, "preflight", `${flags.id}.p3.json`) : null);
    if (outPath) writeJson(outPath, out);
    console.log(JSON.stringify(out, null, 2));
    return r.pass ? 0 : 1;
  }
  if (mode === "run") {
    const id = flags.id ?? basename(need(flags, "stream")).replace(/\.jsonl$/, "");
    const rec = checkRun(runOpts(flags, cfg, id, armOf(need(flags, "arm")), need(flags, "task")));
    const outPath = flags.out ?? (flags["eval-root"] ? join(flags["eval-root"], "preflight", `${id}.json`) : null);
    if (outPath) writeJson(outPath, rec);
    console.log(JSON.stringify(rec, null, 2));
    return rec.isolation_ok && !rec.discards_batch ? 0 : 1;
  }
  if (mode === "batch") {
    const E = need(flags, "eval-root");
    requireFrozen(E);
    const rows = readKey(flags.key ?? join(E, "key", "key.csv"));
    const recs = rows.map((r) => checkRun(runOpts(flags, cfg, r.id, armOf(r.arm), r.task, r.run_path || undefined)));
    const mf = readManifest(E);
    const inputProblems: string[] = [];
    if (mf.wyx_dir && mf.wyx_tree_sha256) {
      const t = existsSync(mf.wyx_dir) ? treeSha256(mf.wyx_dir) : "missing";
      if (t !== mf.wyx_tree_sha256) inputProblems.push(`PLUGIN_COPY_MODIFIED: ${mf.wyx_dir} tree ${t} != manifest ${mf.wyx_tree_sha256}`);
    } else inputProblems.push("manifest.json lacks wyx_dir/wyx_tree_sha256");
    const rulesDir = mf.rules_dir ?? join(E, "rules");
    const now = ruleHashes(rulesDir);
    for (const m of RULE_MODULES) {
      if (!now || !mf.d_rules || now[m] !== mf.d_rules[m]) inputProblems.push(`RULES_COPY_MODIFIED: ${rulesDir}/${m}.md ${now?.[m] ?? "missing"} != manifest ${mf.d_rules?.[m] ?? "missing"}`);
    }
    const summary = batchSummary(recs, readPluginRef(flags["plugin-ref"]), new Set(rows.map((r) => r.rerun_of).filter(Boolean)), inputProblems);
    for (const rec of recs) {
      if (summary.plugin_mismatch_ids.includes(rec.run_id) && !rec.failures.some((f: Failure) => f.code === "PLUGIN_SET_MISMATCH")) {
        finish(rec, [...rec.failures, { code: "PLUGIN_SET_MISMATCH", detail: `plugin set differs from the batch reference ${summary.plugin_reference.sha256}`, discards_batch: true, isolation: true }], rec.warnings, rec.manual_review_reasons);
      }
      writeJson(join(E, "preflight", `${rec.run_id}.json`), rec);
    }
    writeJson(join(E, "preflight", "batch.json"), summary);
    console.log(JSON.stringify(summary, null, 2));
    return summary.batch_valid ? 0 : 1;
  }
  if (mode === "p2") {
    const E = need(flags, "eval-root");
    const pkey = join(E, "key", "probes.csv");
    if (!existsSync(pkey)) throw new UsageError(`missing ${pkey}; run run/probe.sh first`);
    const lines = readFileSync(pkey, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).slice(1).map((l) => l.split(","));
    const round = flags.round ?? String(Math.max(...lines.map((l) => Number(l[3]))));
    const rows = lines.filter((l) => l[3] === round).map(([id, arm, model]) => ({ id, arm: armOf(arm), model }));
    if (!rows.length) throw new UsageError(`no probes for round ${round} in ${pkey}`);
    const streams = new Map<string, any[]>();
    const recs = rows.map((r) => {
      const o = runOpts(flags, cfg, r.id, r.arm, "P2");
      o.model = flags.model ?? r.model;
      const rec = checkRun(o);
      streams.set(r.id, existsSync(o.stream) ? readJsonl(o.stream).events : []);
      writeJson(join(E, "preflight", `${r.id}.json`), rec);
      return rec;
    });
    const verdict = { round, probes: rows, ...p2Check(recs, streams) };
    writeJson(join(E, "preflight", `p2-round${round}.json`), verdict);
    console.log(JSON.stringify(verdict, null, 2));
    return verdict.pass ? 0 : 1;
  }
  throw new UsageError(`unknown mode: ${mode}`);
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(e instanceof UsageError ? `${e.message}\n${USAGE}` : `preflight: could not complete: ${(e as Error).stack}`);
    process.exit(2);
  }
}
