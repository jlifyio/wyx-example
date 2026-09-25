// Shared stream-json reader for preflight.ts and replay.ts: events, tool calls, hook responses, wyx tokens, Bash write detection.
import { readFileSync } from "node:fs";
import { isAbsolute, join, normalize, relative } from "node:path";

export const WYX_TOKENS = {
  pre: "wyx drift context:",
  post: "wyx post-edit check:",
  session: "wyx artifacts:",
} as const;

export const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
export const SUBAGENT_TOOLS = new Set(["Task", "Agent", "Workflow"]);
export const INERT_RE = /\.(json|jsonl|lock|log|txt)$/;
export const CODE_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
export const SPEC_RE = /(^|\/)(CONCEPT|PIPELINE|SYNCS)\.md$/;
export const MODULES = ["orders", "inventory", "payments", "notifications"] as const;
export const SPECCED_MODULES = ["orders", "inventory", "payments"] as const;

export interface Parsed {
  events: any[];
  errors: { line: number; message: string }[];
}

export function readJsonl(path: string): Parsed {
  const text = readFileSync(path, "utf8");
  const events: any[] = [];
  const errors: { line: number; message: string }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    try {
      const ev = JSON.parse(line);
      ev.__idx = events.length;
      ev.__line = i + 1;
      events.push(ev);
    } catch (e) {
      errors.push({ line: i + 1, message: (e as Error).message });
    }
  }
  return { events, errors };
}

export interface ToolCall {
  id: string;
  name: string;
  input: any;
  parent: string | null;
  useIdx: number;
  useTs: string | null;
  /** First stream event of the assistant message that holds this tool_use: the model wrote the call after seeing only
   * what preceded it (sibling calls of one message run while later siblings are still being streamed). */
  msgStartIdx: number;
  msgStartTs: string | null;
  resultIdx: number | null;
  resultTs: string | null;
  isError: boolean | null;
  resultText: string;
  structured: any;
  denied: boolean;
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c?.text === "string" ? c.text : "")).join("\n");
  }
  return "";
}

export function toolCalls(events: any[]): ToolCall[] {
  const calls: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();
  const msgStart = new Map<string, any>();
  for (const ev of events) {
    const mid = ev.type === "assistant" ? ev.message?.id : undefined;
    if (typeof mid === "string" && !msgStart.has(mid)) msgStart.set(mid, ev);
  }
  for (const ev of events) {
    if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
      for (const block of ev.message.content) {
        if (block?.type !== "tool_use") continue;
        const start = typeof ev.message?.id === "string" ? msgStart.get(ev.message.id) ?? ev : ev;
        const call: ToolCall = {
          id: block.id,
          name: block.name,
          input: block.input ?? {},
          parent: ev.parent_tool_use_id ?? null,
          useIdx: ev.__idx,
          useTs: ev.timestamp ?? null,
          msgStartIdx: start.__idx,
          msgStartTs: start.timestamp ?? null,
          resultIdx: null,
          resultTs: null,
          isError: null,
          resultText: "",
          structured: null,
          denied: false,
        };
        calls.push(call);
        byId.set(call.id, call);
      }
    } else if (ev.type === "user" && Array.isArray(ev.message?.content)) {
      const results = ev.message.content.filter((b: any) => b?.type === "tool_result");
      for (const r of results) {
        const call = byId.get(r.tool_use_id);
        if (!call) continue;
        call.resultIdx = ev.__idx;
        call.resultTs = ev.timestamp ?? null;
        call.isError = r.is_error === true;
        call.resultText = resultText(r.content);
        if (results.length === 1) call.structured = ev.tool_use_result ?? null;
      }
    } else if (ev.type === "system" && ev.subtype === "permission_denied") {
      const call = byId.get(ev.tool_use_id);
      if (call) call.denied = true;
    }
  }
  return calls;
}

export function succeeded(c: ToolCall): boolean {
  return c.resultIdx !== null && c.isError === false;
}

export interface HookEv {
  idx: number;
  subtype: string;
  event: string;
  name: string;
  text: string;
}

/** hook_response events; text is stdout plus output so JSON-wrapped payloads still match. */
export function hookResponses(events: any[]): HookEv[] {
  return events
    .filter((e) => e.type === "system" && e.subtype === "hook_response")
    .map((e) => ({
      idx: e.__idx,
      subtype: e.subtype,
      event: e.hook_event ?? "",
      name: e.hook_name ?? "",
      text: `${e.stdout ?? ""}\n${e.output ?? ""}`,
    }));
}

export function selectOne(events: any[], type: string, subtype?: string) {
  const hits = events.filter((e) => e.type === type && (subtype === undefined || e.subtype === subtype));
  return { event: hits.length === 1 ? hits[0] : null, count: hits.length };
}

