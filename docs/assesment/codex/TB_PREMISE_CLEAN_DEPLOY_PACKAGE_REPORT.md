# TB Premise Clean Deploy Package Report

## 1. Executive summary

An isolated review package was created from exact Git baseline `b7f261672825eebe9a9a91bfe2aee8666fc6c952`. It contains the approved `onPremiseCreateCallable` Targeted Batch premise-link changes, focused tests, and one proven one-line transitive collection-registry dependency. No active runtime/test file was changed, no deployment occurred, and no Firestore access occurred.

The package passed syntax, focused tests (16 passed, 0 failed, 0 skipped), focused ESLint, whitespace inspection, source comparison, import/load validation, secret scanning, ZIP manifest/hash verification, and re-extracted ZIP tests (16 passed, 0 failed, 0 skipped). It is ready for human review and controlled deployment, subject to normal approval.

## 2. Repository and baseline identity

- Active root: `C:\dev\ireps-web`
- Branch: `main`
- HEAD: `b7f261672825eebe9a9a91bfe2aee8666fc6c952`
- Upstream: `origin/main`; active branch was 14 ahead and 0 behind.
- Required baseline: `b7f261672825eebe9a9a91bfe2aee8666fc6c952`
- Baseline object type: `commit`
- Subject: `feat(targeted-batches): link premise creation to sales execution`
- Author/commit timestamp: `2026-08-03T18:55:04+02:00`
- Staged changes: none.

## 3. Pre-existing Git state

The active repository was intentionally dirty and was not cleaned. The complete pre-check was captured with `git status --branch --short` and `git status --porcelain=v2 --branch --untracked-files=all`.

Pre-existing tracked state included many deleted root ZIP/inspection artifacts; modified backend files `functions/index.js`, `functions/targetedBatches/callables.js`, `functions/targetedBatches/documentFactory.js`, `functions/targetedBatches/helpers.js`, `functions/targetedBatches/premiseLink.js`, and `functions/test/targetedBatchPremiseLink.test.js`; and numerous unrelated modified frontend files. Untracked state included reports, backups, data reports, tools, generated inputs, dashboard source, and local backups. No staged entry existed. All pre-existing dirty work was preserved.

## 4. Isolation method and paths

- Initial isolated validation root: `C:\Users\User\AppData\Local\Temp\ireps_tb_onpremise_clean_deploy_20260804_001604\SALES_TB_V4_ONPREMISE_CREATE_CLEAN_DEPLOY_20260804_001604`
- Final clean staging root: `C:\Users\User\AppData\Local\Temp\tbp604\SALES_TB_V4_ONPREMISE_CREATE_CLEAN_DEPLOY_20260804_001604`
- Re-extraction root: `C:\Users\User\AppData\Local\Temp\tbv604\SALES_TB_V4_ONPREMISE_CREATE_CLEAN_DEPLOY_20260804_001604`
- Archive method: `git archive --format=zip --output=<temp>\baseline.zip b7f261672825eebe9a9a91bfe2aee8666fc6c952 firebase.json functions`
- No worktree was created and the active tree was not used as the baseline.

Baseline-tracked non-runtime directories `functions/scripts`, `functions/_bgo_reset_backups`, and `functions/.expo` were excluded after the ZIP inventory showed tools, exports/reports, backups, caches, and local-path examples. Runtime source does not import them. This satisfies the explicit prohibition on production data, exports, caches, and unrelated tooling.

## 5. Files inspected and hunk classification

Inspected against the baseline:

- `functions/index.js`
- `functions/targetedBatches/premiseLink.js`
- `functions/test/targetedBatchPremiseLink.test.js`
- `functions/targetedBatches/callables.js`
- `functions/targetedBatches/documentFactory.js`
- `functions/targetedBatches/helpers.js`
- `functions/package.json`
- `functions/package-lock.json`
- `firebase.json`

Classification:

- `functions/index.js`: all three hunks `APPROVED_TARGETED_BATCH_PREMISE` (classifier import, presence-aware branch selection, safe branch log/fail-closed return).
- `functions/targetedBatches/premiseLink.js`: both hunks `APPROVED_TARGETED_BATCH_PREMISE` (authoritative source address; presence/operation-aware classifier).
- `functions/test/targetedBatchPremiseLink.test.js`: all hunks `APPROVED_TARGETED_BATCH_PREMISE` (routing, zero-partial-write, canonical source-address, transaction payload, preservation, idempotency/count coverage).
- `functions/targetedBatches/helpers.js`: only `erfs: "ireps_erfs"` is `REQUIRED_TRANSITIVE_DEPENDENCY`, because the approved premise helper reads the authoritative ERF through `TARGETED_BATCH_COLLECTIONS.erfs`. Every other large helper hunk is `UNRELATED` and excluded.
- `functions/targetedBatches/callables.js` and `documentFactory.js`: `UNRELATED` batch-creation/ward-grouping changes; excluded.
- `functions/package.json`, `functions/package-lock.json`, and `firebase.json`: no diff.
- No `UNCERTAIN` required hunk remained.

The initial three-file package test proved the dependency: 12 passed and 4 failed because the baseline registry lacked the ERF collection key. Applying only the one-line registry hunk produced 16 passed and 0 failed.

## 6. Exact approved changes

Runtime changes:

