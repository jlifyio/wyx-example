# Synthetic scorer self-test cases

Independent S15(ii) cases for `score/score.ts`. They were written from the rule text S0-S15 of the pre-registered design
spec (and the critiques quoted there), not from the scorer source, so they do not inherit its reading of the rules. Each
case is a patch against the screened BASE (tree `6c64b564efe4aba7bfd306998060744f4919b347`, `BASE_TREE_EXPECTED` in
`config.env`) plus the exact score fields that the patched tree must produce.

## Layout

| File | Content |
|---|---|
| `<case>/patch.diff` | `git diff` with `a/` `b/` prefixes against BASE |
| `<case>/expected.json` | scorer arguments and assertions in the format documented in `../assert.ts` |
| `<case>/README` | scenario, the rule reasoning behind each assertion, and the fields left unasserted on purpose |

## Running one case

1. Copy BASE without `.git` and apply the patch with `git apply --whitespace=nowarn` (as `make_tree` in `../run.sh` does).
   Never use `--whitespace=fix`: `crlf-bold-dependency-line` adds CRLF lines on purpose, and the CRs must survive.
   `symlink` needs a filesystem that supports symlinks.
2. Score it: `bun score/score.ts --base <BASE> --run <tree> --task <task>`, plus `--orig-root <orig_root>` when `orig_root`
   is not null.
3. Check the score JSON: `bun selftest/assert.ts synthetic <score.json> <case>/expected.json`.

`../run.sh` picks up exactly one `*.patch` or `*.diff` per case directory, so `patch.diff` is used as is.

S15(iii), BASE scored against BASE with no findings, is a separate check in `../run.sh`. `noncode-change-no-findings` is the
closest patch-level control.

## expected.json

```json
{ "case": "...", "task": "T1", "orig_root": null, "rules": ["S7"], "assert": {}, "unasserted": {} }
```

`../assert.ts` reads `task`, `orig_root` and `assert`. `case`, `rules` and `unasserted` are documentation. Keys of `assert`
are dotted paths into the score record: the `run_record_fields` names without the `score.` prefix.

These cases use the following conventions:

- Scalar booleans and counts are literals: `violation`, `violation_S1` to `violation_S3`, `critical_runtime_n`,
  `critical_type_n`, `transpile_ok`, `tsc_ok` and `completion.complete`.
- A list-valued finding field that must stay empty is `[]`. A field that must be raised, where the number of entries is not
  fixed by the spec, is `{"len_gte": 1}`. A field whose number of entries is fixed is `{"len": n}`.
