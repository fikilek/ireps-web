# Targeted Batch Premise Source-Address Test Coverage Report

## 1. Executive summary

Focused backend test coverage was added to prove that the final premise payload queued through the mocked Firestore transaction uses the exact authoritative Targeted Batch row address when mobile context omits `sourceAddress`, and overrides deliberately conflicting mobile address values. The existing linked-creation/idempotency regression remains green and now also proves that the first `transaction.create` contains the authoritative address and that retry queues no second premise create.

No runtime source modification was required by this task. The current local runtime correction is covered sufficiently for a controlled, reviewed redeployment, but the repository is heavily dirty and must not be deployed wholesale from its present state.

## 2. Repository identity and pre-existing Git state

- Repository root: `C:\dev\ireps-web`
- Branch: `main`
- HEAD: `b7f261672825eebe9a9a91bfe2aee8666fc6c952`
- Upstream relation: `main...origin/main [ahead 14]`
- Staged changes at task start: none (`git diff --cached --` produced no output).
- The complete pre-change status was captured with `git status --short --branch --untracked-files=all` before editing.
- Relevant pre-existing tracked modifications included `functions/index.js`, `functions/targetedBatches/callables.js`, `documentFactory.js`, `helpers.js`, `premiseLink.js`, and `functions/test/targetedBatchPremiseLink.test.js`, plus multiple web/mobile-adjacent UI files.
- The status also contained numerous pre-existing tracked deletions and untracked archives, reports, backups, tools, and data artifacts. None was repaired, removed, staged, or otherwise changed by this task.
- The pre-existing diff in the allowed test file already contained classifier coverage, callable-routing assertion changes, and the `linked helper failure creates no premise or partial linkage` test. Those changes were preserved.

## 3. Files inspected and modified

Inspected:

- `functions/targetedBatches/premiseLink.js`
- `functions/test/targetedBatchPremiseLink.test.js`
- `functions/package.json`
- root `package.json`
- `docs/assesment/codex/TB_PREMISE_SOURCE_ADDRESS_INVESTIGATION_REPORT.md`
- `docs/assesment/codex/TB_PREMISE_CONTEXT_AND_ADDRESS_IMPLEMENTATION_REPORT.md` for the established focused test commands
- Read-only Git root, branch, HEAD, status, staged diff, and focused test-file diff

Modified by this task:

- `functions/test/targetedBatchPremiseLink.test.js`
- `docs/assesment/codex/TB_PREMISE_SOURCE_ADDRESS_TEST_COVERAGE_REPORT.md` (this report, newly created)

No runtime, mobile, configuration, or other repository file was modified.

## 4. Current runtime contract verified

The current local `buildCanonicalContext` reads `row.location.addressLine1` and `row.location.town`. The new-premise transaction queues:

```js
transaction.create(premiseRef, {
  ...premisePayload,
  targetedBatchContext: canonicalContext,
});
```

Because the canonical context is assigned after spreading the incoming premise payload, backend authority wins over any mobile `targetedBatchContext`.

## 5. Test harness and fixture changes

The existing deterministic `FakeFirestore` transaction harness was retained. It now records the cloned queued transaction writes in `transactionWrites`, allowing assertions against the exact value supplied to mocked `transaction.create`, rather than only a builder return value or mobile request payload.

The authoritative row fixture now includes:

```js
location: {
  addressLine1: "67 DAMMANN",
  town: "GLENCOE",
}
```

Canonical identifiers remain the existing deterministic values: `TB_ID`, `ROW_ID`, Sales document `04298074388`, and ERF `ERF_001`.

## 6. Tests added and extended

### Missing mobile source address

Added `authoritative TB-row source address is stored when mobile context has no source address`.

The incoming context has no `sourceAddress`. The test locates the premise `create` write by `premises/${premiseId}` and proves its final payload contains:

- `sourceAddress.addressLine1 === "67 DAMMANN"`
- `sourceAddress.town === "GLENCOE"`
- `sourceModule === "SALES_TARGETED_BATCH"`
- `operationType === "METER_DISCOVERY"`
- the expected TB ID, row ID, Sales document ID, and ERF ID

