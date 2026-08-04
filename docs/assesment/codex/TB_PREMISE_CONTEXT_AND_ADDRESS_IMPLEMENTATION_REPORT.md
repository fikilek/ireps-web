# TB Premise Context and Address Implementation Report

## 1. Repository state before implementation

### Backend/web

- Repository: `C:\dev\ireps-web`
- Branch: `main`, 14 commits ahead of `origin/main`
- HEAD: `b7f261672825eebe9a9a91bfe2aee8666fc6c952`
- No staged changes.
- The working tree already contained 18 modified tracked files and numerous untracked inspection archives, reports, tools, backups and generated inputs.
- Relevant pre-existing modifications included `functions/targetedBatches/callables.js` and `functions/targetedBatches/documentFactory.js`. They were inspected but not modified by this task.
- `functions/index.js`, `functions/targetedBatches/premiseLink.js`, and `functions/test/targetedBatchPremiseLink.test.js` were clean at task start and are the backend source files modified here.

### Mobile

- Repository: `C:\dev\ireps-mobile`
- Branch: `main`, 10 commits ahead of `origin/main`
- HEAD: `a2dbffa95729550a4f2cf4e7848b9714faeefb64`
- No staged changes.
- The working tree already contained extensive modified and deleted tracked files plus untracked inspection archives.
- `app/(tabs)/admin/operations/my-workorders.js` and `src/features/premises/formPremise.js` already contained unstaged Targeted Batch work.
- `src/redux/targetedBatchApi.js` was already untracked and contained the current Targeted Batch row normalization. It was inspected but not modified by this task.
- The existing row normalization preserves the original Firestore row in `row.raw`; the authoritative linkage fields used here are `row.id`, `row.tbId`, `row.erfId`, `row.raw.salesAllMeterId`, `row.raw.source.recordId`, `row.raw.refs.erfId`, `row.raw.location.addressLine1`, and `row.raw.location.town`.

No reset, revert, cleanup, deletion, or staging operation was performed.

## 2. Root cause addressed

The deployed callable selected linked behavior only when `data.targetedBatchContext.sourceModule` was recognized as `SALES_TARGETED_BATCH`. A supplied empty, incomplete, malformed, or unrecognized context evaluated as non-targeted and silently fell through to the normal `premiseRef.set(finalPayload)` path. That allowed a successful premise without updating the exact TB row, parent TB, or Sales reference.

The mobile linkage implementation was also only present as local unstaged work and depended on `GeoContext.selectedErf.targetedBatchContext`. It had no explicit route fallback if that selected ERF object was replaced during navigation. New premise address defaults did not use the TB row source address.

## 3. Files modified

### Backend source and tests

- `functions/index.js`
- `functions/targetedBatches/premiseLink.js`
- `functions/test/targetedBatchPremiseLink.test.js`

### Mobile source and tests

- `app/(tabs)/admin/operations/my-workorders.js`
- `app/(tabs)/premises/index.js`
- `src/features/premises/formPremise.js`
- `src/features/premises/targetedBatchPremiseContext.js` (new)
- `src/features/premises/targetedBatchPremiseContext.test.mjs` (new)

### Report

- `assesment/codex/TB_PREMISE_CONTEXT_AND_ADDRESS_IMPLEMENTATION_REPORT.md` (new)

No Sales table, Sales modal, repair script, Firestore migration, meter outcome, meter registration, TRN completion, or batch completion file was modified.

## 4. Backend code-path changes

`classifyTargetedBatchPremiseRoute` is now the single branch classifier. It accepts the explicit presence state of the `targetedBatchContext` key and returns only one of:

- `NORMAL`
- `TARGETED_BATCH`
- `REJECTED_CONTEXT`

The callable logs only:

- `hasTargetedBatchContext`
- `sourceModule`
- `tbId`
- `rowId`
- `salesDocId`
- `erfId`
- `selectedBranch`

It does not log customer name, account number, address, media, complete payloads, or authentication tokens.

A supplied invalid context returns `TARGETED_BATCH_CONTEXT_INVALID` before duplicate queries, normalization, or any premise write. A valid complete Sales TB context is forced through `createOrLinkTargetedBatchPremise`; it cannot reach the normal write branch.

