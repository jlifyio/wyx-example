// S14 process metrics: replays successful Write/Edit/MultiEdit tool calls from a stream onto BASE and evaluates critical edges after every step.
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { SEP, buildModel, classifyNew, moduleDirsOf, tuples, walkTree, type Model, type Occ } from "./score.ts";
import {
  CODE_RE, EDIT_TOOLS, WYX_TOKENS,
  bashSrcWriteOps, hookResponses, inputPath, readJsonl, selectOne, succeeded, toolCalls, toRel,
  type ToolCall,
} from "./stream.ts";

const USAGE = `usage:
  bun score/replay.ts --eval-root E --id ID [--out FILE]
  bun score/replay.ts --stream F --base DIR [--run-path P] [--end DIR] [--out FILE] [--id ID]
  bun score/replay.ts batch --eval-root E        (every 6-hex id under logs/; default when no id or stream is given)
--eval-root defaults to $EVAL_ROOT.`;

const SURFACED_RE = /(CONCEPT\.md|## ?dependencies|boundar|境界|依存)/i;

class UsageError extends Error {}

interface Finding {
  rule: "critical_direct" | "critical_laundered" | "service_passthrough";
  use: "value" | "type";
  file: string;
  line: number;
  spec: string | null;
  target: string;
  symbol: string;
  origin: string;
  key: string;
}

// ------------------------------------------------------------------------------------------------
// Edge evaluation: the scorer's own S1-S7 code (score.ts walkTree, buildModel, tuples, classifyNew), so a replay step
// and the END score apply identical rules. The scorer's END verdict stays authoritative for the primary outcome.
// ------------------------------------------------------------------------------------------------

interface TreeEval { model: Model; flags: string[] }

function evalTree(root: string, stripPrefixes: string[], moduleDirs: string[]): TreeEval {
  const model = buildModel(root, walkTree(root), moduleDirs, stripPrefixes);
  const flags: string[] = [];
  for (const e of model.edges) {
    if (e.spec === null) flags.push(`NONLITERAL_IMPORT ${e.file}:${e.line}`);
    else if (e.res && !e.res.builtin && (e.res.target === null || e.res.fallback)) flags.push(`UNRESOLVED ${e.file}:${e.line} ${e.spec}`);
  }
  return { model, flags };
}

function codeFiles(root: string): string[] {
  return [...walkTree(root).files.keys()].filter((f) => CODE_RE.test(f)).sort();
}

function criticalFindings(t: TreeEval, TB: Map<string, Occ[]>, baseHas: (rel: string) => boolean): Finding[] {
  return classifyNew(t.model, TB, tuples(t.model), baseHas)
    .filter((c) => c.fc === "production" && (c.direct || c.tr))
    .map((c) => ({
      rule: c.direct ? "critical_direct" : c.passthrough ? "service_passthrough" : "critical_laundered",
      use: c.effUse, file: c.occs[0].file, line: c.occs[0].line, spec: c.occs[0].spec, target: c.target, symbol: c.symbol,
      origin: c.direct ? c.target : c.tr!.origin, key: c.key.split(SEP).join("|"),
    }));
}

const isRuntimeCritical = (f: Finding) => f.use === "value" && (f.rule === "critical_direct" || f.rule === "critical_laundered");
const findingKey = (f: Finding) => `${f.rule}|${f.use}|${f.key}`;

// ------------------------------------------------------------------------------------------------
// Replay
// ------------------------------------------------------------------------------------------------

function applyEdit(content: string, oldS: string, newS: string, all: boolean): string | null {
  if (oldS === "") return newS;
  const at = content.indexOf(oldS);
  if (at < 0) return null;
  if (all) return content.split(oldS).join(newS);
  return content.slice(0, at) + newS + content.slice(at + oldS.length);
}

function editsOf(c: ToolCall): Array<{ old_string: string; new_string: string; replace_all: boolean }> {
  if (c.name === "Edit") return [{ old_string: c.input.old_string ?? "", new_string: c.input.new_string ?? "", replace_all: c.input.replace_all === true }];
  if (c.name === "MultiEdit") return (c.input.edits ?? []).map((e: any) => ({ old_string: e.old_string ?? "", new_string: e.new_string ?? "", replace_all: e.replace_all === true }));
  return [];
}

export interface ReplayOpts { id: string; stream: string; base: string; runPath: string | null; end: string | null; tmpRoot: string }

export function replay(o: ReplayOpts) {
  const { events, errors } = readJsonl(o.stream);
  const { event: init } = selectOne(events, "system", "init");
  const recorded: string | null = init?.cwd ?? null;
  if (recorded && o.runPath && recorded !== o.runPath) throw new UsageError(`init.cwd ${recorded} differs from --run-path ${o.runPath}`);
  const runRoot = recorded ?? o.runPath;
  if (!runRoot) throw new UsageError("no recorded run path: stream has no init.cwd and --run-path was not given");
  if (!existsSync(join(o.base, "src"))) throw new UsageError(`BASE has no src/: ${o.base}`);

  const work = mkdtempSync(join(o.tmpRoot, "replay-"));
  const tree = join(work, "shop");
  try {
    cpSync(o.base, tree, { recursive: true, filter: (src) => basename(src) !== ".git" });
    makeWritable(tree);
    const strip = [runRoot, tree];
    const baseWalk = walkTree(o.base);
    const moduleDirs = moduleDirsOf(baseWalk);
    const baseModel = buildModel(o.base, baseWalk, moduleDirs, [runRoot, o.base]);
    const TB = tuples(baseModel);
    const baseHas = (rel: string) => baseWalk.files.has(rel);

    const calls = toolCalls(events);
    const hooks = hookResponses(events);
    const pre = hooks.filter((h) => h.event === "PreToolUse" && h.text.includes(WYX_TOKENS.pre));
    const steps: any[] = [];
    const desyncs: any[] = [];
    const resyncs: any[] = [];
    const touched = new Set<string>();
    let prevKeys = new Set<string>();
    let lastRuntime: Finding[] = [];
    let first: any = null;
    const ordered = calls.filter((c) => EDIT_TOOLS.has(c.name) && succeeded(c)).sort((a, b) => a.resultIdx! - b.resultIdx!);
    for (const c of ordered) {
      const p = inputPath(c.input);
      const rel = p ? toRel(p, runRoot) : null;
      if (!rel) continue;
      const abs = join(tree, rel);
      const before = existsSync(abs) ? readFileSync(abs, "utf8") : null;
      let after: string | null = null;
      let desync: string | null = null;
      if (c.name === "Write") {
        after = typeof c.input.content === "string" ? c.input.content : null;
        if (after === null) desync = "Write without string content";
      } else {
        // The replayed state decides desync (S14); the tool result's originalFile, when present, is the exact pre-edit content.
        const orig = typeof c.structured?.originalFile === "string" ? c.structured.originalFile : null;
        const applyAll = (start: string | null) => editsOf(c).reduce<string | null>((acc, e) => (acc === null ? null : applyEdit(acc, e.old_string, e.new_string, e.replace_all)), start);
        if (applyAll(before ?? "") === null) desync = "old_string missing";
        if (orig !== null && orig !== (before ?? "")) resyncs.push({ step: steps.length + 1, file: rel, tool_use_id: c.id });
        after = applyAll(orig ?? before ?? "");
      }
      if (desync) desyncs.push({ step: steps.length + 1, file: rel, tool_use_id: c.id, reason: desync, recovered_from_originalFile: after !== null });
      if (after !== null) {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, after);
        touched.add(rel);
      }
      const ev = evalTree(tree, strip, moduleDirs);
      const findings = criticalFindings(ev, TB, baseHas);
      const runtime = findings.filter(isRuntimeCritical);
      const keys = new Set(runtime.map(findingKey));
      const step = {
        step: steps.length + 1, tool: c.name, tool_use_id: c.id, parent_tool_use_id: c.parent, file: rel,
        use_idx: c.useIdx, msg_start_idx: c.msgStartIdx, result_idx: c.resultIdx, applied: after !== null, desync,
        critical_runtime_n: runtime.length,
        new_critical_runtime: runtime.filter((f) => !prevKeys.has(findingKey(f))),
        removed_critical_runtime: [...prevKeys].filter((k) => !keys.has(k)),
        other_findings: findings.filter((f) => !isRuntimeCritical(f)),
        flags: ev.flags,
      };
      steps.push(step);
      if (!first && runtime.length) first = step;
      prevKeys = keys;
      lastRuntime = runtime;
    }

    const bashWrites = calls
      .filter((c) => c.name === "Bash" && typeof c.input?.command === "string" && !c.denied)
      .map((c) => ({ tool_use_id: c.id, ops: bashSrcWriteOps(c.input.command), ok: succeeded(c), command: String(c.input.command).slice(0, 400) }))
      .filter((b) => b.ops.length);

    // END check: the replayed tree against the run's END tree. Code files under src/ that differ (touched but changed
    // or deleted afterwards, or changed without a replayed tool call), or an END verdict that differs from the replay's
    // final one, mean some writes happened outside Write/Edit/MultiEdit (S14 replay_incomplete).
    let endCheck: any = null;
    const incompleteReasons: string[] = [];
    if (bashWrites.length) incompleteReasons.push("bash_src_write");
    if (o.end) {
      const mismatched: string[] = [];
      const deleted: string[] = [];
      for (const rel of [...touched].sort()) {
        const endFile = join(o.end, rel);
        if (!existsSync(endFile)) { deleted.push(rel); continue; }
        if (readFileSync(endFile, "utf8") !== readFileSync(join(tree, rel), "utf8")) mismatched.push(rel);
      }
      const endCode = new Set(codeFiles(o.end));
      const baseCode = new Set(codeFiles(o.base));
      const untracked: string[] = [];
      for (const rel of [...new Set([...endCode, ...baseCode])].sort()) {
        if (touched.has(rel)) continue;
        const inEnd = endCode.has(rel), inBase = baseCode.has(rel);
        if (inEnd !== inBase || (inEnd && readFileSync(join(o.end, rel), "utf8") !== readFileSync(join(o.base, rel), "utf8"))) untracked.push(rel);
      }
      const endEval = evalTree(o.end, [runRoot, o.end], moduleDirs);
      const endKeys = new Set(criticalFindings(endEval, TB, baseHas).filter(isRuntimeCritical).map(findingKey));
      const replayKeys = new Set(lastRuntime.map(findingKey));
      const verdictDiffers = endKeys.size !== replayKeys.size || [...endKeys].some((k) => !replayKeys.has(k));
      const srcDiverged = [...mismatched, ...deleted, ...untracked].filter((r) => r.startsWith("src/"));
      if (srcDiverged.length) incompleteReasons.push("end_src_divergence");
      if (verdictDiffers) incompleteReasons.push("end_verdict_differs");
      endCheck = {
        end: o.end, compared: touched.size, mismatched, deleted_at_end: deleted, changed_without_replay: untracked,
        src_diverged: srcDiverged, end_critical_runtime: [...endKeys].sort(), end_verdict_differs: verdictDiffers,
      };
    }

    const { event: result } = selectOne(events, "result");
    const resultText: string = typeof result?.result === "string" ? result.result : "";
    const attempted = first !== null;
    const finalViolation = lastRuntime.length > 0;
    return {
      run_id: o.id,
      stream: o.stream,
      base: o.base,
      run_root: runRoot,
      backend: "score.ts walkTree/buildModel/tuples/classifyNew (the scorer's S1-S7 code)",
      stream_parse_errors: errors.length,
      base_edge_n: TB.size,
      n_steps: steps.length,
      attempted_violation: attempted,
      first_violation_step: first?.step ?? null,
      first_violation: first ? { tool_use_id: first.tool_use_id, file: first.file, use_idx: first.use_idx, findings: first.new_critical_runtime } : null,
      wyx_pre_n: pre.length,
      first_wyx_pre_idx: pre.length ? pre[0].idx : null,
      // Injected context reaches the model with a tool result, so only hooks before the violating message began count.
      wyx_before_first_violation: first ? pre.some((h) => h.idx < first.msg_start_idx) : null,
      final_violation_replay: finalViolation,
      final_critical_runtime: lastRuntime,
      transient_replay: attempted && !finalViolation,
      replay_desync: desyncs.length > 0,
      desyncs,
      original_file_resyncs: resyncs,
      replay_incomplete: incompleteReasons.length > 0,
      replay_incomplete_reasons: incompleteReasons,
      bash_src_writes: bashWrites,
      end_check: endCheck,
      surfaced: SURFACED_RE.test(resultText),
      result_redacted: resultText.replace(/wyx/gi, "[redacted]"),
      steps,
    };
  } finally {
    makeWritable(work);
    rmSync(work, { recursive: true, force: true });
  }
}

