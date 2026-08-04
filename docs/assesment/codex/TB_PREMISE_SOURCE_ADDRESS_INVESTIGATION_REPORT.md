# Targeted Batch Premise Source Address Investigation

Investigation date: 2026-08-04 (Africa/Johannesburg)  
Test event: approximately 2026-08-03T21:33:49.554Z / 2026-08-03 23:33:49.554 +02:00

## 1. Executive summary

The current local backend implementation would write `targetedBatchContext.sourceAddress` on this premise. It loads the exact `tb_rows/{rowId}` document in the same transaction, constructs `sourceAddress.addressLine1` and `sourceAddress.town` from `row.location`, and writes that canonical object after spreading the mobile payload. No current local premise trigger replaces the document or removes that nested field.

The stored context instead has the exact field shape produced by the committed `HEAD` version of `buildCanonicalContext`: all fields through `customerName`, but no `sourceAddress`. The `sourceAddress` addition exists only as an unstaged working-tree change. `HEAD` `b7f2616` does not contain it. This makes an older deployed backend implementation the overwhelmingly supported explanation; neither the mobile path, merge order, JSON normalization, Firestore undefined handling, nor a later trigger explains the observed shape.

However, deployment metadata and test-window logs could not be retrieved: Firebase CLI authentication had expired and Google Cloud CLI was not installed. The deployed source bundle was therefore unavailable, and the row's address value at the exact transaction read time could not be independently timestamped. Under the instruction not to guess, the formal conclusion is:

## ROOT CAUSE: NOT YET PROVEN

Most strongly supported cause: the physical test ran the committed/older `buildCanonicalContext` implementation, not the current unstaged local source-address implementation. One read-only deployment/log check after reauthentication would turn this into a proven conclusion.

## 2. Repository identity and safety snapshot

### Web/backend

- Root: `C:\dev\ireps-web`
- Branch: `main`
- HEAD: `b7f261672825eebe9a9a91bfe2aee8666fc6c952`
- Upstream status: 14 commits ahead of `origin/main`
- Staged changes: none
- Relevant modified tracked files already present: `functions/index.js`, `functions/targetedBatches/callables.js`, `functions/targetedBatches/documentFactory.js`, `functions/targetedBatches/helpers.js`, `functions/targetedBatches/premiseLink.js`, `functions/test/targetedBatchPremiseLink.test.js`, plus unrelated web/UI changes.
- Relevant untracked file already present: `docs/assesment/codex/TB_PREMISE_CONTEXT_AND_ADDRESS_IMPLEMENTATION_REPORT.md`; numerous unrelated archives, reports, tools, backups, and generated inputs were also untracked.
- The complete status also contained many pre-existing tracked deletions of root ZIP/inspection artifacts and numerous untracked archive/report copies. None was touched.

### Mobile

- Root: `C:\dev\ireps-mobile`
- Branch: `main`
- HEAD: `a2dbffa95729550a4f2cf4e7848b9714faeefb64`
- Upstream status: 10 commits ahead of `origin/main`
- Staged changes: none
- Modified/deleted tracked files: `app/(tabs)/admin/index.js`, `app/(tabs)/admin/operations/dashboard/index.js`, `app/(tabs)/admin/operations/index.js`, `app/(tabs)/admin/operations/my-workorders.js`, `app/(tabs)/premises/index.js`, `components/maps/InformalErfLocationPicker.js`, deleted `components/maps/InformalErfLocationPicker.before-next-agent.js`, deleted `src/features/erfs/buildInformalErfSubmissionPayload.js`, `src/features/erfs/informalErfConstants.js`, `src/features/premises/formPremise.js`, `src/redux/store.js`, and `src/services/informalErfSubmissionController.js`.
- Untracked files: `IREPS_MOBILE_TREE.txt`, several inspection ZIPs, `src/features/premises/targetedBatchPremiseContext.js`, `src/features/premises/targetedBatchPremiseContext.test.mjs`, `src/redux/targetedBatchApi.js`, and two ZIPs under `zips/`.