### Conflicting mobile source address

Added `authoritative TB-row source address overrides a conflicting mobile source address`.

The incoming context deliberately supplies `999 WRONG MOBILE ADDRESS` and `WRONG MOBILE TOWN`. The final premise `create` payload is asserted to contain `67 DAMMANN` and `GLENCOE`, and direct negative assertions prove neither conflicting mobile value wins.

### Idempotency regression

The existing linked transaction test remains intact and passing. It still proves first creation, one parent execution counter increment, row linkage, in-place Sales `tbRefs` enrichment, retry compatibility, no second counter increment, and one Sales reference. It now additionally proves:

- the first premise `transaction.create` contains the authoritative source address; and
- both calls together queue exactly one premise `create` write.

No historical backfill or repair expectation was introduced.

## 7. Validation commands and exact results

Package inspection found no `test` script in either package. `functions/package.json` exposes Firebase serve/deploy/log and lint commands; the existing project report establishes direct Node syntax/test commands for this focused file. No emulator or Firebase command was run.

1. `node --check functions/test/targetedBatchPremiseLink.test.js`
   - Exit code: 0
   - Syntax errors: 0
   - Warnings: 0

2. `node --test functions/test/targetedBatchPremiseLink.test.js`
   - Exit code: 0
   - Passed: 16
   - Failed: 0
   - Skipped: 0
   - Cancelled: 0
   - Todo: 0
   - Suites: 0
   - Total reported duration: 490.1565 ms
   - Both required source-address cases passed.
   - The linked premise transaction/idempotency test passed.

3. `npx.cmd eslint test/targetedBatchPremiseLink.test.js` from `C:\dev\ireps-web\functions`
   - Exit code: 0
   - Errors: 0
   - Warnings: 0

4. `git diff --check -- functions/test/targetedBatchPremiseLink.test.js`
   - Exit code: 0
   - Whitespace errors: 0
   - Git emitted the existing line-ending advisory that LF will be replaced by CRLF the next time Git touches the file.

5. `git diff --stat -- functions/test/targetedBatchPremiseLink.test.js`
   - Current complete working-tree diff versus HEAD: 1 file changed, 255 insertions, 1 deletion.
   - This total includes substantial test-file work that pre-existed this task and was preserved.

6. `git diff -- functions/test/targetedBatchPremiseLink.test.js` and `git status --short --untracked-files=all`
   - Confirmed the focused assertions are present and inspect the recorded final transaction-create payload.
   - Confirmed the pre-existing dirty worktree remains; no unexpected task-created modification was found outside the two permitted paths.

## 8. Conclusions and limitations

- Runtime code modification required for this test-only task: no.
- Another backend runtime patch necessary for this narrow source-address issue: no; the relevant local runtime correction already exists in `premiseLink.js`.
- Coverage sufficiency: the current local correction is sufficiently covered for a controlled redeployment because missing and hostile/conflicting mobile inputs both resolve to the authoritative row values in the exact final premise create payload, while idempotency remains green.
- Limitation: tests use the existing in-memory Firestore transaction harness, not a live service or emulator. This is intentional and ensures no external writes.
- Limitation: this task does not prove what code revision is currently deployed and does not backfill an already-linked premise.
- Recommended next controlled step: review the intended runtime diff and these tests, isolate only the approved backend changes in a controlled clean deployment package, rerun the focused test, and deploy the intended function under a separate authorized deployment task. Do not deploy the current dirty worktree wholesale.

## 9. Safety and scope confirmation

- No deployment occurred.
- No Firestore read, write, repair, update, or deletion occurred.
- No Firebase or Google Cloud command was run.
- No mobile file changed.
- No runtime backend file changed by this task.
- No file was staged, committed, pushed, reset, restored, cleaned, checked out, deleted, renamed, or replaced.
- Only `functions/test/targetedBatchPremiseLink.test.js` and this permitted Codex report were created or modified by this task.