The canonical context saved on the premise now includes authoritative row source address fields:

```js
sourceAddress: {
  addressLine1: row.location.addressLine1 || null,
  town: row.location.town || null
}
```

The backend derives those fields from the loaded exact TB row, not from mobile-supplied address data.

## 5. Routing behavior before and after

| Input | Before | After |
|---|---|---|
| No `targetedBatchContext` key | Normal premise | `NORMAL`; unchanged normal premise path |
| Complete Sales TB context | Linked transaction | `TARGETED_BATCH`; linked transaction required |
| Empty context object | Normal premise fallback | `REJECTED_CONTEXT`; controlled failure, zero writes |
| Incomplete Sales context | Entered helper only if source was recognized; otherwise could fall through | `REJECTED_CONTEXT`; controlled failure, zero writes |
| Unrecognized supplied source module | Normal premise fallback | `REJECTED_CONTEXT`; controlled failure, zero writes |
| Linked helper validation/transaction failure | Failure response | Failure response; transaction remains atomic |

Normal non-TB premise creation remains unchanged when the context key is absent.

## 6. Mobile context lifecycle

1. `targetedBatchApi.js` normalizes the row while preserving the complete source document in `row.raw`.
2. `buildTargetedBatchSelectedErf` calls the shared `buildTargetedBatchContextFromRow` helper.
3. The helper constructs IDs and source data from the actual normalized/raw row shape, including authoritative `row.raw.location` address fields.
4. The resulting normalized context remains on `selectedErf.targetedBatchContext` during exact ward and ERF activation.
5. The Premises screen serializes only the normalized context and passes it as an explicit Expo Router parameter on both new-premise actions.
6. The Premise Form parses the route JSON and normalizes it before use. Invalid JSON, arrays, and unrecognized source modules are rejected rather than trusted.
7. The form prefers the queued payload during queue editing, then the active selected ERF context, then the validated route fallback.
8. New TB-origin forms fail closed when context cannot be normalized or any of `sourceModule`, `tbId`, `rowId`, `salesDocId`, or `erfId` is missing.
9. The form also requires context `erfId` to equal the active premise `erfId`.
10. Online submission includes the normalized context at the payload root.
11. Initial offline save and timeout fallback store the same base/final payload.
12. Queue edit recovers context from `queueItem.payload.targetedBatchContext`.
13. Existing bulk and manual retry implementations spread the entire queued payload and replace only `media`, so context and source address remain intact.

The form's blocked-submission diagnostic logs only missing field names and safe correlation IDs.

## 7. Address parser behavior

The parser extracts only a leading number-like token when it is followed by address text. It never infers or removes a street type. `strType` remains `Select...`.

| Source address | Result |
|---|---|
| `485 VAN RENSBURG`, town `SITHEMBILE` | `strNo: 485`, `strName: VAN RENSBURG`, `suburbName: SITHEMBILE` |
| `14A SMITH ROAD` | `strNo: 14A`, `strName: SMITH ROAD`; `ROAD` is preserved |
| `VAN RENSBURG` | empty `strNo`, `strName: VAN RENSBURG` |
| Empty `addressLine1` | empty `strNo` and `strName` |
| Missing town | empty `suburbName` |

Prepopulation is used only for a new TB-linked premise. Normal new premises retain empty address defaults. The editable premise address is a separate object; fieldworker corrections do not mutate `targetedBatchContext.sourceAddress`.

## 8. Tests added or extended

### Backend

- Absent context classifies as `NORMAL`.
- Complete Sales TB context classifies as `TARGETED_BATCH`.
- Empty, incomplete, and unrecognized supplied contexts classify as `REJECTED_CONTEXT` with `TARGETED_BATCH_CONTEXT_INVALID`.
- Callable source is wired to the shared classifier and rejected branch.
- Existing normalizer, Sales reference preservation, conflict, and idempotency tests remain active.
- Linked transaction still starts row/parent/Sales execution and preserves unrelated Sales data.
- Forced linked helper failure creates no premise and no partial row/parent linkage.
- Existing retry test proves the parent count remains `1` after a second identical linked invocation.

### Mobile