Git initially rejected the mobile repository because of ownership. All mobile Git reads used the per-command, non-persistent `-c safe.directory=C:/dev/ireps-mobile` option; global Git configuration was not changed.

## 3. Files inspected

Backend/web:

- `functions/index.js`
- `functions/targetedBatches/premiseLink.js`
- `functions/targetedBatches/helpers.js`
- `functions/targetedBatches/documentFactory.js`
- `functions/targetedBatches/callables.js`
- `functions/test/targetedBatchPremiseLink.test.js`
- `functions/dataCleansing/triggers.js`
- `docs/assesment/codex/TB_PREMISE_CONTEXT_AND_ADDRESS_IMPLEMENTATION_REPORT.md`
- Git `HEAD` form and working-tree diff of the relevant backend files

Mobile:

- `src/features/premises/formPremise.js`
- `src/features/premises/targetedBatchPremiseContext.js`
- `src/features/premises/targetedBatchPremiseContext.test.mjs`
- `app/(tabs)/premises/index.js`
- `app/(tabs)/admin/operations/my-workorders.js`
- `src/redux/targetedBatchApi.js`
- `src/redux/premisesApi.js`
- `src/services/processPremiseSubmissionQueue.js`
- `src/utils/processSinglePremiseQueueItem.js`

A repository-wide search covered premise create/update trigger registrations and direct premise write calls under `functions/`.

## 4. Complete code-path trace

| Step | Handler and location | Context/source findings |
|---|---|---|
| Authoritative TB row | Firestore `tb_rows` stream, `targetedBatchApi.js:481-504` | Exact row is retained. Authority is Firestore. |
| Mobile row normalization | `normalizeTargetedBatchRow`, `targetedBatchApi.js:284-336` | Exposes IDs, meter, account/customer, address/town and preserves the entire row as `raw`. `raw.location` retains both source-address fields. |
| Context construction | `buildTargetedBatchContextFromRow`, `targetedBatchPremiseContext.js:66-95` | Builds all correlation fields, account/customer, and `sourceAddress` from `row.raw.location`. Mobile-derived copy of the authoritative row. |
| Selected ERF | `buildTargetedBatchSelectedErf`, `my-workorders.js:539-574`; activation at `1200-1218` | Spreads warehouse ERF first, then assigns `targetedBatchContext`; no overwrite follows. Full context includes address, account and customer. |
| Active ERF context | `updateGeo`, `my-workorders.js:1212-1218` | Stores the selected ERF with full in-memory context. |
| Expo Router fallback | `serializeTargetedBatchContext`, `targetedBatchPremiseContext.js:97-124`; routing at `premises/index.js:30-33,264-275,330-341` | Includes source address. Deliberately excludes account number and customer name from route JSON. |
| Form resolution | `parseTargetedBatchContextRouteParam`, helper `126-135`; form `196-230` | Queue-edit payload wins; otherwise selected ERF wins over route fallback. Normalizer retains source address and account/customer when present. No merge occurs between candidates. |
| Base payload | `FormPremise.handleSubmit`, `formPremise.js:634-743` | For new, non-duplicate TB work, assigns the normalized full context at root. JSON round-trip changes `undefined` to `null`; it does not remove `sourceAddress`. |
| Online payload | `formPremise.js:794-869` | `finalValues = {...basePayload, media: syncedMedia}`. Context remains unchanged. `premisesApi.js:275-300` forwards `newPremise` unchanged to the callable. |
| Callable request/classifier | `onPremiseCreateCallable`, `index.js:4480-4550`; `classifyTargetedBatchPremiseRoute`, `premiseLink.js:372-428` | Classifier only reads safe IDs/source/operation to choose a branch. It does not return a replacement context and does not mutate input. |
| Callable payload normalization | `index.js:4653-4687` | JSON round-trip preserves nested address. `finalPayload` spreads the safe payload, then replaces only metadata and defaults `noAccessTrnIds`. |
| Linked helper entry | `createOrLinkTargetedBatchPremise`, `premiseLink.js:595-606` | Receives `finalPayload`. Its input normalizer (`430-447`) intentionally omits source address, but this is not the final-loss point in current code because canonical construction later rebuilds it from the row. Account/customer remain as fallbacks. |
| Authoritative reads | `premiseLink.js:608-648` | In one transaction reads exact parent, row, Sales document, ERF, and premise before any write. |
| Canonical context | `buildCanonicalContext`, current working tree `premiseLink.js:187-217`; call at `710-717` | Current tree rebuilds source address solely from `row.location.addressLine1/town`; IDs, row number, meter and customer fields are canonicalized. |
| Premise transaction write | `premiseLink.js:791-803` | New: `transaction.create(premiseRef, {...premisePayload, targetedBatchContext: canonicalContext})`. Canonical backend value is last and wins. Existing compatible premise: `transaction.update` of only canonical context and metadata. |
| Atomic linkage writes | `premiseLink.js:805-839` | Same transaction updates row, parent and Sales reference. The observed successful atomic linkage proves this linked helper/path, rather than normal creation, ran. |
| Later triggers | `onPremiseCreated`, `index.js:770-1052`; `onPremiseUpdated`, `1054-1100` | Create trigger later performs a partial `update` of geofence refs/metadata. Update trigger writes only ERF metadata. Neither replaces or reads TB context. |

