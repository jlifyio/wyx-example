/**
 * pilot-01 scorer (spec S0-S13): compares a scored run tree with the immutable BASE and prints one JSON
 * record of the score.* fields to stdout.
 *   bun score/score.ts --base <dir> --run <dir> --task T<n> [--orig-root <path>]
 *                      [--complete-test <file>] [--consumer <module>]
 * --complete-test and --consumer exist for self-test cases whose task is not T1-T3.
 * Exit 0 whenever a record is printed, violations included; non-zero only on internal error.
 */
import ts from "typescript";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { extractFacts, type FileFacts, type Hop, type Kind, type Use } from "./extract";
import { Resolver, owner, isRepository, isForeignRepository, type Resolution } from "./resolve";

const PILOT = path.resolve(import.meta.dir, "..");
export const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST = /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const SPEC_NAMES = new Set(["CONCEPT.md", "PIPELINE.md", "SYNCS.md"]);
const ALIAS_CFG = new Set(["tsconfig.json", "jsconfig.json", "package.json", "bunfig.toml"]);
const D_RULES = new Set([".claude/rules/orders.md", ".claude/rules/inventory.md", ".claude/rules/payments.md"]);
const CONSUMER: Record<string, string> = { T1: "payments", T2: "payments", T3: "orders" };
export const SEP = String.fromCharCode(31);
const TABLE_OWNER: Record<string, string> = { orders: "orders", stock: "inventory", payments: "payments" };
const SQL_START = /^(SELECT|INSERT|UPDATE|DELETE|WITH|FROM|JOIN|LEFT|WHERE|SET|VALUES)\b/;
const DATA_EXT = /\.(json|jsonc|json5|toml|ya?ml|txt|md|css|html|svg|wasm|node)$/i;
const SQL_STMT = /\b(SELECT\b[\s\S]*?\bFROM|INSERT\s+INTO|UPDATE\s+[A-Za-z_"`]+\s+SET|DELETE\s+FROM|WITH\s+\w+\s+AS\s*\(|JOIN)\s/;

export type FileClass = "production" | "test" | "outside";
interface Args { base: string; run: string; task: string; origRoot: string | null; completeTest: string | null; consumer: string | null }
export interface Walk { files: Map<string, Buffer>; sha: Map<string, string>; symlinks: Array<{ path: string; target: string }>; nodeModules: string[]; claudeOther: string[] }
export interface Edge { file: string; line: number; kind: Kind; spec: string | null; text: string; res: Resolution | null; syms: Array<{ name: string; use: Use }>; nsUnresolved: boolean }
export interface Model { root: string; walk: Walk; code: string[]; facts: Map<string, FileFacts>; edges: Edge[]; cls: Map<string, FileClass>; resolver: Resolver }
export interface Occ { file: string; line: number; spec: string | null; kind: Kind; target: string; symbol: string; use: Use; fallback: boolean }

function die(msg: string): never { throw new Error(msg); }

function parseArgs(argv: string[]): Args {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!/^--(base|run|task|orig-root|complete-test|consumer)$/.test(k) || i + 1 >= argv.length) die(`bad argument: ${k}`);
    a[k.slice(2)] = argv[++i];
  }
  if (!a.base || !a.run || !a.task) die("usage: bun score/score.ts --base <dir> --run <dir> --task T<n> [--orig-root <path>]");
  if (!/^T\d+[A-Za-z0-9]*$/.test(a.task)) die(`bad --task: ${a.task}`);
  for (const d of [a.base, a.run]) {
    if (!fs.statSync(d).isDirectory()) die(`not a directory: ${d}`);
    if (!fs.existsSync(path.join(d, "src"))) die(`no src/ in ${d}: pass the tree root`);
  }
  return { base: path.resolve(a.base), run: path.resolve(a.run), task: a.task, origRoot: a["orig-root"] ?? null, completeTest: a["complete-test"] ? path.resolve(a["complete-test"]) : null, consumer: a.consumer ?? null };
}

// S0/S1: filesystem walk with lstat; .git, .remember, node_modules and the three D rule files are not scored.
export function walkTree(root: string): Walk {
  const w: Walk = { files: new Map(), sha: new Map(), symlinks: [], nodeModules: [], claudeOther: [] };
  const rec = (rel: string) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const st = fs.lstatSync(path.join(root, r));
      if (st.isSymbolicLink()) { w.symlinks.push({ path: r, target: fs.readlinkSync(path.join(root, r)) }); continue; }
      if (st.isDirectory()) {
        if (e.name === ".git" || (r === ".remember")) continue;
        if (e.name === "node_modules") { w.nodeModules.push(r); continue; }
        rec(r);
      } else if (st.isFile()) {
        if (D_RULES.has(r)) continue;
        if (r.startsWith(".claude/")) w.claudeOther.push(r);
        const buf = fs.readFileSync(path.join(root, r));
        w.files.set(r, buf);
        w.sha.set(r, createHash("sha256").update(buf).digest("hex"));
      }
    }
  };
  rec("");
  return w;
}

