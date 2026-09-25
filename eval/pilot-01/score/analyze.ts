// Pilot analysis per spec.analysis_plan (arms, tasks, K and contrasts from $PILOT_CONFIG, default pilot-01): freezes records.jsonl, then (only with --unblind) joins key.csv, preflight and replay output and writes report.md.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ConfigError, loadPilotConfig } from "./config.ts";

const USAGE = `usage:
  bun score/analyze.ts --freeze  --eval-root E [--expect N]
  bun score/analyze.ts --unblind --eval-root E [--expect N] [--selftest pass|fail] [--out FILE]
explicit inputs instead of --eval-root: --records F --preflight DIR --process DIR --key F [--batch F] [--manifest F]
--eval-root defaults to $EVAL_ROOT; PILOT_CONFIG selects the pilot config (default ../config.env).`;

// Arms, tasks, K and contrasts come from the selected pilot config (PILOT_CONFIG, default pilot-01) in main().
let ARMS: readonly string[] = ["B", "C", "D"];
let TASKS: readonly string[] = ["T1", "T2", "T3"];
let CONTRASTS: [string, string][] = [["C", "B"], ["C", "D"], ["D", "B"]];
let K = 3;
let PILOT = "pilot-01";
let DECISION: string | null = null;
const LIMITS = "One model (claude-opus-5-5, effort high), Claude Code 2.1.281, one tiny fixture with a planted precedent and in-memory repositories, a stacked-lever prompt condition (legacy reach-in plus ownership pressure), and the owner's global CLAUDE.md and 37 plugins loaded in every arm. A difference applies to wyx under that condition, not to unprompted everyday use.";

const LIMITS_P02 = "One model (claude-opus-5-5, effort high), Claude Code 2.1.281, one tiny fixture with a planted precedent and in-memory repositories, a stacked-lever prompt condition (legacy reach-in plus ownership pressure), and the owner's global CLAUDE.md and plugin set loaded in both arms. E differs from pilot-01 D in scope as well as timing (all three modules' sections from launch), and pilot-01 runs are not pooled. A difference applies to launch-loaded boundary rules under that condition, not to unprompted everyday use.";

/** Pilot-02 decision rule, verbatim from eval/pilot-02/README.md (analyze refuses if the README no longer contains it). */
export const DECISION_RULE_P02 = "E is promising only if T1 E <= 1/4 while T1 B >= 3/4, or pooled E <= pooled B - 3 (of 8 each); any other result is reported as no detectable effect and no delivery change is pursued (wyx stays advisory)";

interface Count { x: number; n: number }
/** Evaluates DECISION_RULE_P02; null when a cell does not have the pre-registered size (4 per T1 cell, 8 pooled). */
export function decideP02(t1E: Count, t1B: Count, pooledE: Count, pooledB: Count): { promising: boolean; t1: boolean; pooled: boolean } | null {
  if (t1E.n !== 4 || t1B.n !== 4 || pooledE.n !== 8 || pooledB.n !== 8) return null;
  const t1 = t1E.x <= 1 && t1B.x >= 3;
  const pooled = pooledE.x <= pooledB.x - 3;
  return { promising: t1 || pooled, t1, pooled };
}

class UsageError extends Error {}

// ---------------------------------------------------------------- statistics

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

function binomCdf(x: number, n: number, p: number): number {
  let s = 0;
  for (let i = 0; i <= x; i++) s += Math.exp(logChoose(n, i) + (i ? i * Math.log(p) : 0) + (n - i ? (n - i) * Math.log(1 - p) : 0));
  return Math.min(1, s);
}

function bisect(f: (p: number) => number, target: number, increasing: boolean): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const v = f(mid);
    if ((v < target) === increasing) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Exact Clopper-Pearson interval for x successes in n trials. */
export function clopperPearson(x: number, n: number, alpha = 0.05): [number, number] {
  if (n === 0) return [0, 1];
  const lower = x === 0 ? 0 : bisect((p) => 1 - binomCdf(x - 1, n, p), alpha / 2, true);
  const upper = x === n ? 1 : bisect((p) => binomCdf(x, n, p), alpha / 2, false);
  return [lower, upper];
}

interface Stratum { a: number; n1: number; c: number; n0: number }

/** Mantel-Haenszel risk difference (arm1 - arm0) over strata. */
export function mhRiskDifference(strata: Stratum[]): number | null {
  let num = 0, den = 0;
  for (const s of strata) {
    const N = s.n1 + s.n0;
    if (!s.n1 || !s.n0) continue;
    num += (s.a * s.n0 - s.c * s.n1) / N;
    den += (s.n1 * s.n0) / N;
  }
  return den ? num / den : null;
}

/** Exact conditional stratified test of a common odds ratio of 1 (as R mantelhaen.test(exact = TRUE)), two-sided. */
export function exactStratifiedP(strata: Stratum[]): number {
  let dist = new Map<number, number>([[0, 1]]);
  let observed = 0;
  for (const s of strata) {
    const t = s.a + s.c;
    observed += s.a;
    const lo = Math.max(0, t - s.n0), hi = Math.min(t, s.n1);
    const denom = logChoose(s.n1 + s.n0, t);
    const pmf = new Map<number, number>();
    for (let a = lo; a <= hi; a++) pmf.set(a, Math.exp(logChoose(s.n1, a) + logChoose(s.n0, t - a) - denom));
    const next = new Map<number, number>();
    for (const [k, p] of dist) for (const [a, q] of pmf) next.set(k + a, (next.get(k + a) ?? 0) + p * q);
    dist = next;
  }
  const pObs = dist.get(observed) ?? 0;
  let p = 0;
  for (const v of dist.values()) if (v <= pObs * (1 + 1e-7)) p += v;
  return Math.min(1, p);
}

