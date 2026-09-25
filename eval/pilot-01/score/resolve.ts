/**
 * Specifier resolution (S3) and ownership (S4) for the pilot-01 scorer. Every specifier resolves to an
 * existing file of the tree (relative, absolute with the run-root prefix stripped, tsconfig/jsconfig paths
 * and baseUrl, package.json "imports"), with a repository-name fallback for specifiers left unresolved.
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

const EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const JS_TO_TS: Record<string, string> = { ".js": ".ts", ".jsx": ".tsx", ".mjs": ".mts", ".cjs": ".cts" };
const REPO_FALLBACK = /(^|\/)(orders|inventory|payments|notifications)\/repository(\.[cm]?[jt]sx?)?$/;
const BUILTINS = new Set(builtinModules.flatMap(m => [m, `node:${m}`]));

export interface Resolution {
  target: string | null;
  builtin: boolean;
  fallback: boolean;
  outside: string | null;
}

export const owner = (rel: string): string => {
  const m = rel.match(/^src\/([^/]+)\//);
  if (m) return m[1];
  return /^src\/[^/]+$/.test(rel) ? "src-root" : "outside";
};
export const isRepository = (rel: string): boolean => /^src\/[^/]+\/repository(\.[^/]*|\/.+)$/.test(rel);
export const isForeignRepository = (rel: string, importerOwner: string): boolean =>
  isRepository(rel) && owner(rel) !== importerOwner;

export function isBuiltin(spec: string): boolean {
  return spec.startsWith("node:") || spec.startsWith("bun:") || spec === "bun" || BUILTINS.has(spec);
}

interface Cfg { paths: Array<[string, string[]]>; pathsBase: string; baseUrl: string | null }

export class Resolver {
  readonly realRoot: string;
  private cache = new Map<string, Resolution>();
  private cfgCache = new Map<string, Cfg | null>();
  private pkgCache = new Map<string, Record<string, unknown> | null>();

  constructor(readonly root: string, private stripPrefixes: string[]) {
    this.realRoot = fs.realpathSync(root);
  }

  private abs(rel: string) { return path.join(this.root, rel); }

  /** Tree-relative canonical path of an existing regular file (symlinks followed), or null. */
  private file(rel: string): { rel: string | null; outside: string | null } {
    if (rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) return { rel: null, outside: null };
    let st: fs.Stats;
    try { st = fs.statSync(this.abs(rel)); } catch { return { rel: null, outside: null }; }
    if (!st.isFile()) return { rel: null, outside: null };
    const real = fs.realpathSync(this.abs(rel));
    const r = path.relative(this.realRoot, real);
    if (r.startsWith("..") || path.isAbsolute(r)) return { rel: null, outside: real };
    return { rel: r.split(path.sep).join("/"), outside: null };
  }

  private tryCandidates(cand: string): { rel: string | null; outside: string | null } {
    const c = path.posix.normalize(cand).replace(/\/$/, "");
    const list = [c, ...EXTS.map(e => c + e), ...EXTS.map(e => `${c}/index${e}`)];
    const ext = path.posix.extname(c);
    if (JS_TO_TS[ext]) list.push(c.slice(0, -ext.length) + JS_TO_TS[ext]);
    let outside: string | null = null;
    for (const f of list) {
      const r = this.file(f);
      if (r.rel) return r;
      outside ??= r.outside;
    }
    return { rel: null, outside };
  }

  private nearest(fromDir: string, names: string[]): string | null {
    let d = fromDir;
    for (;;) {
      for (const n of names) {
        const rel = d === "." ? n : `${d}/${n}`;
        try { if (fs.lstatSync(this.abs(rel)).isFile()) return rel; } catch { /* absent */ }
      }
      if (d === "." || d === "") return null;
      d = path.posix.dirname(d);
    }
  }

  private loadCfg(rel: string, depth = 0): Cfg | null {
    const key = `${rel}#${depth}`;
    if (this.cfgCache.has(key)) return this.cfgCache.get(key)!;
    let out: Cfg | null = null;
    const read = ts.readConfigFile(this.abs(rel), p => fs.readFileSync(p, "utf8"));
    if (read.config && typeof read.config === "object") {
      const dir = path.posix.dirname(rel);
      let inherited: Cfg | null = null;
      const ext = read.config.extends;
      const exts = typeof ext === "string" ? [ext] : Array.isArray(ext) ? ext.filter((e: unknown) => typeof e === "string") : [];
      if (depth < 3) for (const e of exts) {
        if (!e.startsWith(".")) continue;
        let p = path.posix.normalize(path.posix.join(dir, e));
        if (!p.endsWith(".json") && !this.file(p).rel) p += ".json";
        if (this.file(p).rel) inherited = this.loadCfg(p, depth + 1) ?? inherited;
      }
      const co = read.config.compilerOptions ?? {};
      out = { paths: inherited?.paths ?? [], pathsBase: inherited?.pathsBase ?? dir, baseUrl: inherited?.baseUrl ?? null };
      if (typeof co.baseUrl === "string") out.baseUrl = path.posix.normalize(path.posix.join(dir, co.baseUrl));
      if (co.paths && typeof co.paths === "object") {
        out.paths = Object.entries(co.paths).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).filter(x => typeof x === "string") as string[]]);
        out.pathsBase = out.baseUrl ?? dir;
      } else if (out.baseUrl) {
        out.pathsBase = out.baseUrl;
      }
    }
    this.cfgCache.set(key, out);
    return out;
  }

  private loadPkgImports(rel: string): Record<string, unknown> | null {
    if (this.pkgCache.has(rel)) return this.pkgCache.get(rel)!;
    let out: Record<string, unknown> | null = null;
    try {
      const j = JSON.parse(fs.readFileSync(this.abs(rel), "utf8"));
      if (j && typeof j.imports === "object" && j.imports) out = j.imports;
    } catch { out = null; }
    this.pkgCache.set(rel, out);
    return out;
  }

  private static match(pattern: string, spec: string): string | null {
    const star = pattern.indexOf("*");
    if (star < 0) return pattern === spec ? "" : null;
    const pre = pattern.slice(0, star), post = pattern.slice(star + 1);
    if (spec.length >= pre.length + post.length && spec.startsWith(pre) && spec.endsWith(post)) return spec.slice(pre.length, spec.length - post.length);
    return null;
  }

  private static condTarget(v: unknown): string | null {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) { for (const x of v) { const t = Resolver.condTarget(x); if (t) return t; } return null; }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of ["bun", "import", "module", "node", "default", "require"]) if (k in o) { const t = Resolver.condTarget(o[k]); if (t) return t; }
    }
    return null;
  }

  resolve(importer: string, spec: string): Resolution {
    const dir = path.posix.dirname(importer);
    const key = `${dir}\0${spec}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const res = this.resolveUncached(dir, spec);
    this.cache.set(key, res);
    return res;
  }

  private resolveUncached(dir: string, spec: string): Resolution {
    if (isBuiltin(spec)) return { target: null, builtin: true, fallback: false, outside: null };
    const cands: string[] = [];
    let s = spec.startsWith("#") ? spec : spec.replace(/[?#].*$/, "");
    if (s.startsWith("file://")) s = s.slice("file://".length);
    if (s === "." || s === ".." || s.startsWith("./") || s.startsWith("../")) {
      cands.push(path.posix.join(dir, s));
    } else if (s.startsWith("/")) {
      for (const p of this.stripPrefixes) {
        const pre = p.replace(/\/+$/, "") + "/";
        if (s.startsWith(pre)) { cands.push(s.slice(pre.length)); break; }
      }
    } else {
      const cfgRel = this.nearest(dir, ["tsconfig.json", "jsconfig.json"]);
      const cfg = cfgRel ? this.loadCfg(cfgRel) : null;
      if (cfg) {
        const ranked = cfg.paths
          .map(([pat, tg]) => ({ pat, tg, cap: Resolver.match(pat, s) }))
          .filter(x => x.cap !== null)
          .sort((a, b) => b.pat.indexOf("*") - a.pat.indexOf("*"));
        for (const r of ranked) for (const t of r.tg) cands.push(path.posix.join(cfg.pathsBase, t.replace("*", r.cap!)));
      }
      if (s.startsWith("#")) {
        const pkgRel = this.nearest(dir, ["package.json"]);
        const imports = pkgRel ? this.loadPkgImports(pkgRel) : null;
        if (imports) for (const [pat, v] of Object.entries(imports)) {
          const cap = Resolver.match(pat, s);
          const t = Resolver.condTarget(v);
          if (cap !== null && t) cands.push(path.posix.join(path.posix.dirname(pkgRel!), t.replace("*", cap)));
        }
      }
      if (cfg?.baseUrl) cands.push(path.posix.join(cfg.baseUrl, s));
    }
    let outside: string | null = null;
    for (const c of cands) {
      const r = this.tryCandidates(c);
      if (r.rel) return { target: r.rel, builtin: false, fallback: false, outside: null };
      outside ??= r.outside;
    }
    const norm = path.posix.normalize(s);
    const m = norm.match(REPO_FALLBACK);
    if (m) {
      const base = `src/${m[2]}/repository`;
      const r = this.tryCandidates(base);
      return { target: r.rel ?? `${base}.ts`, builtin: false, fallback: true, outside };
    }
    return { target: null, builtin: false, fallback: false, outside };
  }
}