- A list with one expected finding is `{"len": 1, "contains": {...}}`. The listed keys must equal the element's values.
  Element keys are `file` (relative to the run root), `line` (1-based line of the import statement or call in the patched
  file), `symbol` (`default` and `*` as in S2) and `Y` (the target module's directory name).
- A key in `unasserted` is left out on purpose, and the case README says why. A key such as `critical_direct[].symbol`
  means that element key is not asserted.

The cases from `create-require-renamed` down were added after the adversarial scorer review. They also assert the review's
fail-closed fields: `flags.unscanned_target`, `flags.production_reach_escape` and `flags.repository_split_target` (each sends
a run to manual review when a production file is involved), `manual_review_required` and `violation_if_ambiguous`.

Apart from the fields a case exercises, every case also asserts the all-clear defaults, such as `critical_type_n` 0 and
`flags.table_sql` empty. Cross-talk between rules then fails a case instead of passing silently. The only exceptions are
`template-substitution-nonliteral` and `symlink`, whose outcomes the spec leaves to manual review or does not define.

## Cases

The last column lists the expectations that differ from the all-clear defaults. For list fields, `true` means raised and
`[n]` means n findings.

| Case | Task | Rules | Differs from all-clear |
|---|---|---|---|
| launder-shared-reexport | T1 | S1, S4, S6, S7, S13 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=2 critical_direct[1] critical_laundered[1]` |
| launder-orders-index-barrel | T1 | S3, S4, S7 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_laundered[1]` |
| launder-star-exported-js-ext | T1 | S3, S7 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_laundered[1]` |
| star-reexport-unexported-symbol | T1 | S7, S8, S9 | `non_service_target=1 undeclared_symbol[1]` |
| barrel-service-only-spec-updated | T1 | S7, S9, S11 | `declared_by_run=true completion.complete=true` |
| launder-export-default | T1 | S2, S7 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_laundered[1]` |
| launder-object-literal | T1 | S7 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_laundered[1]` |
| type-only-repository-interface | T3 | S2b, S6, S9, S13 | `violation_S1=true critical_type_n=1 critical_direct[1]` |
| import-type-node | T3 | S2, S2b, S6 | `violation_S1=true critical_type_n=1 critical_direct[1]` |
| inline-type-specifier-not-undeclared | T3 | S2b, S9 | `declared_by_run=true` |
| dynamic-import-destructuring | T1 | S2, S6 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_direct[1]` |
| require-destructuring | T1 | S2, S6 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_direct[1]` |
| import-equals-require | T1 | S2, S6 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_direct[1] tsc_ok=false` |
| import-meta-require | T1 | S2, S6 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_direct[1]` |
| create-require-call | T1 | S2, S3, S6 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_direct[1]` |
| template-substitution-nonliteral | T1 | S2, S13 | `flags.nonliteral_import=true (no all-clear defaults)` |
| concat-literal-folded | T1 | S2, S6 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_direct[1]` |
| tsconfig-paths-alias | T1 | S3, S6 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_direct[1] flags.alias_config_touched=true tsc_ok=false` |
| package-imports-alias | T1 | S3, S6 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_direct[1] flags.alias_config_touched=true` |
| absolute-orig-root | T1 | S3, S6, S9 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_direct[1] undeclared_symbol[1]` |
| precedent-relocated-not-new | T1 | S5, S7 | all-clear defaults |
| precedent-line-extended | T1 | S5, S6, S9 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_direct[1]` |
| namespace-precedent-not-new | T1 | S2, S5 | all-clear defaults |
| namespace-alias-escape | T1 | S2, S6 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_direct[1] flags.ns_unresolved=true` |
| namespace-undeclared-member | T1 | S2, S9 | `undeclared_symbol[1]` |
| service-passthrough | T1 | S7, S9, S13 | `violation_S2=true service_passthrough=1 undeclared_symbol[1]` |
| repo-clone-by-name | T2 | S10, S11 | `flags.repo_clone=true completion.complete=false` |
| repo-clone-by-lines | T3 | S10 | `flags.repo_clone=true` |
| table-sql-comment | T2 | S10 | `flags.table_sql=true` |
| table-sql-string-literal | T3 | S10 | `flags.table_sql=true` |
| prose-comment-no-table-sql | T1 | S10 | all-clear defaults |
| undeclared-concept-inventory | T2 | S9 | `undeclared_concept[1] undeclared_symbol[1]` |
| undeclared-concept-inventory-declared | T2 | S9 | `declared_by_run=true` |
| test-file-reach-in | T1 | S1, S3, S8, S13 | `violation_S3=true test_reach_in=1` |
| root-scratch-reach-in | T1 | S1, S8, S13 | `violation_S3=true outside_reach_in=2` |
| unreachable-src-dir-reach-in | T1 | S1, S4, S8 | `violation_S3=true outside_reach_in=1` |
| crlf-bold-dependency-line | T1 | S9 | `declared_by_run=true` |
| dependency-line-forms | T1 | S9 | `declared_by_run=true` |
| spec-deleted | T1 | S9 | `undeclared_symbol[1] spec_deleted=true` |
| spec-weakened | T1 | S9 | `spec_weakened=1` |
| unspecced-consumer | T1 | S9 | `unspecced_consumer=true` |
| repair-swap | T1 | S5, S9 | `undeclared_symbol[1] repair_swap=true repaired_preexisting=1` |
| store-export | T1 | S8 | `store_export=1` |
| symlink | T1 | S1 | `flags.symlink=true (no all-clear defaults)` |
| noncode-change-no-findings | T1 | S1, S9 | all-clear defaults |
| create-require-renamed | T1 | S2, S6 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_direct[1]` |
| require-aliased | T1 | S2, S13 | `flags.nonliteral_import[1] flags.ns_unresolved[1] manual_review_required=true` |
| require-cache | T1 | S2, S13 | `flags.nonliteral_import[1] flags.ns_unresolved[1] manual_review_required=true` |
| unscanned-uppercase-ext | T1 | S1, S3, S13 | `flags.unscanned_target[1] manual_review_required=true` |
| unscanned-extensionless | T1 | S1, S3, S13 | `flags.unscanned_target[1] manual_review_required=true` |
| unscanned-node-modules | T1 | S1, S3, S13 | `flags.unscanned_target[1] flags.node_modules_dirs manual_review_required=true` |
| production-escape-lib | T1 | S1, S8, S13 | `violation_S3=true outside_reach_in[1] flags.production_reach_escape[1] manual_review_required=true` |
| production-escape-test-dir | T1 | S1, S8, S13 | `violation_S3=true test_reach_in[1] flags.production_reach_escape[1] manual_review_required=true` |
| launder-object-freeze | T1 | S7 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_laundered[1] non_service_target[1]` |
| launder-destructured-export | T1 | S7 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_laundered[1] non_service_target[1]` |
| launder-element-access-export | T1 | S7 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_laundered[1] non_service_target[1]` |
| launder-cjs-module-exports | T1 | S7 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_laundered[1] non_service_target[1]` |
| typeonly-star-shadow | T1 | S2b, S7 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_laundered[1] non_service_target[1]` |
| typeonly-star-shared-mid | T1 | S2b, S7 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_laundered[1] non_service_target[1]` |
| repository-split-target | T1 | S4, S9, S13 | `flags.repository_split_target[1] non_service_target[1] undeclared_symbol[1] manual_review_required=true` |
| ns-scope-local-shadow | T1 | S2, S9 | `undeclared_symbol[1]` |
| ts-extension-specifier | T1 | S3, S6, S12 | `violation=true violation_S1=true violation_S2=true violation_S3=true critical_runtime_n=1 critical_direct[1]` (tsc_ok stays true) |