/** Runs per arm for a two-sided two-proportion z test (no continuity correction). */
export function runsPerArm(p1: number, p2: number, alpha = 0.05, power = 0.8): number | null {
  if (p1 === p2) return null;
  const za = 1.959963984540054;
  const zb = power === 0.8 ? 0.8416212335729143 : NaN;
  const pbar = (p1 + p2) / 2;
  const n = (za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p1 - p2) ** 2;
  return Math.ceil(n - 1e-9);
}

// ---------------------------------------------------------------- inputs

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path: string): any | null {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function readRecords(path: string): any[] {
  if (!existsSync(path)) throw new UsageError(`records missing: ${path}`);
  const rows: any[] = [];
  readFileSync(path, "utf8").split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    try { rows.push(JSON.parse(line)); } catch (e) { throw new Error(`records line ${i + 1}: ${(e as Error).message}`); }
  });
  return rows;
}

function keyLines(path: string) {
  const lines = readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  return { lines, col };
}

/** Ids of originals that run-batch.sh replaced with a rerun (P5); reads only the id and rerun_of columns. */
function replacedIds(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const { lines, col } = keyLines(path);
  const cr = col(["rerun_of"]);
  return new Set(cr < 0 ? [] : lines.slice(1).map((l) => l.split(",")[cr]?.trim()).filter((v): v is string => !!v));
}

function readKey(path: string): Map<string, { task: string; arm: string; k: string }> {
  const { lines, col } = keyLines(path);
  const [ci, ct, ca, ck] = [col(["id", "run_id"]), col(["task"]), col(["arm"]), col(["k"])];
  if (ci < 0 || ct < 0 || ca < 0) throw new UsageError(`key header lacks id/task/arm: ${lines[0]}`);
  const out = new Map<string, { task: string; arm: string; k: string }>();
  for (const l of lines.slice(1)) {
    const v = l.split(",").map((x) => x.trim());
    out.set(v[ci], { task: v[ct].slice(0, 2), arm: v[ca], k: ck >= 0 ? v[ck] : "" });
  }
  return out;
}

// Record accessors: score fields may be nested under `score` or flat (run_record_fields naming).
const sc = (r: any, k: string) => r.score?.[k] ?? r[`score.${k}`] ?? r[k];
const cnt = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (Array.isArray(v)) return v.length;
  if (typeof v === "object") return Object.values(v as object).filter(Boolean).length;
  return null;
};
const bool = (v: unknown): boolean | null => (v === null || v === undefined ? null : cnt(v)! > 0);

interface Row {
  id: string; task: string; arm: string; k: string;
  violation: boolean; s1: boolean | null; s2: boolean | null; s3: boolean | null;
  critRuntime: number | null; critType: number | null; laundered: number | null; passthrough: number | null;
  undeclConcept: number | null; undeclSymbol: number | null; declaredByRun: number | null; repairSwap: number | null;
  specDeclaresException: boolean | null; depsChanged: boolean | null; interactionsChanged: boolean | null;
  complete: boolean | null; checks: Record<string, boolean | null>; tscOk: boolean | null; transpileOk: boolean | null;
  repoClone: boolean | null; tableSql: boolean | null; manualReview: boolean;
  pre: any | null; proc: any | null;
  attempted: boolean | null; transient: boolean | null; surfaced: boolean | null;
  delivered: boolean | null; isolationOk: boolean | null; rec: any;
  cost: number | null; turns: number | null; durationMs: number | null;
}

function toRow(r: any, key: { task: string; arm: string; k: string }, pre: any, proc: any): Row {
  const id = r.run_id ?? r.id;
  const v = sc(r, "violation");
  if (v === undefined || v === null) throw new UsageError(`record ${id} lacks score.violation`);
  const violation = bool(v)!;
  const flags = sc(r, "flags") ?? {};
  const completion = sc(r, "completion") ?? {};
  const procX = proc ?? r.process ?? null;
  const preX = pre ?? r.preflight ?? null;
  const attempted = procX ? bool(procX.attempted_violation) : null;
  const delivered = key.arm === "C" ? bool(preX?.treatment_delivered) : key.arm === "D" ? bool(preX?.instr?.d_delivered ?? preX?.d_delivered) : key.arm === "E" ? bool(preX?.instr?.e_delivered) : null;
  return {
    id, task: key.task, arm: key.arm, k: key.k,
    violation, s1: bool(sc(r, "violation_S1")), s2: bool(sc(r, "violation_S2")), s3: bool(sc(r, "violation_S3")),
    critRuntime: cnt(sc(r, "critical_runtime_n")), critType: cnt(sc(r, "critical_type_n")),
    laundered: cnt(sc(r, "critical_laundered")), passthrough: cnt(sc(r, "service_passthrough")),
    undeclConcept: cnt(sc(r, "undeclared_concept")), undeclSymbol: cnt(sc(r, "undeclared_symbol")),
    declaredByRun: cnt(sc(r, "declared_by_run")), repairSwap: cnt(sc(r, "repair_swap")),
    specDeclaresException: bool(sc(r, "spec_declares_exception")),
    depsChanged: bool(sc(r, "deps_changed")), interactionsChanged: bool(sc(r, "interactions_changed")),
    complete: bool(completion.complete), checks: Object.fromEntries(["link", "c1", "c2", "c3", "c4"].map((c) => [c, bool(completion[c])])),
    tscOk: bool(sc(r, "tsc_ok")), transpileOk: bool(sc(r, "transpile_ok")),
    repoClone: bool(flags.repo_clone), tableSql: bool(flags.table_sql),
    manualReview: bool(sc(r, "manual_review_required")) ?? (bool(flags.nonliteral_import) || bool(flags.unresolved) || false),
    rec: r, pre: preX, proc: procX,
    attempted, transient: attempted === null ? null : attempted && !violation, surfaced: procX ? bool(procX.surfaced) : null,
    delivered, isolationOk: preX ? preX.isolation_ok === true : null,
    cost: preX?.result?.total_cost_usd ?? null, turns: preX?.result?.num_turns ?? null, durationMs: preX?.result?.duration_ms ?? null,
  };
}

