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
const SRC_TOKEN_RE = /(^|[\s'"=(\/])src(\/|\s|$|['";&|)])/;
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