## 5. Mobile payload findings by path

- Selected ERF context: expected to contain source address, account number and customer name.
- Route fallback: expected to contain source address, but intentionally not account number/customer name.
- Form resolved context: selected-ERF path retains all three; route-only fallback retains source address and lacks the two privacy-excluded fields.
- Base premise payload: contains whichever normalized resolved context was selected, including source address.
- Final online callable payload: spreads base payload and replaces only media; source address remains.
- Initial offline payload: exactly the base payload; source address remains.
- Timeout fallback payload: exactly `finalValues`; source address remains.
- Queue edit payload: form reads `queueItem.payload.targetedBatchContext` first and preserves source address.
- Bulk retry: `processPremiseSubmissionQueue.js:58-97` spreads queued payload and replaces only media.
- Manual retry: `processSinglePremiseQueueItem.js:36-82` does the same.

Thus account/customer remain in the main in-memory context and are excluded only from route serialization. Source address is expected in every current TB path, including route serialization.

## 6. Backend canonical-context and merge findings

`classifyTargetedBatchPremiseRoute` does not normalize or replace the request payload. It computes branch metadata only. `createOrLinkTargetedBatchPremise` receives the original `finalPayload`, whose context has survived JSON normalization.

The helper's `normalizeTargetedBatchPremiseContext` omits `sourceAddress`; that would be a defect if this normalized object were written directly. It is not written directly. Current local code reads the exact row and constructs a separate `canonicalContext` whose address comes only from the row.

The decisive spread order is:

```js
transaction.create(premiseRef, {
  ...premisePayload,
  targetedBatchContext: canonicalContext,
});
```

Backend authority wins. There is no `{...authoritativeContext, ...mobileContext}` merge. No later field in `finalPayload` can overwrite canonical context.

The callable converts `undefined` to `null`, so Firestore undefined-value rejection/omission is not an explanation. In current code, `sourceAddress` is always an object with two values (possibly `null`); Firestore cannot silently omit the complete object. New linked creation uses transaction `create`, not `set`; idempotent repair uses transaction `update`.

## 7. First point where source address is absent

In committed `HEAD`, the first and decisive omission is `buildCanonicalContext` in `functions/targetedBatches/premiseLink.js` (HEAD lines corresponding to working-tree `187-217`). The committed return object ends after `customerName`; it has no `sourceAddress` property. The current working-tree diff adds exactly:

```js
sourceAddress: {
  addressLine1: readNullableText(row?.location?.addressLine1),
  town: readNullableText(row?.location?.town),
},
```