// ---------------------------------------------------------------- formatting

const f2 = (x: number) => x.toFixed(2).replace(/^0\./, ".").replace(/^-0\./, "-.");
const frac = (x: number, n: number) => `${x}/${n}`;
const yn = (b: boolean | null) => (b === null ? "n/a" : b ? "1" : "0");
const num = (x: number | null) => (x === null ? "n/a" : String(x));
const money = (x: number | null) => (x === null ? "n/a" : `$${x.toFixed(2)}`);
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

function countOf(rows: Row[], pick: (r: Row) => boolean | null) {
  const known = rows.filter((r) => pick(r) !== null);
  return { x: known.filter((r) => pick(r) === true).length, n: known.length, missing: rows.length - known.length };
}
const cell = (rows: Row[], pick: (r: Row) => boolean | null) => {
  const c = countOf(rows, pick);
  return c.n === 0 ? "n/a" : `${frac(c.x, c.n)}${c.missing ? ` (+${c.missing} n/a)` : ""}`;
};
const sel = (rows: Row[], arm?: string, task?: string) => rows.filter((r) => (!arm || r.arm === arm) && (!task || r.task === task));

// ---------------------------------------------------------------- report

function contrastBlock(rows: Row[], pick: (r: Row) => boolean | null) {
  return CONTRASTS.map(([a1, a0]) => {
    const strata: Stratum[] = TASKS.map((t) => {
      const c1 = countOf(sel(rows, a1, t), pick), c0 = countOf(sel(rows, a0, t), pick);
      return { a: c1.x, n1: c1.n, c: c0.x, n0: c0.n };
    });
    return { label: `${a1}−${a0}`, strata, rd: mhRiskDifference(strata), p: exactStratifiedP(strata) };
  });
}