- Presence-aware route classification: absent key is `NORMAL`; complete Sales context with missing/blank/`METER_DISCOVERY` operation is `TARGETED_BATCH`; other explicit operation types (including `BGO`) are `REJECTED_CONTEXT` with `TARGETED_BATCH_CONTEXT_INVALID`.
- Rejection occurs before duplicate queries or writes.
- Valid TB work calls `createOrLinkTargetedBatchPremise`; normal creation remains unchanged.
- Canonical context reads `sourceAddress.addressLine1` and `sourceAddress.town` exclusively from the authoritative row.
- Canonical context overrides incoming mobile context in the final premise create payload.
- Existing atomic parent/row/Sales/premise linkage and idempotency are retained.
- One-line `ireps_erfs` registry dependency enables the already-approved authoritative ERF read.

Test changes cover all requested routing, malformed-context, zero-write, atomicity, Sales preservation/enrichment, authoritative address override, final transaction-create payload, idempotency, and exact-once parent count cases.

## 7. Baseline source differences and package tree

Exactly these source/test files differ from the baseline:

1. `functions/index.js`
2. `functions/targetedBatches/helpers.js`
3. `functions/targetedBatches/premiseLink.js`
4. `functions/test/targetedBatchPremiseLink.test.js`

`PACKAGE_DIFF.patch` contains only these approved source differences. No current `callables.js`, `documentFactory.js`, other helper hunks, frontend, mobile, config, lockfile, tool, report, or dirty artifact entered the package.

Package tree summary: one root folder, `firebase.json`, the clean baseline runtime Functions tree, package/lock files, focused tests, and six root evidence files. Final ZIP has 103 file entries. `node_modules`, `.git`, scripts/tools, backups, caches, exports, credentials, frontend, mobile, and unrelated docs are absent.

## 8. Validation results

### Syntax

- `node --check functions/index.js`: exit 0.
- `node --check functions/targetedBatches/premiseLink.js`: exit 0.
- `node --check functions/test/targetedBatchPremiseLink.test.js`: exit 0.

### Focused tests

- Command: `node --test functions/test/targetedBatchPremiseLink.test.js`
- Final isolated result: 16 passed, 0 failed, 0 skipped, duration 479.2127 ms.
- Re-extracted result: 16 passed, 0 failed, 0 skipped, duration 551.4317 ms.

### ESLint

Existing repository ESLint executable/config was run without `--fix` against `index.js`, `targetedBatches/premiseLink.js`, `targetedBatches/helpers.js`, and `test/targetedBatchPremiseLink.test.js`: exit 0, no warnings/errors. A prior `npx --no-install` lookup failed certificate verification because ESLint is not a Functions dependency; it made no source change.

### Whitespace and comparison

`git diff --no-index --check` produced no whitespace-error diagnostics; exit 1 is expected because differences exist. Name-only comparison returned exactly the four files above. Every retained baseline runtime file outside those four is byte-identical.

### Dependencies and import/load

`npm.cmd ci --ignore-scripts --no-audit --no-fund` ran only in the temporary validation workspace: 294 packages, two deprecation warnings. `index.js` imported successfully (`INDEX_IMPORT_OK`) under a 30-second failure timer without invoking a live callable. `node_modules` was excluded from the package.

### Secret and sensitive-data scan

Checked credential/cache filenames, `.env`, `private_key`, `client_email`, bearer/refresh/API tokens, key signatures, absolute `C:\Users\` paths, exports, and copied customer artifacts. No actual secret was detected. One clean-baseline script schema check referenced the literal field names `client_email` and `private_key`; it was a false positive, and the entire non-runtime scripts directory was excluded. No production/customer export is packaged.

### Re-extracted ZIP verification

- Manifest paths: 103.
- Actual paths: 103.
- Missing: 0.
- Unexpected: 0.
- Hash mismatches: 0 across 102 manifest hashes (the hash manifest excludes itself).
- Syntax checks: passed.
- Focused tests: 16 passed, 0 failed, 0 skipped.

## 9. Final ZIP

- Full path: `C:\dev\ireps-web\zips\SALES_TB_V4_ONPREMISE_CREATE_CLEAN_DEPLOY_20260804_001604.zip`
- Filename: `SALES_TB_V4_ONPREMISE_CREATE_CLEAN_DEPLOY_20260804_001604.zip`
- Package root: `SALES_TB_V4_ONPREMISE_CREATE_CLEAN_DEPLOY_20260804_001604`
- Size: 325,375 bytes.
- SHA-256: `c8c204aafba5f6925d792734362369ad791275d35f5a28a978aac0987effb5bb`
- ZIP roots: exactly one.

## 10. Readiness and deployment statement

- Ready for human review: **Yes**.
- Ready for controlled deployment after separate approval: **Yes**.
- Remaining blocker: none in package preparation; deployment approval and controlled DEV execution remain separate.
- Later command: `firebase deploy --only functions:onPremiseCreateCallable --project ireps2`.
- That command was **not executed**.

## 11. Safety confirmations

- No Firebase deployment occurred.
- No Firebase functions log command ran.
- No Firestore access, read, write, repair, update, or deletion occurred.
- No mobile file changed.
- No active runtime, test, frontend, configuration, or script file changed.
- No staging, commit, push, reset, restore, clean, checkout, repository-file deletion, rename, or replacement occurred.
- The active dirty worktree was not copied wholesale, cleaned, or deployed.
- Inside the active repository, this task created or updated only the permitted ZIP and this report.
