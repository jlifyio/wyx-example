/**
 * Process-metric self-test driver (S14 replay, P4 preflight): runs score/replay.ts or score/preflight.ts on one
 * selftest/process/<case>/ and writes the record as JSON for selftest/assert.ts.
 *   bun selftest/process.ts <case-dir> <BASE> <END-dir> <tmp-dir> <out.json>
 * @RUN@ in stream.jsonl and instr.jsonl is replaced by a fixed, token-free run root that does not exist on disk (or by
 * expected.json run_root), @HOME@ by the user's home directory.
 * kind "cli" runs `bun score/<tool> <args...>` with PILOT_CONFIG = <pilot-01>/<config> and records its exit code and
 * first stderr line; it needs no stream.jsonl.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { replay } from "../score/replay.ts";
import { checkRun } from "../score/preflight.ts";

const [caseDir, base, end, tmp, out] = process.argv.slice(2);
if (!out) {
  console.error("usage: bun selftest/process.ts <case-dir> <BASE> <END-dir> <tmp-dir> <out.json>");
  process.exit(2);
}
const exp = JSON.parse(fs.readFileSync(path.join(caseDir, "expected.json"), "utf8"));
const RUN_ROOT: string = exp.run_root ?? "/pilot-selftest/runs/a1b2c3/shop";
const materialize = (name: string): string => {
  const src = path.join(caseDir, name);
  const dst = path.join(tmp, name);
  fs.writeFileSync(dst, fs.readFileSync(src, "utf8").replaceAll("@RUN@", RUN_ROOT).replaceAll("@HOME@", os.homedir()));
  return dst;
};
let rec: unknown;
if (exp.kind === "cli") {
  const pilot = path.join(import.meta.dir, "..");
  const env: Record<string, string | undefined> = { ...process.env, PILOT_CONFIG: path.resolve(pilot, exp.config) };
  delete env.EVAL_ROOT;
  const r = spawnSync("bun", [path.join(pilot, "score", exp.tool), ...exp.args], { env, encoding: "utf8" });
  rec = { exit_code: r.status, stderr_first_line: (r.stderr ?? "").split("\n")[0] };
} else if (exp.kind === "replay") {
  const stream = materialize("stream.jsonl");
  rec = replay({ id: path.basename(caseDir), stream, base, runPath: null, end, tmpRoot: tmp });
} else if (exp.kind === "preflight") {
  const stream = materialize("stream.jsonl");
  const instr = fs.existsSync(path.join(caseDir, "instr.jsonl")) ? materialize("instr.jsonl") : path.join(tmp, "absent.instr.jsonl");
  rec = checkRun({
    id: path.basename(caseDir), arm: exp.arm, task: exp.task, runPath: RUN_ROOT, stream, instr, base,
    rulesDir: null, ruleRef: { orders: "-", inventory: "-", payments: "-" },
    eRulesDir: null, eRuleRef: { orders: "-", inventory: "-", payments: "-" }, wyxPath: "", wyxVersion: "0.27.0",
    model: "claude-opus-5-5", ccVersion: "2.1.281", pluginRef: null, p3File: null, launchCmd: null,
    copyJson: null, homeRef: null, wyxTreeRef: null,
  });
} else {
  console.error(`unknown kind in ${caseDir}/expected.json: ${exp.kind}`);
  process.exit(2);
}
fs.writeFileSync(out, `${JSON.stringify(rec, null, 2)}\n`);