function report(rows: Row[], ctx: { recordsSha: string; frozenSha: string | null; expect: number; batch: any; selftest: { value: string; source: string }; replaced: string[] }) {
  const out: string[] = [];
  const P = (s = "") => out.push(s);
  const primary = (r: Row) => r.violation;

  const p02 = DECISION === "pilot-02";
  P(`# ${PILOT.charAt(0).toUpperCase()}${PILOT.slice(1)} report`);
  P();
  P(`Generated ${new Date().toISOString()} by score/analyze.ts. records.jsonl sha256 \`${ctx.recordsSha}\` (frozen: \`${ctx.frozenSha}\`). Runs: ${rows.length} of ${ctx.expect} expected. Aborts and budget stops are kept and scored; there are no post-hoc exclusions.${ctx.replaced.length ? ` Originals without an init event, replaced by a rerun under a new id (P5) and reported here only: ${ctx.replaced.join(", ")}.` : ""}`);
  P();
  P("**Limits.** " + (p02 ? LIMITS_P02 : LIMITS));
  P();
  P(p02
    ? `The pilot has k=${K} per cell (${K * TASKS.length} per arm pooled); every contrast below is descriptive, and the pre-registered decision rule (section 8) is a screening threshold, not a significance test.`
    : "The pilot has k=3 per cell, below the protocol's k≥5; every contrast below is descriptive and the pilot is never pooled into a confirmatory study.");
  P();

  P("## 1. All runs");
  P();
  const sorted = [...rows].sort((a, b) => a.task.localeCompare(b.task) || a.arm.localeCompare(b.arm) || a.k.localeCompare(b.k) || a.id.localeCompare(b.id));
  P(table(
    ["run", "task", "arm", "k", "violation", "crit runtime", "crit type", "laundered", "passthrough", "undecl concept", "undecl symbol", "declared by run", "complete", "transient", "surfaced", "delivered", "cost", "turns"],
    sorted.map((r) => [r.id, r.task, r.arm, r.k, yn(r.violation), num(r.critRuntime), num(r.critType), num(r.laundered), num(r.passthrough), num(r.undeclConcept), num(r.undeclSymbol), num(r.declaredByRun), yn(r.complete), yn(r.transient), yn(r.surfaced), r.arm === "B" ? "—" : yn(r.delivered), money(r.cost), num(r.turns)]),
  ));
  P();
  const deliveredNotes: string[] = [];
  if (ARMS.includes("C")) deliveredNotes.push("C = treatment_delivered (a PreToolUse 'drift context' response occurred)");
  if (ARMS.includes("D")) deliveredNotes.push("D = d_delivered (consumer rule loaded on the main thread before the first src edit)");
  if (ARMS.includes("E")) deliveredNotes.push("E = e_delivered (all three rules loaded on the main thread at session_start, before the first assistant message)");
  P(`delivered: ${deliveredNotes.join("; ")}.`);
  P();

  P("## 2. Primary outcome: violation (S13)");
  P();
  P(`Per task × arm as x/${K} with exact Clopper–Pearson 95% intervals.`);
  P();
  P(table(["task", ...ARMS.map((a) => `${a} x/n`), ...ARMS.map((a) => `${a} 95% CI`)], TASKS.map((t) => {
    const cs = ARMS.map((a) => countOf(sel(rows, a, t), primary));
    return [t, ...cs.map((c) => frac(c.x, c.n)), ...cs.map((c) => { const [lo, hi] = clopperPearson(c.x, c.n); return `[${f2(lo)}, ${f2(hi)}]`; })];
  })));
  P();
  const manual = rows.filter((r) => r.manualReview);
  P("Pooled per arm (descriptive only; runs within a task share difficulty):");
  P();
  P(table(["arm", "violation x/n", "95% CI", "if manual-review runs count as violations"], ARMS.map((a) => {
    const c = countOf(sel(rows, a), primary);
    const [lo, hi] = clopperPearson(c.x, c.n);
    const alt = countOf(sel(rows, a), (r) => r.violation || r.manualReview);
    return [a, frac(c.x, c.n), `[${f2(lo)}, ${f2(hi)}]`, frac(alt.x, alt.n)];
  })));
  P();
  const reasons = (r: Row) => [...new Set(((sc(r.rec, "manual_review_reasons") ?? []) as any[]).map((x) => x.code))].join("+") || "NONLITERAL_IMPORT/UNRESOLVED";
  P(manual.length ? `Runs sent to blinded manual review (a production file with NONLITERAL_IMPORT, UNRESOLVED, UNSCANNED_TARGET, PRODUCTION_REACH_ESCAPE or REPOSITORY_SPLIT_TARGET), reported under both readings: ${manual.map((r) => `${r.id} (${r.task} ${r.arm}, scored ${yn(r.violation)}; ${reasons(r)})`).join(", ")}.` : "No run needed manual review.");
  P();

  P("## 3. Contrasts (descriptive)");
  P();
  P("Risk differences per task, and the Mantel–Haenszel pooled RD over tasks. The exact stratified (conditional CMH) p-value is shown for information and supports no claim.");
  P();
  const primaryContrasts = contrastBlock(rows, primary);
  P(table(["contrast", ...TASKS.map((t) => `${t} RD`), "MH pooled RD", "exact stratified p"], primaryContrasts.map((c) => [
    c.label,
    ...c.strata.map((s) => (s.n1 && s.n0 ? `${f2(s.a / s.n1 - s.c / s.n0)} (${s.a}/${s.n1} vs ${s.c}/${s.n0})` : "n/a")),
    c.rd === null ? "n/a" : f2(c.rd),
    c.p.toFixed(3),
  ])));
  P();

  P("## 4. Sensitivity analyses S1–S4");
  P();
  const s4drops = [["C", "C runs with treatment_delivered = false"], ["D", "D runs with D_RULE_NOT_LOADED"], ["E", "E runs with E_RULE_NOT_LOADED"]].filter(([a]) => ARMS.includes(a)).map(([, t]) => t);
  P(`S1 adds critical_type; S2 adds SERVICE_PASSTHROUGH; S3 adds TEST_REACH_IN and OUTSIDE_REACH_IN (all three from the scorer); S4 is per-protocol and drops ${s4drops.join(" and ")}.`);
  P();
  const s4rows = rows.filter((r) => !((r.arm === "C" || r.arm === "D" || r.arm === "E") && r.delivered === false));
  const variants: [string, Row[], (r: Row) => boolean | null][] = [
    ["primary", rows, primary], ["S1", rows, (r) => r.s1], ["S2", rows, (r) => r.s2], ["S3", rows, (r) => r.s3], ["S4", s4rows, primary],
  ];
  P(table(["task", "arm", ...variants.map((v) => v[0])], TASKS.flatMap((t) => ARMS.map((a) => [t, a, ...variants.map(([, rs, pk]) => cell(sel(rs, a, t), pk))]))));
  P();
  P(table(["arm (pooled)", ...variants.map((v) => v[0])], ARMS.map((a) => [a, ...variants.map(([, rs, pk]) => cell(sel(rs, a), pk))])));
  P();
  const dir = (x: number | null) => (x === null ? "n/a" : x > 0 ? "+" : x < 0 ? "−" : "0");
  const vc = variants.map(([name, rs, pk]) => ({ name, cs: contrastBlock(rs, pk) }));
  P(table(["contrast", ...vc.map((v) => `${v.name} MH RD`), "S1–S3 agree with primary"], CONTRASTS.map((_, i) => {
    const signs = vc.map((v) => dir(v.cs[i].rd));
    const agree = signs.slice(1, 4).every((s) => s === signs[0]);
    return [vc[0].cs[i].label, ...vc.map((v) => (v.cs[i].rd === null ? "n/a" : f2(v.cs[i].rd!))), signs.slice(1, 4).includes("n/a") ? "n/a" : agree ? "yes" : "no"];
  })));
  P();
  P("A qualitative conclusion stands only if S1–S3 agree in direction with the primary.");
  P();

  P("## 5. Mechanism (stream-derived, secondary)");
  P();
  const retraction = (a: string) => {
    const att = sel(rows, a).filter((r) => r.attempted === true);
    const tr = att.filter((r) => r.transient === true).length;
    return att.length ? `${tr}/${att.length}` : "n/a";
  };
  P(table(["arm", "attempted", "transient", "retraction (transient/attempted)", "spec_declares_exception", "surfaced", "replay_incomplete", "replay_desync"], ARMS.map((a) => {
    const rs = sel(rows, a);
    return [a, cell(rs, (r) => r.attempted), cell(rs, (r) => r.transient), retraction(a), cell(rs, (r) => r.specDeclaresException), cell(rs, (r) => r.surfaced), cell(rs, (r) => (r.proc ? bool(r.proc.replay_incomplete) : null)), cell(rs, (r) => (r.proc ? bool(r.proc.replay_desync) : null))];
  })));
  P();
  if (ARMS.includes("C")) {
    const cAtt = sel(rows, "C").filter((r) => r.attempted === true);
    const injectedFirst = cAtt.filter((r) => r.proc?.wyx_before_first_violation === true).length;
    const violatedFirst = cAtt.filter((r) => r.proc?.wyx_before_first_violation === false).length;
    P(`C only: of ${cAtt.length} C run(s) with an attempted violation, the first violating edit came before any injection in ${violatedFirst} (expected by construction: the PreToolUse context arrives with the tool result) and after one in ${injectedFirst}; a later edit removed the violation in ${cAtt.filter((r) => r.transient === true).length}.`);
    P();
  }
  const disagree = rows.filter((r) => r.proc && typeof r.proc.final_violation_replay === "boolean" && r.proc.final_violation_replay !== r.violation);
  P(disagree.length
    ? `Replay/scorer disagreement on the END verdict (scorer is authoritative): ${disagree.map((r) => `${r.id} (replay ${yn(r.proc.final_violation_replay)}, scorer ${yn(r.violation)}, replay_incomplete ${yn(bool(r.proc.replay_incomplete))})`).join(", ")}.`
    : `Replay final state agrees with the scorer's violation verdict in every run with replay output (${rows.filter((r) => r.proc).length}/${rows.length}).`);
  P();

  P("## 6. Delivery and isolation");
  P();
  const hookMiss = sel(rows, "C").filter((r) => r.pre?.hooks?.wyx_hook_miss === true).map((r) => r.id);
  const dNot = sel(rows, "D").filter((r) => r.delivered === false).map((r) => r.id);
  const eNot = sel(rows, "E").filter((r) => r.delivered === false).map((r) => r.id);
  const bRules = sel(rows, "B").filter((r) => (r.pre?.instr?.rule_loads ?? []).length > 0 || (r.pre?.failures ?? []).some((f: any) => f.code === "RULES_IN_INSTR" || f.code === "RULES_DIR_PRESENT" || f.code === "USER_RULES_LOADED")).map((r) => r.id);
  P(table(["item", "value"], [
    ["isolation_ok (preflight)", cell(rows, (r) => r.isolationOk)],
    ["batch_valid (preflight/batch.json)", ctx.batch ? String(ctx.batch.batch_valid) : "n/a (no batch.json)"],
    ...(ARMS.includes("C") ? [
      ["C treatment_delivered", cell(sel(rows, "C"), (r) => r.delivered)],
      ["C WYX_HOOK_MISS", hookMiss.length ? hookMiss.join(", ") : "none"],
    ] : []),
    ...(ARMS.includes("D") ? [
      ["D d_delivered", cell(sel(rows, "D"), (r) => r.delivered)],
      ["D D_RULE_NOT_LOADED", dNot.length ? dNot.join(", ") : "none"],
      ["D D_DELIVERY_UNVERIFIABLE (kept in S4)", sel(rows, "D").filter((r) => r.pre && r.delivered === null).map((r) => r.id).join(", ") || "none"],
    ] : []),
    ...(ARMS.includes("E") ? [
      ["E e_delivered", cell(sel(rows, "E"), (r) => r.delivered)],
      ["E E_RULE_NOT_LOADED", eNot.length ? eNot.join(", ") : "none"],
      ["E E_DELIVERY_UNVERIFIABLE (kept in S4)", sel(rows, "E").filter((r) => r.pre && r.delivered === null).map((r) => r.id).join(", ") || "none"],
      ["B runs with a .claude/rules load or directory", bRules.length ? bRules.join(", ") : "none"],
    ] : []),
    ["runs with preflight failures", rows.filter((r) => (r.pre?.failures ?? []).length > 0).map((r) => `${r.id} [${r.pre.failures.map((f: any) => f.code).join(",")}]`).join("; ") || "none"],
    ["runs without preflight output", rows.filter((r) => !r.pre).map((r) => r.id).join(", ") || "none"],
    ["runs without replay output", rows.filter((r) => !r.proc).map((r) => r.id).join(", ") || "none"],
  ]));
  P();

  P("## 7. Other secondary outcomes");
  P();
  const metric = (label: string, pick: (r: Row) => boolean | null): [string, (r: Row) => boolean | null] => [label, pick];
  const metrics = [
    metric("UNDECLARED_CONCEPT ≥1", (r) => (r.undeclConcept === null ? null : r.undeclConcept > 0)),
    metric("UNDECLARED_SYMBOL ≥1", (r) => (r.undeclSymbol === null ? null : r.undeclSymbol > 0)),
    metric("DECLARED_BY_RUN", (r) => (r.declaredByRun === null ? null : r.declaredByRun > 0)),
    metric("REPAIR_SWAP", (r) => (r.repairSwap === null ? null : r.repairSwap > 0)),
    metric("deps changed", (r) => r.depsChanged),
    metric("interactions changed", (r) => r.interactionsChanged),
    metric("complete", (r) => r.complete),
    metric("tsc_ok", (r) => r.tscOk),
    metric("transpile_ok", (r) => r.transpileOk),
    metric("REPO_CLONE", (r) => r.repoClone),
    metric("TABLE_SQL", (r) => r.tableSql),
    metric("bash write to src", (r) => (r.pre ? (r.pre.tools?.bash_write_cmds ?? []).length > 0 : null)),
    metric("subagent used", (r) => (r.pre ? r.pre.tools?.subagent_used === true : null)),
    metric("skill invoked", (r) => (r.pre ? (r.pre.tools?.skills_invoked ?? []).length > 0 : null)),
  ];
  const cells = TASKS.flatMap((t) => ARMS.map((a) => [t, a] as const));
  P(table(["metric", ...ARMS, ...cells.map(([t, a]) => `${t} ${a}`)], metrics.map(([label, pk]) => [label, ...ARMS.map((a) => cell(sel(rows, a), pk)), ...cells.map(([t, a]) => cell(sel(rows, a, t), pk))])));
  P();
  P("Completion per check, task × arm:");
  P();
  P(table(["task", "arm", "link", "c1", "c2", "c3", "c4", "complete"], TASKS.flatMap((t) => ARMS.map((a) => {
    const rs = sel(rows, a, t);
    return [t, a, ...["link", "c1", "c2", "c3", "c4"].map((c) => cell(rs, (r) => r.checks[c])), cell(rs, (r) => r.complete)];
  }))));
  P();
  const stat = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    if (!v.length) return "n/a";
    const s = [...v].sort((p, q) => p - q);
    return `mean ${(v.reduce((p, q) => p + q, 0) / v.length).toFixed(2)}, median ${s[Math.floor((s.length - 1) / 2)].toFixed(2)}`;
  };
  P(table(["arm", "cost (USD)", "turns", "duration (s)", "total cost"], ARMS.map((a) => {
    const rs = sel(rows, a);
    return [a, stat(rs.map((r) => r.cost)), stat(rs.map((r) => r.turns)), stat(rs.map((r) => (r.durationMs === null ? null : r.durationMs / 1000))), money(rs.reduce((p, r) => p + (r.cost ?? 0), 0))];
  })));
  P();

  if (p02) {
    decisionSection(rows, ctx, P, primary, manual);
    return out.join("\n");
  }
  P("## 8. Go/no-go for a main study");
  P();
  const isoAll = rows.length === ctx.expect && rows.every((r) => r.isolationOk === true) && (ctx.batch ? ctx.batch.batch_valid === true : false);
  const bTasks = TASKS.filter((t) => countOf(sel(rows, "B", t), primary).x >= 1).length;
  const bPooled = countOf(sel(rows, "B"), primary);
  const c2 = bTasks >= 2 && bPooled.x >= 3 && bPooled.x <= 8;
  const cellsOk = TASKS.every((t) => ARMS.every((a) => { const c = countOf(sel(rows, a, t), (r) => r.complete); return c.n > 0 && c.x / c.n >= 2 / 3 - 1e-9 && c.missing === 0; }));
  const c4 = manual.length === 0 && ctx.selftest.value === "pass";
  const conds: [string, boolean, string][] = [
    [`(1) isolation passes in ${ctx.expect}/${ctx.expect}`, isoAll, `${rows.filter((r) => r.isolationOk === true).length}/${ctx.expect} isolation_ok; batch_valid ${ctx.batch ? ctx.batch.batch_valid : "n/a"}`],
    ["(2) B violation ≥1/3 in at least 2 tasks and pooled B in [3/9, 8/9]", c2, `B ≥1/3 in ${bTasks} task(s); pooled B ${frac(bPooled.x, bPooled.n)}`],
    ["(3) completion ≥2/3 in every task×arm cell", cellsOk, TASKS.flatMap((t) => ARMS.map((a) => `${t}${a} ${cell(sel(rows, a, t), (r) => r.complete)}`)).join(", ")],
    ["(4) no manual adjudication and the selftest passes on the real trees", c4, `manual review ${manual.length}; selftest ${ctx.selftest.value} (${ctx.selftest.source})`],
  ];
  P(table(["condition", "met", "evidence"], conds.map(([c, ok, ev]) => [c, ok ? "yes" : "no", ev])));
  P();
  const go = conds.every((c) => c[1]);
  P(`**Verdict: ${go ? "GO" : "NO-GO"}**${go ? "" : ` (failed: ${conds.filter((c) => !c[1]).map((c) => c[0].slice(0, 3)).join(", ")})`}.`);
  P();
  const cPooled = countOf(sel(rows, "C"), primary);
  if (bPooled.x === 9 && cPooled.x === 9) { P("B is 9/9 and C is 9/9: the ownership lever is too strong; the main study should soften T1 (release framing) and repeat Stage-0."); P(); }
  if (bPooled.x <= 2) { P("B ≤2/9: the tasks need stronger levers, not more runs."); P(); }

  P("## 9. Main-study sizing");
  P();
  P(`Pre-registered: p_B = .60 vs p_C = .30, two-sided α .05, power .8 → ${runsPerArm(0.6, 0.3)} runs per arm (${Math.ceil(runsPerArm(0.6, 0.3)! / 3)} per task per arm across 3 tasks).`);
  const pB = bPooled.n ? bPooled.x / bPooled.n : NaN, pC = cPooled.n ? cPooled.x / cPooled.n : NaN;
  if (pB > pC) {
    const n = runsPerArm(pB, pC)!;
    P(`Recomputed with the observed pooled rates p_B = ${f2(pB)} and p_C = ${f2(pC)}: ${n} runs per arm, i.e. ${Math.max(5, Math.ceil(n / 3))} per task per arm (k ≥ 5 enforced). Recompute before registering the main study.`);
  } else {
    P(`Observed pooled p_B = ${Number.isNaN(pB) ? "n/a" : f2(pB)} is not above p_C = ${Number.isNaN(pC) ? "n/a" : f2(pC)}; no sizing follows from the pilot rates.`);
  }
  P();
  return out.join("\n");
}