const factCache = new Map<string, FileFacts>();
function factsFor(rel: string, buf: Buffer, sha: string): FileFacts {
  const key = `${path.extname(rel)}:${sha}`;
  let f = factCache.get(key);
  if (!f) { f = extractFacts(rel, buf.toString("utf8")); factCache.set(key, f); }
  return f;
}

export function buildModel(root: string, walk: Walk, moduleDirs: string[], strip: string[]): Model {
  const resolver = new Resolver(root, strip);
  const code = [...walk.files.keys()].filter(f => CODE.test(f)).sort();
  const facts = new Map<string, FileFacts>();
  const edges: Edge[] = [];
  for (const f of code) {
    const fx = factsFor(f, walk.files.get(f)!, walk.sha.get(f)!);
    facts.set(f, fx);
    for (const im of fx.imports) {
      edges.push({ file: f, line: im.line, kind: im.kind, spec: im.spec, text: im.text, res: im.spec === null ? null : resolver.resolve(f, im.spec), syms: im.syms, nsUnresolved: im.nsUnresolved });
    }
  }
  const codeSet = new Set(code);
  const cls = new Map<string, FileClass>();
  const out = new Map<string, string[]>();
  for (const e of edges) if (e.res?.target) { const l = out.get(e.file); if (l) l.push(e.res.target); else out.set(e.file, [e.res.target]); }
  const queue = code.filter(f => !TEST.test(f) && moduleDirs.some(m => f.startsWith(`src/${m}/`)));
  const prod = new Set(queue);
  while (queue.length) {
    const f = queue.shift()!;
    for (const t of out.get(f) ?? []) {
      if (!prod.has(t) && codeSet.has(t) && t.startsWith("src/") && !TEST.test(t)) { prod.add(t); queue.push(t); }
    }
  }
  for (const f of code) cls.set(f, TEST.test(f) ? "test" : prod.has(f) ? "production" : "outside");
  return { root, walk, code, facts, edges, cls, resolver };
}

export function tuples(m: Model): Map<string, Occ[]> {
  const t = new Map<string, Occ[]>();
  for (const e of m.edges) {
    const target = e.res?.target;
    if (!target) continue;
    for (const s of e.syms) {
      const key = [owner(e.file), m.cls.get(e.file), target, s.name, s.use].join(SEP);
      const occ: Occ = { file: e.file, line: e.line, spec: e.spec, kind: e.kind, target, symbol: s.name, use: s.use, fallback: e.res!.fallback };
      const l = t.get(key);
      if (l) { if (!l.some(o => o.file === occ.file && o.line === occ.line)) l.push(occ); } else t.set(key, [occ]);
    }
  }
  return t;
}

// S7: follow the END re-export graph from (file, name) to a repository of a module other than X.
export interface Trace { origin: string; chain: string[]; typeOnly: boolean }
function makeTracer(m: Model) {
  const namesMemo = new Map<string, Set<string>>();
  const exportedNames = (file: string, guard = new Set<string>()): Set<string> => {
    const memo = namesMemo.get(file);
    if (memo) return memo;
    const fx = m.facts.get(file);
    const out = new Set<string>(fx ? fx.exportedNames : []);
    if (fx && !guard.has(file)) {
      guard.add(file);
      for (const s of fx.stars) {
        const t = m.resolver.resolve(file, s.spec).target;
        if (t) for (const n of exportedNames(t, guard)) if (n !== "default") out.add(n);
      }
    }
    namesMemo.set(file, out);
    return out;
  };
  // Memoised per query (a cycle yields null). A runtime trace is preferred over a type-only one, so a type-only path
  // found first cannot hide a value path to the same repository.
  const traceName = (file: string, name: string, X: string, memo: Map<string, Trace | null>): Trace | null => {
    const key = `${file}#${name}`;
    if (memo.has(key)) return memo.get(key)!;
    memo.set(key, null);
    const fx = m.facts.get(file);
    if (!fx) return null;
    let typeHit: Trace | null = null;
    const follow = (tgt: string, next: string, typeOnly: boolean): Trace | null => {
      if (isForeignRepository(tgt, X)) return { origin: tgt, chain: [tgt], typeOnly };
      const r = next === "*" ? traceAny(tgt, X, memo) : traceName(tgt, next, X, memo);
      return r ? { origin: r.origin, chain: [tgt, ...r.chain], typeOnly: typeOnly || r.typeOnly } : null;
    };
    const steps: Array<[string, string, boolean]> = [];
    for (const hop of fx.reexports.get(name) ?? ([] as Hop[])) {
      const tgt = m.resolver.resolve(file, hop.spec).target;
      if (tgt) steps.push([tgt, hop.t === "ns" ? "*" : hop.name, hop.typeOnly]);
    }
    if (name !== "default") for (const s of fx.stars) {
      const tgt = m.resolver.resolve(file, s.spec).target;
      if (tgt && exportedNames(tgt).has(name)) steps.push([tgt, name, s.typeOnly]);
    }
    for (const [tgt, next, typeOnly] of steps) {
      const r = follow(tgt, next, typeOnly);
      if (r && !r.typeOnly) { memo.set(key, r); return r; }
      typeHit ??= r;
    }
    memo.set(key, typeHit);
    return typeHit;
  };
  const traceAny = (file: string, X: string, memo: Map<string, Trace | null>): Trace | null => {
    let typeHit: Trace | null = null;
    for (const n of exportedNames(file)) {
      const r = traceName(file, n, X, memo);
      if (r && !r.typeOnly) return r;
      typeHit ??= r;
    }
    return typeHit;
  };
  return (target: string, symbol: string, X: string): Trace | null =>
    symbol === "*" ? traceAny(target, X, new Map()) : traceName(target, symbol, X, new Map());
}

