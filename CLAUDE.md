# wyx-example — fixture for the wyx plugin

Demo repo: 4 modules under src/, 3 with CONCEPT.md. payments/ has INTENTIONAL drift (service.ts imports ../orders/repository directly; undeclared refund(); updated_at bug); notifications/ is INTENTIONALLY uncovered. Do not fix either — they are the demo. No build, no tests, no runtime.
- Editing a spec or module changes the README's promised findings ("3 issues in the payments module"); update README in the same commit.
- `.claude/` is gitignored (wyx-drift-history.jsonl lands there when someone runs the demo).
- Install strings: `/plugin marketplace add jlifyio/claude-plugins` → `/plugin install wyx@jlifyio`.
