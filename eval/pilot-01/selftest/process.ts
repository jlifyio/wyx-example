/**
 * Process-metric self-test driver (S14 replay, P4 preflight): runs score/replay.ts or score/preflight.ts on one
 * selftest/process/<case>/ and writes the record as JSON for selftest/assert.ts.
 *   bun selftest/process.ts <case-dir> <BASE> <END-dir> <tmp-dir> <out.json>
 * @RUN@ in stream.jsonl and instr.jsonl is replaced by a fixed, token-free run root that does not exist on disk.
 */
import fs from "node:fs";
import path from "node:path";
import { replay } from "../score/replay.ts";
import { checkRun } from "../score/preflight.ts";

const RUN_ROOT = "/pilot-selftest/runs/a1b2c3/shop";
const [caseDir, base, end, tmp, out] = process.argv.slice(2);
if (!out) {
  console.error("usage: bun selftest/process.ts <case-dir> <BASE> <END-dir> <tmp-dir> <out.json>");
  process.exit(2);
}
const exp = JSON.parse(fs.readFileSync(path.join(caseDir, "expected.json"), "utf8"));
const materialize = (name: string): string => {
  const src = path.join(caseDir, name);
  const dst = path.join(tmp, name);
  fs.writeFileSync(dst, fs.readFileSync(src, "utf8").replaceAll("@RUN@", RUN_ROOT));
  return dst;
};
const stream = materialize("stream.jsonl");
let rec: unknown;
if (exp.kind === "replay") {
  rec = replay({ id: path.basename(caseDir), stream, base, runPath: null, end, tmpRoot: tmp });
} else if (exp.kind === "preflight") {
  const instr = fs.existsSync(path.join(caseDir, "instr.jsonl")) ? materialize("instr.jsonl") : path.join(tmp, "absent.instr.jsonl");
  rec = checkRun({
    id: path.basename(caseDir), arm: exp.arm, task: exp.task, runPath: RUN_ROOT, stream, instr, base,
    rulesDir: null, ruleRef: { orders: "-", inventory: "-", payments: "-" }, wyxPath: "", wyxVersion: "0.27.0",
    model: "claude-opus-5-5", ccVersion: "2.1.281", pluginRef: null, p3File: null, launchCmd: null,
    copyJson: null, homeRef: null, wyxTreeRef: null,
  });
} else {
  console.error(`unknown kind in ${caseDir}/expected.json: ${exp.kind}`);
  process.exit(2);
}
fs.writeFileSync(out, `${JSON.stringify(rec, null, 2)}\n`);