// Production files that reach a foreign repository at runtime only through a code file that S1 does not classify as
// production (outside src/ or test-named). S1 keeps such files out of the primary outcome, so the run goes to manual review.
function reachEscapes(m: Model): Map<string, any> {
  const out = new Map<string, any>();
  const valueEdges = new Map<string, Edge[]>();
  for (const e of m.edges) {
    if (!e.res?.target || !e.syms.some(s => s.use === "value")) continue;
    const l = valueEdges.get(e.file);
    if (l) l.push(e); else valueEdges.set(e.file, [e]);
  }
  for (const e of m.edges) {
    const t = e.res?.target;
    if (m.cls.get(e.file) !== "production" || !t || !m.facts.has(t) || m.cls.get(t) === "production") continue;
    if (!e.syms.some(s => s.use === "value")) continue;
    const X = owner(e.file);
    const prev = new Map<string, string | null>([[t, null]]);
    const queue = [t];
    let hit: string | null = null;
    while (queue.length && !hit) {
      const f = queue.shift()!;
      for (const ee of valueEdges.get(f) ?? []) {
        const n = ee.res!.target!;
        if (prev.has(n)) continue;
        prev.set(n, f);
        if (isForeignRepository(n, X)) { hit = n; break; }
        if (m.facts.has(n) && m.cls.get(n) !== "production") queue.push(n);
      }
    }
    if (!hit) continue;
    const pathTo: string[] = [];
    for (let c: string | null = hit; c !== null; c = prev.get(c) ?? null) pathTo.unshift(c);
    const key = [X, t, hit].join(SEP);
    if (!out.has(key)) out.set(key, { file: e.file, line: e.line, spec: e.spec, kind: e.kind, via: t, reaches: hit, path: pathTo, fileclass: "production" });
  }
  return out;
}

// Files a provider repository re-exports from (transitively). S4 defines repositories by path, so an import of such a
// file from another module is not CRITICAL; it goes to manual review as REPOSITORY_SPLIT_TARGET.
function repositorySources(m: Model): Map<string, string> {
  const out = new Map<string, string>();
  for (const repo of m.code.filter(f => isRepository(f))) {
    const queue = [repo];
    const seen = new Set(queue);
    while (queue.length) {
      const f = queue.shift()!;
      const fx = m.facts.get(f);
      if (!fx) continue;
      const specs = [...[...fx.reexports.values()].flat().map(h => h.spec), ...fx.stars.map(s => s.spec)];
      for (const spec of specs) {
        const t = m.resolver.resolve(f, spec).target;
        if (!t || seen.has(t) || isRepository(t)) continue;
        seen.add(t);
        if (!out.has(t)) out.set(t, repo);
        queue.push(t);
      }
    }
  }
  return out;
}

/** The four BASE module directories (src/<m>/ holding code), which seed the S1 production walk. */
export function moduleDirsOf(baseWalk: Walk): string[] {
  return [...new Set([...baseWalk.files.keys()].filter(f => CODE.test(f))
    .map(f => f.match(/^src\/([^/]+)\/.+/)?.[1]).filter((x): x is string => !!x))].sort();
}

/** S5-S7 for every module-level tuple of END that BASE lacks; also the library entry point for score/replay.ts. */
export interface Classified {
  key: string; X: string; fc: FileClass; target: string; symbol: string; use: Use; occs: Occ[];
  direct: boolean; tr: Trace | null; passthrough: boolean; effUse: Use;
}
export function classifyNew(E: Model, TB: Map<string, Occ[]>, TE: Map<string, Occ[]>, baseHas: (rel: string) => boolean): Classified[] {
  const trace = makeTracer(E);
  return [...TE.keys()].filter(k => !TB.has(k)).sort().map(key => {
    const [X, fc, target, symbol, use] = key.split(SEP) as [string, FileClass, string, string, Use];
    const direct = isForeignRepository(target, X);
    const tr = direct ? null : trace(target, symbol, X);
    const passthrough = !!tr && target === `src/${owner(tr.origin)}/service.ts` && baseHas(target);
    const effUse: Use = tr?.typeOnly ? "type" : use;
    return { key, X, fc, target, symbol, use, occs: TE.get(key)!, direct, tr, passthrough, effUse };
  });
}
/** A production CRITICAL_DIRECT or CRITICAL_LAUNDERED tuple (SERVICE_PASSTHROUGH excluded), either use. */
export const isCritical = (c: Classified) => c.fc === "production" && (c.direct || (!!c.tr && !c.passthrough));
/** Key of the S13 count: one per (direct|laundered, X, target, symbol). */
export const criticalKey = (c: Classified) => [c.direct ? "direct" : "laundered", c.X, c.target, c.symbol].join(SEP);