export function inputPath(input: any): string | null {
  const p = input?.file_path ?? input?.notebook_path ?? null;
  return typeof p === "string" ? p : null;
}

/** Path relative to root, or null when it lies outside root. */
export function toRel(path: string, root: string): string | null {
  const abs = isAbsolute(path) ? normalize(path) : normalize(join(root, path));
  const rel = relative(normalize(root), abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel;
}

const HEREDOC_BODY_RE = /(<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2[^\n]*)\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g;
const REDIRECT_RE = /(?:^|[^>=\-])\d*>>?(?![&=>])\s*("[^"]*"|'[^']*'|[^\s|&;<>]+)/g;
export const SRC_TOKEN_RE = /(^|[\s'"=(\/])src(\/|\s|$|['";&|)])/;
const BASH_WRITE_OPS: [string, RegExp][] = [
  ["tee", /(^|[\s;&|(])tee(\s|$)/],
  ["sed -i", /(^|[\s;&|(])sed(\s[^|;&]*)?\s(-[a-zA-Z]*i|--in-place)/],
  ["perl -i", /(^|[\s;&|(])perl(\s[^|;&]*)?\s-[a-zA-Z]*i/],
  ["cp", /(^|[\s;&|(])cp\s/],
  ["mv", /(^|[\s;&|(])mv\s/],
  ["ln", /(^|[\s;&|(])ln\s/],
  ["patch", /(^|[\s;&|(])patch(\s|$)/],
  ["git apply|checkout|stash", /(^|[\s;&|(])git\s+(-C\s+\S+\s+)?(apply|checkout|stash)(\s|$)/],
  ["awk -i inplace", /(^|[\s;&|(])awk\s[^|;&]*-i\s*inplace/],
];

/**
 * One S14 replay_incomplete trigger: the write operators a Bash command uses when it also touches src/.
 * Heredoc bodies are ignored; redirections count only when their target is a file (not /dev/null or an fd duplication).
 */
export function bashSrcWriteOps(command: string): string[] {
  const cmd = command.replace(HEREDOC_BODY_RE, "$1");
  if (!SRC_TOKEN_RE.test(cmd)) return [];
  const ops: string[] = [];
  for (const m of cmd.matchAll(REDIRECT_RE)) {
    const target = m[1].replace(/^["']|["']$/g, "");
    if (target !== "/dev/null" && !/^&?\d+$/.test(target)) {
      ops.push(m[0].includes(">>") ? ">>" : ">");
      break;
    }
  }
  for (const [name, re] of BASH_WRITE_OPS) if (re.test(cmd)) ops.push(name);
  return ops;
}

export function isoToEpoch(ts: string | null): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : t / 1000;
}

// ------------------------------------------------------------------------------------------------
// Shell words: enough of sh to name the files a simple command deletes or writes. Anything dynamic stays marked so
// callers can refuse to resolve it.
// ------------------------------------------------------------------------------------------------

/** One shell word with quotes removed; expand: holds $ or ` expansion; glob: holds an unquoted * ? or [. */
export interface Word { text: string; expand: boolean; glob: boolean }
export interface Segment { words: Word[]; redirects: { op: string; target: Word }[]; afterCd: boolean }

const CD_WORDS = new Set(["cd", "pushd", "popd"]);
const PREFIX_WORDS = new Set(["command", "sudo", "nohup", "time"]);

/**
 * Simple commands of a Bash command line, split on ; & | && || ( ) and newlines outside quotes; heredoc bodies dropped.
 * afterCd: an earlier simple command of the same line changed the working directory.
 */
export function shellSegments(command: string): Segment[] {
  const cmd = command.replace(HEREDOC_BODY_RE, "$1");
  const segs: Segment[] = [];
  let seg: Segment = { words: [], redirects: [], afterCd: false };
  let w: Word | null = null;
  let redirOp: string | null = null;
  let cdSeen = false;
  const cur = () => (w ??= { text: "", expand: false, glob: false });
  const push = () => {
    if (w && redirOp) seg.redirects.push({ op: redirOp, target: w });
    else if (w) seg.words.push(w);
    if (w) redirOp = null;
    w = null;
  };
  const end = () => {
    push();
    redirOp = null;
    if (seg.words.length || seg.redirects.length) {
      seg.afterCd = cdSeen;
      segs.push(seg);
      if (CD_WORDS.has(commandWords(seg)[0]?.text ?? "")) cdSeen = true;
    }
    seg = { words: [], redirects: [], afterCd: false };
  };
  // Consumes a $(...), ${...} or `...` expansion starting at i into the current word; returns the last index consumed.
  const expansion = (i: number): number => {
    const word = cur();
    word.expand = true;
    if (cmd[i] === "`") {
      const j = cmd.indexOf("`", i + 1);
      const k = j < 0 ? cmd.length - 1 : j;
      word.text += cmd.slice(i, k + 1);
      return k;
    }
    const open = cmd[i + 1];
    if (open !== "(" && open !== "{") { word.text += "$"; return i; }
    const close = open === "(" ? ")" : "}";
    let depth = 0, j = i + 1;
    for (; j < cmd.length; j++) {
      if (cmd[j] === open) depth++;
      else if (cmd[j] === close && --depth === 0) break;
    }
    word.text += cmd.slice(i, j + 1);
    return j;
  };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === "'") {
      const j = cmd.indexOf("'", i + 1);
      const k = j < 0 ? cmd.length : j;
      cur().text += cmd.slice(i + 1, k);
      i = k;
    } else if (ch === '"') {
      const word = cur();
      let j = i + 1;
      for (; j < cmd.length && cmd[j] !== '"'; j++) {
        if (cmd[j] === "\\" && j + 1 < cmd.length) { word.text += cmd[++j]; continue; }
        if (cmd[j] === "$" || cmd[j] === "`") word.expand = true;
        word.text += cmd[j];
      }
      i = j;
    } else if (ch === "\\") {
      if (cmd[i + 1] !== "\n") cur().text += cmd[i + 1] ?? "";
      i++;
    } else if (ch === "$" || ch === "`") {
      i = expansion(i);
    } else if (ch === ">" || ch === "<" || (ch === "&" && cmd[i + 1] === ">")) {
      // A word of digits right before the operator is its fd, not an argument.
      if (w && /^\d+$/.test((w as Word).text) && !/\s/.test(cmd[i - 1] ?? " ")) w = null;
      else push();
      const m = cmd.slice(i).match(/^(&>>?|>>|>\||>&|>|<<<|<<-?|<>|<&|<)/)!;
      redirOp = m[1];
      i += m[1].length - 1;
    } else if (ch === " " || ch === "\t") {
      push();
    } else if (ch === "\n" || ch === ";" || ch === "&" || ch === "|" || ch === "(" || ch === ")") {
      end();
    } else {
      if (ch === "*" || ch === "?" || ch === "[") cur().glob = true;
      cur().text += ch;
    }
  }
  end();
  return segs;
}

/** The words from the command name on: leading VAR=value assignments and command/sudo/nohup/time are skipped. */
export function commandWords(seg: Segment): Word[] {
  let i = 0;
  while (i < seg.words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(seg.words[i].text) || PREFIX_WORDS.has(seg.words[i].text))) i++;
  return seg.words.slice(i);
}

/** True when a simple command of this line changes the working directory (cd, pushd, popd). */
export function bashChangesCwd(command: string): boolean {
  return shellSegments(command).some((s) => CD_WORDS.has(commandWords(s)[0]?.text ?? ""));
}

const REMOVE_TEXT_RE = /(^|[\s;&|(])(rm|unlink|git\s+rm)(\s|$)|\s-delete(\s|$)/;

/**
 * A deletion one simple command performs. paths: the operands as written (globs unexpanded); find: the -name/-type
 * filter of a `find PATH... -delete`; unresolved: why the deleted paths cannot be named statically.
 */
export interface BashDelete {
  op: string;
  paths: Word[];
  recursive: boolean;
  find: { name: string | null; type: string | null } | null;
  afterCd: boolean;
  unresolved: string | null;
}

/** Deletions in a Bash command: rm, unlink, git rm (not --cached) and find ... -delete; other forms are unresolved. */
export function bashDeletes(command: string): BashDelete[] {
  const out: BashDelete[] = [];
  for (const seg of shellSegments(command)) {
    const words = commandWords(seg);
    const name = words[0]?.text ?? "";
    const base = { paths: [] as Word[], recursive: false, find: null, afterCd: seg.afterCd, unresolved: null as string | null };
    const operands = (from: number) => {
      const opts: string[] = [];
      const paths: Word[] = [];
      let ddash = false;
      for (const x of words.slice(from)) {
        if (!ddash && x.text === "--") ddash = true;
        else if (!ddash && x.text.startsWith("-") && x.text.length > 1) opts.push(x.text);
        else paths.push(x);
      }
      return { opts, paths };
    };
    if (name === "rm" || name === "unlink") {
      const { opts, paths } = operands(1);
      out.push({ ...base, op: name, paths, recursive: opts.some((o) => /^-[a-zA-Z]*[rR]/.test(o) || o === "--recursive") });
    } else if (name === "git" && words.slice(1).some((x) => x.text === "rm")) {
      const at = words.findIndex((x) => x.text === "rm");
      if (at !== 1) { out.push({ ...base, op: "git rm", unresolved: "git option before rm" }); continue; }
      const { opts, paths } = operands(2);
      if (opts.includes("--cached")) continue;
      out.push({ ...base, op: "git rm", paths, recursive: opts.some((o) => /^-[a-zA-Z]*r/.test(o)) });
    } else if (name === "find" && words.some((x) => x.text === "-delete")) {
      const paths: Word[] = [];
      let i = 1;
      for (; i < words.length && !/^[-(!]/.test(words[i].text); i++) paths.push(words[i]);
      const filt = { name: null as string | null, type: null as string | null };
      let unresolved: string | null = null;
      for (; i < words.length; i++) {
        const t = words[i].text;
        if (t === "-delete") continue;
        if ((t === "-name" || t === "-type") && words[i + 1] && !words[i + 1].expand) filt[t === "-name" ? "name" : "type"] = words[++i].text;
        else { unresolved = `find ${t}`; break; }
      }
      if (filt.type !== null && filt.type !== "f" && filt.type !== "d") unresolved = `find -type ${filt.type}`;
      out.push({ ...base, op: "find -delete", paths: paths.length ? paths : [{ text: ".", expand: false, glob: false }], recursive: true, find: filt, unresolved });
    } else if (words.some((x) => REMOVE_TEXT_RE.test(` ${x.text} `)) && name !== "echo" && name !== "printf") {
      // rm reached through another program (xargs rm, find -exec rm, sh -c "rm ...", eval).
      out.push({ ...base, op: name, unresolved: `deletion through ${name}` });
    }
  }
  return out;
}

/**
 * A file write one simple command performs, for the "bash write to src" count. target: the written path as a word, or
 * null when the operator writes files it does not name (patch, git apply/stash, a write run by find -exec or xargs).
 */
export interface BashWrite { op: string; target: Word | null; afterCd: boolean }

const WRITE_CMDS = new Set(["tee", "sed", "perl", "awk", "cp", "mv", "ln", "install", "patch"]);

export function bashWrites(command: string): BashWrite[] {
  const out: BashWrite[] = [];
  for (const seg of shellSegments(command)) {
    const add = (op: string, target: Word | null) => out.push({ op, target, afterCd: seg.afterCd });
    for (const r of seg.redirects) {
      if (/^(>|>>|>\||&>|&>>)$/.test(r.op) && !(r.target.text === "/dev/null" && !r.target.expand)) add(r.op.replace("&", ""), r.target);
    }
    const words = commandWords(seg);
    const name = words[0]?.text ?? "";
    const args = words.slice(1);
    const nonOpt = args.filter((x) => !(x.text.startsWith("-") && x.text.length > 1));
    const inPlace = (name === "sed" && args.some((x) => /^(-[a-zA-Z]*i|--in-place)/.test(x.text)))
      || (name === "perl" && args.some((x) => /^-[a-zA-Z]*i/.test(x.text)))
      || (name === "awk" && args.some((x, i) => x.text === "inplace" && args[i - 1]?.text === "-i"));
    if (name === "tee") for (const x of nonOpt) add("tee", x);
    else if (inPlace) for (const x of nonOpt) add(`${name} -i`, x);
    else if (name === "cp" || name === "mv" || name === "ln" || name === "install") {
      const t = args.findIndex((x) => x.text === "-t" || x.text === "--target-directory");
      if (t >= 0 && args[t + 1]) add(name, args[t + 1]);
      else if (nonOpt.length >= 2) add(name, nonOpt[nonOpt.length - 1]);
    } else if (name === "patch") add("patch", null);
    else if (name === "git") {
      const sub = args.findIndex((x) => /^(apply|checkout|stash)$/.test(x.text));
      if (sub < 0) continue;
      if (args[sub].text !== "checkout" || sub !== 0) { add(`git ${args[sub].text}`, null); continue; }
      const rest = args.slice(sub + 1).filter((x) => !(x.text.startsWith("-") && x.text.length > 1));
      if (rest.length) for (const x of rest) add("git checkout", x);
      else add("git checkout", null);
    } else if ((name === "find" || name === "xargs") && args.some((x) => WRITE_CMDS.has(x.text))) {
      add(`${name} ${args.find((x) => WRITE_CMDS.has(x.text))!.text}`, null);
    }
  }
  return out;
}

/**
 * Run-relative path a word names: undefined when it cannot be resolved statically (an expansion, a ~ path, a relative
 * path when the working directory is unknown, or a glob unless allowGlob), null when it lies outside root or is root
 * itself. A glob comes back as a run-relative pattern.
 */
export function wordRel(w: Word, root: string, cwdKnown: boolean, allowGlob = false): string | null | undefined {
  if (w.expand || w.text === "" || w.text.startsWith("~") || (w.glob && !allowGlob)) return undefined;
  if (!isAbsolute(w.text) && !cwdKnown) return undefined;
  return toRel(w.text, root);
}