- Exact authoritative raw-row paths build the expected context.
- Route fallback round-trips through normalization.
- Invalid JSON and unrecognized route source are rejected.
- `485 VAN RENSBURG` parsing.
- `14A SMITH ROAD` parsing without street-type inference.
- `VAN RENSBURG` without a leading number.
- Empty address and missing town.
- Field address correction does not mutate source address.
- Normal non-TB context remains absent.

## 9. Commands run

Repository inspection:

```text
git status --short --branch
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git diff --cached --name-only
rg ... affected files and paths
```

Backend validation:

```text
node --check functions/index.js
node --check functions/targetedBatches/premiseLink.js
node --check functions/test/targetedBatchPremiseLink.test.js
node --test functions/test/targetedBatchPremiseLink.test.js
```

Mobile validation:

```text
node --experimental-default-type=module --test src/features/premises/targetedBatchPremiseContext.test.mjs
npx.cmd eslint src/features/premises/targetedBatchPremiseContext.js src/features/premises/targetedBatchPremiseContext.test.mjs src/features/premises/formPremise.js app/(tabs)/premises/index.js app/(tabs)/admin/operations/my-workorders.js
```

Whitespace validation:

```text
git diff --check -- <all modified tracked backend files>
git diff --check -- <all modified tracked mobile files>
git diff --no-index --check -- NUL <each new mobile file>
```

## 10. Complete test results

- Backend syntax checks: passed, no output.
- Backend focused suite: **13 tests passed, 0 failed**.
- Mobile focused helper suite: **5 tests passed, 0 failed**.
- Focused mobile ESLint: **0 errors, 2 warnings**.
- The two warnings are pre-existing in the large unstaged `my-workorders.js` implementation:
  - unused `isManagerRole`;
  - an existing `liveStats` hook dependency warning.
- No auto-fix command was run.

## 11. `git diff --check` results

- Backend modified tracked files: passed; no whitespace errors.
- Mobile modified tracked files: passed; no whitespace errors.
- New mobile helper and test checked with `git diff --no-index --check`: no whitespace-error output. Exit code `1` is expected because each new file differs from `NUL`.
- Git emitted only existing line-ending notices that LF would be replaced by CRLF when Git next touches the files.

## 12. Remaining risks

- A historical TB-origin offline queue payload created before context propagation and containing no `targetedBatchContext` key is indistinguishable from a genuine normal premise. The backend requirement deliberately permits key-absent normal creation. Such an old queue item should not be retried; the worker should reopen the exact TB row and create a fresh linked submission.
- The mobile worktree contains large pre-existing unstaged changes. Patch preparation must select exact files and review the combined diffs carefully.
- `targetedBatchApi.js` and its store registration remain uncommitted pre-existing work and must be present in the eventual mobile baseline for the current workorders flow to operate.
- Route JSON is a durability fallback, not an authority. The backend continues to validate all exact IDs and derives source address from the authoritative row.
- Address parsing is intentionally conservative; addresses without leading number-like tokens still require the worker to complete `strNo`.
- No emulator or physical-device navigation test was run. Controlled DEV verification remains required.

## 13. Files deliberately not modified

- `src/redux/targetedBatchApi.js` (inspected; pre-existing untracked implementation)
- `src/redux/store.js` (inspected; pre-existing Targeted Batch API registration)
- `src/redux/premisesApi.js` (already forwards the complete payload)
- `src/services/processPremiseSubmissionQueue.js` (already preserves the complete payload)
- `src/utils/processSinglePremiseQueueItem.js` (already preserves the complete payload)
- `functions/targetedBatches/documentFactory.js`
- `functions/targetedBatches/callables.js`
- All Sales table and TB modal files
- All repair/data tooling
- Firestore rules, indexes, configuration, and deployment files

## 14. Safety confirmation

- No Firebase deployment.
- No Firestore read or write from an implementation/repair script.
- No Firestore data modification.
- No commit.
- No push.
- No `git add`.
- No reset, revert, or clean.
- No source, ZIP, untracked, or other file deletion.
- No existing-record repair.

## 15. Recommended controlled DEV verification