The stored premise context exactly matches the committed builder's output shape. Because canonical context overrides the incoming mobile context, deploying the committed version would remove even a mobile-supplied source address and replace it with the older canonical object. This is the concrete mechanism matching the observed record.

## 8. Other premise writers and triggers

| Writer | Event/write | Fields on premise | Can remove address? |
|---|---|---|---|
| `onPremiseCreateCallable` normal branch, `index.js:4716` | `set(finalPayload)` without merge | Whole new document, normal route only | Not relevant: observed atomic TB linkage proves linked route. |
| Linked helper, `premiseLink.js:791-803` | transaction `create`; or partial `update` | Whole new payload with canonical context; later only context/metadata | This is where the older builder would omit/replace source address. |
| `onPremiseCreated`, `index.js:770-1052` | create trigger; `snap.ref.update` | `geofenceRefs` and metadata | No. Partial update cannot remove unrelated nested context. Explains an update about five seconds later. |
| `onPremiseUpdated`, `index.js:1054-1100` | update trigger | No premise write; rebuilds registries and updates ERF metadata | No. |
| `onNoAccessRecorded`, `index.js:1848-1905` | TRN create trigger; premise `update` | array-union no-access ID and metadata | No. |
| `syncPremiseServiceSnapshotFromMeter`, `index.js:256-349` | meter-related transaction `update` | service snapshot bucket and metadata | No. |
| `bumpPremiseAndErfAfterAccountRegistrySync`, `dataCleansing/triggers.js:211-245` | field-account processing; premise `update` | metadata only | No. |

The repository-wide premise trigger search found only `onPremiseCreated` and `onPremiseUpdated` registered directly on `premises/{premiseId}`. Scripts capable of premise writes are manual tools, not triggers, and were not run. No runtime path found performs a later whole-document replacement of this linked premise.

Conclusion on the five-second update: it is consistent with `onPremiseCreated` updating geofence references/metadata and cannot have removed `targetedBatchContext.sourceAddress`.

## 9. Deployment and log investigation

Local chronology:

- `HEAD` commit `b7f2616` was committed 2026-08-03 18:55:04 +02:00 and contains the linked transaction but not source address.
- Working-tree `premiseLink.js` last-write time: 2026-08-03 23:05:27 +02:00.
- Implementation report last-write time: 2026-08-03 23:05:45 +02:00.
- Test transaction: approximately 23:33:49 +02:00, about 28 minutes after the local source-address edit.

The local edit predates the test, but editing is not deployment evidence.

Read-only Firebase `functions:list --project ireps2` was attempted. It failed because the signed-in Firebase credentials were no longer valid and token refresh also encountered certificate validation failure. No deployment metadata was returned. `gcloud` was not installed. Therefore the deployed update time, Cloud Run revision/build ID, successful deployment record, and deployed source-to-local match are unavailable.

The same authentication limitation prevented function-log retrieval around the test timestamp. Consequently the requested branch log fields (`hasTargetedBatchContext`, source module, IDs, and `selectedBranch`) could not be independently recovered. Further, those exact branch-selection logs are themselves an unstaged change to `functions/index.js`; they are absent from `HEAD`. Their absence in logs would not alone prove the branch did not run.

What runtime behavior proves:

- The parent, row and Sales `tbRefs` atomic changes prove `createOrLinkTargetedBatchPremise` ran.
- The stored canonical fields prove a backend canonical object was written, not merely mobile input.
- The missing address matches the older committed canonical object exactly.

What it does not prove without metadata/source retrieval:

- The exact deployed revision/build identifier.
- Whether a post-23:05 deployment completed before 23:33.
- Whether the row's location fields had the stated values at the precise transaction read time rather than only afterward.

Therefore it is not proven that the physical test used the latest local implementation. The evidence indicates it did not.

## 10. Existing test coverage and gaps

The focused backend transaction test (`targetedBatchPremiseLink.test.js:505-589`) proves linked creation, row/parent/Sales updates, Sales-data preservation, idempotency, and only asserts `premise.targetedBatchContext.salesDocId`. Its fixture has no `row.location.addressLine1/town` values and it contains no `sourceAddress` assertion.