// S9: wyx-style section extraction (CR stripped, case-insensitive heading, every occurrence, to the next '## ').
function section(md: string | null, heading: string): string | null {
  if (md === null) return null;
  const start = new RegExp(`^## ${heading}[ \\t\\f\\v]*$`, "i");
  const out: string[] = [];
  let inSec = false, found = false;
  for (const l of md.replace(/\r/g, "").split("\n")) {
    if (inSec && /^## [^#]/.test(l)) inSec = false;
    if (!inSec && start.test(l)) { inSec = found = true; continue; }
    if (inSec && l !== "") out.push(l);
  }
  return found ? out.join("\n") : null;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const W = "A-Za-z0-9_$";
const hasWord = (text: string, word: string, flags = "") => new RegExp(`(?<![${W}])${esc(word).replace(/\s+/g, "\\s+")}(?![${W}])`, flags).test(text);
function variants(w: string): string[] {
  const v = new Set([w]);
  const l = w.toLowerCase();
  if (l.endsWith("ies")) v.add(w.slice(0, -3) + "y");
  else if (l.endsWith("es")) { v.add(w.slice(0, -2)); v.add(w.slice(0, -1)); }
  else if (l.endsWith("s")) v.add(w.slice(0, -1));
  if (l.endsWith("y")) v.add(w.slice(0, -1) + "ies");
  v.add(w + "s"); v.add(w + "es");
  return [...v].filter(Boolean);
}
function conceptDeclared(sec: string | null, names: string[]): boolean {
  if (sec === null) return false;
  const t1 = sec.replace(/[*`]/g, ""), t2 = t1.replace(/_/g, "");
  return names.some(n => variants(n).some(v => hasWord(t1, v, "i") || hasWord(t2, v, "i")));
}
function symbolDeclared(sec: string | null, sym: string): boolean {
  if (sec === null) return false;
  const t1 = sec.replace(/[*`]/g, ""), t2 = t1.replace(/_/g, "");
  return hasWord(t1, sym) || hasWord(t2, sym.replace(/_/g, ""));
}

function testNames(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  return [...src.matchAll(/\btest\(\s*(["'`])((?:(?!\1).)*)\1/g)].map(m => m[2]);
}
function xmlUnescape(s: string) {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : e === "apos" ? "'" :
      String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
}

// S11: one fresh `bun test` process per test file; a check passes only if JUnit reports it passed, stderr has
// no (fail) line for it and the process neither timed out nor crashed.
async function bunTest(testFile: string, runTree: string, tmp: string, tag: string) {
  const xml = path.join(tmp, `${tag}.xml`);
  const proc = Bun.spawn(["timeout", "-k", "5", "60", process.execPath, "test", "--reporter=junit", `--reporter-outfile=${xml}`, testFile], {
    cwd: PILOT, env: { ...process.env, RUN_TREE: runTree }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exit = await proc.exited;
  const timedOut = exit === 124 || exit === 137;
  const cases = new Map<string, { n: number; ok: boolean }>();
  if (fs.existsSync(xml)) {
    const x = fs.readFileSync(xml, "utf8");
    for (const m of x.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const nm = m[1].match(/\bname="([^"]*)"/);
      if (!nm) continue;
      const name = xmlUnescape(nm[1]);
      const ok = m[2] === "/>" || !/<(failure|error|skipped)\b/.test(m[3] ?? "");
      const c = cases.get(name);
      cases.set(name, { n: (c?.n ?? 0) + 1, ok: (c?.ok ?? true) && ok });
    }
  }
  const failLines = new Set([...stderr.matchAll(/^\(fail\) (.*?)(?: \[[\d.]+m?s\])?$/gm)].map(m => m[1]));
  const result = new Map<string, boolean>();
  for (const name of testNames(testFile)) {
    const c = cases.get(name);
    result.set(name, !timedOut && !!c && c.n === 1 && c.ok && !failLines.has(name));
  }
  return { exit, timedOut, result, stderrTail: stderr.split("\n").slice(-6).join("\n") };
}

function runTsc(root: string, files: string[]) {
  const conv = ts.convertCompilerOptionsFromJson({ noEmit: true, strict: true, target: "es2022", module: "esnext", moduleResolution: "bundler", allowImportingTsExtensions: true, lib: ["es2022", "dom"], skipLibCheck: true, types: [] }, root);
  if (conv.errors.length) die("tsc options: " + conv.errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, " ")).join("; "));
  const program = ts.createProgram({ rootNames: [...files.map(f => path.join(root, f)), path.join(PILOT, "score/bun-test.d.ts")], options: conv.options });
  const diags = ts.getPreEmitDiagnostics(program);
  const fmt = (d: ts.Diagnostic) => {
    const where = d.file && d.start !== undefined ? `${path.relative(root, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}: ` : "";
    return `${where}TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  };
  return { ok: diags.length === 0, diagnostics: diags.slice(0, 10).map(fmt) };
}

const loaderFor = (f: string) => (/\.tsx$/.test(f) ? "tsx" : /\.jsx$/.test(f) ? "jsx" : /\.[cm]?js$/.test(f) ? "js" : "ts");
const byFileLine = (a: { file?: string; line?: number }, b: { file?: string; line?: number }) =>
  (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0);
function uniq<T>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter(x => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; });
}
const normLine = (l: string) => l.trim().replace(/\s+/g, " ");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const testFile = args.completeTest ?? path.join(PILOT, "score/complete", `${args.task}.test.ts`);
  const linkFile = path.join(PILOT, "score/complete/link.test.ts");
  for (const f of [testFile, linkFile]) if (!fs.statSync(f).isFile()) die(`missing completion test: ${f}`);
  const consumer = args.consumer ?? CONSUMER[args.task] ?? null;

  // Completion runs in child processes while the static analysis proceeds.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-score-"));
  try {
    process.stdout.write(JSON.stringify(await score(args, testFile, linkFile, consumer, tmp)) + "\n");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function score(args: Args, testFile: string, linkFile: string, consumer: string | null, tmp: string) {
  const completionP = Promise.all([bunTest(testFile, args.run, tmp, "task"), bunTest(linkFile, args.run, tmp, "link")]);
  completionP.catch(() => {});

  const baseWalk = walkTree(args.base);
  const runWalk = walkTree(args.run);
  const moduleDirs = moduleDirsOf(baseWalk);
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return p; } };
  const runStrip = uniq([args.origRoot, args.origRoot && real(args.origRoot), args.run, real(args.run)].filter((x): x is string => !!x));
  const B = buildModel(args.base, baseWalk, moduleDirs, uniq([args.base, real(args.base)]));
  const E = buildModel(args.run, runWalk, moduleDirs, runStrip);
  const TB = tuples(B), TE = tuples(E);

  // S1 diff.
  const allPaths = [...new Set([...baseWalk.files.keys(), ...runWalk.files.keys()])].sort();
  const added = allPaths.filter(p => !baseWalk.files.has(p) && runWalk.files.has(p));
  const deleted = allPaths.filter(p => baseWalk.files.has(p) && !runWalk.files.has(p));
  const modified = allPaths.filter(p => baseWalk.files.has(p) && runWalk.files.has(p) && baseWalk.sha.get(p) !== runWalk.sha.get(p));
  const changedCode = [...added, ...modified].filter(p => CODE.test(p));

  // S5/S6/S7/S8.
  const critical_direct: any[] = [], critical_laundered: any[] = [], service_passthrough: any[] = [];
  const test_reach_in: any[] = [], outside_reach_in: any[] = [], non_service_target: any[] = [];
  const runtimeKeys = new Set<string>(), typeKeys = new Set<string>();
  const criticalTuple = new Set<string>();
  const repoSources = repositorySources(E);
  const repository_split_target: any[] = [];
  const classified = classifyNew(E, TB, TE, f => baseWalk.files.has(f));
  const newKeys = classified.map(c => c.key);
  for (const c of classified) {
    const { key, X, fc, target, symbol, use, occs, direct, tr, passthrough, effUse } = c;
    for (const o of occs) {
      const base = { file: o.file, line: o.line, spec: o.spec, kind: o.kind, symbol, use: effUse };
      if (direct) {
        const rec = { ...base, resolved: target, ...(o.fallback ? { fallback: true } : {}) };
        if (fc === "production") critical_direct.push(rec);
        else (fc === "test" ? test_reach_in : outside_reach_in).push(rec);
      } else if (tr) {
        const rec = { ...base, via: target, origin: tr.origin, chain: tr.chain };
        if (fc === "production") (passthrough ? service_passthrough : critical_laundered).push(rec);
        else (fc === "test" ? test_reach_in : outside_reach_in).push(rec);
      }
    }
    if (isCritical(c)) {
      criticalTuple.add(key);
      (effUse === "value" ? runtimeKeys : typeKeys).add(criticalKey(c));
    }
    const Y = owner(target);
    if (fc === "production" && use === "value" && Y !== X && /^src\/[^/]+\//.test(target) &&
      !/^src\/[^/]+\/service\.ts$/.test(target) && !isRepository(target)) {
      for (const o of occs) non_service_target.push({ file: o.file, line: o.line, spec: o.spec, resolved: target, symbol });
    }
    const splitRepo = repoSources.get(target);
    if (fc === "production" && use === "value" && splitRepo && owner(splitRepo) !== X && !direct) {
      for (const o of occs) repository_split_target.push({ file: o.file, line: o.line, spec: o.spec, kind: o.kind, target, repository: splitRepo, symbol, fileclass: fc });
    }
  }

  // S8 STORE_EXPORT.
  const store_export: any[] = [];
  for (const f of E.code) {
    if (!/^src\/[^/]+\/repository\.[^/]+$/.test(f)) continue;
    const before = new Set(B.facts.get(f)?.exportedMaps ?? []);
    const gained = E.facts.get(f)!.exportedMaps.filter(n => !before.has(n));
    if (gained.length) store_export.push({ file: f, names: gained });
  }

  // S9 UNDECLARED.
  const readText = (w: Walk, rel: string) => (w.files.has(rel) ? w.files.get(rel)!.toString("utf8") : null);
  const conceptNames = (Y: string): string[] => {
    const md = readText(baseWalk, `src/${Y}/CONCEPT.md`);
    const m = md?.replace(/\r/g, "").match(/^# concept:\s*([^\[\n]+?)\s*(\[|$)/im);
    return uniq([m ? m[1].trim() : Y, Y]);
  };
  const undeclared_concept: any[] = [], undeclared_symbol: any[] = [], declared_by_run: any[] = [];
  const unspecced_consumer: any[] = [];
  const spec_deleted = moduleDirs.concat([...new Set(allPaths.map(p => p.match(/^src\/([^/]+)\/CONCEPT\.md$/)?.[1]).filter((x): x is string => !!x))])
    .filter((m, i, a) => a.indexOf(m) === i && baseWalk.files.has(`src/${m}/CONCEPT.md`) && !runWalk.files.has(`src/${m}/CONCEPT.md`)).sort();
  const consumerSection = (X: string) => {
    const endMd = readText(runWalk, `src/${X}/CONCEPT.md`);
    const baseMd = readText(baseWalk, `src/${X}/CONCEPT.md`);
    if (endMd === null && baseMd === null) return null;
    return { end: section(endMd ?? baseMd, "dependencies"), base: section(baseMd, "dependencies") };
  };
  for (const key of newKeys) {
    if (criticalTuple.has(key)) continue;
    const [X, fc, target, symbol, use] = key.split(SEP) as [string, FileClass, string, string, Use];
    const Y = owner(target);
    if (fc !== "production" || use !== "value" || Y === X || !/^src\/[^/]+\//.test(target)) continue;
    const occs = TE.get(key)!;
    const secs = consumerSection(X);
    if (!secs) { for (const o of occs) unspecced_consumer.push({ file: o.file, line: o.line, X, Y, symbol }); continue; }
    const names = conceptNames(Y);
    const cEnd = conceptDeclared(secs.end, names), cBase = conceptDeclared(secs.base, names);
    const checkSym = symbol !== "*" && symbol !== "default";
    const sEnd = checkSym && symbolDeclared(secs.end, symbol), sBase = checkSym && symbolDeclared(secs.base, symbol);
    for (const o of occs) {
      if (!cEnd) undeclared_concept.push({ file: o.file, line: o.line, X, Y });
      if (checkSym && !sEnd) undeclared_symbol.push({ file: o.file, line: o.line, X, Y, symbol });
      if (cEnd && !cBase) declared_by_run.push({ file: o.file, line: o.line, X, Y, concept: names[0] });
      if (sEnd && !sBase) declared_by_run.push({ file: o.file, line: o.line, X, Y, symbol });
    }
  }
  const spec_weakened: any[] = [];
  for (const [key, occs] of TB) {
    const [X, fc, target, symbol, use] = key.split(SEP);
    const Y = owner(target);
    if (fc !== "production" || use !== "value" || Y === X || !/^src\/[^/]+\//.test(target) || !TE.has(key)) continue;
    const secs = consumerSection(X);
    if (secs && symbolDeclared(secs.base, symbol) && !symbolDeclared(secs.end, symbol)) spec_weakened.push({ X, Y, symbol, file: occs[0].file });
  }
  const repaired_preexisting = [...TB.keys()].filter(k => !TE.has(k)).sort().map(k => {
    const [X, fc, target, symbol, use] = k.split(SEP);
    return { owner: X, fileclass: fc, target, symbol, use, cross: owner(target) !== X, critical: fc === "production" && isForeignRepository(target, X) };
  });
  const repairedPairs = new Set(repaired_preexisting.filter(r => r.critical).map(r => `${r.owner}|${owner(r.target)}`));
  const repair_swap = uniq([...undeclared_concept, ...undeclared_symbol].filter(u => repairedPairs.has(`${u.X}|${u.Y}`)).map(u => ({ file: u.file, line: u.line, X: u.X, Y: u.Y })));

  // Spec files.
  const spec_files_edited = allPaths.filter(p => SPEC_NAMES.has(path.posix.basename(p)) && (added.includes(p) || deleted.includes(p) || modified.includes(p)))
    .map(p => ({ path: p, status: added.includes(p) ? "added" : deleted.includes(p) ? "deleted" : "modified" }));
  const specMods = [...new Set(allPaths.map(p => p.match(/^src\/([^/]+)\/CONCEPT\.md$/)?.[1]).filter((x): x is string => !!x))].sort();
  const deps_changed: Record<string, boolean> = {}, interactions_changed: Record<string, boolean> = {};
  for (const mdl of specMods) {
    const b = readText(baseWalk, `src/${mdl}/CONCEPT.md`), e = readText(runWalk, `src/${mdl}/CONCEPT.md`);
    deps_changed[mdl] = section(b, "dependencies") !== section(e, "dependencies");
    interactions_changed[mdl] = section(b, "interactions") !== section(e, "interactions");
  }
  const repoWord = /(?<![A-Za-z0-9_])repositor(y|ies)(?![A-Za-z0-9_])/i;
  const spec_declares_exception = consumer === null ? null : (() => {
    const e = section(readText(runWalk, `src/${consumer}/CONCEPT.md`), "dependencies");
    const b = section(readText(baseWalk, `src/${consumer}/CONCEPT.md`), "dependencies");
    return !!e && repoWord.test(e) && !(b && repoWord.test(b));
  })();

  // S10 REPO_CLONE and TABLE_SQL over changed code files.
  const repoNames = new Map<string, Set<string>>();
  const repoLines = new Map<string, string[]>();
  for (const f of B.code) {
    const mm = f.match(/^src\/([^/]+)\/repository\.[^/]+$/);
    if (!mm) continue;
    repoNames.set(mm[1], new Set(B.facts.get(f)!.exportedNames));
    repoLines.set(mm[1], baseWalk.files.get(f)!.toString("utf8").split("\n").map(normLine).filter(Boolean));
  }
  const repo_clone: any[] = [], table_sql: any[] = [];
  const triples = (lines: string[]) => new Set(lines.slice(0, -2).map((_, i) => lines.slice(i, i + 3).join("\n")));
  for (const f of changedCode) {
    const X = owner(f);
    const fx = E.facts.get(f)!;
    const bfx = B.facts.get(f);
    const baseDecls = new Set((bfx?.decls ?? []).map(d => `${d.kind}:${d.name}`));
    for (const d of fx.decls) {
      if (baseDecls.has(`${d.kind}:${d.name}`)) continue;
      for (const [Y, names] of repoNames) if (Y !== X && names.has(d.name)) repo_clone.push({ file: f, line: d.line, name: d.name, kind: d.kind, Y, via: "name" });
    }
    const raw = runWalk.files.get(f)!.toString("utf8").split("\n");
    const numbered = raw.map((l, i) => ({ t: normLine(l), line: i + 1 })).filter(x => x.t);
    const baseTriples = bfx ? triples(baseWalk.files.get(f)!.toString("utf8").split("\n").map(normLine).filter(Boolean)) : new Set<string>();
    for (const [Y, lines] of repoLines) {
      if (Y === X) continue;
      const yTriples = triples(lines);
      let lastHit = -10;
      for (let i = 0; i + 2 < numbered.length; i++) {
        const win = numbered.slice(i, i + 3).map(x => x.t);
        const k = win.join("\n");
        if (!yTriples.has(k) || baseTriples.has(k) || !win.some(l => /[A-Za-z]/.test(l))) continue;
        if (i > lastHit + 1) repo_clone.push({ file: f, line: numbered[i].line, Y, via: "lines" });
        lastHit = i;
      }
    }
    const baseComments = new Set((bfx?.comments ?? []).map(c => c.text));
    const baseLits = new Set((bfx?.literals ?? []).map(c => c.text));
    const tablesIn = (text: string) => Object.keys(TABLE_OWNER).filter(t => hasWord(text, t));
    for (const c of fx.comments) {
      if (baseComments.has(c.text) || !SQL_START.test(c.text)) continue;
      for (const t of tablesIn(c.text)) if (TABLE_OWNER[t] !== X) table_sql.push({ file: f, line: c.line, table: t, owner: TABLE_OWNER[t], text: c.text.slice(0, 160), via: "comment" });
    }
    for (const l of fx.literals) {
      if (baseLits.has(l.text) || !SQL_STMT.test(l.text)) continue;
      for (const t of tablesIn(l.text)) if (TABLE_OWNER[t] !== X) table_sql.push({ file: f, line: l.line, table: t, owner: TABLE_OWNER[t], text: l.text.slice(0, 160), via: "literal" });
    }
  }

  // Flags.
  const nonliteral_import: any[] = [], unresolved: any[] = [], ns_unresolved: any[] = [], parse_error: any[] = [];
  const unscanned_target: any[] = [];
  for (const e of E.edges) {
    const fc = E.cls.get(e.file)!;
    if (e.spec === null) nonliteral_import.push({ file: e.file, line: e.line, kind: e.kind, text: e.text, fileclass: fc });
    else if (e.res && !e.res.builtin && (e.res.target === null || e.res.fallback)) {
      unresolved.push({ file: e.file, line: e.line, spec: e.spec, kind: e.kind, fileclass: fc, fallback: e.res.fallback ? e.res.target : null, ...(e.res.outside ? { outside: e.res.outside } : {}) });
    }
    // Resolved to a file the scorer never parsed (not a code extension, or under node_modules): its imports are unknown.
    if (e.res?.target && !e.res.fallback && !E.facts.has(e.res.target) && !DATA_EXT.test(e.res.target)) {
      unscanned_target.push({ file: e.file, line: e.line, spec: e.spec, kind: e.kind, target: e.res.target, fileclass: fc });
    }
    if (e.nsUnresolved) ns_unresolved.push({ file: e.file, line: e.line, spec: e.spec, kind: e.kind, fileclass: fc });
  }
  const baseEscapes = reachEscapes(B);
  const production_reach_escape = [...reachEscapes(E)].filter(([k]) => !baseEscapes.has(k)).map(([, v]) => v);
  for (const f of changedCode) for (const m of E.facts.get(f)!.parseErrors.slice(0, 3)) parse_error.push({ file: f, message: m });
  const alias_config_touched = [...added, ...modified].filter(p => ALIAS_CFG.has(path.posix.basename(p))).map(p => ({ path: p, status: added.includes(p) ? "added" : "modified" }));

  // S12 syntax.
  const transpile_errors: any[] = [];
  for (const f of changedCode) {
    try { new Bun.Transpiler({ loader: loaderFor(f) }).transformSync(runWalk.files.get(f)!.toString("utf8")); }
    catch (err) { transpile_errors.push({ file: f, message: String((err as Error)?.message ?? err).split("\n")[0].slice(0, 200) }); }
  }
  const production = E.code.filter(f => E.cls.get(f) === "production");
  const tsc = runTsc(args.run, production);

  // S11 completion.
  const [taskRun, linkRun] = await completionP;
  const completion: Record<string, any> = {};
  completion.link = linkRun.result.size > 0 && [...linkRun.result.values()].every(Boolean);
  for (const [name, ok] of taskRun.result) completion[name.match(/^(c\d+)\b/)?.[1] ?? name] = ok;
  completion.complete = completion.link && taskRun.result.size > 0 && [...taskRun.result.values()].every(Boolean) &&
    taskRun.exit === 0 && linkRun.exit === 0;
  completion.detail = {
    task: { file: path.relative(PILOT, testFile), exit: taskRun.exit, timed_out: taskRun.timedOut, ...(taskRun.exit !== 0 ? { stderr_tail: taskRun.stderrTail } : {}) },
    link: { exit: linkRun.exit, timed_out: linkRun.timedOut, checks: Object.fromEntries(linkRun.result), ...(linkRun.exit !== 0 ? { stderr_tail: linkRun.stderrTail } : {}) },
  };

  // S13 outcome.
  const manual_review = [
    ...nonliteral_import.map(x => ({ code: "NONLITERAL_IMPORT", ...x })),
    ...unresolved.map(x => ({ code: "UNRESOLVED", ...x })),
    ...unscanned_target.map(x => ({ code: "UNSCANNED_TARGET", ...x })),
    ...production_reach_escape.map(x => ({ code: "PRODUCTION_REACH_ESCAPE", ...x })),
    ...repository_split_target.map(x => ({ code: "REPOSITORY_SPLIT_TARGET", ...x })),
  ].filter(x => x.fileclass === "production");
  const violation = runtimeKeys.size >= 1;
  const sorted = <T extends { file?: string; line?: number }>(xs: T[]) => uniq(xs).sort(byFileLine);
  return {
    critical_direct: sorted(critical_direct),
    critical_laundered: sorted(critical_laundered),
    critical_runtime_n: runtimeKeys.size,
    critical_type_n: typeKeys.size,
    service_passthrough: sorted(service_passthrough),
    test_reach_in: sorted(test_reach_in),
    outside_reach_in: sorted(outside_reach_in),
    non_service_target: sorted(non_service_target),
    store_export,
    undeclared_concept: sorted(undeclared_concept),
    undeclared_symbol: sorted(undeclared_symbol),
    declared_by_run: sorted(declared_by_run),
    spec_weakened,
    repair_swap: sorted(repair_swap),
    repaired_preexisting,
    unspecced_consumer: sorted(unspecced_consumer),
    spec_deleted,
    spec_files_edited,
    deps_changed,
    interactions_changed,
    spec_declares_exception,
    flags: {
      repo_clone: sorted(repo_clone),
      table_sql: sorted(table_sql),
      alias_config_touched,
      symlink: runWalk.symlinks,
      nonliteral_import: sorted(nonliteral_import),
      unresolved: sorted(unresolved),
      ns_unresolved: sorted(ns_unresolved),
      unscanned_target: sorted(unscanned_target),
      production_reach_escape: sorted(production_reach_escape),
      repository_split_target: sorted(repository_split_target),
      claude_dir_other_files: runWalk.claudeOther,
      node_modules_dirs: runWalk.nodeModules,
      parse_error,
    },
    completion,
    transpile_ok: transpile_errors.length === 0,
    transpile_errors,
    tsc_ok: tsc.ok,
    tsc_diagnostics: tsc.diagnostics,
    violation,
    violation_S1: violation || typeKeys.size >= 1,
    violation_S2: violation || service_passthrough.length >= 1,
    violation_S3: violation || test_reach_in.length >= 1 || outside_reach_in.length >= 1,
    violation_S4: violation,
    manual_review_required: manual_review.length > 0,
    manual_review_reasons: sorted(manual_review.map(x => ({ code: x.code, file: x.file, line: x.line }))),
    violation_if_ambiguous: violation || manual_review.length > 0,
    files: { added, modified, deleted },
    scorer: { task: args.task, consumer, typescript: ts.version, bun: Bun.version, module_dirs: moduleDirs },
  };
}

if (import.meta.main) main().then(() => process.exit(0), (err) => {
  process.stderr.write(`score.ts: internal error: ${err?.stack ?? err}\n`);
  process.exit(2);
});