/** Pilot-02 section 8: validity, then the pre-registered decision rule printed verbatim with its outcome. */
function decisionSection(rows: Row[], ctx: { expect: number; batch: any; selftest: { value: string; source: string } }, P: (s?: string) => void, primary: (r: Row) => boolean | null, manual: Row[]) {
  P("## 8. Pre-registered decision rule");
  P();
  const isoAll = rows.length === ctx.expect && rows.every((r) => r.isolationOk === true) && (ctx.batch ? ctx.batch.batch_valid === true : false);
  const eDel = countOf(sel(rows, "E"), (r) => r.delivered);
  P(table(["validity item", "value"], [
    ["isolation", `${rows.filter((r) => r.isolationOk === true).length}/${ctx.expect} isolation_ok; batch_valid ${ctx.batch ? ctx.batch.batch_valid : "n/a"}`],
    ["E delivered (all three rules at session_start before the first assistant message)", frac(eDel.x, eDel.n) + (eDel.missing ? ` (+${eDel.missing} unverifiable)` : "")],
    ["manual review", String(manual.length)],
    ["selftest", `${ctx.selftest.value} (${ctx.selftest.source})`],
  ]));
  P();
  P(`> ${DECISION_RULE_P02}`);
  P();
  const evaluate = (label: string, pick: (r: Row) => boolean | null) => {
    const t1E = countOf(sel(rows, "E", "T1"), pick), t1B = countOf(sel(rows, "B", "T1"), pick);
    const pE = countOf(sel(rows, "E"), pick), pB = countOf(sel(rows, "B"), pick);
    const d = decideP02(t1E, t1B, pE, pB);
    const counts = `T1 E ${frac(t1E.x, t1E.n)}, T1 B ${frac(t1B.x, t1B.n)}; pooled E ${frac(pE.x, pE.n)}, pooled B ${frac(pB.x, pB.n)}`;
    if (!d) return { label, counts, verdict: "NOT EVALUABLE (cells do not have the pre-registered 4 per T1 cell and 8 pooled)", promising: null as boolean | null };
    const clauses = `T1 clause (E <= 1/4 while B >= 3/4) ${d.t1 ? "met" : "not met"}; pooled clause (E <= B - 3) ${d.pooled ? "met" : "not met"}`;
    return { label, counts: `${counts}; ${clauses}`, verdict: d.promising ? "E IS PROMISING" : "NO DETECTABLE EFFECT (no delivery change is pursued; wyx stays advisory)", promising: d.promising };
  };
  const readings = [evaluate("primary (scorer verdict)", primary)];
  if (manual.length) readings.push(evaluate("manual-review runs counted as violations", (r) => r.violation || r.manualReview));
  P(table(["reading", "counts", "outcome"], readings.map((r) => [r.label, r.counts, r.verdict])));
  P();
  const robust = readings.every((r) => r.promising === readings[0].promising);
  P(`**Decision: ${readings[0].verdict}**${robust ? "" : " — not robust: the manual-review reading disagrees; the primary reading governs."}${isoAll ? "" : " The batch is not valid (isolation or batch_valid failed), so this outcome is not interpretable."}`);
  P();
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new UsageError(`unexpected argument: ${a}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[a.slice(2)] = "true";
    else { flags[a.slice(2)] = next; i++; }
  }
  return flags;
}

function main(): number {
  const flags = parseArgs(process.argv.slice(2));
  const E = flags["eval-root"] ?? process.env.EVAL_ROOT;
  const path = (flag: string, rel: string) => {
    const v = flags[flag] ?? (E ? join(E, rel) : null);
    if (!v) throw new UsageError(`missing --${flag} (or --eval-root)`);
    return v;
  };
  const recordsPath = path("records", "records.jsonl");
  const freezePath = flags["freeze-file"] ?? join(dirname(recordsPath), "records.sha256");
  const manifest = readJson(flags.manifest ?? (E ? join(E, "manifest.json") : "")) ?? {};
  let cfg;
  try { cfg = loadPilotConfig(manifest); } catch (e) { throw e instanceof ConfigError ? new UsageError(e.message) : e; }
  ARMS = cfg.arms; TASKS = cfg.tasks; CONTRASTS = cfg.contrasts; K = cfg.k ?? 3; PILOT = cfg.name; DECISION = cfg.decisionRule;
  if (DECISION !== null && DECISION !== "pilot-02") throw new UsageError(`unknown DECISION_RULE ${DECISION} in ${cfg.path}`);
  if (DECISION === "pilot-02") {
    const readme = join(cfg.dir, "README.md");
    if (!existsSync(readme) || !readFileSync(readme, "utf8").includes(DECISION_RULE_P02)) throw new UsageError(`${readme} does not contain the pre-registered decision rule verbatim; refusing to evaluate it`);
  }
  const expect = Number(flags.expect ?? (manifest.k && manifest.tasks && manifest.arms ? manifest.k * manifest.tasks.length * manifest.arms.length : K * TASKS.length * ARMS.length));

  const replaced = replacedIds(flags.key ?? (E ? join(E, "key", "key.csv") : ""));
  if (flags.freeze === "true") {
    const recs = readRecords(recordsPath).filter((r) => !replaced.has(r.run_id ?? r.id));
    const ids = recs.map((r) => r.run_id ?? r.id);
    if (new Set(ids).size !== ids.length) throw new UsageError("records.jsonl has duplicate run ids");
    if (recs.length !== expect) throw new UsageError(`records.jsonl has ${recs.length} rows, expected ${expect}`);
    const noViolation = recs.filter((r) => sc(r, "violation") === undefined || sc(r, "violation") === null).map((r) => r.run_id ?? r.id);
    if (noViolation.length) throw new UsageError(`records without score.violation: ${noViolation.join(",")}`);
    const sha = sha256(recordsPath);
    if (existsSync(freezePath)) {
      const prev = readFileSync(freezePath, "utf8").split(/\s+/)[0];
      if (prev !== sha) throw new UsageError(`records.jsonl changed after it was frozen (${prev} -> ${sha})`);
    } else {
      writeFileSync(freezePath, `${sha}  records.jsonl\n`);
    }
    console.log(`frozen ${recs.length} records: ${sha}`);
    return 0;
  }
  if (flags.unblind !== "true") throw new UsageError("refusing to join key.csv without --unblind (run --freeze first, after scoring is complete)");

  if (!existsSync(freezePath)) throw new UsageError(`scoring is not frozen: ${freezePath} missing (run --freeze)`);
  const frozenSha = readFileSync(freezePath, "utf8").split(/\s+/)[0];
  const recordsSha = sha256(recordsPath);
  if (frozenSha !== recordsSha) throw new UsageError(`records.jsonl sha256 ${recordsSha} differs from the frozen ${frozenSha}`);

  const allRecs = readRecords(recordsPath);
  const recs = allRecs.filter((r) => !replaced.has(r.run_id ?? r.id));
  const key = readKey(path("key", "key/key.csv"));
  for (const id of replaced) key.delete(id);
  if (recs.length !== expect) throw new UsageError(`${recs.length} scored runs after removing replaced originals, expected ${expect}`);
  const preDir = path("preflight", "preflight");
  const procDir = path("process", "process");
  const recIds = new Set(recs.map((r) => r.run_id ?? r.id));
  const missingRec = [...key.keys()].filter((id) => !recIds.has(id));
  const missingKey = [...recIds].filter((id) => !key.has(id));
  if (missingRec.length || missingKey.length) throw new UsageError(`key/records mismatch: no record for [${missingRec.join(",")}], no key row for [${missingKey.join(",")}]`);
  const rows = recs.map((r) => {
    const id = r.run_id ?? r.id;
    const k = key.get(id)!;
    const recTask = r.task ? String(r.task).slice(0, 2) : null;
    if (recTask && recTask !== k.task) throw new UsageError(`task mismatch for ${id}: record ${recTask}, key ${k.task}`);
    return toRow(r, k, readJson(join(preDir, `${id}.json`)), readJson(join(procDir, `${id}.json`)));
  });
  const selftest = flags.selftest
    ? { value: flags.selftest, source: "--selftest flag" }
    : manifest.selftest ? { value: manifest.selftest, source: "manifest.json (setup time)" } : { value: "unverified", source: "no evidence given" };
  const md = report(rows, { recordsSha, frozenSha, expect, batch: readJson(flags.batch ?? join(preDir, "batch.json")), selftest, replaced: [...replaced] });
  const outPath = flags.out ?? (E ? join(E, "report.md") : join(dirname(recordsPath), "report.md"));
  writeFileSync(outPath, `${md}\n`);
  console.log(outPath);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(e instanceof UsageError ? `${e.message}\n${USAGE}` : `analyze: could not complete: ${(e as Error).stack}`);
    process.exit(2);
  }
}
