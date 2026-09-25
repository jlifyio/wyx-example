/**
 * Pilot config selection for the score/*.ts tools: PILOT_CONFIG names the config.env of the pilot being analysed
 * (default: pilot-01's ../config.env), mirroring run/lib.sh load_config. When a manifest.json is given, the config must be
 * the one setup recorded (sha256) and agree with its k, tasks and arms; a manifest from before config recording is
 * accepted only with the default config.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const DEFAULT_CONFIG = join(import.meta.dir, "..", "config.env");
const PILOT01_CONTRASTS: [string, string][] = [["C", "B"], ["C", "D"], ["D", "B"]];

export interface PilotConfig {
  path: string;
  dir: string;
  values: Record<string, string>;
  name: string;
  arms: string[];
  tasks: string[];
  k: number | null;
  contrasts: [string, string][];
  decisionRule: string | null;
}

export class ConfigError extends Error {}

/** KEY=VALUE lines with optional surrounding quotes; shell expressions are kept verbatim and not evaluated. */
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const words = (v: string | undefined) => (v ?? "").split(/\s+/).filter(Boolean);

export function loadPilotConfig(manifest: Record<string, any> = {}): PilotConfig {
  const selected = process.env.PILOT_CONFIG || DEFAULT_CONFIG;
  const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
  const path = real(selected);
  const values = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
  if (!existsSync(path) && process.env.PILOT_CONFIG) throw new ConfigError(`PILOT_CONFIG ${selected} does not exist`);
  const hasManifest = Object.keys(manifest).length > 0;
  if (hasManifest) {
    const want = manifest.config?.sha256;
    if (want) {
      const got = existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "missing";
      if (got !== want) throw new ConfigError(`selected config ${path} (sha256 ${got}) is not the one setup recorded (${manifest.config.path}, ${want}); set PILOT_CONFIG to it`);
    } else if (path !== real(DEFAULT_CONFIG)) {
      throw new ConfigError(`manifest.json records no config, so only the default ${DEFAULT_CONFIG} may be selected (got ${path})`);
    }
  }
  const arms = words(values.ARMS);
  const tasks = words(values.TASKS);
  const k = values.K ? Number(values.K) : null;
  if (hasManifest && existsSync(path)) {
    const same = (a: unknown, b: string[]) => Array.isArray(a) && a.join(" ") === b.join(" ");
    if (manifest.arms && !same(manifest.arms, arms)) throw new ConfigError(`config ARMS '${arms.join(" ")}' differs from manifest arms '${manifest.arms.join(" ")}'`);
    if (manifest.tasks && !same(manifest.tasks, tasks)) throw new ConfigError(`config TASKS '${tasks.join(" ")}' differs from manifest tasks '${manifest.tasks.join(" ")}'`);
    if (manifest.k !== undefined && manifest.k !== k) throw new ConfigError(`config K=${k} differs from manifest k=${manifest.k}`);
  }
  let contrasts = PILOT01_CONTRASTS;
  if (values.CONTRASTS) {
    contrasts = words(values.CONTRASTS).map((c) => {
      const m = c.match(/^([A-Z])-([A-Z])$/);
      if (!m || !arms.includes(m[1]) || !arms.includes(m[2])) throw new ConfigError(`bad contrast '${c}' for ARMS '${arms.join(" ")}'`);
      return [m[1], m[2]] as [string, string];
    });
  } else if (arms.length && contrasts.some(([a, b]) => !arms.includes(a) || !arms.includes(b))) {
    throw new ConfigError(`config ${path} sets ARMS '${arms.join(" ")}' but no CONTRASTS`);
  }
  return {
    path, dir: dirname(path), values, name: values.PILOT_NAME || "pilot-01",
    arms: arms.length ? arms : ["B", "C", "D"], tasks: tasks.length ? tasks : ["T1", "T2", "T3"], k,
    contrasts, decisionRule: values.DECISION_RULE || null,
  };
}