No existing backend test proves:

- final stored `sourceAddress.addressLine1`;
- final stored `sourceAddress.town`;
- authoritative address fills a missing mobile address;
- authoritative address overrides a conflicting mobile address;
- the final transaction writes the complete authoritative canonical context;
- later triggers preserve the nested source address.

Mobile helper tests prove construction and route round-trip of source address, route privacy, and non-mutation by editable form address. They do not exercise the deployed backend or actual Firestore triggers.

## 11. Root-cause assessment and evidence

## ROOT CAUSE: NOT YET PROVEN

Strongest supported diagnosis: `onPremiseCreateCallable` executed a deployed helper equivalent to committed `HEAD` `b7f2616`, whose canonical builder omitted `sourceAddress`. The backend then replaced the mobile-supplied context with that older canonical object.

Supporting evidence:

1. Atomic parent/row/Sales updates uniquely identify the linked transaction path.
2. The resulting context includes all older canonical fields, including authoritative account/customer values.
3. `HEAD`'s canonical builder stops at `customerName` and produces exactly that shape.
4. Current unstaged code adds only the missing source-address property at the canonical construction point.
5. Current spread order makes backend canonical context win over mobile input.
6. No sanitizer after canonical construction removes the property.
7. No later trigger replaces the context or whole premise.

Remaining proof gap: deployed revision/source and logs were inaccessible, and row location at transaction time was not independently timestamped.

## 12. Smallest recommended correction (not implemented)

If the deployed revision is confirmed to be the older code, the smallest runtime correction is already present locally: retain the `sourceAddress` block in `buildCanonicalContext` in `functions/targetedBatches/premiseLink.js`, add focused final-payload assertions, review, and deploy the approved backend function. No mobile patch is needed for this narrow missing-field issue because current mobile paths already preserve source address and backend authority should rebuild it regardless.

Files requiring modification if a patch is approved:

- `functions/targetedBatches/premiseLink.js` (runtime correction; currently already modified but unstaged)
- `functions/test/targetedBatchPremiseLink.test.js` (missing assertions/fixtures)

`functions/index.js` is required only if the separate fail-closed classifier/logging work is included; it is not necessary solely to add canonical source address.

Risks:

- Deploying an unreviewed dirty worktree could include unrelated unstaged backend work.
- Null/blank authoritative row address values will intentionally produce null fields; tests must define that contract.
- Existing idempotency comparison ignores source address, so retrying an already-linked premise may be treated as a full no-op and will not backfill address if the core IDs match. Any historical repair requires a separately approved data plan; none is authorized here.
- A deployment alone affects future creation but does not repair the existing premise.

## 13. Focused validation plan

1. Reauthenticate read-only tooling and record `onPremiseCreateCallable` update time, revision/build ID, deployment status, and logs around 2026-08-03T21:33:49Z.
2. Compare retrieved deployed source/build provenance with `HEAD` and the unstaged source-address diff; do not infer equality from timestamps alone.
3. Add a backend fixture with exact non-null `row.location.addressLine1/town`, missing mobile address, and conflicting mobile address; assert the stored values are authoritative in both cases.
4. Assert the complete context actually supplied to `transaction.create`.
5. Add a focused trigger/emulator check showing the create-trigger geofence update preserves context.
6. Review and deploy only the intended function from a controlled clean package.
7. Use a fresh controlled TB row and verify logs, premise context, row, parent, and Sales reference atomically.
8. Retry the same request and verify idempotency. Separately decide whether source-address backfill on retry is desired.
9. Do not reuse or repair the existing record without separate approval.

## 14. Safety confirmation

- No runtime source file was modified.
- Only this report was created.
- No deployment occurred.
- No Firestore write, repair, or deletion occurred.
- No implementation/data script was run.
- No staging, commit, push, reset, restore, checkout, clean, deletion, or replacement occurred.
- No existing unstaged or untracked Targeted Batch work was altered.