1. Build a reviewed mobile DEV artifact containing the approved mobile files and the required pre-existing Targeted Batch API/store baseline.
2. Confirm parent `TGB_20260803_064212_LV1L`, row `TBR_20260803_064212_LV1L_000001`, Sales `04298112659`, ERF `K241N0GT030900000360000000`, LM `ZA5241`, and ward `ZA5241003` by exact IDs.
3. Do not submit against the already-created premise or repair the record. Use a fresh controlled fixture for the first creation test, or use the exact record only after a separately reviewed repair decision.
4. Open the exact accepted TB and exact row. Confirm the active ward pcode and ERF ID before entering Premises.
5. Confirm the new premise form starts with `485`, `VAN RENSBURG`, `SITHEMBILE`, and `Select...` street type.
6. Correct an editable address field and confirm the outgoing context still contains original `sourceAddress`.
7. Submit online and confirm the function log records exactly `selectedBranch: TARGETED_BATCH` and the safe exact IDs.
8. Confirm the response contains `targetedBatchLink.linked: true`.
9. Read the exact row, parent, premise, and Sales document and verify the required atomic result and preservation of unrelated Sales fields.
10. Retry the identical linked payload. Confirm `alreadyLinked: true` and `counts.executionStartedRows` remains unchanged.
11. Repeat with a fresh fixture through offline save, queue edit, bulk retry, and manual single retry.
12. Submit controlled malformed payloads and confirm `REJECTED_CONTEXT`, `TARGETED_BATCH_CONTEXT_INVALID`, zero premise creation, and zero TB/Sales changes.
13. Submit a normal premise with no context key and confirm `selectedBranch: NORMAL` and unchanged normal behavior.

## 16. Recommended commit messages

Backend:

```text
fix(targeted-batches): fail closed on invalid premise context
```

Mobile:

```text
fix(targeted-batches): preserve premise context and source address
```

## PATCH PACKAGE CONTENTS

### Backend patch ZIP

- `functions/index.js`
- `functions/targetedBatches/premiseLink.js`
- `functions/test/targetedBatchPremiseLink.test.js`

### Mobile patch ZIP

- `app/(tabs)/admin/operations/my-workorders.js`
- `app/(tabs)/premises/index.js`
- `src/features/premises/formPremise.js`
- `src/features/premises/targetedBatchPremiseContext.js`
- `src/features/premises/targetedBatchPremiseContext.test.mjs`

No ZIP files were created.

## 17. Controlled correction: operation routing and route privacy

The central `classifyTargetedBatchPremiseRoute` classifier now rejects an explicitly supplied, non-empty `operationType` other than `METER_DISCOVERY`. Missing and blank operation types remain backward-compatible and select `TARGETED_BATCH` when the Sales context and required correlation IDs are complete. The rejected result remains `REJECTED_CONTEXT` with code `TARGETED_BATCH_CONTEXT_INVALID`, so the callable returns before normal duplicate queries, linked transaction execution, or any write. The later authoritative transaction validation remains unchanged.

The Expo Router durability fallback now serializes exactly these fields:

- `sourceModule`
- `operationType`
- `tbId`
- `rowId`
- `rowNo`
- `salesDocId`
- `erfId`
- `meterNo`
- `sourceAddress`

`accountNumber` and `customerName` remain available in Targeted Batch row and non-route business data but are excluded from route serialization. The backend remains authoritative and continues deriving canonical Sales and Targeted Batch information from the exact loaded records.

The approved safe-field restriction described earlier applies specifically to the Targeted Batch branch-selection log. This report does not claim that every existing callable or timing log is restricted to those seven branch-selection fields.

Focused tests were extended to cover missing, blank, recognized, and explicitly invalid operation types; unchanged normal routing and malformed-context rejection; route-field privacy; exact correlation and ERF preservation; unchanged source-address round-tripping; invalid JSON and source-module rejection; and absent normal non-Targeted-Batch context.

Correction validation results:

- Backend syntax checks: passed, no output.
- Backend focused suite: **14 passed, 0 failed**.
- Mobile focused suite: **5 passed, 0 failed**.
- Focused ESLint on the two mobile files modified by this correction: **0 errors, 0 warnings**.
- Per-file whitespace validation: passed with no whitespace errors; Git emitted only line-ending notices for existing LF/CRLF configuration.
