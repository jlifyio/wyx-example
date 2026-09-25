# wyx-example — fixture for the wyx plugin

Demo repo: 4 modules under src/, 3 with CONCEPT.md. payments/ has INTENTIONAL drift (service.ts imports ../orders/repository directly; undeclared refund(); updated_at bug); notifications/ is INTENTIONALLY uncovered. Do not fix either — they are the demo. The demo itself has no build, tests or runtime.
- Editing a spec or module changes the README's promised findings ("3 issues in the payments module"); update README in the same commit.
- `.claude/` is gitignored (wyx-drift-history.jsonl lands there when someone runs the demo).
- Install strings: `/plugin marketplace add jlifyio/claude-plugins` → `/plugin install wyx@jlifyio`.
- `eval/pilot-01/` is the wyx measurement harness (bash + bun; see its README). Its fixture exports only `src/` and `.gitignore` at the pinned `FIXTURE_SHA`, so nothing under `eval/` reaches a run.
- Editing anything under `src/` changes the pilot's BASE tree: repin `FIXTURE_SHA` in `eval/pilot-01/config.env` and rerun Stage-0 before the next batch.