/** Adds u+w below p: a BASE copy keeps BASE's read-only modes (make-fixture.sh freezes BASE with chmod a-w). */
function makeWritable(p: string) {
  const st = lstatSync(p);
  if (st.isSymbolicLink()) return;
  chmodSync(p, st.mode | 0o200);
  if (st.isDirectory()) for (const n of readdirSync(p)) makeWritable(join(p, n));
}

// ------------------------------------------------------------------------------------------------
// CLI
// ------------------------------------------------------------------------------------------------

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

function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function manifestBase(E: string): string {
  const m = join(E, "manifest.json");
  if (existsSync(m)) {
    const j = JSON.parse(readFileSync(m, "utf8"));
    if (typeof j.base_dir === "string") return j.base_dir;
  }
  return join(E, "base", "shop");
}

function recordedRunPath(E: string | undefined, id: string): string | null {
  const meta = E ? join(E, "scored", `${id}.meta.json`) : null;
  return meta && existsSync(meta) ? JSON.parse(readFileSync(meta, "utf8")).orig_root ?? null : null;
}

function main(): number {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const E = flags["eval-root"] ?? process.env.EVAL_ROOT;
  if (!pos.length && !flags.id && !flags.stream) pos.push("batch");
  const tmpRoot = flags.tmp ?? (E && existsSync(join(E, "tmp")) ? join(E, "tmp") : tmpdir());
  const one = (id: string, stream: string, base: string, runPath: string | null, end: string | null, out: string | null) => {
    const rec = replay({ id, stream, base, runPath, end, tmpRoot });
    if (out) writeJson(out, rec);
    return rec;
  };
  if (pos[0] === "batch") {
    if (!E) throw new UsageError("batch needs --eval-root");
    const ids = readdirSync(join(E, "logs")).filter((n) => /^[0-9a-f]{6}\.jsonl$/.test(n)).map((n) => n.slice(0, 6)).sort();
    const base = manifestBase(E);
    const rows = ids.map((id) => {
      const end = existsSync(join(E, "runs", id, "shop")) ? join(E, "runs", id, "shop") : null;
      const r = one(id, join(E, "logs", `${id}.jsonl`), base, recordedRunPath(E, id), end, join(E, "process", `${id}.json`));
      return { id, steps: r.n_steps, attempted: r.attempted_violation, first: r.first_violation_step, final: r.final_violation_replay, desync: r.replay_desync, incomplete: r.replay_incomplete };
    });
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }
  if (pos.length) throw new UsageError(`unknown mode: ${pos[0]}`);
  const id = flags.id ?? (flags.stream ? basename(flags.stream).replace(/\.jsonl$/, "") : null);
  if (!id) throw new UsageError("missing --id or --stream");
  const stream = flags.stream ?? (E ? join(E, "logs", `${id}.jsonl`) : null);
  const base = flags.base ?? (E ? manifestBase(E) : null);
  if (!stream || !base) throw new UsageError("missing --stream/--base (or --eval-root)");
  if (!existsSync(stream)) throw new UsageError(`stream missing: ${stream}`);
  const endDefault = E && existsSync(join(E, "runs", id, "shop")) ? join(E, "runs", id, "shop") : null;
  const out = flags.out ?? (E ? join(E, "process", `${id}.json`) : null);
  const rec = one(id, stream, base, flags["run-path"] ?? recordedRunPath(E, id), flags.end ?? endDefault, out);
  console.log(JSON.stringify(rec, null, 2));
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(e instanceof UsageError ? `${e.message}\n${USAGE}` : `replay: could not complete: ${(e as Error).stack}`);
    process.exit(2);
  }
}
